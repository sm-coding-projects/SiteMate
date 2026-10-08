import { Check, CircleAlert, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useChat, useClearChat, useDecideChatAction, useProjects, useSendChat } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatAction, ChatMessage } from "../../shared/api-types";

const LAST_PROJECT = "bfh.ask.project";
const STARTERS = [
	"Are any documents on the wrong checklist item?",
	"Review the documents waiting for review",
	"What's still open in the current stage?",
];

function remembered() {
	try {
		return localStorage.getItem(LAST_PROJECT) ?? "";
	} catch {
		return "";
	}
}

/**
 * Ask AI: chat about one project at a time. The assistant only proposes changes (move, attach, confirm a review);
 * each waits for Approve. It can't delete or remove documents or photos.
 */
export function AskPage() {
	const [params, setParams] = useSearchParams();
	const projects = useProjects({ status: "open" });
	const list = projects.data?.pages.flatMap((p) => p.items) ?? [];
	const fromUrl = params.get("project") ?? "";
	const saved = remembered();
	const projectId =
		fromUrl ||
		(saved && list.some((p) => p.id === saved) ? saved : "") ||
		(list.length === 1 ? list[0]?.id : "");

	const choose = (id: string) => {
		setParams(id ? { project: id } : {}, { replace: true });
		try {
			localStorage.setItem(LAST_PROJECT, id);
		} catch {
			// Private mode: the choice just isn't remembered.
		}
	};

	return (
		<>
			<PageHeader
				title="Ask AI"
				description="Ask about one project at a time. The assistant can suggest moving documents, attaching them to checks and confirming reviews. Nothing changes until you approve, and it can't delete anything."
			/>
			<Field id="ask-project" label="Project" className="mb-6 sm:w-80">
				{projects.isPending ? (
					<Skeleton className="h-11" />
				) : (
					<NativeSelect id="ask-project" value={projectId ?? ""} onChange={(e) => choose(e.target.value)}>
						<option value="" disabled>
							Choose a project
						</option>
						{list.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</NativeSelect>
				)}
			</Field>
			{projects.isError ? (
				<QueryError error={projects.error} onRetry={() => projects.refetch()} />
			) : projectId ? (
				<Conversation key={projectId} projectId={projectId} />
			) : (
				!projects.isPending && (
					<p className="rounded-md border bg-card px-4 py-6 text-muted-foreground">
						Choose a project to start. The assistant only looks at the project you pick.
					</p>
				)
			)}
		</>
	);
}

function Conversation({ projectId }: { projectId: string }) {
	const chat = useChat(projectId);
	const send = useSendChat(projectId);
	const clear = useClearChat(projectId);
	const [draft, setDraft] = useState("");
	const [clearing, setClearing] = useState(false);
	const end = useRef<HTMLDivElement>(null);
	const messages = chat.data?.messages ?? [];
	const answering = messages.some((m) => m.status === "pending") || send.isPending;

	// Keep the newest message in view as replies arrive.
	useEffect(() => {
		if (messages.length) end.current?.scrollIntoView({ block: "end" });
	}, [messages.length]);

	const submit = (text: string) => {
		const message = text.trim();
		if (!message || answering) return;
		send.mutate(message, { onSuccess: () => setDraft("") });
	};
	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		submit(draft);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			submit(draft);
		}
	};

	if (chat.isPending) {
		return (
			<div aria-busy="true" className="space-y-3">
				<Skeleton className="h-16" />
				<Skeleton className="h-24" />
			</div>
		);
	}
	if (chat.isError) return <QueryError error={chat.error} onRetry={() => chat.refetch()} />;

	return (
		<section aria-label="Conversation" className="grid gap-4">
			{messages.length === 0 ? (
				<div className="rounded-md border bg-card px-4 py-5">
					<p className="text-muted-foreground">Try asking:</p>
					<ul className="mt-3 flex flex-wrap gap-2">
						{STARTERS.map((s) => (
							<li key={s}>
								<Button variant="outline" size="sm" onClick={() => submit(s)} disabled={answering}>
									{s}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : (
				<>
					<div className="flex justify-end">
						<Button variant="ghost" size="sm" onClick={() => setClearing(true)} disabled={answering}>
							<Trash2 aria-hidden /> Clear chat
						</Button>
					</div>
					<ol className="grid gap-4" aria-live="polite">
						{messages.map((m) => (
							<li key={m.id}>
								<Message m={m} projectId={projectId} />
							</li>
						))}
					</ol>
				</>
			)}
			<div ref={end} />
			<form onSubmit={onSubmit} className="grid gap-2">
				<label htmlFor="ask-input" className="sr-only">
					Your question
				</label>
				<Textarea
					id="ask-input"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={onKeyDown}
					maxLength={4000}
					placeholder="Ask about this project…"
					className="min-h-20"
				/>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm text-muted-foreground" aria-live="polite">
						{send.isError ? (
							<span className="text-destructive">{errorMessage(send.error)}</span>
						) : answering ? (
							"Thinking…"
						) : (
							"Enter to send, Shift+Enter for a new line"
						)}
					</p>
					<Button type="submit" disabled={!draft.trim() || answering}>
						<Send aria-hidden /> Send
					</Button>
				</div>
			</form>
			<ConfirmDialog
				open={clearing}
				onOpenChange={setClearing}
				title="Clear this chat?"
				description="The conversation is removed for everyone. Changes you approved stay, and no files are touched."
				confirmLabel="Clear chat"
				pending={clear.isPending}
				onConfirm={() => clear.mutate(undefined, { onSuccess: () => setClearing(false) })}
			/>
		</section>
	);
}

function Message({ m, projectId }: { m: ChatMessage; projectId: string }) {
	if (m.role === "user") {
		return (
			<div className="ml-auto max-w-[85%] rounded-md bg-secondary px-4 py-3">
				<p className="whitespace-pre-wrap break-words">{m.content}</p>
				<p className="mt-1 text-xs text-muted-foreground">
					{m.author?.name ?? "You"} · {formatWhen(m.createdAt)}
				</p>
			</div>
		);
	}
	return (
		<div className="max-w-[95%] rounded-md border bg-card px-4 py-3">
			<p className="label-mono mb-1 flex items-center gap-1.5 text-muted-foreground">
				<Sparkles className="size-3.5" aria-hidden /> Assistant
			</p>
			{m.status === "pending" ? (
				<p className="flex items-center gap-2 text-muted-foreground">
					<Loader2 className="size-4 animate-spin" aria-hidden /> Reading the project…
				</p>
			) : m.status === "failed" ? (
				<p className="flex items-start gap-2 text-destructive">
					<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
					<span>Couldn't answer: {m.error ?? "something went wrong"}. Try asking again.</span>
				</p>
			) : (
				<>
					{m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
					{m.actions.length > 0 && (
						<ul aria-label="Suggested changes" className={cn("grid gap-2", m.content && "mt-3")}>
							{m.actions.map((a) => (
								<li key={a.id}>
									<Proposal action={a} messageId={m.id} projectId={projectId} />
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);
}

function Proposal({
	action,
	messageId,
	projectId,
}: {
	action: ChatAction;
	messageId: string;
	projectId: string;
}) {
	const decide = useDecideChatAction(projectId);
	const act = (decision: "approve" | "dismiss") =>
		decide.mutate({ messageId, actionId: action.id, decision });
	const who = action.decidedBy?.name ? ` by ${action.decidedBy.name}` : "";
	return (
		<div
			className={cn(
				"rounded-md border px-3 py-2.5",
				action.status === "proposed" ? "border-foreground/30 bg-background" : "bg-muted/40",
			)}
		>
			<p className="font-medium break-words">{action.summary}</p>
			{action.reason && <p className="mt-0.5 text-sm text-muted-foreground">{action.reason}</p>}
			{action.status === "proposed" ? (
				<div className="mt-2 flex flex-wrap gap-2">
					<Button size="sm" onClick={() => act("approve")} disabled={decide.isPending}>
						<Check aria-hidden />{" "}
						{decide.isPending && decide.variables?.decision === "approve" ? "Applying…" : "Approve"}
					</Button>
					<Button size="sm" variant="outline" onClick={() => act("dismiss")} disabled={decide.isPending}>
						<X aria-hidden /> Dismiss
					</Button>
				</div>
			) : (
				<p
					className={cn(
						"mt-1.5 flex items-center gap-1.5 text-sm",
						action.status === "applied"
							? "text-status-complete"
							: action.status === "failed"
								? "text-destructive"
								: "text-muted-foreground",
					)}
				>
					{action.status === "applied" ? (
						<>
							<Check className="size-4" aria-hidden /> Done{who}
							{action.decidedAt ? ` · ${formatWhen(action.decidedAt)}` : ""}
						</>
					) : action.status === "failed" ? (
						<>
							<CircleAlert className="size-4" aria-hidden /> Couldn't do it: {action.error}
						</>
					) : (
						<>Dismissed{who}</>
					)}
				</p>
			)}
			{action.status === "applied" && action.type === "confirm_review" && action.params.extractionId && (
				<Link
					to={`/review/${action.params.extractionId}`}
					className="mt-1 inline-block text-sm font-medium text-link underline-offset-4 hover:underline"
				>
					Open in Review
				</Link>
			)}
		</div>
	);
}
