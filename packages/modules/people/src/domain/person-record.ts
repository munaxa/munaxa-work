import type { EventOrigin } from '@work/kernel';

import { PeopleAggregate } from './people-aggregate.js';
import type { PeopleEventName } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';

/**
 * What the child records that are *not* effective-dated share: they are withdrawn, never deleted.
 *
 * A nationality, a skill, a degree, a certification and a tag are all statements about the person
 * that may turn out to be wrong or may cease to apply — and AD-009 says historical identity
 * information is never destroyed. So `withdraw` marks the row and leaves it answerable, and there
 * is no `delete` anywhere in this module.
 *
 * These are not versioned children. A skill is not a value that had a different value last March;
 * it is a claim that was either made or withdrawn. Modelling it on a timeline would produce a
 * history of nothing, and modelling a *name* the same way would have lost the one history that
 * genuinely matters — which is why the two are deliberately different shapes.
 */

export interface PersonRecordState {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly withdrawnAt?: Date;
  readonly version: number;
}

export abstract class PersonRecord<TState extends PersonRecordState> extends PeopleAggregate {
  protected constructor(
    protected state: TState,
    aggregateType: string,
    private readonly withdrawnEvent: PeopleEventName,
  ) {
    super(state.id, state.tenantId, state.version, aggregateType);
  }

  public get personId(): string {
    return this.state.personId;
  }

  public get isWithdrawn(): boolean {
    return this.state.withdrawnAt !== undefined;
  }

  public withdraw(origin: EventOrigin, occurredAt: Date): PeopleResult<Date> {
    if (this.isWithdrawn) return refuse('record_already_withdrawn');

    this.state = { ...this.state, withdrawnAt: occurredAt };
    this.raise(
      this.withdrawnEvent,
      { recordId: this.id, personId: this.state.personId },
      origin,
      occurredAt,
    );
    return accept(occurredAt);
  }

  public snapshot(): TState {
    return { ...this.state, version: this.version };
  }
}
