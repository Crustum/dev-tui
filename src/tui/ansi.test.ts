import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ansiToChunks, ansiToStyledText, applySgr, isPlainLine } from "./ansi.js";

const ESC = String.fromCharCode(27);
const sgr = (...params: Array<number | string>): string => `${ESC}[${params.join(";")}m`;

function textsOf(line: string): string[] {
    return ansiToChunks(line).map((c) => (c as unknown as { text: string }).text);
}

describe("isPlainLine", () => {
    it("detects escape bytes", () => {
        assert.equal(isPlainLine("plain text"), true);
        assert.equal(isPlainLine(`${ESC}[31mred`), false);
    });
});

describe("ansiToChunks", () => {
    it("passes plain text through as one chunk", () => {
        assert.deepEqual(textsOf("hello world"), ["hello world"]);
        assert.deepEqual(textsOf(""), []);
    });

    it("splits SGR spans preserving order and carries no escapes", () => {
        const chunks = ansiToChunks(`${sgr(31)}red${sgr(0)} plain`);

        assert.deepEqual(
            chunks.map((c) => (c as unknown as { text: string }).text),
            ["red", " plain"],
        );

        for (const c of chunks) {
            assert.equal(isPlainLine((c as unknown as { text: string }).text), true);
        }
    });

    it("resets on bare SGR and SGR-less sequences", () => {
        assert.deepEqual(textsOf(`${ESC}[mreset`), ["reset"]);
    });

    it("strips cursor movement, erases and modes instead of rendering them", () => {
        assert.deepEqual(textsOf(`a${ESC}[2K${ESC}[1Gb${ESC}[?25l`), ["ab"]);
        assert.deepEqual(textsOf(`${sgr(31)}a${ESC}[2Kb${sgr(0)}`), ["ab"]);
    });

    it("strips OSC hyperlinks and titles", () => {
        assert.deepEqual(textsOf(`a${ESC}]8;;http://x${ESC}\\b`), ["ab"]);
        assert.deepEqual(textsOf(`${ESC}]0;title${ESC}\\ok`), ["ok"]);
    });

    it("keeps truecolor and 256-color spans as styled chunks", () => {
        const chunks = ansiToChunks(`${ESC}[38;2;147;197;253mtrue${ESC}[48;5;200mbg`);

        assert.deepEqual(
            chunks.map((c) => (c as unknown as { text: string }).text),
            ["true", "bg"],
        );
    });

    it("round-trips through StyledText without escapes", () => {
        const styled = ansiToStyledText(`${sgr(1, 33)}bold yellow${sgr(0)}`);
        const flat = styled.chunks.map((c) => (c as unknown as { text: string }).text).join("");

        assert.equal(flat, "bold yellow");
        assert.equal(isPlainLine(flat), true);
    });

    it("paints unstyled spans with the base foreground", () => {
        const fgOf = (c: unknown): Array<number> | undefined =>
            (c as { fg?: { buffer: ArrayLike<number> } }).fg?.buffer !== undefined
                ? Array.from((c as { fg: { buffer: ArrayLike<number> } }).fg.buffer)
                : undefined;

        const plain = ansiToChunks("no escapes here", "#0f172a");

        assert.deepEqual(
            plain.map((c) => (c as unknown as { text: string }).text),
            ["no escapes here"],
        );
        assert.deepEqual(fgOf(plain[0]), [15, 23, 42, 255]);

        const mixed = ansiToChunks(`${sgr(31)}red${sgr(0)} back`, "#0f172a");
        const texts = mixed.map((c) => (c as unknown as { text: string }).text);

        assert.deepEqual(texts, ["red", " back"]);
        assert.deepEqual(fgOf(mixed[0]), [205, 0, 0, 255]);
        assert.deepEqual(fgOf(mixed[1]), [15, 23, 42, 255]);
    });
});

describe("applySgr", () => {
    it("maps names, brights, off-switches and extended colors", () => {
        assert.equal(applySgr({}, [31]).fg, "#cd0000");
        assert.equal(applySgr({}, [92]).fg, "#00ff00");
        assert.equal(applySgr({}, [44]).bg, "#0000ee");
        assert.equal(applySgr({ fg: "#cd0000", bold: true }, [39, 22]).fg, undefined);

        const extended = applySgr({}, [38, 5, 200]);

        assert.equal(extended.bg, undefined);
        assert.equal(extended.fg, "#ff00d7");

        const truecolor = applySgr({}, [48, 2, 1, 2, 3]);

        assert.equal(truecolor.bg, "#010203");
        assert.deepEqual(applySgr({ fg: "x" }, []), {});
        assert.deepEqual(applySgr({ fg: "x" }, [0]), {});
    });
});
