CREATE TABLE `document_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`detected_type` text,
	`fields` text,
	`validation` text,
	`confidence` integer,
	`provider` text,
	`model` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_extractions_file_idx` ON `document_extractions` (`file_id`);--> statement-breakpoint
CREATE INDEX `document_extractions_status_created_idx` ON `document_extractions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`intended_to` text NOT NULL,
	`sent_to` text,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_log_created_idx` ON `email_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_stage_id` text,
	`category` text NOT NULL,
	`r2_key` text NOT NULL,
	`thumb_key` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`caption` text,
	`upload_status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_stage_id`) REFERENCES `project_stages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_project_category_created_idx` ON `files` (`project_id`,`category`,`created_at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_stage_id` text,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_stage_id`) REFERENCES `project_stages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_project_created_idx` ON `notes` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_stage_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`source` text DEFAULT 'custom' NOT NULL,
	`completed_at` integer,
	`completed_by` text,
	FOREIGN KEY (`project_stage_id`) REFERENCES `project_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_items_stage_pos_idx` ON `project_items` (`project_stage_id`,`position`);--> statement-breakpoint
CREATE TABLE `project_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`source` text DEFAULT 'custom' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_stages_project_pos_idx` ON `project_stages` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`site_address` text,
	`suburb` text,
	`client_name` text,
	`client_email` text,
	`client_phone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`target_completion` text,
	`template_id` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_status_updated_idx` ON `projects` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `projects_updated_idx` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file_id` text,
	`supplier_id` text,
	`trade` text,
	`quote_number` text,
	`quote_date` text,
	`valid_until` text,
	`amount_ex_gst_cents` integer NOT NULL,
	`gst_cents` integer NOT NULL,
	`amount_inc_gst_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`extraction_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`extraction_id`) REFERENCES `document_extractions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quotes_project_status_idx` ON `quotes` (`project_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_extraction_uq` ON `quotes` (`extraction_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`abn` text,
	`trade` text,
	`email` text,
	`phone` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_abn_uq` ON `suppliers` (`abn`);--> statement-breakpoint
CREATE INDEX `suppliers_name_idx` ON `suppliers` (`name`);--> statement-breakpoint
CREATE TABLE `template_items` (
	`id` text PRIMARY KEY NOT NULL,
	`template_stage_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`template_stage_id`) REFERENCES `template_stages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_items_stage_pos_idx` ON `template_items` (`template_stage_id`,`position`);--> statement-breakpoint
CREATE TABLE `template_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `workflow_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_stages_template_pos_idx` ON `template_stages` (`template_id`,`position`);--> statement-breakpoint
CREATE TABLE `workflow_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity` (`created_at`);