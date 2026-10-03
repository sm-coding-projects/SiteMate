import { Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAddNote, useDeleteNote, useNotes, useUpdateNote } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { formatWhen, nbHyphen } from "@/lib/format";
import type { Note } from "../../../shared/api-types";
import { useProjectContext } from "./layout";

export function NotesTab() {
	const { project, isAdmin } = useProjectContext();
	const notes = useNotes(project.id);
	const items = notes.data?.pages.flatMap((p) => p.items) ?? [];
	return (
		<div className="grid max-w-3xl gap-8">
			{isAdmin && <NoteComposer />}
			<section aria-labelledby="notes-h">
				<h2 id="notes-h" className="label-mono mb-3 text-muted-foreground">
					Notes
				</h2>
				{notes.isPending ? (
					<div role="status" aria-busy="true" className="space-y-3">
						<span className="sr-only">Loading notes</span>
						<Skeleton className="h-24" />
						<Skeleton className="h-24" />
					</div>
				) : notes.isError && items.length === 0 ? (
					<QueryError error={notes.error} onRetry={() => notes.refetch()} />
				) : items.length === 0 ? (
					<p className="text-muted-foreground">
						No notes yet. Use them for deliveries, site instructions and anything the office should know.
					</p>
				) : (
					<>
						<ul className="space-y-3">
							{items.map((n) => (
								<NoteCard key={n.id} note={n} />
							))}
						</ul>
						<LoadMore {...notes} />
					</>
				)}
			</section>
		</div>
	);
}

function NoteComposer() {
	const { project } = useProjectContext();
	const [body, setBody] = useState("");
	const [stageId, setStageId] = useState("");
	const add = useAddNote(project.id);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!body.trim()) return;
		add.mutate({ body: body.trim(), stageId: stageId || null }, { onSuccess: () => setBody("") });
	};
	return (
		<form onSubmit={submit} className="grid gap-3 rounded-md border bg-card p-4 md:p-5">
			<Field id="note-body" label="New note" error={add.isError ? errorMessage(add.error) : null}>
				<Textarea
					id="note-body"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder="What happened on site?"
					maxLength={5000}
				/>
			</Field>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
				<Field id="note-stage" label="Stage (optional)" className="sm:flex-1">
					<NativeSelect id="note-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
						<option value="">Whole project</option>
						{project.stages.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Button type="submit" disabled={add.isPending || !body.trim()}>
					{add.isPending ? "Posting…" : "Post note"}
				</Button>
			</div>
		</form>
	);
}

function NoteCard({ note }: { note: Note }) {
	const { project, isAdmin } = useProjectContext();
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [body, setBody] = useState(note.body);
	const update = useUpdateNote(project.id);
	const remove = useDeleteNote(project.id);
	return (
		<li className="rounded-md border bg-card p-4 md:p-5">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<p className="text-sm">
					{note.stage && (
						<span className="label-mono mr-2 inline-block rounded-[3px] bg-survey/10 px-1.5 py-px text-survey">
							{nbHyphen(note.stage.name)}
						</span>
					)}
					<span className="font-medium">{note.author.name ?? note.author.email}</span>
				</p>
				<span className="label-mono text-muted-foreground">
					{formatWhen(note.createdAt)}
					{note.updatedAt > note.createdAt + 1000 && " · edited"}
				</span>
			</div>
			{editing ? (
				<form
					className="mt-3 grid gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate({ id: note.id, body: body.trim() }, { onSuccess: () => setEditing(false) });
					}}
				>
					<Textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						aria-label="Edit note"
						maxLength={5000}
					/>
					<div className="flex justify-end gap-2">
						<Button type="button" variant="ghost" onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="outline" disabled={update.isPending || !body.trim()}>
							Save
						</Button>
					</div>
				</form>
			) : (
				<p className="mt-2 max-w-[60ch] whitespace-pre-wrap break-words">{note.body}</p>
			)}
			{isAdmin && !editing && (
				<div className="mt-2 -mb-2 flex gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setBody(note.body);
							setEditing(true);
						}}
					>
						<Pencil aria-hidden /> Edit
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
						<Trash2 aria-hidden /> Delete
					</Button>
				</div>
			)}
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title="Delete this note?"
				description="It disappears from the project. The activity log keeps a record that it was deleted."
				confirmLabel="Delete note"
				destructive
				pending={remove.isPending}
				onConfirm={() => remove.mutate(note.id, { onSuccess: () => setDeleting(false) })}
			/>
		</li>
	);
}
