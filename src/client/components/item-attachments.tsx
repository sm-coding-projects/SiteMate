import { ArrowRightLeft, Check, EllipsisVertical, FileText, ImageIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FileViewer } from "@/components/file-viewer";
import { QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
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
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDetachItemFile, useFiles, useMoveItemFile, useSetItemFiles } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { formatDate, nbHyphen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileEntry, ItemAttachment, ProjectItem, ProjectStage } from "../../shared/api-types";

/** What admins need to move a file to another check or take it off this one. */
interface ManageFiles {
	projectId: string;
	item: ProjectItem;
	stages: ProjectStage[];
}

/**
 * The files backing a check: photo thumbnails, then document names. Everyone can open them; they open in
 * the file viewer, which steps through all of this check's attachments.
 */
export function ItemAttachments({
	attachments,
	manage,
	className,
}: {
	attachments: ItemAttachment[];
	/** Admins: each file gets a menu to move it to another check or remove it from this one. */
	manage?: ManageFiles;
	className?: string;
}) {
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const [moving, setMoving] = useState<ItemAttachment | null>(null);
	const detach = useDetachItemFile(manage?.projectId ?? "");
	const actions = (a: ItemAttachment) =>
		manage && (
			<FileMenu
				filename={a.filename}
				onMove={() => setMoving(a)}
				onRemove={() => detach.mutate({ id: manage.item.id, fileId: a.fileId })}
			/>
		);
	if (attachments.length === 0) return null;
	const photos = attachments.filter((a) => a.category === "photo");
	const docs = attachments.filter((a) => a.category !== "photo");
	// Viewer order matches what's on screen: photos, then documents.
	const ordered = [...photos, ...docs];
	const viewerFiles = ordered.map((a) => ({ id: a.fileId, filename: a.filename, mimeType: a.mimeType }));
	return (
		<div className={className}>
			<ul aria-label="Attached files" className="flex flex-wrap items-center gap-1.5">
				{photos.map((a, i) => (
					<li key={a.fileId} className="flex items-center">
						<button
							type="button"
							onClick={() => setOpenIndex(i)}
							aria-label={`Open photo ${a.filename}`}
							className="block size-11 overflow-hidden rounded-[3px] border bg-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
						>
							{a.thumbUrl ? (
								<img src={a.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
							) : (
								<ImageIcon className="m-auto size-5 text-muted-foreground" aria-hidden />
							)}
						</button>
						{actions(a)}
					</li>
				))}
				{docs.map((a, i) => (
					<li
						key={a.fileId}
						className="inline-flex min-w-0 max-w-full items-center rounded-md border bg-card"
					>
						<button
							type="button"
							onClick={() => setOpenIndex(photos.length + i)}
							className={cn(
								"inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring pointer-fine:min-h-8",
								manage && "pr-1",
							)}
						>
							<FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
							<span className="truncate">{a.filename}</span>
						</button>
						{actions(a)}
					</li>
				))}
			</ul>
			{detach.isError && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{errorMessage(detach.error)}
				</p>
			)}
			{manage && (
				<MoveFileDialog
					file={moving}
					onClose={() => setMoving(null)}
					projectId={manage.projectId}
					from={manage.item}
					stages={manage.stages}
				/>
			)}
			{openIndex !== null && viewerFiles[openIndex] && (
				<FileViewer
					files={viewerFiles}
					index={openIndex}
					onIndex={setOpenIndex}
					onClose={() => setOpenIndex(null)}
				/>
			)}
		</div>
	);
}

