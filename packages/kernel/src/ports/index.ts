/**
 * Infrastructure ports, prepared in Phase 0 as interfaces only.
 *
 * Business code depends on these; adapters implement them. That is what makes the application
 * deployment agnostic: the same business logic runs against local disk or object storage, an
 * in-process queue or a distributed one, with no change above the adapter.
 *
 * No implementation exists yet, deliberately. Phase 1 supplies in-process adapters and the
 * approval, notification and document ports (ADR-0024).
 */

/** A stored file, addressed by key. Providers are interchangeable; none is named above here. */
export interface StoragePort {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /** A time-limited URL. Downloads of employee documents are never permanently addressable. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly locale: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

export interface SearchDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface SearchQuery {
  readonly tenantId: string;
  readonly type: string;
  readonly text?: string;
  readonly filters?: Readonly<Record<string, unknown>>;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SearchResult {
  readonly ids: readonly string[];
  readonly total: number;
  readonly cursor?: string;
}

export interface SearchPort {
  index(document: SearchDocument): Promise<void>;
  remove(type: string, id: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
}

export interface JobRequest<TPayload> {
  readonly name: string;
  readonly payload: TPayload;
  readonly tenantId: string;
  readonly correlationId: string;
  /** Supplied by the caller so a retried enqueue does not run the work twice. */
  readonly idempotencyKey: string;
  readonly runAt?: Date;
}

export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
}

export interface FeatureContext {
  readonly tenantId: string;
  readonly userId?: string;
}

export interface FeatureFlagPort {
  isEnabled(flag: string, context: FeatureContext): Promise<boolean>;
}
