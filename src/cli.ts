#!/usr/bin/env node
import { Command } from "commander";
import { debugLog } from "./debug.js";
import { devTui } from "./devTui.js";
import { normalizeCommands, parseCommandDef, parsePositiveInt } from "./proc/args.js";
import type { CommandInput } from "./proc/types.js";

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const program = new Command()
    .name("dev-tui")
    .description("Run multiple commands in a tabbed TUI (OpenTUI)")
    .version("0.1.0")
    .option("--cwd <path>", "Set the working directory", process.cwd())
    .option("-s, --stream", "Start in stream mode", false)
    .option("--tabs", "Start in tabs mode (the default)", false)
    .option(
        "-i, --inline",
        "Print output inline instead of rendering the TUI (the default when not a TTY)",
        false,
    )
    .option(
        "--json",
        "Emit newline-delimited JSON events. Implies --inline",
        false,
    )
    .option(
        "--buffer-size <lines>",
        "Set the max lines per command buffer",
        parsePositiveInt,
        2000,
    )
    .option(
        "--stream-buffer-size <lines>",
        "Set the max lines in the stream buffer",
        parsePositiveInt,
        10000,
    )
    .option("--timestamps", "Display timestamps on each output line", false)
    .option("--no-restart", "Disable auto-restart on crash")
    .option("--title <name>", "Set the terminal tab title")
    .option("--dry-run", "Print the resolved invocation without starting anything", false)
    .option("--fake", "Run synthetic process output instead of spawning (for demos/tests)", false)
    .option("--fake-interval <ms>", "Fake output tick interval", parsePositiveInt, 300)
    .option("--theme <name>", "Chrome theme: dark or light", "dark")
    .option("--runner <name>", "Runner compat with bin/cake dev (only opentui runs the TUI)", "opentui")
    .helpOption("-h, --help", "Display help for the command")
    .argument(
        "<commands...>",
        "commands as label,command or label@color,command",
        parseCommandDef,
        [] as CommandInput[],
    )
    .configureHelp({
        formatHelp(cmd, helper) {
            const lines: string[] = [];

            lines.push(yellow("Description:"));
            lines.push(`  ${cmd.description()}`);
            lines.push("");

            lines.push(yellow("Usage:"));
            lines.push(`  ${cmd.name()} [options] <commands...>`);
            lines.push("");

            lines.push(yellow("Arguments:"));
            lines.push(
                `  ${green("commands")}  The commands to run as ${green("label,command")} or ${green("label@color,command")}`,
            );
            lines.push(
                `            ${green("color")} is a 6-digit hex value or a name such as ${green("red")} or ${green("blueBright")}`,
            );
            lines.push("");

            lines.push(yellow("Options:"));

            const opts = helper.visibleOptions(cmd);
            const padWidth = Math.max(
                ...opts.map((o) => helper.optionTerm(o).length),
            );

            for (const opt of opts) {
                const term = helper.optionTerm(opt);
                const pad = " ".repeat(padWidth - term.length);
                let desc = opt.description;
                const def = opt.defaultValue;

                if (
                    def !== undefined &&
                    def !== false &&
                    def !== true &&
                    def !== process.cwd() &&
                    def !== "opentui"
                ) {
                    desc += ` [default: ${JSON.stringify(def)}]`;
                }

                lines.push(`  ${green(term)}${pad}  ${desc}`);
            }

            lines.push("");

            return lines.join("\n");
        },
    })
    .parse();

const opts = program.opts<{
    cwd: string;
    stream: boolean;
    tabs: boolean;
    inline: boolean;
    json: boolean;
    bufferSize: number;
    streamBufferSize: number;
    timestamps: boolean;
    restart: boolean;
    title?: string;
    dryRun: boolean;
    fake: boolean;
    fakeInterval: number;
    theme: string;
    runner: string;
}>();
let commands = program.processedArgs[0] as CommandInput[];

if (opts.fake && commands.length === 0) {
    commands = [
        { label: "web", command: "(fake)" },
        { label: "api", command: "(fake)" },
        { label: "queue", command: "(fake)" },
    ];
}

if (opts.dryRun) {
    try {
        const defs = normalizeCommands(commands);

        process.stdout.write(
            `${JSON.stringify(
                {
                    bin: "dev-tui",
                    runner: opts.runner,
                    cwd: opts.cwd,
                    stream: opts.stream && !opts.tabs,
                    inline: opts.inline,
                    json: opts.json,
                    bufferSize: opts.bufferSize,
                    streamBufferSize: opts.streamBufferSize,
                    timestamps: opts.timestamps,
                    restart: opts.restart,
                    title: opts.title ?? null,
                    fake: opts.fake,
                    commands: defs,
                },
                null,
                2,
            )}\n`,
        );
        process.exit(0);
    } catch (e) {
        program.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
}

if (opts.runner !== "opentui" && opts.runner !== "auto") {
    debugLog(`runner ${opts.runner} requested; dev-tui only runs the opentui/inline path`);
}

try {
    const code = await devTui({
        commands,
        cwd: opts.cwd,
        inline: opts.inline,
        json: opts.json,
        stream: opts.stream && !opts.tabs,
        bufferSize: opts.bufferSize,
        streamBufferSize: opts.streamBufferSize,
        timestamps: opts.timestamps,
        restart: opts.restart,
        title: opts.title,
        fake: opts.fake,
        fakeIntervalMs: opts.fakeInterval,
        theme: opts.theme,
    });

    process.exit(code);
} catch (e) {
    program.error(`error: ${e instanceof Error ? e.message : String(e)}`);
}
