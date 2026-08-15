import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addToPool, closePool, createPool, removeFromPool } from '../domain/pool.js';
import { isCode, type TalentPoolKind } from '../domain/career-vocabulary.js';
import type { LocalizedName } from '../domain/career-rejection.js';
import {
  civilDateOf,
  conflicted,
  currentActor,
  notFound,
  refuseWith,
  refusedBy,
} from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Talent pools, and the periods people were in them.
 *
 * **Membership is a decision, not an observation** (ADR-0073, D-1). Somebody put a named person in
 * this pool on a named day, and that is a standing commitment an organization made. Performance's
 * nine-box placement is an observation one calibration meeting made in one cycle. Neither derives
 * the other, and nothing here reads a potential band — the port that would return one does not
 * exist, because the bounded contract it needs was not authorized (D-5).
 *
 * **A pool named `high_potential` is a name a tenant chose.** No rule in this product branches on a
 * pool's kind.
 *
 * **`pool.assign` is separate from `pool.manage`.** Creating a pool is configuration; putting a
 * named person in it is a judgement about them, and the second is granted deliberately or not at
 * all.
 */

export interface CreateTalentPoolCommand extends Command {
  readonly commandName: 'career.create-pool';
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: TalentPoolKind;
}

export interface PoolIdentified {
  readonly talentPoolId: string;
}

export const createPoolHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CreateTalentPoolCommand, PoolIdentified> => ({
  commandName: 'career.create-pool',
  permission: CareerPermissions.poolManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (!isCode(command.code)) return refuseWith<PoolIdentified>('pool-code-invalid');

      const taken = await dependencies.stores.pools.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<PoolIdentified>('career_talent_pool_code_taken');

      const created = createPool({ talentPoolId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<PoolIdentified>(created.error);

      await dependencies.stores.pools.insert(transaction, created.value);
      return success({ talentPoolId: created.value.talentPoolId });
    }),
});

export interface CloseTalentPoolCommand extends Command {
  readonly commandName: 'career.close-pool';
  readonly talentPoolId: string;
  readonly expectedVersion: number;
}

/**
 * Closing a pool.
 *
 * Membership history survives, and **open memberships are not closed as a side effect**: whether
 * somebody's investment period ended when the pool closed is a fact about that person, and deciding
 * it for them here would write a date nobody chose. A closed pool simply admits nobody new.
 */
export const closePoolHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CloseTalentPoolCommand, PoolIdentified> => ({
  commandName: 'career.close-pool',
  permission: CareerPermissions.poolManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const pool = await dependencies.stores.pools.byId(transaction, command.talentPoolId);

      if (pool === undefined) return notFound<PoolIdentified>('career_talent_pool');

      const closed = closePool(pool, dependencies.clock.now(), currentActor());

      if (!closed.ok) return refusedBy<PoolIdentified>(closed.error);

      await dependencies.stores.pools.update(transaction, closed.value, command.expectedVersion);
      return success({ talentPoolId: pool.talentPoolId });
    }),
});

export interface AddToTalentPoolCommand extends Command {
  readonly commandName: 'career.add-to-pool';
  readonly talentPoolId: string;
  readonly employmentId: string;
  readonly from: string;
  readonly reason?: string;
}

export interface MembershipCreated {
  readonly membershipId: string;
  /** `false` where an open membership already existed. Convergence, not an error. */
  readonly created: boolean;
}

/**
 * Putting somebody in a pool.
 *
 * **The uniqueness is the database's** (§15): one open membership per pool and employment, decided
 * by a partial unique index rather than by a read-then-write two administrators could both pass at
 * the same instant. A retry converges on the membership that already exists and reports
 * `created: false` — the caller who lost a response and the caller who pressed twice get the same
 * truthful answer, and neither creates a second period.
 *
 * A person may be in two pools at once, and may rejoin a pool they left; what they cannot be is in
 * the same pool twice at the same time.
 */
export const addToPoolHandler = (
  dependencies: CareerDependencies,
): CommandHandler<AddToTalentPoolCommand, MembershipCreated> => ({
  commandName: 'career.add-to-pool',
  permission: CareerPermissions.poolAssign,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const pool = await dependencies.stores.pools.byId(transaction, command.talentPoolId);

      if (pool === undefined) return notFound<MembershipCreated>('career_talent_pool');

      const employment = await dependencies.employment.factsFor(command.employmentId);

      if (employment === undefined) return refuseWith<MembershipCreated>('employment-not-found');

      const added = addToPool(pool, {
        membershipId: uuidV7(),
        employmentId: command.employmentId,
        from: command.from,
        by: currentActor(),
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      });

      if (!added.ok) return refusedBy<MembershipCreated>(added.error);

      const written = await dependencies.stores.memberships.insertIfAbsent(
        transaction,
        added.value,
      );

      if (written) return success({ membershipId: added.value.membershipId, created: true });

      const held = await dependencies.stores.memberships.openFor(
        transaction,
        pool.talentPoolId,
        command.employmentId,
      );

      if (held === undefined) return conflicted<MembershipCreated>('career_pool_membership_open');
      return success({ membershipId: held.membershipId, created: false });
    }),
});

export interface RemoveFromTalentPoolCommand extends Command {
  readonly commandName: 'career.remove-from-pool';
  readonly membershipId: string;
  readonly on: string;
  readonly reason?: string;
  readonly expectedVersion: number;
}

export interface MembershipIdentified {
  readonly membershipId: string;
}

/**
 * Ending a membership.
 *
 * **A period ending, never a delete.** "Who did we invest in, and what happened to them" is the
 * question a succession review asks a year later, and a deleted row cannot answer it. A membership
 * already ended cannot end again: a second removal would overwrite the day the first recorded, and
 * that day is the historical fact.
 *
 * The civil day is the caller's here rather than the clock's, because a removal is often recorded
 * after the fact — "she left the graduate scheme in March" is a real thing to write down in April.
 * The domain refuses a day before the membership began.
 */
export const removeFromPoolHandler = (
  dependencies: CareerDependencies,
): CommandHandler<RemoveFromTalentPoolCommand, MembershipIdentified> => ({
  commandName: 'career.remove-from-pool',
  permission: CareerPermissions.poolAssign,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.memberships.byId(transaction, command.membershipId);

      if (held === undefined) return notFound<MembershipIdentified>('career_pool_membership');

      const removed = removeFromPool(held, {
        on: command.on,
        by: currentActor(),
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      });

      if (!removed.ok) return refusedBy<MembershipIdentified>(removed.error);

      await dependencies.stores.memberships.update(
        transaction,
        removed.value,
        command.expectedVersion,
      );
      return success({ membershipId: held.membershipId });
    }),
});

/** The day this module treats as today, for a handler that needs one and was given none. */
export const todayOf = (dependencies: CareerDependencies): string =>
  civilDateOf(dependencies.clock.now());
