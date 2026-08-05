/**
 * Documents, as a port (ADR-0024).
 *
 * Phase 4.1 owns documents and their expiry; Phase 5.1 owns generated letters. Domains before
 * them need to attach evidence to a leave request or a claim, and must not learn where bytes
 * live or how they are addressed.
 *
 * Access is time limited by construction: `url` returns a signed URL with an expiry rather than
 * a path, because an employee's medical certificate must not remain fetchable by anyone who
 * once saw the link.
 */

export interface DocumentReference {
  readonly documentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeInBytes: number;
}

export interface DocumentAttachment {
  readonly ownerType: string;
  readonly ownerId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Uint8Array;
  /** Restricts who may retrieve it, independently of who may see the owning record. */
  readonly confidentiality: 'normal' | 'confidential';
}

export interface DocumentPort {
  attach(attachment: DocumentAttachment): Promise<DocumentReference>;
  url(documentId: string, expiresInSeconds: number): Promise<string>;
  detach(documentId: string, reason: string): Promise<void>;
}
