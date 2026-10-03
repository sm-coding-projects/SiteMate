import { useClerk, useUser } from "@clerk/react";
import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { initials, ROLE_LABEL, UserAvatar } from "@/components/layout/user-menu";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { type ThemePref, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const THEMES = [
	{ value: "system", label: "System", Icon: Monitor },
	{ value: "light", label: "Light", Icon: Sun },
	{ value: "dark", label: "Dark", Icon: Moon },
] as const satisfies readonly { value: ThemePref; label: string; Icon: typeof Sun }[];

/** Linear/Vercel-style row: label + description on the left, control on the right. */
function SettingsRow({
	id,
	title,
	description,
	children,
}: {
	id: string;
	title: string;
	description: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className="grid gap-4 border-t py-8 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-12"
		>
			<div>
				<h2 id={id} className="text-base font-semibold">
					{title}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

export function AccountPage() {
	const { data: me, isPending } = useMe();
	const { user } = useUser();
	const { signOut, openUserProfile } = useClerk();
	const { theme, setTheme } = useTheme();
	const name = user?.fullName ?? me?.name ?? null;
	const email = user?.primaryEmailAddress?.emailAddress ?? me?.email;

	return (
		<>
			<PageHeader title="Account" description="Your profile and preferences on this device." />

			<SettingsRow
				id="profile-h"
				title="Profile"
				description="Managed by your sign‑in account. Changes show up across SiteMate within a minute."
			>
				{isPending || !me ? (
					<div className="flex items-center gap-4" aria-busy="true">
						<Skeleton className="size-12 rounded-full" />
						<div className="space-y-2">
							<Skeleton className="h-5 w-40" />
							<Skeleton className="h-4 w-56" />
						</div>
					</div>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-4">
							<UserAvatar className="size-12 [&_[data-slot=avatar-fallback]]:text-base" />
							<div className="min-w-0">
								<p className="truncate font-medium">{name ?? initials(name, email)}</p>
								<p className="truncate text-sm text-muted-foreground">{email}</p>
							</div>
						</div>
						<Button variant="outline" size="sm" onClick={() => openUserProfile()}>
							Edit profile
						</Button>
					</div>
				)}
			</SettingsRow>

			<SettingsRow
				id="role-h"
				title="Role"
				description="Set by a workspace admin. Ask one if you need different access."
			>
				{me ? (
					<div>
						<p className="font-medium">{ROLE_LABEL[me.role]}</p>
						<p className="mt-0.5 text-sm text-muted-foreground">
							{me.role === "admin"
								? "Create and edit projects, stages, checklists and files."
								: "View projects, photos and documents. Read‑only."}
						</p>
					</div>
				) : (
					<Skeleton className="h-10 w-64" />
				)}
			</SettingsRow>

			<SettingsRow id="theme-h" title="Theme" description="Follow your device, or pick one for this browser.">
				<div
					role="radiogroup"
					aria-labelledby="theme-h"
					className="inline-flex rounded-md border bg-muted p-0.5"
				>
					{THEMES.map(({ value, label, Icon }) => (
						// biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={theme === value}
							onClick={() => setTheme(value)}
							className={cn(
								// Compact on mouse/trackpad; full 44px on touch (gloves).
								"inline-flex h-11 items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 text-sm font-medium transition-colors duration-[120ms] ease-enter pointer-fine:h-8",
								theme === value
									? "bg-card text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="size-4" aria-hidden />
							{label}
						</button>
					))}
				</div>
			</SettingsRow>

			<SettingsRow
				id="session-h"
				title="Session"
				description={email ? `Signed in as ${email}.` : "Signed in."}
			>
				<Button
					variant="ghost"
					size="sm"
					className="-ml-3 text-muted-foreground hover:text-destructive"
					onClick={() => signOut({ redirectUrl: "/" })}
				>
					<LogOut aria-hidden /> Sign out of SiteMate
				</Button>
			</SettingsRow>
		</>
	);
}
