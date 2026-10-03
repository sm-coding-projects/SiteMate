/**
 * The landing page's URL. In production the app runs on app.<domain> and the landing page on <domain>
 * (see src/worker/hosts.ts); anywhere else (workers.dev, localhost) both share this origin.
 */
export function siteUrl(path = "/") {
	const { protocol, hostname, port } = window.location;
	if (!hostname.startsWith("app.")) return path;
	return `${protocol}//${hostname.slice("app.".length)}${port ? `:${port}` : ""}${path}`;
}
