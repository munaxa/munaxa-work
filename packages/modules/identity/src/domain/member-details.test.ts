import { unwrap, type EventOrigin } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { BusinessProfile } from './business-profile.js';
import { EmploymentLink } from './employment-link.js';
import { PortalAssignment } from './portal-assignment.js';
import { UserPreference } from './user-preference.js';

const AT = new Date('2026-08-05T10:00:00Z');
const TENANT = '01920000-0000-7000-8000-0000000000aa';
const MEMBERSHIP = '01920000-0000-7000-8000-000000000011';
const EMPLOYMENT = '01920000-0000-7000-8000-000000000022';

const origin: EventOrigin = {
  tenantId: TENANT,
  correlationId: '01920000-0000-7000-8000-0000000000cc',
  actor: 'user:test',
};

describe('PortalAssignment', () => {
  const granted = (): PortalAssignment => {
    const assignment = PortalAssignment.grant(
      { tenantId: TENANT, membershipId: MEMBERSHIP, portal: 'manager' },
      origin,
      AT,
    );
    assignment.pullEvents();
    return assignment;
  };

  it('opens a portal', () => {
    expect(granted().isOpen).toBe(true);
  });

  it('withdraws it without deleting the record', () => {
    const assignment = granted();

    expect(assignment.revoke('moved teams', origin, AT).ok).toBe(true);
    expect(assignment.currentStatus).toBe('revoked');
    // "Who could reach the admin portal last March" is a question a security review asks, and a
    // deleted row answers it with silence.
    expect(assignment.snapshot().grantedAt).toEqual(AT);
    expect(assignment.snapshot().revokedAt).toEqual(AT);
  });

  it('refuses to withdraw one that is already withdrawn', () => {
    const assignment = granted();

    assignment.revoke('moved teams', origin, AT);

    expect(assignment.revoke('again', origin, AT).ok).toBe(false);
  });

  it('reinstates a withdrawn portal rather than creating a second record', () => {
    const assignment = granted();

    assignment.revoke('moved teams', origin, AT);
    expect(assignment.reinstate(origin, AT).ok).toBe(true);
    expect(assignment.isOpen).toBe(true);
    expect(assignment.snapshot().revokedAt).toBeUndefined();
  });

  it('refuses to reinstate one that was never withdrawn', () => {
    expect(granted().reinstate(origin, AT).ok).toBe(false);
  });
});

describe('EmploymentLink', () => {
  const linked = (isPrimary = false): EmploymentLink => {
    const link = EmploymentLink.link(
      { tenantId: TENANT, membershipId: MEMBERSHIP, employmentId: EMPLOYMENT, isPrimary },
      origin,
      AT,
    );
    link.pullEvents();
    return link;
  };

  it('references the employment by identity only', () => {
    expect(linked().employmentId).toBe(EMPLOYMENT);
  });

  it('detaches a job without touching the person (AD-008)', () => {
    const link = linked();

    expect(link.unlink('contract ended', origin, AT).ok).toBe(true);
    expect(link.currentStatus).toBe('unlinked');
    // Nothing on this aggregate refers to the person's account state; ending a job cannot reach
    // it, which is the invariant AD-008 states.
    expect(link.membershipId).toBe(MEMBERSHIP);
  });

  it('stops being primary when detached, so the "one primary" index stays satisfiable', () => {
    const link = linked(true);

    link.unlink('contract ended', origin, AT);

    expect(link.isPrimary).toBe(false);
  });

  it('refuses to detach twice', () => {
    const link = linked();

    link.unlink('contract ended', origin, AT);

    expect(link.unlink('again', origin, AT).ok).toBe(false);
  });

  it('promotes a secondary job to primary', () => {
    const link = linked();

    expect(link.makePrimary(origin, AT).ok).toBe(true);
    expect(link.isPrimary).toBe(true);
  });

  it('refuses to promote one that is already primary', () => {
    expect(linked(true).makePrimary(origin, AT).ok).toBe(false);
  });

  it('refuses to promote a detached job', () => {
    const link = linked();

    link.unlink('contract ended', origin, AT);

    expect(link.makePrimary(origin, AT).ok).toBe(false);
  });

  it('steps down silently when it was not primary', () => {
    const link = linked();

    link.relinquishPrimary(origin, AT);

    expect(link.hasPendingEvents()).toBe(false);
  });
});

