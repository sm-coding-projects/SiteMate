import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db";

/** D1 allows at most 100 bound parameters per statement. */
export const D1_MAX_PARAMS = 100;

/** Split rows for multi-row INSERTs so each statement stays under the D1 parameter limit. */
export function chunkRows<T extends object>(rows: T[], columnsPerRow: number): T[][] {
	const size = Math.max(1, Math.floor(D1_MAX_PARAMS / columnsPerRow));
	const out: T[][] = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}

/** Any drizzle statement that can go in `db.batch`. */
export type Statement = BatchItem<"sqlite">;

/** `db.batch` over a dynamically built list (drizzle's signature wants a non-empty tuple). */
export function runBatch(db: Db, statements: Statement[]) {
	const [first, ...rest] = statements;
	if (!first) return Promise.resolve([]);
	return db.batch([first, ...rest]);
}
