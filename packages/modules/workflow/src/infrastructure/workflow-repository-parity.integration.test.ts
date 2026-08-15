import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  openWorkflowFixture,
  requireDatabaseInCi,
  WORKFLOW_MAPPED_TABLES,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aDefinition, aStartedInstance, anApproval } from './workflow-states.js';
import {
  TEMPLATE_COLUMNS,
  definitionColumns,
  definitionValues,
  templateValues,
  versionColumns,
  versionValues,
} from './workflow-config-rows.js';
import {
  decisionColumns,
  decisionValues,
  historyColumns,
  historyValues,
  instanceColumns,
  instanceValues,
  stepColumns,
  stepValues,
} from './workflow-record-rows.js';
import type { RowValues } from './row-writer.js';

/**
 * The mappers against the schema they map to.
 *
 * Three things can drift apart here and each drifts silently. A column a mapper *reads* that no
 * longer exists fails only when that query runs. A column the database requires that no mapper
 * *writes* fails only on the first insert of that shape. And a column whose SQL type stopped matching
 * the domain's type fails only for the value that happens to expose it — which is how the one finding
 * recorded at the end of this file went unnoticed through two checkpoints.
 *
 * So this suite compares what the mappers name against `information_schema`, in both directions, for
 * every table a mapper covers. It reads the catalogue rather than a copy of the migration, because
 * the catalogue is what the application will actually meet.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository parity suite');

/** The audit columns `insertRow` supplies for every table, on top of the mapper's own. */
const AUDIT = ['created_at', 'created_by', 'updated_at', 'updated_by', 'version'];

/** Columns the database fills in itself, so a mapper is not required to. */
const DEFAULTED = ['id', 'metadata'];

interface ColumnFacts {
  readonly type: string;
  readonly required: boolean;
}

type TableColumns = Map<string, ColumnFacts>;

interface Mapped {
  readonly table: string;
  readonly read: readonly string[];
  readonly written: RowValues;
}

const columnsOf = (selected: string): readonly string[] =>
  selected.split(',').map((column) => column.trim().replace(/^[a-z]+\./, ''));

