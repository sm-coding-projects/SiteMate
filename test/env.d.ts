import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Bindings } from "../src/worker/types";

declare global {
	namespace Cloudflare {
		interface Env extends Bindings {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
