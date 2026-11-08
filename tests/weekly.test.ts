import { describe, expect, it } from "vitest";
import { collectRepoWeek } from "../src/core/collect";
import { isoWeekDates } from "../src/core/dates";
import { commitsInWeek, filterCitations, groupByDay, knownHash, parseSummaryBullets, renderWeeklyReport, reportPath, summarySystemPrompt, summaryUserMessage, weekStats } from "../src/core/weekly";
import { commit, fakeGit, logRecord } from "./fakes";

const WEEK = { year: 2026, week: 45 };
const DATES = isoWeekDates(WEEK);
const f = (path: string, added: number, deleted: number) => ({ path, added, deleted, binary: false });
const commits = [
	commit({ short: "a000001", date: "2026-11-02T09:00:00-07:00", subject: "Monday one", files: [f("a.ts", 10, 2)] }),
	commit({ short: "a000002", date: "2026-11-04T09:00:00-07:00", subject: "Wednesday one", files: [f("a.ts", 5, 5), f("b.ts", 1, 0)] }),
	commit({ short: "a000003", date: "2026-11-04T15:00:00-07:00", subject: "Wednesday two", body: "Longer explanation.\n\nCo-Authored-By: X <x@y>", files: [f("c.ts", 100, 0)] }),
	commit({ short: "a000004", date: "2026-11-07T20:00:00-07:00", subject: "Saturday", files: [f("a.ts", 0, 50)] }),
];

describe("week stats", () => {
	it("sums lines, counts distinct files and finds the busiest day", () => {
		expect(weekStats(commits)).toEqual({ commits: 4, added: 116, deleted: 57, files: 3, busiestDay: { date: "2026-11-04", commits: 2 } });
		expect(weekStats([]).busiestDay).toBeUndefined();
	});

	it("groups by local day, oldest first", () => {
		const groups = groupByDay([commits[3], commits[2], commits[1], commits[0]]);
		expect(Array.from(groups.keys())).toEqual(["2026-11-02", "2026-11-04", "2026-11-07"]);
		expect(groups.get("2026-11-04")!.map((c) => c.subject)).toEqual(["Wednesday one", "Wednesday two"]);
	});

	it("keeps only commits whose author day is inside the week", () => {
		const outside = commit({ short: "b000001", date: "2026-11-09T00:30:00-07:00", subject: "next week" });
		const before = commit({ short: "b000002", date: "2026-11-01T23:59:00-07:00", subject: "last week" });
		expect(commitsInWeek([...commits, outside, before], DATES)).toHaveLength(4);
	});

	it("names the report by ISO week", () => {
		expect(reportPath("Reports", WEEK)).toBe("Reports/Code week 2026-W45.md");
	});
});

describe("renderWeeklyReport", () => {
	it("is deterministic without a summary: header line, table, per-repo sections grouped by day", () => {
		const report = renderWeeklyReport(WEEK, DATES, [{ name: "proj", commits, remoteUrl: "git@github.com:me/proj.git" }, { name: "idle", commits: [] }], { generatedOn: "2026-11-08" });
		expect(report.startsWith("# Code week 2026-W45\n\nMon 2026-11-02 to Sun 2026-11-08 · 2 repositories · 4 commits · +116 −57 · 3 files\n")).toBe(true);
		expect(report).toContain("| proj | 4 | +116 −57 | 3 | Wed 2026-11-04 (2) |");
		expect(report).toContain("| idle | 0 | +0 −0 | 0 | — |");
		expect(report).toContain("## proj\n\n4 commits · +116 −57 · 3 files · busiest day Wed 2026-11-04 (2 commits)\n\n### Commits\n\n#### Mon 2026-11-02\n\n- `a000001` Monday one · 1 file — [open](https://github.com/me/proj/commit/a000001");
		expect(report).toContain("#### Wed 2026-11-04\n\n- `a000002` Wednesday one · 2 files");
		expect(report).toContain("## idle\n\nNo commits this week.");
		expect(report).not.toContain("### Summary");
		expect(report).toContain("Written by Code Companion on 2026-11-08 from `git log` on this machine.\n");
		expect(report).not.toContain("Summaries by");
	});

	it("adds the summary section and footnote when bullets are present", () => {
		const report = renderWeeklyReport(WEEK, DATES, [{ name: "proj", commits, summary: ["Reworked a.ts (`a000001`, `a000002`)"] }], { model: "qwen3.5:9b" });
		expect(report).toContain("### Summary\n\n- Reworked a.ts (`a000001`, `a000002`)\n\n### Commits");
		expect(report).toContain("Summaries by qwen3.5:9b from commit messages only");
	});

	it("shows git failures per repo", () => {
		const report = renderWeeklyReport(WEEK, DATES, [{ name: "gone", commits: [], error: "not a git repository" }]);
		expect(report).toContain("| gone | git failed: not a git repository |");
		expect(report).toContain("## gone\n\ngit failed: not a git repository");
	});
});

