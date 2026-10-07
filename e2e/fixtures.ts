/** An in-memory stand-in for the API, enough to render every screen as an admin or a viewer. */
import type { Page, Route } from "@playwright/test";

const NOW = Date.parse("2026-10-03T09:42:00+10:00");
const DAY = 86_400_000;
const STAGES = [
	[
		"Pre-construction",
		[
			"Signed contract",
			"HBCF insurance certificate",
			"DA/CDC approval",
			"Survey",
			"Soil test",
			"Engineering plans",
		],
	],
	["Site preparation", ["Site set-up & fencing", "Excavation", "Services located"]],
	["Base / Slab", ["Pre-pour inspection (certifier)", "Slab pour photos", "Termite protection certificate"]],
	["Frame", ["Frame inspection", "Truss certification", "Roof on"]],
	["Lock-up", ["Windows", "External doors", "Roof", "External cladding"]],
	["Fixing", ["Plaster", "Cabinetry", "Tiling", "Waterproofing certificate", "Internal doors"]],
	["Practical completion", ["Final inspection", "Occupation certificate", "Compliance certificates"]],
	["Handover & defects", ["Keys handed over", "Defects list", "Warranty documents"]],
] as const;

const thumb = (hue: number) =>
	`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="hsl(${hue} 20% 55%)"/><path d="M40 300 L240 120 L440 300 Z" fill="none" stroke="white" stroke-width="6"/></svg>`)}`;

/** Files already attached to checks (ids match the /files fixtures below). */
const ATTACHMENTS: Record<string, unknown[]> = {
	s3i2: [
		{
			fileId: "ph1",
			filename: "IMG_1001.jpg",
			category: "photo",
			mimeType: "image/jpeg",
			thumbUrl: thumb(30),
		},
		{
			fileId: "ph2",
			filename: "IMG_1002.jpg",
			category: "photo",
			mimeType: "image/jpeg",
			thumbUrl: thumb(60),
		},
	],
	s3i3: [
		{
			fileId: "f2",
			filename: "Termite protection certificate.pdf",
			category: "certificate",
			mimeType: "application/pdf",
			thumbUrl: null,
		},
	],
};

export function makeProject() {
	return {
		id: "p1",
		name: "14 Banksia St",
		siteAddress: "14 Banksia Street",
		suburb: "Marsden Park",
		state: "NSW",
		postcode: "2765",
		clientName: "Nguyen family",
		clientEmail: "nguyen@example.com",
		clientPhone: "0400 000 000",
		status: "active",
		startDate: "2026-05-04",
		targetCompletion: "2027-02-26",
		templateId: "tpl_nsw_new_build",
		createdAt: NOW - 150 * DAY,
		updatedAt: NOW - 2 * 3600_000,
		stages: STAGES.map(([name, items], i) => ({
			id: `s${i + 1}`,
			name,
			description: null,
			position: i + 1,
			status: i < 3 ? "complete" : i === 3 ? "in_progress" : "not_started",
			source: "template",
			startedAt: i <= 3 ? NOW - (120 - i * 25) * DAY : null,
			completedAt: i < 3 ? NOW - (100 - i * 25) * DAY : null,
			items: items.map((title, j) => ({
				id: `s${i + 1}i${j + 1}`,
				title,
				position: j + 1,
				source: "template",
				completedAt: i < 3 || (i === 3 && j < 2) ? NOW - (90 - i * 20) * DAY : null,
				completedBy: i < 3 || (i === 3 && j < 2) ? { id: "u1", name: "Priya Patel" } : null,
				attachments: ATTACHMENTS[`s${i + 1}i${j + 1}`] ?? [],
			})),
		})),
	};
}

export function installApi(page: Page, role: "admin" | "viewer", opts: { slowItemPatch?: boolean } = {}) {
	const project = makeProject();
	const writes: string[] = [];
	const json = (route: Route, body: unknown, status = 200) =>
		route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

	return page
		.addInitScript((r) => {
			(globalThis as { __E2E_ROLE?: string }).__E2E_ROLE = r;
		}, role)
		.then(() =>
			page.route("**/api/**", async (route) => {
				const url = new URL(route.request().url());
				const path = url.pathname.replace(/^\/api/, "");
				const method = route.request().method();
				if (role === "admin" && path === "/admin/ai/models")
					return json(route, {
						models: [
							{ id: "MiniMax-M2.7", name: null },
							{ id: "MiniMax-M3", name: null },
							{ id: "MiniMax-M3.1-Flash-Preview", name: null },
						],
					});
				if (role === "admin" && path === "/admin/ai/test")
					return json(route, { ok: true, model: "MiniMax-M3", latencyMs: 2300, reply: "OK" });
				if (method !== "GET") {
					writes.push(`${method} ${path}`);
					if (role === "viewer") return json(route, { error: "Requires admin role" }, 403);
					if (opts.slowItemPatch && path.startsWith("/items/")) await new Promise((r) => setTimeout(r, 1500));
					return json(route, { ok: true, id: "x" });
				}
				const me = { id: "u1", email: "sam@example.com", name: "Sam Site", role };
				if (path === "/me") return json(route, { ...me, emailNotifications: true });
				if (path === "/templates")
					return json(route, [
						{
							id: "tpl_nsw_new_build",
							name: "NSW Residential New Build",
							description: null,
							isDefault: true,
							stageCount: 8,
							itemCount: 30,
						},
					]);
				if (path === "/projects")
					return json(route, {
						items: [
							{
								...project,
								stages: project.stages.map(({ id, name, status }) => ({ id, name, status })),
								itemsDone: 11,
								itemsTotal: 30,
								photoCount: 24,
								recentPhotos: [0, 1, 2, 3].map((i) => ({ id: `ph${i}`, thumbUrl: thumb(i * 40) })),
							},
							{
								...project,
								id: "p2",
								name: "8 Kurrajong Ave — a much longer project name to test wrapping on small phones",
								suburb: "Box Hill",
								status: "on_hold",
								stages: project.stages.map(({ id, name }, i) => ({
									id,
									name,
									status: i < 5 ? "complete" : "not_started",
								})),
								itemsDone: 21,
								itemsTotal: 30,
								photoCount: 0,
								recentPhotos: [],
							},
						],
						nextCursor: null,
					});
				if (path === "/projects/p1") return json(route, project);
				if (path === "/projects/p1/notes")
					return json(route, {
						items: [
							{
								id: "n1",
								body: "Roof sheets delivered, install Thursday. Crane booked 7am — neighbours notified.",
								stage: { id: "s4", name: "Frame" },
								author: { id: "u1", name: "Sam Site", email: "sam@example.com" },
								createdAt: NOW - 3600_000,
								updatedAt: NOW - 3600_000,
							},
						],
						nextCursor: null,
					});
				if (path === "/activity" || path === "/projects/p1/activity")
					return json(route, {
						items: [
							{
								id: "a1",
								project: { id: "p1", name: project.name },
								actor: { id: "u1", name: "Priya Patel", email: "p@example.com" },
								action: "item.completed",
								entityType: "item",
								entityId: "s4i2",
								meta: { item: "Truss certification", stage: "Frame" },
								createdAt: NOW - 600_000,
							},
							{
								id: "a2",
								project: { id: "p1", name: project.name },
								actor: { id: "u1", name: "Sam Site", email: "sam@example.com" },
								action: "file.uploaded",
								entityType: "file",
								entityId: "f1",
								meta: { filename: "Harbour Frames Q-1042.pdf", category: "quote" },
								createdAt: NOW - DAY,
							},
							{
								id: "a3",
								project: { id: "p1", name: project.name },
								actor: { id: "u1", name: "Sam Site", email: "sam@example.com" },
								action: "stage.completed",
								entityType: "stage",
								entityId: "s3",
								meta: { stage: "Base / Slab" },
								createdAt: NOW - 3 * DAY,
							},
						],
						nextCursor: null,
					});
				if (path === "/projects/p1/files") {
					const kind = url.searchParams.get("kind");
					if (kind === "photos")
						return json(route, {
							items: Array.from({ length: 9 }, (_, i) => ({
								id: `ph${i}`,
								projectId: "p1",
								stage: { id: "s4", name: "Frame" },
								category: "photo",
								filename: `IMG_${1000 + i}.jpg`,
								mimeType: "image/jpeg",
								sizeBytes: 380_000,
								caption: i === 0 ? "Trusses craned in" : null,
								uploadedBy: { id: "u1", name: "Sam Site" },
								uploadedAt: NOW - i * 3600_000,
								thumbUrl: thumb(i * 30),
								extraction: null,
							})),
							nextCursor: null,
						});
					return json(route, {
						items: [
							{
								id: "f1",
								projectId: "p1",
								stage: { id: "s4", name: "Frame" },
								category: "quote",
								filename: "Harbour Frames Q-1042.pdf",
								mimeType: "application/pdf",
								sizeBytes: 182_000,
								caption: null,
								uploadedBy: { id: "u1", name: "Sam Site" },
								uploadedAt: NOW - DAY,
								thumbUrl: null,
								extraction: { id: "e1", status: "needs_review", detectedType: "quote" },
							},
							{
								id: "f2",
								projectId: "p1",
								stage: { id: "s3", name: "Base / Slab" },
								category: "certificate",
								filename: "Termite protection certificate.pdf",
								mimeType: "application/pdf",
								sizeBytes: 90_000,
								caption: "Issued by Kingsguard",
								uploadedBy: { id: "u1", name: "Sam Site" },
								uploadedAt: NOW - 30 * DAY,
								thumbUrl: null,
								extraction: { id: "e2", status: "confirmed", detectedType: "certificate" },
							},
							{
								id: "f3",
								projectId: "p1",
								stage: null,
								category: "plan",
								filename: "Window schedule.docx",
								mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
								sizeBytes: 48_000,
								caption: null,
								uploadedBy: { id: "u1", name: "Sam Site" },
								uploadedAt: NOW - 2 * DAY,
								thumbUrl: null,
								extraction: null,
							},
						],
						nextCursor: null,
					});
				}
				if (path === "/projects/p1/quotes")
					return json(route, {
						quotes: [
							{
								id: "q1",
								projectId: "p1",
								supplier: { id: "sup1", name: "Coastal Plumbing Pty Ltd", abn: "51824753556" },
								trade: "Plumbing",
								quoteNumber: "CP-77",
								quoteDate: "2026-08-02",
								validUntil: "2026-11-02",
								amountExGstCents: 1_840_000,
								gstCents: 184_000,
								amountIncGstCents: 2_024_000,
								status: "accepted",
								decidedBy: { id: "u1", name: "Sam Site" },
								decidedAt: NOW - 20 * DAY,
								fileId: "f9",
								extractionId: "e9",
							},
							{
								id: "q2",
								projectId: "p1",
								supplier: { id: "sup2", name: "Westside Electrical", abn: null },
								trade: "Electrical",
								quoteNumber: null,
								quoteDate: "2026-09-12",
								validUntil: null,
								amountExGstCents: 2_100_000,
								gstCents: 210_000,
								amountIncGstCents: 2_310_000,
								status: "pending",
								decidedBy: null,
								decidedAt: null,
								fileId: "f8",
								extractionId: "e8",
							},
						],
						totals: {
							byStatus: {
								pending: { exGstCents: 2_100_000, gstCents: 210_000, incGstCents: 2_310_000, count: 1 },
								accepted: { exGstCents: 1_840_000, gstCents: 184_000, incGstCents: 2_024_000, count: 1 },
								rejected: { exGstCents: 0, gstCents: 0, incGstCents: 0, count: 0 },
							},
							byTrade: [
								{
									trade: "Electrical",
									exGstCents: 2_100_000,
									gstCents: 210_000,
									incGstCents: 2_310_000,
									count: 1,
									acceptedIncGstCents: 0,
								},
								{
									trade: "Plumbing",
									exGstCents: 1_840_000,
									gstCents: 184_000,
									incGstCents: 2_024_000,
									count: 1,
									acceptedIncGstCents: 2_024_000,
								},
							],
						},
					});
				const summary = {
					id: "e1",
					status: "needs_review",
					detectedType: "quote",
					confidence: 93,
					provider: "workers-ai",
					model: "@cf/meta/llama-4-scout-17b-16e-instruct",
					error: null,
					createdAt: NOW - DAY,
					updatedAt: NOW - DAY,
					file: {
						id: "f1",
						filename: "Harbour Frames Q-1042.pdf",
						mimeType: "application/pdf",
						category: "quote",
					},
					project: { id: "p1", name: project.name },
				};
				if (path === "/extractions") return json(route, { items: [summary], nextCursor: null });
				if (path === "/extractions/e1")
					return json(route, {
						...summary,
						fields: {
							documentType: "quote",
							suggestedStage: "Frame",
							quote: {
								supplierName: "Harbour Frames Pty Ltd",
								abn: "51 824 753 556",
								trade: "Framing",
								supplierEmail: "quotes@harbourframes.example",
								supplierPhone: null,
								quoteNumber: "Q-1042",
								quoteDate: "2026-09-20",
								validUntil: "2026-12-19",
								lineItems: [
									{ description: "Wall frames", amountCents: 1_850_000 },
									{ description: "Roof trusses", amountCents: 1_150_000 },
								],
								amountExGstCents: 3_000_000,
								gstCents: 250_000,
								amountIncGstCents: 3_300_000,
							},
							supplierMatch: null,
						},
						validation: { checks: [], warnings: [] },
						reviewedBy: null,
						reviewedAt: null,
						quoteId: null,
						stages: project.stages.map(({ id, name, status }) => ({ id, name, status })),
					});
				if (path === "/files/f1/url") return json(route, { url: "about:blank", expiresAt: NOW + DAY });
				if (path.startsWith("/files/")) return json(route, { url: thumb(10), expiresAt: NOW + DAY });
				if (path === "/suppliers")
					return json(route, [
						{
							id: "sup1",
							name: "Coastal Plumbing Pty Ltd",
							abn: "51824753556",
							trade: "Plumbing",
							email: null,
							phone: null,
						},
					]);
				if (path === "/admin/team")
					return json(route, {
						projects: [
							{ id: "p1", name: "14 Banksia St", archived: false },
							{ id: "p2", name: "8 Kurrajong Ave", archived: false },
							{ id: "p9", name: "3 Old Mill Rd", archived: true },
						],
						members: [
							{
								id: "u1",
								email: "sam@example.com",
								name: "Sam Site",
								role: "admin",
								imageUrl: null,
								lastSignInAt: NOW - 3600_000,
								lastActiveAt: NOW - 600_000,
								accessRemoved: false,
								projectIds: [],
								createdAt: NOW - 200 * DAY,
							},
							{
								id: "u2",
								email: "priya.patel.longemailaddress@example.com",
								name: "Priya Patel",
								role: "viewer",
								imageUrl: null,
								lastSignInAt: null,
								lastActiveAt: null,
								accessRemoved: false,
								projectIds: ["p1"],
								createdAt: NOW - 20 * DAY,
							},
							{
								id: "u3",
								email: "former.sub@example.com",
								name: "Alex Former",
								role: "viewer",
								imageUrl: null,
								lastSignInAt: NOW - 40 * DAY,
								lastActiveAt: NOW - 40 * DAY,
								accessRemoved: true,
								projectIds: [],
								createdAt: NOW - 90 * DAY,
							},
						],
						invitations: [
							{
								id: "inv1",
								email: "site.super@example.com",
								role: "viewer",
								status: "pending",
								projectIds: ["p1", "p2"],
								createdAt: NOW - DAY,
							},
						],
					});
				if (path === "/admin/ai")
					return json(route, {
						active: {
							provider: "workers-ai",
							model: "@cf/meta/llama-4-scout-17b-16e-instruct",
							custom: false,
						},
						custom: null,
						canStoreKeys: true,
					});
				if (path === "/admin/email-log")
					return json(route, { sentLast24h: 3, limit: 90, mode: "sandbox", configured: true, items: [] });
				return json(route, { error: `No fixture for ${path}` }, 404);
			}),
		)
		.then(() => ({ writes }));
}
