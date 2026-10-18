import { StyledText, bg, bold, dim, fg, italic, reverse, strikethrough, underline } from "@opentui/core";

/**
 * ANSI → styled chunks. Process output carries real SGR colors (and, from
 * watchers/build tools, cursor-movement sequences that would corrupt a
 * fullscreen TUI if passed through). Raw escape bytes must never reach a
 * TextRenderable: every line is parsed here into styled chunks, SGR becomes
 * chunk styles, and anything that is not SGR styling is stripped.
 */

export interface ActiveStyle {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    reverse?: boolean;
}

// xterm defaults (same source as proc/color NAME_RGB, kept in sync).
const FG_30: Record<number, string> = {
    30: "#000000",
    31: "#cd0000",
    32: "#00cd00",
    33: "#cdcd00",
    34: "#0000ee",
    35: "#cd00cd",
    36: "#00cdcd",
    37: "#e5e5e5",
};

const FG_90: Record<number, string> = {
    90: "#7f7f7f",
    91: "#ff0000",
    92: "#00ff00",
    93: "#ffff00",
    94: "#5c5cff",
    95: "#ff00ff",
    96: "#00ffff",
    97: "#ffffff",
};

const BG_40: Record<number, string> = {
    40: "#000000",
    41: "#cd0000",
    42: "#00cd00",
    43: "#cdcd00",
    44: "#0000ee",
    45: "#cd00cd",
    46: "#00cdcd",
    47: "#e5e5e5",
};

const BG_100: Record<number, string> = {
    100: "#7f7f7f",
    101: "#ff0000",
    102: "#00ff00",
    103: "#ffff00",
    104: "#5c5cff",
    105: "#ff00ff",
    106: "#00ffff",
    107: "#ffffff",
};

const CUBE = ["00", "5f", "87", "af", "d7", "ff"] as const;

function palette256(n: number): string {
    if (!Number.isInteger(n) || n < 0 || n > 255) {
        return "#ffffff";
    }

    if (n < 8) {
        return FG_30[30 + n] ?? "#ffffff";
    }

    if (n < 16) {
        return FG_90[90 + (n - 8)] ?? "#ffffff";
    }

    if (n < 232) {
        const v = n - 16;
        const r = CUBE[Math.floor(v / 36)] ?? "00";
        const g = CUBE[Math.floor((v % 36) / 6)] ?? "00";
        const b = CUBE[v % 6] ?? "00";

        return `#${r}${g}${b}`;
    }

    const gray = (8 + (n - 232) * 10).toString(16).padStart(2, "0");

    return `#${gray}${gray}${gray}`;
}

