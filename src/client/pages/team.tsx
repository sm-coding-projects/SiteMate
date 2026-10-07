import { EllipsisVertical, FolderKanban, MailPlus, Trash2, UserCheck, UserX, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate } from "react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { initials, ROLE_LABEL } from "@/components/layout/user-menu";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeam, useTeamMutation } from "@/hooks/use-data";
import { useMe } from "@/hooks/use-me";
import { errorMessage } from "@/lib/api";
import { formatDate, formatWhen } from "@/lib/format";
import type { Role, Team, TeamMember } from "../../shared/api-types";
import { inviteCreate } from "../../shared/schemas";

const ROLE_HELP: Record<Role, string> = {
	admin: "Creates and edits projects, uploads, confirms quotes, manages the team.",
	viewer:
		"Sees only the projects you share with them: photos, documents, quotes and notes. Can't change anything.",
};

type ProjectOption = Team["projects"][number];
const projectCount = (n: number) => (n === 0 ? "no projects yet" : n === 1 ? "1 project" : `${n} projects`);

export function TeamPage() {
	const { data: me, isPending } = useMe();
	const team = useTeam();
	const [inviting, setInviting] = useState(false);
	const setRole = useTeamMutation((api, { id, role }: { id: string; role: Role }) =>
		api(`/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
	);
	const revoke = useTeamMutation((api, id: string) => api(`/admin/invitations/${id}`, { method: "DELETE" }));
	const access = useTeamMutation((api, { id, remove }: { id: string; remove: boolean }) =>
		api(`/admin/users/${id}/${remove ? "remove-access" : "restore-access"}`, { method: "POST" }),
	);
	const [removing, setRemoving] = useState<TeamMember | null>(null);
	const del = useTeamMutation((api, id: string) => api(`/admin/users/${id}`, { method: "DELETE" }));
	const [deleting, setDeleting] = useState<TeamMember | null>(null);
	const [sharing, setSharing] = useState<TeamMember | null>(null);
	const projects = team.data?.projects ?? [];

	if (isPending) return <Skeleton className="h-64" />;
	if (me?.role !== "admin") return <Navigate to="/projects" replace />;

	return (
		<>
			<PageHeader
				title="Team"
				description="Who can sign in, and what they can do. Invitations are emailed by Clerk."
				actions={
					<Button onClick={() => setInviting(true)}>
						<MailPlus aria-hidden /> Invite
					</Button>
				}
			/>
			<InviteDialog open={inviting} onOpenChange={setInviting} projects={projects} />
			<ProjectsDialog member={sharing} onClose={() => setSharing(null)} projects={projects} />
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title={`Remove access for ${removing?.name ?? removing?.email ?? ""}?`}
				description="They're signed out everywhere within a minute and can't sign in again. Their notes, uploads and history stay. You can restore access later."
				confirmLabel="Remove access"
				destructive
				pending={access.isPending}
				onConfirm={() => {
					if (!removing) return;
					access.mutate({ id: removing.id, remove: true }, { onSuccess: () => setRemoving(null) });
				}}
			/>
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(o) => !o && setDeleting(null)}
				title={`Delete ${deleting?.name ?? deleting?.email ?? ""} permanently?`}
				description="Their account is deleted and they're signed out within a minute. This can't be undone: to bring them back, send a new invitation. Their name stays on past activity."
				confirmLabel="Delete permanently"
				destructive
				pending={del.isPending}
				onConfirm={() => {
					if (!deleting) return;
					del.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
				}}
			/>

			<dl className="mb-8 grid gap-4 sm:grid-cols-2">
				{(Object.keys(ROLE_HELP) as Role[]).map((r) => (
					<div key={r} className="rounded-md border bg-card p-4">
						<dt className="font-medium">{ROLE_LABEL[r]}</dt>
						<dd className="mt-1 text-sm text-muted-foreground">{ROLE_HELP[r]}</dd>
					</div>
				))}
			</dl>

			{team.isPending ? (
				<div role="status" aria-busy="true" className="space-y-2">
					<span className="sr-only">Loading team</span>
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
				</div>
			) : team.isError ? (
				<QueryError error={team.error} onRetry={() => team.refetch()} />
			) : (
				<>
					<section aria-labelledby="members-h">
						<h2 id="members-h" className="label-mono mb-3 text-muted-foreground">
							Members · {team.data.members.length}
						</h2>
						<ul className="divide-y rounded-md border bg-card">
							{team.data.members.map((m) => (
								<MemberRow
									key={m.id}
									member={m}
									isMe={m.id === me.id}
									pending={
										(setRole.isPending && setRole.variables?.id === m.id) ||
										(access.isPending && access.variables?.id === m.id) ||
										(del.isPending && del.variables === m.id)
									}
									onRole={(role) => setRole.mutate({ id: m.id, role })}
									onRemove={() => setRemoving(m)}
									onRestore={() => access.mutate({ id: m.id, remove: false })}
									onDelete={() => setDeleting(m)}
									onProjects={() => setSharing(m)}
								/>
							))}
						</ul>
						{setRole.isError && (
							<p className="mt-2 text-sm text-destructive">{errorMessage(setRole.error)}</p>
						)}
						{access.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(access.error)}</p>}
						{del.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(del.error)}</p>}
						<p className="mt-2 text-sm text-muted-foreground">
							Role changes reach the person's session within about a minute.
						</p>
					</section>

					<section aria-labelledby="invites-h" className="mt-10">
						<h2 id="invites-h" className="label-mono mb-3 text-muted-foreground">
							Pending invitations · {team.data.invitations.length}
						</h2>
						{team.data.invitations.length === 0 ? (
							<p className="text-muted-foreground">None. Invite someone with the button above.</p>
						) : (
							<ul className="divide-y rounded-md border bg-card">
								{team.data.invitations.map((i) => (
									<li key={i.id} className="flex items-center gap-3 px-4 py-3">
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{i.email}</span>
											<span className="block text-sm text-muted-foreground">
												{ROLE_LABEL[i.role]}
												{i.role === "viewer" && ` · ${projectCount(i.projectIds.length)}`} · sent{" "}
												{formatDate(i.createdAt)}
											</span>
										</span>
										<Button
											variant="ghost"
											size="sm"
											disabled={revoke.isPending}
											onClick={() => revoke.mutate(i.id)}
										>
											<X aria-hidden /> Revoke
										</Button>
									</li>
								))}
							</ul>
						)}
						{revoke.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(revoke.error)}</p>}
					</section>
				</>
			)}
		</>
	);
}

function MemberRow({
	member,
	isMe,
	pending,
	onRole,
	onRemove,
	onRestore,
	onDelete,
	onProjects,
}: {
	member: TeamMember;
	isMe: boolean;
	pending: boolean;
	onRole: (role: Role) => void;
	onRemove: () => void;
	onRestore: () => void;
	onDelete: () => void;
	onProjects: () => void;
}) {
	const removed = member.accessRemoved;
	return (
		<li className="flex flex-wrap items-center gap-3 px-4 py-3">
			<Avatar className="size-9">
				{member.imageUrl && <AvatarImage src={member.imageUrl} alt="" />}
				<AvatarFallback className="bg-ink font-mono text-xs font-medium text-[#eef0ec]">
					{initials(member.name, member.email)}
				</AvatarFallback>
			</Avatar>
			<span className="min-w-0 flex-[1_1_12rem]">
				<span className="block truncate font-medium">
					{member.name ?? member.email}
					{isMe && <span className="text-muted-foreground"> (you)</span>}
				</span>
				<span className="block truncate text-sm text-muted-foreground">
					{member.email}
					{removed
						? ""
						: member.lastActiveAt
							? ` · last active ${formatWhen(member.lastActiveAt)}`
							: " · not signed in yet"}
				</span>
				{member.role === "viewer" && !removed && (
					<span className="block text-sm text-muted-foreground">
						Sees {projectCount(member.projectIds.length)}
					</span>
				)}
				{removed && (
					<span className="mt-0.5 flex items-center gap-1 text-sm font-medium text-destructive">
						<UserX className="size-4" aria-hidden /> Access removed
					</span>
				)}
			</span>
			<NativeSelect
				aria-label={`Role for ${member.name ?? member.email}`}
				className="ml-auto w-32"
				value={member.role}
				disabled={isMe || removed || pending}
				title={isMe ? "You can't change your own role" : undefined}
				onChange={(e) => onRole(e.target.value as Role)}
			>
				<option value="admin">Admin</option>
				<option value="viewer">Viewer</option>
			</NativeSelect>
			{!isMe ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							disabled={pending}
							aria-label={`Actions for ${member.name ?? member.email}`}
						>
							<EllipsisVertical aria-hidden />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						{member.role === "viewer" && (
							<DropdownMenuItem className="min-h-11" onSelect={onProjects}>
								<FolderKanban aria-hidden /> Projects…
							</DropdownMenuItem>
						)}
						{removed ? (
							<DropdownMenuItem className="min-h-11" onSelect={onRestore}>
								<UserCheck aria-hidden /> Restore access
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem className="min-h-11" onSelect={onRemove}>
								<UserX aria-hidden /> Remove access
							</DropdownMenuItem>
						)}
						{/* Admins can only be deactivated; demote to viewer first to delete. */}
						{member.role === "viewer" && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem className="min-h-11 text-destructive" onSelect={onDelete}>
									<Trash2 aria-hidden /> Delete permanently
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				// Your own row has no actions menu; hold its place so every role select lines up.
				<span aria-hidden className="size-11 shrink-0" />
			)}
		</li>
	);
}

function InviteDialog({
	open,
	onOpenChange,
	projects,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	projects: ProjectOption[];
}) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("viewer");
	const [projectIds, setProjectIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const invite = useTeamMutation((api, body: { email: string; role: Role; projectIds: string[] }) =>
		api("/admin/invitations", { method: "POST", body: JSON.stringify(body) }),
	);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const parsed = inviteCreate.safeParse({
			email: email.trim(),
			role,
			projectIds: role === "viewer" ? projectIds : [],
		});
		if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the email");
		setError(null);
		invite.mutate(parsed.data, {
			onSuccess: () => {
				setEmail("");
				setProjectIds([]);
				onOpenChange(false);
			},
			onError: (err) => setError(errorMessage(err)),
		});
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
					<DialogHeader>
						<DialogTitle>Invite someone</DialogTitle>
						<DialogDescription>
							Clerk emails them a sign‑up link. Only invited addresses can create an account.
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						<Field id="inv-email" label="Email" error={error}>
							<Input
								id="inv-email"
								type="email"
								inputMode="email"
								autoComplete="off"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								aria-invalid={Boolean(error)}
								autoFocus
							/>
						</Field>
						<Field id="inv-role" label="Role" hint={ROLE_HELP[role]}>
							<NativeSelect id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
								<option value="viewer">Viewer</option>
								<option value="admin">Admin</option>
							</NativeSelect>
						</Field>
						{role === "viewer" && (
							<ProjectPicker projects={projects} selected={projectIds} onChange={setProjectIds} />
						)}
					</DialogBody>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={invite.isPending}>
							{invite.isPending ? "Sending…" : "Send invitation"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Checkbox list of projects. Archived ones stay listed (and labelled) so existing access can be seen and removed. */
function ProjectPicker({
	projects,
	selected,
	onChange,
}: {
	projects: ProjectOption[];
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const toggle = (id: string) =>
		onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
	return (
		<fieldset className="grid gap-2">
			<legend className="mb-2 text-sm font-medium">Projects they can see</legend>
			{projects.length === 0 ? (
				<p className="text-sm text-muted-foreground">No projects yet. You can share one later from Team.</p>
			) : (
				<ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
					{projects.map((p) => (
						<li key={p.id}>
							<label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
								<input
									type="checkbox"
									className="size-4 shrink-0 accent-foreground"
									checked={selected.includes(p.id)}
									onChange={() => toggle(p.id)}
								/>
								<span className="min-w-0 flex-1 truncate">{p.name}</span>
								{p.archived && <span className="label-mono text-muted-foreground">Archived</span>}
							</label>
						</li>
					))}
				</ul>
			)}
			<p className="text-sm text-muted-foreground">
				{selected.length === 0
					? "They'll see nothing until you share a project."
					: `They'll see ${projectCount(selected.length)} and nothing else.`}
			</p>
		</fieldset>
	);
}

function ProjectsDialog({
	member,
	onClose,
	projects,
}: {
	member: TeamMember | null;
	onClose: () => void;
	projects: ProjectOption[];
}) {
	const [selected, setSelected] = useState<string[]>([]);
	const [shownFor, setShownFor] = useState<string | null>(null);
	// Reset the ticks each time the dialog opens for someone.
	if (member && shownFor !== member.id) {
		setShownFor(member.id);
		setSelected(member.projectIds);
	}
	const save = useTeamMutation((api, { id, projectIds }: { id: string; projectIds: string[] }) =>
		api(`/admin/users/${id}/projects`, { method: "PUT", body: JSON.stringify({ projectIds }) }),
	);
	const close = () => {
		setShownFor(null);
		save.reset();
		onClose();
	};
	const who = member?.name ?? member?.email ?? "";
	return (
		<Dialog open={member !== null} onOpenChange={(o) => !o && close()}>
			<DialogContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(e) => {
						e.preventDefault();
						if (member) save.mutate({ id: member.id, projectIds: selected }, { onSuccess: close });
					}}
				>
					<DialogHeader>
						<DialogTitle>Projects for {who}</DialogTitle>
						<DialogDescription>
							Viewers only see the projects ticked here. Changes apply the next time their page loads.
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						<ProjectPicker projects={projects} selected={selected} onChange={setSelected} />
						{save.isError && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
					</DialogBody>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={save.isPending}>
							{save.isPending ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
