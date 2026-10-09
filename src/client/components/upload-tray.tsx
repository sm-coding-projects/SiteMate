import { useAuth, useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CloudOff, RotateCcw, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUploads } from "@/hooks/use-uploads";
import { formatBytes } from "@/lib/format";
import { OwnerChanged, uploadQueue } from "@/lib/upload-queue";
import { cn } from "@/lib/utils";

/**
 * Pauses the upload queue when its user signs out or switches account, whichever route that happens
 * on. Rendered once at the app root, outside the router.
 */
export function UploadQueueOwner() {
	const { userId } = useAuth();
	useEffect(() => {
		if (!userId) return;
		return () => uploadQueue.stop(userId);
	}, [userId]);
	return null;
}

/**
 * Starts the persistent upload queue and shows what's in flight. Sits above the mobile tab bar so it
 * stays visible while the user keeps working.
 */
export function UploadTray() {
	const { getToken, userId } = useAuth();
	const clerk = useClerk();
	const qc = useQueryClient();
	const jobs = useUploads();
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!userId) return;
		void uploadQueue.start(
			userId,
			async () => {
				const token = await getToken();
				// Never send this user's uploads as whoever signed in after them, not even via the session cookie.
				if (clerk.user?.id !== userId) throw new OwnerChanged("Signed out");
				return token;
			},
			(projectId) => {
				qc.invalidateQueries({ queryKey: ["project", projectId] });
				qc.invalidateQueries({ queryKey: ["projects"] });
				qc.invalidateQueries({ queryKey: ["activity"] });
				qc.invalidateQueries({ queryKey: ["extractions"] });
			},
		);
	}, [getToken, userId, clerk, qc]);

	if (jobs.length === 0) return null;
	const failed = jobs.filter((j) => j.status === "failed").length;
	const waiting = jobs.some((j) => j.status === "waiting");
	const active = jobs.find((j) => j.status === "uploading");
	const overall = jobs.reduce((n, j) => n + j.progress, 0) / jobs.length;

	return (
		<section
			className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-md border bg-popover shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
			aria-label="Uploads"
		>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left"
			>
				{failed ? (
					<TriangleAlert className="size-5 text-destructive" aria-hidden />
				) : waiting ? (
					<CloudOff className="size-5 text-muted-foreground" aria-hidden />
				) : (
					<Upload className="size-5" aria-hidden />
				)}
				<span className="min-w-0 flex-1" aria-live="polite">
					<span className="block text-sm font-medium">
						{failed
							? `${failed} upload${failed === 1 ? "" : "s"} need attention`
							: waiting
								? "Waiting for signal — uploads will resume"
								: `Uploading ${jobs.length} file${jobs.length === 1 ? "" : "s"}`}
					</span>
					<span className="label-mono block truncate text-muted-foreground">
						{active ? active.filename : `${Math.round(overall * 100)}%`}
					</span>
				</span>
				<ChevronDown
					className={cn("size-5 transition-transform duration-200", open && "rotate-180")}
					aria-hidden
				/>
			</button>
			<div className="h-1 bg-border" aria-hidden>
				<div
					className="h-full bg-foreground transition-[width] duration-200"
					style={{ width: `${overall * 100}%` }}
				/>
			</div>
			{open && (
				<ul className="max-h-72 divide-y overflow-y-auto">
					{jobs.map((j) => (
						<li key={j.id} className="flex items-center gap-2 px-4 py-2">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm">{j.filename}</p>
								<p
									className={cn(
										"text-xs",
										j.status === "failed" ? "text-destructive" : "text-muted-foreground",
									)}
								>
									{j.status === "uploading"
										? `${Math.round(j.progress * 100)}% of ${formatBytes(j.blob.size)}`
										: j.status === "queued"
											? `Queued · ${formatBytes(j.blob.size)}`
											: (j.error ?? j.status)}
								</p>
							</div>
							{(j.status === "failed" || j.status === "waiting") && (
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Retry ${j.filename}`}
									onClick={() => uploadQueue.retry(j.id)}
								>
									<RotateCcw aria-hidden />
								</Button>
							)}
							{j.status !== "uploading" && (
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Cancel ${j.filename}`}
									onClick={() => uploadQueue.dismiss(j.id)}
								>
									<X aria-hidden />
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
