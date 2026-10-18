import { homedir } from "node:os";
import { BoxRenderable, TextRenderable, createCliRenderer, createHostClipboard, fg, t } from "@opentui/core";
import type { HostClipboardService } from "@opentui/core";
import { FakeProcOutput } from "../fake.js";
import type { CommandDef, SupervisorRef } from "../proc/types.js";
import { indexMatches, highlightLine, stripAnsi } from "../proc/search.js";
import {
    MIN_TABS_LAYOUT_WIDTH,
    minTabsLayoutHeight,
    sidebarWidth,
    singleLine,
} from "../proc/util.js";
import { keyToAction, type DevAction, type KeyInfo } from "../tui/keys.js";
import { ProcessBuffers } from "../tui/ProcessBuffers.js";
import { QUIT_WINDOW_MS, ctrlCWantsQuit } from "../store/quitGate.js";
import { pickCopyText } from "../store/clipboard.js";
import { ScrollState } from "../tui/ScrollState.js";
import { getTheme, setTheme, toggleTheme } from "../tui/theme.js";
import {
    buildStreamLines,
    buildTabLines,
    computeWindowStart,
    effectiveMatchIndex,
    padCells,
    type FooterMode,
} from "../tui/view.js";
import { detach } from "../ui/detach.js";
import { Footer } from "../ui/Footer.js";
import { HelpOverlay } from "../ui/HelpOverlay.js";
import { OutputPane } from "../ui/OutputPane.js";
import { Sidebar } from "../ui/Sidebar.js";

export interface MultiplexAppOptions {
    commandDefs: CommandDef[];
    cwd?: string;
    streamMode?: boolean;
    bufferSize?: number;
    streamBufferSize?: number;
    timestamps?: boolean;
    autoRestart?: boolean;
    title?: string;
    fake?: boolean;
    fakeIntervalMs?: number;
    theme?: string;
    supervisorRef?: SupervisorRef;
    /** Test seam: fixed terminal size (production reads the live renderer). */
    terminal?: { cols: number; rows: number };
}

/** Test seam: inject a renderer (e.g. OpenTUI TestRenderer) instead of creating one. */
export interface MultiplexAppDeps {
    renderer?: any;
    /** Clipboard writer override (tests). Defaults to host-native → OSC52. */
    writeClipboard?: (text: string) => Promise<boolean>;
}

/** Root TUI: header + sidebar/content + footer. Owns ALL state. */
export class MultiplexApp {
    readonly buffers: ProcessBuffers;
    readonly scroll: ScrollState;
    private renderer: any;
    private root: BoxRenderable | null = null;
    private headerBox!: BoxRenderable;
    private headerTitle!: TextRenderable;
    private headerCwd!: TextRenderable;
    private middle!: BoxRenderable;
    private sidebar!: Sidebar;
    private contentBox!: BoxRenderable;
    private contentHeader!: TextRenderable;
    private output!: OutputPane;
    private footer!: Footer;
    private help!: HelpOverlay;
    private fake: FakeProcOutput | null = null;
    private keyHandler: ((key: any) => void) | null = null;
    private resizeHandler: (() => void) | null = null;
    private animTimer: ReturnType<typeof setInterval> | null = null;
    private animFrame = 0;
    private pendingRender = false;
    private destroyed = false;
    private readonly cwd: string;
    private readonly title?: string;
    private readonly fakeMode: boolean;
    private readonly fakeIntervalMs: number;
    private lastThemeName: string | null = null;

