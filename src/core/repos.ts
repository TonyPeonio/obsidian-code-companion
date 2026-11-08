// Repository configuration and the per-repository bookkeeping the plugin stores.

export interface RepoConfig {
	/** Display name, usually the folder name. */
	name: string;
	/** Absolute path of the working tree. */
	path: string;
	/** Overrides the `origin` remote when building commit links. */
	remoteUrl?: string;
	/** Informational; shown in settings, used as a hint when a remote is missing. */
	defaultBranch?: string;
}

/** What "Log today's work" remembers per repository (keyed by `RepoConfig.path`). */
export interface RepoState {
	/** Full hash of the newest commit that has been written to a daily note. */
	lastLoggedHash: string;
	/** Author date (ISO 8601 with offset) of that commit. */
	lastLoggedAt: string;
}

export type RepoStates = Record<string, RepoState>;

/** `C:\Users\me\proj` or `/home/me/proj` → `proj`. */
export function repoNameFromPath(p: string): string {
	const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || p;
}

/** Author entries as the user typed them, one per line, trimmed and de-duplicated. */
export function parseAuthorList(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n|,/)) {
		const s = raw.trim();
		if (s && !out.includes(s)) out.push(s);
	}
	return out;
}
