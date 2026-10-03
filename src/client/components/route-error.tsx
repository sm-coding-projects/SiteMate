import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

export function ErrorFallback({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div role="alert" className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
			<span className="mb-4 grid size-14 place-items-center rounded-full bg-muted text-destructive">
				<TriangleAlert className="size-7" aria-hidden />
			</span>
			<h1 className="text-xl font-semibold">Something went wrong</h1>
			<p className="mt-1 text-muted-foreground">{message}</p>
			<Button className="mt-6" variant="outline" onClick={onRetry ?? (() => window.location.reload())}>
				Try again
			</Button>
		</div>
	);
}

/** React Router `errorElement` for any route. */
export function RouteError() {
	const error = useRouteError();
	const message = isRouteErrorResponse(error)
		? `${error.status} ${error.statusText}`
		: error instanceof Error
			? error.message
			: "Unexpected error";
	return <ErrorFallback message={message} />;
}
