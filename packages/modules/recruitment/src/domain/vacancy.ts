import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  bilingualFrom,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  optionalBilingualFrom,
  type BilingualText,
  type Metadata,
} from './recruitment-aggregate.js';
import { RecruitmentEvents } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import { isEntityCode, type VacancyStatus } from './recruitment-vocabulary.js';

/**
 * A Vacancy: an opening that accepts applications.
 *
 * Separate from the requisition because the two have different lifetimes and different audiences. A
 * requisition is an internal authority approved once; a vacancy is a posting that opens, is
 * published to channels, collects applications and closes — and one requisition for three engineers
 * may be recruited as one vacancy or three.
 *
 * **Publication channels are an array, not a table.** A channel has no lifecycle of its own beyond
 * being listed, and a table per name is the shape the approved scope decision refuses.
 *
 * The title is required in **both first-class languages**, for the reason Organization requires it
 * of a unit and People of a name: a posting written in one language is an opening half this
 * product's market cannot read.
 */

export interface VacancyState {
  readonly id: string;
  readonly tenantId: string;
  readonly requisitionId: string;
  readonly title: BilingualText;
  readonly description?: BilingualText;
  readonly status: VacancyStatus;
  readonly channels: readonly string[];
  readonly openedOn?: string;
  readonly closesOn?: string;
  readonly closedReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface OpenVacancy {
  readonly tenantId: string;
  readonly requisitionId: string;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly channels?: readonly string[];
  readonly openedOn?: string;
  readonly closesOn?: string;
  readonly metadata?: Metadata;
}

const MAX_CHANNELS = 20;

export class Vacancy extends RecruitmentAggregate {
  private constructor(private state: VacancyState) {
    super(state.id, state.tenantId, state.version, 'Vacancy');
  }

  public static open(
    request: OpenVacancy,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Vacancy> {
    const checked = checkedVacancy(request);

    if (!checked.ok) return checked;

    const vacancy = new Vacancy({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      requisitionId: request.requisitionId,
      status: 'draft',
      ...checked.value,
      version: 0,
    });

    vacancy.raise(
      RecruitmentEvents.vacancyOpened,
      { vacancyId: vacancy.id, requisitionId: request.requisitionId },
      origin,
      occurredAt,
    );
    return accept(vacancy);
  }

  public static rehydrate(state: VacancyState): Vacancy {
    return new Vacancy(state);
  }

  public get status(): VacancyStatus {
    return this.state.status;
  }

  public get requisitionId(): string {
    return this.state.requisitionId;
  }

  /** A vacancy that may receive applications. A draft posting is not yet open to anybody. */
  public get acceptsApplications(): boolean {
    return this.state.status === 'published';
  }

  /**
   * Publishes the vacancy to its channels.
   *
   * Publication is separately permissioned from editing, because it is the moment a posting becomes
   * externally visible — and in several of this product's markets a published advertisement carries
   * obligations an internal draft does not.
   */
  public publish(
    channels: readonly string[] | undefined,
    openedOn: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<VacancyStatus> {
    if (this.state.status !== 'draft') {
      return refuse('vacancy_not_publishable', { status: this.state.status });
    }

    const checkedChannels = checkedChannelList(channels ?? this.state.channels);

    if (!checkedChannels.ok) return checkedChannels;

    const opened = checkedOptionalCivilDate(openedOn, 'openedOn');

    if (!opened.ok) return opened;

    this.state = {
      ...this.state,
      status: 'published',
      channels: checkedChannels.value,
      openedOn: opened.value ?? this.state.openedOn ?? isoDateOf(occurredAt),
    };
    this.raise(
      RecruitmentEvents.vacancyPublished,
      {
        vacancyId: this.id,
        requisitionId: this.state.requisitionId,
        channels: checkedChannels.value,
      },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public close(
    reasonCode: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<VacancyStatus> {
    if (this.state.status === 'closed') return refuse('vacancy_already_closed');

    const code = checkedOptionalCode(reasonCode, 'reasonCode');

    if (!code.ok) return code;

    this.state = {
      ...this.state,
      status: 'closed',
      ...(code.value === undefined ? {} : { closedReasonCode: code.value }),
    };
    this.raise(
      RecruitmentEvents.vacancyClosed,
      {
        vacancyId: this.id,
        requisitionId: this.state.requisitionId,
        ...(code.value === undefined ? {} : { reasonCode: code.value }),
      },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public snapshot(): VacancyState {
    return { ...this.state, version: this.version };
  }
}

const isoDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);

/**
 * Channels a vacancy is published to.
 *
 * Codes rather than an enumeration: which job boards, agencies and internal noticeboards a customer
 * uses is their question, and a list shipped here would be out of date the week a new board
 * launches. Bounded and de-duplicated, because a posting listed twice on one channel is a mistake
 * rather than an intent.
 */
const checkedChannelList = (channels: readonly string[]): RecruitmentResult<readonly string[]> => {
  const unique = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];

  if (unique.length > MAX_CHANNELS) return refuse('too_many_channels');

  const malformed = unique.find((channel) => !isEntityCode(channel));

  if (malformed !== undefined) return refuse('code_malformed', { field: 'channels' });
  return accept(unique);
};

/** The creation checks, hoisted so `open` stays inside the function budget. */
const checkedVacancy = (
  request: OpenVacancy,
): RecruitmentResult<{
  readonly title: BilingualText;
  readonly description?: BilingualText;
  readonly channels: readonly string[];
  readonly openedOn?: string;
  readonly closesOn?: string;
  readonly metadata: Metadata;
}> => {
  const title = bilingualFrom(request.title, 'title');

  if (!title.ok) return title;

  const description = optionalBilingualFrom(request.description, 'description');

  if (!description.ok) return description;

  const channels = checkedChannelList(request.channels ?? []);

  if (!channels.ok) return channels;

  const dates = checkedVacancyDates(request);

  if (!dates.ok) return dates;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    title: title.value,
    ...(description.value === undefined ? {} : { description: description.value }),
    channels: channels.value,
    ...dates.value,
    metadata: metadata.value,
  });
};

const checkedVacancyDates = (
  request: OpenVacancy,
): RecruitmentResult<{ readonly openedOn?: string; readonly closesOn?: string }> => {
  const openedOn = checkedOptionalCivilDate(request.openedOn, 'openedOn');

  if (!openedOn.ok) return openedOn;

  const closesOn = checkedOptionalCivilDate(request.closesOn, 'closesOn');

  if (!closesOn.ok) return closesOn;
  if (
    openedOn.value !== undefined &&
    closesOn.value !== undefined &&
    closesOn.value < openedOn.value
  ) {
    return refuse('vacancy_closes_before_it_opens');
  }

  return accept({
    ...(openedOn.value === undefined ? {} : { openedOn: openedOn.value }),
    ...(closesOn.value === undefined ? {} : { closesOn: closesOn.value }),
  });
};
