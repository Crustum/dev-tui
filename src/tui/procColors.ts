/**
 * Per-process display colors. The dark palette is byte-for-byte the
 * multiplex `DEFAULT_COLORS`; pastels wash out on near-white, so light mode
 * uses the same hues one shade deeper (log-tui `tabColors.ts` parity).
 *
 * Mapping is by palette slot: a color equal (case-insensitive) to a dark
 * slot renders as the same slot's light shade. Named colors and custom hex
 * values pass through untouched — names resolve in the user's terminal
 * theme, and custom values are the author's explicit choice.
 */

export const PROC_COLORS_DARK = [
    "#93c5fd",
    "#c4b5fd",
    "#fb7185",
    "#fdba74",
    "#86efac",
    "#fcd34d",
] as const;

export const PROC_COLORS_LIGHT = [
    "#1d4ed8",
    "#7c3aed",
    "#e11d48",
    "#ea580c",
    "#15803d",
    "#b45309",
] as const;

/** Display color for a process color under the named theme. */
export function procColor(color: string, themeName = "dark"): string {
    if (themeName !== "light") {
        return color;
    }

    const slot = PROC_COLORS_DARK.findIndex((c) => c.toLowerCase() === color.toLowerCase());

    if (slot >= 0) {
        return PROC_COLORS_LIGHT[slot] ?? color;
    }

    return color;
}
