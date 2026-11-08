import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type CodeCompanionPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import type { EditorScheme } from "./core/todos";

export class CodeCompanionSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: CodeCompanionPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		// ------------------------------------------------------------ repositories
		new Setting(containerEl).setName("Repositories").setHeading();

		if (s.repos.length === 0) {
			new Setting(containerEl).setDesc("No repositories yet. Add the git working trees whose commits belong in your journal.");
		}
		s.repos.forEach((repo, index) => {
			const box = containerEl.createDiv({ cls: "code-companion-repo" });
			new Setting(box)
				.setName(repo.name || `Repository ${index + 1}`)
				.setDesc(repo.path)
				.addButton((b) =>
					b.setButtonText("Remove").onClick(async () => {
						s.repos.splice(index, 1);
						await save();
						this.display();
					}),
				);
			new Setting(box).setName("Name").addText((t) =>
				t.setValue(repo.name).onChange(async (v) => {
					repo.name = v.trim() || repo.name;
					await save();
				}),
			);
			new Setting(box).setName("Path").addText((t) => {
				t.inputEl.addClass("code-companion-wide");
				t.setValue(repo.path).onChange(async (v) => {
					if (v.trim()) repo.path = v.trim();
					await save();
				});
			});
			new Setting(box)
				.setName("Remote URL override")
				.setDesc("Leave empty to use the origin remote for commit links.")
				.addText((t) => {
					t.inputEl.addClass("code-companion-wide");
					t.setPlaceholder("https://github.com/you/repo").setValue(repo.remoteUrl ?? "").onChange(async (v) => {
						repo.remoteUrl = v.trim() || undefined;
						await save();
					});
				});
			new Setting(box).setName("Default branch").addText((t) =>
				t.setPlaceholder("main").setValue(repo.defaultBranch ?? "").onChange(async (v) => {
					repo.defaultBranch = v.trim() || undefined;
					await save();
				}),
			);
		});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Add a repository")
				.setCta()
				.onClick(async () => {
					const added = await this.plugin.addRepository();
					if (added) this.display();
				}),
		);

		// ------------------------------------------------------------ daily note
		new Setting(containerEl).setName("Daily note").setHeading();

		new Setting(containerEl)
			.setName("Folder")
			.setDesc("Where daily notes live.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.dailyFolder).setValue(s.dailyFolder).onChange(async (v) => {
					s.dailyFolder = v.trim().replace(/^\/+|\/+$/g, "");
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Moment-style tokens: YYYY, MM, DD, MMM, ddd and [literal] text. May contain / for nested folders.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.dailyFormat).setValue(s.dailyFormat).onChange(async (v) => {
					s.dailyFormat = v.trim() || DEFAULT_SETTINGS.dailyFormat;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Template")
			.setDesc("Vault path of a template for new daily notes ({{date}}, {{date:FORMAT}}, {{title}} and {{time}} are filled in). Empty: a title and the code heading.")
			.addText((t) => {
				t.inputEl.addClass("code-companion-wide");
				t.setPlaceholder("Templates/Daily.md").setValue(s.dailyTemplate).onChange(async (v) => {
					s.dailyTemplate = v.trim();
					await save();
				});
			});

		new Setting(containerEl)
			.setName("Heading")
			.setDesc("The block is written under this heading, created when the note lacks it.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.heading).setValue(s.heading).onChange(async (v) => {
					const h = v.trim();
					s.heading = h ? (h.startsWith("#") ? h : `## ${h}`) : DEFAULT_SETTINGS.heading;
					await save();
				}),
			);

		// ------------------------------------------------------------ authors
		new Setting(containerEl).setName("Authors").setHeading();

		new Setting(containerEl)
			.setName("My names and emails")
			.setDesc("One per line: a name, an email, or Name <email>. Only commits by these authors are logged. Empty: each repository's git config user.name and user.email.")
			.addTextArea((t) => {
				t.inputEl.addClass("code-companion-textarea");
				t.setPlaceholder("Tony Peonio\ntony@example.com").setValue(s.authors).onChange(async (v) => {
					s.authors = v;
					await save();
				});
			});

		// ------------------------------------------------------------ TODOs
		new Setting(containerEl).setName("TODO scan").setHeading();

		new Setting(containerEl)
			.setName("Markers")
			.setDesc("Separated by |. Matched case-sensitively inside comments.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.todoMarkers).setValue(s.todoMarkers).onChange(async (v) => {
					s.todoMarkers = v.trim() || DEFAULT_SETTINGS.todoMarkers;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Note")
			.setDesc("Rewritten on every scan.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.todoNote).setValue(s.todoNote).onChange(async (v) => {
					let p = v.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.todoNote;
					if (!p.toLowerCase().endsWith(".md")) p += ".md";
					s.todoNote = p;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Open in editor")
			.setDesc("How each row links to the file. VS Code and JetBrains use their URL schemes; plain path writes the absolute path.")
			.addDropdown((d) =>
				d
					.addOptions({ vscode: "VS Code (vscode://)", idea: "JetBrains (idea://)", path: "Plain path" })
					.setValue(s.editor)
					.onChange(async (v) => {
						s.editor = v as EditorScheme;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Age from git blame")
			.setDesc("Runs git blame for every marker to show how old it is. Slow on large repositories; off by default.")
			.addToggle((t) =>
				t.setValue(s.todoBlame).onChange(async (v) => {
					s.todoBlame = v;
					await save();
				}),
			);

		// ------------------------------------------------------------ weekly report
		new Setting(containerEl).setName("Weekly report").setHeading();

		new Setting(containerEl)
			.setName("Reports folder")
			.setDesc("Reports are written as <folder>/Code week YYYY-Www.md.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.reportsFolder).setValue(s.reportsFolder).onChange(async (v) => {
					s.reportsFolder = v.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SETTINGS.reportsFolder;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Summarise commits with the local model")
			.setDesc("Adds five bullets per repository, written by the Ollama model from commit messages only. Every cited hash is checked against the week's commits. Off: the report is purely deterministic.")
			.addToggle((t) =>
				t.setValue(s.summarize).onChange(async (v) => {
					s.summarize = v;
					await save();
				}),
			);

		// ------------------------------------------------------------ model
		new Setting(containerEl).setName("Model").setHeading();

		new Setting(containerEl)
			.setName("Ollama URL")
			.setDesc("Where Ollama is listening. Only used by the weekly summary, and only when it is turned on.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl).setValue(s.ollamaUrl).onChange(async (v) => {
					s.ollamaUrl = v.trim() || DEFAULT_SETTINGS.ollamaUrl;
					await save();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Test connection").onClick(async () => {
					try {
						const version = await this.plugin.client.version();
						const models = await this.plugin.client.listModels();
						const has = models.some((m) => m.name === s.model);
						new Notice(`Connected to Ollama ${version} (${models.length} models).${has ? "" : ` Model "${s.model}" is not installed: run \`ollama pull ${s.model}\`.`}`, 8000);
					} catch (err) {
						new Notice(`Connection failed: ${(err as Error).message}`, 8000);
					}
				}),
			);

		const modelSetting = new Setting(containerEl).setName("Chat model").setDesc("Any Ollama chat model. qwen3.5:9b fits a 12 GB GPU; qwen3.5:4b for smaller cards.");
		modelSetting.addDropdown((d) => {
			d.addOption(s.model, s.model);
			d.setValue(s.model);
			d.onChange(async (v) => {
				s.model = v;
				await save();
			});
			void this.plugin.client
				.listModels()
				.then((models) => {
					d.selectEl.empty();
					const names = models.filter((m) => !/embed/i.test(m.name)).map((m) => m.name);
					if (!names.includes(s.model)) names.unshift(s.model);
					for (const n of names) d.addOption(n, n);
					d.setValue(s.model);
				})
				.catch(() => {
					// Ollama unreachable: keep the single current value.
				});
		});
		modelSetting.addText((t) =>
			t.setPlaceholder("or type a model name").onChange(async (v) => {
				if (!v.trim()) return;
				s.model = v.trim();
				await save();
			}),
		);

		new Setting(containerEl)
			.setName("Context window (num_ctx)")
			.setDesc("Tokens the model can see. A week of commit messages fits easily in 16384.")
			.addText((t) =>
				t.setValue(String(s.numCtx)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 2048 && n <= 262144) {
						s.numCtx = n;
						await save();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Thinking mode")
			.setDesc("Let thinking-capable models reason before answering. Off by default; summaries do not need it.")
			.addToggle((t) =>
				t.setValue(s.thinking).onChange(async (v) => {
					s.thinking = v;
					await save();
				}),
			);
	}
}
