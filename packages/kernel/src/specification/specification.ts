/**
 * A business rule expressed as an object, so the same rule can be checked in memory and
 * translated to a query rather than written twice.
 *
 * Written twice is how "eligible for annual leave" comes to mean one thing on the request
 * screen and another in the nightly accrual job, and nobody notices until an employee is told
 * two different numbers.
 */
export abstract class Specification<TCandidate> {
  public abstract isSatisfiedBy(candidate: TCandidate): boolean;

  public and(other: Specification<TCandidate>): Specification<TCandidate> {
    return new AndSpecification(this, other);
  }

  public or(other: Specification<TCandidate>): Specification<TCandidate> {
    return new OrSpecification(this, other);
  }

  public not(): Specification<TCandidate> {
    return new NotSpecification(this);
  }
}

class AndSpecification<TCandidate> extends Specification<TCandidate> {
  public constructor(
    private readonly left: Specification<TCandidate>,
    private readonly right: Specification<TCandidate>,
  ) {
    super();
  }

  public isSatisfiedBy(candidate: TCandidate): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<TCandidate> extends Specification<TCandidate> {
  public constructor(
    private readonly left: Specification<TCandidate>,
    private readonly right: Specification<TCandidate>,
  ) {
    super();
  }

  public isSatisfiedBy(candidate: TCandidate): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<TCandidate> extends Specification<TCandidate> {
  public constructor(private readonly inner: Specification<TCandidate>) {
    super();
  }

  public isSatisfiedBy(candidate: TCandidate): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}

/** A specification built from a predicate, for rules with no query form. */
export const specify = <TCandidate>(
  predicate: (candidate: TCandidate) => boolean,
): Specification<TCandidate> =>
  new (class extends Specification<TCandidate> {
    public isSatisfiedBy(candidate: TCandidate): boolean {
      return predicate(candidate);
    }
  })();
