// TODO markers in comments across a repository, and the note that lists them with editor links.

import { humanAge, plural, thousands } from "./dates";
import { safeGit, type RunGit } from "./git";

export interface TodoHit {
	/** Repo-relative path, forward slashes. */
	file: string;
	/** 1-based. */
	line: number;
	marker: string;
	text: string;
	/** From `git blame`, only when asked for. */
	age?: string;
}

export interface TodoRepoResult {
	name: string;
	/** Absolute path of the working tree. */
	path: string;
	hits: TodoHit[];
	filesScanned: number;
	error?: string;
}

export type EditorScheme = "vscode" | "idea" | "path";

/** Reads a file as text; null when it is missing, unreadable, binary or too large. */
export type ReadFile = (absPath: string) => string | null;

export const DEFAULT_MARKERS = "TODO|FIXME|HACK|XXX";

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches `// TODO`, `# FIXME`, `/* HACK`, `* XXX` (block-comment continuation), `<!-- TODO`,
 * `-- TODO` (SQL, Lua), `; TODO` (Lisp, ini), `% TODO` (TeX) and `' TODO` (VB), plus a marker at
 * the start of a line. An optional `(owner)` and `:` follow the marker. Case-sensitive on purpose.
 */
export function todoRegex(markers: string = DEFAULT_MARKERS): RegExp {
	const alts = markers
		.split("|")
		.map((m) => m.trim())
		.filter(Boolean)
		.map(escapeRegExp);
	const list = alts.length ? alts.join("|") : escapeRegExp("TODO");
	return new RegExp(`(?:^\\s*|(?:\\/\\/|\\/\\*+|\\*|#|<!--|--|;|%|')\\s*)(${list})\\b(?:\\([^)]*\\))?:?\\s*(.*)$`);
}