    selectedIndex = 0;
    streamMode: boolean;
    focus: "sidebar" | "content" = "content";
    searchInputMode = false;
    searchQuery = "";
    currentMatch = 0;
    private matchCount = 0;
    filterMode = false;
    readonly hiddenProcs = new Set<number>();
    /** First-Ctrl+C timestamp for the double-press quit gate (null = none). */
    private lastCtrlC: number | null = null;
    /** Transient copy toast shown in the footer (null = none). */
    private copyToast: string | null = null;
    private copyToastTimer: ReturnType<typeof setTimeout> | null = null;
    /** Native clipboard service (lazy) + test-seam writer override. */
    private hostClipboard: HostClipboardService | null = null;
    private injectedWrite: ((text: string) => Promise<boolean>) | null = null;
    /** Latest full display lines (test seam + Ctrl+C copy source). */
    private lastDisplayLines: string[] = [];

    /** devTui sets this: q / Ctrl+C asks the host to shut down. */
    onRequestExit: (() => void) | null = null;

    constructor(private options: MultiplexAppOptions) {
        const defs = options.commandDefs;

        this.cwd = options.cwd ?? process.cwd();
        this.title = options.title;
        this.fakeMode = options.fake ?? false;
        this.fakeIntervalMs = options.fakeIntervalMs ?? 300;

        if (options.theme) {
            setTheme(options.theme);
        }

        const { cols, rows } = this.measure();
        const timestamps = options.timestamps ?? false;

        this.streamMode =
            (options.streamMode ?? false) ||
            cols < MIN_TABS_LAYOUT_WIDTH ||
            rows < minTabsLayoutHeight(defs.length);

        const outputHeight = Math.max(0, rows - (this.streamMode ? 4 : 5));

        this.scroll = new ScrollState(outputHeight);
        this.buffers = new ProcessBuffers({
            commandDefs: defs,
            cwd: this.cwd,
            bufferSize: options.bufferSize ?? 2000,
            streamBufferSize: options.streamBufferSize ?? 10000,
            timestamps,
            autoRestart: options.autoRestart ?? true,
            title: this.title,
            columns: cols,
            onChange: () => this.triggerRender(),
            supervisorRef: options.supervisorRef,
        });
    }

    static async create(options: MultiplexAppOptions, deps: MultiplexAppDeps = {}): Promise<MultiplexApp> {
        const app = new MultiplexApp(options);
        await app.init(deps);
        return app;
    }

    private measure(): { cols: number; rows: number } {
        const fixed = this.options.terminal;

        if (fixed) {
            return { cols: fixed.cols, rows: fixed.rows };
        }

        // The renderer owns the real window size: stdout.columns can report
        // the (wider) console buffer on Windows.
        const width = (this.renderer as any)?.width;
        const height = (this.renderer as any)?.height;

        return {
            cols: typeof width === "number" && width > 0 ? width : (process.stdout.columns ?? 80),
            rows: typeof height === "number" && height > 0 ? height : (process.stdout.rows ?? 24),
        };
    }

