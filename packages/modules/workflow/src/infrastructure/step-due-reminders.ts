import type { Transaction } from '@work/kernel';

import type { DueReminder } from '../application/workflow-ports.js';

/**
 * The one read in this module that names nobody: which steps are due an automatic service-level
 * reminder (D-16E-14).
 *
 * It lives beside `PostgresStepRepository` rather than inside it because it is the only query here
 * that answers a *machine's* question. Everything else in that class reads or writes a step somebody
 * already named; this one goes looking. Keeping it separate means the reasoning below sits next to the
 * SQL it explains rather than in the middle of a class of CRUD.
 *
 * **The interval arithmetic matches the domain exactly, and `24 hours` is not a typo for `1 day`.**
 * `dueAt` adds `count × 86_400_000 ms` for a `days` target — exactly twenty-four hours. PostgreSQL's
 * `interval '1 day'` is *calendar* arithmetic on a `timestamptz`: across a daylight-saving boundary it
 * is twenty-three or twenty-five hours, and the query would then disagree with the command about
 * whether a step was due, twice a year, for one hour. `interval '1 hour' * 24` cannot drift.
 *
 * **Strictly `<`, which is `asAt > dueAt` read from the other side.** Due exactly on the boundary is
 * `within` for every other reader of this target, and a candidate offered at that instant would be
 * refused by the command it was offered to.
 *
 * **The anti-join is a narrowing, not the guarantee.** `workflow_history_reminder_idx` decides who
 * wins; this only avoids handing a runner work that is already certainly done. Two runners reading
 * concurrently will both see a step neither has claimed, and that is correct.
 *
 * **Ordered by `s.id` and continued by it.** A uuid v7 is time-ordered and immutable, so a cursor over
 * it neither repeats a row nor skips one while the table is being written to — which an offset over a
 * changing set does both of.
 *
 * **The tenant is the transaction's, never a parameter of the caller's.** It is bound from
 * `transaction.tenantId` like every other read here, and row-level security filters again beneath it.
 */
export const dueForReminderRows = async (
  transaction: Transaction,
  asAt: Date,
  limit: number,
  cursor?: string,
): Promise<readonly DueReminder[]> => {
  const parameters: unknown[] = [transaction.tenantId, asAt, limit];
  const after = cursor === undefined ? '' : `and s.id > $${String(parameters.push(cursor))}`;

  const rows = await transaction.execute<{ instance_id: string; id: string }>(
    `select s.instance_id, s.id
       from workflow_step s
       join workflow_instance i
         on i.id = s.instance_id and i.tenant_id = s.tenant_id
        and i.status = 'running' and i.deleted_at is null
      where s.tenant_id = $1
        and s.status = 'awaiting'
        and s.deleted_at is null
        and s.service_level_count is not null
        and s.awaiting_at is not null
        and s.awaiting_at + (interval '1 hour' * s.service_level_count
              * (case s.service_level_unit when 'hours' then 1 else 24 end)) < $2::timestamptz
        ${after}
        and not exists (
          select 1 from workflow_history h
           where h.tenant_id = s.tenant_id and h.step_id = s.id
             and h.event = 'step-reminded' and h.deleted_at is null)
      order by s.id
      limit $3`,
    parameters,
  );

  return rows.map((row) => ({ instanceId: row.instance_id, stepId: row.id }));
};
