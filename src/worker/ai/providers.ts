/**
 * AI provider adapter (docs/DESIGN.md §5), chosen by AI_PROVIDER. Every call goes through the Cloudflare
 * AI Gateway named by AI_GATEWAY_ID. A provider is only used when its key is present; otherwise the
 * free Workers AI default is used.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Bindings } from "../types";
import { MAX_DOCUMENT_CHARS, SYSTEM_PROMPT, TRANSCRIBE_PROMPT } from "./prompts";

export type ProviderName = "workers-ai" | "anthropic" | "openai-compatible";

export interface SourceFile {
	name: string;
	mimeType: string;
	bytes: ArrayBuffer;
}

/** What the model is given: extracted text, or the raw PDF for providers that read PDFs natively. */
export type DocumentInput =
	| { kind: "text"; text: string; truncated: boolean }
	| { kind: "pdf"; base64: string };

export interface Provider {
	name: ProviderName;
	model: string;
	/** Turn the file into something `json()` can read. */
	prepare(file: SourceFile): Promise<DocumentInput>;
	/** One structured-output call: returns the parsed JSON object (validated by the caller). */
	json(
		input: DocumentInput,
		prompt: (text: string) => string,
		schemaName: string,
		schema: object,
	): Promise<unknown>;
}

const isImage = (m: string) => m.startsWith("image/");
const toBase64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64");

/** Inline images and native PDFs are sent base64 in a single request; keep them modest. */
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

function gatewayOptions(env: Bindings, metadata: Record<string, string>) {
	return { gateway: { id: env.AI_GATEWAY_ID || "sitemate", metadata } };
}

function truncate(text: string): DocumentInput {
	return text.length > MAX_DOCUMENT_CHARS
		? { kind: "text", text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true }
		: { kind: "text", text, truncated: false };
}

/** Workers AI `toMarkdown`: free for PDFs and Office documents; images are handled by a vision model instead. */
async function toMarkdown(env: Bindings, file: SourceFile) {
	const res = await env.AI.toMarkdown(
		{ name: file.name, blob: new Blob([file.bytes], { type: file.mimeType }) },
		gatewayOptions(env, { step: "toMarkdown" }),
	);
	if (res.format === "error") throw new Error(`Couldn't read ${file.name}: ${res.error}`);
	return res.data;
}

/** Strips ```json fences and parses; some models wrap JSON even in JSON mode. */
export function parseJsonLoose(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const s = value
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/, "");
	try {
		return JSON.parse(s);
	} catch {
		const start = s.indexOf("{");
		const end = s.lastIndexOf("}");
		if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
		throw new Error("Model did not return JSON");
	}
}

// ── Workers AI (default, free tier) ──────────────────────────────────────────

function workersAi(env: Bindings): Provider {
	const model = (env.WORKERS_AI_MODEL ||
		"@cf/meta/llama-4-scout-17b-16e-instruct") as "@cf/meta/llama-4-scout-17b-16e-instruct";
	return {
		name: "workers-ai",
		model,
		async prepare(file) {
			if (!isImage(file.mimeType)) return truncate(await toMarkdown(env, file));
			if (file.bytes.byteLength > MAX_INLINE_BYTES) throw new Error("Image is too large to read (5 MB max)");
			const out = await env.AI.run(
				model,
				{
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: TRANSCRIBE_PROMPT },
								{
									type: "image_url",
									image_url: { url: `data:${file.mimeType};base64,${toBase64(file.bytes)}` },
								},
							],
						},
					],
					max_tokens: 4096,
				},
				gatewayOptions(env, { step: "transcribe" }),
			);
			return truncate(String((out as { response?: unknown }).response ?? ""));
		},
		async json(input, prompt, schemaName, schema) {
			if (input.kind !== "text") throw new Error("Workers AI needs text input");
			const out = await env.AI.run(
				model,
				{
					messages: [
						{ role: "system", content: SYSTEM_PROMPT },
						{ role: "user", content: prompt(input.text) },
					],
					response_format: { type: "json_schema", json_schema: schema },
					max_tokens: 4096,
					temperature: 0,
				},
				gatewayOptions(env, { step: schemaName }),
			);
			return parseJsonLoose((out as { response?: unknown }).response);
		},
	};
}

// ── Anthropic (official SDK, native PDF input) ───────────────────────────────

