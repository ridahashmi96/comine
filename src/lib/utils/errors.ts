import { toast } from '$lib/components/Toast.svelte';
import { logs } from '$lib/stores/logs';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorHandlerOptions {
  showToast?: boolean;
  logError?: boolean;
  toastMessage?: string;
  logContext?: string;
}

export function handleError(error: unknown, options: ErrorHandlerOptions = {}): AppError {
  const { showToast = true, logError = true, toastMessage, logContext = 'app' } = options;

  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof Error) {
    appError = new AppError(error.message, 'UNKNOWN_ERROR', undefined, error);
  } else {
    appError = new AppError(String(error), 'UNKNOWN_ERROR', undefined, error);
  }

  if (logError) {
    logs.error(
      logContext,
      `${appError.code}: ${appError.message}${
        appError.context ? ` | Context: ${JSON.stringify(appError.context)}` : ''
      }`
    );
  }

  if (showToast) {
    const message = toastMessage || appError.message;
    toast.error(message);
  }

  return appError;
}

export function createError(
  message: string,
  code: string,
  context?: Record<string, unknown>
): AppError {
  return new AppError(message, code, context);
}

export function wrapAsync<T>(
  fn: () => Promise<T>,
  errorOptions?: ErrorHandlerOptions
): Promise<T | null> {
  return fn().catch((error) => {
    handleError(error, errorOptions);
    return null;
  });
}

export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    logs.warn('parse', `Invalid JSON: ${error}`);
    return fallback;
  }
}
