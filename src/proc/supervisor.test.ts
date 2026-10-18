import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
    createSupervisor,
    type FailureReason,
    type OutputStream,
    processGroupAlive,
    type Supervisor,
    taskkillSucceeded,
} from "./supervisor.js";
import type { CommandDef } from "./types.js";

type Line = { label: string; text: string; stream: OutputStream };

type RunResult = {
    lines: Line[];
    exits: { label: string; code: number | null }[];
    failures: { label: string; code: number | null; reason: FailureReason }[];
    restarts: number;
};

// Retry timings are compressed so the exhaustion path costs a fraction of a
// second instead of the ~12s the real 1s uptime guard and 1s delay would need.
const FAST = { minUptimeMs: 50, restartDelayMs: 10, maxRestarts: 5 };

function run(
    commandDefs: CommandDef[],
    { autoRestart = false, fast = false } = {},
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const result: RunResult = {
            lines: [],
            exits: [],
            failures: [],
            restarts: 0,
        };

        const timer = setTimeout(() => {
            supervisor.stop();
            reject(new Error("supervisor never settled"));
        }, 15_000);

        const supervisor = createSupervisor({
            commandDefs,
            cwd: process.cwd(),
            columns: 80,
            autoRestart,
            forceColor: false,
            ...(fast ? FAST : {}),
            handlers: {
                onLine({ index, text, stream }) {
                    result.lines.push({
                        label: commandDefs[index].label,
                        text,
                        stream,
                    });
                },
                onExit({ index, code }) {
                    result.exits.push({
                        label: commandDefs[index].label,
                        code,
                    });
                },
                onFailed({ index, code, reason }) {
                    result.failures.push({
                        label: commandDefs[index].label,
                        code,
                        reason,
                    });
                },
                onRestartScheduled() {
                    result.restarts++;
                },
                onSettled() {
                    clearTimeout(timer);
                    supervisor.stop();
                    resolve(result);
                },
            },
        });

        supervisor.start();
    });
}

const cmd = (label: string, command: string): CommandDef => ({
    label,
    color: "#93c5fd",
    command,
});

const isWindows = process.platform === "win32";

// Test programs ride in on the environment instead of the command line.
// Neither shell the supervisor spawns through can quote them there:
// `sh -c` needs quotes to group `node -e "..."` (bare parens are a syntax
// error under dash), while `cmd.exe /d /s /c` keeps quotes literally
// without grouping by them, so the same quoting arrives broken on Windows.
// `src/proc/test-eval.cjs` keeps the command line to bare words (letters, `/`,
// `.`, `_`, spaces as separators) that both shells pass through untouched,
// and the real program - quotes, semicolons, parentheses and all - travels
// untouched in the variable.
let nodeEvalId = 0;

function runNode(source: string): string {
    const key = `MULTIPLEX_TEST_EVAL_${nodeEvalId++}`;

    process.env[key] = source;

    return `node src/proc/test-eval.cjs ${key}`;
}

describe("taskkillSucceeded", () => {
    it("accepts English and Russian success output, and empty output", () => {
        assert.equal(
            taskkillSucceeded(
                "SUCCESS: The process with PID 1234 has been terminated.",
            ),
            true,
        );
        assert.equal(
            taskkillSucceeded(
                "Успешно: процесс с PID 1234 был завершен.",
            ),
            true,
        );
        assert.equal(taskkillSucceeded(""), true);
    });

    it("rejects refusals and errors in either language", () => {
        assert.equal(
            taskkillSucceeded(
                "ERROR: The process with PID 1234 could not be terminated.",
            ),
            false,
        );
        assert.equal(
            taskkillSucceeded(
                "ОШИБКА: Не удается завершить процесс с PID 1234.",
            ),
            false,
        );
        // Console processes that only die forcefully: the graceful ask
        // failed, so killPid must escalate instead of killing just the
        // wrapper and orphaning the tree below it.
        assert.equal(
            taskkillSucceeded(
                "ERROR: The process with PID 1234 can only be terminated forcefully.",
            ),
            false,
        );
        assert.equal(
            taskkillSucceeded(
                "ОШИБКА: Процесс может быть прерван только насильственно.",
            ),
            false,
        );
        assert.equal(
            taskkillSucceeded(
                "ERROR: The process 1234 not found.",
            ),
            false,
        );
    });
});

