import { useClerk, useUser } from "@clerk/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, Send, Sun } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AiModelSettings } from "@/components/ai-model-settings";
import { initials, ROLE_LABEL, UserAvatar } from "@/components/layout/user-menu";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-data";
import { useMe } from "@/hooks/use-me";
import { type ThemePref, useTheme } from "@/hooks/use-theme";
import { errorMessage } from "@/lib/api";
import { formatWhen } from "@/lib/format";
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
			className="grid gap-4 border-t py-8 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-12"
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
				description="Managed by your sign‑in account. Changes show up across BFH App within a minute."
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

			<SettingsRow
				id="notify-h"
				title="Email notifications"
				description="Stage completions, and (for admins) documents ready for review."
			>
				<NotificationToggle />
			</SettingsRow>

			{me?.role === "admin" && (
				<SettingsRow
					id="email-h"
					title="Email delivery"
					description="Sends through Resend. Without a verified domain, every email goes to the Resend account owner."
				>
					<EmailStatus />
				</SettingsRow>
			)}

			{me?.role === "admin" && (
				<SettingsRow
					id="ai-h"
					title="AI model"
					description="Reads uploaded quotes and documents. Point it at any OpenAI‑ or Anthropic‑compatible endpoint, such as a MiniMax token plan. Applies to the whole workspace."
				>
					<AiModelSettings />
				</SettingsRow>
			)}

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
					<LogOut aria-hidden /> Sign out of BFH App
				</Button>
			</SettingsRow>
		</>
	);
}

function NotificationToggle() {
	const prefs = usePreferences();
	const update = useUpdatePreferences();
	if (prefs.isPending) return <Skeleton className="h-11 w-56" />;
	if (prefs.isError) return <QueryError error={prefs.error} onRetry={() => prefs.refetch()} />;
	const on = prefs.data.emailNotifications;
	return (
		<div>
			<label className="inline-flex min-h-11 cursor-pointer items-center gap-3">
				<input
					type="checkbox"
					role="switch"
					aria-checked={on}
					className="peer sr-only"
					checked={on}
					onChange={(e) => update.mutate({ emailNotifications: e.target.checked })}
				/>
				<span
					aria-hidden
					className={cn(
						"relative h-7 w-12 rounded-full border transition-colors duration-200 ease-enter peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
						on ? "border-foreground bg-foreground" : "border-input bg-muted",
					)}
				>
					<span
						className={cn(
							"absolute top-0.5 left-0.5 size-[1.375rem] rounded-full bg-card shadow-sm transition-transform duration-200 ease-enter",
							on && "translate-x-5",
						)}
					/>
				</span>
				<span className="font-medium">{on ? "On" : "Off"}</span>
			</label>
			{update.isError && <p className="mt-1 text-sm text-destructive">{errorMessage(update.error)}</p>}
		</div>
	);
}

interface EmailLogResponse {
	sentLast24h: number;
	limit: number;
	mode: string;
	configured: boolean;
	items: {
		id: string;
		kind: string;
		intendedTo: string;
		sentTo: string | null;
		subject: string;
		status: string;
		error: string | null;
		createdAt: number;
	}[];
}

function EmailStatus() {
	const api = useApi();
	const log = useQuery({ queryKey: ["email-log"], queryFn: () => api<EmailLogResponse>("/admin/email-log") });
	const [queued, setQueued] = useState(false);
	const test = useMutation({
		mutationFn: () => api("/admin/test-email", { method: "POST" }),
		onSuccess: () => {
			setQueued(true);
			setTimeout(() => log.refetch(), 8000);
		},
	});
	if (log.isPending) return <Skeleton className="h-24" />;
	if (log.isError) return <QueryError error={log.error} onRetry={() => log.refetch()} />;
	const d = log.data;
	return (
		<div className="grid gap-3">
			<p className="label-mono text-muted-foreground">
				{d.configured ? `Mode ${d.mode}` : "Not configured (RESEND_API_KEY missing)"} · {d.sentLast24h}/
				{d.limit} sent in 24h
			</p>
			<div>
				<Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
					<Send aria-hidden /> Send a test email
				</Button>
				<p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
					{test.isError
						? errorMessage(test.error)
						: queued
							? "Queued — it should arrive within a minute."
							: ""}
				</p>
			</div>
			{d.items.length > 0 && (
				<ul className="divide-y rounded-md border bg-card text-sm">
					{d.items.slice(0, 5).map((e) => (
						<li key={e.id} className="px-3 py-2">
							<span className="label-mono mr-2 text-muted-foreground">{e.status}</span>
							{e.subject}
							<span className="block text-xs text-muted-foreground">
								to {e.sentTo ?? e.intendedTo} · {formatWhen(e.createdAt)}
								{e.error && ` · ${e.error}`}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
