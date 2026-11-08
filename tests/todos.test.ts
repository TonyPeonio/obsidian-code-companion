import { describe, expect, it } from "vitest";
import { blameAge, cleanTodoText, editorLink, isTextCandidate, joinPath, listRepoFiles, renderTodoNote, scanRepo, scanText, todoRegex } from "../src/core/todos";
import { fakeGit } from "./fakes";

const re = todoRegex("TODO|FIXME|HACK|XXX");

describe("todoRegex", () => {
	it("finds markers behind the usual comment leaders", () => {
		const cases: Array<[string, string, string]> = [
			["// TODO handle errors", "TODO", "handle errors"],
			["  # FIXME: off by one", "FIXME", "off by one"],
			["/* HACK works around the cache */", "HACK", "works around the cache"],
			[" * XXX revisit", "XXX", "revisit"],
			["<!-- TODO: write docs -->", "TODO", "write docs"],
			["-- TODO index this column", "TODO", "index this column"],
			["; FIXME lisp", "FIXME", "lisp"],
			["% TODO cite", "TODO", "cite"],
			["const x = 1; // TODO(tony): remove", "TODO", "remove"],
			["TODO: bare marker at line start", "TODO", "bare marker at line start"],
		];
		for (const [line, marker, text] of cases) {
			const hits = scanText(line, re, "f");
			expect(hits, line).toHaveLength(1);
			expect(hits[0].marker, line).toBe(marker);
			expect(hits[0].text, line).toBe(text);
		}
	});

	it("ignores lower-case prose, identifiers and markers not in the list", () => {
		for (const line of ["// todo later", "const todoList = [];", "// NOTE: not a marker", "myTODO = 1", "// TODOS are plural"]) {
			expect(scanText(line, re, "f"), line).toHaveLength(0);
		}
		expect(scanText("// NOTE: custom", todoRegex("NOTE|TODO"), "f")[0].marker).toBe("NOTE");
	});

	it("reports 1-based line numbers for every hit in a file", () => {
		const hits = scanText("a\n// TODO one\nb\n# FIXME two\n", re, "src/x.ts");
		expect(hits.map((h) => [h.line, h.marker])).toEqual([
			[2, "TODO"],
			[4, "FIXME"],
		]);
		expect(hits[0].file).toBe("src/x.ts");
	});

	it("cleans comment closers and long text", () => {
		expect(cleanTodoText("thing */")).toBe("thing");
		expect(cleanTodoText("thing   -->")).toBe("thing");
		expect(cleanTodoText("x".repeat(300))).toHaveLength(200);
	});
});

