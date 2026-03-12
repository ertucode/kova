import { errorToString } from "./errorToString.js";
import { _ResultOnlyError, Result } from "./Result.js";

export type GenericError =
  | {
      type: "unknown";
      error: unknown;
    }
  | {
      type: "message";
      message: string;
    }
  | {
      type: "http";
      status: number;
      message: string;
    };

export namespace GenericError {
  export function Unknown(error: unknown) {
    return Result.ErrorTyped(
      {
        type: "unknown",
        error,
      } as const,
      GenericError.$type,
    );
  }

  export function Message(message: string) {
    return Result.ErrorTyped(
      {
        type: "message",
        message,
      } as const,
      GenericError.$type,
    );
  }

  export function Http(
    status: number,
    message: string,
    metadata?: { headers?: Record<string, string> },
  ) {
    return Result.ErrorTyped(
      {
        type: "http",
        status,
        message,
        metadata,
      } as const,
      GenericError.$type,
    );
  }

  export function isGenericErrorResult(
    x: unknown,
  ): x is _ResultOnlyError<
    Result<never, GenericError, (typeof GenericError)["$type"]>
  > {
    return Result.isResult(x, GenericError.$type);
  }

  export function isHttpError(
    x: unknown,
  ): x is ReturnType<typeof GenericError.Http> {
    return isGenericErrorResult(x) && x.error.type === "http";
  }

  export const $type = "GenericError";

  export type ResultType = _ResultOnlyError<
    Result<never, GenericError, (typeof GenericError)["$type"]>
  >;
}

export type GenericResult<T> = Result<
  T,
  GenericError,
  (typeof GenericError)["$type"]
>;

export function errorResponseToMessage(error: GenericError) {
  if (error.type === "message") {
    return error.message;
  }
  if (error.type === "http") {
    return `${error.status}: ${error.message}`;
  }

  if (error.type === "unknown") {
    return errorToString(error.error);
  }

  // TODO
  return "Unknown error";
}

export function throwJsError(result: GenericError.ResultType): never {
  throw new Error(errorResponseToMessage(result.error));
}

export function convertToThrowing<TResult, TIn extends any[]>(
  fn: (...params: TIn) => Promise<GenericResult<TResult>>,
): (...params: TIn) => Promise<TResult> {
  return async (...params: TIn) => {
    const result = await fn(...params);
    if (!result.success) throwJsError(result);
    return result.data;
  };
}
