import { type FormEvent, useEffect, useState } from "react";
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
import { formatBytes } from "@/lib/format";
import { processPhoto, thumbFor } from "@/lib/image";
import { type NewUpload, uploadQueue } from "@/lib/upload-queue";
import type { ProjectDetail } from "../../shared/api-types";
import { currentStageNumber } from "../../shared/progress";
import { DOCUMENT_CATEGORIES, fileCreate } from "../../shared/schemas";

export const CATEGORY_LABEL: Record<string, string> = {
	photo: "Photo",
	document: "Document",
	quote: "Quote",
	invoice: "Invoice",
	certificate: "Certificate",
	plan: "Plan",
	other: "Other",
};

const EXT_MIME: Record<string, string> = {
	pdf: "application/pdf",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	heic: "image/heic",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	csv: "text/csv",
};
/** Some Android pickers report an empty type; fall back to the extension. */
const mimeOf = (f: File) =>
	f.type || EXT_MIME[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";

/**
 * Confirms where picked files go (stage, category, caption), then compresses photos and hands everything
 * to the persistent upload queue. Validated with the same schema the API uses.
 */
export function UploadDialog({
	project,
	kind,
	files,
	onDone,
}: {
	project: ProjectDetail;
	kind: "photos" | "documents";
	files: File[];
	onDone: () => void;
}) {
	const current = project.stages[currentStageNumber(project.stages) - 1];
	const [stageId, setStageId] = useState(current?.id ?? "");
	const [category, setCategory] = useState<string>(kind === "photos" ? "photo" : "quote");
	const [caption, setCaption] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = files.length > 0;

	useEffect(() => {
		if (open) {
			setError(null);
			setCaption("");
			// Guess the category from the first document's name.
			if (kind === "documents") {
				const n = files[0]?.name.toLowerCase() ?? "";
				setCategory(
					/quote|estimate/.test(n)
						? "quote"
						: /invoice|tax inv/.test(n)
							? "invoice"
							: /cert/.test(n)
								? "certificate"
								: /plan|dwg|drawing/.test(n)
									? "plan"
									: "document",
				);
			}
		}
	}, [open, files, kind]);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const items: NewUpload[] = [];
			for (const file of files) {
				const base = {
					projectId: project.id,
					category,
					stageId: stageId || null,
					caption: files.length === 1 ? caption.trim() || null : null,
					filename: file.name || "photo.jpg",
				};
				let upload: NewUpload;
				if (kind === "photos") {
					const p = await processPhoto(file);
					upload = {
						...base,
						mimeType: p.mimeType,
						blob: p.blob,
						thumb: p.thumb,
						thumbMimeType: p.thumbMimeType,
					};
					if (p.mimeType === "image/jpeg")
						upload.filename = base.filename.replace(/\.(heic|heif|png|webp)$/i, ".jpg");
				} else {
					const t = mimeOf(file).startsWith("image/") ? await thumbFor(file) : null;
					upload = {
						...base,
						mimeType: mimeOf(file),
						blob: file,
						thumb: t?.thumb ?? null,
						thumbMimeType: t?.thumbMimeType ?? "image/webp",
					};
				}
				const check = fileCreate.safeParse({
					filename: upload.filename,
					mimeType: upload.mimeType,
					sizeBytes: upload.blob.size,
					category: upload.category,
				});
				if (!check.success) {
					throw new Error(`${file.name}: ${check.error.issues[0]?.message ?? "not allowed"}`);
				}
				items.push(upload);
			}
			await uploadQueue.add(items);
			onDone();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't prepare the upload");
		} finally {
			setBusy(false);
		}
	};

	const total = files.reduce((n, f) => n + f.size, 0);
	return (
		<Dialog open={open} onOpenChange={(o) => !o && !busy && onDone()}>
			<DialogContent>
				<form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader>
						<DialogTitle>
							{kind === "photos"
								? `Upload ${files.length} photo${files.length === 1 ? "" : "s"}`
								: `Upload ${files.length === 1 ? (files[0]?.name ?? "document") : `${files.length} documents`}`}
						</DialogTitle>
						<DialogDescription>
							<span className="label-mono">{formatBytes(total)}</span>
							{kind === "photos"
								? " before compression. Photos are resized on this device first to save data."
								: ". Quotes, invoices and certificates are read automatically for review."}
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						<Field id="up-stage" label="Stage">
							<NativeSelect id="up-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
								<option value="">No stage</option>
								{project.stages.map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</NativeSelect>
						</Field>
						{kind === "documents" && (
							<Field id="up-category" label="Category">
								<NativeSelect id="up-category" value={category} onChange={(e) => setCategory(e.target.value)}>
									{DOCUMENT_CATEGORIES.map((c) => (
										<option key={c} value={c}>
											{CATEGORY_LABEL[c]}
										</option>
									))}
								</NativeSelect>
							</Field>
						)}
						{files.length === 1 && (
							<Field id="up-caption" label="Caption (optional)">
								<Input
									id="up-caption"
									value={caption}
									onChange={(e) => setCaption(e.target.value)}
									maxLength={300}
								/>
							</Field>
						)}
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={busy}>
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={busy}>
							{busy ? "Preparing…" : "Upload"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
