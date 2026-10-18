import { StyledText, TextRenderable, bold, fg, t } from "@opentui/core";
import type { CommandDef } from "../proc/types.js";
import { procColor } from "../tui/procColors.js";
import { getTheme } from "../tui/theme.js";
import { cellWidth, footerBindings, type FooterMode } from "../tui/view.js";

export interface FooterState {
    mode: FooterMode;
    searchInputMode: boolean;
    searchQuery: string;
    matchCount: number;
    effectiveMatch: number;
    filterMode: boolean;
    commandDefs: CommandDef[];
    hiddenProcs: Set<number>;
    hasNewOutput: boolean;
    /** Terminal width: the row is padded to it so no stale cells survive. */
    maxWidth: number;
    /** Transient toast (first-Ctrl+C copy): replaces hints, same height. */
    toast?: string;
}

type Chunk = ReturnType<ReturnType<typeof fg>>;

/** Single-line footer: key hints, search prompt/count, or the filter picker. */
export class Footer {
    private row: TextRenderable;

    constructor(
        renderer: any,
        parent: { add: (child: any) => void },
    ) {
        this.row = new TextRenderable(renderer, {
            id: "dev-footer",
            height: 1,
            width: "100%",
            // Never wrap into the content above (see OutputPane).
            wrapMode: "none",
        } as any);
        parent.add(this.row as any);
    }

    /** Blank-pad the row to the full width (stale-cell overwrite). */
    private pad(chunks: Chunk[], plain: string, maxWidth: number): void {
        const missing = Math.max(0, maxWidth - cellWidth(plain));

        if (missing > 0) {
            chunks.push(fg(getTheme().background)(" ".repeat(missing)));
        }
    }

    render(state: FooterState): void {
        const theme = getTheme();
        const maxWidth = Math.max(20, state.maxWidth);

        if (state.toast !== undefined && state.toast !== "" && !state.filterMode && !state.searchInputMode) {
            const chunks: Chunk[] = [fg(theme.accent)(` ${state.toast}`)];

            this.pad(chunks, ` ${state.toast}`, maxWidth);
            this.row.content = new StyledText(chunks);
            return;
        }

        if (state.filterMode) {
            // `filter:  1 label  2 label ...   1-9 toggle · f done`
            const chunks: Chunk[] = [bold(fg(theme.accent)("filter: "))];
            let plain = "filter: ";

            state.commandDefs.forEach((cmd, i) => {
                const hidden = state.hiddenProcs.has(i);
                const num = i < 9 ? `${i + 1}` : " ";
                const sep = i > 0 ? "   " : " ";
                const color = procColor(cmd.color, theme.name);

                plain += `${sep}${num} ${cmd.label}`;
                chunks.push(fg(theme.border)(sep));
                chunks.push(hidden ? fg(theme.border)(num) : (bold(fg(color)(num)) as Chunk));
                chunks.push(hidden ? fg(theme.border)(` ${cmd.label}`) : fg(color)(` ${cmd.label}`));
            });

            plain += "   1-9 toggle   f done";
            chunks.push(fg(theme.border)("   "));
            chunks.push(bold(fg(theme.text)("1-9")) as Chunk);
            chunks.push(fg(theme.dim)(" toggle   "));
            chunks.push(bold(fg(theme.text)("f")) as Chunk);
            chunks.push(fg(theme.dim)(" done"));
            this.pad(chunks, plain, maxWidth);
            this.row.content = new StyledText(chunks);
            return;
        }

        if (state.searchInputMode) {
            const tail =
                state.searchQuery !== "" && state.matchCount === 0
                    ? " no matches"
                    : state.searchQuery !== "" && state.matchCount > 0
                      ? ` ${state.matchCount} match${state.matchCount === 1 ? "" : "es"}`
                      : "";
            const plain = `/ ${state.searchQuery}█${tail}`;
            const chunks: Chunk[] = [
                bold(fg(theme.accent)("/ ")) as Chunk,
                fg(theme.text)(state.searchQuery),
                fg(theme.accent)("█"),
            ];

            if (tail !== "") {
                chunks.push(
                    state.matchCount === 0 ? fg(theme.danger)(tail) : fg(theme.border)(tail),
                );
            }

            this.pad(chunks, plain, maxWidth);
            this.row.content = new StyledText(chunks);
            return;
        }

        if (state.searchQuery !== "" && state.matchCount > 0) {
            const plain = `[${state.effectiveMatch + 1}/${state.matchCount}] ${state.searchQuery} n next N prev Esc clear`;

            this.row.content = t`${bold(fg(theme.accent)(`[${state.effectiveMatch + 1}/${state.matchCount}]`))}${fg(theme.dim)(` ${state.searchQuery} `)}${bold(fg(theme.text)("n"))}${fg(theme.dim)(" next ")}${bold(fg(theme.text)("N"))}${fg(theme.dim)(" prev ")}${bold(fg(theme.text)("Esc"))}${fg(theme.dim)(" clear")}${fg(theme.background)(" ".repeat(Math.max(0, maxWidth - cellWidth(plain))))}`;
            return;
        }

        const chunks: Chunk[] = [];
        const bindings = footerBindings(state.mode);
        let plain = "";

        for (let bi = 0; bi < bindings.length; bi++) {
            const [k, desc] = bindings[bi] ?? ["", ""];

            if (bi > 0) {
                plain += "   ";
                chunks.push(fg(theme.border)("   "));
            }

            plain += `${k} ${desc}`;
            chunks.push(bold(fg(theme.text)(k)) as Chunk);
            chunks.push(fg(theme.dim)(` ${desc}`));
        }

        const flags: string[] = [];

        if (state.hiddenProcs.size > 0) {
            flags.push("◆ filtered");
        }

        if (state.hasNewOutput) {
            flags.push("↓ new output");
        }

        if (flags.length > 0) {
            plain += `   ${flags.join(" ")}`;
            chunks.push(fg(theme.border)("   "));
            chunks.push(fg(theme.accent)(flags.join(" ")));
        }

        this.pad(chunks, plain, maxWidth);
        this.row.content = new StyledText(chunks);
    }

    destroy(): void {
        (this.row as any).destroy?.();
    }
}