describe('BusinessProfile', () => {
  const change = {
    displayName: { en: 'Sara Haddad', ar: 'سارة حداد' },
    jobTitle: { en: 'Head of Finance', ar: 'رئيسة الشؤون المالية' },
  };

  const create = (displayName: Record<string, string> = change.displayName) =>
    BusinessProfile.create(
      { tenantId: TENANT, membershipId: MEMBERSHIP, change: { ...change, displayName } },
      origin,
      AT,
    );

  it('requires a display name in both first-class languages', () => {
    const outcome = create({ en: 'Sara Haddad' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.reason).toBe('business_profile_name_incomplete');
      expect(outcome.error.values?.languages).toBe('ar');
    }
  });

  it('requires an Arabic-only profile to supply English too — neither is the privileged one', () => {
    const outcome = create({ ar: 'سارة حداد' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.values?.languages).toBe('en');
  });

  it('refuses a name that is only whitespace', () => {
    const outcome = create({ en: '   ', ar: '  ' });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe('business_profile_name_required');
  });

  it('renders the name in the reader’s language', () => {
    const profile = unwrap(create());

    expect(profile.nameIn('ar')).toBe('سارة حداد');
    expect(profile.nameIn('en')).toBe('Sara Haddad');
  });

  it('falls back rather than rendering nothing for a language it does not carry', () => {
    const profile = unwrap(create());

    expect(profile.nameIn('fr')).toBe('Sara Haddad');
  });

  it('replaces wholesale, so clearing a field is expressible', () => {
    const profile = unwrap(create());

    profile.revise({ displayName: change.displayName }, origin, AT);

    expect(profile.titleIn('en')).toBeUndefined();
  });

  it('round-trips through storage', () => {
    const profile = unwrap(create());
    const rebuilt = BusinessProfile.rehydrate(profile.snapshot());

    expect(rebuilt.nameIn('ar')).toBe('سارة حداد');
    expect(rebuilt.titleIn('ar')).toBe('رئيسة الشؤون المالية');
  });
});

describe('UserPreference', () => {
  const defaults = {
    language: 'ar',
    calendar: 'hijri' as const,
    timeZone: 'Asia/Riyadh',
    numerals: 'arabic-indic' as const,
  };

  const seeded = (): UserPreference => {
    const preference = UserPreference.fromTenantDefaults(
      { tenantId: TENANT, membershipId: MEMBERSHIP, defaults },
      origin,
      AT,
    );
    preference.pullEvents();
    return preference;
  };

  it('starts from the tenant’s defaults rather than from a constant in the code', () => {
    const preference = seeded();

    expect(preference.language).toBe('ar');
    expect(preference.calendar).toBe('hijri');
    expect(preference.timeZone).toBe('Asia/Riyadh');
  });

  it('derives direction from the language, with no independent toggle', () => {
    const preference = seeded();

    expect(preference.direction).toBe('rtl');

    preference.revise({ language: 'en' }, origin, AT);
    expect(preference.direction).toBe('ltr');
  });

  it('lets an Arabic-speaking member choose Western numerals', () => {
    const preference = seeded();

    preference.revise({ numerals: 'western' }, origin, AT);

    expect(preference.language).toBe('ar');
    expect(preference.numerals).toBe('western');
  });

  it('changes only the fields it was given', () => {
    const preference = seeded();

    preference.revise({ language: 'en' }, origin, AT);

    expect(preference.calendar).toBe('hijri');
    expect(preference.timeZone).toBe('Asia/Riyadh');
  });

  it('refuses an unknown time zone rather than silently becoming UTC', () => {
    const outcome = seeded().revise({ timeZone: 'Mars/Olympus' }, origin, AT);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe('preference_time_zone_unknown');
  });

  it('refuses a language tag that is not one', () => {
    expect(seeded().revise({ language: 'not a language' }, origin, AT).ok).toBe(false);
  });

  it('accepts a regional language tag', () => {
    expect(seeded().revise({ language: 'ar-SA' }, origin, AT).ok).toBe(true);
  });

  it('keeps the previous value when a change is refused', () => {
    const preference = seeded();

    preference.revise({ timeZone: 'Mars/Olympus' }, origin, AT);

    expect(preference.timeZone).toBe('Asia/Riyadh');
  });
});
