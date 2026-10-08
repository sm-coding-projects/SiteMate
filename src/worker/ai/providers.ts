/**
 * AI provider adapter (docs/DESIGN.md §5). An admin-configured endpoint (Account → AI model, stored in
 * `ai_settings`) wins; otherwise AI_PROVIDER picks. The built-in providers go through the Cloudflare AI
 * Gateway named by AI_GATEWAY_ID, and are only used when their key is present; otherwise the free
 * Workers AI default is used.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { aiSettings } from "../../db/schema";
import type { Db } from "../db";
import { decryptSecret } from "../lib/secret-box";
import type { Bindings } from "../types";
import {
	type ChatTurn,
	complete,
	completeWithTools,
	type Endpoint,
	stripThinking,
	type ToolCall,
	type ToolDef,
} from "./endpoint";
import { looksScanned, pdfPageCount, pdfPageJpegs } from "./pdf-scan";
import { MAX_DOCUMENT_CHARS, SYSTEM_PROMPT, TRANSCRIBE_PROMPT } from "./prompts";

export type ProviderName =
	| "workers-ai"
	| "anthropic"
	| "openai-compatible"
	| "custom-openai"
	| "custom-anthropic";

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
const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
	Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");

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

const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
/** Scanned pages are transcribed one call each; cap the calls (and neurons) per document. */
const MAX_SCANNED_PAGES = 8;

/** Workers AI vision: one image → its text. */
async function transcribeImage(env: Bindings, mimeType: string, bytes: ArrayBuffer | Uint8Array) {
	if (bytes.byteLength > MAX_INLINE_BYTES) throw new Error("Image is too large to read (5 MB max)");
	const model = (env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL) as typeof DEFAULT_WORKERS_AI_MODEL;
	const out = await env.AI.run(
		model,
		{
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: TRANSCRIBE_PROMPT },
						{ type: "image_url", image_url: { url: `data:${mimeType};base64,${toBase64(bytes)}` } },
					],
				},
			],
			max_tokens: 4096,
			temperature: 0,
		},
		gatewayOptions(env, { step: "transcribe" }),
	);
	return String((out as { response?: unknown }).response ?? "");
}

/**
 * Any non-PDF-native provider's file → text. PDFs use their text layer, unless it's a scan (every page an
 * image, next to no real words), when the page images are transcribed like a photo would be.
 */
async function toText(env: Bindings, file: SourceFile): Promise<DocumentInput> {
	if (isImage(file.mimeType)) return truncate(await transcribeImage(env, file.mimeType, file.bytes));
	const markdown = await toMarkdown(env, file);
	if (file.mimeType !== "application/pdf") return truncate(markdown);
	const pages = pdfPageCount(file.bytes);
	const jpegs = pdfPageJpegs(file.bytes);
	if (jpegs.length === 0 || jpegs.length < pages || !looksScanned(markdown, pages)) return truncate(markdown);
	const texts: string[] = [];
	for (const [i, jpeg] of jpegs.slice(0, MAX_SCANNED_PAGES).entries()) {
		texts.push(`## Page ${i + 1}\n\n${await transcribeImage(env, "image/jpeg", jpeg)}`);
	}
	const input = truncate(texts.join("\n\n"));
	return input.kind === "text" && jpegs.length > MAX_SCANNED_PAGES ? { ...input, truncated: true } : input;
}

