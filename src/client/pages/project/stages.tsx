import {
	ArrowDown,
	ArrowUp,
	Check,
	CircleCheck,
	EllipsisVertical,
	GripVertical,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { RailNode, type RailState } from "@/components/brand/stage-rail";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RenameDialog } from "@/components/rename-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	useAddItem,
	useAddNote,
	useAddStage,
	useDeleteItem,
	useDeleteStage,
	useReorder,
	useUpdateItem,
	useUpdateStage,
} from "@/hooks/use-data";
import { moveId, useDragReorder } from "@/hooks/use-drag-reorder";
import { useMe } from "@/hooks/use-me";
import { useFinePointer, useWide } from "@/hooks/use-media";
import { errorMessage } from "@/lib/api";
import { formatDate, nbHyphen, stageCode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectItem, ProjectStage } from "../../../shared/api-types";
import { currentStageNumber } from "../../../shared/progress";
import { useProjectContext } from "./layout";

const STATUS_TEXT = { not_started: "Not started", in_progress: "In progress", complete: "Complete" } as const;

export function StagesTab() {
	const { project, isAdmin } = useProjectContext();
	const stages = project.stages;
	const current = currentStageNumber(stages);
	const [params, setParams] = useSearchParams();
	// Open on the current stage, then stay put: completing it shouldn't yank the checklist away mid-task.
	const [initialId] = useState(() => stages[Math.min(current, stages.length) - 1]?.id);
	const selectedId =
		stages.find((s) => s.id === params.get("stage"))?.id ??
		stages.find((s) => s.id === initialId)?.id ??
		stages[Math.min(current, stages.length) - 1]?.id;
	const select = (id: string) =>
		setParams(
			(p) => {
				p.set("stage", id);
				return p;
			},
			{ replace: true },
		);
	const desktop = useWide();
	const fine = useFinePointer();
	const reorder = useReorder(project.id);
	const ids = stages.map((s) => s.id);
	const drag = useDragReorder(ids, (next) => reorder.mutate({ scope: "stages", ids: next }), isAdmin && fine);
	const selected = stages.find((s) => s.id === selectedId);

	if (stages.length === 0) {
		return (
			<div className="max-w-xl">
				<p className="text-muted-foreground">This project has no stages yet.</p>
				{isAdmin && <AddStageForm projectId={project.id} className="mt-4" />}
			</div>
		);
	}

	const stateOf = (i: number): RailState =>
		i + 1 < current ? "done" : i + 1 === current ? "current" : "todo";
	const panel = selected && (
		<StagePanel key={selected.id} stage={selected} index={stages.indexOf(selected)} />
	);

	return (
		<div className="grid grid-cols-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
			<div>
				<h2 className="label-mono mb-4 text-muted-foreground">
					Stages · {stages.filter((s) => s.status === "complete").length}/{stages.length} complete
				</h2>
				<ol>
					{stages.map((s, i) => {
						// Rail shows the true status: a later stage can be done or underway out of order.
						const state: RailState =
							s.status === "complete" ? "done" : stateOf(i) === "current" ? "current" : "todo";
						const nextDone = stages[i + 1]?.status === "complete";
						const isSelected = s.id === selectedId;
						const done = s.items.filter((it) => it.completedAt).length;
						return (
							<li
								key={s.id}
								{...drag.rowProps(s.id)}
								className={cn(
									"relative",
									drag.over === s.id &&
										"before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-foreground",
									drag.dragging === s.id && "opacity-50",
								)}
								aria-current={state === "current" ? "step" : undefined}
							>
								{i < stages.length - 1 && (
									<span
										aria-hidden
										className={cn(
											"absolute top-[1.375rem] bottom-0 left-[1.0625rem] border-l",
											state === "done" && nextDone
												? "border-solid border-foreground"
												: "border-dashed border-input",
										)}
									/>
								)}
								<button
									type="button"
									onClick={() => select(s.id)}
									aria-pressed={isSelected}
									className={cn(
										"flex w-full gap-3 rounded-md px-3 py-3 text-left transition-colors duration-[120ms] ease-enter hover:bg-accent",
										isSelected && "bg-accent",
									)}
								>
									<span className="pt-1">
										<RailNode state={state} />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline justify-between gap-2">
											<span
												className={cn("text-sm", state === "todo" ? "text-muted-foreground" : "font-medium")}
											>
												{nbHyphen(s.name)}
											</span>
											<span className="label-mono shrink-0 text-muted-foreground">
												{done}/{s.items.length}
											</span>
										</span>
										<span className="label-mono mt-0.5 block text-muted-foreground">
											{stageCode(i + 1, stages.length)} · {STATUS_TEXT[s.status]}
										</span>
										{(s.startedAt || s.completedAt) && (
											<span className="mt-0.5 block text-xs text-muted-foreground">
												{s.startedAt && `Started ${formatDate(s.startedAt)}`}
												{s.completedAt && ` · Done ${formatDate(s.completedAt)}`}
											</span>
										)}
									</span>
									{isAdmin && fine && (
										<GripVertical
											className="mt-1 size-4 shrink-0 cursor-grab text-muted-foreground"
											aria-hidden
										/>
									)}
								</button>
								{/* Phones: the checklist opens in place under its stage. */}
								{!desktop && isSelected && <div className="pt-2 pb-6 pl-3">{panel}</div>}
							</li>
						);
					})}
				</ol>
				{isAdmin && <AddStageForm projectId={project.id} className="mt-4" />}
			</div>
			{desktop && <div className="min-w-0">{panel}</div>}
		</div>
	);
}

