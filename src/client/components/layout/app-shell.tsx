import { NavLink, Outlet } from "react-router";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { UserMenu } from "./user-menu";

/** Desktop (≥768px): left sidebar. Mobile: top bar + bottom tab bar. */
export function AppShell() {
	return (
		<div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
			<a
				href="#main"
				className="sr-only z-50 rounded-md bg-card px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
			>
				Skip to content
			</a>

			{/* Desktop sidebar */}
			<aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar md:flex">
				<div className="flex h-16 items-center px-4">
					<Wordmark />
				</div>
				<nav aria-label="Main" className="flex-1 space-y-1 px-3 py-2">
					{NAV.map(({ to, label, icon: Icon }) => (
						<NavLink
							key={to}
							to={to}
							className={({ isActive }) =>
								cn(
									"flex min-h-11 items-center gap-3 rounded-md px-3 font-medium transition-colors",
									isActive
										? "bg-sidebar-accent font-semibold text-foreground shadow-[inset_3px_0_0_var(--primary)]"
										: "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
								)
							}
						>
							<Icon className="size-5" aria-hidden />
							{label}
						</NavLink>
					))}
				</nav>
				<div className="border-t border-sidebar-border p-3">
					<UserMenu showDetails />
				</div>
			</aside>

			<div className="flex min-w-0 flex-col">
				{/* Mobile top bar */}
				<header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/95 px-4 pt-[env(safe-area-inset-top)] md:hidden">
					<Wordmark />
					<UserMenu />
				</header>

				<main
					id="main"
					className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8"
				>
					<Outlet />
				</main>
			</div>

			{/* Mobile bottom tab bar */}
			<nav
				aria-label="Main"
				className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
			>
				{NAV.map(({ to, label, icon: Icon }) => (
					<NavLink
						key={to}
						to={to}
						className={({ isActive }) =>
							cn(
								"flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
								isActive
									? "font-semibold text-foreground shadow-[inset_0_3px_0_var(--primary)]"
									: "text-muted-foreground",
							)
						}
					>
						<Icon className="size-6" aria-hidden />
						{label}
					</NavLink>
				))}
			</nav>
		</div>
	);
}
