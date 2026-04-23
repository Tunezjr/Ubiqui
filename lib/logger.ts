import { loadConfig } from './config.js';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

function emit(level: Level, msg: string, data?: unknown): void {
  const cfg = safeConfig();
  if (order[level] < order[cfg.LOG_LEVEL]) return;
  const line = { t: new Date().toISOString(), level, msg, ...(data ? { data } : {}) };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

function safeConfig(): { LOG_LEVEL: Level } {
  try {
    return { LOG_LEVEL: loadConfig().LOG_LEVEL };
  } catch {
    return { LOG_LEVEL: 'info' };
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => emit('debug', msg, data),
  info: (msg: string, data?: unknown) => emit('info', msg, data),
  warn: (msg: string, data?: unknown) => emit('warn', msg, data),
  error: (msg: string, data?: unknown) => emit('error', msg, data),
};
