import { expect, type Page, test } from "@playwright/test";
import { installApi } from "./fixtures";

const SHOTS = process.env.E2E_SCREENSHOTS; // directory, optional
const WIDTHS = [375, 768, 1280];
const PAGES = [
	"/projects",
	"/projects/p1",
	"/projects/p1/photos",
	"/projects/p1/documents",
	"/projects/p1/quotes",
	"/projects/p1/notes",
	"/projects/p1/activity",
	"/review",
	"/review/e1",
	"/activity",
	"/account",
	"/team",
];

async function noHorizontalScroll(page: Page) {
	const { scroll, client } = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(scroll, "page must not scroll sideways").toBeLessThanOrEqual(client);
}

for (const width of WIDTHS) {
	test.describe(`${width}px`, () => {
		test.use({ viewport: { width, height: width < 768 ? 812 : 900 } });
		for (const path of PAGES) {
			test(`admin ${path} renders without sideways scroll`, async ({ page }) => {
				await installApi(page, "admin");
				await page.goto(path);
				await expect(page.locator("main h1").first()).toBeVisible();
				await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
				await noHorizontalScroll(page);
				if (SHOTS)
					await page.screenshot({
						path: `${SHOTS}/${width}${path.replaceAll("/", "_")}.png`,
						fullPage: true,
					});
			});
		}
	});
}

test.describe("viewer is read-only in the UI", () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test("no create, edit, tick or upload controls", async ({ page }) => {
		const api = await installApi(page, "viewer");
		await page.goto("/projects");
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		await expect(page.getByRole("button", { name: /new project/i })).toHaveCount(0);

		await page.goto("/projects/p1");
		await expect(page.getByRole("heading", { name: "Frame" })).toBeVisible();
		await expect(page.getByRole("checkbox")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /add stage|mark complete|start stage|project actions/i }),
		).toHaveCount(0);
		await expect(page.getByRole("button", { name: /actions for/i })).toHaveCount(0);
		await expect(page.getByPlaceholder("Add a check")).toHaveCount(0);
		await expect(page.getByText("Truss certification")).toBeVisible();

		await page.goto("/projects/p1/photos");
		await expect(page.getByRole("button", { name: /add photos|take photo/i })).toHaveCount(0);
		await page.goto("/projects/p1/documents");
		await expect(page.getByRole("button", { name: /upload document/i })).toHaveCount(0);
		await page.goto("/projects/p1/notes");
		await expect(page.getByRole("button", { name: /post note/i })).toHaveCount(0);
		await page.goto("/projects/p1/quotes");
		await expect(page.getByRole("button", { name: /accept|reject/i })).toHaveCount(0);

		await page.goto("/review/e1");
		await expect(page.getByLabel("Supplier", { exact: true })).toBeDisabled();
		await expect(page.getByRole("button", { name: /confirm/i })).toHaveCount(0);

		await page.goto("/team");
		await expect(page).toHaveURL(/\/projects$/);
		expect(api.writes).toEqual([]);
	});
});

test.describe("admin interactions", () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test("ticking an item updates instantly (optimistic) and records who", async ({ page }) => {
		await installApi(page, "admin", { slowItemPatch: true });
		await page.goto("/projects/p1");
		const box = page.getByRole("checkbox", { name: /roof on/i });
		await expect(box).not.toBeChecked();
		await page.locator("label", { hasText: "Roof on" }).click();
		// The PATCH takes 1.5s in this fixture; the UI must not wait for it.
		await expect(box).toBeChecked({ timeout: 500 });
		await expect(page.getByText(/Ticked by Sam Site/).last()).toBeVisible({ timeout: 500 });
	});

	test("live validation flags the bad GST on the review screen", async ({ page }) => {
		await installApi(page, "admin");
		await page.goto("/review/e1");
		await expect(page.getByText(/GST is \$2,500\.00 but 10% of \$30,000\.00 is \$3,000\.00/)).toBeVisible();
		await page.getByLabel("GST", { exact: true }).fill("3000");
		await expect(page.getByText(/GST is 10% of the ex.GST amount/)).toBeVisible();
	});

	test("focus is visible on keyboard navigation", async ({ page }) => {
		await installApi(page, "admin");
		await page.goto("/projects");
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Tab");
		const outline = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement | null;
			if (!el || el === document.body) return "none";
			const s = getComputedStyle(el);
			return `${s.outlineStyle} ${s.outlineWidth}`;
		});
		expect(outline).not.toMatch(/^none/);
	});
});

