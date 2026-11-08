// Node implementations of the core's injected pieces: the git runner and reading source files
// outside the vault. Desktop only; no Obsidian import.

import { execFileSync } from "child_process";
import * as fs from "fs";
import type { RunGit } from "./core/git";
import type { ReadFile } from "./core/todos";

/** `git <args>` in `cwd`; throws with git's stderr when it fails. */
export function makeRunGit(cwd: string): RunGit {
	return (args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			timeout: 20_000,
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 32 * 1024 * 1024,
		});
}

/** True when `git --version` works on this machine. */
export function gitAvailable(): boolean {
	try {
		execFileSync("git", ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

export function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

const MAX_SOURCE_BYTES = 1024 * 1024;

/** Reads a source file for the TODO scan; null when missing, over 1 MB, or binary (NUL in the first 8 KB). */
export const readSourceFile: ReadFile = (absPath: string): string | null => {
	try {
		const st = fs.statSync(absPath);
		if (!st.isFile() || st.size > MAX_SOURCE_BYTES) return null;
		const buf = fs.readFileSync(absPath);
		const head = buf.subarray(0, Math.min(buf.length, 8192));
		if (head.includes(0)) return null;
		return buf.toString("utf8");
	} catch {
		return null;
	}
};
