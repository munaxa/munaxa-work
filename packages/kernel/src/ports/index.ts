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

/**
 * One delivery of one job to the application, as the runner describes it.
 *
 * The **execution** half of this port, and it was missing: `enqueue` and `schedule` could submit
 * work that nothing could ever deliver. What is here is the minimum a handler needs to run safely
 * and be audited, and deliberately nothing about *how* it arrived — no lease token, no queue name,
 * no broker cursor. A handler that could see those would eventually depend on one runner.
 *
 * **The tenant is here and not in the payload.** `JobRequest.tenantId` says which tenant the work
 * was *submitted for*; this says which tenant it *runs as*, and only the runner may set it. A
 * handler that took the tenant from `payload` would let whoever enqueued the job choose the tenant,
 * which is the one thing tenancy may never allow (ADR-0030).
 */
export interface JobExecution<TPayload> {
  readonly name: string;
  readonly payload: TPayload;
  readonly tenantId: string;
  /** The job's durable identity — the `idempotencyKey` it was submitted with. Stable across retries. */
  readonly jobId: string;
  /** 1 for the first delivery, then 2, 3… A retry is a new attempt at the *same* `jobId`. */
  readonly attempt: number;
  readonly correlationId: string;
  /** The non-human subject the platform authenticated for this run. Never a membership. */
  readonly executionIdentity: string;
}

/**
 * What a handler tells the runner, and the only two things it may say.
 *
 * `complete` means the work is done or was not needed — both are successes, because an execution
 * that correctly did nothing has succeeded at the only thing it was asked to decide. `failed` asks
 * for whatever retry policy the runner was configured with; the handler does not choose one, since
 * a handler that scheduled its own retries would be a second scheduler.
 */
export type JobOutcome =
  { readonly outcome: 'complete' } | { readonly outcome: 'failed'; readonly reason: string };

export interface JobHandler<TPayload> {
  readonly name: string;
  run(execution: JobExecution<TPayload>): Promise<JobOutcome>;
}

/**
 * Submitting work, and receiving it.
 *
 * **No implementation exists in this repository, and none may.** The concrete runner — the process
 * that holds a queue, leases work, counts attempts and applies a retry policy — is the platform's,
 * and a second one here would be the duplication ADR-0023 and the platform boundary both refuse.
 * What belongs here is the shape the application is willing to be called in, so that when a runner
 * arrives it has something to satisfy rather than something to negotiate.
 *
 * **Delivery is at-least-once and is stated as such.** No runner can promise otherwise across a
 * crash, so every handler registered here must be safe to run twice — which, for the one handler
 * this contract exists for, is a database uniqueness claim rather than a promise.
 */
export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
  /** Registers what runs when a job of this name is delivered. Two handlers for one name is a defect. */
  register<TPayload>(handler: JobHandler<TPayload>): void;
}

export interface FeatureContext {
  readonly tenantId: string;
  readonly userId?: string;
}

export interface FeatureFlagPort {
  isEnabled(flag: string, context: FeatureContext): Promise<boolean>;
}
