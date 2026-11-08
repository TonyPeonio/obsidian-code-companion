import { describe, expect, it } from "vitest";
import { browsableRemote, commitUrl, parseRemote } from "../src/core/remotes";

const HASH = "9fd974293c36015ee1be59ee80a65fdc91c3ac6c";

describe("parseRemote", () => {
	it("reads scp-style ssh remotes", () => {
		expect(parseRemote("git@github.com:TonyPeonio/obsidian-exam-companion.git")).toEqual({ host: "github.com", path: "TonyPeonio/obsidian-exam-companion", kind: "github" });
	});

	it("reads ssh:// remotes with a port and nested GitLab groups", () => {
		expect(parseRemote("ssh://git@gitlab.example.com:2222/group/sub/project.git")).toEqual({ host: "gitlab.example.com", path: "group/sub/project", kind: "gitlab" });
	});

	it("reads https remotes with and without .git or a user", () => {
		expect(parseRemote("https://github.com/TonyPeonio/obsidian-exam-companion.git")?.path).toBe("TonyPeonio/obsidian-exam-companion");
		expect(parseRemote("https://tony@bitbucket.org/team/repo")).toEqual({ host: "bitbucket.org", path: "team/repo", kind: "bitbucket" });
	});

	it("rejects junk", () => {
		expect(parseRemote(undefined)).toBeUndefined();
		expect(parseRemote("")).toBeUndefined();
		expect(parseRemote("not a remote")).toBeUndefined();
		expect(parseRemote("C:\\local\\path")).toBeUndefined();
	});
});

describe("commitUrl", () => {
	it("GitHub uses /commit/ for ssh and https forms", () => {
		expect(commitUrl("git@github.com:TonyPeonio/repo.git", HASH)).toBe(`https://github.com/TonyPeonio/repo/commit/${HASH}`);
		expect(commitUrl("https://github.com/TonyPeonio/repo", HASH)).toBe(`https://github.com/TonyPeonio/repo/commit/${HASH}`);
	});

	it("GitLab uses /-/commit/ (gitlab.com and self-hosted)", () => {
		expect(commitUrl("git@gitlab.com:group/project.git", HASH)).toBe(`https://gitlab.com/group/project/-/commit/${HASH}`);
		expect(commitUrl("https://gitlab.mines.edu/group/sub/project.git", HASH)).toBe(`https://gitlab.mines.edu/group/sub/project/-/commit/${HASH}`);
	});

	it("Bitbucket uses /commits/", () => {
		expect(commitUrl("git@bitbucket.org:team/repo.git", HASH)).toBe(`https://bitbucket.org/team/repo/commits/${HASH}`);
		expect(commitUrl("https://tony@bitbucket.org/team/repo.git", HASH)).toBe(`https://bitbucket.org/team/repo/commits/${HASH}`);
	});

	it("unknown hosts get the GitHub shape; no remote means no link", () => {
		expect(commitUrl("https://codeberg.org/me/repo.git", HASH)).toBe(`https://codeberg.org/me/repo/commit/${HASH}`);
		expect(commitUrl(undefined, HASH)).toBeUndefined();
		expect(commitUrl("git@github.com:me/repo.git", "")).toBeUndefined();
	});

	it("browsableRemote is the repository page", () => {
		expect(browsableRemote("git@github.com:me/repo.git")).toBe("https://github.com/me/repo");
	});
});
