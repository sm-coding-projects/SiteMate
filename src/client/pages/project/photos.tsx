import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FileViewer } from "@/components/file-viewer";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadDialog } from "@/components/upload-dialog";
import { useDeleteFile, useFiles, useUpdateFile } from "@/hooks/use-data";
import { useUploads } from "@/hooks/use-uploads";
import { formatDate, nbHyphen } from "@/lib/format";
import type { FileEntry } from "../../../shared/api-types";
import { useProjectContext } from "./layout";

export function PhotosTab() {
	const { project, isAdmin } = useProjectContext();
	const [stageId, setStageId] = useState("");
	const files = useFiles(project.id, "photos", { stageId: stageId || undefined });
	const uploads = useUploads(project.id).filter((u) => u.category === "photo");
	const [picked, setPicked] = useState<File[]>([]);
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const chooseRef = useRef<HTMLInputElement>(null);
	const cameraRef = useRef<HTMLInputElement>(null);

	const photos = files.data?.pages.flatMap((p) => p.items) ?? [];

	const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
		setPicked(Array.from(e.target.files ?? []));
		e.target.value = "";
	};

	return (
		<div>
			<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<Field id="photo-stage" label="Stage" className="sm:w-64">
					<NativeSelect id="photo-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
						<option value="">All stages</option>
						{project.stages.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</NativeSelect>
				</Field>
				{isAdmin && (
					<div className="flex gap-2">
						<Button
							variant="outline"
							className="flex-1 sm:flex-none"
							onClick={() => cameraRef.current?.click()}
						>
							<Camera aria-hidden /> Take photo
						</Button>
						<Button className="flex-1 sm:flex-none" onClick={() => chooseRef.current?.click()}>
							<ImagePlus aria-hidden /> Add photos
						</Button>
						<input ref={chooseRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
						<input
							ref={cameraRef}
							type="file"
							accept="image/*"
							capture="environment"
							hidden
							onChange={onPick}
						/>
					</div>
				)}
			</div>

			{files.isPending ? (
				<GridSkeleton />
			) : files.isError && photos.length === 0 ? (
				<QueryError error={files.error} onRetry={() => files.refetch()} />
			) : photos.length === 0 && uploads.length === 0 ? (
				<p className="text-muted-foreground">
					{stageId ? "No photos for this stage yet." : "No photos yet."}
					{isAdmin && " Take one on site — it's compressed on your phone before it uploads."}
				</p>
			) : (
				<>
					<ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
						{uploads.map((u) => (
							<PendingTile
								key={u.id}
								blob={u.thumb ?? u.blob}
								progress={u.progress}
								failed={u.status === "failed"}
							/>
						))}
						{photos.map((p, i) => (
							<li key={p.id}>
								<button
									type="button"
									onClick={() => setOpenIndex(i)}
									className="group relative block aspect-square w-full overflow-hidden rounded-[3px] border bg-muted"
									aria-label={`Open photo${p.caption ? `: ${p.caption}` : ""}`}
								>
									{p.thumbUrl ? (
										<img
											src={p.thumbUrl}
											alt=""
											loading="lazy"
											decoding="async"
											className="size-full object-cover transition-opacity duration-200 group-hover:opacity-90"
										/>
									) : (
										<span className="bg-hatch absolute inset-0 text-muted-foreground">
											<span className="label-mono absolute right-1 bottom-0.5 text-[0.625rem]">IMG</span>
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
					<LoadMore {...files} />
				</>
			)}

			<UploadDialog project={project} kind="photos" files={picked} onDone={() => setPicked([])} />
			{openIndex !== null && photos[openIndex] && (
				<Lightbox
					photos={photos}
					index={openIndex}
					onIndex={setOpenIndex}
					onClose={() => setOpenIndex(null)}
				/>
			)}
		</div>
	);
}

function PendingTile({ blob, progress, failed }: { blob: Blob; progress: number; failed: boolean }) {
	const url = useMemo(() => URL.createObjectURL(blob), [blob]);
	useEffect(() => () => URL.revokeObjectURL(url), [url]);
	return (
		<li className="relative aspect-square overflow-hidden rounded-[3px] border">
			<img src={url} alt="" className="size-full object-cover opacity-60" />
			<span className="absolute inset-x-0 bottom-0 h-1 bg-border">
				<span className="block h-full bg-foreground" style={{ width: `${progress * 100}%` }} />
			</span>
			<span className="label-mono absolute top-1 left-1 rounded-[3px] bg-card/90 px-1 text-[0.625rem]">
				{failed ? "Failed" : `${Math.round(progress * 100)}%`}
			</span>
		</li>
	);
}

function Lightbox({
	photos,
	index,
	onIndex,
	onClose,
}: {
	photos: FileEntry[];
	index: number;
	onIndex: (i: number) => void;
	onClose: () => void;
}) {
	const { project, isAdmin } = useProjectContext();
	const photo = photos[index] as FileEntry;
	const [caption, setCaption] = useState(photo.caption ?? "");
	const [deleting, setDeleting] = useState(false);
	const update = useUpdateFile(project.id);
	const remove = useDeleteFile(project.id);

	useEffect(() => setCaption(photo.caption ?? ""), [photo.caption]);

	return (
		<FileViewer
			files={photos}
			index={index}
			onIndex={onIndex}
			onClose={onClose}
			meta={
				<>
					{photo.stage && `${nbHyphen(photo.stage.name)} · `}
					{photo.uploadedBy.name} · {formatDate(photo.uploadedAt)}
				</>
			}
		>
			{isAdmin ? (
				<form
					className="flex flex-col gap-2 sm:flex-row sm:items-end"
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate({ id: photo.id, caption: caption.trim() || null });
					}}
				>
					<Field id="lb-caption" label="Caption" className="flex-1">
						<Input
							id="lb-caption"
							value={caption}
							onChange={(e) => setCaption(e.target.value)}
							maxLength={300}
						/>
					</Field>
					<Field id="lb-stage" label="Stage" className="sm:w-48">
						<NativeSelect
							id="lb-stage"
							value={photo.stage?.id ?? ""}
							onChange={(e) => update.mutate({ id: photo.id, stageId: e.target.value || null })}
						>
							<option value="">No stage</option>
							{project.stages.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<div className="flex gap-2">
						<Button type="submit" variant="outline" disabled={update.isPending}>
							Save
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Delete photo"
							onClick={() => setDeleting(true)}
						>
							<Trash2 aria-hidden />
						</Button>
					</div>
				</form>
			) : (
				photo.caption && <p>{photo.caption}</p>
			)}
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title="Delete this photo?"
				description="It's removed from the project. An admin can ask for it to be recovered from storage."
				confirmLabel="Delete photo"
				destructive
				pending={remove.isPending}
				onConfirm={() =>
					remove.mutate(photo.id, {
						onSuccess: () => {
							setDeleting(false);
							onClose();
						},
					})
				}
			/>
		</FileViewer>
	);
}

function GridSkeleton() {
	return (
		<div role="status" aria-busy="true" className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
			<span className="sr-only">Loading photos</span>
			{Array.from({ length: 12 }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: placeholders
				<Skeleton key={i} className="aspect-square rounded-[3px]" />
			))}
		</div>
	);
}
