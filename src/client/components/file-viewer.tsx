import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileUrl } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ViewerFile {
	id: string;
	filename: string;
	mimeType: string;
	caption?: string | null;
}

type Preview = "image" | "frame" | "none";

/** What the browser can show in place: images, and PDFs/plain text in a frame. Office files can't be. */
function previewOf(mimeType: string): Preview {
	if (mimeType.startsWith("image/")) return "image";
	if (mimeType === "application/pdf" || mimeType === "text/plain" || mimeType === "text/csv") return "frame";
	return "none";
}

/**
 * Opens a file in a new tab, or downloads it, on the user's say-so. The tab is opened before the signed URL
 * is fetched so popup blockers allow it.
 */
export function useOpenFile() {
	const getUrl = useFileUrl();
	const [error, setError] = useState<string | null>(null);
	const open = useCallback(
		async (fileId: string, { download = false } = {}) => {
			setError(null);
			const w = download ? null : window.open("about:blank", "_blank");
			try {
				const { url } = await getUrl(fileId, download);
				if (w) w.location.href = url;
				else window.location.href = url;
			} catch (e) {
				w?.close();
				setError(errorMessage(e));
			}
		},
		[getUrl],
	);
	return { open, error };
}

/**
 * Full-screen-ish viewer for project files, with previous/next when there's more than one. Photos show as
 * images, PDFs inline; anything else gets a file card. New tab and download are explicit buttons.
 * `meta` sits beside the counter; `children` go under it (e.g. the photo caption form).
 */
export function FileViewer({
	files,
	index,
	onIndex,
	onClose,
	meta,
	children,
}: {
	files: ViewerFile[];
	index: number;
	onIndex: (i: number) => void;
	onClose: () => void;
	meta?: ReactNode;
	children?: ReactNode;
}) {
	const file = files[index] as ViewerFile;
	const preview = previewOf(file.mimeType);
	const getUrl = useFileUrl();
	const { open, error: openError } = useOpenFile();
	const [url, setUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const many = files.length > 1;
	const noun = preview === "image" ? "photo" : "file";

	// Fetch once per file shown; the signer's identity changing (e.g. a token refresh) isn't a new file.
	const getUrlRef = useRef(getUrl);
	getUrlRef.current = getUrl;
	useEffect(() => {
		let live = true;
		setUrl(null);
		setError(null);
		if (previewOf(file.mimeType) === "none") return;
		getUrlRef
			.current(file.id)
			.then((r) => live && setUrl(r.url))
			.catch((e) => live && setError(errorMessage(e)));
		return () => {
			live = false;
		};
	}, [file.id, file.mimeType]);

	const go = useCallback(
		(d: -1 | 1) => {
			const next = index + d;
			if (next >= 0 && next < files.length) onIndex(next);
		},
		[index, files.length, onIndex],
	);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Arrow keys belong to the caption field (or any other control) while it has focus.
			if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
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
					{file.filename}
					{many && `, ${noun} ${index + 1} of ${files.length}`}
				</DialogTitle>
				<div className="relative grid min-h-[50dvh] place-items-center overflow-hidden bg-ink sm:rounded-t-lg">
					{error ? (
						<p className="px-6 text-center text-sm text-[#eef0ec]">{error}</p>
					) : preview === "none" ? (
						<div className="grid max-w-sm justify-items-center gap-3 px-16 py-10 text-center text-[#eef0ec]">
							<FileText className="size-12 opacity-70" aria-hidden />
							<p className="font-medium break-all">{file.filename}</p>
							<p className="text-sm opacity-70">This file type can't be previewed here.</p>
							<Button variant="secondary" onClick={() => open(file.id, { download: true })}>
								<Download aria-hidden /> Download
							</Button>
						</div>
					) : !url ? (
						<Skeleton className="size-full min-h-[50dvh] rounded-none bg-white/5" />
					) : preview === "image" ? (
						<img
							src={url}
							alt={file.caption ?? ""}
							className="max-h-[70dvh] w-auto max-w-full object-contain"
						/>
					) : (
						<iframe
							key={file.id}
							src={url}
							title={file.filename}
							// Leave the side gutters to the previous/next buttons.
							className={cn("h-[70dvh] bg-white", many ? "w-[calc(100%-7rem)]" : "w-full")}
						/>
					)}
					{many && (
						<>
							<Button
								variant="secondary"
								size="icon"
								className="absolute top-1/2 left-2 -translate-y-1/2"
								onClick={() => go(-1)}
								disabled={index === 0}
								aria-label={`Previous ${noun}`}
							>
								<ChevronLeft aria-hidden />
							</Button>
							<Button
								variant="secondary"
								size="icon"
								className="absolute top-1/2 right-2 -translate-y-1/2"
								onClick={() => go(1)}
								disabled={index === files.length - 1}
								aria-label={`Next ${noun}`}
							>
								<ChevronRight aria-hidden />
							</Button>
						</>
					)}
				</div>
				<div className="grid gap-3 overflow-y-auto px-6 py-4">
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<p className="label-mono min-w-0 text-muted-foreground">
							{many && `${index + 1}/${files.length} · `}
							{meta ?? <span className="break-all normal-case">{file.filename}</span>}
						</p>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => open(file.id)}>
								<ExternalLink aria-hidden /> Open in new tab
							</Button>
							<Button variant="outline" size="sm" onClick={() => open(file.id, { download: true })}>
								<Download aria-hidden /> Download
							</Button>
						</div>
					</div>
					{openError && <p className="text-sm text-destructive">{openError}</p>}
					{children}
				</div>
			</DialogContent>
		</Dialog>
	);
}
