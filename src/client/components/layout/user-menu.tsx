import { useClerk, useUser } from "@clerk/react";
import { EllipsisVertical, LogOut, Monitor, Moon, Sun, UserRound, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
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
import { siteUrl } from "@/lib/hosts";
import { cn } from "@/lib/utils";

export const ROLE_LABEL = { admin: "Admin", viewer: "Viewer" } as const;

export function initials(name: string | null | undefined, email: string | undefined) {
	const src = name?.trim() || email || "?";
	return src
		.split(/[\s@.]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase())
		.join("");
}

function useProfile() {
	const { user } = useUser();
	const { data: me } = useMe();
	return {
		name: user?.fullName ?? me?.name ?? null,
		email: user?.primaryEmailAddress?.emailAddress ?? me?.email,
		// Clerk generates a cartoon avatar when there's no upload; only show a real photo.
		imageUrl: user?.hasImage ? user.imageUrl : undefined,
		role: me?.role,
	};
}

export function UserAvatar({ className }: { className?: string }) {
	const { name, email, imageUrl } = useProfile();
	return (
		<Avatar className={cn("size-8", className)}>
			{imageUrl && <AvatarImage src={imageUrl} alt="" />}
			<AvatarFallback className="bg-ink font-mono text-xs font-medium text-[#eef0ec]">
				{initials(name, email)}
			</AvatarFallback>
		</Avatar>
	);
}

/** Sidebar footer: the block opens Account; the ⋮ button opens theme + sign out. */
export function SidebarUser() {
	const { name, email, role } = useProfile();
	return (
		<div className="flex items-center gap-1">
			<NavLink
				to="/account"
				className={({ isActive }) =>
					cn(
						"flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-[120ms] ease-enter hover:bg-sidebar-accent",
						isActive && "bg-sidebar-accent",
					)
				}
			>
				<UserAvatar />
				<span className="min-w-0 flex-1 leading-tight">
					<span className="block truncate text-sm font-medium">{name ?? email}</span>
					{role && <span className="block text-sm text-muted-foreground">{ROLE_LABEL[role]}</span>}
				</span>
			</NavLink>
			<UserMenu
				trigger={
					<DropdownMenuTrigger
						className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-[120ms] ease-enter hover:bg-sidebar-accent hover:text-foreground"
						aria-label="Open user menu"
					>
						<EllipsisVertical className="size-[18px]" aria-hidden />
					</DropdownMenuTrigger>
				}
				side="top"
			/>
		</div>
	);
}

/** Mobile top bar: avatar opens the menu. */
export function MobileUserMenu() {
	return (
		<UserMenu
			trigger={
				<DropdownMenuTrigger
					className="grid size-11 place-items-center rounded-full"
					aria-label="Open user menu"
				>
					<UserAvatar />
				</DropdownMenuTrigger>
			}
			side="bottom"
		/>
	);
}

function UserMenu({ trigger, side }: { trigger: ReactNode; side: "top" | "bottom" }) {
	const { name, email, role } = useProfile();
	const { signOut } = useClerk();
	const { theme, setTheme } = useTheme();

	return (
		<DropdownMenu>
			{trigger}
			<DropdownMenuContent align="end" side={side} className="w-64">
				<DropdownMenuLabel className="font-normal">
					<span className="block truncate font-medium">{name ?? "Signed in"}</span>
					<span className="block truncate text-sm text-muted-foreground">
						{email}
						{role && ` · ${ROLE_LABEL[role]}`}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild className="min-h-11">
					<Link to="/account">
						<UserRound aria-hidden /> Account
					</Link>
				</DropdownMenuItem>
				{role === "admin" && (
					<DropdownMenuItem asChild className="min-h-11">
						<Link to="/team">
							<UsersRound aria-hidden /> Team
						</Link>
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Theme</DropdownMenuLabel>
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
				<DropdownMenuItem className="min-h-11" onSelect={() => signOut({ redirectUrl: siteUrl("/") })}>
					<LogOut aria-hidden /> Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
