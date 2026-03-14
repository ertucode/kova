import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    preRequestScript: text('pre_request_script').notNull().default(''),
    postRequestScript: text('post_request_script').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'folders_parent_id_fkey',
    }),
    index('folders_parent_id_idx').on(table.parentId),
    index('folders_parent_position_idx').on(table.parentId, table.position),
    index('folders_deleted_at_idx').on(table.deletedAt),
    check('folders_parent_id_not_self', sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
  ]
)

export const requests = sqliteTable(
  'requests',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    method: text('method').notNull().default('GET'),
    url: text('url').notNull().default(''),
    preRequestScript: text('pre_request_script').notNull().default(''),
    postRequestScript: text('post_request_script').notNull().default(''),
    headers: text('headers').notNull().default(''),
    body: text('body').notNull().default(''),
    bodyType: text('body_type').notNull().default('none'),
    rawType: text('raw_type').notNull().default('json'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('requests_deleted_at_idx').on(table.deletedAt),
    check('requests_body_type_check', sql`${table.bodyType} in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')`),
    check('requests_raw_type_check', sql`${table.rawType} in ('json', 'text')`),
  ]
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    variables: text('variables').notNull().default(''),
    priority: integer('priority').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [index('environments_deleted_at_idx').on(table.deletedAt), index('environments_priority_idx').on(table.priority)]
)

export const treeItems = sqliteTable(
  'tree_items',
  {
    id: text('id').primaryKey(),
    parentFolderId: text('parent_folder_id'),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    foreignKey({
      columns: [table.parentFolderId],
      foreignColumns: [folders.id],
      name: 'tree_items_parent_folder_id_fkey',
    }),
    index('tree_items_parent_folder_id_idx').on(table.parentFolderId),
    index('tree_items_parent_position_idx').on(table.parentFolderId, table.position),
    index('tree_items_deleted_at_idx').on(table.deletedAt),
    uniqueIndex('tree_items_item_ref_idx').on(table.itemType, table.itemId),
    check('tree_items_item_type_check', sql`${table.itemType} in ('folder', 'request')`),
  ]
)

export const requestHistory = sqliteTable(
  'request_history',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    requestName: text('request_name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    requestHeaders: text('request_headers').notNull().default(''),
    requestBody: text('request_body').notNull().default(''),
    requestVariablesJson: text('request_variables_json').notNull().default('{}'),
    requestBodyType: text('request_body_type').notNull().default('none'),
    requestRawType: text('request_raw_type').notNull().default('json'),
    responseStatus: integer('response_status'),
    responseStatusText: text('response_status_text'),
    responseHeaders: text('response_headers').notNull().default(''),
    responseBody: text('response_body').notNull().default(''),
    responseBodyOmitted: integer('response_body_omitted', { mode: 'boolean' }).notNull().default(false),
    responseError: text('response_error'),
    responseDurationMs: integer('response_duration_ms'),
    responseReceivedAt: integer('response_received_at'),
    scriptErrorsJson: text('script_errors_json').notNull().default('[]'),
    consoleEntriesJson: text('console_entries_json').notNull().default('[]'),
    sentAt: integer('sent_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('request_history_created_at_idx').on(table.createdAt),
    index('request_history_request_id_idx').on(table.requestId),
    index('request_history_sent_at_idx').on(table.sentAt),
  ]
)
