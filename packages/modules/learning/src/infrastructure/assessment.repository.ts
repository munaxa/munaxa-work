import type { Transaction } from '@work/kernel';

import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { AssessmentResultStore, AssessmentStore } from '../application/learning-ports.js';
import {
  ASSESSMENT_COLUMNS,
  RESULT_COLUMNS,
  assessmentState,
  assessmentValues,
  resultState,
  resultValues,
  type AssessmentRow,
  type ResultRow,
} from './catalogue-rows.js';
import { insertRow } from './row-writer.js';

/**
 * What a course version asks somebody to demonstrate, and what an assessor recorded.
 *
 * **Neither repository extends the shared base**, and for the result that is the whole point:
 * extending it would bring `updateRow` and `softDeleteRow` with it, and what an assessor recorded on
 * a date is a thing that happened. A correction is a new result on the day it was made; a trigger
 * refuses the alternative from any path, including SQL nobody wrote in TypeScript.
 *
 * **Nothing here totals anything.** `raw_mark` is read back as the string it was written as. No
 * query orders by it, sums it or compares it to a threshold, because the specification defines no
 * formula — aggregate scoring is `NOT VERIFIED`, not approximated.
 */

export class PostgresAssessmentRepository implements AssessmentStore {
  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<AssessmentDefinitionState | undefined> {
    const rows = await transaction.execute<AssessmentRow>(
      `select ${ASSESSMENT_COLUMNS} from learning_assessment
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : assessmentState(rows[0]);
  }

  public async forVersion(
    transaction: Transaction,
    courseVersionId: string,
  ): Promise<readonly AssessmentDefinitionState[]> {
    const rows = await transaction.execute<AssessmentRow>(
      `select ${ASSESSMENT_COLUMNS} from learning_assessment
         where course_version_id = $1 and tenant_id = $2 and deleted_at is null
         order by id`,
      [courseVersionId, transaction.tenantId],
    );

    return rows.map(assessmentState);
  }

  public insert(transaction: Transaction, state: AssessmentDefinitionState): Promise<void> {
    return insertRow(
      transaction,
      'learning_assessment',
      assessmentValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

/**
 * Assessment results: insert and read, and nothing else.
 *
 * What an assessor recorded on a date is a thing that happened, and an editable result would make
 * every completion that depended on it unverifiable afterwards. A later result supersedes an
 * earlier one by being later; nothing is overwritten.
 */
export class PostgresAssessmentResultRepository implements AssessmentResultStore {
  public async forEnrolment(
    transaction: Transaction,
    enrolmentId: string,
  ): Promise<readonly AssessmentResultState[]> {
    const rows = await transaction.execute<ResultRow>(
      `select ${RESULT_COLUMNS} from learning_assessment_result
         where enrolment_id = $1 and tenant_id = $2 and deleted_at is null
         order by assessed_on desc, id desc`,
      [enrolmentId, transaction.tenantId],
    );

    return rows.map(resultState);
  }

  public insert(transaction: Transaction, state: AssessmentResultState): Promise<void> {
    return insertRow(
      transaction,
      'learning_assessment_result',
      resultValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
