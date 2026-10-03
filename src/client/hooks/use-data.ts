/** TanStack Query hooks for every API resource. Keys: ["projects", …], ["project", id, …], ["activity"], … */
import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type {
	ActivityEntry,
	AiModel,
	AiProtocol,
	AiSettings,
	AiTestResult,
	ExtractionDetail,
	ExtractionSummary,
	FileEntry,
	MeWithPreferences,
	Note,
	Page,
	ProjectDetail,
	ProjectQuotes,
	ProjectSummary,
	QuoteStatus,
	SignedUrl,
	Team,
	TemplateSummary,
} from "../../shared/api-types";
import { deriveStageStatus } from "../../shared/progress";
import type {
	ExtractionConfirm,
	ItemUpdate,
	ProjectCreate,
	ProjectListQuery,
	ProjectUpdate,
	StageUpdate,
} from "../../shared/schemas";
import { useApi } from "./use-api";

type Api = ReturnType<typeof useApi>;
const json = (body: unknown) => ({ body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | undefined>) => {
	const s = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
	const str = s.toString();
	return str ? `?${str}` : "";
};

function infinite<T>(api: Api, path: (cursor?: string) => string) {
	return {
		queryFn: ({ pageParam }: { pageParam: string | undefined }) => api<Page<T>>(path(pageParam)),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last: Page<T>) => last.nextCursor ?? undefined,
	};
}

/** Anything that changes a project also changes the projects list and the activity feeds. */
export function invalidateProject(qc: QueryClient, projectId: string) {
	return Promise.all([
		qc.invalidateQueries({ queryKey: ["project", projectId] }),
		qc.invalidateQueries({ queryKey: ["projects"] }),
		qc.invalidateQueries({ queryKey: ["activity"] }),
	]);
}

// ── Me ───────────────────────────────────────────────────────────────────────

export function usePreferences() {
	const api = useApi();
	return useQuery({ queryKey: ["me", "preferences"], queryFn: () => api<MeWithPreferences>("/me") });
}

export function useUpdatePreferences() {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: { emailNotifications: boolean }) =>
			api<MeWithPreferences>("/me/preferences", { method: "PATCH", ...json(body) }),
		onMutate: async (body) => {
			await qc.cancelQueries({ queryKey: ["me", "preferences"] });
			const prev = qc.getQueryData<MeWithPreferences>(["me", "preferences"]);
			if (prev) qc.setQueryData(["me", "preferences"], { ...prev, ...body });
			return { prev };
		},
		onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(["me", "preferences"], ctx.prev),
		onSettled: () => qc.invalidateQueries({ queryKey: ["me", "preferences"] }),
	});
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function useTemplates() {
	const api = useApi();
	return useQuery({
		queryKey: ["templates"],
		queryFn: () => api<TemplateSummary[]>("/templates"),
		staleTime: 30 * 60_000,
	});
}

export function useProjects(filters: Pick<ProjectListQuery, "status" | "q">) {
	const api = useApi();
	return useInfiniteQuery({
		queryKey: ["projects", filters],
		...infinite<ProjectSummary>(api, (cursor) => `/projects${qs({ ...filters, cursor, limit: 24 })}`),
	});
}

export function useProject(id: string | undefined) {
	const api = useApi();
	return useQuery({
		queryKey: ["project", id],
		queryFn: () => api<ProjectDetail>(`/projects/${id}`),
		enabled: Boolean(id),
	});
}

export function useCreateProject() {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: ProjectCreate) => api<{ id: string }>("/projects", { method: "POST", ...json(body) }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["projects"] });
			qc.invalidateQueries({ queryKey: ["activity"] });
		},
	});
}

export function useUpdateProject(id: string) {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: ProjectUpdate) => api(`/projects/${id}`, { method: "PATCH", ...json(body) }),
		onSuccess: () => invalidateProject(qc, id),
	});
}

export function useArchiveProject(id: string) {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () => api(`/projects/${id}/archive`, { method: "POST" }),
		onSuccess: () => invalidateProject(qc, id),
	});
}

// ── Stages & checklist ───────────────────────────────────────────────────────

/** Generic project-scoped mutation that refreshes the project afterwards. */
function useProjectMutation<V>(projectId: string, fn: (api: Api, vars: V) => Promise<unknown>) {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (vars: V) => fn(api, vars),
		onSettled: () => invalidateProject(qc, projectId),
	});
}

export const useAddStage = (projectId: string) =>
	useProjectMutation(projectId, (api, body: { name: string; description?: string | null }) =>
		api(`/projects/${projectId}/stages`, { method: "POST", ...json(body) }),
	);

export const useUpdateStage = (projectId: string) =>
	useProjectMutation(projectId, (api, { id, ...body }: StageUpdate & { id: string }) =>
		api(`/stages/${id}`, { method: "PATCH", ...json(body) }),
	);

