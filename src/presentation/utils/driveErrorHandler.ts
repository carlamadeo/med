import { DriveConflictError, DriveSessionError } from '@data';
import { setError } from '../state/store';

export interface DriveErrorHandlers {
  onSessionLost?: () => void;
  onConflict?: () => void;
  onError?: (message: string) => void;
  finally?: () => void;
}

export function handleDriveError(
  err: unknown,
  handlers: DriveErrorHandlers = {}
): void {
  if (err instanceof DriveSessionError) {
    handlers.onSessionLost?.();
    const message = err instanceof Error ? err.message : 'Volvé a conectar Google Drive para continuar.';
    handlers.onError?.(message);
  } else if (err instanceof DriveConflictError) {
    handlers.onConflict?.();
    const message = err instanceof Error ? err.message : 'Este estudio cambió en Drive. Cerrá la ficha y actualizá la lista antes de volver a editar.';
    handlers.onError?.(message);
  } else {
    const message = err instanceof Error ? err.message : 'Operación fallida.';
    handlers.onError?.(message);
  }
  handlers.finally?.();
}

export function createDriveErrorHandler(
  defaultErrorMessage: string,
  additionalHandlers: {
    onSessionLost?: () => void;
    onConflict?: () => void;
  } = {}
) {
  return (err: unknown) => {
    handleDriveError(err, {
      onError: (message) => setError(message || defaultErrorMessage),
      onSessionLost: additionalHandlers.onSessionLost,
      onConflict: additionalHandlers.onConflict,
    });
  };
}

export async function withDriveErrorHandling<T>(
  operation: () => Promise<T>,
  handlers: DriveErrorHandlers = {}
): Promise<T | null> {
  try {
    return await operation();
  } catch (err) {
    handleDriveError(err, handlers);
    return null;
  } finally {
    handlers.finally?.();
  }
}