import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";
import type { Me } from "../shared/api-types";

/** Wrangler-generated bindings plus secrets that live in .dev.vars / `wrangler secret`. */
export type Bindings = Omit<Env, "APP_ENV"> & {
	APP_ENV: string;
	CLERK_SECRET_KEY: string;
	CLERK_PUBLISHABLE_KEY: string;
	CLERK_JWT_KEY?: string;
	AUTHORIZED_PARTIES?: string;
};

export type Variables = {
	db: DrizzleD1Database<typeof schema>;
	user: Me;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
