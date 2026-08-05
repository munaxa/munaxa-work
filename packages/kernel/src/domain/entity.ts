import { ConcurrencyException } from '../errors/domain-exception.js';

import type { DomainEvent } from './domain-event.js';

/**
 * An object with identity. Two entities are the same entity when their identifiers match, even
 * if every other field differs — an employee who changed their name is the same employee.
 */
export abstract class Entity<TId extends string = string> {
  protected constructor(public readonly id: TId) {}

  public equals(other: Entity<TId>): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}

/**
 * A consistency boundary: the unit that is loaded, changed and saved as a whole, and the only
 * place its invariants are enforced.
 *
 * Two responsibilities live here because both are properties of the boundary rather than of any
 * one module:
 *
 * **Events.** Changes record what happened; they are collected, not published. The Unit of Work
 * publishes them after commit, so nothing outside can react to a change that then rolls back.
 *
 * **Version.** Every mutable aggregate carries one, and a write asserts the version it read.
 * Two managers approving the same leave request at once must produce a conflict, never a silent
 * overwrite where the second write erases the first without anyone noticing.
 */
export abstract class AggregateRoot<TId extends string = string> extends Entity<TId> {
  private readonly pendingEvents: DomainEvent[] = [];
  private currentVersion: number;

  protected constructor(id: TId, version = 0) {
    super(id);
    this.currentVersion = version;
  }

  public get version(): number {
    return this.currentVersion;
  }

  /** Records a change. It becomes visible outside this process only after commit. */
  protected recordEvent(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  /** Hands the recorded events to the Unit of Work and clears them. Called once, at commit. */
  public pullEvents(): readonly DomainEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return events;
  }

  public hasPendingEvents(): boolean {
    return this.pendingEvents.length > 0;
  }

  /**
   * Confirms the aggregate is being written from the state it was read at, then advances the
   * version. The repository calls this; a caller cannot opt out.
   */
  public assertVersion(expected: number): void {
    if (expected !== this.currentVersion) {
      throw new ConcurrencyException(this.constructor.name, expected, this.currentVersion);
    }
  }

  /** Advances the version after a successful write. */
  public nextVersion(): void {
    this.currentVersion += 1;
  }
}

/**
 * A value with no identity: two are interchangeable when their contents match. Money, a date
 * range, an address. Value objects are immutable, so sharing one is always safe.
 */
export abstract class ValueObject {
  public equals(other: this): boolean {
    return this.constructor === other.constructor && JSON.stringify(this) === JSON.stringify(other);
  }
}
