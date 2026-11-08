// Live check of the weekly-summary path against a real Ollama model: the plugin's own prompt,
// client, bullet parser and citation filter, run over the current repository's last week of
// commits (or any repository given as REPO), with checks on what came back.
//
//   npm run summary:live                       # this repo, the current ISO week, 3 runs
//   REPO=C:\dev\proj WEEK=2026-W44 RUNS=1 MODEL=qwen3.5:9b npm run summary:live
//
// Not run by `npm test`: it needs Ollama and a GPU. Output lands in .e2e/summary-live-out/.
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { collectRepoWeek } from "../src/core/collect";
import { isoWeek, isoWeekDates, parseIsoWeekLabel, today } from "../src/core/dates";
import type { RunGit } from "../src/core/git";
import { OllamaClient } from "../src/core/ollama";
import { filterCitations, parseSummaryBullets, renderWeeklyReport, summarySystemPrompt, summaryUserMessage } from "../src/core/weekly";

const MODEL = process.env.MODEL ?? "qwen3.5:9b";
const URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const RUNS = Number(process.env.RUNS ?? 3);
const REPO = process.env.REPO ?? path.resolve(__dirname, "..");
const WEEK = (process.env.WEEK && parseIsoWeekLabel(process.env.WEEK)) || isoWeek(today());
const NUM_CTX = Number(process.env.NUM_CTX ?? 16384);
const OUT_DIR = path.join(__dirname, "summary-live-out");

const runGit: RunGit = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true });

async function main(): Promise<void> {
	mkdirSync(OUT_DIR, { recursive: true });
	const client = new OllamaClient(() => URL);
	console.log(`Ollama ${await client.version()} at ${URL}, model ${MODEL}`);
	const week = collectRepoWeek({ name: path.basename(REPO), path: REPO }, runGit, [], WEEK);
	if (week.error) throw new Error(`git failed: ${week.error}`);
	console.log(`${REPO}: ${week.commits.length} commits in ${WEEK.year}-W${String(WEEK.week).padStart(2, "0")}`);
	if (week.commits.length === 0) {
		console.log("Nothing to summarise; pick another WEEK or REPO.");
		return;
	}
	const { message, truncated } = summaryUserMessage(week.name, WEEK, week.commits, Math.floor(NUM_CTX * 3.2) - 3000);
	writeFileSync(path.join(OUT_DIR, "prompt.txt"), `${summarySystemPrompt()}\n\n---\n\n${message}\n`);
	if (truncated) console.log("(commit list was truncated to fit the context window)");

	let failures = 0;
	for (let run = 1; run <= RUNS; run++) {
		const started = Date.now();
		const reply = await client.chat({
			model: MODEL,
			messages: [
				{ role: "system", content: summarySystemPrompt() },
				{ role: "user", content: message },
			],
			options: { num_ctx: NUM_CTX, temperature: 0.2, top_p: 0.9, top_k: 20 },
			keep_alive: "10m",
			think: false,
		});
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		const raw = parseSummaryBullets(reply);
		const bullets = filterCitations(raw, week.commits);
		writeFileSync(path.join(OUT_DIR, `reply-${run}.txt`), reply);
		writeFileSync(path.join(OUT_DIR, `report-${run}.md`), renderWeeklyReport(WEEK, isoWeekDates(WEEK), [{ ...week, summary: bullets }], { model: MODEL, generatedOn: today() }));

		const problems: string[] = [];
		if (raw.length === 0) problems.push("no bullets parsed");
		if (raw.length > 5) problems.push(`${raw.length} bullets (max 5)`);
		const uncited = bullets.filter((b) => b.endsWith("_(no matching commit)_")).length;
		if (uncited) problems.push(`${uncited} bullet(s) cite nothing that exists`);
		const dropped = raw.join(" ").match(/\b[0-9a-f]{7,40}\b/g)?.filter((h) => !week.commits.some((c) => c.hash.startsWith(h.toLowerCase()))) ?? [];
		if (dropped.length) problems.push(`invented hashes dropped by the filter: ${dropped.join(", ")}`);
		const tooLong = bullets.filter((b) => b.length > 300).length;
		if (tooLong) problems.push(`${tooLong} bullet(s) over 300 characters`);

		console.log(`\nRun ${run}/${RUNS} (${seconds}s): ${bullets.length} bullets${problems.length ? ` — ${problems.join("; ")}` : " — OK"}`);
		for (const b of bullets) console.log(`  - ${b}`);
		if (problems.length) failures++;
	}
	console.log(`\n${RUNS - failures}/${RUNS} runs clean. Replies and reports are in ${OUT_DIR}`);
	process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
