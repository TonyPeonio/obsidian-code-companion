// Git through an injected runner, so the core never spawns a process itself. The plugin passes
// `execFileSync("git", args, { cwd })`; tests pass a table of canned answers.

/** Runs `git <args>` in the repository folder and returns stdout; throws when git fails. */
export type RunGit = (args: string[]) => string;

export interface FileChange {
	/** Repo-relative path (the new path for renames). */
	path: string;
	added: number;
	deleted: number;
	/** `-` counts from git: the file is binary. */
	binary: boolean;
}

export interface Commit {
	hash: string;
	short: string;
	/** Author date, ISO 8601 with offset (`%aI`). */
	date: string;
	authorName: string;
	authorEmail: string;
	parents: string[];
	isMerge: boolean;
	subject: string;
	body: string;
	files: FileChange[];
}

/**
 * One record per commit: fields separated by the ASCII unit separator, records by the record
 * separator, so subjects and bodies may contain anything printable. `--numstat` lines follow each
 * record (git puts a blank line between them).
 */
export const LOG_FORMAT = "%H%x1f%h%x1f%aI%x1f%an%x1f%ae%x1f%P%x1f%s%x1f%b%x1e";

export interface LogOptions {
	/** ISO timestamp passed to `--after`; the precise cut is applied afterwards in JS. */
	after?: string;
	before?: string;
	/** `--author` patterns (fixed strings, OR-ed by git). Exact matching happens in `filterByAuthor`. */
	authors?: string[];
	maxCount?: number;
}

/** Arguments for `git log` over every local branch (and HEAD, for detached work). */
export function logArgs(opts: LogOptions = {}): string[] {
	const args = ["log", "--branches", "HEAD", "--numstat", "--fixed-strings", `--format=${LOG_FORMAT}`];
	if (opts.after) args.push(`--after=${opts.after}`);
	if (opts.before) args.push(`--before=${opts.before}`);
	for (const a of opts.authors ?? []) args.push(`--author=${a}`);
	if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
	args.push("--");
	return args;
}

const UNIT_SEPARATOR = String.fromCharCode(0x1f);

/** A record starts with the 40-hex `%H` followed by the unit separator; numstat lines never do. */
function isRecordStart(line: string): boolean {
	return line.length > 40 && line.charAt(40) === UNIT_SEPARATOR && /^[0-9a-f]{40}$/.test(line.slice(0, 40));
}

/** Parses the output of `git log --numstat --format=LOG_FORMAT`. Order is git's (newest first). */
export function parseGitLog(text: string): Commit[] {
	if (!text.trim()) return [];
	const chunks = text.replace(/\r\n/g, "\n").split("\x1e");
	const commits: Commit[] = [];
	let pending: Commit | null = null;
	for (const chunk of chunks) {
		const lines = chunk.split("\n");
		const recordIdx = lines.findIndex(isRecordStart);
		const statLines = recordIdx < 0 ? lines : lines.slice(0, recordIdx);
		if (pending) pending.files = parseNumstat(statLines);
		if (recordIdx < 0) {
			pending = null;
			continue;
		}
		const fields = lines.slice(recordIdx).join("\n").split("\x1f");
		if (fields.length < 8) {
			pending = null;
			continue;
		}
		const parents = fields[5].split(" ").filter(Boolean);
		pending = {
			hash: fields[0],
			short: fields[1],
			date: fields[2],
			authorName: fields[3],
			authorEmail: fields[4],
			parents,
			isMerge: parents.length > 1,
			subject: fields[6].trim(),
			body: fields.slice(7).join("\x1f").trim(),
			files: [],
		};
		commits.push(pending);
	}
	return commits;
}

/** `added<TAB>deleted<TAB>path` lines; `-` for binaries; rename braces resolved to the new path. */
export function parseNumstat(lines: string[]): FileChange[] {
	const out: FileChange[] = [];
	for (const line of lines) {
		const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.replace(/\r$/, ""));
		if (!m) continue;
		const binary = m[1] === "-" || m[2] === "-";
		out.push({ path: renamedPath(m[3]), added: binary ? 0 : Number(m[1]), deleted: binary ? 0 : Number(m[2]), binary });
	}
	return out;
}

