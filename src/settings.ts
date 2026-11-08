import type { RepoConfig, RepoStates } from "./core/repos";
import { DEFAULT_MARKERS, type EditorScheme } from "./core/todos";

export interface CodeCompanionSettings {
	repos: RepoConfig[];
	dailyFolder: string;
	/** Moment-style tokens (`YYYY-MM-DD`); may contain `/` for nested folders. */
	dailyFormat: string;
	/** Vault path of a template note for new daily notes; empty = minimal body. */
	dailyTemplate: string;
	/** The heading the block is written under, `#`s included. */
	heading: string;
	/** One per line: names, emails or `Name <email>`. Empty = each repo's `git config user.*`. */
	authors: string;
	/** `|`-separated markers. */
	todoMarkers: string;
	todoNote: string;
	/** `git blame` each TODO for its age (slow). */
	todoBlame: boolean;
	editor: EditorScheme;
	reportsFolder: string;
	ollamaUrl: string;
	model: string;
	numCtx: number;
	thinking: boolean;
	summarize: boolean;
	/** Bookkeeping, keyed by repository path. */
	state: RepoStates;
}

export const DEFAULT_SETTINGS: CodeCompanionSettings = {
	repos: [],
	dailyFolder: "Daily",
	dailyFormat: "YYYY-MM-DD",
	dailyTemplate: "",
	heading: "## Code",
	authors: "",
	todoMarkers: DEFAULT_MARKERS,
	todoNote: "Code/TODOs.md",
	todoBlame: false,
	editor: "vscode",
	reportsFolder: "Reports",
	ollamaUrl: "http://localhost:11434",
	model: "qwen3.5:9b",
	numCtx: 16384,
	thinking: false,
	summarize: false,
	state: {},
};
