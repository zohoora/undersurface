/**
 * Client-side admin allowlist.
 *
 * This is the UX gate — it decides whether the /admin route renders. The real
 * privilege boundary lives in functions/src/index.ts (verifyAdmin), which
 * checks the same allowlist server-side and returns 403 to non-admins. A user
 * who tampers with this constant in their devtools gets nothing back from the
 * server.
 *
 * Kept narrow on purpose: one constant + one helper, no env-var indirection,
 * no role hierarchy. Add complexity only when there is a second admin tier.
 */

export const ADMIN_EMAILS = ['zohoora@gmail.com'] as const

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  return (ADMIN_EMAILS as readonly string[]).includes(email)
}
