import { MailPlus, UserCheck, UserX, X } from "lucide-react";
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
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeam, useTeamMutation } from "@/hooks/use-data";
import { useMe } from "@/hooks/use-me";
import { errorMessage } from "@/lib/api";
import { formatDate, formatWhen } from "@/lib/format";
import type { Role, TeamMember } from "../../shared/api-types";
import { inviteCreate } from "../../shared/schemas";

const ROLE_HELP: Record<Role, string> = {
	admin: "Creates and edits projects, uploads, confirms quotes, manages the team.",
	viewer: "Sees every project, photo, document and quote. Can't change anything.",
};

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
			<InviteDialog open={inviting} onOpenChange={setInviting} />
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
										(access.isPending && access.variables?.id === m.id)
									}
									onRole={(role) => setRole.mutate({ id: m.id, role })}
									onRemove={() => setRemoving(m)}
									onRestore={() => access.mutate({ id: m.id, remove: false })}
								/>
							))}
						</ul>
						{setRole.isError && (
							<p className="mt-2 text-sm text-destructive">{errorMessage(setRole.error)}</p>
						)}
						{access.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(access.error)}</p>}
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
												{ROLE_LABEL[i.role]} · sent {formatDate(i.createdAt)}
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
}: {
	member: TeamMember;
	isMe: boolean;
	pending: boolean;
	onRole: (role: Role) => void;
	onRemove: () => void;
	onRestore: () => void;
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
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium">
					{member.name ?? member.email}
					{isMe && <span className="text-muted-foreground"> (you)</span>}
				</span>
				<span className="block truncate text-sm text-muted-foreground">
					{member.email}
					{removed
						? ""
						: member.lastSignInAt
							? ` · last in ${formatWhen(member.lastSignInAt)}`
							: " · not signed in yet"}
				</span>
				{removed && (
					<span className="mt-0.5 flex items-center gap-1 text-sm font-medium text-destructive">
						<UserX className="size-4" aria-hidden /> Access removed
					</span>
				)}
			</span>
			<NativeSelect
				aria-label={`Role for ${member.name ?? member.email}`}
				className="w-32"
				value={member.role}
				disabled={isMe || removed || pending}
				title={isMe ? "You can't change your own role" : undefined}
				onChange={(e) => onRole(e.target.value as Role)}
			>
				<option value="admin">Admin</option>
				<option value="viewer">Viewer</option>
			</NativeSelect>
			{removed ? (
				<Button variant="outline" size="sm" className="ml-auto" disabled={pending} onClick={onRestore}>
					<UserCheck aria-hidden /> Restore access
				</Button>
			) : (
				!isMe && (
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						disabled={pending}
						onClick={onRemove}
						aria-label={`Remove access for ${member.name ?? member.email}`}
					>
						<UserX aria-hidden /> Remove access
					</Button>
				)
			)}
		</li>
	);
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("viewer");
	const [error, setError] = useState<string | null>(null);
	const invite = useTeamMutation((api, body: { email: string; role: Role }) =>
		api("/admin/invitations", { method: "POST", body: JSON.stringify(body) }),
	);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const parsed = inviteCreate.safeParse({ email: email.trim(), role });
		if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the email");
		setError(null);
		invite.mutate(parsed.data, {
			onSuccess: () => {
				setEmail("");
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
