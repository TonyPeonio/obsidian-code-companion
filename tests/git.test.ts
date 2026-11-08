import { describe, expect, it } from "vitest";
import { LOG_FORMAT, filterByAuthor, logArgs, matchesAuthor, parseGitLog, parseNumstat, renamedPath, repoAuthors, sortByDate, sumStats, workingTree } from "../src/core/git";
import { fakeGit, logRecord } from "./fakes";

describe("parseGitLog", () => {
	it("splits records on the record separator and fields on the unit separator", () => {
		const out = logRecord({ short: "a1b2c3d", date: "2026-11-07T10:00:00-07:00", subject: "First", files: ["3\t1\tsrc/a.ts"] }) + logRecord({ short: "b2c3d4e", date: "2026-11-07T09:00:00-07:00", subject: "Second", files: ["10\t0\tREADME.md", "1\t1\tsrc/b.ts"] });
		const commits = parseGitLog(out);
		expect(commits).toHaveLength(2);
		expect(commits[0].short).toBe("a1b2c3d");
		expect(commits[0].hash).toHaveLength(40);
		expect(commits[0].subject).toBe("First");
		expect(commits[0].files).toEqual([{ path: "src/a.ts", added: 3, deleted: 1, binary: false }]);
		expect(commits[1].files.map((f) => f.path)).toEqual(["README.md", "src/b.ts"]);
		expect(commits[1].authorEmail).toBe("tony@example.com");
	});

	it("keeps multi-line bodies intact, including blank lines and trailers", () => {
		const body = "Why this change.\n\nSecond paragraph with a # hash and a - dash.\n\nCo-Authored-By: Someone <s@example.com>";
		const commits = parseGitLog(logRecord({ short: "c3d4e5f", date: "2026-11-07T10:00:00-07:00", subject: "Subject with: colon and `code`", body, files: ["1\t1\tx"] }));
		expect(commits).toHaveLength(1);
		expect(commits[0].body).toBe(body);
		expect(commits[0].files).toHaveLength(1);
	});

	it("handles empty bodies and commits with no file changes", () => {
		const commits = parseGitLog(logRecord({ short: "d4e5f6a", date: "2026-11-07T10:00:00-07:00", subject: "Empty commit" }) + logRecord({ short: "e5f6a7b", date: "2026-11-07T09:00:00-07:00", subject: "Next", files: ["1\t0\ta"] }));
		expect(commits[0].body).toBe("");
		expect(commits[0].files).toEqual([]);
		expect(commits[1].files).toHaveLength(1);
	});

	it("marks merges by parent count (git prints no numstat for them)", () => {
		const commits = parseGitLog(logRecord({ short: "f6a7b8c", date: "2026-11-07T10:00:00-07:00", subject: "Merge branch 'feature'", parents: `${"1".repeat(40)} ${"2".repeat(40)}` }) + logRecord({ short: "a7b8c9d", date: "2026-11-07T09:00:00-07:00", subject: "Plain", files: ["2\t2\tz"] }));
		expect(commits[0].isMerge).toBe(true);
		expect(commits[0].parents).toHaveLength(2);
		expect(commits[0].files).toEqual([]);
		expect(commits[1].isMerge).toBe(false);
	});

	it("tolerates CRLF output and a subject that looks like a numstat line", () => {
		const raw = logRecord({ short: "b8c9d0e", date: "2026-11-07T10:00:00-07:00", subject: "1\t1\tnot-a-file", files: ["5\t5\treal.ts"] }).replace(/\n/g, "\r\n");
		const commits = parseGitLog(raw);
		expect(commits).toHaveLength(1);
		expect(commits[0].subject).toBe("1\t1\tnot-a-file");
		expect(commits[0].files.map((f) => f.path)).toEqual(["real.ts"]);
	});

	it("returns nothing for empty output", () => {
		expect(parseGitLog("")).toEqual([]);
		expect(parseGitLog("\n\n")).toEqual([]);
	});
});

describe("parseNumstat", () => {
	it("treats binary counts as zero and resolves rename braces", () => {
		expect(parseNumstat(["-\t-\timg/logo.png", "2\t3\tsrc/{old => new}/x.ts", "1\t0\ta.ts => b.ts"])).toEqual([
			{ path: "img/logo.png", added: 0, deleted: 0, binary: true },
			{ path: "src/new/x.ts", added: 2, deleted: 3, binary: false },
			{ path: "b.ts", added: 1, deleted: 0, binary: false },
		]);
		expect(renamedPath("{a => b}/c.ts")).toBe("b/c.ts");
		expect(renamedPath("plain.ts")).toBe("plain.ts");
	});
});

