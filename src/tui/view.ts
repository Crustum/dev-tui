import stringWidth from "string-width";
import type { CommandDef, StreamLine } from "../proc/types.js";
import { stripAnsi } from "../proc/search.js";
import { formatStreamContinuation, formatStreamLabel, wrapLine } from "../proc/util.js";
import { procColor } from "./procColors.js";

/**
 * Pure view helpers for the tabbed/stream panes. No renderer import so the
 * scroll, search-window and footer math stays unit-testable. Mirrors the
 * `useMemo` blocks in multiplex `app.tsx`.
 */

/** Visible cell width (ANSI escapes contribute no cells). */
export function cellWidth(text: string): number {
    return stringWidth(stripAnsi(text));
}

/**
 * Pad a (possibly ANSI-styled) row to the full pane width. Reused
 * TextRenderables do not blank leftover cells when shorter content replaces
 * longer content, so every row must overwrite its whole width — otherwise
 * wrapped lines clash and `clear` leaves characters behind.
 */
export function padCells(text: string, width: number): string {
    const missing = width - cellWidth(text);

    return missing > 0 ? `${text}${" ".repeat(missing)}` : text;
}

/**
 * Tabbed pane: committed rows plus the still-raw pending tail. An empty tail
 * contributes no row: unlike multiplex (which keeps a blank row for a
 * trailing newline), a permanently blank bottom row reads as dead space.
 * A non-empty tail (partial line, progress bar) still renders, wrapped.
 */
export function buildTabLines(rows: string[], pending: string, wrapWidth: number): string[] {
    if (pending === "") {
        return rows.slice();
    }

    return rows.concat(wrapLine(pending, wrapWidth));
}

/** Stream pane: every line labeled, wrapped continuations indented, hidden filtered out. */
export function buildStreamLines(
    stream: StreamLine[],
    hidden: Set<number>,
    commandDefs: CommandDef[],
    maxLabelLen: number,
    themeName = "dark",
): string[] {
    const out: string[] = [];

    for (const sl of stream) {
        if (hidden.has(sl.cmdIndex)) {
            continue;
        }

        const cmd = commandDefs[sl.cmdIndex];

        if (!cmd) {
            continue;
        }

        const prefix = sl.cont
            ? formatStreamContinuation(maxLabelLen, true)
            : formatStreamLabel(cmd.label, procColor(cmd.color, themeName), maxLabelLen, true);

        out.push(`${sl.ts}${prefix}${sl.text}`);
    }

    return out;
}

export interface WindowInput {
    total: number;
    outputHeight: number;
    searchQuery: string;
    searchInputMode: boolean;
    matchCount: number;
    effectiveMatch: number;
    lineOf: number[];
    scrollOffset: number | null;
}

/**
 * First visible row. An active (confirmed) search centers the current match;
 * while typing, or with no matches, the tail shows; otherwise manual scroll
 * wins and null means bottom-pinned.
 */
export function computeWindowStart(input: WindowInput): number {
    const { total, outputHeight, searchQuery, searchInputMode, matchCount, effectiveMatch, lineOf, scrollOffset } =
        input;

    if (searchQuery !== "") {
        if (searchInputMode || matchCount === 0) {
            return Math.max(0, total - outputHeight);
        }

        const targetLine = lineOf[effectiveMatch] ?? 0;
        const halfWindow = Math.floor(outputHeight / 2);
        const maxStart = Math.max(0, total - outputHeight);

        return Math.max(0, Math.min(targetLine - halfWindow, maxStart));
    }

    return scrollOffset ?? Math.max(0, total - outputHeight);
}

/** Clamp the confirmed match cursor into the match count. */
export function effectiveMatchIndex(currentMatch: number, matchCount: number): number {
    if (matchCount <= 0) {
        return 0;
    }

    return ((currentMatch % matchCount) + matchCount) % matchCount;
}

/** Pad a window with blank rows so the pane keeps a stable height. */
export function padWindow(lines: string[], outputHeight: number): string[] {
    const out = lines.slice();

    while (out.length < outputHeight) {
        out.push("");
    }

    return out;
}

export type FooterMode = "stream" | "sidebar" | "content";

/** Footer key hints per mode/focus (multiplex `resolveFooter` parity). */
export function footerBindings(mode: FooterMode): Array<[string, string]> {
    if (mode === "stream") {
        return [
            ["↑/↓", "scroll"],
            ["f", "filter"],
            ["c", "clear"],
            ["/", "search"],
            ["t", "tabs"],
            ["q", "quit"],
        ];
    }

    if (mode === "sidebar") {
        return [
            ["↑/↓", "navigate"],
            ["tab", "logs"],
            ["r", "restart"],
            ["c", "clear"],
            ["/", "search"],
            ["s", "stream"],
            ["q", "quit"],
        ];
    }

    return [
        ["↑/↓", "scroll"],
        ["tab", "tabs"],
        ["c", "clear"],
        ["/", "search"],
        ["s", "stream"],
        ["q", "quit"],
    ];
}

/** One-line footer text: `key desc` pairs plus the filtered/new-output flags. */
export function footerText(
    mode: FooterMode,
    hiddenCount: number,
    hasNewOutput: boolean,
): string {
    const hints = footerBindings(mode)
        .map(([k, desc]) => `${k} ${desc}`)
        .join("   ");
    const flags = [
        hiddenCount > 0 ? "◆ filtered" : "",
        hasNewOutput ? "↓ new output" : "",
    ].filter(Boolean);

    return flags.length > 0 ? `${hints}   ${flags.join(" ")}` : hints;
}