suite('mapper and schema parity', () => {
  let fixture: WorkflowFixture;
  let catalogue: Map<string, TableColumns>;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_parity_role');

    const { rows } = await fixture.admin.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [WORKFLOW_MAPPED_TABLES],
    );

    catalogue = new Map();
    for (const row of rows) {
      const table: TableColumns = catalogue.get(row.table_name) ?? new Map<string, ColumnFacts>();

      table.set(row.column_name, {
        type: row.data_type,
        required: row.is_nullable === 'NO' && row.column_default === null,
      });
      catalogue.set(row.table_name, table);
    }
  });

  afterAll(async () => {
    await fixture.close();
  });

  /** Every table, with the columns its mapper reads and the values its mapper writes. */
  const mapped = (): readonly Mapped[] => {
    const seed = aStartedInstance();
    const decided = anApproval(seed);
    const tenantId = seed.instance.instanceId;
    const [step] = seed.steps;
    const [entry] = seed.history;
    const [template] = seed.templates;

    if (step === undefined || entry === undefined || template === undefined) {
      throw new Error('The fixture produced an incomplete approval.');
    }
    return [
      {
        table: 'workflow_definition',
        read: columnsOf(definitionColumns('d')),
        // With a description, because a null column would say nothing about the type behind it.
        written: definitionValues(
          aDefinition({ description: { en: 'Raised for a requisition', ar: 'يُرفع لطلب توظيف' } }),
          tenantId,
        ),
      },
      {
        table: 'workflow_version',
        read: columnsOf(versionColumns('v')),
        written: versionValues(seed.version, tenantId),
      },
      {
        table: 'workflow_step_template',
        read: columnsOf(TEMPLATE_COLUMNS),
        written: templateValues(template, tenantId),
      },
      {
        table: 'workflow_instance',
        read: columnsOf(instanceColumns('i')),
        written: instanceValues(seed.instance, tenantId),
      },
      {
        table: 'workflow_step',
        read: columnsOf(stepColumns('s')),
        written: stepValues(step, tenantId),
      },
      {
        table: 'workflow_decision',
        read: columnsOf(decisionColumns('d')),
        written: decisionValues(decided.decision, tenantId),
      },
      {
        table: 'workflow_history',
        read: columnsOf(historyColumns('h')),
        written: historyValues(entry, tenantId),
      },
    ];
  };

  /**
   * The seven tables a mapper covers, which is deliberately not the nine the module owns.
   *
   * Phase 16B Checkpoint 3 is schema only: `workflow_approval_group` and its member table exist,
   * carry their policies and hold their invariants, and **no repository reads or writes them yet**
   * — that is Checkpoint 5. Comparing mappers against all nine would fail for a reason that has
   * nothing to do with drift, which is the one thing this suite exists to detect.
   */
  it('covers every table a repository maps', () => {
    expect(
      mapped()
        .map((one) => one.table)
        .sort(),
    ).toEqual([...WORKFLOW_MAPPED_TABLES].sort());
  });

  it('reads no column the database does not have', () => {
    const missing = mapped().flatMap((one) =>
      one.read
        .filter((column) => !(catalogue.get(one.table)?.has(column) ?? false))
        .map((column) => `${one.table}.${column}`),
    );

    expect(missing).toEqual([]);
  });

  it('writes no column the database does not have', () => {
    const missing = mapped().flatMap((one) =>
      Object.keys(one.written)
        .filter((column) => !(catalogue.get(one.table)?.has(column) ?? false))
        .map((column) => `${one.table}.${column}`),
    );

    expect(missing).toEqual([]);
  });

  /**
   * Every column the database requires is supplied by somebody.
   *
   * By the mapper, or by `insertRow`'s audit columns, or by a default the table declares. A column
   * that is `not null` with no default and no mapper behind it is an insert that fails the first time
   * that table is written — which, for a table only one command touches, can be a long way from here.
   */
  it('supplies every column the database requires', () => {
    const unsupplied = mapped().flatMap((one) => {
      const supplied = new Set([...Object.keys(one.written), ...AUDIT, ...DEFAULTED]);

      return [...(catalogue.get(one.table) ?? new Map<string, ColumnFacts>())]
        .filter(([column, meta]) => meta.required && !supplied.has(column))
        .map(([column]) => `${one.table}.${column}`);
    });

    expect(unsupplied).toEqual([]);
  });

  it('reads back every column it writes, so nothing is written and then invisible', () => {
    const writeOnly = mapped().flatMap((one) => {
      const read = new Set([...one.read, 'tenant_id']);

      return Object.keys(one.written)
        .filter((column) => !read.has(column))
        .map((column) => `${one.table}.${column}`);
    });

    expect(writeOnly).toEqual([]);
  });

  /**
   * **Every `jsonb` column is written as JSON, with no exception.**
   *
   * Checkpoint 5 reported one: `workflow_definition.description` was `jsonb` in the schema while the
   * domain declared a plain `string`, so writing one raised `invalid input syntax for type json`.
   * Checkpoint 6 resolved it by bringing the domain to the schema — `description?: LocalizedName`,
   * matching the `name` beside it and Career's, Learning's and Onboarding's descriptions — and the
   * column was not touched. The expected set is now empty, which is what makes this test a
   * regression lock rather than a record of a defect: a column written as anything other than JSON
   * shows up here by name.
   */
  it('writes JSON into every jsonb column', () => {
    const divergent = mapped().flatMap((one) =>
      Object.entries(one.written)
        .filter(([column]) => catalogue.get(one.table)?.get(column)?.type === 'jsonb')
        .filter(([, value]) => !isJsonText(value))
        .map(([column]) => `${one.table}.${column}`),
    );

    expect(divergent).toEqual([]);
  });

  /** And nothing in this module stores a civil date: every temporal column is an instant. */
  it('declares no date column anywhere in the module', () => {
    const dates = [...catalogue].flatMap(([table, columns]) =>
      [...columns]
        .filter(([, meta]) => meta.type === 'date')
        .map(([column]) => `${table}.${column}`),
    );

    expect(dates).toEqual([]);
  });
});

/** Whether a value is text PostgreSQL would accept into a `jsonb` column. */
const isJsonText = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};
