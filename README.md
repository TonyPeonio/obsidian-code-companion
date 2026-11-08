# Code Companion

An [Obsidian](https://obsidian.md) plugin for developers who keep a work journal in their vault. Point
it at your git repositories and it writes **today's commits into your daily note**, a **weekly report**
with per-repository numbers, and a **TODO list** whose rows open the file in your editor. Everything is
read from `git` on your machine; a local model (via [Ollama](https://ollama.com)) can optionally
summarise the week from commit messages.

Code Companion is part of the Companion suite of local-first Obsidian plugins by Tony Peonio for
students and researchers: your machine does the work, every change is a diff you approve, and the
numbers are published. The others are Local Vault Agent (local Ollama agent that searches, compiles,
edits notes), Lecture Companion (live local lecture transcription, Canvas slides, Ollama summaries),
Canvas Companion (Canvas LMS assignments, grades and announcements as notes), Exam Companion
(day-by-day study plan, daily quizzes and flashcards), Paper Companion (Zotero search by meaning,
page-cited reading notes), Research Log Companion (append-only lab notebook with git, parameters,
data hashes), Meeting Companion (local meeting transcription, decisions, action items, weekly
digest), Job Hunt Companion (job applications as notes, resume tailoring, interview questions),
Fellowship Companion (grants and fellowships: deadlines, materials, letters, eligibility), Teaching
Companion (local-model rubric grading with verbatim evidence) and Branching Table of Contents
(parent/child properties as a rooted family tree). All at
[github.com/TonyPeonio](https://github.com/TonyPeonio).

- **Your commits, in your daily note.** One block under `## Code`: per repository, how many commits,
  lines added and removed, files touched; one line per commit with the files it changed and a link
  to the commit on GitHub, GitLab or Bitbucket; one line for uncommitted work. Run it as often as you
  like: the block is replaced, never duplicated. A day you forgot is picked up the next time, dated.
- **Only your commits.** Commits are attributed by an author list (names, emails, or
  `Name <email>`), which defaults to each repository's `git config user.name` and `user.email`.
  Bots, colleagues and merged-in work by others are left out.
- **A weekly report you can send.** `Reports/Code week 2026-W45.md`: a table of commits, lines, files
  and busiest day per repository, then every commit grouped by day. With the model toggle on, five
  bullets per repository written from the commit subjects and bodies, every bullet citing commit
  hashes, and every cited hash checked against the week's list before it is written.
- **TODOs that open in your editor.** `TODO`, `FIXME`, `HACK`, `XXX` (configurable) in comments
  across each repository, as a table per repository with `vscode://` or `idea://` links to the exact
  line. Honours `.gitignore` through `git ls-files`; optional age per marker from `git blame`.
- Free and open source, MIT licensed. No accounts, no API keys, no telemetry. Desktop only (it runs git).

## Requirements

1. `git` on your PATH. Nothing else for the daily block, the deterministic report and the TODO scan.
2. Optional, for weekly summaries only: [Ollama](https://ollama.com) running locally and a chat
   model, `ollama pull qwen3.5:9b` (default; fits a 12 GB GPU). Leave the toggle off and the plugin
   never talks to anything.

## Usage

1. **Add a repository** (command, or the button in settings): paste the absolute path of a git
   working tree. The name, `origin` remote and default branch are read from git; you can edit them
   and add a remote URL override in settings.
2. At the end of the day (or whenever), run **Log today's work**. Today's daily note is created if
   needed (from your template, or a minimal body) and the block below is written under `## Code`.
3. On Friday, run **Weekly work report** (or **… for last week** on Monday morning).
4. Run **Scan TODOs** whenever you want a fresh `Code/TODOs.md`.

A daily block:

```markdown
## Code

<!-- code-companion:start -->
- **obsidian-code-companion** · 3 commits · +412 −38 · 9 files
  - `a1b2c3d` Parse git log with unit separators (src/core/git.ts, tests/git.test.ts) — [open](https://github.com/TonyPeonio/obsidian-code-companion/commit/a1b2c3d…)
  - `b2c3d4e` Render the daily block (src/core/daily.ts, tests/daily.test.ts) — [open](https://github.com/TonyPeonio/obsidian-code-companion/commit/b2c3d4e…)
  - `c3d4e5f` (Nov 6) README skeleton (README.md) — [open](https://github.com/TonyPeonio/obsidian-code-companion/commit/c3d4e5f…)
  - working tree: 2 files changed, +33 −2 (not committed)
- **thesis-code** · no commits
<!-- code-companion:end -->
```

### Commands

| Command | What it does |
|---|---|
| Log today's work | Writes or replaces the block under `## Code` in today's daily note |
| Weekly work report | Writes `Reports/Code week YYYY-Www.md` for the current ISO week |
| Weekly work report for last week | The same for the previous ISO week |
| Scan TODOs | Rewrites `Code/TODOs.md` with every marker comment across your repositories |
| Open today's code block | Opens today's daily note at the `## Code` heading |
| Add a repository | Asks for a folder, checks it is a git working tree, saves it |

### How it works

**Commits.** For each repository the plugin runs one `git log` over all local branches with
`--numstat` and a custom `--format` whose fields are separated by the ASCII unit separator and whose
records end with the record separator, so a subject or body may contain anything printable and is
never split on newlines. `--author` narrows the walk; the exact author match (name, email or
`Name <email>`, case-insensitive) happens afterwards. Dates are author dates in the author's own
time zone, so a commit belongs to the day you made it.

**The window.** The first run takes everything since local midnight. After each run the newest
written commit is remembered per repository (`data.json`). The next run again takes everything since
midnight, so re-running the same day replaces the block with the same commits; when the remembered
commit is older than today, the window starts there instead, so commits from a day you never logged
land in today's block marked with their date.

**The block.** The daily note is `<folder>/<format>.md` with moment-style tokens (`YYYY`, `MM`, `DD`,
`MMM`, `ddd`, `[literal]`; the format may contain `/`). A missing note is created from the template
setting (`{{date}}`, `{{date:FORMAT}}`, `{{title}}`, `{{time}}`) or from a minimal body. The block
lives between `<!-- code-companion:start -->` and `<!-- code-companion:end -->`; when the markers
exist they are replaced wherever they are, otherwise the block is inserted right under the heading
(which is appended to the note when missing). Uncommitted work comes from `git diff --numstat HEAD`
plus the untracked count of `git status --porcelain`.

**Links.** `origin` (or the override) is parsed in ssh (`git@host:owner/repo.git`), `ssh://` and
`https://` forms. GitHub and unknown hosts use `/commit/<hash>`, GitLab `/-/commit/<hash>`,
Bitbucket `/commits/<hash>`.

**Weekly report.** ISO weeks (Monday to Sunday; week 1 holds January 4th). Per repository: commits,
lines, distinct files, busiest day; then `#### Weekday date` sections with one line per commit. With
*Summarise commits with the local model* on, the model gets the system prompt in `src/core/weekly.ts`
and the week's commits (hash, date, subject, body minus trailers), oldest first, trimmed to the
context window, at temperature 0.2 with thinking off. Bullets are parsed from `-`, `*` or numbered
lines; every token that looks like a hash is checked against the week's commits by prefix, unknown
ones are removed, and a bullet left with no citation is marked `(no matching commit)`. The report
says which model wrote the summary. `npm run summary:live` exercises this path against a real model
with checks (see `scripts/summary-live.ts`).

**TODOs.** `git ls-files --cached --others --exclude-standard` lists the files (so `.gitignore` is
honoured and new files count); binaries, lockfiles and files over 1 MB are skipped. A line matches
when a marker follows a comment leader (`//`, `#`, `/*`, `*`, `<!--`, `--`, `;`, `%`, `'`) or starts
the line, optionally with `(owner)` and `:`; matching is case-sensitive so prose is not flagged.
Rows link with `vscode://file/<path>:<line>` or `idea://open?file=<path>&line=<line>`, or show the
plain path. The note is capped at 500 rows with a notice. Age (off by default, slow) runs
`git blame -L n,n --porcelain` per marker.

## Settings worth knowing

- **Repositories** — name, path, remote URL override, default branch; remove or add here.
- **Daily note** — folder (`Daily`), date format (`YYYY-MM-DD`), template, heading (`## Code`).
- **Authors** — one per line; empty means each repository's own `git config user.*`.
- **TODO scan** — markers (`TODO|FIXME|HACK|XXX`), note path (`Code/TODOs.md`), editor (VS Code,
  JetBrains, plain path), age from git blame.
- **Weekly report** — reports folder (`Reports`), the model toggle (off by default).
- **Model** — Ollama URL, chat model, context window, thinking mode (off).

## Privacy and network use

Git runs locally; nothing is fetched or pushed. The plugin writes only to the daily note, the
reports folder and the TODO note you configure. The model is optional, off by default, and when on
it is sent commit messages only (hashes, dates, subjects, bodies), never file contents, to the
Ollama URL you set (localhost by default). No telemetry, no accounts.

## Development

```bash
npm install
npm run dev     # watch build → main.js
npm test        # unit tests (vitest), no git repository or Ollama needed
npm run build   # type-check + Obsidian review lint + production bundle
```

To release: bump `version` in `manifest.json` and `package.json`, add the version to
`versions.json`, write `release-notes/<version>.md`, commit, then push a tag named exactly
`<version>`. The release workflow builds, tests, attests and publishes the GitHub release.

`src/core/` (git log parsing, bookkeeping, remotes, the daily block, weekly report, TODO scan,
dates, Ollama client) has no Obsidian dependency and is tested with a fake `git` runner and an
in-memory vault; `src/main.ts`, `src/node-fs.ts` (the real `git` and file reads), the modal and the
settings tab are the thin Obsidian layer.

## License

MIT
