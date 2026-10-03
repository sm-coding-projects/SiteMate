/**
 * Keyset pagination cursors: "<sortValue>.<id>". Opaque to the client, stable under inserts,
 * and every page is an indexed range scan (no OFFSET).
 */
export function encodeCursor(sort: number, id: string) {
	return `${sort}.${id}`;
}

export function decodeCursor(cursor: string | undefined): { sort: number; id: string } | null {
	if (!cursor) return null;
	const dot = cursor.indexOf(".");
	if (dot < 1) return null;
	const sort = Number(cursor.slice(0, dot));
	const id = cursor.slice(dot + 1);
	return Number.isFinite(sort) && id ? { sort, id } : null;
}

/** Fetch `limit + 1` rows, return `limit` and the cursor for the next page. */
export function page<T>(rows: T[], limit: number, key: (row: T) => [number, string]) {
	const more = rows.length > limit;
	const items = more ? rows.slice(0, limit) : rows;
	const last = items[items.length - 1];
	return { items, nextCursor: more && last ? encodeCursor(...key(last)) : null };
}
