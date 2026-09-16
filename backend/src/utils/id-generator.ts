/**
 * Auto-generate login IDs and passwords for new users.
 * Matches the exact logic from the old PHP CRM.
 *
 * Old CRM Prefixes:
 *   Counsellor / Employee: "EMP" + 8 random digits
 *   Franchise:             "FRCHS" + 8 random digits
 *   Agent:                 "CR" + 8 random digits
 */

const DIGIT_CHARS = '0123456789';
const PASSWORD_CHARS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomChars(chars: string, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateLoginId(role: string): string {
  const prefixes: Record<string, string> = {
    counsellor: 'EMP',
    employee: 'EMP',
    franchise: 'FRCHS',
    agent: 'CR',
  };
  const prefix = prefixes[role] ?? 'EMP';
  return prefix + randomChars(DIGIT_CHARS, 8);
}

export function generatePassword(length = 8): string {
  return randomChars(PASSWORD_CHARS, length);
}
