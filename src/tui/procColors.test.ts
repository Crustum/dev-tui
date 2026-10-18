import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROC_COLORS_DARK, PROC_COLORS_LIGHT, procColor } from "./procColors.js";

describe("procColor", () => {
    it("passes everything through on dark", () => {
        assert.equal(procColor("#93c5fd", "dark"), "#93c5fd");
        assert.equal(procColor("red", "dark"), "red");
        assert.equal(procColor("#93c5fd"), "#93c5fd");
    });

    it("maps each dark palette slot to its light shade", () => {
        for (let i = 0; i < PROC_COLORS_DARK.length; i++) {
            assert.equal(procColor(PROC_COLORS_DARK[i] ?? "", "light"), PROC_COLORS_LIGHT[i]);
        }
    });

    it("matches palette slots case-insensitively", () => {
        assert.equal(procColor("#93C5FD", "light"), "#1d4ed8");
    });

    it("leaves named colors and custom hex untouched on light", () => {
        assert.equal(procColor("red", "light"), "red");
        assert.equal(procColor("#ff6347", "light"), "#ff6347");
    });
});