function AddStageForm({ projectId, className }: { projectId: string; className?: string }) {
	const [name, setName] = useState("");
	const [open, setOpen] = useState(false);
	const add = useAddStage(projectId);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;
		add.mutate(
			{ name: name.trim() },
			{
				onSuccess: () => {
					setName("");
					setOpen(false);
				},
			},
		);
	};
	if (!open)
		return (
			<Button variant="outline" className={cn("w-full", className)} onClick={() => setOpen(true)}>
				<Plus aria-hidden /> Add stage
			</Button>
		);
	return (
		<form onSubmit={submit} className={cn("space-y-2", className)}>
			<Input
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="Stage name, e.g. Landscaping"
				aria-label="New stage name"
				maxLength={80}
				autoFocus
			/>
			<div className="flex gap-2">
				<Button type="submit" variant="outline" className="flex-1" disabled={add.isPending || !name.trim()}>
					{add.isPending ? "Adding…" : "Add stage"}
				</Button>
				<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
			{add.isError && <p className="text-sm text-destructive">{errorMessage(add.error)}</p>}
		</form>
	);
}

function StagePanel({ stage, index }: { stage: ProjectStage; index: number }) {
	const { project, isAdmin } = useProjectContext();
	const total = project.stages.length;
	const done = stage.items.filter((i) => i.completedAt).length;
	const update = useUpdateStage(project.id);
	const [confirmComplete, setConfirmComplete] = useState(false);
	const remaining = stage.items.length - done;

	const setStatus = (status: ProjectStage["status"]) => update.mutate({ id: stage.id, status });

	return (
		<section aria-labelledby={`stage-${stage.id}-h`} className="animate-page-in">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="label-mono text-muted-foreground">
						Stage {stageCode(index + 1, total)}
						{stage.source === "custom" && " · Custom"}
					</p>
					<h2 id={`stage-${stage.id}-h`} className="mt-1 text-xl font-semibold">
						{nbHyphen(stage.name)}
					</h2>
					{stage.description && (
						<p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{stage.description}</p>
					)}
					<p className="mt-2 text-sm text-muted-foreground">
						{STATUS_TEXT[stage.status]}
						{stage.startedAt && ` · started ${formatDate(stage.startedAt)}`}
						{stage.completedAt && ` · completed ${formatDate(stage.completedAt)}`}
					</p>
				</div>
				{isAdmin && (
					<div className="flex items-center gap-2">
						{stage.status === "not_started" && (
							<Button variant="outline" onClick={() => setStatus("in_progress")} disabled={update.isPending}>
								<Play aria-hidden /> Start stage
							</Button>
						)}
						{stage.status === "in_progress" && (
							<Button
								variant="outline"
								onClick={() => (remaining > 0 ? setConfirmComplete(true) : setStatus("complete"))}
								disabled={update.isPending}
							>
								<CircleCheck aria-hidden /> Mark complete
							</Button>
						)}
						{stage.status === "complete" && (
							<Button variant="outline" onClick={() => setStatus("in_progress")} disabled={update.isPending}>
								<RotateCcw aria-hidden /> Reopen
							</Button>
						)}
						<StageMenu stage={stage} index={index} />
					</div>
				)}
			</div>
			{update.isError && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{errorMessage(update.error)}
				</p>
			)}

			<Checklist stage={stage} />
			{isAdmin && <StageNoteForm stage={stage} />}

			<ConfirmDialog
				open={confirmComplete}
				onOpenChange={setConfirmComplete}
				title={`Complete ${stage.name}?`}
				description={`${remaining} of ${stage.items.length} checks are still open. The stage will be marked complete anyway and the team is notified.`}
				confirmLabel="Mark complete"
				pending={update.isPending}
				onConfirm={() =>
					update.mutate({ id: stage.id, status: "complete" }, { onSuccess: () => setConfirmComplete(false) })
				}
			/>
		</section>
	);
}

