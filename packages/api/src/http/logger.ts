export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Structured JSON lines on stdout/stderr — easy to ship to any log aggregator. */
export const jsonLogger: Logger = {
  info: (message, meta) => console.info(JSON.stringify({ level: 'info', message, ...meta })),
  warn: (message, meta) => console.warn(JSON.stringify({ level: 'warn', message, ...meta })),
  error: (message, meta) => console.error(JSON.stringify({ level: 'error', message, ...meta })),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
