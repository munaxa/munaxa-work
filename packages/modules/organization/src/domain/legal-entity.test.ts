import { describe, expect, it } from 'vitest';

import { LegalEntity } from './legal-entity.js';

/**
 * The legal entity, and the country it carries.
 *
 * These tests exist because Phase 11.1 depends on this being right. 00B is explicit that an
 * employment resolves its country pack from its legal entity and never from the tenant, so the
 * properties worth asserting are the ones that would silently produce a wrong statutory
 * calculation rather than a visible error: that a country is required, that it is validated by
 * shape and never against a list, and that it cannot be changed afterwards.
 *
 * Two countries appear here deliberately, in the same tenant. A suite that only ever registered
 * one entity would pass just as happily for a design that put the country on the tenant.
 */

const origin = { tenantId: 'tenant', correlationId: 'correlation', actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');

const register = (overrides: Partial<Parameters<typeof LegalEntity.register>[0]> = {}) =>
  LegalEntity.register(
    {
      tenantId: 'tenant',
      unitId: 'unit',
      countryCode: 'SA',
      registeredName: { en: 'Munaxa Arabia Ltd', ar: 'مناكسا العربية المحدودة' },
      registrationNumber: '1010123456',
      currencyCode: 'SAR',
      effectiveFrom: january,
      ...overrides,
    },
    origin,
    now,
  );

describe('a legal entity', () => {
  it('carries the country an employment beneath it is governed by', () => {
    const entity = register();

    expect(entity.ok && entity.value.countryCode).toBe('SA');
    expect(entity.ok && entity.value.currencyCode).toBe('SAR');
  });

  it('accepts any well-formed country code, because the list of countries is not ours', () => {
    // No enumeration anywhere: adding a market must never be a change to this module (00B).
    for (const country of ['SA', 'JO', 'AE', 'KW', 'QA', 'EG', 'OM', 'BH', 'ZZ']) {
      expect(register({ countryCode: country }).ok).toBe(true);
    }
  });

  it('refuses something that is not a country code at all', () => {
    const entity = register({ countryCode: 'SAU' });

    expect(entity.ok === false && entity.error.reason).toBe('country_code_malformed');
  });

  it('refuses something that is not a currency code', () => {
    expect(register({ currencyCode: 'SR' }).ok).toBe(false);
    expect(register({ currencyCode: 'JOD' }).ok).toBe(true);
  });

  it('publishes the country on registration, which is how the statutory layer learns of it', () => {
    const entity = register({ countryCode: 'JO', currencyCode: 'JOD' });

    if (!entity.ok) throw new Error('setup');
    const event = entity.value.pullEvents()[0];

    expect(event?.eventName).toBe('organization.legal-entity.registered');
    expect(event?.payload).toMatchObject({ countryCode: 'JO', currencyCode: 'JOD' });
  });

  it('requires a registered name in both first-class languages', () => {
    expect(register({ registeredName: { en: 'Munaxa Arabia Ltd' } }).ok).toBe(false);
  });

  it('requires a registration number', () => {
    const entity = register({ registrationNumber: '   ' });

    expect(entity.ok === false && entity.error.reason).toBe('registration_number_malformed');
  });

  it('will not change its country, because that would recompute history under the wrong law', () => {
    const entity = register();

    if (!entity.ok) throw new Error('setup');
    // There is no parameter for it. An entity that changed country is a different registration
    // under a different law; amending this one would silently recompute every past end-of-service
    // figure against rules that never applied to it.
    entity.value.amend({ registrationNumber: '1010999999' }, origin, now);

    expect(entity.value.countryCode).toBe('SA');
    expect(entity.value.snapshot().registrationNumber).toBe('1010999999');
  });

  it('changes its currency, which is an ordinary redenomination and not a change of law', () => {
    const entity = register();

    if (!entity.ok) throw new Error('setup');
    expect(entity.value.amend({ currencyCode: 'USD' }, origin, now).ok).toBe(true);
    expect(entity.value.currencyCode).toBe('USD');
    expect(entity.value.amend({ currencyCode: 'US' }, origin, now).ok).toBe(false);
  });

  it('governs only while it exists, so a closed registration stops answering for later dates', () => {
    const entity = register();

    if (!entity.ok) throw new Error('setup');
    entity.value.close(new Date('2026-06-01'), origin, now);

    expect(entity.value.existsOn(new Date('2026-03-01'))).toBe(true);
    expect(entity.value.existsOn(new Date('2026-09-01'))).toBe(false);
    expect(entity.value.existsOn(new Date('2025-12-01'))).toBe(false);
  });

  it('refuses to be amended or closed twice once closed', () => {
    const entity = register();

    if (!entity.ok) throw new Error('setup');
    entity.value.close(new Date('2026-06-01'), origin, now);

    expect(entity.value.amend({ taxIdentifier: '300000' }, origin, now).ok).toBe(false);
    expect(entity.value.close(new Date('2026-07-01'), origin, now).ok).toBe(false);
  });

  it('refuses to close before it was registered', () => {
    const entity = register();

    if (!entity.ok) throw new Error('setup');
    const closed = entity.value.close(new Date('2025-06-01'), origin, now);

    expect(closed.ok === false && closed.error.reason).toBe(
      'legal_entity_closed_before_it_existed',
    );
  });
});