function FileMenu({
	filename,
	onMove,
	onRemove,
}: {
	filename: string;
	onMove: () => void;
	onRemove: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-11 pointer-fine:size-8"
					aria-label={`Actions for ${filename}`}
				>
					<EllipsisVertical aria-hidden />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuItem className="min-h-11" onSelect={onMove}>
					<ArrowRightLeft aria-hidden /> Move to another check…
				</DropdownMenuItem>
				<DropdownMenuItem className="min-h-11" onSelect={onRemove}>
					<X aria-hidden /> Remove from this check
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Picks the check (in any stage of the project) to move a file to. */
function MoveFileDialog({
	file,
	onClose,
	projectId,
	from,
	stages,
}: {
	file: ItemAttachment | null;
	onClose: () => void;
	projectId: string;
	from: ProjectItem;
	stages: ProjectStage[];
}) {
	const [to, setTo] = useState("");
	const move = useMoveItemFile(projectId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset each time a file is picked
	useEffect(() => {
		setTo("");
		move.reset();
	}, [file]);
	return (
		<Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Move to another check</DialogTitle>
					<DialogDescription>
						{file?.filename} moves off “{from.title}”. It stays in the project’s files either way.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<Field id="move-to" label="Check" error={move.isError ? errorMessage(move.error) : null}>
						<NativeSelect id="move-to" value={to} onChange={(e) => setTo(e.target.value)}>
							<option value="" disabled>
								Choose a check
							</option>
							{stages.map((s) => (
								<optgroup key={s.id} label={s.name}>
									{s.items
										.filter((i) => i.id !== from.id)
										.map((i) => (
											<option key={i.id} value={i.id}>
												{i.title}
											</option>
										))}
								</optgroup>
							))}
						</NativeSelect>
					</Field>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!to || !file || move.isPending}
						onClick={() =>
							file && move.mutate({ id: from.id, fileId: file.fileId, itemId: to }, { onSuccess: onClose })
						}
					>
						{move.isPending ? "Moving…" : "Move"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type Kind = "photos" | "documents";

/** Picks which of the project's uploaded photos and documents back a check. */
export function AttachFilesDialog({
	open,
	onOpenChange,
	projectId,
	stage,
	item,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	stage: { id: string; name: string };
	item: ProjectItem;
}) {
	const [kind, setKind] = useState<Kind>("photos");
	const [thisStage, setThisStage] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const save = useSetItemFiles(projectId);

	// Start from what's attached each time the dialog opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
	useEffect(() => {
		if (!open) return;
		setSelected(new Set(item.attachments.map((a) => a.fileId)));
		setKind(
			item.attachments.some((a) => a.category === "photo") || item.attachments.length === 0
				? "photos"
				: "documents",
		);
		save.reset();
	}, [open]);

	const toggle = (fileId: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(fileId)) next.delete(fileId);
			else next.add(fileId);
			return next;
		});

	const before = new Set(item.attachments.map((a) => a.fileId));
	const changed = selected.size !== before.size || [...selected].some((id) => !before.has(id));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent wide>
				<DialogHeader>
					<DialogTitle>Attach to “{item.title}”</DialogTitle>
					<DialogDescription>
						Choose photos and documents already uploaded to this project. Upload new ones on the Photos or
						Documents tab first.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div
							role="tablist"
							aria-label="File type"
							className="inline-flex rounded-md border bg-muted p-0.5"
						>
							{(["photos", "documents"] as const).map((k) => (
								<button
									key={k}
									type="button"
									role="tab"
									aria-selected={kind === k}
									onClick={() => setKind(k)}
									className={cn(
										"inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-3 text-sm font-medium capitalize transition-colors duration-[120ms] ease-enter pointer-fine:h-8",
										kind === k
											? "bg-card text-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{k}
								</button>
							))}
						</div>
						<label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
							<input
								type="checkbox"
								className="size-4 accent-foreground"
								checked={thisStage}
								onChange={(e) => setThisStage(e.target.checked)}
							/>
							Only {nbHyphen(stage.name)}
						</label>
					</div>
					<FilePicker
						projectId={projectId}
						kind={kind}
						stageId={thisStage ? stage.id : undefined}
						selected={selected}
						onToggle={toggle}
						onClose={() => onOpenChange(false)}
					/>
				</DialogBody>
				<DialogFooter className="items-center sm:justify-between">
					<p className="text-sm text-muted-foreground" aria-live="polite">
						{save.isError ? (
							<span className="text-destructive">{errorMessage(save.error)}</span>
						) : (
							`${selected.size} file${selected.size === 1 ? "" : "s"} attached`
						)}
					</p>
					<div className="flex gap-2">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							disabled={!changed || save.isPending}
							onClick={() =>
								save.mutate({ id: item.id, fileIds: [...selected] }, { onSuccess: () => onOpenChange(false) })
							}
						>
							{save.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FilePicker({
	projectId,
	kind,
	stageId,
	selected,
	onToggle,
	onClose,
}: {
	projectId: string;
	kind: Kind;
	stageId?: string;
	selected: Set<string>;
	onToggle: (fileId: string) => void;
	onClose: () => void;
}) {
	const files = useFiles(projectId, kind, stageId ? { stageId } : {});
	if (files.isPending) {
		return (
			<div aria-busy="true" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className={kind === "photos" ? "aspect-square" : "col-span-full h-14"} />
				))}
			</div>
		);
	}
	if (files.isError) return <QueryError error={files.error} onRetry={() => files.refetch()} />;
	const list = files.data.pages.flatMap((p) => p.items);
	if (list.length === 0) {
		return (
			<p className="rounded-md border bg-card px-4 py-6 text-sm text-muted-foreground">
				No {kind} {stageId ? "tagged to this stage" : "uploaded to this project"} yet.{" "}
				<Link
					to={`/projects/${projectId}/${kind}`}
					onClick={onClose}
					className="font-medium text-link underline-offset-4 hover:underline"
				>
					Go to {kind === "photos" ? "Photos" : "Documents"}
				</Link>
			</p>
		);
	}
	return (
		<>
			{kind === "photos" ? (
				<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
					{list.map((f) => (
						<li key={f.id}>
							<PhotoOption file={f} checked={selected.has(f.id)} onToggle={() => onToggle(f.id)} />
						</li>
					))}
				</ul>
			) : (
				<ul className="divide-y rounded-md border bg-card">
					{list.map((f) => (
						<li key={f.id}>
							<DocumentOption file={f} checked={selected.has(f.id)} onToggle={() => onToggle(f.id)} />
						</li>
					))}
				</ul>
			)}
			{files.hasNextPage && (
				<div className="flex justify-center">
					<Button variant="outline" onClick={() => files.fetchNextPage()} disabled={files.isFetchingNextPage}>
						{files.isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}
		</>
	);
}

function Tick({ checked }: { checked: boolean }) {
	return (
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
}

function PhotoOption({
	file,
	checked,
	onToggle,
}: {
	file: FileEntry;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<label
			className={cn(
				"relative block aspect-square cursor-pointer overflow-hidden rounded-[3px] border bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
				checked && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
			)}
		>
			<input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
			{file.thumbUrl ? (
				<img src={file.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
			) : (
				<ImageIcon className="absolute inset-0 m-auto size-6 text-muted-foreground" aria-hidden />
			)}
			<span className="absolute top-1.5 left-1.5">
				<Tick checked={checked} />
			</span>
			<span className="sr-only">
				{file.caption ?? file.filename}
				{file.stage ? `, ${file.stage.name}` : ""}
			</span>
		</label>
	);
}

function DocumentOption({
	file,
	checked,
	onToggle,
}: {
	file: FileEntry;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
			<input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
			<Tick checked={checked} />
			<FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium">{file.filename}</span>
				<span className="block text-sm text-muted-foreground">
					{file.stage && `${nbHyphen(file.stage.name)} · `}
					{formatDate(file.uploadedAt)}
				</span>
			</span>
		</label>
	);
}