    private async init(deps: MultiplexAppDeps = {}): Promise<void> {
        // exitOnCtrlC: false — the App owns the quit path (q / Ctrl+C);
        // the renderer must not destroy itself natively on the first press.
        this.renderer =
            deps.renderer ?? (await createCliRenderer({ exitOnCtrlC: false, openConsoleOnError: false } as any));
        (this.renderer as any).start?.();
        this.injectedWrite = deps.writeClipboard ?? null;

        const theme = getTheme();

        this.root = new BoxRenderable(this.renderer, {
            id: "dev-root",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            backgroundColor: theme.background,
        } as any);
        this.renderer.root.add(this.root);

        this.headerBox = new BoxRenderable(this.renderer, {
            id: "dev-header",
            flexDirection: "row",
            width: "100%",
            height: 1,
        } as any);
        (this.root as any).add(this.headerBox as any);
        this.headerTitle = new TextRenderable(this.renderer, { id: "dev-title", height: 1, wrapMode: "none" } as any);
        (this.headerBox as any).add(this.headerTitle as any);
        this.headerCwd = new TextRenderable(this.renderer, { id: "dev-cwd", height: 1, wrapMode: "none" } as any);
        (this.headerBox as any).add(this.headerCwd as any);

        this.middle = new BoxRenderable(this.renderer, {
            id: "dev-middle",
            flexDirection: "row",
            flexGrow: 1,
            width: "100%",
            backgroundColor: theme.background,
        } as any);
        (this.root as any).add(this.middle as any);

        this.sidebar = new Sidebar(this.renderer, this.middle, {
            onSelect: (index) => {
                if (this.destroyed) {
                    return;
                }

                this.selectedIndex = index;
                this.currentMatch = 0;
                this.scroll.scrollToBottom();
                this.render();
            },
            onPress: () => {
                if (this.destroyed || this.streamMode || this.focus === "sidebar") {
                    return;
                }

                this.focus = "sidebar";
                this.render();
            },
        });

        this.contentBox = new BoxRenderable(this.renderer, {
            id: "dev-content",
            flexDirection: "column",
            flexGrow: 1,
            border: true,
            borderColor: theme.focus,
            backgroundColor: theme.background,
        } as any);
        (this.middle as any).add(this.contentBox as any);

        this.contentHeader = new TextRenderable(this.renderer, { id: "dev-cmd", height: 1, wrapMode: "none" } as any);
        (this.contentBox as any).add(this.contentHeader as any);

        // Mouse bubbles row → contentBox, so one box-level pair covers wheel
        // scroll + click-to-focus for the whole content pane.
        (this.contentBox as any).onMouseDown = () => {
            if (this.destroyed || this.focus === "content") {
                return;
            }

            this.focus = "content";
            this.render();
        };
        (this.contentBox as any).onMouse = (e: any) => {
            if (this.destroyed || e?.type !== "scroll") {
                return;
            }

            const dir = e?.scroll?.direction;

            if (dir === "up") {
                this.scroll.scrollUp();
                this.render();
            } else if (dir === "down") {
                this.scroll.scrollDown();
                this.render();
            }
        };

        this.output = new OutputPane(this.renderer, this.contentBox);
        this.footer = new Footer(this.renderer, this.root);
        this.help = new HelpOverlay(this.renderer);

        this.keyHandler = (key: any) => this.onKey(key);
        this.renderer.keyInput.on("keypress", this.keyHandler);

        this.resizeHandler = () => this.render();
        process.stdout.on("resize", this.resizeHandler);

        this.animTimer = setInterval(() => {
            if (this.destroyed) {
                return;
            }

            const now = Date.now();
            const busy =
                this.buffers.spawnTimes.some((t) => t > 0 && now - t < 2000) ||
                this.buffers.pendingRestarts.size > 0;

            if (busy) {
                this.animFrame++;
                this.render();
            }
        }, 80);
        (this.animTimer as any)?.unref?.();

        if (this.fakeMode) {
            this.fake = new FakeProcOutput(
                (i, text) => this.buffers.testLine(i, text),
                this.options.commandDefs.length,
                this.fakeIntervalMs,
            );
            this.fake.start();
        } else {
            this.buffers.start();
        }

        this.render();
    }

    /** Test/fake seam: push one line into a proc buffer and repaint. */
    ingestLine(index: number, text: string): void {
        if (this.destroyed) {
            return;
        }

        this.buffers.testLine(index, text);
    }

    private triggerRender(): void {
        this.scroll.notifyNewOutput();

        if (!this.pendingRender) {
            this.pendingRender = true;

            setTimeout(() => {
                this.pendingRender = false;
                this.render();
            }, 16);
        }
    }

