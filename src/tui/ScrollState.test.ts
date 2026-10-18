import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ScrollState } from "./ScrollState.js";

describe("ScrollState", () => {
    it("pins to the bottom while offset is null", () => {
        const s = new ScrollState(4);

        s.totalLines = 10;
        assert.equal(s.windowStart(), 6);
        s.scrollDown();
        assert.equal(s.offset, null);
        assert.equal(s.hasNewOutput, false);
    });

    it("scrolls up off the pin and flags new output", () => {
        const s = new ScrollState(4);

        s.totalLines = 10;
        s.scrollUp();
        assert.equal(s.offset, 5);
        assert.equal(s.windowStart(), 5);
        s.notifyNewOutput();
        assert.equal(s.hasNewOutput, true);
    });

    it("scrolling back down re-pins at the bottom", () => {
        const s = new ScrollState(4);

        s.totalLines = 10;
        s.scrollUp();
        s.scrollUp();
        assert.equal(s.offset, 4);
        s.scrollDown();
        s.scrollDown();
        assert.equal(s.offset, null);
        assert.equal(s.hasNewOutput, false);
    });

    it("pages and clamps at both ends", () => {
        const s = new ScrollState(4);

        s.totalLines = 10;
        s.pageUp();
        assert.equal(s.offset, 2);
        s.pageUp();
        assert.equal(s.offset, 0);
        s.scrollToTop();
        assert.equal(s.offset, 0);
        s.scrollToBottom();
        assert.equal(s.offset, null);
        s.pageDown();
        assert.equal(s.offset, null);
    });

    it("never goes negative on short buffers", () => {
        const s = new ScrollState(10);

        s.totalLines = 3;
        assert.equal(s.windowStart(), 0);
        s.scrollUp();
        assert.equal(s.offset, 0);
    });
});
