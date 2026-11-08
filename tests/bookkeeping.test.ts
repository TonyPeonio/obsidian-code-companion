import { describe, expect, it } from "vitest";
import { logWindow, nextState, selectCommits } from "../src/core/bookkeeping";
import { commit } from "./fakes";

const MIDNIGHT = "2026-11-07T00:00:00-07:00";

describe("logWindow", () => {
	it("starts at midnight on the first run", () => {
		expect(logWindow(undefined, MIDNIGHT)).toEqual({ after: MIDNIGHT, inclusive: true, source: "midnight" });
	});

	it("starts at midnight when the last logged commit is from today (re-runs replace the block)", () => {
		const w = logWindow({ lastLoggedHash: "a".repeat(40), lastLoggedAt: "2026-11-07T09:30:00-07:00" }, MIDNIGHT);
		expect(w.source).toBe("midnight");
	});

	it("reaches back to the last logged commit when that is older than today", () => {
		const w = logWindow({ lastLoggedHash: "a".repeat(40), lastLoggedAt: "2026-11-05T17:00:00-07:00" }, MIDNIGHT);
		expect(w).toEqual({ after: "2026-11-05T17:00:00-07:00", inclusive: false, source: "last-logged" });
	});
});

describe("selectCommits", () => {
	const old = commit({ short: "0000001", date: "2026-11-05T17:00:00-07:00", subject: "logged already" });
	const missed = commit({ short: "0000002", date: "2026-11-06T12:00:00-07:00", subject: "missed yesterday" });
	const early = commit({ short: "0000003", date: "2026-11-07T00:00:00-07:00", subject: "at midnight" });
	const now = commit({ short: "0000004", date: "2026-11-07T11:00:00-07:00", subject: "today" });

	it("includes commits at exactly midnight in the first-run window", () => {
		const w = logWindow(undefined, MIDNIGHT);
		expect(selectCommits([old, missed, early, now], w).map((c) => c.subject)).toEqual(["at midnight", "today"]);
	});

	it("excludes the last logged commit itself but includes everything after it", () => {
		const state = { lastLoggedHash: old.hash, lastLoggedAt: old.date };
		const w = logWindow(state, MIDNIGHT);
		expect(selectCommits([old, missed, early, now], w, state).map((c) => c.subject)).toEqual(["missed yesterday", "at midnight", "today"]);
	});

	it("drops commits with unparseable dates", () => {
		const bad = commit({ short: "0000005", date: "not a date" });
		expect(selectCommits([bad, now], logWindow(undefined, MIDNIGHT))).toEqual([now]);
	});
});

describe("nextState", () => {
	it("bookmarks the newest commit written", () => {
		const a = commit({ short: "0000001", date: "2026-11-07T09:00:00-07:00" });
		const b = commit({ short: "0000002", date: "2026-11-07T11:00:00-07:00" });
		expect(nextState([a, b], undefined)).toEqual({ lastLoggedHash: b.hash, lastLoggedAt: b.date });
	});

	it("keeps the previous bookmark when nothing new was written or the old one is newer", () => {
		const prev = { lastLoggedHash: "f".repeat(40), lastLoggedAt: "2026-11-07T12:00:00-07:00" };
		expect(nextState([], prev)).toBe(prev);
		expect(nextState([commit({ short: "0000001", date: "2026-11-07T09:00:00-07:00" })], prev)).toBe(prev);
		expect(nextState([], undefined)).toBeUndefined();
	});
});
