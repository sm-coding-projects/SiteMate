-- last_active_at only started being recorded with 0008, so people who were active earlier fall back to
-- Clerk's last sign-in. Seed it from their latest action in the activity log. System events logged under the
-- uploader (extraction ready/failed, queue ping) are not the user's own activity, so they don't count.
UPDATE `users` SET `last_active_at` = (
	SELECT max(`created_at`) FROM `activity`
	WHERE `activity`.`actor_id` = `users`.`id`
		AND `activity`.`action` NOT IN ('extraction.ready', 'extraction.failed', 'queue.ping')
)
WHERE `last_active_at` IS NULL;
