/**
 * What a caller must hold, and the separations that matter.
 *
 * **Three levels, deliberately distinct.** Reading that a document exists is not reading it, and
 * reading it is not downloading it. Phase 4.1 AD-007 is explicit: seeing an employee never implies
 * seeing their medical or disciplinary attachments, so `employee.read` grants nothing here and a
 * confidential document needs `read-sensitive` on top of `read`.
 *
 * `download` is separate again. A caller who may see that a passport scan exists, its type and its
 * expiry may have no business obtaining the bytes — and the download path is the one that reaches
 * storage, so it is the one that must be authorized last and audited always.
 *
 * `read-own` is declared and **enforced nowhere**, exactly as it is in Attendance, Compensation,
 * Leave and Payroll. There is no authenticated-principal-to-employment resolution in this
 * repository (ADR-0032), so the permission names a capability the platform cannot yet grant. It is
 * here so the contract exists; self-service routing is `NOT VERIFIED`.
 */
export const DocumentsPermissions = {
  typeRead: 'document.type.read',
  typeManage: 'document.type.manage',

  /** That a document exists, its type, status and expiry. **Not its contents and not its bytes.** */
  read: 'document.read',
  /** A document whose type is classified confidential. Additional to `read`, never instead of it. */
  readSensitive: 'document.read-sensitive',
  /** Obtaining a URL for the bytes. Separate from reading the metadata. */
  download: 'document.download',
  manage: 'document.manage',
  verify: 'document.verify',
  /** Reading the access trail — who reached which document. Itself a sensitive read. */
  audit: 'document.audit',
  /** Declared; enforced nowhere. Self-service routing does not exist (§15 of the plan). */
  readOwn: 'document.read-own',
} as const;

export type DocumentsPermission = (typeof DocumentsPermissions)[keyof typeof DocumentsPermissions];

export const ALL_DOCUMENTS_PERMISSIONS: readonly string[] = Object.values(DocumentsPermissions);