describe("createSupervisor", () => {
    it("emits every line of output and settles once all commands exit", async () => {
        const result = await run([
            cmd("a", runNode("console.log('one');console.log('two')")),
            cmd("b", runNode("console.log('three')")),
        ]);

        assert.deepEqual(
            result.lines.map((l) => `${l.label}:${l.text}`).sort(),
            ["a:one", "a:two", "b:three"],
        );
        assert.equal(result.exits.length, 2);
        assert.equal(result.failures.length, 0);
    });

    it("tags stdout and stderr separately", async () => {
        const result = await run([
            cmd(
                "a",
                runNode("console.log('out');console.error('err');console.log('out2')"),
            ),
        ]);

        assert.deepEqual(result.lines.map((l) => [l.stream, l.text]).sort(), [
            ["stderr", "err"],
            ["stdout", "out"],
            ["stdout", "out2"],
        ]);
    });

    // 'exit' arrives before the pipe has been read, so a command that prints
    // and exits immediately used to settle the run with its output still in
    // flight — reliably enough on a loaded CI runner to fail the suite.
    it("delivers output that was still in the pipe when the process exited", async () => {
        const result = await run([
            // String(): a number argument would go through util.inspect, which
            // colorizes when the ambient environment enables colors — this
            // test is about the pipe, not the palette.
            cmd("a", runNode("for(let i=1;i<=2000;i++)console.log(String(i))")),
        ]);

        assert.equal(result.lines.length, 2000);
        assert.equal(result.lines[0].text, "1");
        assert.equal(result.lines[1999].text, "2000");
    });

    // Without this the last line of anything that does not end in a newline —
    // an unterminated error message, a prompt — is lost when the process dies.
    it("flushes a trailing partial line before the exit", async () => {
        const result = await run([
            cmd("a", runNode("process.stdout.write('no newline')")),
        ]);

        assert.deepEqual(
            result.lines.map((l) => l.text),
            ["no newline"],
        );
    });

    it("reports a nonzero exit as a permanent failure when not restarting", async () => {
        const result = await run([cmd("a", "exit 3")]);

        assert.deepEqual(result.exits, [{ label: "a", code: 3 }]);
        assert.deepEqual(result.failures, [
            { label: "a", code: 3, reason: "restart-disabled" },
        ]);
    });

    it("does not report a clean exit as a failure", async () => {
        const result = await run([cmd("a", "exit 0")]);

        assert.deepEqual(result.failures, []);
    });

    // The whole point of the uptime guard: a command that never got off the
    // ground is not going to be fixed by trying it four more times.
    it("does not retry a command that crashes immediately", async () => {
        const result = await run([cmd("a", "exit 1")], { autoRestart: true });

        assert.equal(result.restarts, 0);
        assert.equal(result.exits.length, 1);
        assert.deepEqual(result.failures, [
            { label: "a", code: 1, reason: "crashed-immediately" },
        ]);
    });

    it("retries a command that stayed up first, then gives up after five", async () => {
        const result = await run(
            [cmd("a", runNode("setTimeout(()=>process.exit(1),200)"))],
            {
                autoRestart: true,
                fast: true,
            },
        );

        assert.equal(result.restarts, 5);
        assert.equal(result.exits.length, 6);
        assert.deepEqual(result.failures, [
            { label: "a", code: 1, reason: "attempts-exhausted" },
        ]);
    });

    it("splits lines across chunk boundaries", async () => {
        const result = await run([
            cmd(
                "a",
                runNode("process.stdout.write('start');setTimeout(()=>process.stdout.write('end\\nnext\\n'),200)"),
            ),
        ]);

        assert.deepEqual(
            result.lines.map((l) => l.text),
            ["startend", "next"],
        );
    });
});