/** `src/{old => new}/x.ts` → `src/new/x.ts`; `a.ts => b.ts` → `b.ts`. */
export function renamedPath(p: string): string {
	if (p.includes("{") && p.includes(" => ")) return p.replace(/\{[^{}]*? => ([^{}]*)\}/g, "$1").replace(/\/{2,}/g, "/");
	const arrow = p.indexOf(" => ");
	return arrow >= 0 ? p.slice(arrow + 4) : p;
}

// ---------------------------------------------------------------- authors

/** Entries may be a name, an email, or `Name <email>`; matching is exact and case-insensitive. */
export function matchesAuthor(c: Pick<Commit, "authorName" | "authorEmail">, authors: string[]): boolean {
	if (authors.length === 0) return true;
	const name = c.authorName.trim().toLowerCase();
	const email = c.authorEmail.trim().toLowerCase();
	for (const raw of authors) {
		const entry = raw.trim().toLowerCase();
		if (!entry) continue;
		const m = /^(.*?)\s*<([^>]*)>$/.exec(entry);
		if (m) {
			if ((m[1] && m[1] === name) || (m[2] && m[2] === email)) return true;
		} else if (entry === name || entry === email) return true;
	}
	return false;
}

export function filterByAuthor(commits: Commit[], authors: string[]): Commit[] {
	return commits.filter((c) => matchesAuthor(c, authors));
}

/** `git config user.name` and `user.email` of the repository (or the global config), as an author list. */
export function repoAuthors(runGit: RunGit): string[] {
	const out: string[] = [];
	for (const key of ["user.name", "user.email"]) {
		const v = safeGit(runGit, ["config", key]).trim();
		if (v) out.push(v);
	}
	return out;
}

// ---------------------------------------------------------------- repository facts

export function safeGit(runGit: RunGit, args: string[]): string {
	try {
		return runGit(args);
	} catch {
		return "";
	}
}

export function isGitRepo(runGit: RunGit): boolean {
	try {
		return runGit(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
	} catch {
		return false;
	}
}

export interface RepoFacts {
	toplevel: string;
	branch: string;
	remoteUrl?: string;
	defaultBranch?: string;
}

export function repoFacts(runGit: RunGit): RepoFacts {
	const toplevel = safeGit(runGit, ["rev-parse", "--show-toplevel"]).trim();
	const branch = safeGit(runGit, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD";
	const remote = safeGit(runGit, ["remote", "get-url", "origin"]).trim();
	const head = safeGit(runGit, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
	const defaultBranch = head ? head.replace(/^origin\//, "") : branch !== "HEAD" ? branch : undefined;
	return { toplevel, branch, remoteUrl: remote || undefined, defaultBranch };
}

export interface WorkingTree {
	/** Tracked files with staged or unstaged changes. */
	files: number;
	added: number;
	deleted: number;
	untracked: number;
}

/** Uncommitted changes against HEAD plus untracked files. All zeros for a clean tree or an empty repo. */
export function workingTree(runGit: RunGit): WorkingTree {
	const changes = parseNumstat(safeGit(runGit, ["diff", "--numstat", "HEAD", "--"]).split("\n"));
	const status = safeGit(runGit, ["status", "--porcelain", "--untracked-files=all"]);
	const untracked = status.split(/\r?\n/).filter((l) => l.startsWith("??")).length;
	return {
		files: changes.length,
		added: changes.reduce((n, c) => n + c.added, 0),
		deleted: changes.reduce((n, c) => n + c.deleted, 0),
		untracked,
	};
}

export function isDirty(wt: WorkingTree): boolean {
	return wt.files > 0 || wt.untracked > 0;
}

// ---------------------------------------------------------------- stats

export interface Stats {
	commits: number;
	added: number;
	deleted: number;
	/** Distinct paths touched. */
	files: number;
}

export function sumStats(commits: Commit[]): Stats {
	const paths = new Set<string>();
	let added = 0;
	let deleted = 0;
	for (const c of commits) {
		for (const f of c.files) {
			paths.add(f.path);
			added += f.added;
			deleted += f.deleted;
		}
	}
	return { commits: commits.length, added, deleted, files: paths.size };
}

/** Oldest first by author date (stable for equal dates). */
export function sortByDate(commits: Commit[]): Commit[] {
	return commits
		.map((c, i) => ({ c, i, t: Date.parse(c.date) }))
		.sort((a, b) => a.t - b.t || a.i - b.i)
		.map((x) => x.c);
}
