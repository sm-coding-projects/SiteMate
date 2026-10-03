import { useAuth } from "@clerk/react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireAuth() {
	const { isLoaded, isSignedIn } = useAuth();
	const location = useLocation();

	if (!isLoaded) return <ShellSkeleton />;
	if (!isSignedIn) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
	return <Outlet />;
}

/** Shown while Clerk loads, so the first paint on slow 4G has the shell's shape. */
function ShellSkeleton() {
	return (
		<div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]" role="status" aria-busy="true">
			<span className="sr-only">Loading</span>
			<div className="hidden border-r bg-sidebar p-4 md:block">
				<Skeleton className="mb-6 h-8 w-32" />
				<div className="space-y-2">
					<Skeleton className="h-11" />
					<Skeleton className="h-11" />
					<Skeleton className="h-11" />
				</div>
			</div>
			<div className="p-4 md:p-8">
				<Skeleton className="mb-6 h-8 w-40" />
				<Skeleton className="h-48 rounded-lg" />
			</div>
		</div>
	);
}
