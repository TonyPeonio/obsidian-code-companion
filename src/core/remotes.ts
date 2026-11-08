// Remote URL → browsable commit links for the hosts developers actually use.

export type RemoteKind = "github" | "gitlab" | "bitbucket" | "other";

export interface RemoteInfo {
	host: string;
	/** `owner/repo` (or a deeper group path on GitLab), without `.git`. */
	path: string;
	kind: RemoteKind;
}

/**
 * Accepts `git@host:owner/repo.git`, `ssh://git@host[:port]/owner/repo.git`,
 * `https://[user@]host/owner/repo[.git]` and `git://host/owner/repo`.
 */
export function parseRemote(url: string | undefined): RemoteInfo | undefined {
	if (!url) return undefined;
	const s = url.trim();
	if (!s) return undefined;
	let host: string;
	let path: string;
	const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(s);
	const full = /^(?:ssh|https?|git|git\+ssh):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(s);
	if (full) {
		host = full[1];
		path = full[2];
	} else if (scp && !/^[A-Za-z]$/.test(scp[1]) && !scp[2].includes("\\")) {
		// A single-letter "host" is a Windows drive, not a remote.
		host = scp[1];
		path = scp[2];
	} else return undefined;
	path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
	if (!path) return undefined;
	const h = host.toLowerCase();
	const kind: RemoteKind = h === "github.com" || h.endsWith(".github.com") || h.includes("github") ? "github" : h.includes("gitlab") ? "gitlab" : h.includes("bitbucket") ? "bitbucket" : "other";
	return { host, path, kind };
}

/** The repository's web page, when the remote is understood. */
export function browsableRemote(url: string | undefined): string | undefined {
	const r = parseRemote(url);
	return r ? `https://${r.host}/${r.path}` : undefined;
}

/**
 * The web page of one commit. GitHub (and Gitea/Forgejo-shaped hosts) use `/commit/<hash>`,
 * GitLab `/-/commit/<hash>`, Bitbucket `/commits/<hash>`.
 */
export function commitUrl(remote: string | undefined, hash: string): string | undefined {
	const r = parseRemote(remote);
	if (!r || !hash) return undefined;
	const base = `https://${r.host}/${r.path}`;
	switch (r.kind) {
		case "gitlab":
			return `${base}/-/commit/${hash}`;
		case "bitbucket":
			return `${base}/commits/${hash}`;
		default:
			return `${base}/commit/${hash}`;
	}
}
