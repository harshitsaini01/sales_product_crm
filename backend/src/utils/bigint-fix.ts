/**
 * Recursively converts BigInt values to Numbers so Hono's c.json() can serialize them.
 * Prisma returns BigInt for all auto-increment IDs. Always apply this before c.json().
 *
 * Usage: return c.json(bigintFix(result));
 */
export function bigintFix(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(bigintFix);
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = bigintFix(value);
    }
    return result;
  }
  return obj;
}
