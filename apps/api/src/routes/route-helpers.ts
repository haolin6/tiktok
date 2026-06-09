import { validationError } from "../errors.js";

export function parseNumericId(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw validationError(`${label} must be a positive integer.`);
  }

  return parsed;
}
