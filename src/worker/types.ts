import type { Me } from "../shared/api-types";
import type { Db } from "./db";

/** Vars from wrangler.jsonc, widened from the literal types `wrangler types` generates. */
type Vars =
	| "APP_ENV"
	| "APP_URL"
	| "R2_BUCKET"
	| "AI_PROVIDER"
	| "AI_GATEWAY_ID"
	| "WORKERS_AI_MODEL"
	| "ANTHROPIC_MODEL"
	| "OPENAI_COMPAT_MODEL"
	| "EMAIL_MODE"
	| "EMAIL_FROM"
	| "EMAIL_DAILY_LIMIT";

/** Wrangler-generated bindings plus secrets that live in .dev.vars / `wrangler secret`. */
export type Bindings = Omit<Env, Vars> & { [K in Vars]: string } & {
	// Clerk
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	CLERK_JWT_KEY?: string;
	AUTHORIZED_PARTIES?: string;
	// R2 S3 API token (presigned URLs)
	R2_ACCOUNT_ID?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	// Optional AI providers (enabled only when their key is present)
	ANTHROPIC_API_KEY?: string;
	OPENAI_COMPAT_API_KEY?: string;
	OPENAI_COMPAT_BASE_URL?: string;
	/** AI Gateway token, when the gateway has "Authenticated Gateway" turned on. */
	AI_GATEWAY_TOKEN?: string;
	// Email
	RESEND_API_KEY?: string;
	EMAIL_SANDBOX_TO?: string;
};

export type Variables = {
	db: Db;
	user: Me;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
