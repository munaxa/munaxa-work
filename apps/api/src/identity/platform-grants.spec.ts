import { describe, expect, it } from 'vitest';

import {
  platformGrantFor,
  workGrantsFrom,
  workPermissionFrom,
  type DroppedGrant,
} from './platform-grants.js';
import { WORK_PERMISSION_CATALOGUE, workPermissionCatalogue } from './work-permission-catalogue.js';

/**
 * The translation between Platform's grant language and Work's permission vocabulary (ADR-0076).
 *
 * The mapping tests run over **every declared permission** rather than over examples. A contract
 * asserted on three names is a contract that holds for three names; the properties that matter —
 * total, injective, reversible, catalogue-closed — are properties of all 285 or they are not
 * properties at all.
 */

const CATALOGUE = workPermissionCatalogue();
const grant = platformGrantFor;

const collected = (): {
  readonly dropped: DroppedGrant[];
  readonly onDropped: (d: DroppedGrant) => void;
} => {
  const dropped: DroppedGrant[] = [];
  return { dropped, onDropped: (d) => dropped.push(d) };
};

describe('the mapping, over every permission Work declares', () => {
  it('covers all 285', () => {
    expect(CATALOGUE).toHaveLength(285);
  });

  it('maps every permission into the reserved work: namespace', () => {
    expect(CATALOGUE.filter((p) => !grant(p).startsWith('work:'))).toEqual([]);
  });

  it('is reversible for every one of them', () => {
    const wrong = CATALOGUE.filter((p) => {
      const read = workPermissionFrom(grant(p));
      return !('permission' in read) || read.permission !== p;
    });

    expect(wrong).toEqual([]);
  });

  it('collides for none of them', () => {
    expect(new Set(CATALOGUE.map(grant)).size).toBe(CATALOGUE.length);
  });

  it('handles the three four-segment permissions with no loss', () => {
    const four = CATALOGUE.filter((p) => p.split('.').length === 4);

    expect(four).toHaveLength(3);
    for (const p of four) {
      expect(grant(p)).toBe(`work:${p.replaceAll('.', ':')}`);
      expect(workPermissionFrom(grant(p))).toEqual({ permission: p });
    }
  });

  it('produces only names that are themselves declared permissions', () => {
    const outside = CATALOGUE.map(grant)
      .map(workPermissionFrom)
      .filter((read) => !('permission' in read && WORK_PERMISSION_CATALOGUE.has(read.permission)));

    expect(outside).toEqual([]);
  });

  it('grants every declared permission when Platform confers the whole catalogue', () => {
    expect(workGrantsFrom(CATALOGUE.map(grant), WORK_PERMISSION_CATALOGUE).size).toBe(285);
  });
});

describe('a grant Platform conferred', () => {
  it('becomes the Work permission it names', () => {
    expect(workGrantsFrom(['work:assets:asset:read'], WORK_PERMISSION_CATALOGUE)).toEqual(
      new Set(['assets.asset.read']),
    );
  });

  it.each([
    ['work:assets:asset:read', 'assets.asset.read'],
    ['work:payroll:finalize', 'payroll.finalize'],
    ['work:people:person:read', 'people.person.read'],
    ['work:leave:read', 'leave.read'],
    ['work:attendance:approve', 'attendance.approve'],
    ['work:workflow:reminder:execute', 'workflow.reminder.execute'],
    ['work:employment:employment:status:change', 'employment.employment.status.change'],
  ])('translates %s to %s', (conferred, expected) => {
    expect(workGrantsFrom([conferred], WORK_PERMISSION_CATALOGUE)).toEqual(new Set([expected]));
  });

  it('grants each permission independently, never a neighbour', () => {
    const granted = workGrantsFrom(['work:assets:asset:read'], WORK_PERMISSION_CATALOGUE);

    expect(granted.has('assets.asset.read')).toBe(true);
    expect(granted.has('assets.asset.manage')).toBe(false);
    expect(granted.has('assets.custody.read')).toBe(false);
  });

  it('keeps several grants distinct', () => {
    expect(
      workGrantsFrom(
        ['work:leave:read', 'work:payroll:read', 'work:assets:asset:read'],
        WORK_PERMISSION_CATALOGUE,
      ),
    ).toEqual(new Set(['leave.read', 'payroll.read', 'assets.asset.read']));
  });
});

