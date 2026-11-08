import { describe, expect, it } from "vitest";
import { collectRepoDay } from "../src/core/collect";
import { END_MARKER, START_MARKER, abbreviateFiles, applyTemplate, dailyNotePath, existingBlock, headingText, minimalDailyBody, renderCommitLine, renderDailyBlock, upsertBlock } from "../src/core/daily";
import { startOfDay } from "../src/core/dates";
import { writeNote } from "../src/core/vault";
import { FakeVault, commit, fakeGit, logRecord } from "./fakes";

const TODAY = "2026-11-07";
const REMOTE = "git@github.com:TonyPeonio/obsidian-code-companion.git";

describe("renderDailyBlock", () => {
	it("writes one sub-list per repo with totals, commit lines, links and the working tree", () => {
		const block = renderDailyBlock(
			[
				{
					name: "code-companion",
					remoteUrl: REMOTE,
					commits: [
						commit({ short: "a1b2c3d", subject: "Parse git log", date: "2026-11-07T09:00:00-07:00", files: [{ path: "src/core/git.ts", added: 100, deleted: 40, binary: false }, { path: "tests/git.test.ts", added: 20, deleted: 5, binary: false }] }),
						commit({ short: "b2c3d4e", subject: "Render block", date: "2026-11-07T11:00:00-07:00", files: [{ path: "src/core/daily.ts", added: 0, deleted: 0, binary: false }] }),
					],
					workingTree: { files: 4, added: 33, deleted: 2, untracked: 0 },
				},
				{ name: "quiet", commits: [], workingTree: { files: 0, added: 0, deleted: 0, untracked: 0 } },
			],
			TODAY,
		);
		const lines = block.split("\n");
		expect(lines[0]).toBe(START_MARKER);
		expect(lines[lines.length - 1]).toBe(END_MARKER);
		expect(lines[1]).toBe("- **code-companion** · 2 commits · +120 −45 · 3 files");
		expect(lines[2]).toBe(`  - \`a1b2c3d\` Parse git log (src/core/git.ts, tests/git.test.ts) — [open](https://github.com/TonyPeonio/obsidian-code-companion/commit/${"a1b2c3d".padEnd(40, "0")})`);
		expect(lines[3]).toContain("`b2c3d4e` Render block (src/core/daily.ts)");
		expect(lines[4]).toBe("  - working tree: 4 files changed, +33 −2 (not committed)");
		expect(lines[5]).toBe("- **quiet** · no commits");
	});

	it("marks commits from another day, merges, errors and untracked files", () => {
		const block = renderDailyBlock(
			[
				{ name: "r", commits: [commit({ short: "c3d4e5f", subject: "Yesterday's", date: "2026-11-06T22:00:00-07:00" }), commit({ short: "d4e5f6a", subject: "Merge branch 'x'", isMerge: true, date: "2026-11-07T08:00:00-07:00" })], workingTree: { files: 0, added: 0, deleted: 0, untracked: 2 } },
				{ name: "broken", commits: [], error: "not a git repository" },
			],
			TODAY,
		);
		expect(block).toContain("  - `c3d4e5f` (Nov 6) Yesterday's\n");
		expect(block).toContain("  - `d4e5f6a` Merge branch 'x' (merge)\n");
		expect(block).toContain("  - working tree: 0 files changed, +0 −0, 2 untracked files (not committed)");
		expect(block).toContain("- **broken** · git failed: not a git repository");
	});

	it("abbreviates long file lists after five entries", () => {
		expect(abbreviateFiles(["a", "b", "c", "d", "e", "f", "g"])).toBe("a, b, c, d, e, +2 more");
		expect(abbreviateFiles(["a", "b"])).toBe("a, b");
		const line = renderCommitLine(commit({ short: "1234567", subject: "Many", files: Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.ts`, added: 1, deleted: 0, binary: false })) }), undefined, TODAY);
		expect(line).toBe("  - `1234567` Many (f0.ts, f1.ts, f2.ts, f3.ts, f4.ts, +3 more)");
	});

	it("says so when no repositories are configured", () => {
		expect(renderDailyBlock([], TODAY)).toContain("No repositories configured");
	});
});

describe("upsertBlock", () => {
	const block = `${START_MARKER}\n- **r** · 1 commit · +1 −0 · 1 file\n${END_MARKER}`;

	it("inserts under an existing heading, before the rest of the section", () => {
		const note = "# 2026-11-07\n\n## Notes\n\nstuff\n\n## Code\n\nSomething I typed.\n\n## Later\n";
		const out = upsertBlock(note, "## Code", block);
		expect(out).toBe(`# 2026-11-07\n\n## Notes\n\nstuff\n\n## Code\n\n${block}\n\nSomething I typed.\n\n## Later\n`);
	});

	it("appends the heading and the block when the note has neither", () => {
		const out = upsertBlock("# 2026-11-07\n\nplain\n", "## Code", block);
		expect(out).toBe(`# 2026-11-07\n\nplain\n\n## Code\n\n${block}\n`);
		expect(upsertBlock("", "## Code", block)).toBe(`## Code\n\n${block}\n`);
	});

	it("replaces an existing block in place and never duplicates", () => {
		const first = upsertBlock("# Day\n\n## Code\n\nnotes after\n", "## Code", block);
		const block2 = `${START_MARKER}\n- **r** · 2 commits · +5 −1 · 2 files\n  - \`abc\` x\n${END_MARKER}`;
		const second = upsertBlock(first, "## Code", block2);
		expect(second.split(START_MARKER)).toHaveLength(2);
		expect(second).toContain("2 commits");
		expect(second).not.toContain("1 commit ·");
		expect(second).toContain("notes after");
		expect(upsertBlock(second, "## Code", block2)).toBe(second);
	});

	it("finds the markers even when the heading was renamed, and matches the heading case-insensitively", () => {
		const moved = `# Day\n\n## Work log\n\n${block}\n`;
		expect(upsertBlock(moved, "## Code", block.replace("1 commit", "3 commits"))).toContain("3 commits");
		expect(upsertBlock("## code\n", "## Code", block)).toBe(`## code\n\n${block}\n`);
		expect(existingBlock(moved)).toBe("- **r** · 1 commit · +1 −0 · 1 file");
		expect(existingBlock("nothing")).toBeUndefined();
	});
});

describe("daily note paths and templates", () => {
	it("builds the path from folder, format and date", () => {
		expect(dailyNotePath("Daily", "YYYY-MM-DD", TODAY)).toBe("Daily/2026-11-07.md");
		expect(dailyNotePath("/Journal/", "YYYY/MM/YYYY-MM-DD", TODAY)).toBe("Journal/2026/11/2026-11-07.md");
		expect(dailyNotePath("", "", TODAY)).toBe("2026-11-07.md");
	});

	it("fills a template and writes a minimal body otherwise", () => {
		expect(applyTemplate("# {{title}}\n\n{{date:dddd, MMMM D}} at {{time}}\n\n## Code\n", TODAY, "2026-11-07", new Date(2026, 10, 7, 9, 5))).toBe("# 2026-11-07\n\nSaturday, November 7 at 09:05\n\n## Code\n");
		expect(applyTemplate("{{date}}", TODAY, "x")).toBe(TODAY);
		expect(minimalDailyBody(TODAY, "## Code")).toBe("# 2026-11-07\n\n## Code\n");
		expect(headingText("## Code")).toBe("Code");
	});
});

describe("collectRepoDay (fake git end to end)", () => {
	const repo = { name: "proj", path: "C:\\dev\\proj" };

	it("filters by the repo's own author when none is configured, applies the window, and reports the tree", async () => {
		const git = fakeGit({
			"config user.name": "Tony Peonio\n",
			"config user.email": "tony@example.com\n",
			log: logRecord({ short: "a1b2c3d", date: "2026-11-07T10:00:00-07:00", subject: "Mine", files: ["3\t1\tsrc/a.ts"] }) + logRecord({ short: "b2c3d4e", date: "2026-11-07T09:00:00-07:00", subject: "Bot", name: "bot", email: "bot@example.com", files: ["1\t1\tx"] }) + logRecord({ short: "c3d4e5f", date: "2026-11-06T09:00:00-07:00", subject: "Yesterday", files: ["1\t1\ty"] }),
			diff: "2\t0\tsrc/a.ts\n",
			status: " M src/a.ts\n",
			remote: "https://github.com/TonyPeonio/proj.git\n",
			"symbolic-ref": "origin/main\n",
			"rev-parse": "C:/dev/proj\n",
		});
		const { day, next } = collectRepoDay(repo, git, [], undefined, TODAY);
		expect(day.error).toBeUndefined();
		expect(day.commits.map((c) => c.subject)).toEqual(["Mine"]);
		expect(day.workingTree).toEqual({ files: 1, added: 2, deleted: 0, untracked: 0 });
		expect(day.remoteUrl).toBe("https://github.com/TonyPeonio/proj.git");
		expect(next).toEqual({ lastLoggedHash: "a1b2c3d".padEnd(40, "0"), lastLoggedAt: "2026-11-07T10:00:00-07:00" });
		const logCall = git.calls.find((c) => c[0] === "log")!;
		expect(logCall).toContain("--author=Tony Peonio");
		expect(logCall.some((a) => a.startsWith("--after=2026-11-06T00:00:00"))).toBe(true);

		// Written into a daily note through the vault.
		const vault = new FakeVault();
		const path = dailyNotePath("Daily", "YYYY-MM-DD", TODAY);
		await writeNote(vault, path, upsertBlock(minimalDailyBody(TODAY, "## Code"), "## Code", renderDailyBlock([day], TODAY)));
		expect(await vault.read(path)).toContain("- **proj** · 1 commit · +3 −1 · 1 file");
	});

	it("uses the remote override and reports git failures without throwing", () => {
		const failing = fakeGit({ "config user.name": "T\n", "config user.email": "t@e\n" });
		const r = collectRepoDay({ ...repo, remoteUrl: "git@gitlab.com:g/p.git" }, failing, ["t@e"], undefined, TODAY);
		expect(r.day.error).toMatch(/fatal: fake git has no answer/);
		expect(r.next).toBeUndefined();
		expect(collectRepoDay(repo, null, [], undefined, TODAY).day.error).toMatch(/git is not available/);
	});

	it("reaches back to the last logged commit when a day was skipped", () => {
		const state = { lastLoggedHash: "0000001".padEnd(40, "0"), lastLoggedAt: "2026-11-05T17:00:00-07:00" };
		const git = fakeGit({
			log: (args) => {
				expect(args).toContain(`--after=${state.lastLoggedAt}`);
				return logRecord({ short: "0000003", date: "2026-11-07T10:00:00-07:00", subject: "today" }) + logRecord({ short: "0000002", date: "2026-11-06T12:00:00-07:00", subject: "missed" }) + logRecord({ short: "0000001", date: state.lastLoggedAt, subject: "logged" });
			},
			diff: "",
			status: "",
			remote: "",
			"symbolic-ref": "",
			"rev-parse": "",
		});
		const { day } = collectRepoDay(repo, git, ["tony@example.com"], state, TODAY);
		expect(day.commits.map((c) => c.subject).sort()).toEqual(["missed", "today"]);
		expect(startOfDay(TODAY).slice(0, 10)).toBe(TODAY);
	});
});