function StageMenu({ stage, index }: { stage: ProjectStage; index: number }) {
	const { project } = useProjectContext();
	const [renaming, setRenaming] = useState(false);
	const [removing, setRemoving] = useState(false);
	const update = useUpdateStage(project.id);
	const remove = useDeleteStage(project.id);
	const reorder = useReorder(project.id);
	const ids = project.stages.map((s) => s.id);
	const move = (delta: -1 | 1) => {
		const next = moveId(ids, stage.id, delta);
		if (next) reorder.mutate({ scope: "stages", ids: next });
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="icon" aria-label={`Actions for ${stage.name}`}>
						<EllipsisVertical aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuItem className="min-h-11" onSelect={() => setRenaming(true)}>
						<Pencil aria-hidden /> Rename
					</DropdownMenuItem>
					<DropdownMenuItem className="min-h-11" disabled={index === 0} onSelect={() => move(-1)}>
						<ArrowUp aria-hidden /> Move up
					</DropdownMenuItem>
					<DropdownMenuItem className="min-h-11" disabled={index === ids.length - 1} onSelect={() => move(1)}>
						<ArrowDown aria-hidden /> Move down
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => setRemoving(true)}>
						<Trash2 aria-hidden /> Remove stage
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameDialog
				open={renaming}
				onOpenChange={setRenaming}
				title="Rename stage"
				initial={stage.name}
				maxLength={80}
				pending={update.isPending}
				onSave={(name) => update.mutate({ id: stage.id, name }, { onSuccess: () => setRenaming(false) })}
			/>
			<ConfirmDialog
				open={removing}
				onOpenChange={setRemoving}
				title={`Remove ${stage.name}?`}
				description={`Its ${stage.items.length} checklist items are removed too. Notes and files stay on the project, unassigned.`}
				confirmLabel="Remove stage"
				destructive
				pending={remove.isPending}
				onConfirm={() => remove.mutate(stage.id, { onSuccess: () => setRemoving(false) })}
			/>
		</>
	);
}

function Checklist({ stage }: { stage: ProjectStage }) {
	const { project, isAdmin } = useProjectContext();
	const { data: me } = useMe();
	const updateItem = useUpdateItem(project.id, me ? { id: me.id, name: me.name } : undefined);
	const reorder = useReorder(project.id);
	const fine = useFinePointer();
	const ids = stage.items.map((i) => i.id);
	const drag = useDragReorder(
		ids,
		(next) => reorder.mutate({ scope: { stageId: stage.id }, ids: next }),
		isAdmin && fine,
	);
	const done = stage.items.filter((i) => i.completedAt).length;

	return (
		<div className="mt-6">
			<div className="mb-2 flex items-baseline justify-between">
				<h3 className="label-mono text-muted-foreground">Checklist</h3>
				<span className="label-mono text-muted-foreground">
					{done}/{stage.items.length}
				</span>
			</div>
			{stage.items.length === 0 ? (
				<p className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">
					No checks in this stage{isAdmin ? " yet. Add the first one below." : "."}
				</p>
			) : (
				<ul className="divide-y rounded-md border bg-card">
					{stage.items.map((item, i) => (
						<li
							key={item.id}
							{...drag.rowProps(item.id)}
							className={cn(
								"flex items-center gap-1 pr-1",
								drag.over === item.id && "shadow-[inset_0_2px_0_var(--foreground)]",
								drag.dragging === item.id && "opacity-50",
							)}
						>
							<ChecklistRow
								item={item}
								editable={isAdmin}
								onToggle={(completed) => updateItem.mutate({ id: item.id, completed })}
							/>
							{isAdmin && fine && (
								<GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
							)}
							{isAdmin && <ItemMenu item={item} stage={stage} index={i} />}
						</li>
					))}
				</ul>
			)}
			{updateItem.isError && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{errorMessage(updateItem.error)}
				</p>
			)}
			{isAdmin && <AddItemForm stageId={stage.id} />}
		</div>
	);
}