function anthropic(env: Bindings, apiKey: string): Provider {
	const model = env.ANTHROPIC_MODEL || "claude-opus-5-5";
	let client: Anthropic | null = null;
	const getClient = async () => {
		// Loaded lazily: only the queue consumer ever needs the SDK, so request isolates don't parse it.
		const { default: AnthropicSdk } = await import("@anthropic-ai/sdk");
		client ??= new AnthropicSdk({
			apiKey,
			baseURL: await env.AI.gateway(env.AI_GATEWAY_ID || "sitemate").getUrl("anthropic"),
			defaultHeaders: env.AI_GATEWAY_TOKEN
				? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` }
				: undefined,
			maxRetries: 1,
		});
		return client;
	};
	return {
		name: "anthropic",
		model,
		async prepare(file) {
			if (file.mimeType === "application/pdf" && file.bytes.byteLength <= MAX_INLINE_BYTES) {
				return { kind: "pdf", base64: toBase64(file.bytes) };
			}
			if (isImage(file.mimeType)) {
				// Images go through Workers AI transcription so this provider and the default behave the same.
				return workersAi(env).prepare(file);
			}
			return truncate(await toMarkdown(env, file));
		},
		async json(input, prompt, _schemaName, schema) {
			const c = await getClient();
			const content: Anthropic.Beta.BetaContentBlockParam[] =
				input.kind === "pdf"
					? [
							{
								type: "document",
								source: { type: "base64", media_type: "application/pdf", data: input.base64 },
							},
							{ type: "text", text: prompt("(the attached PDF)") },
						]
					: [{ type: "text", text: prompt(input.text) }];
			const res = await c.beta.messages.create({
				model,
				max_tokens: 16000,
				system: SYSTEM_PROMPT,
				messages: [{ role: "user", content }],
				output_config: {
					effort: "low",
					format: { type: "json_schema", schema: schema as Record<string, unknown> },
				},
				// If a safety classifier declines, the API retries on a fallback model in the same call.
				betas: ["server-side-fallback-2026-07-01"],
				fallbacks: "default",
			});
			if (res.stop_reason === "refusal") throw new Error("The model declined to read this document");
			const text = res.content.find((b) => b.type === "text");
			if (text?.type !== "text") throw new Error("Empty response from Claude");
			return parseJsonLoose(text.text);
		},
	};
}

// ── Any OpenAI-compatible API ────────────────────────────────────────────────

function openaiCompatible(env: Bindings, apiKey: string): Provider {
	const model = env.OPENAI_COMPAT_MODEL || "openai/gpt-5-mini";
	const baseUrl = async () =>
		// Default: AI Gateway's OpenAI-compatible endpoint, which routes "provider/model" names.
		(
			env.OPENAI_COMPAT_BASE_URL || (await env.AI.gateway(env.AI_GATEWAY_ID || "sitemate").getUrl("compat"))
		).replace(/\/$/, "");
	return {
		name: "openai-compatible",
		model,
		async prepare(file) {
			if (isImage(file.mimeType)) return workersAi(env).prepare(file);
			return truncate(await toMarkdown(env, file));
		},
		async json(input, prompt, schemaName, schema) {
			if (input.kind !== "text") throw new Error("OpenAI-compatible provider needs text input");
			const res = await fetch(`${await baseUrl()}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					...(env.AI_GATEWAY_TOKEN ? { "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}` } : {}),
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: SYSTEM_PROMPT },
						{ role: "user", content: prompt(input.text) },
					],
					response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
				}),
			});
			if (!res.ok) throw new Error(`Provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
			const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
			return parseJsonLoose(body.choices?.[0]?.message?.content ?? "");
		},
	};
}

/** Providers that can run right now (their key is present). Workers AI is always available. */
export function enabledProviders(env: Bindings): ProviderName[] {
	const out: ProviderName[] = ["workers-ai"];
	if (env.ANTHROPIC_API_KEY) out.push("anthropic");
	if (env.OPENAI_COMPAT_API_KEY) out.push("openai-compatible");
	return out;
}

export function selectProvider(env: Bindings): Provider {
	const wanted = (env.AI_PROVIDER || "workers-ai") as ProviderName;
	if (wanted === "anthropic" && env.ANTHROPIC_API_KEY) return anthropic(env, env.ANTHROPIC_API_KEY);
	if (wanted === "openai-compatible" && env.OPENAI_COMPAT_API_KEY)
		return openaiCompatible(env, env.OPENAI_COMPAT_API_KEY);
	if (wanted !== "workers-ai") console.warn(`AI_PROVIDER=${wanted} has no API key; using workers-ai`);
	return workersAi(env);
}
