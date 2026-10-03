import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run outside per-test storage isolation, so migrations apply once per test file.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