/** 44px+ row. Admins get a real checkbox; viewers see the same state read-only. */
function ChecklistRow({
	item,
	editable,
	onToggle,
}: {
	item: ProjectItem;
	editable: boolean;
	onToggle: (completed: boolean) => void;
}) {
	const checked = item.completedAt !== null;
	const box = (
		<span
			aria-hidden
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-[4px] border-[1.5px] transition-colors duration-[120ms] ease-enter",
				checked ? "border-foreground bg-foreground text-background" : "border-input bg-card",
			)}
		>
			{checked && <Check className="size-4" strokeWidth={2.5} />}
		</span>
	);
	const text = (
		<span className="min-w-0 flex-1">
			<span className={cn("block", checked && "text-muted-foreground line-through decoration-1")}>
				{item.title}
			</span>
			{checked && (
				<span className="block text-xs text-muted-foreground">
					Ticked{item.completedBy?.name ? ` by ${item.completedBy.name}` : ""} ·{" "}
					{formatDate(item.completedAt)}
				</span>
			)}
			{item.source === "custom" && <span className="label-mono text-[0.6875rem] text-survey">Custom</span>}
		</span>
	);
	if (!editable) {
		return (
			<div className="flex min-h-12 flex-1 items-center gap-3 px-4 py-2">
				{box}
				{text}
				<span className="sr-only">{checked ? "done" : "not done"}</span>
			</div>
		);
	}
	return (
		<label className="flex min-h-12 flex-1 cursor-pointer items-center gap-3 px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
			<input
				type="checkbox"
				className="sr-only"
				checked={checked}
				onChange={(e) => onToggle(e.target.checked)}
			/>
			{box}
			{text}
		</label>
	);
}

function ItemMenu({ item, stage, index }: { item: ProjectItem; stage: ProjectStage; index: number }) {
	const { project } = useProjectContext();
	const { data: me } = useMe();
	const [renaming, setRenaming] = useState(false);
	const update = useUpdateItem(project.id, me);
	const remove = useDeleteItem(project.id);
	const reorder = useReorder(project.id);
	const ids = stage.items.map((i) => i.id);
	const move = (delta: -1 | 1) => {
		const next = moveId(ids, item.id, delta);
		if (next) reorder.mutate({ scope: { stageId: stage.id }, ids: next });
	};
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label={`Actions for ${item.title}`}>
						<EllipsisVertical aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem className="min-h-11" onSelect={() => setRenaming(true)}>
						<Pencil aria-hidden /> Rename
					</DropdownMenuItem>
					<DropdownMenuItem className="min-h-11" disabled={index === 0} onSelect={() => move(-1)}>
						<ArrowUp aria-hidden /> Move up
					</DropdownMenuItem>
					<DropdownMenuItem className="min-h-11" disabled={index === ids.length - 1} onSelect={() => move(1)}>
						<ArrowDown aria-hidden /> Move down
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => remove.mutate(item.id)}>
						<Trash2 aria-hidden /> Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameDialog
				open={renaming}
				onOpenChange={setRenaming}
				title="Rename check"
				initial={item.title}
				maxLength={160}
				pending={update.isPending}
				onSave={(title) => update.mutate({ id: item.id, title }, { onSuccess: () => setRenaming(false) })}
			/>
		</>
	);
}

function AddItemForm({ stageId }: { stageId: string }) {
	const { project } = useProjectContext();
	const [title, setTitle] = useState("");
	const add = useAddItem(project.id);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;
		add.mutate({ stageId, title: title.trim() }, { onSuccess: () => setTitle("") });
	};
	return (
		<form onSubmit={submit} className="mt-3 flex gap-2">
			<Input
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Add a check"
				aria-label="New checklist item"
				maxLength={160}
			/>
			<Button type="submit" variant="outline" disabled={add.isPending || !title.trim()}>
				<Plus aria-hidden /> Add
			</Button>
		</form>
	);
}

function StageNoteForm({ stage }: { stage: ProjectStage }) {
	const { project } = useProjectContext();
	const [body, setBody] = useState("");
	const [saved, setSaved] = useState(false);
	const add = useAddNote(project.id);
	useEffect(() => {
		if (!saved) return;
		const t = setTimeout(() => setSaved(false), 3000);
		return () => clearTimeout(t);
	}, [saved]);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!body.trim()) return;
		add.mutate(
			{ body: body.trim(), stageId: stage.id },
			{
				onSuccess: () => {
					setBody("");
					setSaved(true);
				},
			},
		);
	};
	return (
		<form onSubmit={submit} className="mt-8">
			<label htmlFor={`note-${stage.id}`} className="label-mono text-muted-foreground">
				Note on this stage
			</label>
			<div className="mt-2 flex gap-2">
				<Input
					id={`note-${stage.id}`}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder="e.g. Roof sheets delivered, install Thu"
					maxLength={5000}
				/>
				<Button type="submit" variant="outline" disabled={add.isPending || !body.trim()}>
					Post
				</Button>
			</div>
			<p className="mt-1 min-h-5 text-sm text-muted-foreground" aria-live="polite">
				{add.isError ? (
					<span className="text-destructive">{errorMessage(add.error)}</span>
				) : saved ? (
					"Saved to Notes."
				) : (
					""
				)}
			</p>
		</form>
	);
}