function hexByte(n: number): string {
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

const blankStyle = (): ActiveStyle => ({});

function isBlankStyle(style: ActiveStyle): boolean {
    return (
        style.fg === undefined &&
        style.bg === undefined &&
        style.bold === undefined &&
        style.dim === undefined &&
        style.italic === undefined &&
        style.underline === undefined &&
        style.strikethrough === undefined &&
        style.reverse === undefined
    );
}

/**
 * Apply one SGR parameter list to the active style. Extended colors
 * (`38;5;n`, `38;2;r;g;b`, same for `48`) consume their sub-params; unknown
 * codes are ignored so a novel sequence degrades to current styling rather
 * than visible garbage.
 */
export function applySgr(style: ActiveStyle, params: number[]): ActiveStyle {
    if (params.length === 0) {
        return blankStyle();
    }

    const next: ActiveStyle = { ...style };

    for (let i = 0; i < params.length; i++) {
        const p = params[i] ?? 0;

        if (p === 0) {
            return blankStyle();
        } else if (p === 1) {
            next.bold = true;
        } else if (p === 2) {
            next.dim = true;
        } else if (p === 3) {
            next.italic = true;
        } else if (p === 4) {
            next.underline = true;
        } else if (p === 7) {
            next.reverse = true;
        } else if (p === 9) {
            next.strikethrough = true;
        } else if (p === 22) {
            next.bold = undefined;
            next.dim = undefined;
        } else if (p === 23) {
            next.italic = undefined;
        } else if (p === 24) {
            next.underline = undefined;
        } else if (p === 27) {
            next.reverse = undefined;
        } else if (p === 29) {
            next.strikethrough = undefined;
        } else if (p === 39) {
            next.fg = undefined;
        } else if (p === 49) {
            next.bg = undefined;
        } else if (FG_30[p] !== undefined) {
            next.fg = FG_30[p];
        } else if (FG_90[p] !== undefined) {
            next.fg = FG_90[p];
        } else if (BG_40[p] !== undefined) {
            next.bg = BG_40[p];
        } else if (BG_100[p] !== undefined) {
            next.bg = BG_100[p];
        } else if (p === 38 || p === 48) {
            const isFg = p === 38;
            const mode = params[i + 1] ?? -1;

            if (mode === 5 && params[i + 2] !== undefined) {
                const color = palette256(params[i + 2] ?? 7);

                if (isFg) {
                    next.fg = color;
                } else {
                    next.bg = color;
                }

                i += 2;
            } else if (
                mode === 2 &&
                params[i + 2] !== undefined &&
                params[i + 3] !== undefined &&
                params[i + 4] !== undefined
            ) {
                const color = `#${hexByte(params[i + 2] ?? 0)}${hexByte(params[i + 3] ?? 0)}${hexByte(params[i + 4] ?? 0)}`;

                if (isFg) {
                    next.fg = color;
                } else {
                    next.bg = color;
                }

                i += 4;
            }
        }
    }

    return next;
}

export type AnsiChunk = ReturnType<ReturnType<typeof fg>>;

/** One span with the active style (unstyled spans are bare text chunks). */
function styleSpan(text: string, style: ActiveStyle): AnsiChunk[] {
    if (isBlankStyle(style)) {
        // TextChunk shape ({__isChunk, text, attributes}); the brand is a
        // type-level unique symbol, a plain string key at runtime.
        return [{ __isChunk: true, text, attributes: 0 } as unknown as AnsiChunk];
    }

    return [styleChunk(text, style)];
}

function styleChunk(text: string, style: ActiveStyle): AnsiChunk {
    let chunk: unknown = text;

    if (style.fg !== undefined) {
        chunk = fg(style.fg)(chunk as string);
    }

    if (style.bg !== undefined) {
        chunk = bg(style.bg)(chunk as string);
    }

    if (style.bold === true) {
        chunk = bold(chunk as string);
    }

    if (style.dim === true) {
        chunk = dim(chunk as string);
    }

    if (style.italic === true) {
        chunk = italic(chunk as string);
    }

    if (style.underline === true) {
        chunk = underline(chunk as string);
    }

    if (style.strikethrough === true) {
        chunk = strikethrough(chunk as string);
    }

    if (style.reverse === true) {
        chunk = reverse(chunk as string);
    }

    return chunk as AnsiChunk;
}

// CSI sequences that are not SGR (cursor moves, erases, scrolls, show/hide)
// carry no text — drop them. OSC sequences (titles, hyperlinks) likewise.
const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const STRAY = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g; // never 0x1B (ESC)
const SGR = /\x1b\[([0-9;]*)m/g;

/** True when the line carries no escape byte at all (fast path: skip parsing). */
export function isPlainLine(line: string): boolean {
    return line.indexOf(String.fromCharCode(27)) === -1;
}

/**
 * Parse one output line into styled chunks. The returned chunks contain no
 * escape bytes: SGR becomes chunk styles, everything else is stripped, and
 * plain text passes through untouched (same spans, same order).
 *
 * `baseFg` is the default foreground (log-tui `fg(theme.text)` parity):
 * spans without an explicit color — including plain lines with no escapes
 * at all and text after a reset — inherit it instead of the terminal's
 * default fg, which is unreadable on the opposite theme's pane.
 */
export function ansiToChunks(line: string, baseFg?: string): AnsiChunk[] {
    const cleaned = line.replace(OSC, "").replace(STRAY, "");
    const chunks: AnsiChunk[] = [];
    // "Default foreground" (SGR 39 / reset) means the base, not blank.
    const withBase = (style: ActiveStyle): ActiveStyle =>
        baseFg !== undefined && style.fg === undefined ? { ...style, fg: baseFg } : style;
    let style = withBase(blankStyle());
    let pos = 0;

    SGR.lastIndex = 0;

    let match: RegExpExecArray | null = null;

    while ((match = SGR.exec(cleaned)) !== null) {
        const at = match.index ?? 0;
        // Non-SGR CSI hiding between SGRs is dropped with the span.
        const span = cleaned.slice(pos, at).replace(CSI, "");

        if (span !== "") {
            chunks.push(...styleSpan(span, style));
        }

        const params = match[1] === "" ? [] : (match[1] ?? "").split(";").map(Number);

        style = withBase(applySgr(style, params));
        pos = at + match[0].length;
    }

    const tail = cleaned.slice(pos).replace(CSI, "");

    if (tail !== "") {
        chunks.push(...styleSpan(tail, style));
    }

    return chunks;
}

/** StyledText form of {@link ansiToChunks}. */
export function ansiToStyledText(line: string, baseFg?: string): StyledText {
    return new StyledText(ansiToChunks(line, baseFg));
}
