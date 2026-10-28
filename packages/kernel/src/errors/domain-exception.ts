/**
 * A violated invariant — something the domain believed impossible.
 *
 * A DomainException is never an expected outcome. Expected outcomes are `Result` failures. This
 * exists so that a genuine bug surfaces loudly instead of being caught alongside business
 * rejections, and so that the API layer can distinguish the two when mapping to Problem Details.
 */
export class DomainException extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainException';
    this.code = code;
  }
}

/** Raised when an aggregate is written from a stale read. Never resolved by overwriting. */
export class ConcurrencyException extends DomainException {
  public constructor(aggregate: string, expected: number, actual: number) {
    super(
      'concurrency_conflict',
      `${aggregate} was modified by someone else: expected version ${String(expected)}, found ${String(actual)}.`,
    );
    this.name = 'ConcurrencyException';
  }
}

/** Raised when a caller reaches for data belonging to another tenant. */
export class TenantIsolationException extends DomainException {
  public constructor(resource: string) {
    super('tenant_isolation', `Access to ${resource} outside the current tenant was refused.`);
    this.name = 'TenantIsolationException';
  }
}

/**
 * Refused by what the organisation is entitled to, not by what the person may do: a module its
 * licence does not include, a term that has ended, a licensed headcount reached.
 *
 * Not a `DomainException` — nothing impossible happened — and not a `Result` failure, for the same
 * reason a lost concurrency race is not one: the refusal is decided outside the module (by the
 * platform's operation gate, or a port the module was handed), and every module's own failure
 * mapping would otherwise need a case for a concept the kernel does not own. It travels to the
 * edge, which answers `402`. The `reason` is the shared licensing contract's, and safe to return.
 */
export class NotEntitledException extends Error {
  public readonly reason: string;
  public readonly status: string | null;

  public constructor(reason: string, message: string, status: string | null = null) {
    super(message);
    this.name = 'NotEntitledException';
    this.reason = reason;
    this.status = status;
  }
}
