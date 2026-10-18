import { execSync, spawn } from "node:child_process";
import { createSupervisor, type Supervisor } from "../proc/supervisor.js";
import type { CommandDef, StreamLine, SupervisorRef } from "../proc/types.js";
import {
    childColumns,
    formatTimestamp,
    streamTextWidth,
    systemMsg,
    TIMESTAMP_WIDTH,
    tabbedTextWidth,
    wrapLine,
} from "../proc/util.js";

const hasNotifySend =
    process.platform === "linux" &&
    (() => {
        try {
            execSync("which notify-send", { stdio: "ignore" });
            return true;
        } catch {
            return false;
        }
    })();

function escapeAppleScript(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notify(title: string, message: string) {
    try {
        if (process.platform === "darwin") {
            spawn(
                "osascript",
                [
                    "-e",
                    `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`,
                ],
                { stdio: "ignore", detached: true },
            ).unref();
        } else if (hasNotifySend) {
            spawn("notify-send", [title, message], {
                stdio: "ignore",
                detached: true,
            }).unref();
        }
    } catch {
        //
    }
}

export interface ProcessBuffersOptions {
    commandDefs: CommandDef[];
    cwd: string;
    bufferSize: number;
    streamBufferSize: number;
    timestamps: boolean;
    autoRestart: boolean;
    title?: string;
    columns: number;
    /** Called (batched by the host) whenever buffers change. */
    onChange: () => void;
    supervisorRef?: SupervisorRef;
}

/**
 * Process layer for the OpenTUI front end: supervisor events become
 * per-command wrapped-row buffers plus one interleaved stream buffer.
 * Port of multiplex `use-processes.ts` as a plain class (no React).
 */
export class ProcessBuffers {
    readonly outputRows: string[][];
    readonly streamLines: StreamLine[];
    readonly failedProcs = new Set<number>();
    readonly spawnTimes: number[];
    readonly pendingRestarts = new Set<number>();
    private pending: string[];
    private supervisor: Supervisor | null = null;
    private readonly opts: ProcessBuffersOptions;
    private wrapTabbed: number;
    private wrapStream: number;

    constructor(opts: ProcessBuffersOptions) {
        this.opts = opts;

        this.outputRows = opts.commandDefs.map(() => []);
        this.pending = opts.commandDefs.map(() => "");
        this.streamLines = [];
        this.spawnTimes = opts.commandDefs.map(() => 0);

        const labels = opts.commandDefs.map((c) => c.label);

        this.wrapTabbed = tabbedTextWidth(labels, opts.columns, opts.timestamps);
        this.wrapStream = streamTextWidth(labels, opts.columns, opts.timestamps);
    }

    /** Refresh wrap widths (e.g. after a resize); stored rows keep old wrap. */
    setColumns(columns: number): void {
        const { commandDefs, timestamps } = this.opts;
        const labels = commandDefs.map((c) => c.label);

        this.wrapTabbed = tabbedTextWidth(labels, columns, timestamps);
        this.wrapStream = streamTextWidth(labels, columns, timestamps);
    }

    get columns(): { tabbed: number; stream: number } {
        return { tabbed: this.wrapTabbed, stream: this.wrapStream };
    }

    start(): void {
        if (this.supervisor) {
            return;
        }

        const { commandDefs, cwd, autoRestart, title, onChange } = this.opts;
        const self = this;

        this.supervisor = createSupervisor({
            commandDefs,
            cwd,
            columns: childColumns(
                commandDefs.map((c) => c.label),
                this.opts.columns,
                this.opts.timestamps,
            ),
            autoRestart,
            forceColor: true,
            handlers: {
                onSpawn({ index, time }) {
                    self.spawnTimes[index] = time.getTime();
                },

                onData({ index, chunk }) {
                    if (!self.opts.timestamps) {
                        const parts = (self.pending[index] + chunk).split("\n");

                        self.pending[index] = parts.pop() as string;

                        for (const part of parts) {
                            self.pushRows(index, wrapLine(part, self.wrapTabbed));
                        }
                    }

                    onChange();
                },

                onLine({ index, text, time }) {
                    self.pushLine(index, text, time);
                },

                onSpawnError({ index, message, time }) {
                    self.pushSystem(index, `Failed to start: ${message}`, time);
                    onChange();
                },

                onExit({ index, code, time }) {
                    self.pushSystem(index, `Process exited with code ${code}`, time);
                    onChange();
                },

                onRestartScheduled({ index, attempt, max, time }) {
                    self.pendingRestarts.add(index);
                    self.pushSystem(index, `Restarting (${attempt}/${max})...`, time);
                    onChange();
                },

                onRestarted({ index, time }) {
                    self.pendingRestarts.delete(index);

                    const msg = systemMsg(
                        self.opts.timestamps
                            ? "Restarted"
                            : `Restarted at ${time.toLocaleTimeString("en-GB")}`,
                    );
                    const ts = self.opts.timestamps ? formatTimestamp(time) : "";

                    self.outputRows[index] = wrapLine(`${ts}${msg}`, self.wrapTabbed);
                    self.pending[index] = "";
                    self.streamLines.push({ cmdIndex: index, text: msg, ts });
                    self.failedProcs.delete(index);
                    onChange();
                },

                onFailed({ index, code }) {
                    self.failedProcs.add(index);

                    if (code !== null) {
                        notify(
                            title ?? "dev-tui",
                            `${commandDefs[index].label} crashed (exit code ${code})`,
                        );
                    }

                    onChange();
                },
            },
        });

        this.supervisor.start();

        if (this.opts.supervisorRef) {
            this.opts.supervisorRef.current = this.supervisor;
        }
    }

    restart(index: number): void {
        this.supervisor?.restart(index, true);
    }

    clearOutput(index: number): void {
        const now = new Date();
        const msg = systemMsg(
            this.opts.timestamps ? "Cleared" : `Cleared at ${now.toLocaleTimeString("en-GB")}`,
        );
        const ts = this.opts.timestamps ? formatTimestamp(now) : "";

        this.outputRows[index] = [];
        this.pending[index] = `${ts}${msg}`;
        this.streamLines.push({ cmdIndex: index, text: msg, ts });
    }

    clearStream(): void {
        this.streamLines.length = 0;
    }

    /** Test/fake seam: push one line as if the supervisor delivered it. */
    testLine(index: number, text: string, time = new Date()): void {
        this.pushLine(index, text, time);
        this.opts.onChange();
    }

    pendingTail(index: number): string {
        return this.pending[index] ?? "";
    }

    stop(): void {
        this.supervisor?.stop();
    }

    terminate(graceMs?: number): Promise<void> {
        return this.supervisor?.terminate(graceMs) ?? Promise.resolve();
    }

    killAll(): void {
        this.supervisor?.killAll();
    }

    private pushRows(index: number, rows: string[]): void {
        const buf = this.outputRows[index];

        for (const row of rows) {
            buf.push(row);
        }

        if (buf.length > this.opts.bufferSize * 1.5) {
            buf.splice(0, buf.length - this.opts.bufferSize);
        }
    }

    /**
     * Terminates the buffered tail, exactly as writing a "\n" to the old
     * string buffer did — including when the tail is empty, which leaves a
     * blank row.
     */
    private commitPending(index: number): void {
        this.pushRows(index, wrapLine(this.pending[index], this.wrapTabbed));
        this.pending[index] = "";
    }

    /**
     * Only the first row carries the timestamp; the rest are padded to its
     * width so the label column stays straight.
     */
    private pushStreamRows(index: number, text: string, ts: string): void {
        const rows = wrapLine(text, this.wrapStream);
        // ts carries escape codes, so its own length is not its width.
        const tsPad = ts === "" ? "" : " ".repeat(TIMESTAMP_WIDTH);

        for (let i = 0; i < rows.length; i++) {
            this.streamLines.push({
                cmdIndex: index,
                text: rows[i] ?? "",
                ts: i === 0 ? ts : tsPad,
                cont: i > 0,
            });
        }

        if (this.streamLines.length > this.opts.streamBufferSize * 1.5) {
            this.streamLines.splice(0, this.streamLines.length - this.opts.streamBufferSize);
        }
    }

    private pushLine(index: number, text: string, time: Date): void {
        const ts = this.opts.timestamps ? formatTimestamp(time) : "";

        if (this.opts.timestamps) {
            const tsPad = " ".repeat(TIMESTAMP_WIDTH);

            this.pushRows(
                index,
                wrapLine(text, this.wrapTabbed).map((row, i) => `${i === 0 ? ts : tsPad}${row}`),
            );
        } else {
            this.pushRows(index, wrapLine(text, this.wrapTabbed));
        }

        this.pushStreamRows(index, text, ts);
        this.opts.onChange();
    }

    /**
     * A system message is not process output, so it never carries a timestamp
     * prefix in the buffer the way a real line does.
     */
    private pushSystem(index: number, text: string, time: Date): void {
        const msg = systemMsg(text);
        const ts = this.opts.timestamps ? formatTimestamp(time) : "";

        this.commitPending(index);

        // Left as the tail rather than committed, so it is re-wrapped on a
        // resize and the buffer reads the same as the old "\n" + msg did.
        this.pending[index] = `${ts}${msg}`;

        this.pushStreamRows(index, msg, ts);
    }
}
