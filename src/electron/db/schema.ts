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
    tlsVerificationMode: text('tls_verification_mode').notNull().default('inherit'),
    preRequestScript: text('pre_request_script').notNull().default(''),
    postRequestScript: text('post_request_script').notNull().default(''),
    runConfigJson: text('run_config_json').notNull().default('{"selectionMode":"tests-only","selectedRequestIds":[],"executionMode":"sequential","continueOnFailure":true}'),
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
    testScript: text('test_script').notNull().default(''),
    responseVisualizer: text('response_visualizer').notNull().default(''),
    responseTableAccessor: text('response_table_accessor').notNull().default(''),
    preferredResponseBodyView: text('preferred_response_body_view').notNull().default('raw'),
    prefersResponseVisualizer: integer('prefers_response_visualizer', { mode: 'boolean' }).notNull().default(false),
    headers: text('headers').notNull().default(''),
    body: text('body').notNull().default(''),
    bodyType: text('body_type').notNull().default('none'),
    rawType: text('raw_type').notNull().default('json'),
    graphqlQuery: text('graphql_query').notNull().default(''),
    graphqlVariables: text('graphql_variables').notNull().default(''),
    graphqlSchema: text('graphql_schema').notNull().default(''),
    websocketSubprotocols: text('websocket_subprotocols').notNull().default(''),
    websocketOnOpenMessage: text('websocket_on_open_message').notNull().default(''),
    websocketAutoSendEnabled: integer('websocket_auto_send_enabled', { mode: 'boolean' }).notNull().default(false),
    websocketAutoSendMessage: text('websocket_auto_send_message').notNull().default(''),
    websocketAutoSendIntervalSeconds: integer('websocket_auto_send_interval_seconds').notNull().default(0),
    tlsVerificationMode: text('tls_verification_mode').notNull().default('inherit'),
    saveToHistory: integer('save_to_history', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('requests_deleted_at_idx').on(table.deletedAt),
    index('requests_request_type_idx').on(table.requestType),
  ]
)

export const mcpRequestDetails = sqliteTable(
  'mcp_request_details',
  {
    requestId: text('request_id').primaryKey(),
    transport: text('transport').notNull().default('http'),
    serverUrl: text('server_url').notNull().default(''),
    accessToken: text('access_token').notNull().default(''),
    selectedToolName: text('selected_tool_name').notNull().default(''),
    selectedResourceUri: text('selected_resource_uri').notNull().default(''),
    selectedPromptName: text('selected_prompt_name').notNull().default(''),
    argumentsJson: text('arguments_json').notNull().default(''),
    introspectionJson: text('introspection_json').notNull().default(''),
  }
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    folderId: text('folder_id'),
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
    index('environments_folder_id_idx').on(table.folderId),
    index('environments_priority_idx').on(table.priority),
    index('environments_position_idx').on(table.position),
  ]
)

export const sharedScripts = sqliteTable(
  'shared_scripts',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    targetsJson: text('targets_json').notNull().default('["pre-request"]'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    code: text('code').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    foreignKey({
      columns: [table.scopeId],
      foreignColumns: [folders.id],
      name: 'shared_scripts_scope_id_fkey',
    }),
    index('shared_scripts_deleted_at_idx').on(table.deletedAt),
    index('shared_scripts_scope_idx').on(table.scopeType, table.scopeId, table.position),
    check('shared_scripts_scope_type_check', sql`${table.scopeType} in ('workspace', 'folder')`),
    check('shared_scripts_kind_check', sql`${table.kind} in ('global', 'module')`),
    check(
      'shared_scripts_workspace_scope_id_check',
      sql`(${table.scopeType} = 'workspace' and ${table.scopeId} is null) or (${table.scopeType} = 'folder' and ${table.scopeId} is not null)`
    ),
  ]
)

