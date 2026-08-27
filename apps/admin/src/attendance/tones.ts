import type { Tone } from './frame';

/**
 * How Attendance's own status vocabularies read at a glance.
 *
 * **The tone is emphasis on a word that is always present**, never the status itself. A reader who
 * cannot distinguish red from green must still be able to tell a blocking exception from an
 * informational one, and on an attendance screen that difference is whether somebody's month can
 * be paid.
 *
 * Four choices worth stating.
 *
 * **Severity is the domain's, and the tones follow it exactly.** `blocking` is `danger` because the
 * module refuses to freeze a period while one is open; `warning` is a caution; `information` is
 * muted. Nothing here decides how serious an exception is — Attendance already did.
 *
 * **`late_arrival` gets no tone of its own.** An exception's colour comes from its *severity*, not
 * its kind, because the same kind can be configured to different severities by a tenant's policy.
 * Colouring lateness red regardless would be this screen overriding a customer's own judgement.
 *
 * **A superseded event is muted, never struck through or red.** It is not an error: it is what was
 * originally captured, kept visible so a correction stays auditable from the screen where it
 * matters.
 *
 * **`pending` is a warning, not a neutral.** A day ingestion created and the calculator never
 * reached is a figure nobody should pay, and the reconciliation queue exists because that number
 * grows quietly.
 */

const tones = (map: Readonly<Record<string, Tone>>) => map;

export const SEVERITY_TONE = tones({
  information: 'muted',
  warning: 'warning',
  blocking: 'danger',
});

export const EXCEPTION_STATE_TONE = tones({
  open: 'default',
  resolved: 'success',
  waived: 'muted',
  superseded: 'muted',
});

export const DAY_TONE = tones({
  pending: 'warning',
  calculated: 'default',
  under_review: 'warning',
  approved: 'success',
  locked: 'muted',
});

export const CORRECTION_TONE = tones({
  requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  applied: 'success',
  withdrawn: 'muted',
});

export const LEAVE_TONE = tones({ none: 'muted', applied: 'default', unknown: 'warning' });

export const DEFINITION_TONE = tones({
  draft: 'muted',
  published: 'success',
  superseded: 'muted',
});