/** Strips comment closers and trims the TODO text. */
export function cleanTodoText(text: string): string {
	return text
		.replace(/\s*(\*\/|-->|#\}|%>|\}\})\s*$/, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 200);
}

export function scanText(text: string, regex: RegExp, file: string): TodoHit[] {
	const hits: TodoHit[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = regex.exec(lines[i]);
		if (!m) continue;
		hits.push({ file, line: i + 1, marker: m[1], text: cleanTodoText(m[2] ?? "") });
	}
	return hits;
}

const BINARY_EXT = new Set([
	"png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svgz", "pdf", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war",
	"class", "pyc", "pyo", "exe", "dll", "so", "dylib", "a", "lib", "o", "obj", "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "m4a", "wav",
	"ogg", "flac", "mov", "avi", "mkv", "webm", "bin", "dat", "db", "sqlite", "sqlite3", "parquet", "npy", "npz", "pkl", "pickle", "h5", "hdf5",
	"onnx", "pt", "pth", "safetensors", "gguf", "psd", "ai", "sketch", "fig", "lock", "min.js", "min.css", "map",
]);

export function isTextCandidate(path: string): boolean {
	const name = path.split("/").pop() ?? path;
	const lower = name.toLowerCase();
	if (lower === "package-lock.json" || lower === "yarn.lock" || lower === "pnpm-lock.yaml") return false;
	const parts = lower.split(".");
	if (parts.length < 2) return true;
	const ext = parts[parts.length - 1];
	const two = parts.slice(-2).join(".");
	return !BINARY_EXT.has(ext) && !BINARY_EXT.has(two);
}

/** Tracked and untracked-but-not-ignored files, repo-relative with forward slashes. */
export function listRepoFiles(runGit: RunGit): string[] {
	const out = safeGit(runGit, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
	return out
		.split("\0")
		.map((s) => s.trim())
		.filter(Boolean)
		.map(unquoteGitPath);
}

function unquoteGitPath(p: string): string {
	return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p;
}

/** Joins the working-tree path and a repo-relative path with the working tree's own separator. */
export function joinPath(repoPath: string, rel: string): string {
	const sep = repoPath.includes("\\") ? "\\" : "/";
	const base = repoPath.replace(/[\\/]+$/, "");
	return `${base}${sep}${sep === "\\" ? rel.replace(/\//g, "\\") : rel}`;
}

export interface ScanOptions {
	markers?: string;
	/** `git blame` each hit for its age (slow on big repositories). */
	blame?: boolean;
	maxFiles?: number;
	nowMs?: number;
}

export function scanRepo(runGit: RunGit, repoPath: string, readFile: ReadFile, opts: ScanOptions = {}): { hits: TodoHit[]; filesScanned: number } {
	const regex = todoRegex(opts.markers ?? DEFAULT_MARKERS);
	const files = listRepoFiles(runGit).filter(isTextCandidate).slice(0, opts.maxFiles ?? 20_000);
	const hits: TodoHit[] = [];
	let filesScanned = 0;
	for (const rel of files) {
		const text = readFile(joinPath(repoPath, rel));
		if (text === null || text.includes("\0")) continue;
		filesScanned++;
		hits.push(...scanText(text, regex, rel));
	}
	if (opts.blame) for (const h of hits) h.age = blameAge(runGit, h.file, h.line, opts.nowMs ?? Date.now());
	hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	return { hits, filesScanned };
}

/** `git blame -L n,n --porcelain` → human age of the line, undefined when blame fails (untracked file). */
export function blameAge(runGit: RunGit, file: string, line: number, nowMs: number): string | undefined {
	const out = safeGit(runGit, ["blame", "-L", `${line},${line}`, "--porcelain", "--", file]);
	const m = /^author-time (\d+)$/m.exec(out);
	return m ? humanAge(Number(m[1]) * 1000, nowMs) : undefined;
}

// ---------------------------------------------------------------- links and rendering

function encodePathForUrl(absPath: string): string {
	return absPath
		.replace(/\\/g, "/")
		.split("/")
		.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
		.join("/");
}

/** The URL an editor opens at `absPath:line`; undefined for the plain-path scheme. */
export function editorLink(scheme: EditorScheme, absPath: string, line: number): string | undefined {
	const p = encodePathForUrl(absPath);
	switch (scheme) {
		case "vscode":
			return `vscode://file/${p.replace(/^\//, "")}:${line}`;
		case "idea":
			return `idea://open?file=${p}&line=${line}`;
		default:
			return undefined;
	}
}

function cell(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export const TODO_ROW_CAP = 500;

export function renderTodoNote(repos: TodoRepoResult[], scheme: EditorScheme, opts: { cap?: number; generatedOn?: string; showAge?: boolean } = {}): string {
	const cap = opts.cap ?? TODO_ROW_CAP;
	const total = repos.reduce((n, r) => n + r.hits.length, 0);
	const lines: string[] = ["# TODOs", ""];
	lines.push(`${plural(total, "marker")} across ${plural(repos.length, "repository", "repositories")}${opts.generatedOn ? `, scanned ${opts.generatedOn}` : ""}. Code Companion rewrites this note on every scan.`);
	if (total > cap) lines.push("", `> [!warning] Showing the first ${thousands(cap)} of ${thousands(total)} markers. Fix a few, narrow the markers in settings, or scan fewer repositories.`);
	lines.push("");
	let budget = cap;
	for (const r of repos) {
		lines.push(`## ${r.name} (${thousands(r.hits.length)})`, "");
		if (r.error) {
			lines.push(`git failed: ${r.error}`, "");
			continue;
		}
		if (r.hits.length === 0) {
			lines.push(`No markers in ${plural(r.filesScanned, "file")}.`, "");
			continue;
		}
		const age = opts.showAge ?? r.hits.some((h) => h.age !== undefined);
		lines.push(age ? "| Where | Marker | Text | Age |" : "| Where | Marker | Text |", age ? "|---|---|---|---|" : "|---|---|---|");
		let shown = 0;
		for (const h of r.hits) {
			if (budget <= 0) break;
			budget--;
			shown++;
			const abs = joinPath(r.path, h.file);
			const url = editorLink(scheme, abs, h.line);
			const where = url ? `[${cell(h.file)}:${h.line}](${url})` : `\`${cell(abs)}:${h.line}\``;
			const row = [where, h.marker, cell(h.text) || "—"];
			if (age) row.push(h.age ?? "—");
			lines.push(`| ${row.join(" | ")} |`);
		}
		if (shown < r.hits.length) lines.push("", `_${thousands(r.hits.length - shown)} more not shown (${thousands(cap)}-row cap)._`);
		lines.push("");
	}
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
