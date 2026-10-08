CREATE TABLE `ai_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`author_id` text,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	`actions` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_chat_messages_project_idx` ON `ai_chat_messages` (`project_id`,`created_at`);