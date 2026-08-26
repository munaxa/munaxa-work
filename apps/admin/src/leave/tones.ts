import type { Tone } from './frame';

/**
 * How Leave's own status vocabularies read at a glance.
 *
 * **The tone is emphasis on a word that is always present**, never the status itself. A reader who
 * cannot distinguish red from green must still be able to tell a rejected request from an approved
 * one, and on a leave screen that difference is whether somebody may be away.
 *
 * Four choices worth stating.
 *
 * **`taken` and `closed` are muted rather than green.** They are the ordinary end of an approved
 * absence, and colouring a finished holiday as an achievement says nothing a reader needs.
 *
 * **`rejected` is `danger` and `cancelled` and `withdrawn` are muted.** A rejection is a decision
 * somebody made against the requester; a cancellation or a withdrawal is a change of plan. Painting
 * all three red would tell a manager that three quite different things went wrong.
 *
 * **A ledger debit is not a fault.** `consumption` is what leave *is*, so it is `default`, and only
 * `expiry` — entitlement somebody lost — carries a warning. `reversal` is muted: it is a deliberate
 * correction, and colouring it as a failure editorializes about a correct action.
 *
 * **`draft` is muted everywhere it appears**, on a request and on a definition alike: a draft
 * asserts nothing, consumes nothing and blocks nothing.
 */

const tones = (map: Readonly<Record<string, Tone>>) => map;

export const REQUEST_TONE = tones({
  draft: 'muted',
  submitted: 'default',
  pending_approval: 'warning',
  approved: 'success',
  taken: 'muted',
  closed: 'muted',
  rejected: 'danger',
  cancelled: 'muted',
  withdrawn: 'muted',
});

export const LEDGER_TONE = tones({
  opening: 'muted',
  accrual: 'success',
  carry_in: 'success',
  carry_out: 'muted',
  consumption: 'default',
  expiry: 'warning',
  adjustment: 'default',
  reversal: 'muted',
});

export const DEFINITION_TONE = tones({
  draft: 'muted',
  published: 'success',
  superseded: 'muted',
});

export const DECISION_TONE = tones({ approved: 'success', rejected: 'danger' });