test.describe("reduced motion", () => {
	test.use({ viewport: { width: 1280, height: 900 } });
	test("animations collapse", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await installApi(page, "admin");
		await page.goto("/projects");
		const duration = await page
			.locator(".animate-page-in")
			.first()
			.evaluate((el) => getComputedStyle(el).animationDuration);
		expect(Number.parseFloat(duration)).toBeLessThan(0.001);
	});
});

test("admin picks a model from the endpoint's list on the Account page", async ({ page }) => {
	await installApi(page, "admin");
	await page.goto("/account");
	const section = page.getByRole("region", { name: "AI model" });
	await expect(section.getByText("@cf/meta/llama-4-scout-17b-16e-instruct")).toBeVisible();
	await expect(section.getByLabel("Base URL")).toHaveValue("https://api.minimax.io/v1");
	await section.getByRole("radio", { name: "Anthropic‑compatible" }).click();
	await expect(section.getByLabel("Base URL")).toHaveValue("https://api.minimax.io/anthropic");
	await section.getByLabel("API key").fill("sk-test-key-1234");
	await section.getByRole("button", { name: "Fetch models" }).click();
	await expect(section.getByText("3 models available.")).toBeVisible();
	await expect(section.getByRole("combobox", { name: "Model" })).toHaveValue("MiniMax-M3");
	await section.getByRole("button", { name: "Test connection" }).click();
	await expect(section.getByText("MiniMax-M3 replied in 2.3s")).toBeVisible();
	await expect(section.getByRole("button", { name: "Save and use everywhere" })).toBeEnabled();
	if (SHOTS) await section.screenshot({ path: `${SHOTS}/account-ai-model.png` });
});

test.describe("checklist attachments", () => {
	for (const width of [375, 1280]) {
		test(`admin attaches existing photos and documents to a check at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			const { writes } = await installApi(page, "admin");
			await page.goto("/projects/p1?stage=s3");

			// Already attached: two photos on "Slab pour photos", a certificate on the termite check.
			const attached = page.getByRole("list", { name: "Attached files" });
			await expect(attached.first().getByRole("button", { name: /Open photo IMG_100[12]/ })).toHaveCount(2);
			await expect(page.getByRole("button", { name: "Termite protection certificate.pdf" })).toBeVisible();

			await page.getByRole("button", { name: "Actions for Slab pour photos" }).click();
			await page.getByRole("menuitem", { name: "Attach photos & documents" }).click();
			const dialog = page.getByRole("dialog", { name: "Attach to “Slab pour photos”" });
			await expect(dialog.getByText("2 files attached")).toBeVisible();
			await expect(dialog.getByRole("checkbox", { name: /IMG_1001/ })).toBeChecked();

			const option = (name: RegExp) => dialog.locator("label", { has: page.getByRole("checkbox", { name }) });
			await option(/IMG_1003/).click();
			await expect(dialog.getByRole("checkbox", { name: /IMG_1003/ })).toBeChecked();
			await dialog.getByRole("tab", { name: "documents" }).click();
			await option(/Harbour Frames/).click();
			await expect(dialog.getByText("4 files attached")).toBeVisible();
			if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/attach-dialog-${width}.png` });

			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			expect(writes).toContain("PUT /items/s3i2/files");
			await noHorizontalScroll(page);
			if (SHOTS)
				await page.screenshot({ path: `${SHOTS}/checklist-attachments-${width}.png`, fullPage: true });
		});
	}

	test("viewers see and can open attachments but can't change them", async ({ page }) => {
		await installApi(page, "viewer");
		await page.goto("/projects/p1?stage=s3");
		await expect(page.getByRole("button", { name: "Termite protection certificate.pdf" })).toBeVisible();
		await expect(page.getByRole("button", { name: /Actions for/ })).toHaveCount(0);
	});
});
