import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import type { CommandDef } from "../proc/types.js";
import { MultiplexApp } from "./MultiplexApp.js";

const DEFS: CommandDef[] = [
    { label: "web", color: "#93c5fd", command: "server -p 3000" },
    { label: "api", color: "#c4b5fd", command: "worker" },
    { label: "queue", color: "#fb7185", command: "queue listen" },
];

let setup: TestRendererSetup | null = null;
let app: MultiplexApp | null = null;

afterEach(async () => {
    if (app) {
        await app.destroy();
        app = null;
    }

    setup?.renderer.destroy();
    setup = null;
});

async function boot(): Promise<{ setup: TestRendererSetup; app: MultiplexApp }> {
    const fresh = await createTestRenderer({
        width: 100,
        height: 30,
        useThread: false,
        maxFps: Number.POSITIVE_INFINITY,
        exitOnCtrlC: false,
    } as any);
    setup = fresh;
    const created = await MultiplexApp.create(
        {
            commandDefs: DEFS,
            cwd: "/tmp/dev",
            fake: true,
            fakeIntervalMs: 3600000,
            terminal: { cols: 100, rows: 30 },
        },
        { renderer: fresh.renderer },
    );
    app = created;
    // Freeze the fake generator: tests ingest deterministically instead.
    (created as any).fake?.stop();

    for (let i = 0; i < 100; i++) {
        created.ingestLine(i % 3, `line ${i} from proc${i % 3}`);
    }

    await fresh.flush();

    return { setup: fresh, app: created };
}

describe("multiplex app integration (TestRenderer)", () => {
    test("boots with sidebar tabs, selected command and tail output", async () => {
        const { setup } = await boot();
        const frame = setup.captureCharFrame();

        expect(frame).toContain("web");
        expect(frame).toContain("api");
        expect(frame).toContain("queue");
        expect(frame).toContain("server -p 3000");
        // Bottom-pinned: the tail shows, the head does not.
        expect(frame).toContain("line 99 from proc0");
        expect(frame).not.toContain("line 0 from proc0");
        expect(frame).toContain("/ search");
    });

    test("digit key switches tabs and refreshes content", async () => {
        const { setup, app } = await boot();

        await setup.mockInput.pressKeys(["2"]);
        await setup.flush();

        expect(app.selectedIndex).toBe(1);
        const frame = setup.captureCharFrame();

        expect(frame).toContain("worker");
        expect(frame).toContain("line 97 from proc1");
        expect(frame).not.toContain("line 99 from proc0");
    });

    test("slash opens search and typing narrows to matches", async () => {
        const { setup, app } = await boot();

        await setup.mockInput.pressKeys(["/"]);
        await setup.flush();
        expect(app.searchInputMode).toBe(true);

        await setup.mockInput.pressKeys(["l", "i", "n", "e", " ", "2"]);
        await setup.flush();

        expect(app.searchQuery).toBe("line 2");
        const frame = setup.captureCharFrame();

        expect(frame).toContain("line 2");
        expect(frame).toContain("match");

        await setup.mockInput.pressEscape();
        await setup.flush();
        expect(app.searchInputMode).toBe(false);
        expect(app.searchQuery).toBe("");
    });

    test("ansi colors render as text without escape fragments", async () => {
        const { setup, app } = await boot();
        const ESC = String.fromCharCode(27);

        app.ingestLine(0, `${ESC}[31mred problem${ESC}[0m fixed`);
        await setup.flush();

        const frame = setup.captureCharFrame();

        expect(frame).toContain("red problem");
        expect(frame).toContain("fixed");
        expect(frame).not.toContain("[31m");
        expect(frame).not.toContain("[0m");
    });

    test("first Ctrl+C copies the freshest line and toasts, second quits", async () => {
        const { setup, app } = await boot();
        let copied: string | null = null;
        (app as any).injectedWrite = async (text: string) => {
            copied = text;
            return true;
        };
        let exited = 0;
        app.onRequestExit = () => {
            exited++;
        };

        await setup.mockInput.pressCtrlC();
        await setup.flush();
        await new Promise((r) => setTimeout(r, 30));
        await setup.flush();

        expect(exited).toBe(0);
        expect(copied ?? "").toContain("line 99 from proc0");
        expect(setup.captureCharFrame()).toContain("copied 1 row");

        await setup.mockInput.pressCtrlC();
        await setup.flush();

        expect(exited).toBe(1);
    });

    test("s switches to stream mode and t switches back", async () => {
        const { setup, app } = await boot();

        await setup.mockInput.pressKeys(["s"]);
        await setup.flush();
        expect(app.streamMode).toBe(true);

        const streamFrame = setup.captureCharFrame();

        expect(streamFrame).toContain("t tabs");
        expect(streamFrame).not.toContain("1 server");

        await setup.mockInput.pressKeys(["t"]);
        await setup.flush();
        expect(app.streamMode).toBe(false);
        expect(setup.captureCharFrame()).toContain("server -p 3000");
    });

    test("j/k scroll and G re-pins to the bottom", async () => {
        const { setup, app } = await boot();

        // Sidebar owns focus first in tabs mode? default focus is content:
        // j scrolls the pane up off the pin.
        await setup.mockInput.pressKeys(["k"]);
        await setup.flush();
        expect(app.scroll.offset).not.toBe(null);

        await setup.mockInput.pressKeys(["G"]);
        await setup.flush();
        expect(app.scroll.offset).toBe(null);
    });

    test("? toggles help and T toggles the theme", async () => {
        const { setup } = await boot();

        await setup.mockInput.pressKeys(["?"]);
        await setup.flush();
        expect(setup.captureCharFrame()).toContain("dev-tui");

        await setup.mockInput.pressEscape();
        await setup.flush();

        await setup.mockInput.pressKeys(["T"]);
        await setup.flush();
        expect(setup.captureCharFrame()).toContain("web");
    });

    test("f opens the filter row and digits hide a process", async () => {
        const { setup, app } = await boot();

        await setup.mockInput.pressKeys(["s"]);
        await setup.flush();
        await setup.mockInput.pressKeys(["f"]);
        await setup.flush();
        expect(app.filterMode).toBe(true);
        expect(setup.captureCharFrame()).toContain("filter:");

        await setup.mockInput.pressKeys(["3"]);
        await setup.flush();
        expect(app.hiddenProcs.has(2)).toBe(true);

        await setup.mockInput.pressKeys(["f"]);
        await setup.flush();
        expect(app.filterMode).toBe(false);
    });
});
