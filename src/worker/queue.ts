import type { JobMessage } from "../shared/api-types";
import type { Bindings } from "./types";

/** Queue consumer for `sitemate-jobs`. Step 5 adds document extraction here. */
export async function handleQueue(batch: MessageBatch<JobMessage>, _env: Bindings) {
	for (const msg of batch.messages) {
		switch (msg.body.type) {
			case "ping":
				console.log("queue ping", { id: msg.id, ...msg.body, attempts: msg.attempts });
				break;
			default:
				console.warn("unknown job type", msg.body);
		}
		msg.ack();
	}
}
