import { Check, RotateCcw, ScanText, X } from "lucide-react";
import { Link } from "react-router";
import { QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useExtractions, useQuotes, useSetQuoteStatus } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { formatCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoneyTotals, QuoteEntry, QuoteStatus } from "../../../shared/api-types";
import { ExtractionBadge } from "../review";
import { useProjectContext } from "./layout";

const STATUS: Record<QuoteStatus, { label: string; cls: string }> = {
	pending: { label: "Pending", cls: "bg-status-not-started-bg text-status-not-started" },
	accepted: { label: "Accepted", cls: "bg-status-complete-bg text-status-complete" },
	rejected: { label: "Rejected", cls: "bg-muted text-muted-foreground line-through" },
};

function Money({ cents, strong }: { cents: number; strong?: boolean }) {
	return (
		<span className={cn("font-mono tabular whitespace-nowrap", strong && "font-medium")}>
			{formatCents(cents)}
		</span>
	);
}

function TotalCard({ label, t }: { label: string; t: MoneyTotals }) {
	return (
		<div className="rounded-md border bg-card p-4">
			<p className="label-mono text-muted-foreground">
				{label} · {t.count}
			</p>
			<p className="mt-2 text-xl font-semibold">
				<Money cents={t.incGstCents} />
			</p>
			<dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm text-muted-foreground">
				<dt>Ex‑GST</dt>
				<dd className="text-right">
					<Money cents={t.exGstCents} />
				</dd>
				<dt>GST</dt>
				<dd className="text-right">
					<Money cents={t.gstCents} />
				</dd>
			</dl>
		</div>
	);
}

