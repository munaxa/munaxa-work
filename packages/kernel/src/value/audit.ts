/**
 * Audit and version metadata, carried by every business entity.
 *
 * Written by the infrastructure, never by a domain rule or a caller: an audit trail a module
 * can choose to populate is an audit trail that is missing exactly where someone had a reason
 * to omit it.
 */
export interface AuditInformation {
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
  readonly deletedAt?: Date;
  readonly deletedBy?: string;
}

export interface VersionInformation {
  /** Incremented on every write. The value a subsequent write must assert. */
  readonly version: number;
}

/** Soft delete, so that history survives and a deletion can be answered for. */
export const isDeleted = (audit: AuditInformation): boolean => audit.deletedAt !== undefined;
