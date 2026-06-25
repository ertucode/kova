import type { Extension } from '@codemirror/state'
import { completion as graphqlCompletion, stateExtensions as graphqlStateExtensions } from 'cm6-graphql'
import type { GraphQLSchema } from 'graphql'

export function graphqlSchemaExtension(schema: GraphQLSchema | null): Extension[] {
  return [...graphqlStateExtensions(schema ?? undefined), graphqlCompletion]
}
