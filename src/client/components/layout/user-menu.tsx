import { useClerk, useUser } from "@clerk/react";
import { LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { Link } from "react-router";
import { RoleBadge } from "@/components/role-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/hooks/use-me";
import { type ThemePref, useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function initials(name: string | null | undefined, email: string | undefined) {
	const src = name?.trim() || email || "?";
	return src
		.split(/[\s@.]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase())
		.join("");
}

export function UserMenu({ showDetails = false }: { showDetails?: boolean }) {
	const { user } = useUser();
	const { data: me } = useMe();
	const { signOut } = useClerk();
	const { theme, setTheme } = useTheme();
	const name = me?.name ?? user?.fullName ?? null;
	const email = me?.email ?? user?.primaryEmailAddress?.emailAddress;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={cn(
					"flex min-h-11 items-center gap-3 rounded-md text-left hover:bg-sidebar-accent",
					showDetails ? "w-full p-2" : "p-0.5",
				)}
				aria-label="Open user menu"
			>
				<Avatar className="size-10">
					<AvatarImage src={user?.imageUrl} alt="" />
					<AvatarFallback className="bg-secondary font-semibold">{initials(name, email)}</AvatarFallback>
				</Avatar>
				{showDetails && (
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-semibold">{name ?? email}</span>
						{me && <RoleBadge role={me.role} className="mt-0.5" />}
					</span>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" side={showDetails ? "top" : "bottom"} className="w-64">
				<DropdownMenuLabel className="font-normal">
					<span className="block truncate font-semibold">{name ?? "Signed in"}</span>
					<span className="block truncate text-sm text-muted-foreground">{email}</span>
					{me && <RoleBadge role={me.role} className="mt-2" />}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild className="min-h-11">
					<Link to="/account">
						<UserRound aria-hidden /> Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">Theme</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePref)}>
					<DropdownMenuRadioItem value="system" className="min-h-11">
						<Monitor aria-hidden /> System
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="light" className="min-h-11">
						<Sun aria-hidden /> Light
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark" className="min-h-11">
						<Moon aria-hidden /> Dark
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem className="min-h-11" onSelect={() => signOut({ redirectUrl: "/sign-in" })}>
					<LogOut aria-hidden /> Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
