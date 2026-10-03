import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { aiSettings } from "../../db/schema";
import type { AiSettings, AiTestResult } from "../../shared/api-types";
import { aiModelsQuery, aiSettingsUpdate } from "../../shared/schemas";
import { complete, type Endpoint, EndpointError, listModels } from "../ai/endpoint";
import { loadCustomEndpoint, selectProvider } from "../ai/providers";
import type { Db } from "../db";
import { logActivity } from "../lib/activity";
import { canEncrypt, encryptSecret } from "../lib/secret-box";
import { badRequest, zv } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import type { AppEnv, Bindings } from "../types";

const ROW_ID = "default";

async function readSettings(env: Bindings, db: Db): Promise<AiSettings> {
	const row = await db.query.aiSettings.findFirst({ where: eq(aiSettings.id, ROW_ID) });
	const fallback = selectProvider(env);
	return {
		active: row
			? { provider: `custom-${row.protocol}`, model: row.model, custom: true }
			: { provider: fallback.name, model: fallback.model, custom: false },
		custom: row
			? {
					protocol: row.protocol,
					baseUrl: row.baseUrl,
					model: row.model,
					keyHint: row.keyHint,
					updatedAt: row.updatedAt,
				}
			: null,
		canStoreKeys: canEncrypt(env.SETTINGS_ENCRYPTION_KEY),
	};
}

/**
 * The endpoint to call: the key from the form, or the saved key when the form leaves it blank. The saved
 * key is only reused for the host it was saved for, so changing the URL can't send it somewhere new.
 */
async function endpointFor(env: Bindings, db: Db, input: z.infer<typeof aiModelsQuery>): Promise<Endpoint> {
	if (input.apiKey) return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey: input.apiKey };
	const saved = await loadCustomEndpoint(env, db).catch(() => null);
	if (!saved || new URL(saved.endpoint.baseUrl).host !== new URL(input.baseUrl).host) {
		throw badRequest("Enter the API key for this endpoint");
	}
	return { protocol: input.protocol, baseUrl: input.baseUrl, apiKey: saved.endpoint.apiKey };
}

/** Provider failures are the admin's to fix (wrong URL, key or model), never a BFH App auth error. */
function endpointError(err: unknown): never {
	if (err instanceof EndpointError) {
		throw new HTTPException(err.status >= 400 && err.status < 500 ? 400 : 502, { message: err.message });
	}
	throw err;
}

/** Admin-only: the workspace AI model. The API key is write-only; responses carry its last 4 characters. */
export const aiSettingsRoutes = new Hono<AppEnv>()
	.use(requireRole("admin"))
	.get("/", async (c) => c.json(await readSettings(c.env, c.get("db"))))

	.post("/models", zv("json", aiModelsQuery), async (c) => {
		const endpoint = await endpointFor(c.env, c.get("db"), c.req.valid("json"));
		const models = await listModels(endpoint).catch(endpointError);
		return c.json({ models });
	})

	// A one-line round trip, so a wrong model ID shows up here rather than on the first upload.
	.post("/test", zv("json", aiSettingsUpdate), async (c) => {
		const input = c.req.valid("json");
		const endpoint = await endpointFor(c.env, c.get("db"), input);
		const started = Date.now();
		const reply = await complete(endpoint, input.model, {
			system: "You are a connectivity check.",
			user: "Reply with the single word OK.",
			maxTokens: 2048,
		}).catch(endpointError);
		return c.json({
			ok: true,
			model: input.model,
			latencyMs: Date.now() - started,
			reply: reply.slice(0, 200),
		} satisfies AiTestResult);
	})

	.put("/", zv("json", aiSettingsUpdate), async (c) => {
		const db = c.get("db");
		const me = c.get("user");
		const input = c.req.valid("json");
		if (!canEncrypt(c.env.SETTINGS_ENCRYPTION_KEY)) {
			throw badRequest("SETTINGS_ENCRYPTION_KEY isn't set on the Worker, so the API key can't be stored");
		}
		const { apiKey } = await endpointFor(c.env, db, input);
		const values = {
			protocol: input.protocol,
			baseUrl: input.baseUrl,
			model: input.model,
			apiKeyEncrypted: await encryptSecret(c.env.SETTINGS_ENCRYPTION_KEY, apiKey),
			keyHint: apiKey.slice(-4),
			updatedBy: me.id,
			updatedAt: Date.now(),
		};
		await db.batch([
			db
				.insert(aiSettings)
				.values({ id: ROW_ID, ...values })
				.onConflictDoUpdate({ target: aiSettings.id, set: values }),
			logActivity(db, {
				actorId: me.id,
				action: "ai.model_changed",
				entityType: "system",
				meta: { model: input.model, host: new URL(input.baseUrl).host },
			}),
		]);
		return c.json(await readSettings(c.env, db));
	})

	// Back to the AI_PROVIDER default (Workers AI unless configured otherwise). Deletes the stored key.
	.delete("/", async (c) => {
		const db = c.get("db");
		const me = c.get("user");
		const fallback = selectProvider(c.env);
		await db.batch([
			db.delete(aiSettings).where(eq(aiSettings.id, ROW_ID)),
			logActivity(db, {
				actorId: me.id,
				action: "ai.model_changed",
				entityType: "system",
				meta: { model: fallback.model, host: null },
			}),
		]);
		return c.json(await readSettings(c.env, db));
	});
