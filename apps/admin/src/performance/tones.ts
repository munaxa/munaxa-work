import type { Tone } from './frame';

/**
 * How Performance's own status vocabularies read at a glance.
 *
 * **The tone is emphasis on a word that is always present**, never the status itself. A reader who
 * cannot distinguish red from green must still be able to tell a completed review from a cancelled
 * one, and on this screen that difference is whether somebody's rating is final.
 *
 * Four choices worth stating.
 *
 * **`completed` is `success` and `archived` is `muted`, not the reverse.** A completed review is the
 * outcome the cycle exists to produce. Archival files it away and changes nothing it says.
 *
 * **`pending` is muted, not a warning.** A review nobody has started is the ordinary first state of
 * every review in a cycle that has just opened, and colouring several thousand of them amber on the
 * day the cycle opens would train an administrator to ignore the colour.
 *
 * **A cancelled cycle and a cancelled goal are `danger`, a closed one is `muted`.** Closing is the
 * intended ending; cancelling is the one that means the work did not happen.
 *
 * **`declined` on a reviewer assignment is a warning rather than a danger.** Somebody declining to
 * review a colleague is a normal event in a multi-rater panel, not a fault — but it is the row a
 * facilitator needs to find, because the panel is now one response short.
 */

const tones = (map: Readonly<Record<string, Tone>>) => map;

export const CYCLE_TONE = tones({
  draft: 'muted',
  open: 'default',
  in_progress: 'default',
  calibration: 'warning',
  closed: 'muted',
  cancelled: 'danger',
});

export const REVIEW_TONE = tones({
  pending: 'muted',
  self_assessment: 'default',
  manager_assessment: 'default',
  peer_assessment: 'default',
  calibration: 'warning',
  completed: 'success',
  archived: 'muted',
});

export const GOAL_TONE = tones({
  draft: 'muted',
  approved: 'default',
  active: 'default',
  achieved: 'success',
  missed: 'danger',
  cancelled: 'danger',
});

export const ASSESSMENT_TONE = tones({ draft: 'warning', submitted: 'success' });

export const ASSIGNMENT_TONE = tones({
  pending: 'warning',
  submitted: 'success',
  declined: 'warning',
});

export const CALIBRATION_TONE = tones({
  scheduled: 'muted',
  in_session: 'default',
  concluded: 'success',
});

export const FEEDBACK_TONE = tones({
  praise: 'success',
  observation: 'default',
  suggestion: 'default',
  requested: 'muted',
});
