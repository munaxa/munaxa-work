/**
 * What a caller must hold, and the one separation that carries the most weight.
 *
 * **`letter.include-salary` is a permission of its own.** 5.1 AD-005 requires that a template may
 * not expose salary unless the letter type permits it *and* the requester holds the permission —
 * two gates, deliberately. Without the second, a letter becomes a way to read a salary the caller
 * could not read directly: anybody who may request an employment certificate would be able to
 * request one whose template happens to print a figure.
 *
 * `letter.request-own` is declared and **enforced nowhere**, exactly as `document.read-own` is and
 * for the same reason: there is no authenticated-principal-to-employment resolution in this
 * repository (ADR-0032). The contract exists; self-service routing is `NOT VERIFIED`.
 */
export const LettersPermissions = {
  templateRead: 'letter.template.read',
  templateManage: 'letter.template.manage',

  read: 'letter.read',
  request: 'letter.request',
  /** Additional to `letter.request`, never instead of it. The second of AD-005's two gates. */
  includeSalary: 'letter.include-salary',
  approve: 'letter.approve',
  issue: 'letter.issue',
  /**
   * Confirming that a reference names a genuine letter, and nothing else about it.
   *
   * AD-006 describes this as a check a *third party* performs, and a bank clerk holding a printed
   * letter has no account. It is a permission anyway, because the alternative does not exist: every
   * read in this product resolves a tenant before it reaches a row, `@PublicRoute()` bypasses tenant
   * resolution entirely, and row-level security has no anonymous, cross-tenant path. An
   * unauthenticated public verification endpoint is `NOT VERIFIED` — the query is built and behaves
   * correctly; only the anonymous route in front of it is missing.
   */
  verify: 'letter.verify',
  /** Reading what reconciliation found, and the register-wide view. */
  manage: 'letter.manage',
  /** Declared; enforced nowhere. Self-service routing does not exist. */
  requestOwn: 'letter.request-own',
} as const;

export type LettersPermission = (typeof LettersPermissions)[keyof typeof LettersPermissions];

export const ALL_LETTERS_PERMISSIONS: readonly string[] = Object.values(LettersPermissions);
