import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedCode, checkedText } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, type PeopleResult } from './people-rejection.js';
import { PersonRecord, type PersonRecordState } from './person-record.js';

/**
 * The two things an administrator writes *about* a person rather than recording *of* them: a tag
 * and a note.
 *
 * A **tag** is a label a tenant applies to group people its own way — `graduate-intake-2026`,
 * `relocation-support`, `bilingual-support-desk`. A code, never a list this product ships, because
 * every customer groups their workforce differently and a fixed vocabulary would be a product
 * opinion about their organization.
 *
 * A **note** is free text an administrator wrote. It is the highest-risk field in this module and
 * is treated as such:
 *
 * - It is guarded by its own permission, separate from reading the person.
 * - It records who wrote it and when, from the authenticated context and never from the request —
 *   a caller who could name their own author could write a note as somebody else.
 * - It is never amended and never deleted. A note that could be edited after the fact is a note
 *   that cannot be relied on in a disciplinary case, and a note that could be deleted is a record
 *   somebody can make disappear (AD-009). A note that was wrong is superseded by a further note.
 * - It never appears in an event payload.
 */

export interface PersonTagState extends PersonRecordState {
  readonly tagCode: string;
}

export interface PersonNoteState extends PersonRecordState {
  /** A tenant-supplied grouping — `wellbeing`, `visa`, `general`. Never interpreted here. */
  readonly categoryCode: string;
  readonly body: string;
  /** Taken from the authenticated context. A caller cannot supply it. */
  readonly authoredBy: string;
  readonly authoredAt: Date;
}

const NOTE_LIMIT = 8192;

export class PersonTag extends PersonRecord<PersonTagState> {
  private constructor(state: PersonTagState) {
    super(state, 'PersonTag', PeopleEvents.tagRemoved);
  }

  public static record(
    request: { readonly tenantId: string; readonly personId: string; readonly tagCode: string },
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonTag> {
    const tagCode = checkedCode(request.tagCode);

    if (!tagCode.ok) return tagCode;

    const tag = new PersonTag({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      tagCode: tagCode.value,
      version: 0,
    });

    tag.raise(
      PeopleEvents.tagApplied,
      { tagId: tag.id, personId: request.personId, tagCode: tagCode.value },
      origin,
      occurredAt,
    );
    return accept(tag);
  }

  public static rehydrate(state: PersonTagState): PersonTag {
    return new PersonTag(state);
  }

  public get tagCode(): string {
    return this.state.tagCode;
  }
}

export class PersonNote extends PersonRecord<PersonNoteState> {
  private constructor(state: PersonNoteState) {
    super(state, 'PersonNote', PeopleEvents.noteRecorded);
  }

  public static write(
    request: {
      readonly tenantId: string;
      readonly personId: string;
      readonly categoryCode: string;
      readonly body: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonNote> {
    const categoryCode = checkedCode(request.categoryCode);

    if (!categoryCode.ok) return categoryCode;

    const body = checkedText(request.body, 'body', NOTE_LIMIT);

    if (!body.ok) return body;

    const note = new PersonNote({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      categoryCode: categoryCode.value,
      body: body.value,
      // From the origin, which the infrastructure builds from the authenticated context.
      authoredBy: origin.actor,
      authoredAt: occurredAt,
      version: 0,
    });

    // The category, never the body.
    note.raise(
      PeopleEvents.noteRecorded,
      { noteId: note.id, personId: request.personId, categoryCode: categoryCode.value },
      origin,
      occurredAt,
    );
    return accept(note);
  }

  public static rehydrate(state: PersonNoteState): PersonNote {
    return new PersonNote(state);
  }

  public get categoryCode(): string {
    return this.state.categoryCode;
  }

  public get authoredBy(): string {
    return this.state.authoredBy;
  }
}
