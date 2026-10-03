import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type { z } from "zod";

/** First issue as "field: message", so the SPA can show it next to the input. */
export function formatIssues(error: z.ZodError) {
	const issue = error.issues[0];
	if (!issue) return "Invalid request";
	const path = issue.path.join(".");
	return path ? `${path}: ${issue.message}` : issue.message;
}

/** Hono validator backed by a shared Zod schema. 400 with a readable message on failure. */
export const zv = <T extends z.ZodType, Target extends "json" | "query" | "param">(
	target: Target,
	schema: T,
) =>
	validator(target, (value) => {
		const result = schema.safeParse(value);
		if (!result.success) throw new HTTPException(400, { message: formatIssues(result.error) });
		return result.data as z.output<T>;
	});

export const notFound = (what = "Not found") => new HTTPException(404, { message: what });
export const badRequest = (message: string) => new HTTPException(400, { message });
export const conflict = (message: string) => new HTTPException(409, { message });
