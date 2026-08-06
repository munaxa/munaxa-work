import { uuidV7, type EventOrigin } from '@work/kernel';

import { OrganizationAggregate } from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';

/**
 * One tenant's own defaults: the language its people see first, the calendar its dates are
 * entered in, its time zone, its numerals, and how long an invitation stays open.
 *
 * This aggregate exists to close the debt Phase 2 recorded and named Phase 3 the owner of.
 * Workforce Identity has always asked for these through a port; what it got was the
 * *deployment's* environment variables, which meant every customer in a deployment shared one
 * language and one calendar. That is not a limitation you can sell around in this market — a
 * hosting arrangement with a Riyadh customer and an Amman customer in it had to pick one of
 * them — and Organization is the module that finally has somewhere to keep the answer.
 *
 * Organization owns it rather than Identity for a reason worth stating: these are properties of
 * *the customer's organization*, not of anybody's identity. Identity consumes them, as Attendance
 * and Payroll will, through the same port. Identity's use cases did not change to accommodate
 * this, and that is the evidence the port was drawn in the right place.
 *
 * Nothing here has a hardcoded business default. A tenant with no row falls back to the
 * deployment's configuration, which is itself validated configuration and not a constant in
 * source (00B) — see `StoredTenantSettings`.
 */

export const CALENDAR_SYSTEMS = ['gregorian', 'hijri'] as const;
export type TenantCalendar = (typeof CALENDAR_SYSTEMS)[number];

export const NUMERAL_SYSTEMS = ['western', 'arabic-indic'] as const;
export type TenantNumerals = (typeof NUMERAL_SYSTEMS)[number];

export interface TenantSettingsState {
  readonly id: string;
  readonly tenantId: string;
  readonly language: string;
  readonly calendar: TenantCalendar;
  readonly timeZone: string;
  readonly numerals: TenantNumerals;
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly string[];
  readonly version: number;
}

export interface ConfigureTenantSettings {
  readonly tenantId: string;
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly numerals: string;
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly string[];
}

/** Long enough for somebody on leave to come back; short enough to still be a decision. */
const VALIDITY_CEILING_DAYS = 365;

export class TenantSettings extends OrganizationAggregate {
  private constructor(private state: TenantSettingsState) {
    super(state.id, state.tenantId, state.version, 'TenantSettings');
  }

  public static configure(
    request: ConfigureTenantSettings,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<TenantSettings> {
    const checked = check(request);

    if (!checked.ok) return checked;

    const settings = new TenantSettings({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      language: request.language,
      calendar: checked.value.calendar,
      timeZone: request.timeZone,
      numerals: checked.value.numerals,
      invitationValidityDays: request.invitationValidityDays,
      defaultPortals: [...new Set(request.defaultPortals)],
      version: 0,
    });

    settings.raiseConfigured(origin, occurredAt);
    return accept(settings);
  }

  public static rehydrate(state: TenantSettingsState): TenantSettings {
    return new TenantSettings(state);
  }

  public get language(): string {
    return this.state.language;
  }

  public get calendar(): TenantCalendar {
    return this.state.calendar;
  }

  /** Replaces the settings wholesale, which is what a settings screen submits. */
  public reconfigure(
    request: ConfigureTenantSettings,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<TenantSettingsState> {
    const checked = check(request);

    if (!checked.ok) return checked;

    this.state = {
      ...this.state,
      language: request.language,
      calendar: checked.value.calendar,
      timeZone: request.timeZone,
      numerals: checked.value.numerals,
      invitationValidityDays: request.invitationValidityDays,
      defaultPortals: [...new Set(request.defaultPortals)],
    };
    this.raiseConfigured(origin, occurredAt);
    return accept(this.state);
  }

  public snapshot(): TenantSettingsState {
    return { ...this.state, version: this.version };
  }

  private raiseConfigured(origin: EventOrigin, occurredAt: Date): void {
    this.raise(
      OrganizationEvents.tenantSettingsConfigured,
      {
        settingsId: this.id,
        language: this.state.language,
        calendar: this.state.calendar,
        timeZone: this.state.timeZone,
      },
      origin,
      occurredAt,
    );
  }
}

interface CheckedSettings {
  readonly calendar: TenantCalendar;
  readonly numerals: TenantNumerals;
}

/**
 * The language is checked as a well-formed BCP 47 tag rather than against a list of languages
 * this product supports. Arabic and English are first-class in the *catalogues*; the tenant
 * default is still a tag, and refusing an unlisted one here would make adding a third language a
 * change to this file.
 */
const check = (request: ConfigureTenantSettings): OrganizationResult<CheckedSettings> => {
  if (!isLanguageTag(request.language)) {
    return refuse('language_tag_malformed', { language: request.language });
  }
  if (!isCalendar(request.calendar)) {
    return refuse('calendar_system_unknown', { calendar: request.calendar });
  }
  if (!isNumerals(request.numerals)) {
    return refuse('numeral_system_unknown', { numerals: request.numerals });
  }
  if (!isTimeZone(request.timeZone)) {
    return refuse('time_zone_unknown', { timeZone: request.timeZone });
  }
  if (
    !Number.isInteger(request.invitationValidityDays) ||
    request.invitationValidityDays < 1 ||
    request.invitationValidityDays > VALIDITY_CEILING_DAYS
  ) {
    return refuse('invitation_validity_out_of_range', { limit: String(VALIDITY_CEILING_DAYS) });
  }
  return accept({ calendar: request.calendar, numerals: request.numerals });
};

const isLanguageTag = (value: string): boolean => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);

const isCalendar = (value: string): value is TenantCalendar =>
  (CALENDAR_SYSTEMS as readonly string[]).includes(value);

const isNumerals = (value: string): value is TenantNumerals =>
  (NUMERAL_SYSTEMS as readonly string[]).includes(value);

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
