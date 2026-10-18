// Test-only helper: runs JS source carried in an environment variable.
//
// Neither shell the supervisor spawns through can quote the program on the
// command line: `sh -c` needs quotes to group `node -e "..."` (bare parens
// are a syntax error under dash), while `cmd.exe /c` keeps quotes literally
// instead of grouping by them, so the same quoting arrives broken on
// Windows. Passing the program in the environment keeps the command line to
// bare words - letters, `/`, `.`, `_` and spaces as separators - which both
// shells pass through untouched. Usage: `node src/test-eval.cjs <ENV_KEY>`.
//
// The program is written to a temp file and required (rather than eval'd)
// so module scope - `require`, `__dirname` and friends - works as usual.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const key = process.argv[2];
const source = key ? process.env[key] : undefined;

if (!source) {
    console.error(`test-eval: missing program in env var ${String(key)}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "multiplex-test-eval-"));
const file = path.join(dir, `${key}.cjs`);

fs.writeFileSync(file, source);
require(file);
