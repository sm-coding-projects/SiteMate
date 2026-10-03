import { CloudOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Inline failure for a section: says whether it's the connection, and offers a retry. */
export function QueryError({
	error,
	onRetry,
	className,
}: {
	error: unknown;
	onRetry?: () => void;
	className?: string;
}) {
	const offline = (error instanceof ApiRequestError && error.offline) || !navigator.onLine;
	const Icon = offline ? CloudOff : TriangleAlert;
	return (
		<div
			role="alert"
			className={cn("flex flex-wrap items-center gap-3 rounded-md border bg-card px-4 py-3", className)}
		>
			<Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
			<p className="min-w-0 flex-1 text-sm">
				{offline ? "No connection. Showing what was last loaded, if anything." : errorMessage(error)}
			</p>
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry}>
					Try again
				</Button>
			)}
		</div>
	);
}

/** "Load more" for infinite lists. */
export function LoadMore({
	hasNextPage,
	isFetchingNextPage,
	fetchNextPage,
}: {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	fetchNextPage: () => void;
}) {
	if (!hasNextPage) return null;
	return (
		<div className="mt-6 flex justify-center">
			<Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
				{isFetchingNextPage ? "Loading…" : "Load more"}
			</Button>
		</div>
	);
}
