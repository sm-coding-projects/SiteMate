/**
 * Two public hostnames on one Worker: the landing page on SITE_HOST (bfhapp.com) and the app on APP_HOST
 * (app.bfhapp.com). Any other host (workers.dev, localhost) serves everything, unchanged.
 */

type Hosts = { SITE_HOST?: string; APP_HOST?: string };

/** A redirect when the request is on the wrong hostname for its path, else null. */
export function hostRedirect(url: URL, env: Hosts): Response | null {
	const site = env.SITE_HOST?.toLowerCase();
	const app = env.APP_HOST?.toLowerCase();
	if (!site || !app) return null;
	const host = url.hostname.toLowerCase();

	// www.bfhapp.com → bfhapp.com, same path.
	if (host === `www.${site}`) return redirect(`https://${site}${url.pathname}${url.search}`, 301);

	if (host === site) {
		// Only the landing page lives here; everything else (sign-in, the app, its API) is on the app host.
		if (url.pathname === "/") return null;
		return redirect(`https://${app}${url.pathname}${url.search}`, 301);
	}

	if (host === app && url.pathname === "/") {
		// The app's front door: projects (signed-out visitors are sent on to sign-in by the SPA).
		return redirect(`https://${app}/projects${url.search}`, 302);
	}
	return null;
}

const redirect = (location: string, status: 301 | 302) =>
	new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