/** Strips ```json fences and parses; some models wrap JSON even in JSON mode. */
export function parseJsonLoose(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const s = stripThinking(value)
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
	const model = (env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL) as typeof DEFAULT_WORKERS_AI_MODEL;
	return {
		name: "workers-ai",
		model,
		prepare: (file) => toText(env, file),
		async json(input, prompt, schemaName, schema) {
			if (input.kind !== "text") throw new Error("Workers AI needs text input");
			const messages = [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: prompt(input.text) },
			];
			const run = (
				response_format: { type: "json_schema" | "json_object"; json_schema?: unknown },
				msgs = messages,
			) =>
				env.AI.run(
					model,
					{ messages: msgs, response_format, max_tokens: 4096, temperature: 0 },
					gatewayOptions(env, { step: schemaName }),
				);
			let out: unknown;
			try {
				out = await run({ type: "json_schema", json_schema: schema });
			} catch (err) {
				// If the model rejects this schema shape, fall back to JSON mode with the schema in the prompt.
				console.warn("json_schema mode failed, retrying in json_object mode", String(err));
				out = await run({ type: "json_object" }, [
					{
						role: "system",
						content: `${SYSTEM_PROMPT}\nReply with one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
					},
					messages[1] as { role: string; content: string },
				]);
			}
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
			// Images go through Workers AI transcription so this provider and the default behave the same.
			return toText(env, file);
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
		prepare: (file) => toText(env, file),
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

// ── Workspace endpoint (Account → AI model) ─────────────────────────────────

/** The model reasons before answering (MiniMax M3 always does), so leave room for both. */
const CUSTOM_MAX_TOKENS = 16_000;

function custom(env: Bindings, endpoint: Endpoint, model: string): Provider {
	return {
		name: endpoint.protocol === "anthropic" ? "custom-anthropic" : "custom-openai",
		model,
		// File → text stays on Workers AI (free); the configured model does all the reading and reasoning.
		prepare: (file) => toText(env, file),
		async json(input, prompt, schemaName, schema) {
			if (input.kind !== "text") throw new Error("The configured model needs text input");
			const text = await complete(endpoint, model, {
				system: SYSTEM_PROMPT,
				user: prompt(input.text),
				maxTokens: CUSTOM_MAX_TOKENS,
				schema: { name: schemaName, schema },
			});
			return parseJsonLoose(text);
		},
	};
}

/** The saved workspace endpoint with its key decrypted, or null when none is saved. */
export async function loadCustomEndpoint(env: Bindings, db: Db) {
	const row = await db.query.aiSettings.findFirst({ where: eq(aiSettings.id, "default") });
	if (!row) return null;
	const apiKey = await decryptSecret(env.SETTINGS_ENCRYPTION_KEY, row.apiKeyEncrypted);
	return { row, endpoint: { protocol: row.protocol, baseUrl: row.baseUrl, apiKey } satisfies Endpoint };
}

/**
 * The provider for every AI call: the admin-configured endpoint when one is saved, else AI_PROVIDER.
 * If the saved key can't be decrypted (secret rotated or missing) this throws rather than silently
 * switching to a different model.
 */
export async function resolveProvider(env: Bindings, db: Db): Promise<Provider> {
	const saved = await loadCustomEndpoint(env, db);
	return saved ? custom(env, saved.endpoint, saved.row.model) : selectProvider(env);
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

// ── Ask AI ───────────────────────────────────────────────────────────────────

/** Tool arguments as an object; malformed JSON becomes {} so that one call is refused, not the whole reply. */
function safeArgs(v: unknown): Record<string, unknown> {
	if (v && typeof v === "object") return v as Record<string, unknown>;
	if (typeof v !== "string") return {};
	try {
		const o = parseJsonLoose(v);
		return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export interface ChatModel {
	name: string;
	run(opts: {
		system: string;
		turns: ChatTurn[];
		tools: ToolDef[];
	}): Promise<{ text: string; calls: ToolCall[] }>;
}

/** The workspace endpoint when saved, else the env provider; Workers AI as the free default. */
export async function resolveChatModel(env: Bindings, db: Db): Promise<ChatModel> {
	const saved = await loadCustomEndpoint(env, db);
	const viaEndpoint = (endpoint: Endpoint, model: string): ChatModel => ({
		name: model,
		run: (o) => completeWithTools(endpoint, model, { ...o, maxTokens: CUSTOM_MAX_TOKENS }),
	});
	if (saved) return viaEndpoint(saved.endpoint, saved.row.model);
	const wanted = env.AI_PROVIDER || "workers-ai";
	if (wanted === "anthropic" && env.ANTHROPIC_API_KEY) {
		return viaEndpoint(
			{ protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: env.ANTHROPIC_API_KEY },
			env.ANTHROPIC_MODEL || "claude-opus-5-5",
		);
	}
	if (wanted === "openai-compatible" && env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_BASE_URL) {
		return viaEndpoint(
			{
				protocol: "openai",
				baseUrl: env.OPENAI_COMPAT_BASE_URL.replace(/\/$/, ""),
				apiKey: env.OPENAI_COMPAT_API_KEY,
			},
			env.OPENAI_COMPAT_MODEL || "openai/gpt-5-mini",
		);
	}
	const model = (env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL) as typeof DEFAULT_WORKERS_AI_MODEL;
	return {
		name: model,
		async run({ system, turns, tools }) {
			const out = (await env.AI.run(
				model,
				{
					messages: [{ role: "system", content: system }, ...turns],
					tools: tools.map((t) => ({ type: "function", function: t })),
					max_tokens: 4096,
					temperature: 0.2,
				} as never,
				gatewayOptions(env, { step: "chat" }),
			)) as { response?: unknown; tool_calls?: { name?: string; arguments?: unknown }[] };
			const calls = (out.tool_calls ?? [])
				.filter((c) => typeof c.name === "string")
				.map((c) => ({
					name: c.name as string,
					args: safeArgs(c.arguments),
				}));
			return { text: stripThinking(String(out.response ?? "")), calls };
		},
	};
}
