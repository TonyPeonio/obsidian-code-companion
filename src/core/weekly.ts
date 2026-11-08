// The weekly report: per-repository stats for an ISO week, commits grouped by day, and the
// optional model summary (prompt, parsing, and the citation check that keeps it honest).

import { formatDelta, localDay, plural, thousands, weekday, type IsoWeek, isoWeekLabel } from "./dates";
import { sortByDate, sumStats, type Commit, type Stats } from "./git";
import { commitUrl } from "./remotes";
import { cleanPath } from "./vault";

export interface RepoWeek {
	name: string;
	/** The user's commits inside the week, any order. */
	commits: Commit[];
	remoteUrl?: string;
	/** Model summary bullets, already citation-checked. */
	summary?: string[];
	error?: string;
}

export interface WeekStats extends Stats {
	busiestDay?: { date: string; commits: number };
}

export function weekStats(commits: Commit[]): WeekStats {
	const base = sumStats(commits);
	const perDay = new Map<string, number>();
	for (const c of commits) {
		const d = localDay(c.date);
		perDay.set(d, (perDay.get(d) ?? 0) + 1);
	}
	let busiestDay: WeekStats["busiestDay"];
	for (const [date, n] of Array.from(perDay.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
		if (!busiestDay || n > busiestDay.commits) busiestDay = { date, commits: n };
	}
	return { ...base, busiestDay };
}

/** Commits by local day, days ascending, commits oldest first within a day. */
export function groupByDay(commits: Commit[]): Map<string, Commit[]> {
	const out = new Map<string, Commit[]>();
	for (const c of sortByDate(commits)) {
		const d = localDay(c.date);
		const list = out.get(d);
		if (list) list.push(c);
		else out.set(d, [c]);
	}
	return new Map(Array.from(out.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

/** Keeps the commits whose author day falls inside the week's dates. */
export function commitsInWeek(commits: Commit[], dates: string[]): Commit[] {
	const set = new Set(dates);
	return commits.filter((c) => set.has(localDay(c.date)));
}

export function reportPath(folder: string, week: IsoWeek): string {
	return `${cleanPath(`${cleanPath(folder)}/Code week ${isoWeekLabel(week)}`)}.md`;
}

function dayLabel(date: string): string {
	return `${weekday(date)} ${date}`;
}

export interface ReportOptions {
	/** Named when a summary was produced, for the footnote. */
	model?: string;
	generatedOn?: string;
}

export function renderWeeklyReport(week: IsoWeek, dates: string[], repos: RepoWeek[], opts: ReportOptions = {}): string {
	const label = isoWeekLabel(week);
	const all = repos.flatMap((r) => r.commits);
	const total = sumStats(all);
	const lines: string[] = [`# Code week ${label}`, ""];
	lines.push(`${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])} · ${plural(repos.length, "repository", "repositories")} · ${plural(total.commits, "commit")} · ${formatDelta(total.added, total.deleted)} · ${plural(total.files, "file")}`);
	lines.push("");
	if (repos.length > 0) {
		lines.push("| Repository | Commits | Lines | Files | Busiest day |", "|---|---|---|---|---|");
		for (const r of repos) {
			if (r.error) {
				lines.push(`| ${r.name} | git failed: ${r.error} | | | |`);
				continue;
			}
			const s = weekStats(r.commits);
			lines.push(`| ${r.name} | ${thousands(s.commits)} | ${formatDelta(s.added, s.deleted)} | ${thousands(s.files)} | ${s.busiestDay ? `${dayLabel(s.busiestDay.date)} (${s.busiestDay.commits})` : "—"} |`);
		}
		lines.push("");
	} else {
		lines.push("No repositories configured. Add one in Code Companion's settings.", "");
	}
	for (const r of repos) {
		lines.push(`## ${r.name}`, "");
		if (r.error) {
			lines.push(`git failed: ${r.error}`, "");
			continue;
		}
		const s = weekStats(r.commits);
		if (s.commits === 0) {
			lines.push("No commits this week.", "");
			continue;
		}
		lines.push(`${plural(s.commits, "commit")} · ${formatDelta(s.added, s.deleted)} · ${plural(s.files, "file")}${s.busiestDay ? ` · busiest day ${dayLabel(s.busiestDay.date)} (${plural(s.busiestDay.commits, "commit")})` : ""}`, "");
		if (r.summary && r.summary.length > 0) {
			lines.push("### Summary", "");
			for (const b of r.summary) lines.push(`- ${b}`);
			lines.push("");
		}
		lines.push("### Commits", "");
		for (const [date, commits] of groupByDay(r.commits)) {
			lines.push(`#### ${dayLabel(date)}`, "");
			for (const c of commits) {
				const url = commitUrl(r.remoteUrl, c.hash);
				const files = c.files.length ? ` · ${plural(c.files.length, "file")}` : "";
				lines.push(`- \`${c.short}\` ${c.subject.replace(/\s+/g, " ").trim() || "(no subject)"}${files}${url ? ` — [open](${url})` : ""}`);
			}
			lines.push("");
		}
	}
	const hasSummary = repos.some((r) => r.summary && r.summary.length > 0);
	lines.push("---", "");
	lines.push(`Written by Code Companion${opts.generatedOn ? ` on ${opts.generatedOn}` : ""} from \`git log\` on this machine.${hasSummary && opts.model ? ` Summaries by ${opts.model} from commit messages only; every cited hash was checked against the week's commits.` : ""}`);
	return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

// ---------------------------------------------------------------- model summary

export const SUMMARY_BULLETS = 5;

export function summarySystemPrompt(bullets = SUMMARY_BULLETS): string {
	return [
		`You write a short weekly summary of one developer's work in one git repository, from the commit messages only.`,
		`Reply with exactly ${bullets} bullets, each on one line starting with "- ", in plain language a teammate would understand.`,
		`Group related commits into one bullet; lead with the most significant work. Fewer bullets are fine when there are fewer commits.`,
		`End every bullet with the short hashes of the commits it describes, in parentheses, like (a1b2c3d, 9fd9742). Cite only hashes from the list.`,
		`Use only what the commit messages say. Never invent a commit, a file, a number or a result.`,
		`No heading, no preamble, nothing after the bullets.`,
	].join("\n");
}

/** The commit list for the model, oldest first, trimmed to `maxChars` (whole commits). */
export function summaryUserMessage(repoName: string, week: IsoWeek, commits: Commit[], maxChars = 40_000): { message: string; truncated: boolean } {
	const sorted = sortByDate(commits);
	const header = `Repository: ${repoName}\nWeek: ${isoWeekLabel(week)}\nCommits (${sorted.length}), oldest first:\n\n`;
	const entries = sorted.map((c) => {
		const body = c.body
			.split("\n")
			.map((l) => l.trimEnd())
			.filter((l) => l && !/^(Co-Authored-By|Signed-off-by|Reviewed-by):/i.test(l))
			.map((l) => `    ${l}`)
			.join("\n");
		return `${c.short} ${localDay(c.date)} — ${c.subject}${body ? `\n${body}` : ""}`;
	});
	let used = header.length;
	const kept: string[] = [];
	let truncated = false;
	for (const e of entries) {
		if (used + e.length + 2 > maxChars) {
			truncated = true;
			break;
		}
		kept.push(e);
		used += e.length + 2;
	}
	const tail = truncated ? `\n\n(${entries.length - kept.length} more commits omitted to fit the context window)` : "";
	return { message: header + kept.join("\n\n") + tail, truncated };
}

/** Bullet lines from the reply (`-`, `*`, `•` or `1.`), at most `max`. */
export function parseSummaryBullets(reply: string, max = SUMMARY_BULLETS): string[] {
	const out: string[] = [];
	for (const raw of reply.replace(/<think>[\s\S]*?<\/think>/g, "").split(/\r?\n/)) {
		const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(raw);
		if (!m) continue;
		const text = m[1].trim();
		if (text) out.push(text);
		if (out.length >= max) break;
	}
	return out;
}

const HASH_TOKEN = /\b[0-9a-f]{7,40}\b/g;

/** True when `token` is a prefix (7+ chars) of a known full hash. */
export function knownHash(token: string, hashes: string[]): string | undefined {
	const t = token.toLowerCase();
	if (t.length < 7) return undefined;
	return hashes.find((h) => h.startsWith(t));
}

/**
 * Deterministic citation check: hashes that are not in `commits` are removed; the bullet keeps
 * its valid citations as `(\`short\`, …)` at the end, or is marked when none survive.
 */
export function filterCitations(bullets: string[], commits: Commit[]): string[] {
	const hashes = commits.map((c) => c.hash.toLowerCase());
	const shortFor = new Map(commits.map((c) => [c.hash.toLowerCase(), c.short]));
	const out: string[] = [];
	for (const bullet of bullets) {
		const cited: string[] = [];
		for (const tok of bullet.match(HASH_TOKEN) ?? []) {
			const full = knownHash(tok, hashes);
			if (full) {
				const short = shortFor.get(full) ?? full.slice(0, 7);
				if (!cited.includes(short)) cited.push(short);
			}
		}
		let text = bullet
			.replace(/\(\s*(?:`?\b[0-9a-f]{7,40}\b`?\s*,?\s*)+\)/g, " ")
			.replace(/`?\b[0-9a-f]{7,40}\b`?/g, " ")
			.replace(/\s{2,}/g, " ")
			.replace(/\s+([.,;:])/g, "$1")
			.trim()
			.replace(/^[-–—:\s]+|[\s—–-]+$/g, "");
		if (!text) continue;
		text += cited.length ? ` (${cited.map((s) => `\`${s}\``).join(", ")})` : " _(no matching commit)_";
		out.push(text);
	}
	return out;
}
