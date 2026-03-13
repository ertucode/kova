import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
