import { useSyncExternalStore } from "react";
import { uploadQueue } from "@/lib/upload-queue";

export function useUploads(projectId?: string) {
	const jobs = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
	return projectId ? jobs.filter((j) => j.projectId === projectId) : jobs;
}
