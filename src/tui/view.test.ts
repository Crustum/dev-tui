import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommandDef } from "../proc/types.js";
import {
    buildStreamLines,
    buildTabLines,
    cellWidth,
    computeWindowStart,
    effectiveMatchIndex,
    footerText,
    padCells,
    padWindow,
} from "./view.js";

const DEFS: CommandDef[] = [
    { label: "web", color: "#93c5fd", command: "server" },
    { label: "api", color: "#c4b5fd", command: "worker" },
];

describe("buildTabLines", () => {
    it("appends the wrapped pending tail to committed rows", () => {
        assert.deepEqual(buildTabLines(["a", "b"], "c", 80), ["a", "b", "c"]);
    });

    it("adds no phantom row for an empty tail", () => {
        assert.deepEqual(buildTabLines(["a"], "", 80), ["a"]);
    });
});

describe("buildStreamLines", () => {
    it("labels lines and skips hidden processes", () => {
        const lines = buildStreamLines(
            [
                { cmdIndex: 0, text: "hi", ts: "" },
                { cmdIndex: 1, text: "yo", ts: "" },
                { cmdIndex: 0, text: "wrap", ts: "", cont: true },
            ],
            new Set([1]),
            DEFS,
            3,
        );

        assert.equal(lines.length, 2);
        assert.match(lines[0] ?? "", /web/);
        assert.match(lines[1] ?? "", /wrap/);
        assert.doesNotMatch(lines.join("\n"), /api/);
    });

    it("deepens palette labels on the light theme", () => {
        const dark = buildStreamLines([{ cmdIndex: 0, text: "hi", ts: "" }], new Set(), DEFS, 3, "dark");
        const light = buildStreamLines([{ cmdIndex: 0, text: "hi", ts: "" }], new Set(), DEFS, 3, "light");

        assert.match(dark[0] ?? "", /38;2;147;197;253/);
        assert.match(light[0] ?? "", /38;2;29;78;216/);
    });
});

describe("computeWindowStart", () => {
    it("pins to the tail without a query", () => {
        assert.equal(
            computeWindowStart({
                total: 100,
                outputHeight: 10,
                searchQuery: "",
                searchInputMode: false,
                matchCount: 0,
                effectiveMatch: 0,
                lineOf: [],
                scrollOffset: null,
            }),
            90,
        );
    });

    it("honors a manual scroll offset", () => {
        assert.equal(
            computeWindowStart({
                total: 100,
                outputHeight: 10,
                searchQuery: "",
                searchInputMode: false,
                matchCount: 0,
                effectiveMatch: 0,
                lineOf: [],
                scrollOffset: 12,
            }),
            12,
        );
    });

    it("centers the active match and tails while typing", () => {
        const lineOf = [5, 50, 95];
        const centered = computeWindowStart({
            total: 100,
            outputHeight: 10,
            searchQuery: "x",
            searchInputMode: false,
            matchCount: 3,
            effectiveMatch: 1,
            lineOf,
            scrollOffset: null,
        });

        assert.equal(centered, 45);

        const typing = computeWindowStart({
            total: 100,
            outputHeight: 10,
            searchQuery: "x",
            searchInputMode: true,
            matchCount: 3,
            effectiveMatch: 1,
            lineOf,
            scrollOffset: null,
        });

        assert.equal(typing, 90);
    });
});

describe("effectiveMatchIndex", () => {
    it("wraps the cursor into the match count", () => {
        assert.equal(effectiveMatchIndex(0, 0), 0);
        assert.equal(effectiveMatchIndex(5, 3), 2);
        assert.equal(effectiveMatchIndex(-1, 3), 2);
    });
});

describe("padWindow", () => {
    it("pads short windows with blank rows", () => {
        assert.deepEqual(padWindow(["a"], 3), ["a", "", ""]);
        assert.deepEqual(padWindow(["a", "b", "c", "d"], 2), ["a", "b", "c", "d"]);
    });
});

describe("padCells", () => {
    it("pads to the cell width, ignoring ANSI escapes", () => {
        assert.equal(padCells("ab", 5), "ab   ");
        assert.equal(padCells("\x1b[31mab\x1b[0m", 5), "\x1b[31mab\x1b[0m   ");
        assert.equal(padCells("abcdef", 5), "abcdef");
        assert.equal(cellWidth("\x1b[1mab\x1b[0m"), 2);
    });
});

describe("footerText", () => {
    it("renders mode hints plus state flags", () => {
        const stream = footerText("stream", 0, false);

        assert.match(stream, /t tabs/);
        assert.doesNotMatch(stream, /filtered/);

        const tabs = footerText("sidebar", 1, true);

        assert.match(tabs, /s stream/);
        assert.match(tabs, /◆ filtered/);
        assert.match(tabs, /↓ new output/);
    });
});
