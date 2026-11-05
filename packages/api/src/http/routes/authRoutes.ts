import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContainer } from '../../bootstrap/container';
import { presentUser } from '../presenters';
import { parse } from '../validation';

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export function authRoutes({ auth, config }: AppContainer): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMs,
    limit: config.loginRateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' },
      });
    },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = parse(loginBody, req.body);
    const result = await auth.login(username, password);
    res.json({ token: result.token, expiresIn: result.expiresIn, user: presentUser(result.user) });
  });

  return router;
}
