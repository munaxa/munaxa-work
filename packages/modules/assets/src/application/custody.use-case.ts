import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { CUSTODY_ELIGIBLE_STATUS } from '../domain/assets-vocabulary.js';
import { issueCustody, returnCustody } from '../domain/custody.js';
import { conflicted, notFound, refusedBy } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import type { AssetsDependencies } from './assets-dependencies.js';

/**
 * Custody: issuing an asset to an employment, and recording that it came back.
 *
 * **Two commands, two permissions, and the separation is deliberate.** Issuing creates an obligation
 * for a named person; recording a return discharges one. A false return is the more dangerous of the
 * two — it makes an outstanding asset disappear from the register offboarding clearance will read.
 *
 * **The employment is verified, not accepted.** An identifier a command supplies is an identifier a
 * command can invent, so Assets asks Employment's own published read — under a bounded grant — whether
 * it exists, and learns one boolean and nothing else. Another tenant's employment answers as absent.
 *
 * **The asset row is locked before anything else happens.** Both commands here, and
 * `change-asset-status`, take that lock first, which is what makes "an asset cannot be retired while a
 * custody is open" hold under concurrency: the two transactions serialize on the asset row rather than
 * both passing a check that was true when they read it.
 *
 * **Nothing here transfers, acknowledges, cancels or corrects.** Each is a deferred capability with an
 * open decision behind it, and none is stubbed.
 */

export interface IssueCustodyCommand extends Command {
  readonly commandName: 'assets.issue-custody';
  readonly assetId: string;
  readonly employmentId: string;
  readonly issuedOn: string;
  readonly issueNote?: string;
}

export interface CustodyIdentified {
  readonly assetCustodyId: string;
}

export const issueCustodyHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<IssueCustodyCommand, CustodyIdentified> => ({
  commandName: 'assets.issue-custody',
  permission: AssetsPermissions.custodyAssign,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      // Locked, not merely read: this is the serialization point the retirement invariant depends on.
      const asset = await dependencies.stores.assets.byIdForUpdate(transaction, command.assetId);

      if (asset === undefined) return notFound<CustodyIdentified>('asset');
      if (asset.status !== CUSTODY_ELIGIBLE_STATUS) {
        // `registered` is not yet in service, `under_repair` is out of it and `retired` is out for
        // good. Issuing from any of them would record a handover that could not have happened.
        return conflicted<CustodyIdentified>('asset_not_available');
      }

      const held = await dependencies.stores.custodies.openFor(transaction, command.assetId);

      // Checked for a readable refusal; the partial unique index is what actually settles two
      // storekeepers issuing one asset at the same instant (ADR-0071).
      if (held !== undefined) return conflicted<CustodyIdentified>('asset_already_in_custody');

      if (!(await dependencies.employments.exists(command.employmentId))) {
        // Another tenant's employment reads exactly as one that never existed, so an identifier
        // cannot be probed by issuing against it.
        return notFound<CustodyIdentified>('employment');
      }

      const issued = issueCustody({
        assetCustodyId: uuidV7(),
        assetId: command.assetId,
        employmentId: command.employmentId,
        issuedOn: command.issuedOn,
        today: civilDateOf(dependencies.clock.now()),
        ...(command.issueNote === undefined ? {} : { issueNote: command.issueNote }),
      });

      if (!issued.ok) return refusedBy<CustodyIdentified>(issued.error);

      await dependencies.stores.custodies.insert(transaction, issued.value);
      return success({ assetCustodyId: issued.value.assetCustodyId });
    }),
});

export interface ReturnCustodyCommand extends Command {
  readonly commandName: 'assets.return-custody';
  readonly assetCustodyId: string;
  readonly expectedVersion: number;
  readonly returnedOn: string;
  readonly returnNote?: string;
}

/**
 * Recording a return — the one transition this checkpoint builds.
 *
 * **The custody closes; it is not replaced.** A period ends where it began, and the closed row is the
 * history AD-003 asks for. From that instant the database refuses every update and delete on it.
 *
 * **Two simultaneous returns produce exactly one.** The `expectedVersion` predicate lives in the
 * update's `where` clause rather than in a preceding read, because a read followed by a write is two
 * statements with a gap between them — and the gap is where the second return would silently land.
 */
export const returnCustodyHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<ReturnCustodyCommand, CustodyIdentified> => ({
  commandName: 'assets.return-custody',
  permission: AssetsPermissions.custodyReturn,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.custodies.byId(transaction, command.assetCustodyId);

      if (held === undefined) return notFound<CustodyIdentified>('asset_custody');

      const returned = returnCustody({
        custody: held,
        returnedOn: command.returnedOn,
        today: civilDateOf(dependencies.clock.now()),
        ...(command.returnNote === undefined ? {} : { returnNote: command.returnNote }),
      });

      if (!returned.ok) return refusedBy<CustodyIdentified>(returned.error);

      await dependencies.stores.custodies.update(
        transaction,
        returned.value,
        command.expectedVersion,
      );
      return success({ assetCustodyId: held.assetCustodyId });
    }),
});

/**
 * The civil date at an instant, in UTC.
 *
 * The same helper and the same stated limitation every module before this one carries: near midnight
 * far from UTC the server's day may differ from the tenant's by one.
 */
const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
