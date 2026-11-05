/** The caller could not be identified (missing/invalid token or bad credentials). */
export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';

  constructor(message = 'Authentication is required.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}
