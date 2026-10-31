import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ProcessBuffers } from "./ProcessBuffers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

let evalId = 0;

function runNode(source: string): string {
    const key = `PROCESS_BUFFERS_TEST_EVAL_${evalId++}`;

    process.env[key] = source;

    return { command: `node src/proc/test-eval.cjs ${key}`, key };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ProcessBuffers", () => {
    it("delivers each process line exactly once to the tab and stream buffers", async () => {
        const { command, key } = runNode("console.log('hello-once');");

        const buffers = new ProcessBuffers({
            commandDefs: [{ label: "a", color: "#93c5fd", command }],
            cwd: root,
            bufferSize: 2000,
            streamBufferSize: 10000,
            timestamps: false,
            autoRestart: false,
            columns: 80,
            onChange: () => {},
        });

        try {
            buffers.start();

            let tabHits: string[] = [];
            let streamHits = 0;

            for (let i = 0; i < 200; i++) {
                tabHits = buffers.outputRows[0]?.filter((r) =>
                    r.includes("hello-once"),
                ) ?? [];
                streamHits = buffers.streamLines.filter((l) =>
                    l.text.includes("hello-once"),
                ).length;

                if (tabHits.length > 0 && streamHits > 0) {
                    break;
                }

                await sleep(50);
            }

            assert.equal(tabHits.length, 1);
            assert.equal(streamHits, 1);
        } finally {
            buffers.stop();
            delete process.env[key];
        }
    });
});
