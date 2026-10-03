import { useClerk } from "@clerk/react";
import { LogOut } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { RoleBadge } from "@/components/role-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { type ThemePref, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const THEMES: { value: ThemePref; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

export function AccountPage() {
	const { data: me, isPending } = useMe();
	const { signOut } = useClerk();
	const { theme, setTheme } = useTheme();

	return (
		<>
			<PageHeader title="Account" />
			<div className="max-w-xl space-y-6">
				<section className="rounded-lg border bg-card p-4 md:p-6" aria-labelledby="profile-h">
					<h2 id="profile-h" className="mb-4 text-lg font-semibold">
						Profile
					</h2>
					{isPending || !me ? (
						<div className="space-y-3" aria-busy="true">
							<Skeleton className="h-5 w-48" />
							<Skeleton className="h-5 w-64" />
							<Skeleton className="h-6 w-20" />
						</div>
					) : (
						<dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-base">
							<dt className="text-muted-foreground">Name</dt>
							<dd className="min-w-0 truncate font-medium">{me.name ?? "—"}</dd>
							<dt className="text-muted-foreground">Email</dt>
							<dd className="min-w-0 truncate font-medium">{me.email}</dd>
							<dt className="text-muted-foreground">Role</dt>
							<dd>
								<RoleBadge role={me.role} />
								<p className="mt-1 text-sm text-muted-foreground">
									{me.role === "admin"
										? "You can create and edit projects."
										: "You have read-only access. Ask an admin if you need to make changes."}
								</p>
							</dd>
						</dl>
					)}
				</section>

				<section className="rounded-lg border bg-card p-4 md:p-6" aria-labelledby="theme-h">
					<h2 id="theme-h" className="mb-4 text-lg font-semibold">
						Appearance
					</h2>
					<div role="radiogroup" aria-labelledby="theme-h" className="grid grid-cols-3 gap-2">
						{THEMES.map((t) => (
							// biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
							<button
								key={t.value}
								type="button"
								role="radio"
								aria-checked={theme === t.value}
								onClick={() => setTheme(t.value)}
								className={cn(
									"min-h-11 rounded-md border border-input font-medium transition-colors",
									theme === t.value
										? "border-foreground bg-secondary font-semibold"
										: "bg-card hover:bg-accent",
								)}
							>
								{t.label}
							</button>
						))}
					</div>
				</section>

				<Button variant="outline" onClick={() => signOut({ redirectUrl: "/sign-in" })}>
					<LogOut aria-hidden /> Sign out
				</Button>
			</div>
		</>
	);
}
