import type { ErrorRequestHandler } from 'express';
import { DomainError, type DomainErrorCode } from '@prms/domain';
import { AuthenticationError } from '../auth/AuthenticationError';
import type { Logger } from './logger';
import { RequestValidationError } from './validation';

/**
 * Domain codes -> HTTP statuses. Typed as a full Record so adding a new domain
 * error code is a compile error until it is mapped here.
 */
const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  TIER_ACCESS_DENIED: 403,
  CREW_LEAD_LIMIT_REACHED: 409,
  CREW_ROSTER_INCOMPLETE: 500,
  USERNAME_TAKEN: 409,
  CAPACITY_EXCEEDED: 409,
  BOOKING_OVERLAP: 409,
  RESOURCE_UNAVAILABLE: 409,
  INVALID_STATE: 409,
};

export interface ErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const send = (status: number, body: ErrorBody) => res.status(status).json(body);

    if (err instanceof DomainError) {
      return send(STATUS_BY_CODE[err.code], { error: { code: err.code, message: err.message } });
    }
    if (err instanceof AuthenticationError) {
      return send(401, { error: { code: err.code, message: err.message } });
    }
    if (err instanceof RequestValidationError) {
      return send(400, {
        error: { code: 'INVALID_REQUEST', message: err.message, issues: err.issues },
      });
    }
    // body-parser failures
    if (err?.type === 'entity.parse.failed') {
      return send(400, {
        error: { code: 'INVALID_REQUEST', message: 'Request body is not valid JSON.' },
      });
    }
    if (err?.type === 'entity.too.large') {
      return send(413, {
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
      });
    }

    logger.error('Unhandled error', {
      method: req.method,
      path: req.originalUrl,
      error: err instanceof Error ? err.stack : String(err),
    });
    return send(500, {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
    });
  };
}
