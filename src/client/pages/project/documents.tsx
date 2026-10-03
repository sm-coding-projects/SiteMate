import { Download, EllipsisVertical, ExternalLink, FilePlus2, FileText, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
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
import { CATEGORY_LABEL, UploadDialog } from "@/components/upload-dialog";
import { useDeleteFile, useFiles, useFileUrl, useUpdateFile } from "@/hooks/use-data";
import { useUploads } from "@/hooks/use-uploads";
import { errorMessage } from "@/lib/api";
import { formatBytes, formatDate, nbHyphen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExtractionStatus, FileEntry } from "../../../shared/api-types";
import { DOCUMENT_CATEGORIES } from "../../../shared/schemas";
import { useProjectContext } from "./layout";

const EXTRACTION_LABEL: Record<ExtractionStatus, string> = {
	queued: "Queued for reading",
	processing: "Reading…",
	needs_review: "Ready for review",
	confirmed: "Confirmed",
	failed: "Couldn't read",
};

export function DocumentsTab() {
	const { project, isAdmin } = useProjectContext();
	const [category, setCategory] = useState("");
	const files = useFiles(project.id, "documents", { category: category || undefined });
	const uploads = useUploads(project.id).filter((u) => u.category !== "photo");
	const [picked, setPicked] = useState<File[]>([]);
	const inputRef = useRef<HTMLInputElement>(null);
	const docs = files.data?.pages.flatMap((p) => p.items) ?? [];

	return (
		<div>
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<Field id="doc-category" label="Category" className="sm:w-64">
					<NativeSelect id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
						<option value="">All documents</option>
						{DOCUMENT_CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{CATEGORY_LABEL[c]}
							</option>
						))}
					</NativeSelect>
				</Field>
				{isAdmin && (
					<>
						<Button onClick={() => inputRef.current?.click()}>
							<FilePlus2 aria-hidden /> Upload document
						</Button>
						<input
							ref={inputRef}
							type="file"
							multiple
							hidden
							accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,image/*"
							onChange={(e) => {
								setPicked(Array.from(e.target.files ?? []));
								e.target.value = "";
							}}
						/>
					</>
				)}
			</div>

			{uploads.length > 0 && (
				<ul className="mb-4 space-y-2" aria-label="Uploading">
					{uploads.map((u) => (
						<li key={u.id} className="rounded-md border bg-card px-4 py-3">
							<p className="truncate text-sm font-medium">{u.filename}</p>
							<div className="mt-2 h-1 bg-border">
								<div className="h-full bg-foreground" style={{ width: `${u.progress * 100}%` }} />
							</div>
						</li>
					))}
				</ul>
			)}

			{files.isPending ? (
				<div role="status" aria-busy="true" className="space-y-2">
					<span className="sr-only">Loading documents</span>
					<Skeleton className="h-20" />
					<Skeleton className="h-20" />
				</div>
			) : files.isError && docs.length === 0 ? (
				<QueryError error={files.error} onRetry={() => files.refetch()} />
			) : docs.length === 0 ? (
				<p className="text-muted-foreground">
					No {category ? CATEGORY_LABEL[category]?.toLowerCase() : "document"}s yet.
					{isAdmin && " Upload a supplier quote as a PDF and BFH App reads the totals for you to check."}
				</p>
			) : (
				<>
					<ul className="divide-y rounded-md border bg-card">
						{docs.map((d) => (
							<DocumentRow key={d.id} doc={d} />
						))}
					</ul>
					<LoadMore {...files} />
				</>
			)}
			<UploadDialog project={project} kind="documents" files={picked} onDone={() => setPicked([])} />
		</div>
	);
}

function DocumentRow({ doc }: { doc: FileEntry }) {
	const { isAdmin } = useProjectContext();
	const getUrl = useFileUrl();
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const { project } = useProjectContext();
	const remove = useDeleteFile(project.id);

	const open = async (download: boolean) => {
		setError(null);
		// Open the tab synchronously (popup blockers), then point it at the signed URL.
		const w = download ? null : window.open("about:blank", "_blank");
		try {
			const { url } = await getUrl(doc.id, download);
			if (w) w.location.href = url;
			else window.location.href = url;
		} catch (e) {
			w?.close();
			setError(errorMessage(e));
		}
	};

	return (
		<li className="flex items-start gap-3 px-4 py-3 md:px-5">
			{doc.thumbUrl ? (
				<img
					src={doc.thumbUrl}
					alt=""
					loading="lazy"
					className="size-11 shrink-0 rounded-[3px] border object-cover"
				/>
			) : (
				<FileText className="mt-1 size-6 shrink-0 text-muted-foreground" aria-hidden />
			)}
			<div className="min-w-0 flex-1">
				<button
					type="button"
					onClick={() => open(false)}
					className="max-w-full truncate text-left font-medium underline-offset-4 hover:underline"
				>
					{doc.filename}
				</button>
				<p className="mt-0.5 text-sm text-muted-foreground">
					<span className="label-mono mr-2 inline-block rounded-[3px] bg-survey/10 px-1.5 py-px text-survey">
						{CATEGORY_LABEL[doc.category]}
					</span>
					{doc.stage && `${nbHyphen(doc.stage.name)} · `}
					{formatBytes(doc.sizeBytes)} · {doc.uploadedBy.name} · {formatDate(doc.uploadedAt)}
				</p>
				{doc.caption && <p className="mt-1 text-sm">{doc.caption}</p>}
				{doc.extraction && (
					<Link
						to={`/review/${doc.extraction.id}`}
						className={cn(
							"mt-1 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline",
							doc.extraction.status === "needs_review" ? "text-link" : "text-muted-foreground",
							doc.extraction.status === "failed" && "text-destructive",
						)}
					>
						{EXTRACTION_LABEL[doc.extraction.status]}
						{doc.extraction.detectedType &&
							doc.extraction.status !== "failed" &&
							` · ${doc.extraction.detectedType}`}
					</Link>
				)}
				{error && <p className="text-sm text-destructive">{error}</p>}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label={`Actions for ${doc.filename}`}>
						<EllipsisVertical aria-hidden />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem className="min-h-11" onSelect={() => open(false)}>
						<ExternalLink aria-hidden /> Open
					</DropdownMenuItem>
					<DropdownMenuItem className="min-h-11" onSelect={() => open(true)}>
						<Download aria-hidden /> Download
					</DropdownMenuItem>
					{isAdmin && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem className="min-h-11" onSelect={() => setEditing(true)}>
								<Pencil aria-hidden /> Edit details
							</DropdownMenuItem>
							<DropdownMenuItem className="min-h-11 text-destructive" onSelect={() => setDeleting(true)}>
								<Trash2 aria-hidden /> Delete
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{isAdmin && <EditDocumentDialog doc={doc} open={editing} onOpenChange={setEditing} />}
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${doc.filename}?`}
				description="It's removed from the project. Confirmed quote totals from it are kept."
				confirmLabel="Delete"
				destructive
				pending={remove.isPending}
				onConfirm={() => remove.mutate(doc.id, { onSuccess: () => setDeleting(false) })}
			/>
		</li>
	);
}

function EditDocumentDialog({
	doc,
	open,
	onOpenChange,
}: {
	doc: FileEntry;
	open: boolean;
	onOpenChange: (o: boolean) => void;
}) {
	const { project } = useProjectContext();
	const update = useUpdateFile(project.id);
	const [caption, setCaption] = useState(doc.caption ?? "");
	const [stageId, setStageId] = useState(doc.stage?.id ?? "");
	const [category, setCategory] = useState<string>(doc.category);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent aria-describedby={undefined}>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate(
							{ id: doc.id, caption: caption.trim() || null, stageId: stageId || null, category },
							{ onSuccess: () => onOpenChange(false) },
						);
					}}
				>
					<DialogHeader>
						<DialogTitle>Edit document</DialogTitle>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						<Field id={`ed-cat-${doc.id}`} label="Category">
							<NativeSelect
								id={`ed-cat-${doc.id}`}
								value={category}
								onChange={(e) => setCategory(e.target.value)}
							>
								{DOCUMENT_CATEGORIES.map((c) => (
									<option key={c} value={c}>
										{CATEGORY_LABEL[c]}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field id={`ed-stage-${doc.id}`} label="Stage">
							<NativeSelect
								id={`ed-stage-${doc.id}`}
								value={stageId}
								onChange={(e) => setStageId(e.target.value)}
							>
								<option value="">No stage</option>
								{project.stages.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field id={`ed-cap-${doc.id}`} label="Caption">
							<Input
								id={`ed-cap-${doc.id}`}
								value={caption}
								onChange={(e) => setCaption(e.target.value)}
								maxLength={300}
							/>
						</Field>
						{update.isError && <p className="text-sm text-destructive">{errorMessage(update.error)}</p>}
					</DialogBody>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={update.isPending}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