    private onKey(key: any): void {
        if (this.destroyed) {
            return;
        }

        const keyInfo: KeyInfo = {
            name: key.name,
            sequence: key.sequence,
            ctrl: key.ctrl,
            meta: key.meta,
            shift: key.shift,
        };

        // Help overlay takes Esc/? first.
        if (this.help.isOpen && (key.name === "escape" || key.sequence === "?" || key.name === "?")) {
            this.help.close();
            this.render();
            return;
        }

        // Ctrl+C works everywhere (even while typing): first press copies
        // the freshest visible line and toasts, second press quits.
        if (key.ctrl && key.name === "c") {
            this.dispatch("quit:press");
            return;
        }

        const action = keyToAction(keyInfo, {
            searchInput: this.searchInputMode,
            filterOpen: this.filterMode,
            hasQuery: this.searchQuery !== "",
            streamMode: this.streamMode,
        });

        if (!action) {
            return;
        }

        // The typed character never survives keyToAction (it maps the class
        // of key, not the char); read it off the raw keypress here.
        if (action === "search:type") {
            const seq = typeof key.sequence === "string" ? key.sequence : "";

            if (seq.length === 1 && seq.charCodeAt(0) >= 32 && !key.ctrl && !key.meta) {
                this.searchQuery += seq;
                this.currentMatch = 0;
                this.render();
            }

            return;
        }

        this.dispatch(action);
    }

    private dispatch(action: DevAction): void {
        const defs = this.options.commandDefs;

        switch (action) {
            case "quit":
                this.onRequestExit?.();
                return;
            case "quit:press": {
                // Double Ctrl+C gate: second press inside the window quits,
                // the first copies the freshest visible line and toasts.
                const now = Date.now();

                if (ctrlCWantsQuit(this.lastCtrlC, now)) {
                    this.lastCtrlC = null;
                    this.clearCopyToast();
                    this.onRequestExit?.();
                    return;
                }

                this.lastCtrlC = now;
                this.copyVisibleToClipboard();
                this.render();
                return;
            }
            case "help": {
                if (this.searchInputMode || this.filterMode) {
                    return;
                }

                const { cols, rows } = this.measure();

                this.help.toggle(cols, rows, () => this.render());
                this.render();
                return;
            }
            case "theme:toggle":
                toggleTheme();
                this.render();
                return;
            case "mode:stream":
                this.streamMode = true;
                this.currentMatch = 0;
                this.scroll.resetScroll();
                this.render();
                return;
            case "mode:tabs":
                this.streamMode = false;
                this.currentMatch = 0;
                this.scroll.resetScroll();
                this.render();
                return;
            case "focus:toggle":
                if (!this.streamMode) {
                    this.focus = this.focus === "sidebar" ? "content" : "sidebar";
                    this.render();
                }
                return;
            case "focus:sidebar":
                if (!this.streamMode && this.focus !== "sidebar") {
                    this.focus = "sidebar";
                    this.render();
                }
                return;
            case "focus:content":
                if (this.focus !== "content") {
                    this.focus = "content";
                    this.render();
                }
                return;
            case "restart":
                if (this.fake) {
                    this.fake.restart();
                } else {
                    this.buffers.restart(this.selectedIndex);
                }
                this.scroll.resetScroll();
                this.render();
                return;
            case "clear":
                if (this.streamMode) {
                    this.buffers.clearStream();
                } else {
                    this.buffers.clearOutput(this.selectedIndex);
                }
                this.scroll.resetScroll();
                this.render();
                return;
            case "search:open":
                this.searchInputMode = true;
                this.searchQuery = "";
                this.currentMatch = 0;
                this.render();
                return;
            case "search:confirm":
                this.searchInputMode = false;
                if (this.matchCount > 0) {
                    this.currentMatch = 0;
                }
                this.render();
                return;
            case "search:cancel":
                if (this.searchInputMode) {
                    this.searchInputMode = false;
                    this.searchQuery = "";
                    this.currentMatch = 0;
                } else {
                    this.searchQuery = "";
                    this.currentMatch = 0;
                    this.scroll.resetScroll();
                }
                this.render();
                return;
            case "search:edit":
                this.searchQuery = this.searchQuery.slice(0, -1);
                this.currentMatch = 0;
                this.render();
                return;
            case "search:next":
                if (this.matchCount > 0) {
                    this.currentMatch = (this.currentMatch + 1) % this.matchCount;
                    this.render();
                }
                return;
            case "search:prev":
                if (this.matchCount > 0) {
                    this.currentMatch = (this.currentMatch - 1 + this.matchCount) % this.matchCount;
                    this.render();
                }
                return;
            case "filter:open":
                this.filterMode = true;
                this.render();
                return;
            case "filter:close":
                this.filterMode = false;
                this.render();
                return;
            case "scroll:up":
                if (!this.streamMode && this.focus === "sidebar") {
                    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
                    this.currentMatch = 0;
                    this.scroll.resetScroll();
                } else {
                    this.scroll.scrollUp();
                }
                this.render();
                return;
            case "scroll:down":
                if (!this.streamMode && this.focus === "sidebar") {
                    this.selectedIndex = Math.min(defs.length - 1, this.selectedIndex + 1);
                    this.currentMatch = 0;
                    this.scroll.resetScroll();
                } else {
                    this.scroll.scrollDown();
                }
                this.render();
                return;
            case "scroll:pageup":
                if (this.effectiveFocus() === "content") {
                    this.scroll.pageUp();
                    this.render();
                }
                return;
            case "scroll:pagedown":
                if (this.effectiveFocus() === "content") {
                    this.scroll.pageDown();
                    this.render();
                }
                return;
            case "scroll:top":
                if (this.effectiveFocus() === "content") {
                    this.scroll.scrollToTop();
                    this.render();
                }
                return;
            case "scroll:bottom":
                if (this.effectiveFocus() === "content") {
                    this.scroll.scrollToBottom();
                    this.render();
                }
                return;
            default: {
                if (this.filterMode) {
                    const m = action.match(/^filter:toggle:(\d)$/);

                    if (m) {
                        const idx = Number(m[1]) - 1;

                        if (idx < defs.length) {
                            if (this.hiddenProcs.has(idx)) {
                                this.hiddenProcs.delete(idx);
                            } else if (this.hiddenProcs.size < defs.length - 1) {
                                this.hiddenProcs.add(idx);
                            }

                            this.scroll.resetScroll();
                            this.render();
                        }
                    }

                    return;
                }

                const m = action.match(/^select:(\d)$/);

                if (m) {
                    const idx = Number(m[1]) - 1;

                    if (idx < defs.length) {
                        this.selectedIndex = idx;
                        this.currentMatch = 0;
                        this.scroll.scrollToBottom();
                        this.render();
                    }
                }
                return;
            }
        }
    }

