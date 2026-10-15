/**
 * The desktop shell refuses local network access while the default PIN is in
 * use, and a replacement must be 6 to 32 digits.
 */
export function isValidLocalPin(pin: string): boolean {
  return /^\d{6,32}$/.test(pin);
}
