import { Notice, Platform, Plugin, requestUrl } from "obsidian";
import { collectRepoDay, collectRepoWeek } from "./core/collect";
import { applyTemplate, dailyNotePath, headingText, minimalDailyBody, renderDailyBlock, upsertBlock } from "./core/daily";
import { isoWeek, isoWeekDates, previousIsoWeek, today, type IsoWeek } from "./core/dates";
import { isGitRepo, repoFacts } from "./core/git";
import { OllamaClient } from "./core/ollama";
import { parseAuthorList, repoNameFromPath, type RepoConfig } from "./core/repos";
import { scanRepo, renderTodoNote, type TodoRepoResult } from "./core/todos";
import { writeNote } from "./core/vault";
import { filterCitations, parseSummaryBullets, renderWeeklyReport, reportPath, summarySystemPrompt, summaryUserMessage, type RepoWeek } from "./core/weekly";
import { gitAvailable, isDirectory, makeRunGit, readSourceFile } from "./node-fs";
import { ObsidianVault } from "./obsidian-vault";
import { RepoModal, type RepoValidator } from "./repo-modal";
import { DEFAULT_SETTINGS, type CodeCompanionSettings } from "./settings";
import { CodeCompanionSettingTab } from "./settings-tab";

export default class CodeCompanionPlugin extends Plugin {
	settings: CodeCompanionSettings = { ...DEFAULT_SETTINGS };
	client!: OllamaClient;
	vault!: ObsidianVault;
	private hasGit: boolean | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.vault = new ObsidianVault(this.app);
		this.client = new OllamaClient(
			() => this.settings.ollamaUrl,
			(...args) => fetch(...args),
			async (url, body, method) => {
				const res = await requestUrl(method === "GET" ? { url, method, throw: false } : { url, method, contentType: "application/json", body, throw: false });
				return { status: res.status, text: res.text };
			},
		);
		this.addSettingTab(new CodeCompanionSettingTab(this.app, this));

