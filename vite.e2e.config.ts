import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** SPA only, Clerk replaced by e2e/clerk-mock.tsx, /api mocked by Playwright. For `pnpm test:e2e`. */
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@clerk/react": fileURLToPath(new URL("./e2e/clerk-mock.tsx", import.meta.url)),
			"@": fileURLToPath(new URL("./src/client", import.meta.url)),
		},
	},
	define: { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify("pk_test_e2e") },
	server: { port: 4173, strictPort: true },
});
