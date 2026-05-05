// Client UX gate. Real privilege boundary is verifyAdmin in
// functions/src/index.ts — server keeps its own copy of the list.

export const ADMIN_EMAILS: readonly string[] = ['zohoora@gmail.com']

export function isAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email)
}