    private effectiveFocus(): "sidebar" | "content" {
        return this.streamMode ? "content" : this.focus;
    }

    render(): void {
        if (this.destroyed || !this.root) {
            return;
        }

        const defs = this.options.commandDefs;
        const { cols, rows } = this.measure();
        const labels = defs.map((c) => c.label);
        const maxLabelLen = Math.max(...labels.map((l) => l.length));
        const outputHeight = Math.max(0, rows - (this.streamMode ? 4 : 5));

        this.scroll.viewport = outputHeight;
        this.buffers.setColumns(cols);
        const { tabbed: tabbedWrapWidth } = this.buffers.columns;

        const theme = getTheme();

        // Re-apply every frame: init-time colors go stale on theme:toggle.
        this.root.backgroundColor = theme.background;
        this.middle.backgroundColor = theme.background;
        this.contentBox.backgroundColor = theme.background;
        // One header row in both modes (title left, cwd right): a two-row
        // stream header left a dead row under it (empty line) and pushed the
        // content column one row past the middle.
        this.headerBox.height = 1;

        const shortCwd = this.cwd.replace(homedir(), "~");
        const titleText = this.title ?? "";
        const headGap = Math.max(1, cols - titleText.length - shortCwd.length);

        this.headerTitle.content = t`${fg(theme.dim)(titleText)}${" ".repeat(headGap)}${fg(theme.dim)(shortCwd)}`;
        (this.headerCwd as any).visible = false;

        // Sidebar left, content fills the rest (stream: content only, and the
        // sidebar collapses to zero width so it keeps no hit-test area).
        const sideW = this.streamMode ? 0 : sidebarWidth(labels, cols);

        if (this.streamMode) {
            this.sidebar.setVisible(false);
            this.sidebar.setWidth(0);
        } else {
            this.sidebar.setVisible(true);
            this.sidebar.setWidth(sideW);
            this.sidebar.render(
                defs,
                this.selectedIndex,
                this.buffers.failedProcs,
                this.buffers.pendingRestarts,
                this.buffers.spawnTimes,
                this.animFrame,
                this.focus === "sidebar",
                sideW,
            );
        }

        const focusedContent = this.effectiveFocus() === "content";
        // Content inner width past its own border (no padding: rows pad fully).
        const contentInner = Math.max(20, cols - sideW - 2);

        this.contentBox.borderColor = focusedContent ? theme.focus : theme.border;

        const headerPlain = this.streamMode
            ? `${defs.length} processes · stream`
            : singleLine(defs[this.selectedIndex]?.command ?? "");

        this.headerCwd.content = t``;
        // Stream mode has no command header (multiplex parity): with it the
        // content column overflowed the middle by one row and stamped the
        // bottom border and footer.
        (this.contentHeader as any).visible = !this.streamMode;

        this.contentHeader.content = t`${fg(theme.dim)(padCells(headerPlain, contentInner))}`;

        // displayLines mirrors multiplex app.tsx: pre-wrapped rows plus the
        // raw tail in tabs, labeled interleaved lines in stream.
        const displayLines = this.streamMode
            ? buildStreamLines(this.buffers.streamLines, this.hiddenProcs, defs, maxLabelLen, theme.name)
            : buildTabLines(
                  this.buffers.outputRows[this.selectedIndex] ?? [],
                  this.buffers.pendingTail(this.selectedIndex),
                  tabbedWrapWidth,
              );

        const searchIndex = indexMatches(displayLines, this.searchQuery);

        this.matchCount = searchIndex.count;
        this.scroll.totalLines = displayLines.length;
        this.lastDisplayLines = displayLines;

        const effectiveMatch = effectiveMatchIndex(this.currentMatch, this.matchCount);
        const windowStart = computeWindowStart({
            total: displayLines.length,
            outputHeight,
            searchQuery: this.searchQuery,
            searchInputMode: this.searchInputMode,
            matchCount: this.matchCount,
            effectiveMatch,
            lineOf: searchIndex.lineOf,
            scrollOffset: this.scroll.offset,
        });

        // Highlight the window only (never the whole buffer — the quadratic
        // trap multiplex documents). Absolute indexes feed the match map.
        const highlight = (line: string, absoluteIndex: number): string =>
            this.searchQuery !== ""
                ? highlightLine(
                      line,
                      this.searchQuery,
                      this.searchInputMode ? -1 : effectiveMatch,
                      searchIndex.firstMatchOnLine.get(absoluteIndex) ?? -1,
                  )
                : line;

        this.output.render(displayLines, windowStart, outputHeight, contentInner, highlight);

        const footerMode: FooterMode = this.streamMode ? "stream" : this.focus === "sidebar" ? "sidebar" : "content";

        this.footer.render({
            mode: footerMode,
            searchInputMode: this.searchInputMode,
            searchQuery: this.searchQuery,
            matchCount: this.matchCount,
            effectiveMatch,
            filterMode: this.filterMode,
            commandDefs: defs,
            hiddenProcs: this.hiddenProcs,
            hasNewOutput: this.scroll.hasNewOutput,
            maxWidth: cols,
            toast: this.copyToast ?? undefined,
        });

        const themeName = getTheme().name;

        if (themeName !== this.lastThemeName) {
            this.lastThemeName = themeName;

            if (this.help.isOpen) {
                this.help.repaint();
            }
        }
    }

