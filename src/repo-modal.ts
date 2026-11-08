import { App, Modal, Setting } from "obsidian";
import type { RepoConfig } from "./core/repos";

export type RepoValidator = (path: string) => { ok: true; repo: RepoConfig } | { ok: false; error: string };

/** Asks for a repository folder, validates it with git, resolves the config or null when cancelled. */
export class RepoModal extends Modal {
	private resolve!: (r: RepoConfig | null) => void;
	readonly result: Promise<RepoConfig | null>;
	private done = false;
	private path = "";
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private validate: RepoValidator,
	) {
		super(app);
		this.result = new Promise((res) => (this.resolve = res));
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("code-companion-modal");
		titleEl.setText("Add a repository");
		contentEl.createEl("p", {
			cls: "code-companion-modal-help",
			text: "The absolute path of a git working tree on this machine. Its name, remote and default branch are read from git; you can edit them in settings afterwards.",
		});

		new Setting(contentEl).setName("Folder").addText((t) => {
			t.setPlaceholder("C:\\Users\\me\\Projects\\my-app or /home/me/projects/my-app");
			t.inputEl.addClass("code-companion-wide");
			t.onChange((v) => (this.path = v.trim()));
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") this.submit();
			});
			window.setTimeout(() => t.inputEl.focus(), 0);
		});

		this.errorEl = contentEl.createEl("p", { cls: "code-companion-modal-error" });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((b) =>
				b
					.setButtonText("Add")
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private submit(): void {
		const path = this.path.replace(/^["']|["']$/g, "").replace(/[\\/]+$/, "");
		if (!path) {
			this.showError("Enter a folder path.");
			return;
		}
		const v = this.validate(path);
		if (!v.ok) {
			this.showError(v.error);
			return;
		}
		this.finish(v.repo);
	}

	private showError(msg: string): void {
		if (this.errorEl) this.errorEl.setText(msg);
	}

	private finish(r: RepoConfig | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(r);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}
