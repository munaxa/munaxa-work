import type { Tone } from './frame';

/**
 * How Payroll's own status vocabularies read at a glance.
 *
 * **The tone is emphasis on a word that is always present**, never the status itself. A reader who
 * cannot distinguish red from green must still be able to tell a finalized run from a reversed one,
 * and on a payroll screen that difference is whether a company paid somebody.
 *
 * Two choices worth stating. **`stale` is `danger` rather than `warning`**: a source moved after the
 * run was calculated, so its figures no longer follow from their inputs, and the module refuses to
 * approve it — that is a failure, not a caution. **`reversed` is muted rather than red**: a reversal
 * is a deliberate remedy somebody chose, and colouring it as a fault editorializes about a correct
 * action.
 */

const tones = (map: Readonly<Record<string, Tone>>) => map;

export const RUN_TONE = tones({
  draft: 'muted',
  calculating: 'warning',
  calculated: 'default',
  approved: 'success',
  finalized: 'success',
  reversed: 'muted',
  stale: 'danger',
  failed: 'danger',
});

export const PERIOD_TONE = tones({
  open: 'success',
  calculated: 'default',
  approved: 'success',
  finalized: 'muted',
  failed: 'danger',
});

export const APPROVAL_TONE = tones({
  approved: 'success',
  finalized: 'success',
  draft: 'muted',
  reversed: 'muted',
  failed: 'danger',
});

export const INSTRUCTION_TONE = tones({ prepared: 'default', failed: 'danger' });