describe("summary prompt", () => {
	it("asks for five cited bullets and lists commits oldest first with bodies, trailers dropped", () => {
		expect(summarySystemPrompt()).toMatch(/exactly 5 bullets/);
		expect(summarySystemPrompt()).toMatch(/\(a1b2c3d, 9fd9742\)/);
		const { message, truncated } = summaryUserMessage("proj", WEEK, [commits[3], commits[2], commits[0]]);
		expect(truncated).toBe(false);
		expect(message.startsWith("Repository: proj\nWeek: 2026-W45\nCommits (3), oldest first:\n\na000001 2026-11-02 — Monday one\n\na000003 2026-11-04 — Wednesday two\n    Longer explanation.\n\na000004")).toBe(true);
		expect(message).not.toContain("Co-Authored-By");
	});

	it("truncates whole commits to the character budget and says how many were dropped", () => {
		const { message, truncated } = summaryUserMessage("proj", WEEK, commits, 160);
		expect(truncated).toBe(true);
		expect(message).toMatch(/\(\d more commits omitted/);
		expect(message).toContain("a000001");
		expect(message).not.toContain("a000004");
	});

	it("parses bullets in the usual shapes and caps at five", () => {
		const reply = "<think>plan</think>\nHere is the week:\n- One (a000001)\n* Two (a000002)\n• Three\n1. Four\n2) Five\n- Six\n";
		expect(parseSummaryBullets(reply)).toEqual(["One (a000001)", "Two (a000002)", "Three", "Four", "Five"]);
		expect(parseSummaryBullets("no bullets here")).toEqual([]);
	});
});

describe("filterCitations", () => {
	it("keeps known hashes (by prefix), drops unknown ones, normalises the citation", () => {
		const out = filterCitations(["Reworked a.ts (a000001, deadbee)", "Added c.ts (`a000003000000`)", "Invented work (1234567)", "Mixed a000002 and ffffffff in the middle."], commits);
		expect(out).toEqual(["Reworked a.ts (`a000001`)", "Added c.ts (`a000003`)", "Invented work _(no matching commit)_", "Mixed and in the middle. (`a000002`)"]);
	});

	it("ignores tokens shorter than seven characters and empty bullets", () => {
		expect(knownHash("a00000", commits.map((c) => c.hash))).toBeUndefined();
		expect(knownHash("A000001", commits.map((c) => c.hash))).toBe(commits[0].hash);
		expect(filterCitations(["(a000001)", ""], commits)).toEqual([]);
	});
});

describe("collectRepoWeek (fake git)", () => {
	it("filters by author and week and passes a padded window to git", () => {
		const git = fakeGit({
			log: (args) => {
				expect(args.some((a) => a.startsWith("--after=2026-11-01T00:00:00"))).toBe(true);
				expect(args.some((a) => a.startsWith("--before=2026-11-10T00:00:00"))).toBe(true);
				return logRecord({ short: "c000001", date: "2026-11-09T01:00:00-07:00", subject: "next week", files: ["1\t0\ta"] }) + logRecord({ short: "c000002", date: "2026-11-05T01:00:00-07:00", subject: "mine", files: ["1\t0\ta"] }) + logRecord({ short: "c000003", date: "2026-11-05T02:00:00-07:00", subject: "theirs", email: "x@y.z", files: ["1\t0\ta"] });
			},
			remote: "",
			"symbolic-ref": "",
			"rev-parse": "",
		});
		const r = collectRepoWeek({ name: "proj", path: "/p" }, git, ["tony@example.com"], WEEK);
		expect(r.error).toBeUndefined();
		expect(r.commits.map((c) => c.subject)).toEqual(["mine"]);
	});

	it("reports failures instead of throwing", () => {
		expect(collectRepoWeek({ name: "proj", path: "/p" }, fakeGit({}), ["t"], WEEK).error).toMatch(/fatal/);
		expect(collectRepoWeek({ name: "proj", path: "/p" }, null, ["t"], WEEK).error).toMatch(/not available/);
	});
});
