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
import { LandingPage } from "@/pages/landing";
import { ProjectActivityTab } from "@/pages/project/activity";
import { DocumentsTab } from "@/pages/project/documents";
import { ProjectLayout } from "@/pages/project/layout";
import { NotesTab } from "@/pages/project/notes";
import { PhotosTab } from "@/pages/project/photos";
import { QuotesTab } from "@/pages/project/quotes";
import { StagesTab } from "@/pages/project/stages";
import { ProjectsPage } from "@/pages/projects";
import { ReviewInboxPage, ReviewPage } from "@/pages/review";
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
	{ path: "/", element: <LandingPage />, errorElement: <RouteError /> },
	{ path: "/sign-in/*", element: <SignInPage />, errorElement: <RouteError /> },
	{
		element: <RequireAuth />,
		errorElement: <RouteError />,
		children: [
			{
				element: <AppShell />,
				errorElement: <RouteError />,
				children: [
					{ path: "projects", element: <ProjectsPage /> },
					{
						path: "projects/:id",
						element: <ProjectLayout />,
						errorElement: <RouteError />,
						children: [
							{ index: true, element: <StagesTab />, errorElement: <RouteError /> },
							{ path: "photos", element: <PhotosTab />, errorElement: <RouteError /> },
							{ path: "documents", element: <DocumentsTab />, errorElement: <RouteError /> },
							{ path: "quotes", element: <QuotesTab />, errorElement: <RouteError /> },
							{ path: "notes", element: <NotesTab />, errorElement: <RouteError /> },
							{ path: "activity", element: <ProjectActivityTab />, errorElement: <RouteError /> },
						],
					},
					{ path: "review", element: <ReviewInboxPage />, errorElement: <RouteError /> },
					{ path: "review/:id", element: <ReviewPage />, errorElement: <RouteError /> },
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
				afterSignOutUrl="/"
				localization={{
					signIn: {
						start: {
							title: "Sign in to your sites",
							titleCombined: "Sign in to your sites",
							// Invite note lives in the card (Clerk renders button + footer as one unit, so it can't go between).
							subtitle: "Invite only. Use the email your builder invited.",
							subtitleCombined: "Invite only. Use the email your builder invited.",
						},
					},
				}}
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
