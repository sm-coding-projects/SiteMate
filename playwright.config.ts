import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: true,
	reporter: [["list"]],
	use: {
		baseURL: "http://localhost:4173",
		// Use a preinstalled Chromium when present (e.g. CI images); otherwise Playwright's own.
		launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
	},
	webServer: {
		command: "pnpm vite --config vite.e2e.config.ts",
		url: "http://localhost:4173",
		reuseExistingServer: true,
		timeout: 60_000,
	},
});
