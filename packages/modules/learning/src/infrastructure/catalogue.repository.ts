import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CourseState, CourseVersionState } from '../domain/course.js';
import type {
  CourseCategoryState,
  CourseCategoryStore,
  CourseFilters,
  CourseStore,
  CourseVersionStore,
  Page,
  Paged,
} from '../application/learning-ports.js';
import {
  CATEGORY_COLUMNS,
  VERSION_COLUMNS,
  categoryState,
  categoryValues,
  courseColumns,
  courseState,
  courseValues,
  courseVersionState,
  courseVersionValues,
  type CategoryRow,
  type CourseRow,
  type CourseVersionRow,
} from './catalogue-rows.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * The catalogue, as tables.
 *
 * **Two of these repositories do not extend `Repository`, and that is the whole point.** Extending
 * it would bring `updateRow` and `softDeleteRow` with it, and neither may exist for a course version
 * or an assessment result: a version is what a completed enrolment points at (AD-004), and a result
 * is what an assessor saw on a day. A trigger refuses the same operations at the table, from any
 * path including SQL nobody wrote in TypeScript; this is the same rule expressed where a developer
 * meets it first.
 *
 * No business rule lives here. These map rows and run statements the application layer asked for.
 */

export class PostgresCategoryRepository
  extends Repository<CategoryRow & { version: number }>
  implements CourseCategoryStore
{
  public constructor() {
    super('learning_course_category');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CourseCategoryState | undefined> {
    const rows = await transaction.execute<CategoryRow>(
      `select ${CATEGORY_COLUMNS} from learning_course_category
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : categoryState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CourseCategoryState | undefined> {
    const rows = await transaction.execute<CategoryRow>(
      `select ${CATEGORY_COLUMNS} from learning_course_category
         where code = $1 and tenant_id = $2 and deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : categoryState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly CourseCategoryState[]> {
    const rows = await transaction.execute<CategoryRow>(
      `select ${CATEGORY_COLUMNS} from learning_course_category
         where tenant_id = $1 and deleted_at is null order by code`,
      [transaction.tenantId],
    );

    return rows.map(categoryState);
  }

  public insert(transaction: Transaction, state: CourseCategoryState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      categoryValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

export class PostgresCourseRepository
  extends Repository<CourseRow & { version: number }>
  implements CourseStore
{
  public constructor() {
    super('learning_course');
  }

  public async byId(transaction: Transaction, id: string): Promise<CourseState | undefined> {
    const rows = await transaction.execute<CourseRow>(
      `select ${courseColumns('c')} from learning_course c
         where c.id = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : courseState(rows[0]);
  }

  public async byCode(transaction: Transaction, code: string): Promise<CourseState | undefined> {
    const rows = await transaction.execute<CourseRow>(
      `select ${courseColumns('c')} from learning_course c
         where c.code = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : courseState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: CourseFilters,
    paged: Paged,
  ): Promise<Page<CourseState>> {
    const predicate = predicateFor('c', transaction.tenantId, courseFilters(filters));

    return pageOf<CourseRow, CourseState>(
      transaction,
      {
        select: `select ${courseColumns('c')} from learning_course c
                   where ${predicate.clause}
                   order by c.code
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from learning_course c where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      courseState,
    );
  }

  public insert(transaction: Transaction, state: CourseState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      courseValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: CourseState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.courseId,
      expected,
      mutable(courseValues(state, transaction.tenantId)),
    );
  }
}

const courseFilters = (filters: CourseFilters): readonly Filter[] => [
  { column: 'c.status', value: filters.status },
  { column: 'c.delivery', value: filters.delivery },
  { column: 'c.category_id', value: filters.categoryId },
];

/**
 * Course versions: insert and read, and nothing else.
 *
 * There is no update method and no delete method, because AD-004 says historical versions remain
 * available and an editable version would make every enrolment pinned to it a record of something
 * that may since have changed. Correcting a course publishes version 4.
 */
export class PostgresCourseVersionRepository implements CourseVersionStore {
  public async byId(transaction: Transaction, id: string): Promise<CourseVersionState | undefined> {
    const rows = await transaction.execute<CourseVersionRow>(
      `select ${VERSION_COLUMNS} from learning_course_version
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : courseVersionState(rows[0]);
  }

  public async forCourse(
    transaction: Transaction,
    courseId: string,
  ): Promise<readonly CourseVersionState[]> {
    const rows = await transaction.execute<CourseVersionRow>(
      `select ${VERSION_COLUMNS} from learning_course_version
         where course_id = $1 and tenant_id = $2 and deleted_at is null
         order by version_number desc`,
      [courseId, transaction.tenantId],
    );

    return rows.map(courseVersionState);
  }

  public async highestVersionNumber(transaction: Transaction, courseId: string): Promise<number> {
    // `coalesce(max(...), 0)` rather than a count: a soft-deleted version still occupies its number
    // in the unique index, and counting the live ones would propose a number already taken.
    const rows = await transaction.execute<{ highest: string }>(
      `select coalesce(max(version_number), 0)::text as highest from learning_course_version
         where course_id = $1 and tenant_id = $2`,
      [courseId, transaction.tenantId],
    );

    return Number(rows[0]?.highest ?? '0');
  }

  public insert(transaction: Transaction, state: CourseVersionState): Promise<void> {
    return insertRow(
      transaction,
      'learning_course_version',
      courseVersionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