export const useDeleteStage = (projectId: string) =>
	useProjectMutation(projectId, (api, id: string) => api(`/stages/${id}`, { method: "DELETE" }));

export const useAddItem = (projectId: string) =>
	useProjectMutation(projectId, (api, { stageId, title }: { stageId: string; title: string }) =>
		api(`/stages/${stageId}/items`, { method: "POST", ...json({ title }) }),
	);

export const useDeleteItem = (projectId: string) =>
	useProjectMutation(projectId, (api, id: string) => api(`/items/${id}`, { method: "DELETE" }));

/** Reorder optimistically: the list moves instantly, then the server confirms. */
export function useReorder(projectId: string) {
	const api = useApi();
	const qc = useQueryClient();
	const key = ["project", projectId];
	return useMutation({
		mutationFn: ({ scope, ids }: { scope: { stageId: string } | "stages"; ids: string[] }) =>
			api(
				scope === "stages"
					? `/projects/${projectId}/stages/reorder`
					: `/stages/${scope.stageId}/items/reorder`,
				{
					method: "POST",
					...json({ ids }),
				},
			),
		onMutate: async ({ scope, ids }) => {
			await qc.cancelQueries({ queryKey: key, exact: true });
			const prev = qc.getQueryData<ProjectDetail>(key);
			if (prev) {
				const order = (id: string) => ids.indexOf(id);
				qc.setQueryData<ProjectDetail>(key, {
					...prev,
					stages:
						scope === "stages"
							? [...prev.stages].sort((a, b) => order(a.id) - order(b.id))
							: prev.stages.map((s) =>
									s.id === scope.stageId
										? { ...s, items: [...s.items].sort((a, b) => order(a.id) - order(b.id)) }
										: s,
								),
				});
			}
			return { prev };
		},
		onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
		onSettled: () => invalidateProject(qc, projectId),
	});
}

/** Tick/untick and rename, applied to the cache immediately (stage status follows, same rules as the API). */
export function useUpdateItem(projectId: string, me: { id: string; name: string | null } | undefined) {
	const api = useApi();
	const qc = useQueryClient();
	const key = ["project", projectId];
	return useMutation({
		mutationFn: ({ id, ...body }: ItemUpdate & { id: string }) =>
			api(`/items/${id}`, { method: "PATCH", ...json(body) }),
		onMutate: async ({ id, ...body }) => {
			await qc.cancelQueries({ queryKey: key, exact: true });
			const prev = qc.getQueryData<ProjectDetail>(key);
			if (prev) {
				const now = Date.now();
				qc.setQueryData<ProjectDetail>(key, {
					...prev,
					stages: prev.stages.map((s) => {
						if (!s.items.some((i) => i.id === id)) return s;
						const items = s.items.map((i) =>
							i.id !== id
								? i
								: {
										...i,
										...(body.title !== undefined ? { title: body.title } : {}),
										...(body.completed !== undefined
											? {
													completedAt: body.completed ? now : null,
													completedBy: body.completed && me ? { id: me.id, name: me.name } : null,
												}
											: {}),
									},
						);
						const done = items.filter((i) => i.completedAt !== null).length;
						return { ...s, ...deriveStageStatus(s, done, items.length, now), items };
					}),
				});
			}
			return { prev };
		},
		onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
		onSettled: () => invalidateProject(qc, projectId),
	});
}

// ── Notes & activity ─────────────────────────────────────────────────────────

export function useNotes(projectId: string) {
	const api = useApi();
	return useInfiniteQuery({
		queryKey: ["project", projectId, "notes"],
		...infinite<Note>(api, (cursor) => `/projects/${projectId}/notes${qs({ cursor })}`),
	});
}

export const useAddNote = (projectId: string) =>
	useProjectMutation(projectId, (api, body: { body: string; stageId?: string | null }) =>
		api(`/projects/${projectId}/notes`, { method: "POST", ...json(body) }),
	);

export const useUpdateNote = (projectId: string) =>
	useProjectMutation(
		projectId,
		(api, { id, ...body }: { id: string; body?: string; stageId?: string | null }) =>
			api(`/notes/${id}`, { method: "PATCH", ...json(body) }),
	);

export const useDeleteNote = (projectId: string) =>
	useProjectMutation(projectId, (api, id: string) => api(`/notes/${id}`, { method: "DELETE" }));

export function useActivity(projectId?: string) {
	const api = useApi();
	return useInfiniteQuery({
		queryKey: projectId ? ["project", projectId, "activity"] : ["activity"],
		...infinite<ActivityEntry>(api, (cursor) =>
			projectId ? `/projects/${projectId}/activity${qs({ cursor })}` : `/activity${qs({ cursor })}`,
		),
	});
}

// ── Files ────────────────────────────────────────────────────────────────────

