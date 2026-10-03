import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { JobMessage } from "../shared/api-types";
import { createDb } from "./db";
import { clerk, requireUser } from "./middleware/auth";
import { handleQueue } from "./queue";
import { adminRoutes } from "./routes/admin";
import { extractionRoutes, projectQuoteRoutes, quoteRoutes, supplierRoutes } from "./routes/extractions";
import { fileRoutes, projectFileRoutes } from "./routes/files";
import { meRoutes } from "./routes/me";
import { activityRoutes, noteRoutes, projectNoteRoutes } from "./routes/notes";
import { projectRoutes, templateRoutes } from "./routes/projects";
import { itemRoutes, projectStageRoutes, stageRoutes } from "./routes/stages";
import type { AppEnv, Bindings } from "./types";

const app = new Hono<AppEnv>().basePath("/api");

app.use(async (c, next) => {
	c.set("db", createDb(c.env.DB));
	await next();
});

// Public
app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV, time: Date.now() }));

// Everything below requires a signed-in user.
app.use(clerk(), requireUser());
app.route("/me", meRoutes);
app.route("/admin", adminRoutes);
app.route("/templates", templateRoutes);
app.route("/projects", projectRoutes);
app.route("/projects", projectStageRoutes);
app.route("/projects", projectNoteRoutes);
app.route("/projects", projectFileRoutes);
app.route("/files", fileRoutes);
app.route("/projects", projectQuoteRoutes);
app.route("/extractions", extractionRoutes);
app.route("/quotes", quoteRoutes);
app.route("/suppliers", supplierRoutes);
app.route("/stages", stageRoutes);
app.route("/items", itemRoutes);
app.route("/notes", noteRoutes);
app.route("/activity", activityRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
	if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
	console.error(err);
	return c.json({ error: "Internal error" }, 500);
});

export default {
	fetch: app.fetch,
	queue: (batch, env) => handleQueue(batch, env),
} satisfies ExportedHandler<Bindings, JobMessage>;
