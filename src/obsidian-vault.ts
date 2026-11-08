import { App, TFile, normalizePath } from "obsidian";
import type { VaultAccess } from "./core/vault";

/** `VaultAccess` over the live Obsidian vault. */
export class ObsidianVault implements VaultAccess {
	constructor(private app: App) {}

	file(path: string): TFile | null {
		return this.app.vault.getFileByPath(normalizePath(path));
	}

	exists(path: string): boolean {
		return this.file(path) !== null;
	}

	async read(path: string): Promise<string> {
		const f = this.file(path);
		if (!f) throw new Error(`Note not found: ${path}`);
		return this.app.vault.read(f);
	}

	async create(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
		if (dir && !this.app.vault.getFolderByPath(dir)) await this.app.vault.createFolder(dir);
		await this.app.vault.create(normalized, content);
	}

	async modify(path: string, content: string): Promise<void> {
		const f = this.file(path);
		if (!f) throw new Error(`Note not found: ${path}`);
		await this.app.vault.modify(f, content);
	}
}
