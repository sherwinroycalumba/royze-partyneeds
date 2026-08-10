/**
 * Password policy, shared by the change, reset, and seed flows.
 *
 * Deliberately NOT in a `"use server"` module: those may export only
 * async functions, and everything they export becomes a client-callable
 * endpoint.
 */

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}
