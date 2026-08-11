import type { Transaction } from '@work/kernel';

import { findingsFor } from '../application/reconciliation.js';
import type {
  ReconciliationFinding,
  ReconciliationStore,
} from '../application/performance-ports.js';
import {
  CYCLE_COLUMNS,
  GOAL_COLUMNS,
  cycleState,
  goalState,
  reviewState,
  type CycleRow,
  type GoalRow,
  type ReviewRow,
} from './review-rows.js';
import {
  templateComponentState,
  templateState,
  type TemplateComponentRow,
  type TemplateRow,
} from './configuration-rows.js';
import { talentPlacementState, type TalentPlacementRow } from './outcome-rows.js';

/**
 * What reconciliation found. **It reports; it repairs nothing.**
 *
 * The *rules* live in the application layer, in `reconciliation.ts`, and this repository reads the
 * rows they need. That is deliberate: expressing them as SQL here would mean the in-memory store
 * and the database answered subtly different questions, and the divergence would only surface as a
 * finding that appeared in one environment and not the other.
 *
 * The reads are bounded by the cycle. A reconciliation over every cycle a tenant has ever run is a
 * report nobody can act on, and it is the query that would fall over first at scale.
 */
export class PostgresReconciliationRepository implements ReconciliationStore {
  public async findings(
    transaction: Transaction,
    cycleId: string,
  ): Promise<readonly ReconciliationFinding[]> {
    const cycles = await transaction.execute<CycleRow>(
      `select ${CYCLE_COLUMNS} from performance_cycle
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [cycleId, transaction.tenantId],
    );
    const cycle = cycles[0];

    if (cycle === undefined) return [];

    const [reviews, templates, components, goals, placements] = await Promise.all([
      transaction.execute<ReviewRow>(
        `select * from performance_review
           where tenant_id = $1 and cycle_id = $2 and deleted_at is null`,
        [transaction.tenantId, cycleId],
      ),
      transaction.execute<TemplateRow>(
        `select * from performance_review_template
           where tenant_id = $1 and id = $2 and deleted_at is null`,
        [transaction.tenantId, cycle.review_template_id],
      ),
      transaction.execute<TemplateComponentRow>(
        `select * from performance_review_template_component
           where tenant_id = $1 and template_id = $2 and deleted_at is null`,
        [transaction.tenantId, cycle.review_template_id],
      ),
      transaction.execute<GoalRow>(
        `select ${GOAL_COLUMNS} from performance_goal
           where tenant_id = $1 and cycle_id = $2 and deleted_at is null`,
        [transaction.tenantId, cycleId],
      ),
      transaction.execute<TalentPlacementRow>(
        `select * from performance_talent_placement
           where tenant_id = $1 and cycle_id = $2 and deleted_at is null`,
        [transaction.tenantId, cycleId],
      ),
    ]);

    return findingsFor({
      cycleId,
      cycles: [cycleState(cycle)],
      reviews: reviews.map(reviewState),
      templates: templates.map(templateState),
      components: components.map(templateComponentState),
      goals: goals.map(goalState),
      placements: placements.map(talentPlacementState),
    });
  }
}
