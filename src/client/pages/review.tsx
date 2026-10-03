import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	CircleCheck,
	ExternalLink,
	Plus,
	RotateCcw,
	ScanText,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageHeader } from "@/components/page-header";
import { LoadMore, QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import {
	useConfirmExtraction,
	useExtraction,
	useExtractions,
	useFileUrl,
	useRerunExtraction,
} from "@/hooks/use-data";
import { useIsAdmin } from "@/hooks/use-me";
import { useWide } from "@/hooks/use-media";
import { errorMessage } from "@/lib/api";
import { centsToInput, formatCents, formatWhen, parseDollars } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentType, ExtractionDetail, ExtractionStatus, Supplier } from "../../shared/api-types";
import type { GenericFields, LineItem, QuoteFields } from "../../shared/schemas";
import { formatAbn, validateQuote } from "../../shared/validators";

export const EXTRACTION_STATUS_TEXT: Record<ExtractionStatus, string> = {
	queued: "Queued",
	processing: "Reading",
	needs_review: "Needs review",
	confirmed: "Confirmed",
	failed: "Failed",
};
const TYPE_LABEL: Record<DocumentType, string> = {
	quote: "Quote",
	invoice: "Invoice",
	certificate: "Certificate",
	plan: "Plan",
	contract: "Contract",
	other: "Other",
};

// ── Inbox ────────────────────────────────────────────────────────────────────

export function ReviewInboxPage() {
	const [status, setStatus] = useState("open");
	const q = useExtractions(status);
	const items = q.data?.pages.flatMap((p) => p.items) ?? [];
	return (
		<>
			<PageHeader
				title="Review"
				description="Documents BFH App has read. Check the details, then confirm — nothing counts towards totals until you do."
			/>
			<Field id="review-filter" label="Show" className="mb-6 sm:w-64">
				<NativeSelect id="review-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
					<option value="open">Waiting on someone</option>
					<option value="needs_review">Needs review</option>
					<option value="failed">Failed</option>
					<option value="confirmed">Confirmed</option>
				</NativeSelect>
			</Field>
			{q.isPending ? (
				<div role="status" aria-busy="true" className="space-y-2">
					<span className="sr-only">Loading</span>
					<Skeleton className="h-16" />
					<Skeleton className="h-16" />
				</div>
			) : q.isError && items.length === 0 ? (
				<QueryError error={q.error} onRetry={() => q.refetch()} />
			) : items.length === 0 ? (
				<p className="text-muted-foreground">
					Nothing here. Upload a quote, invoice or certificate in a project's Documents tab and it shows up
					for review within a minute or so.
				</p>
			) : (
				<>
					<ul className="divide-y rounded-md border bg-card">
						{items.map((e) => (
							<li key={e.id}>
								<Link
									to={`/review/${e.id}`}
									className="flex items-center gap-3 px-4 py-3 hover:bg-accent md:px-5"
								>
									<ScanText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="block truncate font-medium">{e.file.filename}</span>
										<span className="block truncate text-sm text-muted-foreground">
											{e.project.name}
											{e.detectedType && ` · ${TYPE_LABEL[e.detectedType]}`}
										</span>
									</span>
									<span className="text-right">
										<ExtractionBadge status={e.status} />
										<span className="label-mono mt-1 block text-muted-foreground">
											{formatWhen(e.updatedAt)}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
					<LoadMore {...q} />
				</>
			)}
		</>
	);
}

export function ExtractionBadge({ status }: { status: ExtractionStatus }) {
	const Icon = status === "confirmed" ? CircleCheck : status === "failed" ? TriangleAlert : ScanText;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold whitespace-nowrap",
				status === "confirmed"
					? "bg-status-complete-bg text-status-complete"
					: status === "needs_review"
						? "bg-status-on-hold-bg text-status-on-hold"
						: status === "failed"
							? "bg-muted text-destructive"
							: "bg-status-not-started-bg text-status-not-started",
			)}
		>
			<Icon className="size-4" aria-hidden />
			{EXTRACTION_STATUS_TEXT[status]}
		</span>
	);
}

// ── Review screen ────────────────────────────────────────────────────────────

