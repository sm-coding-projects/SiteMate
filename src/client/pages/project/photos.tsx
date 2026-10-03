import { Camera, ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadDialog } from "@/components/upload-dialog";
import { useDeleteFile, useFiles, useFileUrl, useUpdateFile } from "@/hooks/use-data";
import { useUploads } from "@/hooks/use-uploads";
import { errorMessage } from "@/lib/api";
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
	const getUrl = useFileUrl();
	const [url, setUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [caption, setCaption] = useState(photo.caption ?? "");
	const [deleting, setDeleting] = useState(false);
	const update = useUpdateFile(project.id);
	const remove = useDeleteFile(project.id);

	useEffect(() => {
		let live = true;
		setUrl(null);
		setError(null);
		setCaption(photo.caption ?? "");
		getUrl(photo.id)
			.then((r) => live && setUrl(r.url))
			.catch((e) => live && setError(errorMessage(e)));
		return () => {
			live = false;
		};
	}, [photo.id, photo.caption, getUrl]);

	const go = useCallback(
		(d: -1 | 1) => {
			const next = index + d;
			if (next >= 0 && next < photos.length) onIndex(next);
		},
		[index, photos.length, onIndex],
	);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowLeft") go(-1);
			if (e.key === "ArrowRight") go(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [go]);

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent wide aria-describedby={undefined} className="sm:max-w-5xl">
				<DialogTitle className="sr-only">
					Photo {index + 1} of {photos.length}
				</DialogTitle>
				<div className="relative grid min-h-[50dvh] place-items-center bg-ink sm:rounded-t-lg">
					{url ? (
						<img
							src={url}
							alt={photo.caption ?? ""}
							className="max-h-[70dvh] w-auto max-w-full object-contain"
						/>
					) : error ? (
						<p className="px-6 text-center text-sm text-[#eef0ec]">{error}</p>
					) : (
						<Skeleton className="size-full min-h-[50dvh] rounded-none bg-white/5" />
					)}
					<Button
						variant="secondary"
						size="icon"
						className="absolute top-1/2 left-2 -translate-y-1/2"
						onClick={() => go(-1)}
						disabled={index === 0}
						aria-label="Previous photo"
					>
						<ChevronLeft aria-hidden />
					</Button>
					<Button
						variant="secondary"
						size="icon"
						className="absolute top-1/2 right-2 -translate-y-1/2"
						onClick={() => go(1)}
						disabled={index === photos.length - 1}
						aria-label="Next photo"
					>
						<ChevronRight aria-hidden />
					</Button>
				</div>
				<div className="grid gap-3 overflow-y-auto px-6 py-4">
					<p className="label-mono text-muted-foreground">
						{index + 1}/{photos.length}
						{photo.stage && ` · ${nbHyphen(photo.stage.name)}`} · {photo.uploadedBy.name} ·{" "}
						{formatDate(photo.uploadedAt)}
					</p>
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
				</div>
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
			</DialogContent>
		</Dialog>
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
