import { useUser } from "@clerk/react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { Wordmark } from "@/components/brand/wordmark";
import { OfflineBanner } from "@/components/offline-banner";
import { UploadTray } from "@/components/upload-tray";
import { cn } from "@/lib/utils";
import { ICON_PROPS, NAV } from "./nav";
import { MobileUserMenu, SidebarUser } from "./user-menu";

/**
 * The role from Clerk's user object (loaded before any page renders, see RequireAuth), so the right shell paints
 * first time. The API enforces the same rule from the session token.
 */
function useClerkIsAdmin() {
	return useUser().user?.publicMetadata?.role === "admin";
}

/** Review, workspace Activity and Team: viewers go back to their projects. */
export function AdminOnly() {
	return useClerkIsAdmin() ? <Outlet /> : <Navigate to="/projects" replace />;
}

/** Desktop (≥768px): left sidebar. Mobile: top bar + bottom tab bar. Viewers get a plain top bar instead. */
export function AppShell() {
	const { pathname } = useLocation();
	const isAdmin = useClerkIsAdmin();
	if (!isAdmin) return <ViewerShell />;
	const nav = NAV.filter((n) => !n.adminOnly || isAdmin);
	const mobileNav = nav.filter((n) => n.mobile);
	return (
		<div className="min-h-dvh md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
			<a
				href="#main"
				className="sr-only z-50 rounded-md bg-card px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				Skip to content
			</a>

			{/* Desktop sidebar */}
			<aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar md:flex">
				<div className="flex h-16 items-center px-5">
					<Wordmark />
				</div>
				<nav aria-labelledby="nav-workspace" className="flex-1 px-3 py-2">
					<p id="nav-workspace" className="px-3 pb-2 text-xs font-medium text-muted-foreground">
						Workspace
					</p>
					<ul className="space-y-0.5">
						{nav
							.filter((n) => n.group === "workspace")
							.map(({ to, label, icon: Icon }) => (
								<li key={to}>
									<NavLink
										to={to}
										className={({ isActive }) =>
											cn(
												"relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-enter",
												// Active = hi-vis bar (with ink edge) + ink label. No fill, no weight change.
												"before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-[1px] before:transition-colors before:duration-200",
												isActive
													? "text-foreground before:bg-hivis before:shadow-[inset_0_0_0_1px_var(--primary-edge)]"
													: "text-muted-foreground before:bg-transparent hover:bg-sidebar-accent hover:text-foreground",
											)
										}
									>
										<Icon {...ICON_PROPS} />
										{label}
									</NavLink>
								</li>
							))}
					</ul>
				</nav>
				<div className="border-t border-sidebar-border p-3">
					<SidebarUser />
				</div>
			</aside>

			<div className="flex min-w-0 flex-col">
				{/* Mobile top bar */}
				<header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-sidebar/95 px-4 pt-[env(safe-area-inset-top)] md:hidden">
					<Wordmark />
					<MobileUserMenu />
				</header>

				<OfflineBanner />
				<main
					id="main"
					className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-10 md:py-10 md:pb-10"
				>
					{/* Page change: 8px fade-up, content only — the sidebar stays still. */}
					<div key={pathname} className="animate-page-in">
						<Outlet />
					</div>
				</main>
			</div>

			<UploadTray />

			{/* Mobile bottom tab bar */}
			<nav
				aria-label="Main"
				className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
			>
				{mobileNav.map(({ to, label, icon: Icon }) => (
					<NavLink
						key={to}
						to={to}
						className={({ isActive }) =>
							cn(
								"flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-[120ms] ease-enter",
								isActive
									? "text-foreground shadow-[inset_0_3px_0_var(--hivis),inset_0_4px_0_var(--primary-edge)]"
									: "text-muted-foreground",
							)
						}
					>
						<Icon {...ICON_PROPS} />
						{label}
					</NavLink>
				))}
			</nav>
		</div>
	);
}

/** Viewers only see the projects shared with them, so there's nothing to navigate between: logo + account menu. */
function ViewerShell() {
	const { pathname } = useLocation();
	return (
		<div className="flex min-h-dvh flex-col">
			<a
				href="#main"
				className="sr-only z-50 rounded-md bg-card px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				Skip to content
			</a>
			<header className="sticky top-0 z-30 border-b bg-sidebar/95 pt-[env(safe-area-inset-top)]">
				<div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 md:h-16 md:px-10">
					<Link to="/projects" aria-label="Your projects">
						<Wordmark />
					</Link>
					<MobileUserMenu />
				</div>
			</header>
			<OfflineBanner />
			<main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 md:px-10 md:py-10">
				<div key={pathname} className="animate-page-in">
					<Outlet />
				</div>
			</main>
		</div>
	);
}
