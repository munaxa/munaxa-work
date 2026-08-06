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
import { acceptsNewStructure, type OrganizationStatus } from './organization-vocabulary.js';

/**
 * A node in the organization: a company, a legal entity, a branch, a team, or whatever level
 * this tenant has defined (ADR-0034).
 *
 * The unit owns *what it is* — code, name, status, metadata, and the period during which it
 * exists. It does not own *where it sits*: that is `UnitPlacement`, kept separate because the
 * two change for different reasons and at different times. Renaming a department is not a
 * reorganization; moving it is, and only one of the two must appear in the answer to "what did
 * this structure look like last March".
 *
 * What this aggregate deliberately has no field for is anybody who works here. No headcount, no
 * manager, no assignment (AD-002). Employment references structure; structure never references
 * Employment (AD-001).
 */

export interface OrganizationUnitState {
  readonly id: string;
  readonly tenantId: string;
  readonly unitTypeId: string;
  readonly code: string;
  readonly name: BilingualName;
  readonly description?: BilingualName;
  readonly status: OrganizationStatus;
  readonly metadata: Metadata;
  /** When the unit came into existence. Back-dating is ordinary: structure is often recorded late. */
  readonly effectiveFrom: Date;
  /** When it ceased to. Absent while it exists. */
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface CreateUnit {
  readonly tenantId: string;
  readonly unitTypeId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export class OrganizationUnit extends OrganizationAggregate {
  private constructor(private state: OrganizationUnitState) {
    super(state.id, state.tenantId, state.version, 'OrganizationUnit');
  }

  /**
   * Every check runs and the first failure returns, in sequence rather than nested.
   *
   * A chain of nested `flatMap` callbacks reads as one expression and hides which check produced
   * a refusal four levels down; early returns keep each rule on its own line, which is what
   * somebody debugging a rejected import is actually looking for.
   */
  public static create(
    request: CreateUnit,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationUnit> {
    const code = checkedCode(request.code);

    if (!code.ok) return code;

    const name = nameFrom(request.name);

    if (!name.ok) return name;

    const description = optionalNameFrom(request.description);

    if (!description.ok) return description;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const unit = new OrganizationUnit({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      unitTypeId: request.unitTypeId,
      code: code.value,
      name: name.value,
      ...(description.value === undefined ? {} : { description: description.value }),
      status: 'active',
      metadata: metadata.value,
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    unit.raise(
      OrganizationEvents.unitCreated,
      { unitId: unit.id, code: code.value, unitTypeId: request.unitTypeId },
      origin,
      occurredAt,
    );
    return accept(unit);
  }

  public static rehydrate(state: OrganizationUnitState): OrganizationUnit {
    return new OrganizationUnit(state);
  }

  public get code(): string {
    return this.state.code;
  }

  public get unitTypeId(): string {
    return this.state.unitTypeId;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  public get effectiveFrom(): Date {
    return this.state.effectiveFrom;
  }

  /** Whether the unit exists on a date — which is what a structure query asks of every node. */
  public existsOn(instant: Date): boolean {
    const time = instant.getTime();
    if (time < this.state.effectiveFrom.getTime()) return false;
    return this.state.effectiveTo === undefined || time < this.state.effectiveTo.getTime();
  }

  public canAcceptStructure(): boolean {
    return acceptsNewStructure(this.state.status);
  }

  /**
   * Renames the unit, in both languages.
   *
   * The old name travels in the event rather than being discarded, so the change is
   * reconstructible from the event log. It is *not* an effective-dated revision: a rename is a
   * correction or a rebrand, and treating it as a structural change would put a second answer
   * into "what did this look like on that date" for a unit that never moved.
   */
  public rename(
    name: Readonly<Record<string, string>>,
    description: Readonly<Record<string, string>> | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<BilingualName> {
    return flatMap(nameFrom(name), (checked) =>
      map(optionalNameFrom(description), (checkedDescription) => {
        const previous = this.state.name;

        this.state = {
          ...this.state,
          name: checked,
          ...(checkedDescription === undefined ? {} : { description: checkedDescription }),
        };
        this.raise(
          OrganizationEvents.unitRenamed,
          { unitId: this.id, from: previous, to: checked },
          origin,
          occurredAt,
        );
        return checked;
      }),
    );
  }

  /**
   * Moves the unit through its lifecycle. Closing sets the end of its existence, which is what
   * removes it from a structure query for dates after that instant — the row survives, because
   * everything that ever pointed at it must still resolve.
   */
  public changeStatus(
    status: OrganizationStatus,
    effectiveAt: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationStatus> {
    if (status === this.state.status) return refuse('unit_already_in_status', { status });
    if (this.state.status === 'closed') return refuse('unit_closed', { status: this.state.status });
    if (status === 'closed' && effectiveAt.getTime() < this.state.effectiveFrom.getTime()) {
      return refuse('unit_closed_before_it_existed');
    }

    const previous = this.state.status;
    const closure = status === 'closed' ? { effectiveTo: effectiveAt } : {};

    this.state = { ...this.state, status, ...closure };
    this.raise(
      OrganizationEvents.unitStatusChanged,
      { unitId: this.id, from: previous, to: status, effectiveAt },
      origin,
      occurredAt,
    );
    return accept(status);
  }

  public reviseMetadata(
    metadata: Metadata,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<Metadata> {
    return map(checkedMetadata(metadata), (checked) => {
      this.state = { ...this.state, metadata: checked };
      this.raise(
        OrganizationEvents.unitMetadataChanged,
        { unitId: this.id, keys: Object.keys(checked) },
        origin,
        occurredAt,
      );
      return checked;
    });
  }

  public snapshot(): OrganizationUnitState {
    return { ...this.state, version: this.version };
  }
}
