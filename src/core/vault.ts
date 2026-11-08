/**
 * Everything the core needs from the vault, so the journal code runs without Obsidian (the
 * plugin layer implements it over `app.vault`; tests use an in-memory fake).
 */
export interface VaultAccess {
	exists(path: string): boolean;
	read(path: string): Promise<string>;
	/** Creates the note and any missing parent folders. */
	create(path: string, content: string): Promise<void>;
	modify(path: string, content: string): Promise<void>;
}

/** Creates or overwrites. */
export async function writeNote(vault: VaultAccess, path: string, content: string): Promise<void> {
	if (vault.exists(path)) await vault.modify(path, content);
	else await vault.create(path, content);
}

/** Vault-relative path cleanup: forward slashes, no leading/trailing slashes, no doubles. */
export function cleanPath(p: string): string {
	return p
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+|\/+$/g, "");
}
