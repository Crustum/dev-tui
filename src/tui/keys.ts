/** Keybinding table. Pure (no renderer import) so it stays unit-testable. */

export type DevAction =
    | "select:1"
    | "select:2"
    | "select:3"
    | "select:4"
    | "select:5"
    | "select:6"
    | "select:7"
    | "select:8"
    | "select:9"
    | "mode:stream"
    | "mode:tabs"
    | "focus:toggle"
    | "focus:sidebar"
    | "focus:content"
    | "restart"
    | "clear"
    | "search:open"
    | "search:confirm"
    | "search:cancel"
    | "search:next"
    | "search:prev"
    | "search:type"
    | "search:edit"
    | "filter:open"
    | "filter:close"
    | "filter:toggle:1"
    | "filter:toggle:2"
    | "filter:toggle:3"
    | "filter:toggle:4"
    | "filter:toggle:5"
    | "filter:toggle:6"
    | "filter:toggle:7"
    | "filter:toggle:8"
    | "filter:toggle:9"
    | "scroll:up"
    | "scroll:down"
    | "scroll:pageup"
    | "scroll:pagedown"
    | "scroll:top"
    | "scroll:bottom"
    | "theme:toggle"
    | "help"
    | "quit"
    | "quit:press";

export interface KeyInfo {
    name?: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
}

/**
 * Shift+letter pressed: real terminals report a lowercase `name` with the
 * `shift` flag (the legacy parser lowercases it; `sequence` keeps the raw
 * char), while test mocks report an uppercase `name`. Accept all three forms
 * so Shift pairs never collapse onto their lowercase action.
 */
export function isShifted(key: KeyInfo, letter: string): boolean {
    if (key.name === letter) {
        return true;
    }

    if (key.name !== letter.toLowerCase()) {
        return false;
    }

    if (key.shift === true) {
        return true;
    }

    return key.sequence === letter;
}

export interface KeyContext {
    /** Typing into the `/` search prompt (printables go to the query). */
    searchInput: boolean;
    /** Picking hidden processes in the `f` filter row. */
    filterOpen: boolean;
    /** An active (confirmed) search query for n/N/Esc. */
    hasQuery: boolean;
    /** Tabbed TUI (false = stream mode; s/t/f/r only make sense per mode). */
    streamMode: boolean;
}

/** Printable character for the search prompt, or null. */
function printableChar(key: KeyInfo): string | null {
    if (key.ctrl || key.meta) {
        return null;
    }

    const seq = key.sequence;

    if (seq && seq.length === 1 && seq.charCodeAt(0) >= 32) {
        return seq;
    }

    return null;
}

export interface DevKeypress extends KeyInfo {
    /** Filled by the caller for search:type (the typed character). */
    char?: string;
}

/**
 * Map a keypress to an action. Returns null when the key does nothing in the
 * current context (the caller then ignores it so typing never quits).
 */
