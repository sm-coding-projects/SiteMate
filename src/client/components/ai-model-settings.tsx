import { CircleCheck, RefreshCw, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryError } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAiModels, useAiSettings, useSaveAiSettings, useTestAiModel } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AiModel, AiProtocol, AiSettings } from "../../shared/api-types";

const PROTOCOLS = [
	{ value: "openai", label: "OpenAI‑compatible" },
	{ value: "anthropic", label: "Anthropic‑compatible" },
] as const satisfies readonly { value: AiProtocol; label: string }[];

/** MiniMax token plan base URLs, one per wire format. */
const MINIMAX: Record<AiProtocol, string> = {
	openai: "https://api.minimax.io/v1",
	anthropic: "https://api.minimax.io/anthropic",
};
const PREFERRED_MODEL = "MiniMax-M3";

const hostOf = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
};

/** Admin-only (Account page): point every AI call at a custom endpoint and model, or go back to the default. */
export function AiModelSettings() {
	const settings = useAiSettings();
	if (settings.isPending) return <Skeleton className="h-64" />;
	if (settings.isError) return <QueryError error={settings.error} onRetry={() => settings.refetch()} />;
	// Remount the form when the saved config changes, so it starts from what's stored.
	return <AiModelForm key={settings.data.custom?.updatedAt ?? "default"} settings={settings.data} />;
}

