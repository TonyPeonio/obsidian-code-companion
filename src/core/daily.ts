// The block "Log today's work" writes under the daily note's code heading, and how it is placed.

import { formatDate, formatDelta, localDay, plural, shortDate } from "./dates";
import { isDirty, sortByDate, sumStats, type Commit, type WorkingTree } from "./git";
import { commitUrl } from "./remotes";
import { cleanPath } from "./vault";

export const START_MARKER = "<!-- code-companion:start -->";
export const END_MARKER = "<!-- code-companion:end -->";

export interface RepoDay {
	name: string;
	/** Already filtered to the user's commits inside the window. */
	commits: Commit[];
	workingTree?: WorkingTree;
	remoteUrl?: string;
	/** Set when git failed for this repository; shown instead of commits. */
	error?: string;
}

/** Up to `max` repo-relative paths, then `+N more`. */
export function abbreviateFiles(paths: string[], max = 5): string {
	if (paths.length <= max) return paths.join(", ");
	return `${paths.slice(0, max).join(", ")}, +${paths.length - max} more`;
}

/** One commit line; the date is shown when the commit is not from `today`. */
export function renderCommitLine(c: Commit, remoteUrl: string | undefined, today: string, indent = "  "): string {
	const day = localDay(c.date);
	const when = day !== today ? ` (${shortDate(day)})` : "";
	const subject = c.subject.replace(/\s+/g, " ").trim() || "(no subject)";
	const files = c.files.length ? ` (${abbreviateFiles(c.files.map((f) => f.path))})` : c.isMerge ? " (merge)" : "";
	const url = commitUrl(remoteUrl, c.hash);
	const link = url ? ` — [open](${url})` : "";
	return `${indent}- \`${c.short}\`${when} ${subject}${files}${link}`;
}

export function renderWorkingTreeLine(wt: WorkingTree, indent = "  "): string {
	const parts = [`${plural(wt.files, "file")} changed`, formatDelta(wt.added, wt.deleted)];
	if (wt.untracked) parts.push(`${plural(wt.untracked, "untracked file")}`);
	return `${indent}- working tree: ${parts.join(", ")} (not committed)`;
}

/** The whole block, markers included, one sub-list per repository. */
export function renderDailyBlock(repos: RepoDay[], today: string): string {
	const lines: string[] = [START_MARKER];
	if (repos.length === 0) lines.push("- No repositories configured. Add one in Code Companion's settings.");
	for (const r of repos) {
		if (r.error) {
			lines.push(`- **${r.name}** · git failed: ${r.error}`);
			continue;
		}
		const commits = sortByDate(r.commits);
		const dirty = r.workingTree && isDirty(r.workingTree);
		if (commits.length === 0) {
			lines.push(`- **${r.name}** · no commits`);
		} else {
			const s = sumStats(commits);
			lines.push(`- **${r.name}** · ${plural(s.commits, "commit")} · ${formatDelta(s.added, s.deleted)} · ${plural(s.files, "file")}`);
			for (const c of commits) lines.push(renderCommitLine(c, r.remoteUrl, today));
		}
		if (dirty && r.workingTree) lines.push(renderWorkingTreeLine(r.workingTree));
	}
	lines.push(END_MARKER);
	return lines.join("\n");
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces the marked block when one exists, otherwise inserts a fresh block under `heading`
 * (adding the heading at the end when the note has none). Never duplicates.
 */
export function upsertBlock(content: string, heading: string, block: string): string {
	const text = content.replace(/\r\n/g, "\n");
	const start = text.indexOf(START_MARKER);
	const end = text.indexOf(END_MARKER, start < 0 ? 0 : start);
	if (start >= 0 && end >= 0) {
		const lineStart = text.lastIndexOf("\n", start - 1) + 1;
		const endOfEnd = end + END_MARKER.length;
		return text.slice(0, lineStart) + block + text.slice(endOfEnd);
	}
	const headingRe = new RegExp(`^${escapeRegExp(heading.trim())}[ \\t]*$`, "im");
	const m = headingRe.exec(text);
	if (m) {
		const afterHeading = m.index + m[0].length;
		let rest = text.slice(afterHeading);
		rest = rest.replace(/^\n+/, "");
		const sep = rest.length ? "\n\n" : "\n";
		return `${text.slice(0, afterHeading)}\n\n${block}${sep}${rest}`;
	}
	const body = text.replace(/\s+$/, "");
	return `${body ? `${body}\n\n` : ""}${heading.trim()}\n\n${block}\n`;
}

/** The current block's inner lines (without markers), or undefined when the note has none. */
export function existingBlock(content: string): string | undefined {
	const start = content.indexOf(START_MARKER);
	const end = content.indexOf(END_MARKER, start < 0 ? 0 : start);
	if (start < 0 || end < 0) return undefined;
	return content.slice(start + START_MARKER.length, end).replace(/^\n|\n$/g, "");
}

// ---------------------------------------------------------------- daily note

/** `Daily/2026-11-07.md` from the folder and the format (which may itself contain `/`). */
export function dailyNotePath(folder: string, format: string, date: string): string {
	const name = formatDate(date, format.trim() || "YYYY-MM-DD");
	return `${cleanPath(`${cleanPath(folder)}/${name}`)}.md`;
}

/** A new daily note when no template is set: a title and the code heading. */
export function minimalDailyBody(date: string, heading: string): string {
	return `# ${date}\n\n${heading.trim()}\n`;
}

/** `{{date}}`, `{{date:FORMAT}}`, `{{title}}` and `{{time}}` as the core Templates plugin reads them. */
export function applyTemplate(template: string, date: string, title: string, now: Date = new Date()): string {
	const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	return template
		.replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, fmt: string) => formatDate(date, fmt))
		.replace(/\{\{\s*date\s*\}\}/g, date)
		.replace(/\{\{\s*title\s*\}\}/g, title)
		.replace(/\{\{\s*time\s*\}\}/g, time);
}

/** The heading text without its `#`s, for `note#heading` links. */
export function headingText(heading: string): string {
	return heading.replace(/^#+\s*/, "").trim();
}