/**
 * Waits for the command's process group to empty out.
 *
 * Polls rather than asserting outright, because the thing that outlives the
 * process we spawned is a grandchild: `sh` is reaped by us, its `sleep` is
 * reparented to init and reaped whenever init gets to it. Signal 0 counts a
 * process that has died but not yet been reaped, so checking the instant
 * terminate() returns asks the supervisor to guarantee
 * someone else's bookkeeping. What it does guarantee is that the whole group
 * was signalled, and anything that survived that never goes away, so a real
 * leak still fails here on the timeout. (On Windows the same question goes to
 * the process tree below the spawned pid — see `processGroupAlive`.)
 */
async function groupGone(
    supervisor: Supervisor,
    index: number,
    timeoutMs = 5000,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (groupAlive(supervisor, index)) {
        if (Date.now() > deadline) {
            return false;
        }

        await delay(20);
    }

    return true;
}

/** True while any member of the command's process group is still around. */
function groupAlive(supervisor: Supervisor, index: number): boolean {
    const pid = supervisor.procs[index]?.pid;

    if (!pid) {
        return false;
    }

    return processGroupAlive(pid);
}

/** Starts the commands and waits for each to print the line it starts with. */
async function running(commandDefs: CommandDef[], events: string[] = []) {
    const up = new Set<number>();

    const supervisor = createSupervisor({
        commandDefs,
        cwd: process.cwd(),
        columns: 80,
        autoRestart: false,
        forceColor: false,
        handlers: {
            onLine({ index, text }) {
                if (text === "up") {
                    up.add(index);
                }
            },
            onExit({ index, code, signal }) {
                events.push(
                    `exit:${commandDefs[index].label}:${code}:${signal}`,
                );
            },
            onFailed({ index, reason }) {
                events.push(`failed:${commandDefs[index].label}:${reason}`);
            },
        },
    });

    supervisor.start();

    const deadline = Date.now() + 10_000;

    while (up.size < commandDefs.length && Date.now() < deadline) {
        await delay(20);
    }

    assert.equal(up.size, commandDefs.length, "commands never started");

    return supervisor;
}

