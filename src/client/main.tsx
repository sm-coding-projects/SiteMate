import "./styles/globals.css";
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { RouteError } from "@/components/route-error";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiRequestError } from "@/lib/api";
import { AccountPage } from "@/pages/account";
import { ActivityPage } from "@/pages/activity";
import { ProjectsPage } from "@/pages/projects";
import { SetupRequired } from "@/pages/setup-required";
import { SignInPage } from "@/pages/sign-in";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Don't hammer the API on flaky 4G for errors that won't fix themselves.
			retry: (count, err) =>
				!(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
			refetchOnWindowFocus: false,
		},
	},
});

const router = createBrowserRouter([
	{ path: "/sign-in/*", element: <SignInPage />, errorElement: <RouteError /> },
	{
		element: <RequireAuth />,
		errorElement: <RouteError />,
		children: [
			{
				element: <AppShell />,
				errorElement: <RouteError />,
				children: [
					{ index: true, element: <Navigate to="/projects" replace /> },
					{ path: "projects", element: <ProjectsPage /> },
					{ path: "activity", element: <ActivityPage /> },
					{ path: "account", element: <AccountPage /> },
					{ path: "*", element: <Navigate to="/projects" replace /> },
				],
			},
		],
	},
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

const app = (
	<QueryClientProvider client={queryClient}>
		<TooltipProvider delayDuration={200}>
			<RouterProvider router={router} />
		</TooltipProvider>
	</QueryClientProvider>
);

createRoot(root).render(
	<StrictMode>
		{publishableKey ? (
			<ClerkProvider
				publishableKey={publishableKey}
				signInUrl="/sign-in"
				afterSignOutUrl="/sign-in"
				routerPush={(to) => router.navigate(to)}
				routerReplace={(to) => router.navigate(to, { replace: true })}
			>
				{app}
			</ClerkProvider>
		) : (
			<SetupRequired />
		)}
	</StrictMode>,
);