export function ReviewPage() {
	const { id } = useParams();
	const ex = useExtraction(id);
	const isAdmin = useIsAdmin();
	const desktop = useWide();

	if (ex.isPending) {
		return (
			<div role="status" aria-busy="true">
				<span className="sr-only">Loading</span>
				<Skeleton className="h-9 w-72 max-w-full" />
				<div className="mt-8 grid gap-6 lg:grid-cols-2">
					<Skeleton className="h-[60dvh]" />
					<Skeleton className="h-[60dvh]" />
				</div>
			</div>
		);
	}
	if (ex.isError || !ex.data) return <QueryError error={ex.error} onRetry={() => ex.refetch()} />;
	const e = ex.data;

	return (
		<>
			<Link
				to={`/projects/${e.project.id}/documents`}
				className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="size-[18px]" aria-hidden /> {e.project.name}
			</Link>
			<div className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-2xl font-semibold break-words">{e.file.filename}</h1>
					<p className="label-mono mt-1 text-muted-foreground">
						{e.provider ? `${e.provider} · ${e.model}` : "Waiting for a reader"}
						{e.confidence != null && ` · ${e.confidence}% sure it's a ${e.detectedType ?? "document"}`}
					</p>
				</div>
				<ExtractionBadge status={e.status} />
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
				{desktop ? <DocumentPreview e={e} /> : <OpenDocumentButton fileId={e.file.id} />}
				<div className="min-w-0">
					{e.status === "queued" || e.status === "processing" ? (
						<Working e={e} />
					) : e.status === "failed" && !e.fields ? (
						<Failed e={e} isAdmin={isAdmin} />
					) : (
						<ReviewForm key={`${e.id}-${e.updatedAt}`} e={e} isAdmin={isAdmin} />
					)}
				</div>
			</div>
		</>
	);
}

function OpenDocumentButton({ fileId }: { fileId: string }) {
	const getUrl = useFileUrl();
	return (
		<Button
			variant="outline"
			onClick={async () => {
				const w = window.open("about:blank", "_blank");
				try {
					const { url } = await getUrl(fileId);
					if (w) w.location.href = url;
				} catch {
					w?.close();
				}
			}}
		>
			<ExternalLink aria-hidden /> View the document
		</Button>
	);
}

function DocumentPreview({ e }: { e: ExtractionDetail }) {
	const getUrl = useFileUrl();
	const url = useQuery({
		queryKey: ["file-url", e.file.id],
		queryFn: () => getUrl(e.file.id),
		staleTime: 30 * 60_000,
	});
	const isPdf = e.file.mimeType === "application/pdf";
	const isImage = e.file.mimeType.startsWith("image/");
	return (
		<section
			aria-label="Document"
			className="sticky top-6 h-[calc(100dvh-8rem)] min-h-96 overflow-hidden rounded-md border bg-muted"
		>
			{url.isPending ? (
				<Skeleton className="size-full rounded-none" />
			) : url.isError ? (
				<QueryError className="m-4" error={url.error} onRetry={() => url.refetch()} />
			) : isPdf ? (
				<iframe title={e.file.filename} src={url.data.url} className="size-full" />
			) : isImage ? (
				<img src={url.data.url} alt={e.file.filename} className="size-full object-contain" />
			) : (
				<div className="grid size-full place-items-center p-6 text-center">
					<div>
						<p className="text-muted-foreground">This file type can't be previewed here.</p>
						<Button asChild variant="outline" className="mt-4">
							<a href={url.data.url} target="_blank" rel="noreferrer">
								<ExternalLink aria-hidden /> Open {e.file.filename}
							</a>
						</Button>
					</div>
				</div>
			)}
		</section>
	);
}

function Working({ e }: { e: ExtractionDetail }) {
	return (
		<div role="status" className="rounded-md border bg-card p-5">
			<p className="font-medium">{e.status === "queued" ? "Waiting to be read…" : "Reading the document…"}</p>
			<p className="mt-1 text-sm text-muted-foreground">
				Usually under a minute. This page updates by itself.{e.error && ` ${e.error}`}
			</p>
			<div className="mt-4 space-y-3" aria-hidden>
				<Skeleton className="h-11" />
				<Skeleton className="h-11" />
				<Skeleton className="h-11 w-2/3" />
			</div>
		</div>
	);
}