		this.addRibbonIcon("git-commit-horizontal", "Log today's work", () => void this.logToday());
		this.addCommand({ id: "log-today", name: "Log today's work", callback: () => void this.logToday() });
		this.addCommand({ id: "weekly-report", name: "Weekly work report", callback: () => void this.weeklyReport(isoWeek(today())) });
		this.addCommand({ id: "weekly-report-last", name: "Weekly work report for last week", callback: () => void this.weeklyReport(previousIsoWeek(isoWeek(today()))) });
		this.addCommand({ id: "scan-todos", name: "Scan TODOs", callback: () => void this.scanTodos() });
		this.addCommand({ id: "open-today", name: "Open today's code block", callback: () => void this.openTodayBlock() });
		this.addCommand({ id: "add-repository", name: "Add a repository", callback: () => void this.addRepository() });
	}

	// ---------------------------------------------------------------- commands

	async logToday(): Promise<void> {
		const s = this.settings;
		if (s.repos.length === 0) {
			new Notice("No repositories configured. Run Add a repository first.");
			return;
		}
		const date = today();
		const authors = parseAuthorList(s.authors);
		const results = s.repos.map((repo) => collectRepoDay(repo, this.runGitFor(repo.path), authors, s.state[repo.path], date));
		const block = renderDailyBlock(
			results.map((r) => r.day),
			date,
		);
		const path = dailyNotePath(s.dailyFolder, s.dailyFormat, date);
		const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? date;
		let content: string;
		if (this.vault.exists(path)) content = await this.vault.read(path);
		else if (s.dailyTemplate && this.vault.exists(s.dailyTemplate)) content = applyTemplate(await this.vault.read(s.dailyTemplate), date, basename);
		else {
			if (s.dailyTemplate) new Notice(`Template "${s.dailyTemplate}" not found; creating a minimal daily note.`);
			content = minimalDailyBody(date, s.heading);
		}
		const updated = upsertBlock(content, s.heading, block);
		if (updated !== content) await writeNote(this.vault, path, updated);
		for (let i = 0; i < s.repos.length; i++) {
			const next = results[i].next;
			if (next) s.state[s.repos[i].path] = next;
		}
		await this.saveSettings();
		const commits = results.reduce((n, r) => n + r.day.commits.length, 0);
		const failed = results.filter((r) => r.day.error).length;
		new Notice(`${commits} commit${commits === 1 ? "" : "s"} across ${s.repos.length} repositor${s.repos.length === 1 ? "y" : "ies"} written to ${path}.${failed ? ` ${failed} failed; see the note.` : ""}`, 6000);
		await this.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", false);
	}

	async weeklyReport(week: IsoWeek): Promise<void> {
		const s = this.settings;
		if (s.repos.length === 0) {
			new Notice("No repositories configured. Run Add a repository first.");
			return;
		}
		const authors = parseAuthorList(s.authors);
		const repos: RepoWeek[] = s.repos.map((repo) => collectRepoWeek(repo, this.runGitFor(repo.path), authors, week));
		let summarized = false;
		if (s.summarize) {
			const notice = new Notice(`Summarising the week with ${s.model}…`, 0);
			try {
				for (const r of repos) {
					if (r.error || r.commits.length === 0) continue;
					const { message } = summaryUserMessage(r.name, week, r.commits, Math.max(4000, Math.floor(s.numCtx * 3.2) - 3000));
					const reply = await this.client.chat({
						model: s.model,
						messages: [
							{ role: "system", content: summarySystemPrompt() },
							{ role: "user", content: message },
						],
						options: { num_ctx: s.numCtx, temperature: 0.2, top_p: 0.9, top_k: 20 },
						keep_alive: "10m",
						think: s.thinking,
					});
					r.summary = filterCitations(parseSummaryBullets(reply), r.commits);
					summarized = summarized || r.summary.length > 0;
				}
			} catch (err) {
				new Notice(`Summary skipped: ${(err as Error).message}`, 8000);
			} finally {
				notice.hide();
			}
		}
		const content = renderWeeklyReport(week, isoWeekDates(week), repos, { model: summarized ? s.model : undefined, generatedOn: today() });
		const path = reportPath(s.reportsFolder, week);
		await writeNote(this.vault, path, content);
		const commits = repos.reduce((n, r) => n + r.commits.length, 0);
		new Notice(`${commits} commit${commits === 1 ? "" : "s"} in the report ${path}.`);
		await this.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", false);
	}

	async scanTodos(): Promise<void> {
		const s = this.settings;
		if (s.repos.length === 0) {
			new Notice("No repositories configured. Run Add a repository first.");
			return;
		}
		const notice = new Notice("Scanning for TODO markers…", 0);
		const results: TodoRepoResult[] = [];
		try {
			for (const repo of s.repos) {
				const runGit = this.runGitFor(repo.path);
				if (!runGit) {
					results.push({ name: repo.name, path: repo.path, hits: [], filesScanned: 0, error: "git is not available on this machine" });
					continue;
				}
				if (!isGitRepo(runGit)) {
					results.push({ name: repo.name, path: repo.path, hits: [], filesScanned: 0, error: "not a git repository" });
					continue;
				}
				const { hits, filesScanned } = scanRepo(runGit, repo.path, readSourceFile, { markers: s.todoMarkers, blame: s.todoBlame });
				results.push({ name: repo.name, path: repo.path, hits, filesScanned });
			}
		} finally {
			notice.hide();
		}
		const content = renderTodoNote(results, s.editor, { generatedOn: today(), showAge: s.todoBlame });
		await writeNote(this.vault, s.todoNote, content);
		const total = results.reduce((n, r) => n + r.hits.length, 0);
		new Notice(`${total} marker${total === 1 ? "" : "s"} written to ${s.todoNote}.`);
		await this.app.workspace.openLinkText(s.todoNote.replace(/\.md$/, ""), "", false);
	}

	async openTodayBlock(): Promise<void> {
		const s = this.settings;
		const path = dailyNotePath(s.dailyFolder, s.dailyFormat, today());
		if (!this.vault.exists(path)) {
			new Notice(`No daily note for today yet (${path}). Run Log today's work to create it.`);
			return;
		}
		const content = await this.vault.read(path);
		const heading = headingText(s.heading);
		const hasHeading = new RegExp(`^#+\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(content);
		await this.app.workspace.openLinkText(hasHeading ? `${path.replace(/\.md$/, "")}#${heading}` : path.replace(/\.md$/, ""), "", false);
		if (!hasHeading) new Notice(`Today's note has no "${heading}" heading yet. Run Log today's work to add it.`);
	}

	/** Prompts for a folder, validates it with git, saves it. Resolves the new config or null. */
	async addRepository(): Promise<RepoConfig | null> {
		if (!Platform.isDesktopApp) {
			new Notice("Code Companion needs the desktop app to run git.");
			return null;
		}
		const modal = new RepoModal(this.app, (path) => this.validateRepo(path));
		modal.open();
		const repo = await modal.result;
		if (!repo) return null;
		this.settings.repos.push(repo);
		await this.saveSettings();
		new Notice(`Added ${repo.name} (${repo.path}).`);
		return repo;
	}

	// ---------------------------------------------------------------- helpers

	private validateRepo(path: string): ReturnType<RepoValidator> {
		if (!isDirectory(path)) return { ok: false, error: "That folder does not exist." };
		if (this.settings.repos.some((r) => r.path.toLowerCase() === path.toLowerCase())) return { ok: false, error: "That repository is already in the list." };
		const runGit = this.runGitFor(path);
		if (!runGit) return { ok: false, error: "git was not found on this machine. Install git and make sure it is on PATH." };
		if (!isGitRepo(runGit)) return { ok: false, error: "That folder is not inside a git working tree." };
		const facts = repoFacts(runGit);
		const root = facts.toplevel || path;
		return { ok: true, repo: { name: repoNameFromPath(root), path: root.replace(/\//g, Platform.isWin ? "\\" : "/"), remoteUrl: undefined, defaultBranch: facts.defaultBranch } };
	}

	private runGitFor(repoPath: string) {
		if (!Platform.isDesktopApp) return null;
		if (this.hasGit === null) this.hasGit = gitAvailable();
		return this.hasGit && repoPath.trim() ? makeRunGit(repoPath.trim()) : null;
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<CodeCompanionSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}), repos: [...(data?.repos ?? [])], state: { ...(data?.state ?? {}) } };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
