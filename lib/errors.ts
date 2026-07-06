/**
 * Application error taxonomy and API error envelope helpers.
 *
 * All error codes are sourced verbatim from docs/API.md §Error Code Reference.
 * Adding a new code requires updating that document first (per BACKEND_DESIGN.md §13).
 *
 * Route handlers call `apiError()` to produce a typed JSON response that matches
 * the error envelope contract:
 *   { code: string; message: string; details?: unknown }
 *
 * Services throw `AppError` (or its subclasses) and let the handler translate.
 *
 * @module lib/errors
 */

import { NextResponse } from "next/server";

// ─── Error Code Registry ──────────────────────────────────────────────────────
// Source of truth: docs/API.md §Error Code Reference.
// Never invent codes inline in route handlers.

/** All valid API error codes. */
export const ErrorCode = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  // Access control
  SITUATION_ACCESS_DENIED: "SITUATION_ACCESS_DENIED",
  RECOMMENDATION_ACCESS_DENIED: "RECOMMENDATION_ACCESS_DENIED",
  // Not found
  SITUATION_NOT_FOUND: "SITUATION_NOT_FOUND",
  RECOMMENDATION_NOT_FOUND: "RECOMMENDATION_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  // Validation
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_LOCATION: "INVALID_LOCATION",
  INPUT_UNPARSEABLE: "INPUT_UNPARSEABLE",
  MISSING_REQUIRED_ANSWERS: "MISSING_REQUIRED_ANSWERS",
  INVALID_ANSWER_TYPE: "INVALID_ANSWER_TYPE",
  ITEM_NOT_EXECUTABLE: "ITEM_NOT_EXECUTABLE",
  MISSING_TIME_SLOT: "MISSING_TIME_SLOT",
  FACT_NOT_EDITABLE: "FACT_NOT_EDITABLE",
  INVALID_UPDATE_PAYLOAD: "INVALID_UPDATE_PAYLOAD",
  INVALID_KEY_FORMAT: "INVALID_KEY_FORMAT",
  INVALID_VALUE_TYPE: "INVALID_VALUE_TYPE",
  INVALID_ONBOARDING_DATA: "INVALID_ONBOARDING_DATA",
  INVALID_DIET_TYPE: "INVALID_DIET_TYPE",
  // Conflict / state
  CLARIFICATION_EXPIRED: "CLARIFICATION_EXPIRED",
  INVALID_SITUATION_STATE: "INVALID_SITUATION_STATE",
  RECOMMENDATION_NOT_READY: "RECOMMENDATION_NOT_READY",
  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  ONBOARDING_LIMIT_EXCEEDED: "ONBOARDING_LIMIT_EXCEEDED",
  // Server / upstream failures
  LLM_TIMEOUT: "LLM_TIMEOUT",
  AGENT_BOOTSTRAP_FAILED: "AGENT_BOOTSTRAP_FAILED",
  SWIGGY_UNAVAILABLE: "SWIGGY_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

/** Union of all valid error code strings. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── HTTP status mapping ──────────────────────────────────────────────────────

/** Default HTTP status for each error code. Handlers may override. */
const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  SITUATION_ACCESS_DENIED: 403,
  RECOMMENDATION_ACCESS_DENIED: 403,
  SITUATION_NOT_FOUND: 404,
  RECOMMENDATION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_LOCATION: 400,
  INPUT_UNPARSEABLE: 422,
  MISSING_REQUIRED_ANSWERS: 400,
  INVALID_ANSWER_TYPE: 400,
  ITEM_NOT_EXECUTABLE: 400,
  MISSING_TIME_SLOT: 400,
  FACT_NOT_EDITABLE: 400,
  INVALID_UPDATE_PAYLOAD: 400,
  INVALID_KEY_FORMAT: 400,
  INVALID_VALUE_TYPE: 400,
  INVALID_ONBOARDING_DATA: 400,
  INVALID_DIET_TYPE: 400,
  CLARIFICATION_EXPIRED: 409,
  INVALID_SITUATION_STATE: 409,
  RECOMMENDATION_NOT_READY: 409,
  RATE_LIMIT_EXCEEDED: 429,
  ONBOARDING_LIMIT_EXCEEDED: 429,
  LLM_TIMEOUT: 504,
  AGENT_BOOTSTRAP_FAILED: 500,
  SWIGGY_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

// ─── AppError class ───────────────────────────────────────────────────────────

/**
 * Structured error thrown by services and caught by route handlers.
 *
 * Route handlers translate AppError to `apiError()` responses. Do not throw
 * raw Error objects from service code — use AppError so the handler can map
 * to the correct HTTP status and error code.
 *
 * @example
 * ```typescript
 * throw new AppError('SITUATION_NOT_FOUND', 'No situation found for that ID.');
 * ```
 */
export class AppError extends Error {
  /** Machine-readable error code from docs/API.md. */
  readonly code: ErrorCode;
  /** Default HTTP status for this code. Handlers may override. */
  readonly httpStatus: number;
  /** Optional structured details (field names, received values, etc). */
  readonly details?: unknown;

  /**
   * @param code - One of the canonical error codes from ErrorCode.
   * @param message - Human-readable description (never technical; safe to surface to users).
   * @param details - Optional structured context for the error envelope's `details` field.
   */
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

// ─── API error envelope ───────────────────────────────────────────────────────

/**
 * Shape of the JSON body returned on every API error.
 * Verbatim from docs/API.md — do not change this shape without updating the doc.
 */
export type ApiErrorEnvelope = {
  code: ErrorCode;
  message: string;
  details?: unknown;
};

/**
 * Produces a typed NextResponse JSON error matching the API error envelope spec.
 *
 * Use this in every route handler for error responses. Never construct the
 * error body manually or leak internal details (stack traces, SQL errors, etc.).
 *
 * @param code - Canonical error code; determines default HTTP status.
 * @param message - Human-readable error description safe for client display.
 * @param options.status - Override the default HTTP status for this code.
 * @param options.details - Optional structured details attached to the envelope.
 * @returns NextResponse with JSON body and correct Content-Type / status.
 *
 * @example
 * ```typescript
 * if (!userId) return apiError('UNAUTHORIZED', 'Authentication required.');
 * if (!situation) return apiError('SITUATION_NOT_FOUND', 'No situation found.', { status: 404 });
 * ```
 */
export function apiError(
  code: ErrorCode,
  message: string,
  options?: { status?: number; details?: unknown },
): NextResponse<ApiErrorEnvelope> {
  const status = options?.status ?? HTTP_STATUS[code];
  const body: ApiErrorEnvelope = { code, message };
  if (options?.details !== undefined) {
    body.details = options.details;
  }
  return NextResponse.json(body, { status });
}

/**
 * Converts an unknown caught value to an ApiErrorEnvelope response.
 *
 * Use in the outermost try-catch of a route handler to convert both AppError
 * instances and unexpected errors to a safe JSON response.
 *
 * @param err - The caught value from a try-catch block.
 * @returns NextResponse with JSON body appropriate to the error type.
 *
 * @example
 * ```typescript
 * try {
 *   // service call
 * } catch (err) {
 *   return handleRouteError(err);
 * }
 * ```
 */
export function handleRouteError(err: unknown): NextResponse<ApiErrorEnvelope> {
  if (err instanceof AppError) {
    return apiError(err.code, err.message, {
      status: err.httpStatus,
      details: err.details,
    });
  }

  // Never expose internal error details to the client.
  // The full error is logged server-side by the caller before reaching here.
  return apiError("INTERNAL_ERROR", "Something went wrong. Please try again.");
}