export const scriptPackages = sqliteTable(
  'script_packages',
  {
    id: text('id').primaryKey(),
    packageName: text('package_name').notNull(),
    packageVersion: text('package_version').notNull(),
    typesPackageName: text('types_package_name'),
    typesPackageVersion: text('types_package_version'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('script_packages_deleted_at_idx').on(table.deletedAt),
    index('script_packages_name_version_idx').on(table.packageName, table.packageVersion),
    uniqueIndex('script_packages_unique_active_idx').on(
      table.packageName,
      table.packageVersion,
      table.typesPackageName,
      table.typesPackageVersion,
      table.deletedAt
    ),
    check('script_packages_name_not_empty', sql`length(trim(${table.packageName})) > 0`),
    check('script_packages_version_not_empty', sql`length(trim(${table.packageVersion})) > 0`),
    check(
      'script_packages_types_pair_check',
      sql`(${table.typesPackageName} is null and ${table.typesPackageVersion} is null) or (${table.typesPackageName} is not null and ${table.typesPackageVersion} is not null)`
    ),
  ]
)

export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
    shortcutJson: text('shortcut_json'),
    showCodeEditor: integer('show_code_editor', { mode: 'boolean' }).notNull().default(true),
    showRuntimePreview: integer('show_runtime_preview', { mode: 'boolean' }).notNull().default(true),
    layoutMode: text('layout_mode').notNull().default('horizontal'),
    splitRatio: integer('split_ratio').notNull().default(50),
    rememberRequests: integer('remember_requests', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('views_deleted_at_idx').on(table.deletedAt),
    index('views_position_idx').on(table.position),
    check('views_name_not_empty', sql`length(trim(${table.name})) > 0`),
    check('views_layout_mode_check', sql`${table.layoutMode} in ('horizontal', 'vertical')`),
    check('views_split_ratio_check', sql`${table.splitRatio} >= 15 and ${table.splitRatio} <= 85`),
  ]
)

export const viewCacheEntries = sqliteTable(
  'view_cache_entries',
  {
    id: text('id').primaryKey(),
    viewId: text('view_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.viewId],
      foreignColumns: [views.id],
      name: 'view_cache_entries_view_id_fkey',
    }),
    index('view_cache_entries_view_id_idx').on(table.viewId),
    uniqueIndex('view_cache_entries_view_key_idx').on(table.viewId, table.key),
    check('view_cache_entries_key_not_empty', sql`length(trim(${table.key})) > 0`),
  ]
)

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('tags_deleted_at_idx').on(table.deletedAt),
    index('tags_position_idx').on(table.position),
  ]
)

