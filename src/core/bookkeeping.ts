// Which commits "Log today's work" should pick up, and what to remember afterwards.
//
// The window always covers today (so re-running replaces today's block with the same commits),
// and reaches further back when the last logged commit is older than today, so a day that was
// never logged is not lost: its commits land in today's block, marked with their date.

import type { Commit } from "./git";
import type { RepoState } from "./repos";

export interface LogWindow {
	/** ISO timestamp. */
	after: string;
	/** True: commits at exactly `after` count (midnight). False: strictly later (the last logged commit itself is excluded). */
	inclusive: boolean;
	/** Where the window came from, for messages. */
	source: "midnight" | "last-logged";
}

export function logWindow(state: RepoState | undefined, startOfToday: string): LogWindow {
	if (state?.lastLoggedAt) {
		const last = Date.parse(state.lastLoggedAt);
		const midnight = Date.parse(startOfToday);
		if (Number.isFinite(last) && Number.isFinite(midnight) && last < midnight) return { after: state.lastLoggedAt, inclusive: false, source: "last-logged" };
	}
	return { after: startOfToday, inclusive: true, source: "midnight" };
}

/** Applies the window precisely on author dates, and drops the commit the window starts from. */
export function selectCommits(commits: Commit[], window: LogWindow, state?: RepoState): Commit[] {
	const cut = Date.parse(window.after);
	return commits.filter((c) => {
		if (state && c.hash === state.lastLoggedHash && window.source === "last-logged") return false;
		const t = Date.parse(c.date);
		if (!Number.isFinite(t)) return false;
		return window.inclusive ? t >= cut : t > cut;
	});
}

/** The newest commit written becomes the bookmark; nothing new keeps the old bookmark. */
export function nextState(commits: Commit[], previous: RepoState | undefined): RepoState | undefined {
	let newest: Commit | undefined;
	for (const c of commits) if (!newest || Date.parse(c.date) > Date.parse(newest.date)) newest = c;
	if (!newest) return previous;
	if (previous && Date.parse(previous.lastLoggedAt) > Date.parse(newest.date)) return previous;
	return { lastLoggedHash: newest.hash, lastLoggedAt: newest.date };
}
