import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    headers: text('headers').notNull().default(''),
    authJson: text('auth_json').notNull().default('{"type":"inherit"}'),
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
    requestType: text('request_type').notNull().default('http'),
    method: text('method').notNull().default('GET'),
    url: text('url').notNull().default(''),
    pathParams: text('path_params').notNull().default(''),
    searchParams: text('search_params').notNull().default(''),
    authJson: text('auth_json').notNull().default('{"type":"inherit"}'),
    preRequestScript: text('pre_request_script').notNull().default(''),
    postRequestScript: text('post_request_script').notNull().default(''),
    responseVisualizer: text('response_visualizer').notNull().default(''),
    responseTableAccessor: text('response_table_accessor').notNull().default(''),
    preferredResponseBodyView: text('preferred_response_body_view').notNull().default('raw'),
    // Legacy column kept to avoid destructive table rebuild migration. Unused by app code.
    prefersResponseVisualizer: integer('prefers_response_visualizer', { mode: 'boolean' }).notNull().default(false),
    headers: text('headers').notNull().default(''),
    body: text('body').notNull().default(''),
    bodyType: text('body_type').notNull().default('none'),
    rawType: text('raw_type').notNull().default('json'),
    websocketSubprotocols: text('websocket_subprotocols').notNull().default(''),
    saveToHistory: integer('save_to_history', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('requests_deleted_at_idx').on(table.deletedAt),
    index('requests_request_type_idx').on(table.requestType),
    check('requests_request_type_check', sql`${table.requestType} in ('http', 'websocket')`),
    check('requests_body_type_check', sql`${table.bodyType} in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')`),
    check('requests_raw_type_check', sql`${table.rawType} in ('json', 'text')`),
    check('requests_preferred_response_body_view_check', sql`${table.preferredResponseBodyView} in ('raw', 'table', 'visualizer')`),
  ]
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    variables: text('variables').notNull().default(''),
    color: text('color'),
    warnOnRequest: integer('warn_on_request', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('environments_deleted_at_idx').on(table.deletedAt),
    index('environments_priority_idx').on(table.priority),
    index('environments_position_idx').on(table.position),
  ]
)

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  warnBeforeRequestAfterSeconds: integer('warn_before_request_after_seconds').notNull().default(10),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

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

export const folderExplorerTabs = sqliteTable(
  'folder_explorer_tabs',
  {
    id: text('id').primaryKey(),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    position: integer('position').notNull().default(0),
    isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('folder_explorer_tabs_position_idx').on(table.position),
    index('folder_explorer_tabs_item_ref_idx').on(table.itemType, table.itemId),
    index('folder_explorer_tabs_active_idx').on(table.isActive),
    check('folder_explorer_tabs_item_type_check', sql`${table.itemType} in ('folder', 'request', 'example')`),
  ]
)

export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey(),
    operationType: text('operation_type').notNull(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    metadataJson: text('metadata_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    completedAt: integer('completed_at'),
    undoneAt: integer('undone_at'),
  },
  table => [
    index('operations_created_at_idx').on(table.createdAt),
    index('operations_operation_type_idx').on(table.operationType),
    index('operations_status_idx').on(table.status),
    check('operations_status_check', sql`${table.status} in ('active', 'undone', 'failed')`),
    check('operations_type_check', sql`${table.operationType} in ('delete-folder', 'delete-request')`),
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

export const requestExamples = sqliteTable(
  'request_examples',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    requestHeaders: text('request_headers').notNull().default(''),
    requestBody: text('request_body').notNull().default(''),
    requestBodyType: text('request_body_type').notNull().default('none'),
    requestRawType: text('request_raw_type').notNull().default('json'),
    responseStatus: integer('response_status').notNull().default(200),
    responseStatusText: text('response_status_text').notNull().default('OK'),
    responseHeaders: text('response_headers').notNull().default(''),
    responseBody: text('response_body').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('request_examples_request_id_idx').on(table.requestId),
    index('request_examples_request_position_idx').on(table.requestId, table.position),
    index('request_examples_deleted_at_idx').on(table.deletedAt),
    check('request_examples_request_body_type_check', sql`${table.requestBodyType} in ('raw', 'form-data', 'x-www-form-urlencoded', 'none')`),
    check('request_examples_request_raw_type_check', sql`${table.requestRawType} in ('json', 'text')`),
  ]
)

export const websocketSavedMessages = sqliteTable(
  'websocket_saved_messages',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    body: text('body').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    foreignKey({
      columns: [table.requestId],
      foreignColumns: [requests.id],
      name: 'websocket_saved_messages_request_id_fkey',
    }),
    index('websocket_saved_messages_request_id_idx').on(table.requestId),
    index('websocket_saved_messages_deleted_at_idx').on(table.deletedAt),
  ]
)

export const websocketHistory = sqliteTable(
  'websocket_history',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    requestName: text('request_name').notNull(),
    url: text('url').notNull(),
    requestHeaders: text('request_headers').notNull().default(''),
    requestVariablesJson: text('request_variables_json').notNull().default('{}'),
    historySizeBytes: integer('history_size_bytes').notNull().default(0),
    connectedAt: integer('connected_at').notNull(),
    disconnectedAt: integer('disconnected_at'),
    closeCode: integer('close_code'),
    closeReason: text('close_reason'),
    responseError: text('response_error'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.requestId],
      foreignColumns: [requests.id],
      name: 'websocket_history_request_id_fkey',
    }),
    index('websocket_history_created_at_idx').on(table.createdAt),
    index('websocket_history_request_id_idx').on(table.requestId),
    index('websocket_history_connected_at_idx').on(table.connectedAt),
  ]
)

export const websocketHistoryMessages = sqliteTable(
  'websocket_history_messages',
  {
    id: text('id').primaryKey(),
    historyId: text('history_id').notNull(),
    direction: text('direction').notNull(),
    body: text('body').notNull().default(''),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.historyId],
      foreignColumns: [websocketHistory.id],
      name: 'websocket_history_messages_history_id_fkey',
    }),
    index('websocket_history_messages_history_id_idx').on(table.historyId),
    index('websocket_history_messages_timestamp_idx').on(table.timestamp),
    check('websocket_history_messages_direction_check', sql`${table.direction} in ('sent', 'received')`),
  ]
)

export const websocketExamples = sqliteTable(
  'websocket_examples',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    requestHeaders: text('request_headers').notNull().default(''),
    requestBody: text('request_body').notNull().default(''),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    foreignKey({
      columns: [table.requestId],
      foreignColumns: [requests.id],
      name: 'websocket_examples_request_id_fkey',
    }),
    index('websocket_examples_request_id_idx').on(table.requestId),
    index('websocket_examples_request_position_idx').on(table.requestId, table.position),
    index('websocket_examples_deleted_at_idx').on(table.deletedAt),
  ]
)

export const websocketExampleMessages = sqliteTable(
  'websocket_example_messages',
  {
    id: text('id').primaryKey(),
    exampleId: text('example_id').notNull(),
    direction: text('direction').notNull(),
    body: text('body').notNull().default(''),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    timestamp: integer('timestamp').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.exampleId],
      foreignColumns: [websocketExamples.id],
      name: 'websocket_example_messages_example_id_fkey',
    }),
    index('websocket_example_messages_example_id_idx').on(table.exampleId),
    index('websocket_example_messages_timestamp_idx').on(table.timestamp),
    check('websocket_example_messages_direction_check', sql`${table.direction} in ('sent', 'received')`),
  ]
)
