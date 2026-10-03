import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiModel, AiSettings, AiTestResult } from "../src/shared/api-types";
import { resolveProvider } from "../src/worker/ai/providers";
import { createDb } from "../src/worker/db";
import type { Bindings } from "../src/worker/types";
import { ADMIN, api, VIEWER } from "./helpers";

const KEY = "sk-minimax-test-key-1234";
const OPENAI_URL = "https://api.minimax.io/v1";
const ANTHROPIC_URL = "https://api.minimax.io/anthropic";

type Call = { url: string; method: string; headers: Headers; body: Record<string, unknown> | null };

/** Stubs outbound fetch: `respond` gets each call and returns [status, JSON body]. */
function stubFetch(respond: (call: Call, n: number) => [number, unknown]) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const req = new Request(input as RequestInfo, init);
		const text = await req.text();
		const call = {
			url: req.url,
			method: req.method,
			headers: req.headers,
			body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
		};
		calls.push(call);
		const [status, body] = respond(call, calls.length);
		return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
	});
	return calls;
}

const save = (body: Record<string, unknown>) =>
	api<AiSettings>("/admin/ai", { as: ADMIN, method: "PUT", body });

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM ai_settings").run();
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("AI model settings", () => {
	it("is admin-only", async () => {
		expect((await api("/admin/ai", { as: VIEWER })).status).toBe(403);
		expect(
			(
				await api("/admin/ai/models", {
					as: VIEWER,
					method: "POST",
					body: { protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY },
				})
			).status,
		).toBe(403);
	});

	it("defaults to the built-in provider", async () => {
		const res = await api<AiSettings>("/admin/ai", { as: ADMIN });
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			active: { provider: "workers-ai", custom: false },
			custom: null,
			canStoreKeys: true,
		});
	});

	it("lists models from an OpenAI-compatible endpoint with a Bearer key", async () => {
		const calls = stubFetch(() => [200, { data: [{ id: "MiniMax-M3" }, { id: "MiniMax-M2.7" }] }]);
		const res = await api<{ models: AiModel[] }>("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: `${OPENAI_URL}/`, apiKey: KEY },
		});
		expect(res.status).toBe(200);
		expect(res.body.models.map((m) => m.id)).toEqual(["MiniMax-M2.7", "MiniMax-M3"]);
		expect(calls[0]?.url).toBe(`${OPENAI_URL}/models`);
		expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
	});

	it("lists models from an Anthropic-compatible endpoint under /v1", async () => {
		const calls = stubFetch(() => [200, { data: [{ id: "MiniMax-M3", display_name: "MiniMax M3" }] }]);
		const res = await api<{ models: AiModel[] }>("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "anthropic", baseUrl: ANTHROPIC_URL, apiKey: KEY },
		});
		expect(res.body.models).toEqual([{ id: "MiniMax-M3", name: "MiniMax M3" }]);
		expect(calls[0]?.url).toBe(`${ANTHROPIC_URL}/v1/models?limit=1000`);
		expect(calls[0]?.headers.get("x-api-key")).toBe(KEY);
		expect(calls[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
	});

	it("explains when the endpoint has no model list, and when the key is wrong", async () => {
		stubFetch(() => [404, { error: { message: "not found" } }]);
		const missing = await api<{ error: string }>("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY },
		});
		expect(missing.status).toBe(400);
		expect(missing.body.error).toMatch(/doesn't list its models/);

		vi.restoreAllMocks();
		stubFetch(() => [401, { base_resp: { status_code: 1004, status_msg: "login fail" } }]);
		const bad = await api<{ error: string }>("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY },
		});
		// Never 401/403: the SPA would read those as a SiteMate session or permission problem.
		expect(bad.status).toBe(400);
		expect(bad.body.error).toMatch(/API key was rejected: login fail/);
	});

	it("rejects non-https base URLs", async () => {
		const res = await api("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: "http://api.minimax.io/v1", apiKey: KEY },
		});
		expect(res.status).toBe(400);
	});

	it("saves the key encrypted, never returns it, and reuses it only for the same host", async () => {
		const saved = await save({ protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY, model: "MiniMax-M3" });
		expect(saved.status).toBe(200);
		expect(saved.body.active).toEqual({ provider: "custom-openai", model: "MiniMax-M3", custom: true });
		expect(saved.body.custom).toMatchObject({ protocol: "openai", baseUrl: OPENAI_URL, keyHint: "1234" });
		expect(JSON.stringify(saved.body)).not.toContain(KEY);

		const row = await env.DB.prepare("SELECT api_key_encrypted FROM ai_settings").first<{
			api_key_encrypted: string;
		}>();
		expect(row?.api_key_encrypted).toMatch(/^v1\./);
		expect(row?.api_key_encrypted).not.toContain(KEY);

		// Blank key → the saved one, for the same host (even with the other wire format).
		const calls = stubFetch(() => [200, { data: [{ id: "MiniMax-M3" }] }]);
		const same = await api("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "anthropic", baseUrl: ANTHROPIC_URL },
		});
		expect(same.status).toBe(200);
		expect(calls[0]?.headers.get("x-api-key")).toBe(KEY);

		// …but never sent to a different host.
		const other = await api<{ error: string }>("/admin/ai/models", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: "https://example.com/v1" },
		});
		expect(other.status).toBe(400);
		expect(other.body.error).toMatch(/Enter the API key/);
		expect(calls).toHaveLength(1);

		// Changing only the model keeps the key.
		const changed = await save({ protocol: "openai", baseUrl: OPENAI_URL, model: "MiniMax-M2.7" });
		expect(changed.body.custom).toMatchObject({ model: "MiniMax-M2.7", keyHint: "1234" });
	});

	it("tests a model, falling back when response_format is rejected and dropping <think> output", async () => {
		const calls = stubFetch(() => [200, { choices: [{ message: { content: "<think>hmm</think>OK" } }] }]);
		const res = await api<AiTestResult>("/admin/ai/test", {
			as: ADMIN,
			method: "POST",
			body: { protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY, model: "MiniMax-M3" },
		});
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ ok: true, model: "MiniMax-M3", reply: "OK" });
		expect(calls[0]?.url).toBe(`${OPENAI_URL}/chat/completions`);
		expect(calls[0]?.body?.model).toBe("MiniMax-M3");
	});

	it("routes every AI call through the saved endpoint (OpenAI format)", async () => {
		await save({ protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY, model: "MiniMax-M3" });
		const calls = stubFetch((_call, n) =>
			n === 1
				? [400, { error: { message: "response_format is not supported" } }]
				: [
						200,
						{
							choices: [
								{ message: { content: '<think>reading</think>```json\n{"documentType":"quote"}\n```' } },
							],
						},
					],
		);
		const provider = await resolveProvider(env as unknown as Bindings, createDb(env.DB));
		expect(provider).toMatchObject({ name: "custom-openai", model: "MiniMax-M3" });
		const out = await provider.json(
			{ kind: "text", text: "doc", truncated: false },
			(t) => `Classify: ${t}`,
			"classification",
			{
				type: "object",
			},
		);
		expect(out).toEqual({ documentType: "quote" });
		expect(calls).toHaveLength(2);
		expect(calls[0]?.body?.response_format).toBeDefined();
		expect(calls[1]?.body?.response_format).toBeUndefined();
		// The schema always rides in the system prompt, so endpoints without response_format still comply.
		const messages = calls[1]?.body?.messages as { role: string; content: string }[];
		expect(messages[0]?.content).toContain("JSON Schema");
	});

	it("routes every AI call through the saved endpoint (Anthropic format), ignoring thinking blocks", async () => {
		await save({ protocol: "anthropic", baseUrl: ANTHROPIC_URL, apiKey: KEY, model: "MiniMax-M3" });
		const calls = stubFetch(() => [
			200,
			{
				content: [
					{ type: "thinking", thinking: "Let me look." },
					{ type: "text", text: '{"documentType":"invoice"}' },
				],
				stop_reason: "end_turn",
			},
		]);
		const provider = await resolveProvider(env as unknown as Bindings, createDb(env.DB));
		expect(provider.name).toBe("custom-anthropic");
		const out = await provider.json(
			{ kind: "text", text: "doc", truncated: false },
			(t) => t,
			"classification",
			{
				type: "object",
			},
		);
		expect(out).toEqual({ documentType: "invoice" });
		expect(calls[0]?.url).toBe(`${ANTHROPIC_URL}/v1/messages`);
		expect(calls[0]?.body).toMatchObject({ model: "MiniMax-M3", max_tokens: 16000 });
	});

	it("goes back to the default and deletes the key", async () => {
		await save({ protocol: "openai", baseUrl: OPENAI_URL, apiKey: KEY, model: "MiniMax-M3" });
		const res = await api<AiSettings>("/admin/ai", { as: ADMIN, method: "DELETE" });
		expect(res.body).toMatchObject({ active: { provider: "workers-ai", custom: false }, custom: null });
		const n = await env.DB.prepare("SELECT count(*) AS n FROM ai_settings").first<{ n: number }>();
		expect(n?.n).toBe(0);
		const provider = await resolveProvider(env as unknown as Bindings, createDb(env.DB));
		expect(provider.name).toBe("workers-ai");
	});
});
