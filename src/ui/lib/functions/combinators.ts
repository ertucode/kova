type MinimumTwo<T> = [T, T, ...T[]];

export type LogicalQuery<T> =
  | { type: "and"; conditions: MinimumTwo<LogicalQuery<T> | T> }
  | { type: "or"; conditions: MinimumTwo<LogicalQuery<T> | T> };
export type LogicalOrValue<T> = LogicalQuery<T> | T;

export const $and = <T>(
  ...arr: MinimumTwo<LogicalQuery<T> | T>
): LogicalQuery<T> => ({
  type: "and",
  conditions: arr,
});
export const $or = <T>(
  ...arr: MinimumTwo<LogicalQuery<T> | T>
): LogicalQuery<T> => ({
  type: "or",
  conditions: arr,
});