describe("file selection", () => {
	it("skips binaries, lockfiles and minified bundles", () => {
		expect(isTextCandidate("src/a.ts")).toBe(true);
		expect(isTextCandidate("Makefile")).toBe(true);
		expect(isTextCandidate("img/logo.png")).toBe(false);
		expect(isTextCandidate("package-lock.json")).toBe(false);
		expect(isTextCandidate("dist/app.min.js")).toBe(false);
		expect(isTextCandidate("model.safetensors")).toBe(false);
	});

	it("lists tracked and untracked-but-not-ignored files from git", () => {
		const git = fakeGit({ "ls-files": "src/a.ts\0README.md\0\"sp ace.ts\"\0" });
		expect(listRepoFiles(git)).toEqual(["src/a.ts", "README.md", "sp ace.ts"]);
		expect(git.calls[0]).toEqual(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
	});

	it("joins paths with the working tree's own separator", () => {
		expect(joinPath("C:\\dev\\proj", "src/a.ts")).toBe("C:\\dev\\proj\\src\\a.ts");
		expect(joinPath("/home/me/proj/", "src/a.ts")).toBe("/home/me/proj/src/a.ts");
	});
});

describe("editor links", () => {
	it("builds vscode:// and idea:// URLs with encoded spaces, or no link for plain paths", () => {
		expect(editorLink("vscode", "C:\\Users\\Tony Peonio\\proj\\src\\a.ts", 12)).toBe("vscode://file/C:/Users/Tony%20Peonio/proj/src/a.ts:12");
		expect(editorLink("vscode", "/home/me/proj/src/a.ts", 3)).toBe("vscode://file/home/me/proj/src/a.ts:3");
		expect(editorLink("idea", "/home/me/proj/src/a (1).ts", 3)).toBe("idea://open?file=/home/me/proj/src/a%20(1).ts&line=3");
		expect(editorLink("path", "/x", 1)).toBeUndefined();
	});
});

describe("scanRepo and renderTodoNote", () => {
	const files: Record<string, string> = {
		"C:\\dev\\proj\\src\\a.ts": "x\n// TODO handle | pipes\n",
		"C:\\dev\\proj\\src\\b.py": "# FIXME: y\n\n# HACK z\n",
		"C:\\dev\\proj\\bin.dat": "\0\0",
	};
	const readFile = (p: string) => files[p] ?? null;
	const git = fakeGit({
		"ls-files": "src/a.ts\0src/b.py\0bin.dat\0img.png\0",
		blame: (args) => (args.includes("src/a.ts") ? "abc author Tony\nauthor-time 1700000000\n" : ""),
	});

	it("scans text files only, sorts hits, and blames when asked", () => {
		const plain = scanRepo(git, "C:\\dev\\proj", readFile);
		expect(plain.filesScanned).toBe(2);
		expect(plain.hits.map((h) => `${h.file}:${h.line} ${h.marker}`)).toEqual(["src/a.ts:2 TODO", "src/b.py:1 FIXME", "src/b.py:3 HACK"]);
		expect(plain.hits[0].age).toBeUndefined();
		const now = 1700000000_000 + 40 * 86_400_000;
		const blamed = scanRepo(git, "C:\\dev\\proj", readFile, { blame: true, nowMs: now });
		expect(blamed.hits[0].age).toBe("1 month");
		expect(blamed.hits[1].age).toBeUndefined();
		expect(blameAge(git, "src/a.ts", 2, now)).toBe("1 month");
	});

	it("renders a table per repo with editor links and escaped pipes", () => {
		const { hits, filesScanned } = scanRepo(git, "C:\\dev\\proj", readFile);
		const note = renderTodoNote([{ name: "proj", path: "C:\\dev\\proj", hits, filesScanned }, { name: "clean", path: "/c", hits: [], filesScanned: 3 }], "vscode", { generatedOn: "2026-11-07" });
		expect(note.startsWith("# TODOs\n\n3 markers across 2 repositories, scanned 2026-11-07.")).toBe(true);
		expect(note).toContain("## proj (3)\n\n| Where | Marker | Text |\n|---|---|---|\n| [src/a.ts:2](vscode://file/C:/dev/proj/src/a.ts:2) | TODO | handle \\| pipes |\n| [src/b.py:1](vscode://file/C:/dev/proj/src/b.py:1) | FIXME | y |");
		expect(note).toContain("## clean (0)\n\nNo markers in 3 files.");
		expect(note).not.toContain("| Age |");
	});

	it("uses plain paths and an age column when asked, and caps rows with a notice", () => {
		const many = Array.from({ length: 7 }, (_, i) => ({ file: "f.ts", line: i + 1, marker: "TODO", text: `t${i}`, age: "today" }));
		const note = renderTodoNote([{ name: "big", path: "/r", hits: many, filesScanned: 1 }], "path", { cap: 5 });
		expect(note).toContain("Showing the first 5 of 7 markers");
		expect(note).toContain("| Where | Marker | Text | Age |");
		expect(note).toContain("| `/r/f.ts:1` | TODO | t0 | today |");
		expect(note).toContain("| `/r/f.ts:5` | TODO | t4 | today |");
		expect(note).not.toContain("t5");
		expect(note).toContain("_2 more not shown (5-row cap)._");
	});

	it("shows a git failure for a repository", () => {
		const note = renderTodoNote([{ name: "gone", path: "/g", hits: [], filesScanned: 0, error: "not a git repository" }], "vscode");
		expect(note).toContain("## gone (0)\n\ngit failed: not a git repository");
	});
});
