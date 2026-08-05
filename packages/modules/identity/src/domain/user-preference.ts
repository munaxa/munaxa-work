import { directionOf, uuidV7, type CalendarSystem, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import { NUMERAL_SYSTEMS, type NumeralSystem } from './identity-vocabulary.js';

/**
 * How one member wants this tenant's product rendered for them: language, calendar, time zone,
 * numerals.
 *
 * Every field is a *preference with a tenant default behind it*, never a hardcoded value. A
 * tenant in Riyadh defaults to Arabic and Hijri; one in Amman may default to Arabic and
 * Gregorian; a member of either may want English. The framework requires all of these to be
 * configurable, and the only way to keep that true is for the defaults to arrive as
 * configuration rather than be written here.
 *
 * Direction is derived, not stored. It follows the language — always, with no user toggle —
 * because a right-to-left language rendered left to right is not a preference somebody holds,
 * it is a broken screen.
 */

export interface UserPreferenceState {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly language: string;
  readonly calendar: CalendarSystem;
  readonly timeZone: string;
  readonly numerals: NumeralSystem;
  readonly version: number;
}

export interface PreferenceDefaults {
  readonly language: string;
  readonly calendar: CalendarSystem;
  readonly timeZone: string;
  readonly numerals: NumeralSystem;
}

export interface PreferenceChange {
  readonly language?: string;
  readonly calendar?: CalendarSystem;
  readonly timeZone?: string;
  readonly numerals?: NumeralSystem;
}

const LANGUAGE_TAG = /^[a-z]{2}(-[A-Za-z0-9]{2,8})*$/;

export class UserPreference extends TenantScopedAggregate {
  private constructor(
    id: string,
    tenantId: string,
    public readonly membershipId: string,
    private settings: PreferenceDefaults,
    version: number,
  ) {
    super(id, tenantId, version, 'UserPreference');
  }

  /** Creates a member's preferences from the tenant's defaults, which they may then override. */
  public static fromTenantDefaults(
    request: {
      readonly tenantId: string;
      readonly membershipId: string;
      readonly defaults: PreferenceDefaults;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): UserPreference {
    const preference = new UserPreference(
      uuidV7(occurredAt.getTime()),
      request.tenantId,
      request.membershipId,
      request.defaults,
      0,
    );

    preference.publish(origin, occurredAt);
    return preference;
  }

  public static rehydrate(state: UserPreferenceState): UserPreference {
    return new UserPreference(
      state.id,
      state.tenantId,
      state.membershipId,
      {
        language: state.language,
        calendar: state.calendar,
        timeZone: state.timeZone,
        numerals: state.numerals,
      },
      state.version,
    );
  }

  public get language(): string {
    return this.settings.language;
  }

  public get calendar(): CalendarSystem {
    return this.settings.calendar;
  }

  public get timeZone(): string {
    return this.settings.timeZone;
  }

  public get numerals(): NumeralSystem {
    return this.settings.numerals;
  }

  /** Derived from the language, never stored and never toggled independently of it. */
  public get direction(): 'ltr' | 'rtl' {
    return directionOf(this.settings.language);
  }

  /**
   * Applies the fields the member actually changed.
   *
   * Each is validated rather than accepted: an unknown time zone silently becomes UTC in most
   * date libraries, and a shift roster an hour out is not a bug anybody attributes to a
   * preferences screen.
   */
  public revise(
    change: PreferenceChange,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<UserPreference> {
    const invalid = firstInvalid(change);

    if (invalid !== undefined) return refuse(invalid.reason, invalid.values);

    this.settings = {
      language: change.language ?? this.settings.language,
      calendar: change.calendar ?? this.settings.calendar,
      timeZone: change.timeZone ?? this.settings.timeZone,
      numerals: change.numerals ?? this.settings.numerals,
    };
    this.publish(origin, occurredAt);
    return accept(this);
  }

  public snapshot(): UserPreferenceState {
    return {
      id: this.id,
      tenantId: this.tenantId,
      membershipId: this.membershipId,
      ...this.settings,
      version: this.version,
    };
  }

  private publish(origin: EventOrigin, occurredAt: Date): void {
    this.raise(
      IdentityEvents.userPreferenceUpdated,
      {
        preferenceId: this.id,
        membershipId: this.membershipId,
        ...this.settings,
        direction: this.direction,
      },
      origin,
      occurredAt,
    );
  }
}

/** The IANA database the runtime carries is the authority; we do not ship a list of our own. */
export const isKnownTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const firstInvalid = (
  change: PreferenceChange,
): { reason: string; values?: Record<string, string> } | undefined => {
  if (change.language !== undefined && !LANGUAGE_TAG.test(change.language)) {
    return { reason: 'preference_language_invalid', values: { language: change.language } };
  }
  if (change.timeZone !== undefined && !isKnownTimeZone(change.timeZone)) {
    return { reason: 'preference_time_zone_unknown', values: { timeZone: change.timeZone } };
  }
  if (change.numerals !== undefined && !NUMERAL_SYSTEMS.includes(change.numerals)) {
    return { reason: 'preference_numerals_invalid', values: { numerals: change.numerals } };
  }
  return undefined;
};