export function keyToAction(key: KeyInfo, ctx: KeyContext): DevAction | null {
    const name = key.name ?? "";

    if (ctx.searchInput) {
        if (name === "escape") {
            return "search:cancel";
        }

        if (name === "return" || name === "enter") {
            return "search:confirm";
        }

        if (name === "backspace" || name === "delete") {
            return "search:edit";
        }

        if (printableChar(key) !== null) {
            return "search:type";
        }

        return null;
    }

    if (ctx.filterOpen) {
        if (name === "escape" || name === "f") {
            return "filter:close";
        }

        if (name >= "1" && name <= "9") {
            return `filter:toggle:${name}` as DevAction;
        }

        return null;
    }

    if (name === "q") {
        return "quit";
    }

    // First Ctrl+C copies + toasts, double Ctrl+C quits (log-tui pattern):
    // the renderer must not exit natively (exitOnCtrlC: false in App).
    if (name === "c" && key.ctrl) {
        return "quit:press";
    }

    if (name === "?" || (name === "h" && key.ctrl)) {
        return "help";
    }

    // Shift+T toggles the theme (checked before the mode toggle: real
    // terminals lowercase the name and set the shift flag instead).
    if (isShifted(key, "T")) {
        return "theme:toggle";
    }

    if (name >= "1" && name <= "9") {
        return `select:${name}` as DevAction;
    }

    if (name === "tab") {
        return "focus:toggle";
    }

    if (name === "left") {
        return "focus:sidebar";
    }

    if (name === "right") {
        return "focus:content";
    }

    if (name === "up" || name === "k") {
        return "scroll:up";
    }

    if (name === "down" || name === "j") {
        return "scroll:down";
    }

    if (name === "pageup") {
        return "scroll:pageup";
    }

    if (name === "pagedown") {
        return "scroll:pagedown";
    }

    if (isShifted(key, "G") || name === "end") {
        return "scroll:bottom";
    }

    if (name === "g" || name === "home") {
        return "scroll:top";
    }

    if (name === "/") {
        return "search:open";
    }

    if (ctx.hasQuery) {
        if (name === "escape") {
            return "search:cancel";
        }

        if (isShifted(key, "N")) {
            return "search:prev";
        }

        if (name === "n") {
            return "search:next";
        }
    }

    if (name === "c") {
        return "clear";
    }

    if (name === "r" && !ctx.streamMode) {
        return "restart";
    }

    if (name === "s" && !ctx.streamMode) {
        return "mode:stream";
    }

    if (name === "t" && ctx.streamMode) {
        return "mode:tabs";
    }

    if (name === "f" && ctx.streamMode) {
        return "filter:open";
    }

    // Some terminals report "/" as sequence with empty name.
    if (key.sequence === "/" && !name) {
        return "search:open";
    }

    return null;
}

export interface HelpItem {
    keys: string;
    desc: string;
}

export interface HelpSection {
    title: string;
    items: HelpItem[];
}

/** Grouped help for the modal (hotkeys highlighted, one row per hotkey). */
export const HELP_SECTIONS: readonly HelpSection[] = [
    {
        title: "tabs",
        items: [
            { keys: "1-9", desc: "switch to tab by number" },
            { keys: "Tab", desc: "focus sidebar or logs" },
            { keys: "←/→", desc: "focus sidebar / logs" },
        ],
    },
    {
        title: "scroll",
        items: [
            { keys: "↑↓ j/k", desc: "navigate tabs / scroll logs" },
            { keys: "PgUp PgDn", desc: "scroll one page" },
            { keys: "g G", desc: "jump to top / bottom" },
        ],
    },
    {
        title: "view",
        items: [
            { keys: "s t", desc: "stream mode / back to tabs" },
            { keys: "T", desc: "switch dark / light theme" },
            { keys: "click", desc: "select tab, focus pane" },
            { keys: "wheel", desc: "scroll the logs" },
        ],
    },
    {
        title: "search",
        items: [
            { keys: "/", desc: "search output" },
            { keys: "Enter", desc: "confirm the search" },
            { keys: "Esc", desc: "clear the search" },
            { keys: "n N", desc: "next / previous match" },
        ],
    },
    {
        title: "app",
        items: [
            { keys: "f", desc: "filter processes (stream)" },
            { keys: "c", desc: "clear current output" },
            { keys: "r", desc: "restart current process" },
            { keys: "?", desc: "open this help" },
            { keys: "q ^C", desc: "quit" },
        ],
    },
] as const;

export const HELP_LINES: readonly string[] = [
    "1-9 tabs  Tab focus sidebar/logs  ←/→ focus  ↑↓ j/k navigate/scroll",
    "PgUp/PgDn page  g/G top/bottom  s stream  t tabs  T theme",
    "/ search  Enter confirm  Esc clear  n/N next/prev match",
    "f filter (stream)  c clear  r restart  ? help  q quit  click select  wheel scroll",
] as const;
