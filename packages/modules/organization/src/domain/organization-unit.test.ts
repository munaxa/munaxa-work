import { describe, expect, it } from 'vitest';

import { OrganizationUnit } from './organization-unit.js';
import { OrganizationUnitType } from './organization-unit-type.js';

/**
 * The nodes of the structure and the levels a tenant defines.
 *
 * The names are deliberately Arabic-first in these tests. A suite written entirely in English
 * would let a hardcoded English default pass every assertion and fail on the first customer.
 */

const origin = { tenantId: 'tenant', correlationId: 'correlation', actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');

const bilingual = { en: 'Riyadh Operations', ar: 'عمليات الرياض' };

const aUnit = (overrides: Partial<Parameters<typeof OrganizationUnit.create>[0]> = {}) =>
  OrganizationUnit.create(
    {
      tenantId: 'tenant',
      unitTypeId: 'type',
      code: 'RUH-OPS',
      name: bilingual,
      effectiveFrom: january,
      ...overrides,
    },
    origin,
    now,
  );

describe('an organizational unit', () => {
  it('is created active, with a name in both first-class languages', () => {
    const created = aUnit();

    expect(created.ok).toBe(true);
    expect(created.ok && created.value.currentStatus).toBe('active');
    expect(created.ok && created.value.code).toBe('RUH-OPS');
  });

  it('refuses a name missing Arabic, because a half-named unit is named forever', () => {
    const created = aUnit({ name: { en: 'Riyadh Operations' } });

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error.reason).toBe('name_requires_both_languages');
    expect(created.ok === false && created.error.values?.['missing']).toBe('ar');
  });

  it('refuses a name missing English for exactly the same reason', () => {
    const created = aUnit({ name: { ar: 'عمليات الرياض' } });

    expect(created.ok === false && created.error.values?.['missing']).toBe('en');
  });

  it('refuses a code that could not survive a payroll file', () => {
    expect(aUnit({ code: 'الرياض' }).ok).toBe(false);
    expect(aUnit({ code: 'has space' }).ok).toBe(false);
    expect(aUnit({ code: 'RUH-OPS_01.a' }).ok).toBe(true);
  });

  it('exists from its effective date and not before', () => {
    const unit = aUnit();

    expect(unit.ok && unit.value.existsOn(new Date('2025-12-31'))).toBe(false);
    expect(unit.ok && unit.value.existsOn(new Date('2026-01-01'))).toBe(true);
    expect(unit.ok && unit.value.existsOn(new Date('2030-01-01'))).toBe(true);
  });

  it('stops existing after it is closed, and the row survives so history still resolves', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    const closed = unit.value.changeStatus('closed', new Date('2026-06-01'), origin, now);

    expect(closed.ok).toBe(true);
    expect(unit.value.existsOn(new Date('2026-03-01'))).toBe(true);
    expect(unit.value.existsOn(new Date('2026-09-01'))).toBe(false);
    expect(unit.value.snapshot().status).toBe('closed');
  });

  it('refuses to close before it existed', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    const closed = unit.value.changeStatus('closed', new Date('2025-06-01'), origin, now);

    expect(closed.ok === false && closed.error.reason).toBe('unit_closed_before_it_existed');
  });

  it('refuses any change once closed', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    unit.value.changeStatus('closed', new Date('2026-06-01'), origin, now);

    expect(unit.value.changeStatus('active', new Date('2026-07-01'), origin, now).ok).toBe(false);
  });

  it('refuses a status change to the status it already holds', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    const changed = unit.value.changeStatus('active', new Date('2026-06-01'), origin, now);

    expect(changed.ok === false && changed.error.reason).toBe('unit_already_in_status');
  });

  it('carries the old name in the rename event, so the change is reconstructible', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    unit.value.pullEvents();
    unit.value.rename(
      { en: 'Central Operations', ar: 'العمليات المركزية' },
      undefined,
      origin,
      now,
    );

    const event = unit.value.pullEvents()[0];

    expect(event?.eventName).toBe('organization.unit.renamed');
    expect(event?.payload).toMatchObject({ from: bilingual });
  });

  it('refuses a rename that would drop a language', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    expect(unit.value.rename({ en: 'Central Operations' }, undefined, origin, now).ok).toBe(false);
  });

  it('stores metadata without interpreting it, and refuses an oversized entry', () => {
    const withMetadata = aUnit({ metadata: { regulatorBranchId: '44-9182' } });

    expect(withMetadata.ok && withMetadata.value.snapshot().metadata).toEqual({
      regulatorBranchId: '44-9182',
    });
    expect(aUnit({ metadata: { key: 'x'.repeat(2000) } }).ok).toBe(false);
  });

  it('does not accept structure once it is inactive', () => {
    const unit = aUnit();

    if (!unit.ok) throw new Error('setup');
    expect(unit.value.canAcceptStructure()).toBe(true);
    unit.value.changeStatus('inactive', new Date('2026-06-01'), origin, now);
    expect(unit.value.canAcceptStructure()).toBe(false);
  });
});

describe('a unit type — the level, which is tenant data (ADR-0034)', () => {
  const aType = (overrides: Partial<Parameters<typeof OrganizationUnitType.define>[0]> = {}) =>
    OrganizationUnitType.define(
      {
        tenantId: 'tenant',
        code: 'department',
        name: { en: 'Department', ar: 'إدارة' },
        ordinal: 60,
        ...overrides,
      },
      origin,
      now,
    );

  it('permits any parent when the tenant has stated no rule', () => {
    const type = aType();

    expect(type.ok && type.value.permitsParent('branch')).toBe(true);
    expect(type.ok && type.value.permitsParent('team')).toBe(true);
  });

  it('permits only the stated parents once the tenant states a rule', () => {
    const type = aType({ allowedParentCodes: ['branch', 'division'] });

    expect(type.ok && type.value.permitsParent('branch')).toBe(true);
    expect(type.ok && type.value.permitsParent('team')).toBe(false);
  });

  it('permits a type to nest inside itself, because large groups genuinely do', () => {
    const type = aType({ code: 'division', allowedParentCodes: ['division'] });

    expect(type.ok && type.value.permitsParent('division')).toBe(true);
  });

  it('answers the root question separately from the parent question', () => {
    const rootable = aType({ allowedAtRoot: true, allowedParentCodes: ['branch'] });
    const notRootable = aType({ allowedAtRoot: false });

    expect(rootable.ok && rootable.value.permitsParent(undefined)).toBe(true);
    expect(notRootable.ok && notRootable.value.permitsParent(undefined)).toBe(false);
  });

  it('refuses a parent rule naming a code that could never exist', () => {
    const type = aType({ allowedParentCodes: ['not a code'] });

    expect(type.ok === false && type.error.reason).toBe('code_malformed');
  });

  it('records whether units of the level carry a legal registration, defaulting to no', () => {
    const ordinary = aType();
    const legal = aType({ code: 'legal-entity', carriesLegalEntity: true });

    expect(ordinary.ok && ordinary.value.carriesLegalEntity).toBe(false);
    expect(legal.ok && legal.value.carriesLegalEntity).toBe(true);
  });

  it('can be retired once, and units already of the level keep it', () => {
    const type = aType();

    if (!type.ok) throw new Error('setup');
    expect(type.value.retire(origin, now).ok).toBe(true);
    expect(type.value.retire(origin, now).ok).toBe(false);
  });
});
