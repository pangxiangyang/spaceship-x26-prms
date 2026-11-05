import type { RequestHandler, Response } from 'express';
import type { Actor, Role } from '@prms/domain';
import { AuthenticationError } from '../../auth/AuthenticationError';
import type { TokenService } from '../../auth/TokenService';
import { ForbiddenError } from '@prms/domain';

interface AuthenticatedLocals {
  actor?: Actor;
}

/** Resolves the Bearer token into an Actor on `res.locals`. */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError();
    }
    (res.locals as AuthenticatedLocals).actor = tokens.verify(token);
    next();
  };
}

/** Coarse, route-level role gate. The domain re-checks every rule (defence in depth). */
export function requireRole(role: Role): RequestHandler {
  return (_req, res, next) => {
    if (actorOf(res).role !== role) {
      throw new ForbiddenError('You do not have access to this area.');
    }
    next();
  };
}

export function actorOf(res: Response): Actor {
  const actor = (res.locals as AuthenticatedLocals).actor;
  if (!actor) throw new AuthenticationError();
  return actor;
}