    /**
     * First Ctrl+C: copy the mouse selection when one exists, else the
     * freshest visible line, then toast. Never throws and never writes OSC52
     * to terminals without support (the raw sequence leaks onto the screen).
     */
    private copyVisibleToClipboard(): void {
        // Freshest non-empty visible line (the tail slot itself is the
        // pending partial, usually blank — never copy that).
        let activeText: string | null = null;

        for (let i = this.lastDisplayLines.length - 1; i >= 0; i--) {
            const plain = stripAnsi(this.lastDisplayLines[i] ?? "").trim();

            if (plain !== "") {
                activeText = plain;
                break;
            }
        }

        const picked = pickCopyText(this.renderer, activeText);

        if (!picked) {
            this.showCopyToast("nothing to copy · Ctrl+C again to quit");
            return;
        }

        void this.writeClipboard(picked.text).then((ok) => {
            if (this.destroyed) {
                return;
            }

            this.showCopyToast(
                ok ? `copied ${picked.label} · Ctrl+C again to quit` : "copy unavailable · Ctrl+C again to quit",
            );

            try {
                (this.renderer as any).clearSelection?.();
            } catch {
                // Selection highlight is cosmetic; copy already landed.
            }

            this.render();
        });
    }

    /**
     * Clipboard write: injected seam (tests) → host-native service (Win32
     * API on Windows) → OSC52 when supported.
     */
    private async writeClipboard(text: string): Promise<boolean> {
        if (this.injectedWrite) {
            try {
                return await this.injectedWrite(text);
            } catch {
                return false;
            }
        }

        try {
            this.hostClipboard ??= createHostClipboard();
            const res = await this.hostClipboard.writeText(text, {
                selection: "clipboard",
                signal: AbortSignal.timeout(1500),
            });

            if (res.status === "written") {
                return true;
            }
        } catch {
            // Fall through to OSC52.
        }

        try {
            if ((this.renderer as any).isOsc52Supported?.() === false) {
                return false;
            }

            return (this.renderer as any).copyToClipboardOSC52?.(text) === true;
        } catch {
            return false;
        }
    }

