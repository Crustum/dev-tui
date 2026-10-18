/**
 * Chrome theme (borders, hints, fills). Values match log-tui's
 * `format/themes/*.json` so both TUIs look like one family; process colors
 * stay multiplex-owned (see `procColors.ts` for their light-mode mapping).
 */

export interface DevTheme {
    name: string;
    background: string;
    panel: string;
    border: string;
    text: string;
    dim: string;
    accent: string;
    focus: string;
    /** Failure red: softRed on dark, deepRed on light (log-tui parity). */
    danger: string;
}

const DARK: DevTheme = {
    name: "dark",
    background: "#09090b",
    panel: "#18181b",
    border: "#333333",
    text: "#d4d4d8",
    dim: "#a1a1aa",
    accent: "#e5c07b",
    focus: "#93c5fd",
    danger: "#ef4444",
};

const LIGHT: DevTheme = {
    name: "light",
    background: "#f8fafc",
    panel: "#e2e8f0",
    border: "#94a3b8",
    text: "#0f172a",
    dim: "#475569",
    accent: "#b45309",
    focus: "#2563eb",
    danger: "#991b1b",
};

export const THEMES: Record<string, DevTheme> = { dark: DARK, light: LIGHT } as const;

let current: DevTheme = DARK;

export function getTheme(): DevTheme {
    return current;
}

export function setTheme(name: string): DevTheme {
    current = THEMES[name.toLowerCase()] ?? DARK;

    return current;
}

export function toggleTheme(): DevTheme {
    current = current.name === "dark" ? LIGHT : DARK;

    return current;
}
