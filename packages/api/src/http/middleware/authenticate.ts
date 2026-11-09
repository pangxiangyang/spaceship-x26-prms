import type { RequestHandler, Response } from 'express';
import { ForbiddenError, type Actor, type AnyUser, type Role } from '@prms/domain';
import { AuthenticationError } from '../../auth/AuthenticationError';
import type { TokenService } from '../../auth/TokenService';

interface AuthenticatedLocals {
  actor?: Actor;
  user?: AnyUser;
}

/** Looks up the account behind a verified token. */
export interface AccountLookup {
  currentUser(actor: Actor): Promise<AnyUser>;
}

/**
 * Resolves the Bearer token into an Actor on `res.locals`, and confirms the
 * account still exists. A token outlives its account when an account is
 * removed (e.g. a demo reset), and must stop working at that moment.
 */
export function authenticate(tokens: TokenService, accounts: AccountLookup): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationError();
    }
    const actor = tokens.verify(token);
    const locals = res.locals as AuthenticatedLocals;
    locals.user = await accounts.currentUser(actor);
    locals.actor = actor;
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

/** The signed-in account, loaded by `authenticate`. */
export function userOf(res: Response): AnyUser {
  const user = (res.locals as AuthenticatedLocals).user;
  if (!user) throw new AuthenticationError();
  return user;
}
