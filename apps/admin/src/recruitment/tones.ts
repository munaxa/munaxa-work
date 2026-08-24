import type { Tone } from './frame';

/**
 * How each of Recruitment's closed status vocabularies reads at a glance.
 *
 * **The tone is emphasis on a word that is always present**, never the status itself. A reader who
 * cannot distinguish red from green must still be able to tell a rejected application from an
 * offered one, and on a hiring screen that difference is whether somebody was told no.
 *
 * The meaning stays the module's. Nothing here changes what a status *is*, and no tone is derived
 * from a count, a date or another field — a colour that changed on its own would be this screen
 * forming a hiring opinion.
 *
 * Two choices worth stating. **`withdrawn` is muted rather than red** in both applications and
 * offers: a candidate who withdrew was not refused, and colouring their own decision as a failure
 * is the screen editorializing. **A hire in progress is `warning` rather than neutral**, because a
 * hire that has linked a person and not yet created an employment is a transaction sitting half
 * finished, which is exactly the fact ADR-0046 keeps `hireState` for.
 */

const tones = (map: Readonly<Record<string, Tone>>) => map;

export const REQUISITION_TONE = tones({
  draft: 'muted',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  open: 'success',
  closed: 'muted',
  cancelled: 'muted',
});

export const VACANCY_TONE = tones({ draft: 'muted', published: 'success', closed: 'muted' });

export const CANDIDATE_TONE = tones({ active: 'default', hired: 'success', archived: 'muted' });

export const APPLICATION_TONE = tones({
  received: 'muted',
  screening: 'default',
  shortlisted: 'default',
  interviewing: 'default',
  evaluated: 'default',
  offered: 'success',
  hired: 'success',
  rejected: 'danger',
  withdrawn: 'muted',
});

export const INTERVIEW_TONE = tones({
  scheduled: 'default',
  completed: 'success',
  cancelled: 'muted',
  no_show: 'warning',
});

export const OFFER_TONE = tones({
  draft: 'muted',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  issued: 'warning',
  accepted: 'success',
  declined: 'danger',
  expired: 'muted',
  withdrawn: 'muted',
});

export const HIRE_TONE = tones({
  pending: 'warning',
  person_linked: 'warning',
  employment_created: 'warning',
  completed: 'success',
  failed: 'danger',
});
