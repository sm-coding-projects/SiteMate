import type { JobMessage } from "../shared/api-types";
import { sendNotification } from "./email";
import {
	MAX_EXTRACTION_ATTEMPTS,
	markExtractionFailed,
	markExtractionRetrying,
	PermanentError,
	runExtraction,
} from "./extract";
import type { Bindings } from "./types";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Queue consumer for `sitemate-jobs`: document extraction and notification email. Messages are handled
 * one by one; failures retry with backoff (max_retries in wrangler.jsonc), then extraction is marked failed
 * so a reviewer can re-run it.
 */
export async function handleQueue(batch: MessageBatch<JobMessage>, env: Bindings) {
	for (const msg of batch.messages) {
		const body = msg.body;
		try {
			switch (body.type) {
				case "ping":
					console.log("queue ping", { id: msg.id, ...body, attempts: msg.attempts });
					break;
				case "extract":
					await runExtraction(env, body.extractionId, msg.attempts);
					break;
				case "notify":
					await sendNotification(env, body);
					break;
				default:
					console.warn("unknown job type", body);
			}
			msg.ack();
		} catch (err) {
			const message = errorText(err);
			console.error("job failed", { type: body.type, attempts: msg.attempts, error: message });
			if (body.type === "extract") {
				if (err instanceof PermanentError || msg.attempts >= MAX_EXTRACTION_ATTEMPTS) {
					await markExtractionFailed(env, body.extractionId, message).catch((e) => console.error(e));
					msg.ack();
				} else {
					await markExtractionRetrying(env, body.extractionId, message).catch((e) => console.error(e));
					msg.retry({ delaySeconds: 30 * msg.attempts });
				}
			} else if (msg.attempts >= 3) {
				msg.ack(); // give up on email after three tries; email_log has the error
			} else {
				msg.retry({ delaySeconds: 60 * msg.attempts });
			}
		}
	}
}
