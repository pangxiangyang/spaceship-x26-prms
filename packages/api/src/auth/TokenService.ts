import jwt from 'jsonwebtoken';
import { Role, type Actor } from '@prms/domain';
import { AuthenticationError } from './AuthenticationError';

export interface TokenService {
  issue(actor: Actor): { token: string; expiresIn: number };
  verify(token: string): Actor;
}

const ISSUER = 'spaceship-x26-prms';

export class JwtTokenService implements TokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(actor: Actor): { token: string; expiresIn: number } {
    const token = jwt.sign({ role: actor.role }, this.secret, {
      subject: actor.userId,
      expiresIn: this.ttlSeconds,
      issuer: ISSUER,
      algorithm: 'HS256',
    });
    return { token, expiresIn: this.ttlSeconds };
  }

  verify(token: string): Actor {
    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(token, this.secret, { issuer: ISSUER, algorithms: ['HS256'] });
    } catch {
      throw new AuthenticationError(
        'Your session is invalid or has expired. Please sign in again.',
      );
    }
    if (
      typeof payload === 'string' ||
      !payload.sub ||
      !Object.values(Role).includes(payload.role)
    ) {
      throw new AuthenticationError('Malformed session token.');
    }
    return { userId: payload.sub, role: payload.role as Role };
  }
}
