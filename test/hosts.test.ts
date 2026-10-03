import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hostRedirect } from "../src/worker/hosts";

const env = { SITE_HOST: "bfhapp.com", APP_HOST: "app.bfhapp.com" };
const go = (url: string, e: { SITE_HOST?: string; APP_HOST?: string } = env) => {
	const res = hostRedirect(new URL(url), e);
	return res ? [res.status, res.headers.get("Location")] : null;
};

describe("hostnames", () => {
	it("serves only the landing page on bfhapp.com and sends everything else to app.bfhapp.com", () => {
		expect(go("https://bfhapp.com/")).toBeNull();
		expect(go("https://bfhapp.com/sign-in")).toEqual([301, "https://app.bfhapp.com/sign-in"]);
		expect(go("https://bfhapp.com/projects/p1/photos?stage=s3")).toEqual([
			301,
			"https://app.bfhapp.com/projects/p1/photos?stage=s3",
		]);
		expect(go("https://bfhapp.com/api/health")).toEqual([301, "https://app.bfhapp.com/api/health"]);
		expect(go("https://BFHApp.com/team")).toEqual([301, "https://app.bfhapp.com/team"]);
	});

	it("sends www to the bare domain", () => {
		expect(go("https://www.bfhapp.com/")).toEqual([301, "https://bfhapp.com/"]);
		expect(go("https://www.bfhapp.com/sign-in")).toEqual([301, "https://bfhapp.com/sign-in"]);
	});

	it("opens the app at /projects and leaves every other app path alone", () => {
		expect(go("https://app.bfhapp.com/")).toEqual([302, "https://app.bfhapp.com/projects"]);
		for (const path of ["/projects", "/sign-in", "/review/e1", "/api/health", "/account"]) {
			expect(go(`https://app.bfhapp.com${path}`)).toBeNull();
		}
	});

	it("changes nothing on workers.dev, localhost, or when the hosts aren't configured", () => {
		expect(go("https://sitemate.sitemate-au.workers.dev/")).toBeNull();
		expect(go("https://sitemate.sitemate-au.workers.dev/projects")).toBeNull();
		expect(go("http://localhost:5173/sign-in")).toBeNull();
		expect(go("https://bfhapp.com/sign-in", {})).toBeNull();
	});

	it("routes real requests: API on the app host works, API on the landing host redirects", async () => {
		const ok = await exports.default.fetch(new Request("https://app.bfhapp.com/api/health"));
		expect(ok.status).toBe(200);
		expect(await ok.json()).toMatchObject({ ok: true });
		const moved = await exports.default.fetch(new Request("https://bfhapp.com/api/health"), {
			redirect: "manual",
		});
		expect(moved.status).toBe(301);
		expect(moved.headers.get("Location")).toBe("https://app.bfhapp.com/api/health");
	});
});