function Failed({ e, isAdmin }: { e: ExtractionDetail; isAdmin: boolean }) {
	const rerun = useRerunExtraction();
	return (
		<div role="alert" className="rounded-md border bg-card p-5">
			<p className="flex items-center gap-2 font-medium">
				<TriangleAlert className="size-5 text-destructive" aria-hidden /> BFH App couldn't read this document
			</p>
			<p className="mt-1 text-sm text-muted-foreground">{e.error ?? "Unknown error"}</p>
			{isAdmin && (
				<Button
					variant="outline"
					className="mt-4"
					onClick={() => rerun.mutate(e.id)}
					disabled={rerun.isPending}
				>
					<RotateCcw aria-hidden /> Re-run extraction
				</Button>
			)}
			{rerun.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(rerun.error)}</p>}
		</div>
	);
}

type MoneyKey = "amountExGstCents" | "gstCents" | "amountIncGstCents";
const MONEY: { key: MoneyKey; label: string }[] = [
	{ key: "amountExGstCents", label: "Ex‑GST" },
	{ key: "gstCents", label: "GST" },
	{ key: "amountIncGstCents", label: "Total inc‑GST" },
];

const emptyQuote: QuoteFields = {
	supplierName: null,
	abn: null,
	trade: null,
	supplierEmail: null,
	supplierPhone: null,
	quoteNumber: null,
	quoteDate: null,
	validUntil: null,
	lineItems: [],
	amountExGstCents: null,
	gstCents: null,
	amountIncGstCents: null,
};
const emptyGeneric: GenericFields = {
	title: null,
	issuer: null,
	documentDate: null,
	reference: null,
	summary: null,
};
const nn = (s: string) => (s.trim() === "" ? null : s.trim());

function useSuppliers() {
	const api = useApi();
	return useQuery({
		queryKey: ["suppliers"],
		queryFn: () => api<Supplier[]>("/suppliers"),
		staleTime: 5 * 60_000,
	});
}

