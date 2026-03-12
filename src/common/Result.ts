export type Result<
  T,
  E,
  TType extends string = "Result",
  TMetadata = unknown,
> = (
  | {
      data: T;
      success: true;
    }
  | {
      $type: TType;
      error: E;
      success: false;
    }
) & {
  metadata?: TMetadata;
};

export namespace Result {
  export function Success<T>(data: T): _ResultOnlyData<Result<T, never>> {
    return {
      success: true,
      data,
    } as const;
  }

  export function Error<E>(error: E): _ResultOnlyError<Result<never, E>> {
    return {
      $type,
      success: false,
      error,
    } as const;
  }

  export function ErrorTyped<E, TType extends string, TMetadata>(
    error: E,
    type: TType,
    metadata?: TMetadata,
  ): _ResultOnlyError<Result<never, E, TType>> {
    return {
      $type: type,
      success: false,
      error,
      metadata,
    } as const;
  }

  export const $type = "Result";

  export function isResult<TType extends string>(
    x: unknown,
    type: TType,
  ): x is Result<unknown, unknown, TType> {
    return typeof x === "object" && !!x && "$type" in x && x.$type === type;
  }

  export function withoutData(result: Result<unknown, any, any>) {
    return {
      ...result,
      data: undefined,
    };
  }

  export type $ResultInputTuple<
    T extends readonly unknown[],
    E,
    TType extends string,
  > = {
    [K in keyof T]: Result<T[K], E, TType>;
  };
  export function merge<A extends readonly unknown[], E, TType extends string>(
    ...results: readonly [...$ResultInputTuple<A, E, TType>]
  ): Result<A, E, TType> {
    // @ts-ignore
    if (results.every((r) => r.success))
      // @ts-ignore
      return Success(results.map((r) => r.data));

    // @ts-ignore
    return Error(results.find((r) => !r.success)!.error);
  }
}

export type ResultData<T> = Extract<T, { data: any }>["data"];
export type ResultError<T> = Extract<T, { error: any }>["error"];

export type _ResultOnlyData<T extends Result<unknown, unknown, string>> =
  Extract<T, { data: any }>;
export type ResultOnlyData<T> =
  T extends Result<unknown, unknown, string>
    ? _ResultOnlyData<T>
    : _ResultOnlyData<Result<T, unknown>>;
export type _ResultOnlyError<T extends Result<unknown, unknown, string>> =
  Extract<T, { error: any }>;
export type ResultOnlyError<T> =
  T extends Result<unknown, unknown, string>
    ? _ResultOnlyError<T>
    : _ResultOnlyError<Result<unknown, T>>;