export const tagAssignments = sqliteTable(
  'tag_assignments',
  {
    id: text('id').primaryKey(),
    tagId: text('tag_id').notNull(),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    foreignKey({
      columns: [table.tagId],
      foreignColumns: [tags.id],
      name: 'tag_assignments_tag_id_fkey',
    }),
    index('tag_assignments_tag_id_idx').on(table.tagId),
    index('tag_assignments_item_ref_idx').on(table.itemType, table.itemId),
    uniqueIndex('tag_assignments_tag_item_idx').on(table.tagId, table.itemType, table.itemId),
    check('tag_assignments_item_type_check', sql`${table.itemType} in ('folder', 'request')`),
  ]
)

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey(),
  warnBeforeRequestAfterSeconds: integer('warn_before_request_after_seconds').notNull().default(10),
  responseBodyDisplayMode: text('response_body_display_mode').notNull().default('raw'),
  compactRequestView: integer('compact_request_view', { mode: 'boolean' }).notNull().default(true),
  vimMode: integer('vim_mode', { mode: 'boolean' }).notNull().default(false),
  formatScriptBlocksOnSave: integer('format_script_blocks_on_save', { mode: 'boolean' }).notNull().default(true),
  scriptBlockPrettierConfig: text('script_block_prettier_config').notNull().default('{}'),
  cookiesEnabled: integer('cookies_enabled', { mode: 'boolean' }).notNull().default(true),
  supermavenEnabled: integer('supermaven_enabled', { mode: 'boolean' }).notNull().default(false),
  scriptAiModel: text('script_ai_model'),
  scriptAiServerPort: integer('script_ai_server_port'),
  requestCodeCopyBehavior: text('request_code_copy_behavior').notNull().default('resolved'),
  tlsVerificationMode: text('tls_verification_mode').notNull().default('strict'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const cookies = sqliteTable(
  'cookies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    value: text('value').notNull().default(''),
    domain: text('domain').notNull(),
    path: text('path').notNull().default('/'),
    hostOnly: integer('host_only', { mode: 'boolean' }).notNull().default(true),
    secure: integer('secure', { mode: 'boolean' }).notNull().default(false),
    httpOnly: integer('http_only', { mode: 'boolean' }).notNull().default(false),
    sameSite: text('same_site'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    uniqueIndex('cookies_identity_idx').on(table.name, table.domain, table.path, table.hostOnly),
    index('cookies_domain_idx').on(table.domain),
    index('cookies_expires_at_idx').on(table.expiresAt),
    check('cookies_name_not_empty', sql`length(trim(${table.name})) > 0`),
    check('cookies_domain_not_empty', sql`length(trim(${table.domain})) > 0`),
    check('cookies_path_not_empty', sql`length(trim(${table.path})) > 0`),
    check('cookies_same_site_check', sql`${table.sameSite} is null or ${table.sameSite} in ('strict', 'lax', 'none')`),
  ]
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

export const folderExplorerTabs = sqliteTable(
  'folder_explorer_tabs',
  {
    id: text('id').primaryKey(),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    requestMetaTab: text('request_meta_tab'),
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
  ]
)

export const requestHistory = sqliteTable(
  'request_history',
  {
    id: text('id').primaryKey(),
    folderRunId: text('folder_run_id'),
    folderRunFolderId: text('folder_run_folder_id'),
    requestId: text('request_id').notNull(),
    requestName: text('request_name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    requestHeaders: text('request_headers').notNull().default(''),
    requestBody: text('request_body').notNull().default(''),
    requestVariablesJson: text('request_variables_json').notNull().default('{}'),
    requestBodyType: text('request_body_type').notNull().default('none'),
    requestRawType: text('request_raw_type').notNull().default('json'),
    graphqlQuery: text('graphql_query').notNull().default(''),
    graphqlVariables: text('graphql_variables').notNull().default(''),
    responseStatus: integer('response_status'),
    responseStatusText: text('response_status_text'),
    responseHeaders: text('response_headers').notNull().default(''),
    responseBody: text('response_body').notNull().default(''),
    responseBodyOmitted: integer('response_body_omitted', { mode: 'boolean' }).notNull().default(false),
    responseError: text('response_error'),
    responseDurationMs: integer('response_duration_ms'),
    responseReceivedAt: integer('response_received_at'),
    scriptErrorsJson: text('script_errors_json').notNull().default('[]'),
    testRunJson: text('test_run_json').notNull().default('null'),
    consoleEntriesJson: text('console_entries_json').notNull().default('[]'),
    sentAt: integer('sent_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('request_history_created_at_idx').on(table.createdAt),
    index('request_history_request_id_idx').on(table.requestId),
    index('request_history_folder_run_id_idx').on(table.folderRunId),
    index('request_history_folder_run_folder_id_idx').on(table.folderRunFolderId),
    index('request_history_sent_at_idx').on(table.sentAt),
  ]
)

export const folderRunHistory = sqliteTable(
  'folder_run_history',
  {
    id: text('id').primaryKey(),
    folderId: text('folder_id').notNull(),
    folderName: text('folder_name').notNull(),
    runConfigJson: text('run_config_json').notNull(),
    status: text('status').notNull(),
    summaryJson: text('summary_json').notNull(),
    requestCount: integer('request_count').notNull().default(0),
    passedRequestCount: integer('passed_request_count').notNull().default(0),
    failedRequestCount: integer('failed_request_count').notNull().default(0),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    createdAt: integer('created_at').notNull(),
  },
  table => [
    index('folder_run_history_folder_id_idx').on(table.folderId),
    index('folder_run_history_started_at_idx').on(table.startedAt),
    index('folder_run_history_status_idx').on(table.status),
    check('folder_run_history_status_check', sql`${table.status} in ('running', 'completed', 'failed', 'cancelled')`),
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
    graphqlQuery: text('graphql_query').notNull().default(''),
    graphqlVariables: text('graphql_variables').notNull().default(''),
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
    index('websocket_history_messages_history_id_idx').on(table.historyId),
    index('websocket_history_messages_timestamp_idx').on(table.timestamp),
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
    index('websocket_examples_request_id_idx').on(table.requestId),
    index('websocket_examples_request_position_idx').on(table.requestId, table.position),
    index('websocket_examples_deleted_at_idx').on(table.deletedAt),
  ]
)

export const managementAgentSessions = sqliteTable(
  'import_agent_sessions',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    targetFolderId: text('target_folder_id'),
    targetRequestId: text('target_request_id'),
    title: text('title').notNull(),
    opencodeSessionId: text('opencode_session_id'),
    selectedModel: text('selected_model'),
    status: text('status').notNull().default('idle'),
    latestErrorMessage: text('latest_error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  table => [
    index('import_agent_sessions_scope_idx').on(table.scopeType, table.targetFolderId, table.targetRequestId, table.updatedAt),
    index('import_agent_sessions_deleted_at_idx').on(table.deletedAt),
  ]
)


export const managementAgentPlans = sqliteTable(
  'import_agent_plans',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    planJson: text('plan_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  table => [
    index('import_agent_plans_session_idx').on(table.sessionId, table.updatedAt),
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
    index('websocket_example_messages_example_id_idx').on(table.exampleId),
    index('websocket_example_messages_timestamp_idx').on(table.timestamp),
  ]
)
