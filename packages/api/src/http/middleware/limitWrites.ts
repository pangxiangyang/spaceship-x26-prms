import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { actorOf } from './authenticate';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Caps how many changes each signed-in account can make per window, whatever address it
 * comes from. The demo publishes its sign-in details, so this bounds how much one visitor
 * (or script) can write, and therefore what it can cost, before the daily reset.
 * Mount after `authenticate`. Reads are not limited.
 */
export function limitWrites(options: { windowMs: number; max: number }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => READS.has(req.method),
    keyGenerator: (_req, res) => actorOf(res).userId,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many changes in a short time. Try again later.',
        },
      });
    },
  });
}
