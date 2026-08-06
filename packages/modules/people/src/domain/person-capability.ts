import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedCode, nameFrom, type BilingualName } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import {
  LANGUAGE_PROFICIENCIES,
  SKILL_LEVELS,
  isLanguageTag,
  type CapabilityKind,
} from './people-vocabulary.js';
import { PersonRecord, type PersonRecordState } from './person-record.js';

/**
 * What a person can do: a language they speak, or a skill they hold.
 *
 * One aggregate for both because they are the same shape and the same lifecycle — a claim, a
 * level on an ordered scale, and a withdrawal when it stops being true. Two classes differing
 * only in the name of their scale would be two places to fix the next rule that applies to both.
 *
 * **These are self-declared claims, not assessments.** Learning (Phase 14) owns assessment,
 * accreditation and the evidence behind a rating; Performance (Phase 13) owns whether somebody is
 * good at their job. What this module records is what the person says about themselves, which is
 * what a skills search needs and what a person's own profile screen shows.
 *
 * The scales are ordered rather than numbered. A consumer may compare by index; this module does
 * not publish a numeric level it would then have to keep stable across releases.
 */

export interface PersonCapabilityState extends PersonRecordState {
  readonly kind: CapabilityKind;
  /**
   * For a language, a BCP 47 tag. For a skill, a tenant-supplied code — the skills taxonomy is
   * the customer's, and a list this product shipped would be an opinion about their industry.
   */
  readonly capabilityCode: string;
  /** A skill's name in both languages. A language tag needs none: the tag *is* the name. */
  readonly title?: BilingualName;
  /** A value from `LANGUAGE_PROFICIENCIES` or `SKILL_LEVELS`, per `kind`. */
  readonly level: string;
  readonly yearsOfExperience?: number;
  readonly lastUsedOn?: string;
}

export interface RecordCapability {
  readonly tenantId: string;
  readonly personId: string;
  readonly kind: CapabilityKind;
  readonly capabilityCode: string;
  readonly title?: Readonly<Record<string, string>>;
  readonly level: string;
  readonly yearsOfExperience?: number;
  readonly lastUsedOn?: string;
}

const YEARS_LIMIT = 80;

export class PersonCapability extends PersonRecord<PersonCapabilityState> {
  private constructor(state: PersonCapabilityState) {
    super(state, 'PersonCapability', PeopleEvents.capabilityWithdrawn);
  }

  public static record(
    request: RecordCapability,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonCapability> {
    const code = checkedCapabilityCode(request.kind, request.capabilityCode);

    if (!code.ok) return code;

    const level = checkedLevel(request.kind, request.level);

    if (!level.ok) return level;

    const title = checkedTitle(request.kind, request.title);

    if (!title.ok) return title;

    const years = request.yearsOfExperience;

    if (years !== undefined && (!Number.isFinite(years) || years < 0 || years > YEARS_LIMIT)) {
      return refuse('years_out_of_range', { limit: String(YEARS_LIMIT) });
    }

    const capability = new PersonCapability({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      kind: request.kind,
      capabilityCode: code.value,
      ...title.value,
      level: level.value,
      ...(years === undefined ? {} : { yearsOfExperience: years }),
      ...(request.lastUsedOn === undefined ? {} : { lastUsedOn: request.lastUsedOn }),
      version: 0,
    });

    capability.raise(
      PeopleEvents.capabilityRecorded,
      {
        capabilityId: capability.id,
        personId: request.personId,
        kind: request.kind,
        capabilityCode: code.value,
      },
      origin,
      occurredAt,
    );
    return accept(capability);
  }

  public static rehydrate(state: PersonCapabilityState): PersonCapability {
    return new PersonCapability(state);
  }

  public get kind(): CapabilityKind {
    return this.state.kind;
  }

  public get capabilityCode(): string {
    return this.state.capabilityCode;
  }
}

const checkedCapabilityCode = (kind: CapabilityKind, value: string): PeopleResult<string> => {
  if (kind === 'language') {
    return isLanguageTag(value) ? accept(value) : refuse('language_tag_malformed');
  }
  return checkedCode(value);
};

const checkedLevel = (kind: CapabilityKind, value: string): PeopleResult<string> => {
  const scale: readonly string[] = kind === 'language' ? LANGUAGE_PROFICIENCIES : SKILL_LEVELS;

  return scale.includes(value)
    ? accept(value)
    : refuse('capability_level_unknown', { level: value });
};

/**
 * A skill carries a name; a language does not.
 *
 * The tag `ar` renders as "العربية" or "Arabic" from the reader's own locale data, which every
 * platform ships — asking a customer to type the name of a language in two scripts would be
 * asking them to maintain a translation table this product already has.
 */
const checkedTitle = (
  kind: CapabilityKind,
  title: Readonly<Record<string, string>> | undefined,
): PeopleResult<{ readonly title?: BilingualName }> => {
  if (kind === 'language') return accept({});
  if (title === undefined) return refuse('skill_requires_a_name');

  const checked = nameFrom(title);

  if (!checked.ok) return checked;
  return accept({ title: checked.value });
};