function ReviewForm({ e, isAdmin }: { e: ExtractionDetail; isAdmin: boolean }) {
	const navigate = useNavigate();
	const confirm = useConfirmExtraction(e.id, e.project.id);
	const rerun = useRerunExtraction();
	const suppliers = useSuppliers();
	const [type, setType] = useState<DocumentType>(e.fields?.documentType ?? e.detectedType ?? "other");
	const [quote, setQuote] = useState<QuoteFields>({ ...emptyQuote, ...e.fields?.quote });
	const [generic, setGeneric] = useState<GenericFields>({ ...emptyGeneric, ...e.fields?.generic });
	const [money, setMoney] = useState(
		() =>
			Object.fromEntries(MONEY.map(({ key }) => [key, centsToInput(e.fields?.quote?.[key])])) as Record<
				MoneyKey,
				string
			>,
	);
	const [lines, setLines] = useState(() =>
		(e.fields?.quote?.lineItems ?? []).map((l) => ({
			description: l.description,
			amount: centsToInput(l.amountCents),
		})),
	);
	const suggested = e.stages.find((s) => s.name === e.fields?.suggestedStage);
	const [stageId, setStageId] = useState(suggested?.id ?? "");
	const [supplierId, setSupplierId] = useState<string>(e.fields?.supplierMatch?.id ?? "");
	const [error, setError] = useState<string | null>(null);

	const current: QuoteFields = useMemo(
		() => ({
			...quote,
			lineItems: lines
				.map((l): LineItem | null => {
					const c = parseDollars(l.amount);
					return c === null ? null : { description: l.description, amountCents: c };
				})
				.filter((l): l is LineItem => l !== null),
			amountExGstCents: parseDollars(money.amountExGstCents),
			gstCents: parseDollars(money.gstCents),
			amountIncGstCents: parseDollars(money.amountIncGstCents),
		}),
		[quote, lines, money],
	);
	// Same rules as the server, re-run on every edit.
	const validation = useMemo(
		() => validateQuote(current, { suppliers: suppliers.data ?? [] }),
		[current, suppliers.data],
	);
	useEffect(() => {
		if (!supplierId && validation.supplierMatch) setSupplierId(validation.supplierMatch.id);
	}, [validation.supplierMatch, supplierId]);

	const setQ = (k: keyof QuoteFields) => (ev: { target: { value: string } }) =>
		setQuote((q) => ({ ...q, [k]: nn(ev.target.value) }));
	const setG = (k: keyof GenericFields) => (ev: { target: { value: string } }) =>
		setGeneric((g) => ({ ...g, [k]: nn(ev.target.value) }));
	const readOnly = !isAdmin;

	const submit = (ev: FormEvent) => {
		ev.preventDefault();
		setError(null);
		if (type === "quote") {
			if (!current.supplierName) return setError("Add the supplier's name");
			if (current.amountExGstCents == null || current.gstCents == null || current.amountIncGstCents == null)
				return setError("All three amounts are needed");
			confirm.mutate(
				{
					documentType: "quote",
					fields: {
						...current,
						supplierName: current.supplierName,
						amountExGstCents: current.amountExGstCents,
						gstCents: current.gstCents,
						amountIncGstCents: current.amountIncGstCents,
					},
					supplierId: supplierId || null,
					stageId: stageId || null,
				},
				{
					onSuccess: () => navigate(`/projects/${e.project.id}/quotes`),
					onError: (err) => setError(errorMessage(err)),
				},
			);
		} else {
			confirm.mutate(
				{ documentType: type, fields: generic, stageId: stageId || null },
				{
					onSuccess: () => navigate(`/projects/${e.project.id}/documents`),
					onError: (err) => setError(errorMessage(err)),
				},
			);
		}
	};

	return (
		<form onSubmit={submit} className="grid grid-cols-1 gap-6">
			{e.status === "confirmed" && (
				<p className="rounded-md border bg-card px-4 py-3 text-sm">
					Confirmed{e.reviewedBy?.name ? ` by ${e.reviewedBy.name}` : ""}
					{e.reviewedAt ? ` · ${formatWhen(e.reviewedAt)}` : ""}.
					{isAdmin && " Saving again updates the quote."}
				</p>
			)}
			<fieldset disabled={readOnly || confirm.isPending} className="grid min-w-0 grid-cols-1 gap-4">
				<legend className="sr-only">Document details</legend>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field id="rv-type" label="Document type">
						<NativeSelect
							id="rv-type"
							value={type}
							onChange={(ev) => setType(ev.target.value as DocumentType)}
						>
							{Object.entries(TYPE_LABEL).map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field id="rv-stage" label="Stage" hint={suggested ? `Suggested: ${suggested.name}` : undefined}>
						<NativeSelect id="rv-stage" value={stageId} onChange={(ev) => setStageId(ev.target.value)}>
							<option value="">No stage</option>
							{e.stages.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</NativeSelect>
					</Field>
				</div>

				{type === "quote" ? (
					<>
						<Field id="rv-supplier" label="Supplier">
							<Input id="rv-supplier" value={quote.supplierName ?? ""} onChange={setQ("supplierName")} />
						</Field>
						<Field
							id="rv-supplier-link"
							label="Save under"
							hint="Matching suppliers are shared across projects."
						>
							<NativeSelect
								id="rv-supplier-link"
								value={supplierId}
								onChange={(ev) => setSupplierId(ev.target.value)}
							>
								<option value="">New supplier</option>
								{(suppliers.data ?? []).map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
										{s.abn ? ` · ${formatAbn(s.abn)}` : ""}
									</option>
								))}
							</NativeSelect>
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="rv-abn" label="ABN">
								<Input id="rv-abn" inputMode="numeric" value={quote.abn ?? ""} onChange={setQ("abn")} />
							</Field>
							<Field id="rv-trade" label="Trade">
								<Input
									id="rv-trade"
									value={quote.trade ?? ""}
									onChange={setQ("trade")}
									placeholder="e.g. Plumbing"
								/>
							</Field>
							<Field id="rv-number" label="Quote number">
								<Input id="rv-number" value={quote.quoteNumber ?? ""} onChange={setQ("quoteNumber")} />
							</Field>
							<Field id="rv-email" label="Supplier email">
								<Input
									id="rv-email"
									type="email"
									value={quote.supplierEmail ?? ""}
									onChange={setQ("supplierEmail")}
								/>
							</Field>
							<Field id="rv-date" label="Quote date">
								<Input id="rv-date" type="date" value={quote.quoteDate ?? ""} onChange={setQ("quoteDate")} />
							</Field>
							<Field id="rv-valid" label="Valid until">
								<Input
									id="rv-valid"
									type="date"
									value={quote.validUntil ?? ""}
									onChange={setQ("validUntil")}
								/>
							</Field>
						</div>

						<section aria-labelledby="rv-lines-h">
							<h2 id="rv-lines-h" className="label-mono mb-2 text-muted-foreground">
								Line items
							</h2>
							<ul className="grid gap-2">
								{lines.map((l, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: editable rows without ids
									<li key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
										<Input
											aria-label={`Line ${i + 1} description`}
											value={l.description}
											onChange={(ev) =>
												setLines((ls) =>
													ls.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)),
												)
											}
										/>
										<Input
											aria-label={`Line ${i + 1} amount`}
											inputMode="decimal"
											className="text-right font-mono"
											value={l.amount}
											onChange={(ev) =>
												setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))
											}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											aria-label={`Remove line ${i + 1}`}
											onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
										>
											<Trash2 aria-hidden />
										</Button>
									</li>
								))}
							</ul>
							{!readOnly && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="mt-1"
									onClick={() => setLines((ls) => [...ls, { description: "", amount: "" }])}
								>
									<Plus aria-hidden /> Add line
								</Button>
							)}
						</section>

						<div className="grid grid-cols-3 gap-2">
							{MONEY.map(({ key, label }) => (
								<Field key={key} id={`rv-${key}`} label={label}>
									<Input
										id={`rv-${key}`}
										inputMode="decimal"
										className="text-right font-mono"
										value={money[key]}
										onChange={(ev) => setMoney((m) => ({ ...m, [key]: ev.target.value }))}
									/>
								</Field>
							))}
						</div>
						{!readOnly && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="-mt-2 justify-self-start"
								onClick={() => {
									const ex = parseDollars(money.amountExGstCents);
									if (ex == null) return;
									const gst = Math.round(ex * 0.1);
									setMoney({
										amountExGstCents: centsToInput(ex),
										gstCents: centsToInput(gst),
										amountIncGstCents: centsToInput(ex + gst),
									});
								}}
							>
								Work out GST and total from ex‑GST
							</Button>
						)}

						<section aria-labelledby="rv-checks-h" className="rounded-md border bg-card p-4">
							<h2 id="rv-checks-h" className="label-mono mb-3 text-muted-foreground">
								Checks ·{" "}
								{validation.warnings.length ? `${validation.warnings.length} to look at` : "all passed"}
							</h2>
							<ul className="grid gap-2" aria-live="polite">
								{validation.checks.map((c) => (
									<li key={c.id} className="flex gap-2 text-sm">
										{c.ok ? (
											<CircleCheck
												className="mt-0.5 size-4 shrink-0 text-status-complete"
												aria-label="Passed"
											/>
										) : (
											<TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Check" />
										)}
										<span>{c.message}</span>
									</li>
								))}
								{e.validation?.warnings
									.filter((w) => !validation.checks.some((c) => c.message === w))
									.filter((w) => w.startsWith("The document was long"))
									.map((w) => (
										<li key={w} className="flex gap-2 text-sm">
											<TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Check" />
											<span>{w}</span>
										</li>
									))}
							</ul>
							<p className="mt-3 text-sm text-muted-foreground">
								Totals: {formatCents(current.amountExGstCents)} + {formatCents(current.gstCents)} GST ={" "}
								<span className="font-medium text-foreground">{formatCents(current.amountIncGstCents)}</span>
							</p>
						</section>
					</>
				) : (
					<>
						<Field id="rv-title" label="Title">
							<Input id="rv-title" value={generic.title ?? ""} onChange={setG("title")} />
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="rv-issuer" label="Issued by">
								<Input id="rv-issuer" value={generic.issuer ?? ""} onChange={setG("issuer")} />
							</Field>
							<Field id="rv-ref" label="Reference">
								<Input id="rv-ref" value={generic.reference ?? ""} onChange={setG("reference")} />
							</Field>
							<Field id="rv-docdate" label="Date">
								<Input
									id="rv-docdate"
									type="date"
									value={generic.documentDate ?? ""}
									onChange={setG("documentDate")}
								/>
							</Field>
						</div>
						<Field id="rv-summary" label="Summary">
							<Textarea id="rv-summary" value={generic.summary ?? ""} onChange={setG("summary")} />
						</Field>
					</>
				)}
			</fieldset>

			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{isAdmin && (
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
					<Button
						type="button"
						variant="outline"
						disabled={rerun.isPending || e.status === "confirmed"}
						onClick={() => rerun.mutate(e.id)}
					>
						<RotateCcw aria-hidden /> Re-run extraction
					</Button>
					<Button type="submit" disabled={confirm.isPending}>
						<CircleCheck aria-hidden />{" "}
						{confirm.isPending ? "Saving…" : type === "quote" ? "Confirm quote" : "Confirm"}
					</Button>
				</div>
			)}
		</form>
	);
}
