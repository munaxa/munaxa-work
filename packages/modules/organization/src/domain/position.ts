import { flatMap, map, uuidV7, type EventOrigin } from '@work/kernel';

import {
  OrganizationAggregate,
  checkedCode,
  checkedMetadata,
  nameFrom,
  optionalNameFrom,
  type BilingualName,
  type Metadata,
} from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import {
  POSITION_CRITICALITIES,
  type OrganizationStatus,
  type PositionCriticality,
} from './organization-vocabulary.js';

/**
 * A reusable organizational role: *HR Manager*, *Payroll Specialist*, *Software Engineer*.
 *
 * A position is not an employee and holds no person (AD-006). It is a definition that exists
 * whether or not anybody occupies it — which is precisely what makes a vacancy expressible, and
 * what lets a recruitment requisition in Phase 6 name what it is recruiting for before there is
 * anybody to name.
 *
 * There is deliberately no `occupantId`, no `holder` and no `reportsTo` on this aggregate.
 * People occupy positions through Employment assignments, and a reporting line is Employment's
 * (AD-001, AD-002). A position that knew who held it would be the second answer to a question
 * Employment already owns.
 *
 * A position is *not* attached to a unit either. The same *HR Officer* definition is used in
 * three branches, and duplicating it per branch is how a catalogue becomes unmaintainable. What
 * is per-unit is the budgeted headcount, and that is `Establishment`.
 */

export interface PositionState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly title: BilingualName;
  readonly description?: BilingualName;
  /** A grouping the tenant authors — "Finance", "Engineering". Tenant vocabulary, not ours. */
  readonly family?: string;
  /** The tenant's own grade or band label. Compensation owns what a grade pays (Phase 10). */
  readonly grade?: string;
  readonly criticality: PositionCriticality;
  readonly status: OrganizationStatus;
  readonly metadata: Metadata;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface DefinePosition {
  readonly tenantId: string;
  readonly code: string;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly family?: string;
  readonly grade?: string;
  readonly criticality?: PositionCriticality;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export class Position extends OrganizationAggregate {
  private constructor(private state: PositionState) {
    super(state.id, state.tenantId, state.version, 'Position');
  }

  /** Checks in sequence, first failure returned. See `OrganizationUnit.create` for why. */
  public static define(
    request: DefinePosition,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<Position> {
    const code = checkedCode(request.code);

    if (!code.ok) return code;

    const title = nameFrom(request.title);

    if (!title.ok) return title;

    const description = optionalNameFrom(request.description);

    if (!description.ok) return description;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const position = new Position({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      code: code.value,
      title: title.value,
      ...(description.value === undefined ? {} : { description: description.value }),
      ...(request.family === undefined ? {} : { family: request.family }),
      ...(request.grade === undefined ? {} : { grade: request.grade }),
      criticality: request.criticality ?? 'standard',
      status: 'active',
      metadata: metadata.value,
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    position.raise(
      OrganizationEvents.positionDefined,
      { positionId: position.id, code: code.value, criticality: position.state.criticality },
      origin,
      occurredAt,
    );
    return accept(position);
  }

  public static rehydrate(state: PositionState): Position {
    return new Position(state);
  }

  public get code(): string {
    return this.state.code;
  }

  public get criticality(): PositionCriticality {
    return this.state.criticality;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  public existsOn(instant: Date): boolean {
    const time = instant.getTime();
    if (time < this.state.effectiveFrom.getTime()) return false;
    return this.state.effectiveTo === undefined || time < this.state.effectiveTo.getTime();
  }

  public revise(
    changes: {
      readonly title?: Readonly<Record<string, string>>;
      readonly description?: Readonly<Record<string, string>>;
      readonly family?: string;
      readonly grade?: string;
      readonly criticality?: PositionCriticality;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<PositionState> {
    if (this.state.status === 'closed') return refuse('position_retired');
    if (
      changes.criticality !== undefined &&
      !POSITION_CRITICALITIES.includes(changes.criticality)
    ) {
      return refuse('position_criticality_unknown', { criticality: changes.criticality });
    }
    return flatMap(optionalNameFrom(changes.title), (title) =>
      map(optionalNameFrom(changes.description), (description) => {
        this.state = {
          ...this.state,
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
          ...(changes.family === undefined ? {} : { family: changes.family }),
          ...(changes.grade === undefined ? {} : { grade: changes.grade }),
          ...(changes.criticality === undefined ? {} : { criticality: changes.criticality }),
        };
        this.raise(
          OrganizationEvents.positionRevised,
          { positionId: this.id, changed: Object.keys(changes) },
          origin,
          occurredAt,
        );
        return this.state;
      }),
    );
  }

  /**
   * Retires the definition from a date.
   *
   * Employments that reference it keep resolving, because a contract naming a role that no
   * longer exists is still the contract that was signed. Retiring stops it being offered for new
   * establishment and new requisitions, and nothing more.
   */
  public retire(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationStatus> {
    if (this.state.status === 'closed') return refuse('position_retired');
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('position_retired_before_it_existed');
    }

    this.state = { ...this.state, status: 'closed', effectiveTo };
    this.raise(
      OrganizationEvents.positionRetired,
      { positionId: this.id, effectiveTo },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public snapshot(): PositionState {
    return { ...this.state, version: this.version };
  }
}
