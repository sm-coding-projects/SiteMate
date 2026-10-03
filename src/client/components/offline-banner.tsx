import { CloudOff } from "lucide-react";
import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
	window.addEventListener("online", cb);
	window.addEventListener("offline", cb);
	return () => {
		window.removeEventListener("online", cb);
		window.removeEventListener("offline", cb);
	};
};

/** Patchy 4G: say plainly when nothing will save, so a failed tick isn't a surprise. */
export function OfflineBanner() {
	const online = useSyncExternalStore(subscribe, () => navigator.onLine);
	if (online) return null;
	return (
		<div role="status" className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm md:px-10">
			<CloudOff className="size-4 shrink-0" aria-hidden />
			You're offline. You can keep looking around; changes won't save until you're back. Uploads wait and
			resume.
		</div>
	);
}
