import { describe, expect, it } from 'vitest';
import { runInContext, uuidV7, type MachineContext, type TenantContext } from '@work/kernel';

import { auditForInsert, auditForUpdate } from './repository.js';

/**
 * What the audit columns say when a machine wrote the row.
 *
 * These live here rather than in the kernel because `auditForInsert` is this package's, and a test
 * that reached the other way would put a cycle between the two.
 *
 * The property under test is narrow and important: automatic work is attributable **without a
 * membership existing anywhere**. A row whose `created_by` named a person nobody could point to
 * would be worse than one that named nothing.
 */

const machine = (): MachineContext => ({
  machine: true,
  tenantId: uuidV7(),
  executionIdentity: 'service:workflow-reminders',
  jobId: 'job-1',
  attempt: 2,
  correlationId: uuidV7(),
});

const person = (): TenantContext => ({
  tenantId: uuidV7(),
  actor: 'user:tester',
  correlationId: uuidV7(),
});

const AT = new Date('2026-08-20T09:00:00.000Z');

describe('audit columns under a machine context', () => {
  it('records the platform subject, on insert and on update alike', () => {
    const context = machine();

    const inserted = runInContext(context, () => auditForInsert(AT));
    const updated = runInContext(context, () => auditForUpdate(AT));

    expect([inserted.created_by, inserted.updated_by, updated.updated_by]).toStrictEqual([
      'service:workflow-reminders',
      'service:workflow-reminders',
      'service:workflow-reminders',
    ]);
  });

  it('records nothing that could be mistaken for a person', () => {
    const audit = runInContext(machine(), () => auditForInsert(AT));

    expect(audit.created_by.startsWith('user:')).toBe(false);
    // A membership is a uuid; the subject is deliberately not one, so no join can accidentally
    // resolve it to somebody.
    expect(audit.created_by).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('leaves a person unchanged, so the machine path is an addition and not a substitution', () => {
    const audit = runInContext(person(), () => auditForInsert(AT));

    expect(audit.created_by).toBe('user:tester');
  });

  it('still names the system context by its reason, which the machine did not displace', () => {
    const audit = runInContext({ system: true, reason: 'migration', correlationId: uuidV7() }, () =>
      auditForInsert(AT),
    );

    expect(audit.created_by).toBe('system:migration');
  });

  it('writes the same three kinds of subject and no fourth', () => {
    const subjects = [
      runInContext(machine(), () => auditForInsert(AT)).created_by,
      runInContext(person(), () => auditForInsert(AT)).created_by,
      runInContext({ system: true, reason: 'migration', correlationId: uuidV7() }, () =>
        auditForInsert(AT),
      ).created_by,
      auditForInsert(AT).created_by,
    ];

    expect(subjects).toStrictEqual([
      'service:workflow-reminders',
      'user:tester',
      'system:migration',
      'system:unknown',
    ]);
  });
});