describe('a claim that confers nothing', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['not a list', 'work:leave:read'],
    ['an object', { perms: ['work:leave:read'] }],
    ['a number', 7],
  ])('is the empty set: %s', (_description, perms) => {
    expect(workGrantsFrom(perms, WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });

  it('is the empty set when the list is empty', () => {
    expect(workGrantsFrom([], WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });

  it.each([
    ['a Work permission Work does not declare', 'work:payroll:run:delete'],
    ['a plausible but undeclared name', 'work:assets:asset:destroy'],
    ['an entirely invented module', 'work:finance:ledger:post'],
    ['the namespace alone', 'work:'],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('drops %s', (_description, conferred) => {
    expect(workGrantsFrom([conferred], WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });

  it.each([[7], [null], [{}], [['work:leave:read']]])(
    'drops an entry that is not a string: %s',
    (entry) => {
      expect(workGrantsFrom([entry], WORK_PERMISSION_CATALOGUE).size).toBe(0);
    },
  );

  it('drops a Work permission written in Work grammar rather than Platform grammar', () => {
    // Platform records `work:leave:read`. A dot-form grant is not what the contract carries, and
    // accepting it would make two spellings authoritative.
    expect(workGrantsFrom(['leave.read'], WORK_PERMISSION_CATALOGUE).size).toBe(0);
    expect(workGrantsFrom(['work:leave.read'], WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });

  it('keeps the grants it understands alongside those it drops', () => {
    expect(
      workGrantsFrom(
        ['work:leave:read', 'users:read', '*', 'work:nope:nope'],
        WORK_PERMISSION_CATALOGUE,
      ),
    ).toEqual(new Set(['leave.read']));
  });
});

describe("another product's namespace", () => {
  it.each([
    'docs:document:read',
    'school:student:read',
    'tenant:read',
    'users:read',
    'roles:assign',
    'security:policy:update',
    'audit:read',
    'profile:read',
  ])('grants no Work permission: %s', (conferred) => {
    expect(workGrantsFrom([conferred], WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });

  it('reports why, so a misdirected grant is diagnosable', () => {
    const { dropped, onDropped } = collected();
    workGrantsFrom(['docs:document:read'], WORK_PERMISSION_CATALOGUE, onDropped);

    expect(dropped).toEqual([{ grant: 'docs:document:read', reason: 'not-a-work-grant' }]);
  });

  it('is not rescued by containing the word work', () => {
    expect(workGrantsFrom(['workday:leave:read'], WORK_PERMISSION_CATALOGUE).size).toBe(0);
    expect(workGrantsFrom(['notwork:leave:read'], WORK_PERMISSION_CATALOGUE).size).toBe(0);
  });
});

describe('a wildcard', () => {
  it.each(['*', 'work:*', 'work:payroll:*', 'work:assets:*', 'work:assets:asset:*'])(
    'grants nothing: %s',
    (conferred) => {
      expect(workGrantsFrom([conferred], WORK_PERMISSION_CATALOGUE).size).toBe(0);
    },
  );

  it.each(['assets:*', 'documents:*', 'tenant:*', 'users:*', 'roles:*'])(
    'grants nothing from another namespace either: %s',
    (conferred) => {
      expect(workGrantsFrom([conferred], WORK_PERMISSION_CATALOGUE).size).toBe(0);
    },
  );

  it('is never expanded — work:* confers none of the 285, not all of them', () => {
    const granted = workGrantsFrom(['work:*'], WORK_PERMISSION_CATALOGUE);

    expect(granted.size).toBe(0);
    for (const permission of CATALOGUE) expect(granted.has(permission)).toBe(false);
  });

  it('is reported as a wildcard rather than as an unknown permission', () => {
    const { dropped, onDropped } = collected();
    workGrantsFrom(['work:payroll:*'], WORK_PERMISSION_CATALOGUE, onDropped);

    expect(dropped).toEqual([{ grant: 'work:payroll:*', reason: 'wildcard' }]);
  });

  it('does not let a wildcard smuggle a permission in beside it', () => {
    expect(
      workGrantsFrom(['work:payroll:*', 'work:leave:read'], WORK_PERMISSION_CATALOGUE),
    ).toEqual(new Set(['leave.read']));
  });
});

describe('the diagnostic', () => {
  it('names the grant and the reason, and carries nothing else', () => {
    const { dropped, onDropped } = collected();
    workGrantsFrom(['*', 'work:nope:nope', 7], WORK_PERMISSION_CATALOGUE, onDropped);

    expect(dropped).toEqual([
      { grant: '*', reason: 'wildcard' },
      { grant: 'work:nope:nope', reason: 'not-a-declared-permission' },
      { grant: '<not a string>', reason: 'malformed' },
    ]);
    for (const entry of dropped) expect(Object.keys(entry)).toEqual(['grant', 'reason']);
  });

  it('says nothing when every grant was understood', () => {
    const { dropped, onDropped } = collected();
    workGrantsFrom(['work:leave:read'], WORK_PERMISSION_CATALOGUE, onDropped);

    expect(dropped).toEqual([]);
  });
});
