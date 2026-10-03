-- Seeds the default "NSW Residential New Build" template (docs/DESIGN.md §2). Fixed ids so re-runs are no-ops.
INSERT OR IGNORE INTO `workflow_templates` (`id`, `name`, `description`, `is_default`) VALUES ('tpl_nsw_new_build', 'NSW Residential New Build', 'Default workflow for a single dwelling new build in NSW.', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_01', 'tpl_nsw_new_build', 'Pre-construction', 'Contract, insurance, approvals and site investigations before work starts.', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_01', 'tst_nsw_01', 'Signed contract', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_02', 'tst_nsw_01', 'HBCF insurance certificate', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_03', 'tst_nsw_01', 'DA/CDC approval', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_04', 'tst_nsw_01', 'Survey', 4);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_05', 'tst_nsw_01', 'Soil test', 5);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_01_06', 'tst_nsw_01', 'Engineering plans', 6);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_02', 'tpl_nsw_new_build', 'Site preparation', 'Site set-up, excavation and locating services.', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_02_01', 'tst_nsw_02', 'Site set-up & fencing', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_02_02', 'tst_nsw_02', 'Excavation', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_02_03', 'tst_nsw_02', 'Services located', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_03', 'tpl_nsw_new_build', 'Base / Slab', 'Slab preparation, inspection and pour.', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_03_01', 'tst_nsw_03', 'Pre-pour inspection (certifier)', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_03_02', 'tst_nsw_03', 'Slab pour photos', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_03_03', 'tst_nsw_03', 'Termite protection certificate', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_04', 'tpl_nsw_new_build', 'Frame', 'Wall and roof framing.', 4);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_04_01', 'tst_nsw_04', 'Frame inspection', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_04_02', 'tst_nsw_04', 'Truss certification', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_04_03', 'tst_nsw_04', 'Roof on', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_05', 'tpl_nsw_new_build', 'Lock-up', 'External envelope closed in.', 5);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_05_01', 'tst_nsw_05', 'Windows', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_05_02', 'tst_nsw_05', 'External doors', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_05_03', 'tst_nsw_05', 'Roof', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_05_04', 'tst_nsw_05', 'External cladding', 4);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_06', 'tpl_nsw_new_build', 'Fixing', 'Internal linings, joinery and wet areas.', 6);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_06_01', 'tst_nsw_06', 'Plaster', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_06_02', 'tst_nsw_06', 'Cabinetry', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_06_03', 'tst_nsw_06', 'Tiling', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_06_04', 'tst_nsw_06', 'Waterproofing certificate', 4);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_06_05', 'tst_nsw_06', 'Internal doors', 5);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_07', 'tpl_nsw_new_build', 'Practical completion', 'Final inspection and certificates.', 7);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_07_01', 'tst_nsw_07', 'Final inspection', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_07_02', 'tst_nsw_07', 'Occupation certificate', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_07_03', 'tst_nsw_07', 'Compliance certificates', 3);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_stages` (`id`, `template_id`, `name`, `description`, `position`) VALUES ('tst_nsw_08', 'tpl_nsw_new_build', 'Handover & defects', 'Keys, defects and warranty.', 8);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_08_01', 'tst_nsw_08', 'Keys handed over', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_08_02', 'tst_nsw_08', 'Defects list', 2);
--> statement-breakpoint
INSERT OR IGNORE INTO `template_items` (`id`, `template_stage_id`, `title`, `position`) VALUES ('tit_nsw_08_03', 'tst_nsw_08', 'Warranty documents', 3);