describe("logArgs", () => {
	it("uses the separator format, numstat, fixed-string authors and the window", () => {
		const args = logArgs({ after: "2026-11-07T00:00:00-07:00", authors: ["Tony Peonio", "tony@example.com"] });
		expect(args[0]).toBe("log");
		expect(args).toContain("--numstat");
		expect(args).toContain("--fixed-strings");
		expect(args).toContain(`--format=${LOG_FORMAT}`);
		expect(args).toContain("--after=2026-11-07T00:00:00-07:00");
		expect(args).toContain("--author=Tony Peonio");
		expect(args).toContain("--author=tony@example.com");
		expect(args[args.length - 1]).toBe("--");
		expect(LOG_FORMAT).toContain("%x1f");
		expect(LOG_FORMAT.endsWith("%x1e")).toBe(true);
	});
});

describe("author filtering", () => {
	const me = { authorName: "Tony Peonio", authorEmail: "tony_peonio@mines.edu" };
	it("matches by name, by email, or by Name <email>, case-insensitively and exactly", () => {
		expect(matchesAuthor(me, ["tony peonio"])).toBe(true);
		expect(matchesAuthor(me, ["TONY_PEONIO@mines.edu"])).toBe(true);
		expect(matchesAuthor(me, ["Someone <tony_peonio@mines.edu>"])).toBe(true);
		expect(matchesAuthor(me, ["Tony Peonio <other@example.com>"])).toBe(true);
		expect(matchesAuthor(me, ["Tony"])).toBe(false);
		expect(matchesAuthor(me, ["Tony Peonio Jr"])).toBe(false);
		expect(matchesAuthor(me, [])).toBe(true);
	});

	it("filterByAuthor drops other people's commits", () => {
		const commits = parseGitLog(logRecord({ short: "1111111", date: "2026-11-07T10:00:00-07:00", subject: "Mine", name: "Tony Peonio", email: "tony@example.com" }) + logRecord({ short: "2222222", date: "2026-11-07T09:00:00-07:00", subject: "Theirs", name: "Dependabot", email: "bot@github.com" }));
		expect(filterByAuthor(commits, ["tony@example.com"]).map((c) => c.subject)).toEqual(["Mine"]);
	});

	it("repoAuthors reads user.name and user.email from the repo", () => {
		const git = fakeGit({ "config user.name": "Tony Peonio\n", "config user.email": "tony@example.com\n" });
		expect(repoAuthors(git)).toEqual(["Tony Peonio", "tony@example.com"]);
		const none = fakeGit({});
		expect(repoAuthors(none)).toEqual([]);
	});
});

describe("workingTree and stats", () => {
	it("counts changed tracked files, lines and untracked files", () => {
		const git = fakeGit({ diff: "10\t2\tsrc/a.ts\n23\t0\tsrc/b.ts\n-\t-\timg.png\n", status: " M src/a.ts\n M src/b.ts\n?? notes.txt\n?? img.png\n" });
		expect(workingTree(git)).toEqual({ files: 3, added: 33, deleted: 2, untracked: 2 });
		expect(git.calls[0]).toEqual(["diff", "--numstat", "HEAD", "--"]);
	});

	it("is all zeros when git fails (empty repository)", () => {
		expect(workingTree(fakeGit({}))).toEqual({ files: 0, added: 0, deleted: 0, untracked: 0 });
	});

	it("sumStats counts distinct files; sortByDate is oldest first", () => {
		const commits = parseGitLog(logRecord({ short: "1111111", date: "2026-11-07T10:00:00-07:00", subject: "A", files: ["5\t1\tx", "1\t1\ty"] }) + logRecord({ short: "2222222", date: "2026-11-07T09:00:00-07:00", subject: "B", files: ["2\t2\tx"] }));
		expect(sumStats(commits)).toEqual({ commits: 2, added: 8, deleted: 4, files: 2 });
		expect(sortByDate(commits).map((c) => c.subject)).toEqual(["B", "A"]);
	});
});
