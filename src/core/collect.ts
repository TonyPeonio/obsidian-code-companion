// Orchestration of one repository for the daily block and the weekly report: which git calls,
// in which order, with which filters. Pure apart from the injected runner, so tests drive it
// with canned git output.

import { logWindow, nextState, selectCommits } from "./bookkeeping";
import type { RepoDay } from "./daily";
import { addDays, isoWeekDates, startOfDay, type IsoWeek } from "./dates";
import { filterByAuthor, logArgs, parseGitLog, repoAuthors, safeGit, workingTree, type RunGit } from "./git";
import type { RepoConfig, RepoState } from "./repos";
import { commitsInWeek, type RepoWeek } from "./weekly";

/** The configured author list, or the repository's own `user.name`/`user.email` when empty. */
export function authorsFor(runGit: RunGit, configured: string[]): string[] {
	const list = configured.map((a) => a.trim()).filter(Boolean);
	return list.length ? list : repoAuthors(runGit);
}

/** The remote to build links with: the override, else `origin`. */
export function remoteFor(runGit: RunGit, repo: RepoConfig): string | undefined {
	const override = repo.remoteUrl?.trim();
	if (override) return override;
	return safeGit(runGit, ["remote", "get-url", "origin"]).trim() || undefined;
}

function gitError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	const line = msg.split(/\r?\n/).find((l) => /fatal|error|not found|not recognized|ENOENT/i.test(l)) ?? msg.split(/\r?\n/)[0];
	return line.replace(/^Command failed:.*?\n?/i, "").trim().slice(0, 200) || "unknown error";
}

export interface DailyResult {
	day: RepoDay;
	next: RepoState | undefined;
}

/**
 * The user's commits since midnight (or since the last logged commit when that is older),
 * plus the working tree. `today` is the local date the block is written for.
 */
export function collectRepoDay(repo: RepoConfig, runGit: RunGit | null, configuredAuthors: string[], state: RepoState | undefined, today: string): DailyResult {
	if (!runGit) return { day: { name: repo.name, commits: [], error: "git is not available on this machine" }, next: state };
	const window = logWindow(state, startOfDay(today));
	try {
		const authors = authorsFor(runGit, configuredAuthors);
		// `--after` filters on committer date; author dates are compared in selectCommits. Reach a day
		// further back so a commit rebased after midnight is not missed.
		const after = window.source === "midnight" ? startOfDay(addDays(today, -1)) : window.after;
		const raw = parseGitLog(runGit(logArgs({ after, authors })));
		const commits = selectCommits(filterByAuthor(raw, authors), window, state);
		const day: RepoDay = { name: repo.name, commits, workingTree: workingTree(runGit), remoteUrl: remoteFor(runGit, repo) };
		return { day, next: nextState(commits, state) };
	} catch (err) {
		return { day: { name: repo.name, commits: [], error: gitError(err) }, next: state };
	}
}

/** The user's commits whose author day falls inside the ISO week. */
export function collectRepoWeek(repo: RepoConfig, runGit: RunGit | null, configuredAuthors: string[], week: IsoWeek): RepoWeek {
	if (!runGit) return { name: repo.name, commits: [], error: "git is not available on this machine" };
	const dates = isoWeekDates(week);
	try {
		const authors = authorsFor(runGit, configuredAuthors);
		// A day of slack on both sides: git filters on committer date, the report on author date.
		const after = startOfDay(addDays(dates[0], -1));
		const before = startOfDay(addDays(dates[6], 2));
		const raw = parseGitLog(runGit(logArgs({ after, before, authors })));
		const commits = commitsInWeek(filterByAuthor(raw, authors), dates);
		return { name: repo.name, commits, remoteUrl: remoteFor(runGit, repo) };
	} catch (err) {
		return { name: repo.name, commits: [], error: gitError(err) };
	}
}
