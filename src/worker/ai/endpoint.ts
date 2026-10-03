/**
 * Minimal client for a workspace-configured AI endpoint (e.g. MiniMax's token plan) that speaks either the
 * OpenAI Chat Completions or the Anthropic Messages wire format. Plain fetch: no SDK, no provider-specific
 * parameters, so any compatible host works. Reasoning ("thinking") output is dropped; only the answer is used.
 */
import type { AiModel, AiProtocol } from "../../shared/api-types";

export interface Endpoint {
	protocol: AiProtocol;
	/** e.g. https://api.minimax.io/v1 (OpenAI) or https://api.minimax.io/anthropic (Anthropic). No trailing slash. */
	baseUrl: string;
	apiKey: string;
}

export class EndpointError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

const TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic-style bases may or may not already include /v1 (".../anthropic" vs "https://api.anthropic.com/v1"). */
function url(e: Endpoint, path: string) {
	if (e.protocol === "openai") return `${e.baseUrl}${path}`;
	return /\/v1$/.test(e.baseUrl) ? `${e.baseUrl}${path}` : `${e.baseUrl}/v1${path}`;
}

function headers(e: Endpoint): Record<string, string> {
	if (e.protocol === "openai") return { Authorization: `Bearer ${e.apiKey}` };
	const h: Record<string, string> = { "x-api-key": e.apiKey, "anthropic-version": ANTHROPIC_VERSION };
	// Compatible hosts (MiniMax and others) authenticate with a Bearer token; Anthropic itself uses x-api-key only.
	if (new URL(e.baseUrl).hostname !== "api.anthropic.com") h.Authorization = `Bearer ${e.apiKey}`;
	return h;
}

/** The provider's own error message, from the shapes OpenAI, Anthropic and MiniMax use. */
function providerMessage(body: unknown): string | null {
	const b = body as {
		error?: { message?: string } | string;
		message?: string;
		base_resp?: { status_code?: number; status_msg?: string };
	} | null;
	if (!b) return null;
	if (typeof b.error === "string") return b.error;
	return b.error?.message ?? b.base_resp?.status_msg ?? b.message ?? null;
}

async function request<T>(
	e: Endpoint,
	path: string,
	init: { method: string; body?: unknown; timeoutMs?: number },
) {
	let res: Response;
	try {
		res = await fetch(url(e, path), {
			method: init.method,
			headers: { ...headers(e), ...(init.body ? { "Content-Type": "application/json" } : {}) },
			body: init.body ? JSON.stringify(init.body) : undefined,
			signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
		});
	} catch (err) {
		const timedOut = (err as Error).name === "TimeoutError";
		throw new EndpointError(502, timedOut ? "The AI endpoint timed out" : "Couldn't reach the AI endpoint");
	}
	const text = await res.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		// Non-JSON (an HTML error page, usually a wrong base URL).
	}
	const msg = providerMessage(body);
	if (res.status === 401 || res.status === 403) {
		throw new EndpointError(res.status, `The API key was rejected${msg ? `: ${msg}` : ""}`);
	}
	if (!res.ok) {
		throw new EndpointError(res.status, `AI endpoint error ${res.status}: ${(msg ?? text).slice(0, 200)}`);
	}
	if (body === null) throw new EndpointError(502, "The AI endpoint didn't return JSON. Check the base URL.");
	// MiniMax reports some errors as HTTP 200 with a non-zero base_resp.status_code.
	const base = (body as { base_resp?: { status_code?: number } }).base_resp;
	if (base?.status_code) throw new EndpointError(502, `AI endpoint error: ${msg ?? base.status_code}`);
	return body as T;
}

/** GET /models. Both formats return `{ data: [{ id, … }] }`. */
export async function listModels(e: Endpoint): Promise<AiModel[]> {
	try {
		const body = await request<{ data?: { id?: string; display_name?: string; name?: string }[] }>(
			e,
			e.protocol === "anthropic" ? "/models?limit=1000" : "/models",
			{ method: "GET", timeoutMs: 15_000 },
		);
		const models = (body.data ?? [])
			.filter((m): m is { id: string; display_name?: string; name?: string } => typeof m.id === "string")
			.map((m) => ({ id: m.id, name: m.display_name ?? m.name ?? null }));
		return models.sort((a, b) => a.id.localeCompare(b.id));
	} catch (err) {
		if (err instanceof EndpointError && (err.status === 404 || err.status === 405)) {
			throw new EndpointError(404, "This endpoint doesn't list its models. Type the model ID instead.");
		}
		throw err;
	}
}

/** Removes inline reasoning some models put in the answer text. */
export const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

/**
 * One single-turn completion; returns the answer text. With `schema`, the schema is written into the system
 * prompt (works everywhere) and, on OpenAI-format endpoints, also requested as `response_format`, retrying
 * without it if the endpoint rejects the parameter.
 */
export async function complete(
	e: Endpoint,
	model: string,
	opts: { system: string; user: string; maxTokens: number; schema?: { name: string; schema: object } },
): Promise<string> {
	const system = opts.schema
		? `${opts.system}\nReply with only one JSON object matching this JSON Schema, no prose:\n${JSON.stringify(opts.schema.schema)}`
		: opts.system;

	if (e.protocol === "anthropic") {
		const body = await request<{ content?: { type: string; text?: string }[]; stop_reason?: string }>(
			e,
			"/messages",
			{
				method: "POST",
				body: {
					model,
					max_tokens: opts.maxTokens,
					system,
					messages: [{ role: "user", content: opts.user }],
				},
			},
		);
		const text = (body.content ?? [])
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("");
		if (!text.trim()) throw new EndpointError(502, emptyMessage(body.stop_reason === "max_tokens"));
		return stripThinking(text);
	}

	const chat = (responseFormat: boolean) =>
		request<{ choices?: { message?: { content?: string | null }; finish_reason?: string }[] }>(
			e,
			"/chat/completions",
			{
				method: "POST",
				body: {
					model,
					max_tokens: opts.maxTokens,
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: opts.user },
					],
					...(responseFormat && opts.schema
						? {
								response_format: {
									type: "json_schema",
									json_schema: { name: opts.schema.name, schema: opts.schema.schema },
								},
							}
						: {}),
				},
			},
		);
	let body: Awaited<ReturnType<typeof chat>>;
	try {
		body = await chat(Boolean(opts.schema));
	} catch (err) {
		if (!(opts.schema && err instanceof EndpointError && (err.status === 400 || err.status === 422)))
			throw err;
		body = await chat(false);
	}
	const choice = body.choices?.[0];
	const text = choice?.message?.content ?? "";
	if (!text.trim()) throw new EndpointError(502, emptyMessage(choice?.finish_reason === "length"));
	return stripThinking(text);
}

const emptyMessage = (ranOut: boolean) =>
	ranOut ? "The model used its whole token budget before answering" : "The model returned an empty answer";
