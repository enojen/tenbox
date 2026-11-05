CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`tenbox` text NOT NULL,
	`at` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
