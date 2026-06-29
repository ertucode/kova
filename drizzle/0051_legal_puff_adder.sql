CREATE TABLE `mcp_request_details` (
	`request_id` text PRIMARY KEY NOT NULL,
	`transport` text DEFAULT 'http' NOT NULL,
	`server_url` text DEFAULT '' NOT NULL,
	`selected_tool_name` text DEFAULT '' NOT NULL,
	`selected_resource_uri` text DEFAULT '' NOT NULL,
	`selected_prompt_name` text DEFAULT '' NOT NULL,
	`arguments_json` text DEFAULT '' NOT NULL,
	`introspection_json` text DEFAULT '' NOT NULL
);
