import { describe, expect, it } from "vitest";
import { OllamaClient, OllamaError, stripThinkTags } from "../src/core/ollama";

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
	const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calls.push({ url, init });
		return handler(url, init);
	}) as typeof fetch;
	return { fetch: f, calls };
}

function ndjsonResponse(lines: object[]): Response {
	const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
	return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

describe("OllamaClient", () => {
	it("uses GET for /api/tags and /api/version and trims the base URL", async () => {
		const { fetch, calls } = fakeFetch((url) => {
			if (url.endsWith("/api/version")) return Response.json({ version: "0.6.0" });
			if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "qwen3.5:9b", size: 123 }, { name: "nomic-embed-text", size: 1 }] });
			return new Response("nope", { status: 404 });
		});
		const client = new OllamaClient(() => "http://localhost:11434/// ", fetch);
		expect(await client.version()).toBe("0.6.0");
		expect((await client.listModels()).map((m) => m.name)).toEqual(["qwen3.5:9b", "nomic-embed-text"]);
		expect(calls.map((c) => [c.url, c.init?.method])).toEqual([
			["http://localhost:11434/api/version", "GET"],
			["http://localhost:11434/api/tags", "GET"],
		]);
	});

	it("posts the summary request with thinking off and a low temperature, and streams the reply", async () => {
		const { fetch, calls } = fakeFetch(() => ndjsonResponse([{ message: { role: "assistant", content: "- One (a000001)\n" } }, { message: { role: "assistant", content: "- Two (a000002)\n" }, done: true }]));
		const client = new OllamaClient(() => "http://localhost:11434", fetch);
		const deltas: string[] = [];
		const text = await client.chat({
			model: "qwen3.5:9b",
			messages: [{ role: "user", content: "hi" }],
			options: { temperature: 0.2, num_ctx: 16384 },
			think: false,
			onDelta: (d) => deltas.push(d),
		});
		expect(text).toBe("- One (a000001)\n- Two (a000002)");
		expect(deltas).toHaveLength(2);
		const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
		expect(calls[0].url).toBe("http://localhost:11434/api/chat");
		expect(calls[0].init?.method).toBe("POST");
		expect(body.think).toBe(false);
		expect(body.stream).toBe(true);
		expect((body.options as Record<string, unknown>).temperature).toBe(0.2);
	});

	it("turns HTTP errors into OllamaError and strips leaked think tags", async () => {
		const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: "model 'x' not found" }), { status: 404 }));
		const client = new OllamaClient(() => "http://localhost:11434", fetch);
		await expect(client.chat({ model: "x", messages: [] })).rejects.toBeInstanceOf(OllamaError);
		await expect(client.chat({ model: "x", messages: [] })).rejects.toThrow(/not found/);
		expect(stripThinkTags("<think>hmm</think>\n- bullet")).toBe("- bullet");
	});
});
