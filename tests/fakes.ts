import type { Commit, RunGit } from "../src/core/git";
import type { VaultAccess } from "../src/core/vault";

/** In-memory vault for tests. */
export class FakeVault implements VaultAccess {
	files = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const c = this.files.get(path);
		if (c === undefined) throw new Error(`Note not found: ${path}`);
		return c;
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`Already exists: ${path}`);
		this.files.set(path, content);
	}

	async modify(path: string, content: string): Promise<void> {
		if (!this.files.has(path)) throw new Error(`Note not found: ${path}`);
		this.files.set(path, content);
	}
}

export type GitAnswer = string | ((args: string[]) => string);

/**
 * A `RunGit` answering from a table keyed by subcommand (`log`, `diff`, `status`, `config`,
 * `remote`, …). A function answer sees the full argument list. Missing keys throw like git would.
 * Every call is recorded in `calls`.
 */
export function fakeGit(table: Record<string, GitAnswer>): RunGit & { calls: string[][] } {
	const calls: string[][] = [];
	const run = ((args: string[]) => {
		calls.push(args);
		const key = args[0] === "config" ? `config ${args[1]}` : args[0];
		const answer = table[key] ?? table[args[0]];
		if (answer === undefined) throw new Error(`fatal: fake git has no answer for: git ${args.join(" ")}`);
		return typeof answer === "function" ? answer(args) : answer;
	}) as RunGit & { calls: string[][] };
	run.calls = calls;
	return run;
}

/** Builds a raw `git log --numstat --format=LOG_FORMAT` record. */
export function logRecord(c: { hash?: string; short?: string; date: string; name?: string; email?: string; parents?: string; subject: string; body?: string; files?: string[] }): string {
	const hash = c.hash ?? (c.short ?? "abc1234").padEnd(40, "0");
	const short = c.short ?? hash.slice(0, 7);
	const fields = [hash, short, c.date, c.name ?? "Tony Peonio", c.email ?? "tony@example.com", c.parents ?? "f".repeat(40), c.subject, c.body ?? ""];
	const files = (c.files ?? []).map((f) => `${f}\n`).join("");
	return `${fields.join("\x1f")}\x1e\n${files ? `\n${files}` : ""}`;
}

/** A parsed commit for rendering tests. */
export function commit(over: Partial<Commit> & { short: string }): Commit {
	const hash = over.hash ?? over.short.padEnd(40, "0");
	return {
		hash,
		short: over.short,
		date: over.date ?? "2026-11-07T10:00:00-07:00",
		authorName: over.authorName ?? "Tony Peonio",
		authorEmail: over.authorEmail ?? "tony@example.com",
		parents: over.parents ?? ["f".repeat(40)],
		isMerge: over.isMerge ?? false,
		subject: over.subject ?? "Do a thing",
		body: over.body ?? "",
		files: over.files ?? [],
	};
}
