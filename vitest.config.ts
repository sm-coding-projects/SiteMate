import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// API tests run inside workerd (Miniflare) against a local D1/R2/Queue, with migrations applied.
export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				remoteBindings: false,
				miniflare: {
					// The pool's bundled workerd lags wrangler's; tests pin the newest date it supports.
					compatibilityDate: "2026-08-22",
					// Tests drive the queue consumer by hand; produce to a queue nothing consumes.
					queueProducers: { JOBS: { queueName: "sitemate-jobs-test" } },
					bindings: {
						TEST_MIGRATIONS: migrations,
						APP_ENV: "test",
						APP_URL: "http://localhost:5173",
						CLERK_SECRET_KEY: "sk_test_dummy",
						CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
						R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
						R2_ACCESS_KEY_ID: "test-access-key",
						R2_SECRET_ACCESS_KEY: "test-secret-key",
						EMAIL_SANDBOX_TO: "owner@example.com",
					},
				},
			}),
		],
		test: {
			include: ["test/**/*.test.ts"],
			setupFiles: ["./test/mock-clerk.ts", "./test/apply-migrations.ts"],
		},
	};
});
