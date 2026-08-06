import { flatMap, map, uuidV7, type EventOrigin } from '@work/kernel';

import {
  OrganizationAggregate,
  checkedCode,
  nameFrom,
  type BilingualName,
} from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import type { OrganizationStatus } from './organization-vocabulary.js';

/**
 * A level in this tenant's organizational hierarchy — *company*, *branch*, *team*, or whatever
 * the customer calls its levels.
 *
 * This aggregate is the whole of ADR-0034. The specification names nine levels, and the obvious
 * reading is nine tables; AD-003 forbids that reading, because nine tables is nine levels and
 * "unlimited depth" is then a claim the schema contradicts. So the levels are tenant data.
 *
 * The consequences are worth stating plainly, because they are what this design buys:
 *
 * - A tenant that has no divisions simply never defines the type. "The hierarchy engine must
 *   not require every level to exist" becomes true by construction rather than by a branch.
 * - A group that inserts *region* between company and branch adds a row, not a migration.
 * - A holding company with a legal entity under a legal entity — which is ordinary, and which
 *   a fixed nine-level ladder cannot express at all — is just a placement.
 *
 * What it costs is that "may a department sit under a branch?" has no answer in code. That
 * answer is `allowedParentCodes`, which is configuration: empty means any parent, and a
 * non-empty list is the tenant's own rule about its own shape.
 */

export interface OrganizationUnitTypeState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualName;
  /** Display order in an administration screen. Not a depth: depth is a placement, not a type. */
  readonly ordinal: number;
  /**
   * Which types may parent a unit of this type. Empty means any — which is the honest default,
   * because a tenant that has not stated its rule does not have one.
   */
  readonly allowedParentCodes: readonly string[];
  /** Whether a unit of this type may sit at the top of the tenant's structure with no parent. */
  readonly allowedAtRoot: boolean;
  /**
   * Whether a unit of this type carries a legal entity registration. Exactly the types a tenant
   * nominates — usually one, sometimes two in a group that registers branches separately.
   */
  readonly carriesLegalEntity: boolean;
  readonly status: OrganizationStatus;
  readonly version: number;
}

export interface DefineUnitType {
  readonly tenantId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly ordinal: number;
  readonly allowedParentCodes?: readonly string[];
  readonly allowedAtRoot?: boolean;
  readonly carriesLegalEntity?: boolean;
}

export class OrganizationUnitType extends OrganizationAggregate {
  private constructor(private state: OrganizationUnitTypeState) {
    super(state.id, state.tenantId, state.version, 'OrganizationUnitType');
  }

  public static define(
    request: DefineUnitType,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationUnitType> {
    return flatMap(checkedCode(request.code), (code) =>
      flatMap(nameFrom(request.name), (name) =>
        map(checkedParents(request.allowedParentCodes ?? [], code), (allowedParentCodes) => {
          const type = new OrganizationUnitType({
            id: uuidV7(occurredAt.getTime()),
            tenantId: request.tenantId,
            code,
            name,
            ordinal: request.ordinal,
            allowedParentCodes,
            allowedAtRoot: request.allowedAtRoot ?? true,
            carriesLegalEntity: request.carriesLegalEntity ?? false,
            status: 'active',
            version: 0,
          });

          type.raise(
            OrganizationEvents.unitTypeDefined,
            { unitTypeId: type.id, code, ordinal: request.ordinal },
            origin,
            occurredAt,
          );
          return type;
        }),
      ),
    );
  }

  public static rehydrate(state: OrganizationUnitTypeState): OrganizationUnitType {
    return new OrganizationUnitType(state);
  }

  public get code(): string {
    return this.state.code;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  public get carriesLegalEntity(): boolean {
    return this.state.carriesLegalEntity;
  }

  public get allowedAtRoot(): boolean {
    return this.state.allowedAtRoot;
  }

  /**
   * Whether a unit of this type may sit under a parent of the given type.
   *
   * `undefined` means "at the root", which is a different question from "under nothing yet" —
   * the caller has already decided which it is asking.
   */
  public permitsParent(parentTypeCode: string | undefined): boolean {
    if (parentTypeCode === undefined) return this.state.allowedAtRoot;
    if (this.state.allowedParentCodes.length === 0) return true;
    return this.state.allowedParentCodes.includes(parentTypeCode);
  }

  /**
   * Retires the level. Units already of this type keep it: retiring *company* because the group
   * reorganized must not silently reclassify the companies that exist.
   */
  public retire(origin: EventOrigin, occurredAt: Date): OrganizationResult<OrganizationStatus> {
    if (this.state.status === 'closed') return refuse('unit_type_already_retired');

    this.state = { ...this.state, status: 'closed' };
    this.raise(
      OrganizationEvents.unitTypeRetired,
      { unitTypeId: this.id, code: this.state.code },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public snapshot(): OrganizationUnitTypeState {
    return { ...this.state, version: this.version };
  }
}

/**
 * A type that permits itself as a parent is legitimate and common — a division under a division
 * is how large groups actually nest — so self-reference is *not* refused here. What is refused
 * is a malformed code, because a rule referring to a code that cannot exist is a rule that will
 * silently never match.
 */
const checkedParents = (
  codes: readonly string[],
  _own: string,
): OrganizationResult<readonly string[]> => {
  const malformed = codes.find((code) => !checkedCode(code).ok);

  if (malformed !== undefined) return refuse('code_malformed', { code: malformed });
  return accept([...new Set(codes)]);
};