export function useFiles(
	projectId: string,
	kind: "photos" | "documents",
	filters: { stageId?: string; category?: string } = {},
) {
	const api = useApi();
	return useInfiniteQuery({
		queryKey: ["project", projectId, "files", kind, filters],
		...infinite<FileEntry>(
			api,
			(cursor) => `/projects/${projectId}/files${qs({ kind, ...filters, cursor, limit: 30 })}`,
		),
	});
}

export function useFileUrl() {
	const api = useApi();
	return useCallback(
		(fileId: string, download = false) =>
			api<SignedUrl>(`/files/${fileId}/url${download ? "?download=1" : ""}`),
		[api],
	);
}

export const useUpdateFile = (projectId: string) =>
	useProjectMutation(
		projectId,
		(
			api,
			{ id, ...body }: { id: string; caption?: string | null; stageId?: string | null; category?: string },
		) => api(`/files/${id}`, { method: "PATCH", ...json(body) }),
	);

export const useDeleteFile = (projectId: string) =>
	useProjectMutation(projectId, (api, id: string) => api(`/files/${id}`, { method: "DELETE" }));

// ── Extraction & quotes ──────────────────────────────────────────────────────

export function useExtractions(status: string, projectId?: string) {
	const api = useApi();
	return useInfiniteQuery({
		queryKey: ["extractions", status, projectId ?? null],
		...infinite<ExtractionSummary>(api, (cursor) => `/extractions${qs({ status, projectId, cursor })}`),
		// Queued/processing rows change on their own; poll gently while any are in flight.
		refetchInterval: (q) =>
			q.state.data?.pages.some((p) => p.items.some((e) => e.status === "queued" || e.status === "processing"))
				? 8000
				: false,
	});
}

export function useExtraction(id: string | undefined) {
	const api = useApi();
	return useQuery({
		queryKey: ["extraction", id],
		queryFn: () => api<ExtractionDetail>(`/extractions/${id}`),
		enabled: Boolean(id),
		refetchInterval: (q) =>
			q.state.data && (q.state.data.status === "queued" || q.state.data.status === "processing")
				? 5000
				: false,
	});
}

export function useConfirmExtraction(id: string, projectId: string | undefined) {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (body: ExtractionConfirm) =>
			api<{ quoteId: string | null }>(`/extractions/${id}/confirm`, { method: "POST", ...json(body) }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["extraction", id] });
			qc.invalidateQueries({ queryKey: ["extractions"] });
			if (projectId) invalidateProject(qc, projectId);
		},
	});
}

export function useRerunExtraction() {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api(`/extractions/${id}/rerun`, { method: "POST" }),
		onSuccess: (_d, id) => {
			qc.invalidateQueries({ queryKey: ["extraction", id] });
			qc.invalidateQueries({ queryKey: ["extractions"] });
		},
	});
}

export function useQuotes(projectId: string) {
	const api = useApi();
	return useQuery({
		queryKey: ["project", projectId, "quotes"],
		queryFn: () => api<ProjectQuotes>(`/projects/${projectId}/quotes`),
	});
}

export const useSetQuoteStatus = (projectId: string) =>
	useProjectMutation(projectId, (api, { id, status }: { id: string; status: QuoteStatus }) =>
		api(`/quotes/${id}/status`, { method: "PATCH", ...json({ status }) }),
	);

// ── Team ─────────────────────────────────────────────────────────────────────

export function useTeam() {
	const api = useApi();
	return useQuery({ queryKey: ["team"], queryFn: () => api<Team>("/admin/team") });
}

export function useTeamMutation<V>(fn: (api: Api, vars: V) => Promise<unknown>) {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (vars: V) => fn(api, vars),
		onSettled: () => qc.invalidateQueries({ queryKey: ["team"] }),
	});
}

// ── AI model (admin) ─────────────────────────────────────────────────────────

export type AiEndpointInput = { protocol: AiProtocol; baseUrl: string; apiKey?: string };

export function useAiSettings() {
	const api = useApi();
	return useQuery({ queryKey: ["ai-settings"], queryFn: () => api<AiSettings>("/admin/ai") });
}

export function useAiModels() {
	const api = useApi();
	return useMutation({
		mutationFn: (input: AiEndpointInput) =>
			api<{ models: AiModel[] }>("/admin/ai/models", { method: "POST", ...json(input) }),
	});
}

export function useTestAiModel() {
	const api = useApi();
	return useMutation({
		mutationFn: (input: AiEndpointInput & { model: string }) =>
			api<AiTestResult>("/admin/ai/test", { method: "POST", ...json(input) }),
	});
}

export function useSaveAiSettings() {
	const api = useApi();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: (AiEndpointInput & { model: string }) | null) =>
			input
				? api<AiSettings>("/admin/ai", { method: "PUT", ...json(input) })
				: api<AiSettings>("/admin/ai", { method: "DELETE" }),
		onSuccess: (data) => {
			qc.setQueryData(["ai-settings"], data);
			qc.invalidateQueries({ queryKey: ["activity"] });
		},
	});
}
