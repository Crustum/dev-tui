import { BoxRenderable, StyledText, TextRenderable, fg } from "@opentui/core";
import { ansiToChunks } from "../tui/ansi.js";
import { getTheme } from "../tui/theme.js";
import { padCells } from "../tui/view.js";
import { detach } from "./detach.js";
import { thumbRange } from "./scrollbar.js";

/**
 * Output pane: renders the visible window only (never the whole buffer —
 * highlighting everything was the quadratic trap multiplex documents).
 * One TextRenderable per visible row plus a multiplex-style thumb column.
 * Takes the FULL line list with the true window offset (log-tui parity):
 * the thumb tracks the real scroll position, not the window it draws.
 */
export class OutputPane {
    private box: BoxRenderable;
    private rows: TextRenderable[] = [];

    constructor(
        private renderer: any,
        parent: { add: (child: any) => void },
    ) {
        this.box = new BoxRenderable(renderer, {
            id: "dev-output",
            flexDirection: "column",
            // No flexGrow: the box hugs exactly `height` rows. Growing it
            // stretches painted slack rows with thumbs under the tail;
            // multiplex leaves that space blank inside the pane instead.
            backgroundColor: getTheme().background,
        } as any);
        parent.add(this.box as any);
    }

    /**
     * Render the window. Every row is padded to `rowWidth` cells so shorter
     * content overwrites longer content in the reused TextRenderables (no
     * leftover characters) and the thumb column sits at the right edge.
     * `highlight` maps a raw line to its displayed form (search highlight);
     * ANSI parsing and padding happen here, after highlighting.
     */
    render(
        lines: string[],
        windowStart: number,
        height: number,
        rowWidth: number,
        highlight: (line: string, absoluteIndex: number) => string = (line) => line,
    ): void {
        const theme = getTheme();

        this.box.backgroundColor = theme.background;

        const total = lines.length;
        const start = Math.max(0, Math.min(windowStart, Math.max(0, total - height)));
        const thumb = thumbRange(total, height, start);

        while (this.rows.length < height) {
            const row = new TextRenderable(this.renderer, {
                id: `dev-line-${this.rows.length}`,
                height: 1,
                // Never wrap: the default "word" mode spills an overlong row
                // into the next row's slot and cascades the whole pane into
                // spliced fragments. Rows are pre-wrapped; clip the excess.
                wrapMode: "none",
            } as any);
            (this.box as any).add(row as any);
            this.rows.push(row);
        }

        while (this.rows.length > height) {
            const row = this.rows.pop();

            if (row) {
                detach(this.box, row);
                row.destroy();
            }
        }

        for (let i = 0; i < height; i++) {
            const row = this.rows[i];

            if (!row) {
                continue;
            }

            // Lines carry raw SGR from the child process: highlight first,
            // then parse to styled chunks, so no escape byte ever reaches
            // the TextRenderable (interpolating raw ANSI renders fragments).
            // Padding is measured in cells (ANSI-aware), keeping the thumb
            // at the right edge and overwriting stale cells on clear.
            const line = highlight(lines[start + i] ?? "", start + i);
            const inThumb = thumb.show && i >= thumb.start && i < thumb.end;
            const glyph = inThumb ? "┃" : "│";
            const glyphColor = inThumb ? theme.dim : theme.border;
            const padded = line === "" ? padCells(" ", rowWidth - 2) : padCells(line, rowWidth - 2);

            // Unstyled spans inherit the theme text color (log-tui parity):
            // the terminal default fg stays white on a light pane.
            row.content = new StyledText([...ansiToChunks(padded, theme.text), fg(glyphColor)(` ${glyph}`)]);
        }
    }

    destroy(): void {
        for (const row of this.rows.splice(0)) {
            detach(this.box, row);
            row.destroy();
        }

        detach((this.box as any).parent, this.box);

        (this.box as any).destroyRecursively?.() ?? (this.box as any).destroy?.();
    }
}
