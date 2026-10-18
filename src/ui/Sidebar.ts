import { BoxRenderable, TextRenderable, bg, bold, fg, t } from "@opentui/core";
import type { CommandDef } from "../proc/types.js";
import { contrastText } from "../proc/color.js";
import { procColor } from "../tui/procColors.js";
import { getTheme } from "../tui/theme.js";
import { detach } from "./detach.js";

export const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export interface SidebarHooks {
    /** A tab row was clicked. */
    onSelect?: (index: number) => void;
    /** The sidebar (but no row) was clicked — takes focus. */
    onPress?: () => void;
}

/**
 * Left tab list (multiplex `app.tsx` parity): per-row status indicator
 * (spinner while spawning/restarting, ✕ on failure, number otherwise),
 * the label, and the selected row filled with the command's own color.
 */
export class Sidebar {
    private box: BoxRenderable;
    private rows: TextRenderable[] = [];

    constructor(
        private renderer: any,
        private parent: BoxRenderable,
        private hooks: SidebarHooks = {},
    ) {
        this.box = new BoxRenderable(renderer, {
            id: "dev-sidebar",
            flexDirection: "column",
            flexShrink: 0,
            border: true,
            borderColor: getTheme().border,
            backgroundColor: getTheme().background,
        } as any);
        parent.add(this.box as any);
        (this.box as any).onMouseDown = () => this.hooks.onPress?.();
    }

    setVisible(v: boolean): void {
        (this.box as any).visible = v;
    }

    setWidth(w: number): void {
        this.box.width = w;
    }

    render(
        commandDefs: CommandDef[],
        selectedIndex: number,
        failed: Set<number>,
        restarting: Set<number>,
        spawnTimes: number[],
        animFrame: number,
        focused: boolean,
        width: number,
    ): void {
        const theme = getTheme();

        this.box.borderColor = focused ? theme.focus : theme.border;
        this.box.backgroundColor = theme.background;
        this.box.width = width;

        while (this.rows.length < commandDefs.length) {
            const row = new TextRenderable(this.renderer, {
                id: `dev-side-${this.rows.length}`,
                // Never wrap into the next tab's slot (see OutputPane).
                wrapMode: "none",
            } as any);
            (this.box as any).add(row as any);
            this.rows.push(row);
        }

        while (this.rows.length > commandDefs.length) {
            const row = this.rows.pop();

            if (row) {
                detach(this.box, row);
                row.destroy();
            }
        }

        const now = Date.now();
        const innerWidth = Math.max(4, width - 2);

        commandDefs.forEach((cmd, i) => {
            const row = this.rows[i];

            if (!row) {
                return;
            }

            const selected = i === selectedIndex;
            const isRestarting = restarting.has(i);
            const isFailed = failed.has(i);
            const isSpinning = now - (spawnTimes[i] ?? 0) < 2000;
            const spinnerChar = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length] ?? "⠋";
            // Pastels wash out on near-white: same hue one shade deeper.
            const color = procColor(cmd.color, theme.name);
            // The selected tab is filled with the command's own color, so
            // everything drawn on it has to be legible against that fill
            // rather than against the background.
            const onFill = contrastText(color);

            let indicator: string;
            let indicatorColor: string;

            if (isRestarting) {
                indicator = spinnerChar;
                indicatorColor = selected ? onFill : theme.accent;
            } else if (isFailed) {
                indicator = "✕";
                indicatorColor = selected ? onFill : theme.danger;
            } else if (isSpinning) {
                indicator = spinnerChar;
                indicatorColor = selected ? onFill : color;
            } else {
                indicator = i < 9 ? `${i + 1}` : " ";
                indicatorColor = selected ? onFill : theme.dim;
            }

            // Full-width rows: reused TextRenderables keep leftover cells
            // when shorter content replaces longer content.
            const pad = Math.max(0, innerWidth - 4 - cmd.label.length);

            (row as any).onMouseDown = () => this.hooks.onSelect?.(i);

            if (selected) {
                row.content = t`${bg(color)(bold(fg(onFill)(` ${indicator} ${cmd.label}${" ".repeat(pad)}`)))}`;
                return;
            }

            const label = isFailed ? fg(theme.danger)(cmd.label) : fg(color)(cmd.label);

            row.content = t`${fg(indicatorColor)(` ${indicator} `)}${label} ${" ".repeat(pad)}`;
        });
    }

    destroy(): void {
        for (const row of this.rows.splice(0)) {
            detach(this.box, row);
            row.destroy();
        }

        detach(this.parent, this.box);

        (this.box as any).destroyRecursively?.() ?? (this.box as any).destroy?.();
    }
}
