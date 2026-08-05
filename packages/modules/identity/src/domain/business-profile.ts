import { LocalizedText, uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';

/**
 * How one tenant knows one of its members: the name on the org chart, the work address, the
 * title on a letter.
 *
 * It is tenant-scoped, and that is the point. The same person is "Sara Haddad — Head of Finance"
 * at one customer and "S. Haddad — Consultant" at another, and neither customer has any business
 * seeing the other's version. Keeping the profile here rather than on `WorkforceUser` is what
 * lets row-level security protect it, and it is why the tenant-less user row holds nothing worth
 * protecting (ADR-0033).
 *
 * It is **not** the person's identity. Legal name, date of birth, nationality and identity
 * documents belong to Person, in Phase 4, and this module will not acquire them: two modules
 * that both hold a legal name produce two answers on a contract (ADR-0004). What lives here is
 * the business-facing presentation of somebody who works with this tenant.
 *
 * Names and titles are `LocalizedText` because Arabic and English are both first-class. An
 * employee whose Arabic name renders as a transliteration of their English one on a payslip is
 * a defect, not a formatting preference.
 */

export interface BusinessProfileState {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly displayName: Readonly<Record<string, string>>;
  readonly jobTitle?: Readonly<Record<string, string>>;
  readonly businessEmail?: string;
  readonly businessPhone?: string;
  readonly version: number;
}

export interface BusinessProfileChange {
  readonly displayName: Readonly<Record<string, string>>;
  readonly jobTitle?: Readonly<Record<string, string>>;
  readonly businessEmail?: string;
  readonly businessPhone?: string;
}

/** The languages a profile must carry before it can be saved (00B: both are first-class). */
export const REQUIRED_PROFILE_LANGUAGES = ['en', 'ar'] as const;

export class BusinessProfile extends TenantScopedAggregate {
  private constructor(private state: BusinessProfileState) {
    super(state.id, state.tenantId, state.version, 'BusinessProfile');
  }

  public static create(
    request: {
      readonly tenantId: string;
      readonly membershipId: string;
      readonly change: BusinessProfileChange;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<BusinessProfile> {
    const validated = readChange(request.change);

    if (!validated.ok) return validated;

    const profile = new BusinessProfile({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      membershipId: request.membershipId,
      ...validated.value,
      version: 0,
    });

    profile.publish(origin, occurredAt);
    return accept(profile);
  }

  public static rehydrate(state: BusinessProfileState): BusinessProfile {
    return new BusinessProfile(state);
  }

  public get membershipId(): string {
    return this.state.membershipId;
  }

  public nameIn(language: string, fallback = 'en'): string {
    return LocalizedText.of(this.state.displayName).in(language, fallback);
  }

  public titleIn(language: string, fallback = 'en'): string | undefined {
    return this.state.jobTitle === undefined
      ? undefined
      : LocalizedText.of(this.state.jobTitle).in(language, fallback);
  }

  /** Replaces the profile wholesale. A partial update makes "clear this field" unexpressible. */
  public revise(
    change: BusinessProfileChange,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<BusinessProfile> {
    const validated = readChange(change);

    if (!validated.ok) return validated;

    this.state = {
      id: this.state.id,
      tenantId: this.state.tenantId,
      membershipId: this.state.membershipId,
      ...validated.value,
      version: this.state.version,
    };
    this.publish(origin, occurredAt);
    return accept(this);
  }

  public snapshot(): BusinessProfileState {
    return { ...this.state, version: this.version };
  }

  private publish(origin: EventOrigin, occurredAt: Date): void {
    this.raise(
      IdentityEvents.businessProfileUpdated,
      {
        profileId: this.id,
        membershipId: this.state.membershipId,
        displayName: this.state.displayName,
      },
      origin,
      occurredAt,
    );
  }
}

/** The stored shape of a change, once its names have been checked. */
type ValidatedChange = Omit<BusinessProfileState, 'id' | 'tenantId' | 'membershipId' | 'version'>;

/**
 * Validates a whole change at once, so the aggregate never holds a half-applied revision — a
 * new name with the previous job title would be a profile nobody asked for.
 */
const readChange = (change: BusinessProfileChange): IdentityResult<ValidatedChange> => {
  const names = readNames(change.displayName);

  if (!names.ok) return names;

  const title = titleOf(change.jobTitle);
  const email = change.businessEmail?.trim();
  const phone = change.businessPhone?.trim();

  return accept({
    displayName: names.value.toJSON(),
    ...(title === undefined ? {} : { jobTitle: title.toJSON() }),
    ...(email === undefined || email === '' ? {} : { businessEmail: email }),
    ...(phone === undefined || phone === '' ? {} : { businessPhone: phone }),
  });
};

/**
 * A display name must exist in both first-class languages before it is stored.
 *
 * Refusing here rather than falling back is what stops the failure everybody recognizes: an
 * org chart that reads correctly in English and shows Latin characters in the middle of an
 * Arabic page, forever, because nobody was ever asked for the second name.
 */
const readNames = (values: Readonly<Record<string, string>>): IdentityResult<LocalizedText> => {
  const provided = Object.entries(values).filter(([, text]) => text.trim() !== '');

  if (provided.length === 0) return refuse('business_profile_name_required');

  const text = LocalizedText.of(Object.fromEntries(provided));
  const missing = text.missingFrom([...REQUIRED_PROFILE_LANGUAGES]);

  return missing.length === 0
    ? accept(text)
    : refuse('business_profile_name_incomplete', { languages: missing.join(', ') });
};

const titleOf = (
  values: Readonly<Record<string, string>> | undefined,
): LocalizedText | undefined =>
  values === undefined || Object.values(values).every((text) => text.trim() === '')
    ? undefined
    : LocalizedText.of(values);