describe("supervisor.terminate", () => {
    // The bug this exists for: a dev server cleans up in a SIGTERM handler, and
    // killing it outright leaves the file behind for the next build to trip on.
    // Console processes on Windows cannot receive a graceful SIGTERM at all —
    // taskkill without /F is refused and killPid escalates to /F — so a
    // handler never runs there and this stays POSIX-only.
    it(
        "lets a command run its cleanup handler before it dies",
        {
            skip: isWindows
                ? "graceful SIGTERM cleanup has no Windows equivalent"
                : false,
        },
        async () => {
            const dir = mkdtempSync(join(tmpdir(), "multiplex-"));
            const marker = join(dir, "hot");

            process.env.MULTIPLEX_TEST_MARKER = marker;

            try {
                const supervisor = await running([
                    cmd(
                        "a",
                        runNode(
                            "require('node:fs').writeFileSync(process.env.MULTIPLEX_TEST_MARKER,'x');console.log('up');process.on('SIGTERM',()=>{require('node:fs').rmSync(process.env.MULTIPLEX_TEST_MARKER,{force:true});process.exit(0)});setInterval(()=>{},50)",
                        ),
                    ),
                ]);

                await supervisor.terminate();

                assert.throws(
                    () => readFileSync(marker),
                    "cleanup handler never ran, the file is still there",
                );
                assert.ok(
                    await groupGone(supervisor, 0),
                    "the process group outlived the shutdown",
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    );

    // Wrappers like `npm run` exit on SIGTERM before the server under them has cleaned up.
    // Same platform limitation as above: the cleanup half is POSIX-only.
    it(
        "waits for a wrapped command's cleanup, not just the wrapper",
        {
            skip: isWindows
                ? "graceful SIGTERM cleanup has no Windows equivalent"
                : false,
        },
        async () => {
            const dir = mkdtempSync(join(tmpdir(), "multiplex-"));
            const marker = join(dir, "hot");

            process.env.MULTIPLEX_TEST_MARKER = marker;
            process.env.MULTIPLEX_TEST_WORKER =
                "require('node:fs').writeFileSync(process.env.MULTIPLEX_TEST_MARKER,'x');const t=setInterval(()=>{},50);process.on('SIGTERM',()=>{setTimeout(()=>{require('node:fs').rmSync(process.env.MULTIPLEX_TEST_MARKER,{force:true});process.exit(0)},300)})";

            try {
                const supervisor = await running([
                    cmd(
                        "a",
                        // The wrapper spawns the real work and exits, so the
                        // group the supervisor signalled is already leaderless
                        // — the shell-level `(…) & wait` form this replaces.
                        runNode(
                            "const{spawn:s}=require('node:child_process');s(process.execPath,['-e',process.env.MULTIPLEX_TEST_WORKER],{stdio:'ignore'}).unref();console.log('up')",
                        ),
                    ),
                ]);

                await supervisor.terminate();

                assert.throws(
                    () => readFileSync(marker),
                    "the wrapped command was killed before its cleanup ran",
                );
                assert.ok(
                    await groupGone(supervisor, 0),
                    "the process group outlived the shutdown",
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    );

    // The other half of the bargain: asking nicely cannot mean waiting forever.
    it("kills a command that ignores SIGTERM once the grace period is up", async () => {
        const supervisor = await running([
            cmd(
                "a",
                runNode("process.on('SIGTERM',()=>{});console.log('up');setInterval(()=>{},50)"),
            ),
        ]);

        const start = Date.now();

        await supervisor.terminate(300);

        const elapsed = Date.now() - start;

        assert.ok(
            elapsed >= 250,
            `returned after ${elapsed}ms, before the grace period was up`,
        );
        assert.ok(
            await groupGone(supervisor, 0),
            "the process group outlived the shutdown",
        );
    });

    // The command exits on a signal we sent, which is not the command failing.
    it("does not report the shutdown as a crash", async () => {
        const events: string[] = [];
        const supervisor = await running(
            [cmd("a", runNode("console.log('up');setInterval(()=>{},50)"))],
            events,
        );

        await supervisor.terminate();

        await delay(100);

        assert.deepEqual(events, []);
    });

    // The shell backgrounds the real work, so the process we spawned is not
    // the thing holding the port. Signalling the group/tree catches it, and
    // groupGone fails the test if anything is left behind.
    //
    // The shell-level backgrounding (`(…) &`) has no cmd.exe equivalent, so
    // the descendant is spawned from node instead: it prints up, then idles
    // while its long-lived child holds the group/tree. Killing only the shell
    // would leave both behind. Unlike the wrapper test above, the spawner
    // stays alive here, so the tree is reachable from the spawned pid on both
    // platforms at kill time.
    it("takes down a backgrounded grandchild the shell left behind", async () => {
        const supervisor = await running([
            cmd(
                "a",
                runNode(
                    "const{spawn:s}=require('node:child_process');s(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'}).unref();console.log('up');setInterval(()=>{},60000)",
                ),
            ),
        ]);

        await supervisor.terminate(300);

        assert.ok(
            await groupGone(supervisor, 0),
            "the process group outlived the shutdown",
        );
    });

    // Both front ends call this, and the unmount path fires it without waiting.
    it("is safe to call twice and settles both callers", async () => {
        const supervisor = await running([
            cmd("a", runNode("console.log('up');setInterval(()=>{},50)")),
        ]);

        await Promise.all([supervisor.terminate(), supervisor.terminate()]);

        assert.ok(
            await groupGone(supervisor, 0),
            "the process group outlived the shutdown",
        );
    });

    it("stops a command that is waiting to be auto-restarted", async () => {
        const events: string[] = [];
        const supervisor = createSupervisor({
            commandDefs: [cmd("a", runNode("setTimeout(()=>process.exit(1),200)"))],
            cwd: process.cwd(),
            columns: 80,
            autoRestart: true,
            minUptimeMs: 50,
            restartDelayMs: 200,
            forceColor: false,
            handlers: {
                onRestarted() {
                    events.push("restarted");
                },
            },
        });

        supervisor.start();

        await delay(300);

        await supervisor.terminate();

        await delay(400);

        assert.deepEqual(events, [], "a restart fired after the shutdown");
    });
});
