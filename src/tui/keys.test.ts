import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isShifted, keyToAction, type KeyContext } from "./keys.js";

const TABS: KeyContext = { searchInput: false, filterOpen: false, hasQuery: false, streamMode: false };
const STREAM: KeyContext = { searchInput: false, filterOpen: false, hasQuery: false, streamMode: true };

describe("keyToAction", () => {
    it("maps digits to tab selection in both modes", () => {
        assert.equal(keyToAction({ name: "1" }, TABS), "select:1");
        assert.equal(keyToAction({ name: "9" }, STREAM), "select:9");
    });

    it("gates mode switches on the current mode", () => {
        assert.equal(keyToAction({ name: "s" }, TABS), "mode:stream");
        assert.equal(keyToAction({ name: "s" }, STREAM), null);
        assert.equal(keyToAction({ name: "t" }, STREAM), "mode:tabs");
        assert.equal(keyToAction({ name: "t" }, TABS), null);
        assert.equal(keyToAction({ name: "r" }, TABS), "restart");
        assert.equal(keyToAction({ name: "r" }, STREAM), null);
        assert.equal(keyToAction({ name: "f" }, STREAM), "filter:open");
        assert.equal(keyToAction({ name: "f" }, TABS), null);
    });

    it("keeps Shift+T on the theme and lowercase t on the mode", () => {
        assert.equal(keyToAction({ name: "t", shift: true, sequence: "T" }, STREAM), "theme:toggle");
        assert.equal(keyToAction({ name: "T", sequence: "T" }, TABS), "theme:toggle");
        assert.equal(keyToAction({ name: "c" }, TABS), "clear");
        assert.equal(keyToAction({ name: "c", ctrl: true }, TABS), "quit:press");
    });

    it("gates n/N/Esc on an active query", () => {
        assert.equal(keyToAction({ name: "n" }, TABS), null);
        const withQuery: KeyContext = { ...TABS, hasQuery: true };

        assert.equal(keyToAction({ name: "n" }, withQuery), "search:next");
        assert.equal(keyToAction({ name: "N", sequence: "N" }, withQuery), "search:prev");
        assert.equal(keyToAction({ name: "escape" }, withQuery), "search:cancel");
        assert.equal(keyToAction({ name: "q" }, withQuery), "quit");
    });

    it("types into the search prompt without leaking actions", () => {
        const typing: KeyContext = { ...TABS, searchInput: true };

        assert.equal(keyToAction({ name: "q", sequence: "q" }, typing), "search:type");
        assert.equal(keyToAction({ name: "backspace", sequence: "" }, typing), "search:edit");
        assert.equal(keyToAction({ name: "escape" }, typing), "search:cancel");
        assert.equal(keyToAction({ name: "return" }, typing), "search:confirm");
        assert.equal(keyToAction({ name: "up" }, typing), null);
    });

    it("restricts the filter row to digits and close keys", () => {
        const filtering: KeyContext = { ...STREAM, filterOpen: true };

        assert.equal(keyToAction({ name: "2" }, filtering), "filter:toggle:2");
        assert.equal(keyToAction({ name: "f" }, filtering), "filter:close");
        assert.equal(keyToAction({ name: "escape" }, filtering), "filter:close");
        assert.equal(keyToAction({ name: "q" }, filtering), null);
    });

    it("maps navigation and help", () => {
        assert.equal(keyToAction({ name: "tab" }, TABS), "focus:toggle");
        assert.equal(keyToAction({ name: "left" }, TABS), "focus:sidebar");
        assert.equal(keyToAction({ name: "g" }, TABS), "scroll:top");
        assert.equal(keyToAction({ name: "G", sequence: "G" }, TABS), "scroll:bottom");
        assert.equal(keyToAction({ name: "?" }, TABS), "help");
        assert.equal(keyToAction({ name: "/" }, TABS), "search:open");
    });
});

describe("isShifted", () => {
    it("accepts uppercase names, shift flags and raw sequences", () => {
        assert.equal(isShifted({ name: "T", sequence: "T" }, "T"), true);
        assert.equal(isShifted({ name: "t", shift: true, sequence: "T" }, "T"), true);
        assert.equal(isShifted({ name: "t", sequence: "T" }, "T"), true);
        assert.equal(isShifted({ name: "t", sequence: "t" }, "T"), false);
    });
});
