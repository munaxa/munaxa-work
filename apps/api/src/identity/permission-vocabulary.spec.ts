import { assertValidCheck } from '@munaxa/rbac';
import { ALL_ASSETS_PERMISSIONS } from '@work/assets';
import { ALL_ATTENDANCE_PERMISSIONS } from '@work/attendance';
import { ALL_CAREER_PERMISSIONS } from '@work/career';
import { ALL_COMPENSATION_PERMISSIONS } from '@work/compensation';
import { ALL_DOCUMENTS_PERMISSIONS } from '@work/documents';
import { ALL_EMPLOYMENT_PERMISSIONS } from '@work/employment';
import { ALL_IDENTITY_PERMISSIONS } from '@work/identity';
import { ALL_LEARNING_PERMISSIONS } from '@work/learning';
import { ALL_LEAVE_PERMISSIONS } from '@work/leave';
import { ALL_LETTERS_PERMISSIONS } from '@work/letters';
import { ALL_ONBOARDING_PERMISSIONS } from '@work/onboarding';
import { ALL_ORGANIZATION_PERMISSIONS } from '@work/organization';
import { ALL_PAYROLL_PERMISSIONS } from '@work/payroll';
import { ALL_PEOPLE_PERMISSIONS } from '@work/people';
import { ALL_PERFORMANCE_PERMISSIONS } from '@work/performance';
import { ALL_RECRUITMENT_PERMISSIONS } from '@work/recruitment';
import { ALL_RELATIONS_PERMISSIONS } from '@work/relations';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';
import { describe, expect, it } from 'vitest';

import { toPlatformPermission } from './permission-vocabulary.js';

/**
 * The approved vocabulary decision, asserted over the real declarations rather than over examples.
 *
 * Every module's own list, imported from the module: a suite that retyped the permissions would
 * prove the copy translates and say nothing about the product. A module that adds a permission the
 * seam cannot represent fails here on the day it is added, which is the only moment the mistake is
 * cheap.
 */
const ALL_WORK_PERMISSIONS: readonly string[] = [
  ...ALL_ASSETS_PERMISSIONS,
  ...ALL_ATTENDANCE_PERMISSIONS,
  ...ALL_CAREER_PERMISSIONS,
  ...ALL_COMPENSATION_PERMISSIONS,
  ...ALL_DOCUMENTS_PERMISSIONS,
  ...ALL_EMPLOYMENT_PERMISSIONS,
  ...ALL_IDENTITY_PERMISSIONS,
  ...ALL_LEARNING_PERMISSIONS,
  ...ALL_LEAVE_PERMISSIONS,
  ...ALL_LETTERS_PERMISSIONS,
  ...ALL_ONBOARDING_PERMISSIONS,
  ...ALL_ORGANIZATION_PERMISSIONS,
  ...ALL_PAYROLL_PERMISSIONS,
  ...ALL_PEOPLE_PERMISSIONS,
  ...ALL_PERFORMANCE_PERMISSIONS,
  ...ALL_RECRUITMENT_PERMISSIONS,
  ...ALL_RELATIONS_PERMISSIONS,
  ...ALL_WORKFLOW_PERMISSIONS,
];

describe('the Work to Platform permission vocabulary', () => {
  it('translates every declared permission in the product', () => {
    const untranslatable = ALL_WORK_PERMISSIONS.filter(
      (permission) => toPlatformPermission(permission) === undefined,
    );

    expect(untranslatable).toEqual([]);
    expect(ALL_WORK_PERMISSIONS.length).toBeGreaterThan(0);
  });

  it('produces a string the platform accepts as a check', () => {
    for (const permission of ALL_WORK_PERMISSIONS) {
      const translated = toPlatformPermission(permission);

      expect(translated).toBeDefined();
      // The platform's own validator, not a regular expression this suite wrote. A check it
      // refuses is a check the resolver would refuse at request time.
      expect(() => assertValidCheck(translated as string)).not.toThrow();
    }
  });

  it('never maps two permissions onto one, and never loses one', () => {
    const declared = new Set(ALL_WORK_PERMISSIONS);
    const translated = new Set(
      ALL_WORK_PERMISSIONS.map((permission) => toPlatformPermission(permission)),
    );

    // Injective: as many distinct platform checks as there are distinct Work permissions. If any
    // pair collided, a caller granted one would silently hold the other.
    expect(translated.size).toBe(declared.size);
  });

  it('changes the separator and nothing else', () => {
    for (const permission of ALL_WORK_PERMISSIONS) {
      expect(toPlatformPermission(permission)).toBe(permission.replaceAll('.', ':'));
    }
  });

  it('is reversible, so an administrator still sees the name the product declares', () => {
    for (const permission of ALL_WORK_PERMISSIONS) {
      const translated = toPlatformPermission(permission) as string;

      expect(translated.replaceAll(':', '.')).toBe(permission);
    }
  });

  it.each([
    ['a wildcard, which is a grant shape and never a check', 'documents:*'],
    ['a permission already in the platform vocabulary', 'documents:read'],
    ['an empty permission', ''],
    ['an upper-case segment', 'Documents.read'],
    ['a segment starting with a separator', '.read'],
    ['a segment starting with a dash', 'documents.-read'],
    ['whitespace', 'documents read'],
  ])('refuses %s', (_case, permission) => {
    expect(toPlatformPermission(permission)).toBeUndefined();
  });
});
