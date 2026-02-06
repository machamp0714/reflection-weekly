/**
 * Result type for explicit error handling
 * Inspired by Rust's Result type
 */

export type Result<T, E> = Success<T> | Failure<E>;

export interface Success<T> {
  readonly success: true;
  readonly value: T;
}

export interface Failure<E> {
  readonly success: false;
  readonly error: E;
}

export function ok<T>(value: T): Success<T> {
  return { success: true, value };
}

export function err<E>(error: E): Failure<E> {
  return { success: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Success<T> {
  return result.success;
}

export function isErr<T, E>(result: Result<T, E>): result is Failure<E> {
  return !result.success;
}

/**
 * Unwrap the value from a Result, throwing if it's an error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw new Error(`Attempted to unwrap an error result: ${JSON.stringify(result.error)}`);
}

/**
 * Unwrap the value from a Result, returning a default if it's an error
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Map the success value of a Result
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error value of a Result
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error));
  }
  return result;
}
