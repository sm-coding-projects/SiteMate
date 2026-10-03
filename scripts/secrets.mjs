#!/usr/bin/env node
/**
 * Production secrets: either reports which are set (`check`, name + prefix only) or uploads them with
 * `wrangler secret bulk` over stdin (`push <origin>`). Values are never printed.
 *
 * Clerk keys come only from .prod.vars (the production instance; .dev.vars keeps the development instance for
 * `pnpm dev`) and must be live keys. Everything else comes from .prod.vars if set there, else .dev.vars.
 * AUTHORIZED_PARTIES is replaced by the production origin; APP_ENV stays a plain var in wrangler.jsonc.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED = [
	"CLERK_SECRET_KEY",
	"CLERK_PUBLISHABLE_KEY",
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
];
const OPTIONAL = [
	"CLERK_JWT_KEY",
	"RESEND_API_KEY",
	"EMAIL_SANDBOX_TO",
	"ANTHROPIC_API_KEY",
	"OPENAI_COMPAT_API_KEY",
	"OPENAI_COMPAT_BASE_URL",
	"AI_GATEWAY_TOKEN",
	"SETTINGS_ENCRYPTION_KEY",
];

/** Clerk's development and production instances have different keys, so these never fall back to .dev.vars. */
const PROD_ONLY = ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "CLERK_JWT_KEY"];
const LIVE_PREFIX = { CLERK_SECRET_KEY: "sk_live_", CLERK_PUBLISHABLE_KEY: "pk_live_" };

function readVars(file) {
	if (!existsSync(file)) return {};
	const out = {};
	for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq < 1) continue;
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1).replace(/\\n/g, "\n");
		}
		out[line.slice(0, eq).trim()] = value;
	}
	return out;
}

function readProdVars() {
	if (!existsSync(".prod.vars")) {
		console.error(".prod.vars not found — copy .prod.vars.example and fill in the production Clerk keys.");
		process.exit(1);
	}
	const dev = readVars(".dev.vars");
	for (const k of PROD_ONLY) delete dev[k];
	return { ...dev, ...readVars(".prod.vars") };
}

/** "sk_test_…(48)" — enough to tell test from live keys without revealing anything. */
const describe = (v) => {
	const m = /^([a-z]+_(?:test|live)_|re_|sk-ant-|pk_|sk_|-----BEGIN)/.exec(v);
	return `${m ? m[1] : v.includes("@") ? "<email>" : "<set>"}…(${v.length} chars)`;
};

const [cmd, ...origins] = process.argv.slice(2);
const vars = readProdVars();
let missing = 0;
for (const k of [...REQUIRED, ...OPTIONAL]) {
	const v = vars[k];
	const req = REQUIRED.includes(k);
	const notLive = v && LIVE_PREFIX[k] && !v.startsWith(LIVE_PREFIX[k]);
	if (!v || notLive) missing += req ? 1 : 0;
	const status = notLive
		? `${describe(v)} — needs a ${LIVE_PREFIX[k]} key from the production instance`
		: v
			? describe(v)
			: req
				? "MISSING (required)"
				: "not set (optional)";
	console.log(`${v && !notLive ? "✓" : req ? "✗" : "·"} ${k.padEnd(24)} ${status}`);
}
if (cmd === "check") process.exit(missing ? 1 : 0);

if (cmd !== "push" || origins.length === 0) {
	console.error("Usage: node scripts/secrets.mjs check | push <app origin> [more origins…]");
	process.exit(1);
}
if (missing) {
	console.error("Fill in the required secrets first.");
	process.exit(1);
}
// Every origin the SPA is served from may send session tokens (app.bfhapp.com, plus the workers.dev fallback).
const secrets = { AUTHORIZED_PARTIES: origins.map((o) => new URL(o).origin).join(",") };
for (const k of [...REQUIRED, ...OPTIONAL]) if (vars[k]) secrets[k] = vars[k];
const res = spawnSync("pnpm", ["wrangler", "secret", "bulk"], {
	input: JSON.stringify(secrets),
	stdio: ["pipe", "inherit", "inherit"],
});
process.exit(res.status ?? 1);
