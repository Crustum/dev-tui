/**
 * Synthetic process output for the `--fake` shell — zero child processes
 * needed. Ticks every `intervalMs` and pushes 1–2 lines across the commands,
 * with occasional ANSI colors and one long line to exercise wrapping.
 */
export class FakeProcOutput {
    private timer: ReturnType<typeof setInterval> | null = null;
    private i = 0;

    constructor(
        private readonly ingest: (index: number, text: string) => void,
        readonly procs: number = 3,
        readonly intervalMs = 300,
    ) {}

    start(): void {
        if (this.timer) {
            return;
        }

        this.timer = setInterval(() => this.tick(), this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    restart(): void {
        this.stop();
        this.start();
    }

    tick(): void {
        this.ingest(this.i % Math.max(1, this.procs), this.next());
        this.i++;

        if (this.i % 4 === 0) {
            this.ingest(this.i % Math.max(1, this.procs), this.colored());
            this.i++;
        }
    }

    private next(): string {
        const n = this.i;

        if (n % 17 === 16) {
            return `very long line #${n} — ${"lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(4)}`;
        }

        const verbs = ["listening on", "compiled", "request", "watching", "connected to"];

        return `${verbs[n % verbs.length]} :${3000 + (n % 7)} (#${n})`;
    }

    private colored(): string {
        const codes = ["\x1b[31merror-ish", "\x1b[32mok", "\x1b[33mwarn", "\x1b[34minfo"];

        return `${codes[this.i % codes.length]}\x1b[0m check #${this.i}`;
    }
}