function AiModelForm({ settings }: { settings: AiSettings }) {
	const id = useId();
	const saved = settings.custom;
	const [protocol, setProtocol] = useState<AiProtocol>(saved?.protocol ?? "openai");
	const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? MINIMAX.openai);
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState(saved?.model ?? "");
	const [models, setModels] = useState<AiModel[] | null>(null);
	const [typing, setTyping] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);

	const fetchModels = useAiModels();
	const test = useTestAiModel();
	const save = useSaveAiSettings();

	// The saved key is only reused for the host it was saved for (the API enforces the same rule).
	const keyRequired = !saved || hostOf(saved.baseUrl) !== hostOf(baseUrl);
	const endpoint = { protocol, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined };
	const canCall = Boolean(hostOf(baseUrl)) && (!keyRequired || Boolean(endpoint.apiKey));
	const canSave = canCall && model.trim().length > 0 && settings.canStoreKeys;

	// A different endpoint means a different model list and an untested model.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on endpoint change only
	useEffect(() => {
		setModels(null);
		fetchModels.reset();
		test.reset();
	}, [protocol, baseUrl]);

	function switchProtocol(next: AiProtocol) {
		// Swap MiniMax's URL along with the format; leave any other URL alone.
		if (baseUrl === MINIMAX[protocol]) setBaseUrl(MINIMAX[next]);
		setProtocol(next);
	}

	function loadModels() {
		test.reset();
		fetchModels.mutate(endpoint, {
			onSuccess: ({ models: list }) => {
				setModels(list);
				setTyping(list.length === 0);
				if (!list.some((m) => m.id === model)) {
					setModel(list.find((m) => m.id === PREFERRED_MODEL)?.id ?? list[0]?.id ?? model);
				}
			},
			onError: () => setTyping(true),
		});
	}

	function onSubmit(e: FormEvent) {
		e.preventDefault();
		if (!canSave) return;
		save.mutate({ ...endpoint, model: model.trim() });
	}

	const showSelect = models !== null && models.length > 0 && !typing;

	return (
		<div className="grid gap-6">
			<ActiveModel settings={settings} />

			{!settings.canStoreKeys && (
				<p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
					The Worker secret <code className="label-mono">SETTINGS_ENCRYPTION_KEY</code> isn't set, so an API
					key can't be stored yet. You can still fetch models and test the connection.
				</p>
			)}

			<form onSubmit={onSubmit} className="grid gap-5" noValidate>
				<fieldset className="grid gap-1.5">
					<legend className="mb-1.5 text-sm font-medium">API format</legend>
					<div role="radiogroup" className="inline-flex w-fit rounded-md border bg-muted p-0.5">
						{PROTOCOLS.map((p) => (
							// biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
							<button
								key={p.value}
								type="button"
								role="radio"
								aria-checked={protocol === p.value}
								onClick={() => switchProtocol(p.value)}
								className={cn(
									"inline-flex h-11 items-center rounded-[calc(var(--radius)-2px)] px-3 text-sm font-medium transition-colors duration-[120ms] ease-enter pointer-fine:h-8",
									protocol === p.value
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{p.label}
							</button>
						))}
					</div>
				</fieldset>

				<Field
					id={`${id}-url`}
					label="Base URL"
					hint={
						<>
							MiniMax token plan: <code className="font-mono text-[0.8125rem]">{MINIMAX[protocol]}</code>
							{baseUrl !== MINIMAX[protocol] && (
								<Button
									type="button"
									variant="link"
									size="sm"
									className="ml-1 h-auto p-0 pointer-fine:h-auto"
									onClick={() => setBaseUrl(MINIMAX[protocol])}
								>
									Use it
								</Button>
							)}
						</>
					}
				>
					<Input
						id={`${id}-url`}
						type="url"
						inputMode="url"
						autoComplete="off"
						spellCheck={false}
						value={baseUrl}
						onChange={(e) => setBaseUrl(e.target.value)}
						aria-describedby={`${id}-url-hint`}
					/>
				</Field>

				<Field
					id={`${id}-key`}
					label="API key"
					hint={
						keyRequired
							? saved
								? "The saved key is only used with its own endpoint. Paste the key for this one."
								: "Stored encrypted. It's never shown again or sent to the browser."
							: `Saved key ending ${saved?.keyHint}. Leave blank to keep it.`
					}
				>
					<Input
						id={`${id}-key`}
						type="password"
						autoComplete="new-password"
						spellCheck={false}
						placeholder={keyRequired ? "" : `•••• ${saved?.keyHint}`}
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						aria-describedby={`${id}-key-hint`}
					/>
				</Field>

				<div className="grid gap-1.5">
					<div className="flex items-end justify-between gap-3">
						<label htmlFor={`${id}-model`} className="text-sm font-medium">
							Model
						</label>
						<div className="flex gap-1">
							{models !== null && models.length > 0 && (
								<Button type="button" variant="ghost" size="sm" onClick={() => setTyping((t) => !t)}>
									{typing ? "Pick from list" : "Type an ID"}
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!canCall || fetchModels.isPending}
								onClick={loadModels}
							>
								<RefreshCw aria-hidden className={cn(fetchModels.isPending && "animate-spin")} />
								{models === null ? "Fetch models" : "Refresh"}
							</Button>
						</div>
					</div>
					{showSelect ? (
						<NativeSelect id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)}>
							{!models.some((m) => m.id === model) && model && <option value={model}>{model}</option>}
							{models.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
								</option>
							))}
						</NativeSelect>
					) : (
						<Input
							id={`${id}-model`}
							autoComplete="off"
							spellCheck={false}
							placeholder={PREFERRED_MODEL}
							value={model}
							onChange={(e) => setModel(e.target.value)}
						/>
					)}
					<p className="text-sm text-muted-foreground" aria-live="polite">
						{fetchModels.isError ? (
							<span className="text-destructive">{errorMessage(fetchModels.error)}</span>
						) : models !== null ? (
							`${models.length} model${models.length === 1 ? "" : "s"} available.`
						) : (
							"Fetch the list from the endpoint, or type the model ID."
						)}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<Button type="submit" disabled={!canSave || save.isPending}>
						{save.isPending ? "Saving…" : "Save and use everywhere"}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={!canCall || !model.trim() || test.isPending}
						onClick={() => test.mutate({ ...endpoint, model: model.trim() })}
					>
						{test.isPending ? "Testing…" : "Test connection"}
					</Button>
					{saved && (
						<Button
							type="button"
							variant="ghost"
							className="text-muted-foreground"
							onClick={() => setConfirmReset(true)}
						>
							<RotateCcw aria-hidden /> Use the default
						</Button>
					)}
				</div>
				<p className="-mt-2 text-sm" aria-live="polite">
					{save.isError ? (
						<span className="text-destructive">{errorMessage(save.error)}</span>
					) : test.isError ? (
						<span className="text-destructive">{errorMessage(test.error)}</span>
					) : test.isSuccess ? (
						<span className="inline-flex items-center gap-1.5">
							<CircleCheck className="size-4 text-survey" aria-hidden />
							{test.data.model} replied in {(test.data.latencyMs / 1000).toFixed(1)}s
						</span>
					) : null}
				</p>
			</form>

			<ConfirmDialog
				open={confirmReset}
				onOpenChange={setConfirmReset}
				title="Go back to the default model?"
				description="The saved API key is deleted. New documents are read by the built-in default model."
				confirmLabel="Use the default"
				destructive
				pending={save.isPending}
				onConfirm={() => save.mutate(null, { onSuccess: () => setConfirmReset(false) })}
			/>
		</div>
	);
}

function ActiveModel({ settings }: { settings: AiSettings }) {
	const { active, custom } = settings;
	return (
		<div className="rounded-md border bg-card px-4 py-3">
			<p className="label-mono text-muted-foreground">In use for every AI task</p>
			<p className="mt-1 font-medium break-all">{active.model}</p>
			<p className="text-sm text-muted-foreground">
				{custom
					? `${hostOf(custom.baseUrl)} · ${custom.protocol === "anthropic" ? "Anthropic" : "OpenAI"} format · saved ${formatWhen(custom.updatedAt)}`
					: `Built-in default (${active.provider})`}
			</p>
		</div>
	);
}