    private showCopyToast(text: string): void {
        this.clearCopyToast();
        this.copyToast = text;
        this.copyToastTimer = setTimeout(() => {
            this.copyToast = null;
            this.copyToastTimer = null;
            this.render();
        }, QUIT_WINDOW_MS);
        (this.copyToastTimer as any)?.unref?.();
    }

    private clearCopyToast(): void {
        if (this.copyToastTimer !== null) {
            clearTimeout(this.copyToastTimer);
            this.copyToastTimer = null;
        }

        this.copyToast = null;
    }

    async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.clearCopyToast();

        try {
            await this.hostClipboard?.dispose();
        } catch {
            // Clipboard teardown must not block shutdown.
        }

        this.hostClipboard = null;

        if (this.animTimer) {
            clearInterval(this.animTimer);
            this.animTimer = null;
        }

        this.fake?.stop();
        this.fake = null;

        if (this.keyHandler) {
            this.renderer.keyInput.off("keypress", this.keyHandler);
            this.keyHandler = null;
        }

        if (this.resizeHandler) {
            process.stdout.off("resize", this.resizeHandler);
            this.resizeHandler = null;
        }

        this.help.destroy();
        this.sidebar.destroy();
        this.output.destroy();
        this.footer.destroy();

        if (this.root) {
            detach(this.renderer.root, this.root);

            (this.root as any).destroyRecursively?.() ?? (this.root as any).destroy?.();
            this.root = null;
        }

        await this.renderer.destroy?.();

        // Wait for the children after leaving the alternate screen: the
        // flush (done by devTui) should carry whatever they say on the way
        // out, and nobody watches a dead frame while they take it.
        await this.buffers.terminate();
        this.buffers.killAll();
    }
}
