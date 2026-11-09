export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const line = (severity: 'INFO' | 'WARNING' | 'ERROR', message: string, meta?: object) =>
  JSON.stringify({ severity, message, ...meta });

/**
 * Structured JSON lines on stdout/stderr. `severity` is the field Google Cloud
 * Logging reads, so levels show up correctly on Cloud Run.
 */
export const jsonLogger: Logger = {
  info: (message, meta) => console.info(line('INFO', message, meta)),
  warn: (message, meta) => console.warn(line('WARNING', message, meta)),
  error: (message, meta) => console.error(line('ERROR', message, meta)),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
