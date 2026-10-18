/**
 * Scroll position for one output pane. `offset === null` means pinned to the
 * bottom (new output visible); any number is a fixed first-row index with a
 * "new output" flag raised while output keeps arriving. Port of multiplex
 * `use-scroll.ts` as a plain class (no React).
 */
export class ScrollState {
    /** Fixed first-row index, or null when pinned to the bottom. */
    offset: number | null = null;
    hasNewOutput = false;
    totalLines = 0;
    viewport: number;

    constructor(viewport: number) {
        this.viewport = Math.max(0, viewport);
    }

    notifyNewOutput(): void {
        if (this.offset !== null) {
            this.hasNewOutput = true;
        }
    }

    /** First visible row under the current state (bottom-pinned when null). */
    windowStart(): number {
        return this.offset ?? Math.max(0, this.totalLines - this.viewport);
    }

    scrollDown(): void {
        if (this.offset === null) {
            return;
        }

        const maxOffset = Math.max(0, this.totalLines - this.viewport);
        const next = this.offset + 1;

        this.offset = next >= maxOffset ? null : next;

        if (this.offset === null) {
            this.hasNewOutput = false;
        }
    }

    scrollUp(): void {
        const currentStart = this.offset ?? Math.max(0, this.totalLines - this.viewport);

        this.offset = Math.max(0, currentStart - 1);
    }

    pageDown(): void {
        if (this.offset === null) {
            return;
        }

        const maxOffset = Math.max(0, this.totalLines - this.viewport);
        const next = this.offset + this.viewport;

        this.offset = next >= maxOffset ? null : next;

        if (this.offset === null) {
            this.hasNewOutput = false;
        }
    }

    pageUp(): void {
        const currentStart = this.offset ?? Math.max(0, this.totalLines - this.viewport);

        this.offset = Math.max(0, currentStart - this.viewport);
    }

    scrollToTop(): void {
        this.offset = 0;
    }

    scrollToBottom(): void {
        this.offset = null;
        this.hasNewOutput = false;
    }

    resetScroll(): void {
        this.offset = null;
    }
}
