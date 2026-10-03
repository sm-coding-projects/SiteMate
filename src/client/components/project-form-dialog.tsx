import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
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
import { Field, Input } from "@/components/ui/input";
import { useCreateProject, useTemplates, useUpdateProject } from "@/hooks/use-data";
import { errorMessage } from "@/lib/api";
import type { ProjectDetail } from "../../shared/api-types";
import { projectCreate } from "../../shared/schemas";

const FIELDS = [
	"name",
	"siteAddress",
	"suburb",
	"clientName",
	"clientEmail",
	"clientPhone",
	"startDate",
	"targetCompletion",
] as const;
type FormState = Record<(typeof FIELDS)[number], string>;

const empty: FormState = Object.fromEntries(FIELDS.map((f) => [f, ""])) as FormState;
const fromProject = (p: ProjectDetail): FormState =>
	Object.fromEntries(FIELDS.map((f) => [f, (p[f] as string | null) ?? ""])) as FormState;

/** Create (copies the default template) or edit a project. Validates with the same Zod schema as the API. */
export function ProjectFormDialog({
	open,
	onOpenChange,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project?: ProjectDetail;
}) {
	const editing = Boolean(project);
	const [form, setForm] = useState<FormState>(() => (project ? fromProject(project) : empty));
	const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
	const [serverError, setServerError] = useState<string | null>(null);
	const templates = useTemplates();
	const create = useCreateProject();
	const update = useUpdateProject(project?.id ?? "");
	const navigate = useNavigate();
	const template = templates.data?.find((t) => t.isDefault) ?? templates.data?.[0];
	const pending = create.isPending || update.isPending;

	const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
		setForm((f) => ({ ...f, [k]: e.target.value }));

	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		setServerError(null);
		const parsed = projectCreate.safeParse(form);
		if (!parsed.success) {
			const next: typeof errors = {};
			for (const issue of parsed.error.issues) {
				const k = issue.path[0] as keyof FormState;
				next[k] ??= issue.message;
			}
			setErrors(next);
			return;
		}
		setErrors({});
		if (project) {
			update.mutate(parsed.data, {
				onSuccess: () => onOpenChange(false),
				onError: (err) => setServerError(errorMessage(err)),
			});
		} else {
			create.mutate(
				{ ...parsed.data, templateId: template?.id },
				{
					onSuccess: ({ id }) => {
						onOpenChange(false);
						setForm(empty);
						navigate(`/projects/${id}`);
					},
					onError: (err) => setServerError(errorMessage(err)),
				},
			);
		}
	};

	const field = (k: keyof FormState, label: string, props: React.ComponentProps<typeof Input> = {}) => (
		<Field id={`pf-${k}`} label={label} error={errors[k]}>
			<Input
				id={`pf-${k}`}
				value={form[k]}
				onChange={set(k)}
				aria-invalid={Boolean(errors[k])}
				aria-describedby={errors[k] ? `pf-${k}-error` : undefined}
				{...props}
			/>
		</Field>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
						<DialogDescription>
							{editing ? (
								"Site, client and dates. Stages are edited on the project page."
							) : template ? (
								<>
									Starts from <span className="font-medium text-foreground">{template.name}</span>:{" "}
									<span className="label-mono">
										{template.stageCount} stages · {template.itemCount} checks
									</span>
									. You can rename, reorder and add your own afterwards.
								</>
							) : (
								"Loading the template…"
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogBody className="grid gap-4">
						{field("name", "Project name", { autoFocus: !editing, placeholder: "14 Banksia St" })}
						{field("siteAddress", "Site address", { autoComplete: "street-address" })}
						{field("suburb", "Suburb", { autoComplete: "address-level2" })}
						<div className="grid gap-4 sm:grid-cols-2">
							{field("clientName", "Client name")}
							{field("clientPhone", "Client phone", { type: "tel", inputMode: "tel" })}
						</div>
						{field("clientEmail", "Client email", { type: "email", inputMode: "email" })}
						<div className="grid gap-4 sm:grid-cols-2">
							{field("startDate", "Start date", { type: "date" })}
							{field("targetCompletion", "Target completion", { type: "date" })}
						</div>
						{serverError && (
							<p role="alert" className="text-sm text-destructive">
								{serverError}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={pending || (!editing && !template)}>
							{pending ? "Saving…" : editing ? "Save changes" : "Create project"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
