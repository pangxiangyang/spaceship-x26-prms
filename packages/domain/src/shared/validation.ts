import { ValidationError } from './errors';

export function requireNonBlank(value: string, field: string, maxLength: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} must not be blank.`);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

export function requireIntegerInRange(value: number, field: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

export function requireValidDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError(`${field} must be a valid date-time.`);
  }
  return value;
}