export function QuotesTab() {
	const { project } = useProjectContext();
	const q = useQuotes(project.id);
	const pending = useExtractions("open", project.id);
	const waiting = (pending.data?.pages.flatMap((p) => p.items) ?? []).filter((e) => e.status !== "confirmed");

	return (
		<div className="grid gap-8">
			{waiting.length > 0 && (
				<section aria-labelledby="awaiting-h">
					<h2 id="awaiting-h" className="label-mono mb-3 text-muted-foreground">
						Awaiting review · not counted yet
					</h2>
					<ul className="divide-y rounded-md border bg-card">
						{waiting.map((e) => (
							<li key={e.id}>
								<Link to={`/review/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
									<ScanText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
									<span className="min-w-0 flex-1 truncate">{e.file.filename}</span>
									<ExtractionBadge status={e.status} />
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			{q.isPending ? (
				<div role="status" aria-busy="true" className="grid gap-4 sm:grid-cols-3">
					<span className="sr-only">Loading quotes</span>
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
				</div>
			) : q.isError ? (
				<QueryError error={q.error} onRetry={() => q.refetch()} />
			) : q.data.quotes.length === 0 ? (
				<p className="max-w-[60ch] text-muted-foreground">
					No confirmed quotes yet. Upload a supplier quote in Documents; once you've checked and confirmed
					what SiteMate read, it's added here and to the totals.
				</p>
			) : (
				<>
					<section aria-labelledby="totals-h">
						<h2 id="totals-h" className="label-mono mb-3 text-muted-foreground">
							Totals by status · confirmed quotes only
						</h2>
						<div className="grid gap-3 sm:grid-cols-3">
							<TotalCard label="Accepted" t={q.data.totals.byStatus.accepted} />
							<TotalCard label="Pending" t={q.data.totals.byStatus.pending} />
							<TotalCard label="Rejected" t={q.data.totals.byStatus.rejected} />
						</div>
					</section>

					<section aria-labelledby="trades-h">
						<h2 id="trades-h" className="label-mono mb-3 text-muted-foreground">
							By trade · accepted and pending
						</h2>
						<div className="overflow-x-auto rounded-md border bg-card">
							<table className="w-full min-w-[32rem] text-sm">
								<thead>
									<tr className="border-b text-left text-muted-foreground">
										<th scope="col" className="px-4 py-2 font-medium">
											Trade
										</th>
										<th scope="col" className="px-4 py-2 text-right font-medium">
											Ex‑GST
										</th>
										<th scope="col" className="px-4 py-2 text-right font-medium">
											GST
										</th>
										<th scope="col" className="px-4 py-2 text-right font-medium">
											Inc‑GST
										</th>
										<th scope="col" className="px-4 py-2 text-right font-medium">
											Accepted
										</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{q.data.totals.byTrade.map((t) => (
										<tr key={t.trade}>
											<th scope="row" className="px-4 py-2 text-left font-medium">
												{t.trade} <span className="label-mono text-muted-foreground">· {t.count}</span>
											</th>
											<td className="px-4 py-2 text-right">
												<Money cents={t.exGstCents} />
											</td>
											<td className="px-4 py-2 text-right">
												<Money cents={t.gstCents} />
											</td>
											<td className="px-4 py-2 text-right">
												<Money cents={t.incGstCents} strong />
											</td>
											<td className="px-4 py-2 text-right">
												<Money cents={t.acceptedIncGstCents} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>

					<section aria-labelledby="quotes-h">
						<h2 id="quotes-h" className="label-mono mb-3 text-muted-foreground">
							Quotes
						</h2>
						<ul className="grid gap-3">
							{q.data.quotes.map((quote) => (
								<QuoteRow key={quote.id} quote={quote} />
							))}
						</ul>
					</section>
				</>
			)}
		</div>
	);
}

function QuoteRow({ quote }: { quote: QuoteEntry }) {
	const { project, isAdmin } = useProjectContext();
	const set = useSetQuoteStatus(project.id);
	const s = STATUS[quote.status];
	return (
		<li className="rounded-md border bg-card p-4 md:p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-medium">{quote.supplier?.name ?? "Unknown supplier"}</p>
					<p className="text-sm text-muted-foreground">
						{[
							quote.trade,
							quote.quoteNumber && `#${quote.quoteNumber}`,
							quote.quoteDate && formatDate(quote.quoteDate),
						]
							.filter(Boolean)
							.join(" · ")}
						{quote.validUntil && ` · valid to ${formatDate(quote.validUntil)}`}
					</p>
				</div>
				<span className={cn("rounded-full px-2.5 py-1 text-sm font-semibold", s.cls)}>
					{quote.status === "accepted" && <Check className="mr-1 inline size-4" aria-hidden />}
					{s.label}
				</span>
			</div>
			<p className="mt-3 text-sm">
				<Money cents={quote.amountExGstCents} /> + <Money cents={quote.gstCents} /> GST ={" "}
				<Money cents={quote.amountIncGstCents} strong />
			</p>
			{quote.decidedBy && (
				<p className="mt-1 text-xs text-muted-foreground">
					{s.label} by {quote.decidedBy.name ?? "an admin"}
					{quote.decidedAt && ` · ${formatDate(quote.decidedAt)}`}
				</p>
			)}
			<div className="mt-3 flex flex-wrap gap-2">
				{isAdmin && quote.status !== "accepted" && (
					<Button
						variant="outline"
						size="sm"
						disabled={set.isPending}
						onClick={() => set.mutate({ id: quote.id, status: "accepted" })}
					>
						<Check aria-hidden /> Accept
					</Button>
				)}
				{isAdmin && quote.status !== "rejected" && (
					<Button
						variant="outline"
						size="sm"
						disabled={set.isPending}
						onClick={() => set.mutate({ id: quote.id, status: "rejected" })}
					>
						<X aria-hidden /> Reject
					</Button>
				)}
				{isAdmin && quote.status !== "pending" && (
					<Button
						variant="ghost"
						size="sm"
						disabled={set.isPending}
						onClick={() => set.mutate({ id: quote.id, status: "pending" })}
					>
						<RotateCcw aria-hidden /> Undo
					</Button>
				)}
				{quote.extractionId && (
					<Button asChild variant="ghost" size="sm">
						<Link to={`/review/${quote.extractionId}`}>View details</Link>
					</Button>
				)}
			</div>
			{set.isError && <p className="mt-2 text-sm text-destructive">{errorMessage(set.error)}</p>}
		</li>
	);
}
