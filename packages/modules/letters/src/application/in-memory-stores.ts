import type { Transaction } from '@work/kernel';

import { approvalState } from '../domain/letter-approval.js';
import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type { LetterTemplateState, LetterTemplateVersionState } from '../domain/letter-template.js';
import type {
  LetterFilters,
  LettersStores,
  Page,
  Paged,
  ReconciliationFinding,
} from './letters-ports.js';

/**
 * In-memory stores, for the suites that test **behaviour** rather than persistence.
 *
 * They implement the same interfaces the PostgreSQL repositories do, so a handler cannot tell them
 * apart. The integration suites then prove the same behaviour survives real SQL, real constraints
 * and real row-level security.
 *
 * **Three production rules are enforced here too**, because a fake more permissive than the database
 * hides exactly the defects these suites exist to find: a template code is unique per tenant, a
 * version number is unique per template, and an issued letter can be superseded but never rewritten
 * — the interface offers no method that could.
 */

/** The SQLSTATE a real unique index raises, so the repository's translation is exercised too. */
export class ConstraintViolation extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

const UNIQUE_VIOLATION = '23505';

const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

interface Tables {
  readonly templates: Map<string, LetterTemplateState>;
  readonly versions: Map<string, LetterTemplateVersionState>;
  readonly requests: Map<string, LetterRequestState>;
  readonly issued: Map<string, IssuedLetterState>;
  readonly decisions: ApprovalDecisionState[];
  readonly sequences: Map<string, number>;
}

export const inMemoryLettersStores = (): LettersStores => {
  const tables: Tables = {
    templates: new Map(),
    versions: new Map(),
    requests: new Map(),
    issued: new Map(),
    decisions: [],
    sequences: new Map(),
  };

  return {
    templates: templateStore(tables),
    templateVersions: versionStore(tables),
    requests: requestStore(tables),
    issued: issuedStore(tables),
    decisions: decisionStore(tables),
    numbers: numberStore(tables),
    reconciliation: reconciliationStore(tables),
  };
};

const templateStore = (tables: Tables): LettersStores['templates'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.templates.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.templates.values()].find((held) => held.code === code)),
  all: () => Promise.resolve([...tables.templates.values()]),

  insert: (_transaction, state) => {
    if ([...tables.templates.values()].some((held) => held.code === state.code)) {
      throw new ConstraintViolation(UNIQUE_VIOLATION);
    }
    tables.templates.set(state.letterTemplateId, state);
    return Promise.resolve();
  },

  update: (_transaction, state, expected) => {
    const held = tables.templates.get(state.letterTemplateId);

    if (held !== undefined && held.version !== expected) {
      throw new ConstraintViolation('concurrent_modification');
    }
    tables.templates.set(state.letterTemplateId, { ...state, version: (held?.version ?? 0) + 1 });
    return Promise.resolve();
  },
});

const versionStore = (tables: Tables): LettersStores['templateVersions'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.versions.get(id)),

  forTemplate: (_transaction, templateId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((state) => state.letterTemplateId === templateId)
        .sort((one, other) => one.versionNumber - other.versionNumber),
    ),

  highestVersionNumber: (_transaction, templateId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((state) => state.letterTemplateId === templateId)
        .reduce((highest, state) => Math.max(highest, state.versionNumber), 0),
    ),

  insert: (_transaction, state) => {
    const taken = [...tables.versions.values()].some(
      (held) =>
        held.letterTemplateId === state.letterTemplateId &&
        held.versionNumber === state.versionNumber,
    );

    if (taken) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.versions.set(state.letterTemplateVersionId, state);
    return Promise.resolve();
  },

  update: (_transaction, state, expected) => {
    const held = tables.versions.get(state.letterTemplateVersionId);

    if (held !== undefined && held.version !== expected) {
      throw new ConstraintViolation('concurrent_modification');
    }
    // The trigger production carries: a version that has issued a letter is frozen, and no update
    // reaches it. A fake that permitted one would hide the defect this rule exists to prevent.
    if (held?.firstIssuedAt !== undefined) {
      throw new ConstraintViolation('letters_template_version_issued');
    }
    tables.versions.set(state.letterTemplateVersionId, {
      ...state,
      version: (held?.version ?? 0) + 1,
    });
    return Promise.resolve();
  },

  markFirstIssued: (_transaction, id, moment) => {
    const held = tables.versions.get(id);

    // Recorded once and never cleared: the freeze does not lift.
    if (held !== undefined && held.firstIssuedAt === undefined) {
      tables.versions.set(id, { ...held, firstIssuedAt: moment });
    }
    return Promise.resolve();
  },
});

const requestStore = (tables: Tables): LettersStores['requests'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.requests.get(id)),

  search: (_transaction, filters, page) =>
    Promise.resolve(paged([...tables.requests.values()].filter(matchingRequest(filters)), page)),

  insert: (_transaction, state) => {
    tables.requests.set(state.letterRequestId, state);
    return Promise.resolve();
  },

  update: (_transaction, state, expected) => {
    const held = tables.requests.get(state.letterRequestId);

    if (held !== undefined && held.version !== expected) {
      throw new ConstraintViolation('concurrent_modification');
    }
    tables.requests.set(state.letterRequestId, { ...state, version: (held?.version ?? 0) + 1 });
    return Promise.resolve();
  },
});

const matchingRequest =
  (filters: LetterFilters) =>
  (state: LetterRequestState): boolean =>
    same(state.letterTemplateId, filters.letterTemplateId) &&
    same(state.employmentId, filters.employmentId) &&
    same(state.personId, filters.personId) &&
    same(state.status, filters.status);

const matchingIssued =
  (filters: LetterFilters) =>
  (state: IssuedLetterState): boolean =>
    same(state.letterTemplateId, filters.letterTemplateId) &&
    same(state.employmentId, filters.employmentId) &&
    same(state.personId, filters.personId);

const same = (held: string, wanted: string | undefined): boolean =>
  wanted === undefined || held === wanted;

/** Insert, read and one supersession stamp — the same surface the interface and the trigger allow. */
const issuedStore = (tables: Tables): LettersStores['issued'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.issued.get(id)),

  byRequest: (_transaction, requestId) =>
    Promise.resolve(
      [...tables.issued.values()].find((state) => state.letterRequestId === requestId),
    ),

  byVerificationToken: (_transaction, token) =>
    Promise.resolve([...tables.issued.values()].find((state) => state.verificationToken === token)),

  search: (_transaction, filters, page) =>
    Promise.resolve(paged([...tables.issued.values()].filter(matchingIssued(filters)), page)),

  insert: (_transaction, state) => {
    const taken = [...tables.issued.values()].some(
      (held) => held.referenceNumber === state.referenceNumber,
    );

    if (taken) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.issued.set(state.issuedLetterId, state);
    return Promise.resolve();
  },

  supersede: (_transaction, id, supersededById, moment) => {
    const held = tables.issued.get(id);

    if (held === undefined) return Promise.resolve();
    // Already superseded is a refusal, not a silent overwrite: the chain has to stay readable.
    if (held.supersededById !== undefined) {
      throw new ConstraintViolation('letters_already_superseded');
    }
    tables.issued.set(id, { ...held, supersededById, supersededAt: moment });
    return Promise.resolve();
  },
});

const decisionStore = (tables: Tables): LettersStores['decisions'] => ({
  forRequest: (_transaction: Transaction, requestId) =>
    Promise.resolve(
      tables.decisions
        .filter((state) => state.letterRequestId === requestId)
        .sort((one, other) => one.sequence - other.sequence),
    ),

  insert: (_transaction, state) => {
    const taken = tables.decisions.some(
      (held) => held.letterRequestId === state.letterRequestId && held.sequence === state.sequence,
    );

    if (taken) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.decisions.push(state);
    return Promise.resolve();
  },
});

/** Gapless and tenant-scoped, as the real counter is. Never a PostgreSQL sequence (ADR-0039). */
const numberStore = (tables: Tables): LettersStores['numbers'] => ({
  allocate: (_transaction: Transaction, seriesKey) => {
    const next = tables.sequences.get(seriesKey) ?? 1;

    tables.sequences.set(seriesKey, next + 1);
    return Promise.resolve(next);
  },
});

/** Reconciliation over the in-memory tables. It reports; it repairs nothing (D-22). */
const reconciliationStore = (tables: Tables): LettersStores['reconciliation'] => ({
  incompleteIssuance: (_transaction: Transaction, limit) =>
    Promise.resolve(incomplete(tables).slice(0, limit)),
  templateVersionMismatch: (_transaction, limit) =>
    Promise.resolve(mismatched(tables).slice(0, limit)),
  approvalInconsistency: (_transaction, limit) =>
    Promise.resolve(inconsistent(tables).slice(0, limit)),
});

const incomplete = (tables: Tables): readonly ReconciliationFinding[] =>
  [...tables.requests.values()]
    .filter((request) => {
      const issued = [...tables.issued.values()].some(
        (one) => one.letterRequestId === request.letterRequestId,
      );

      return request.status === 'issued' ? !issued : request.status === 'generating';
    })
    .map((request) => ({
      finding: request.status === 'generating' ? 'generation_incomplete' : 'issued_without_letter',
      letterRequestId: request.letterRequestId,
    }));

const mismatched = (tables: Tables): readonly ReconciliationFinding[] =>
  [...tables.issued.values()]
    .filter((letter) => {
      const request = tables.requests.get(letter.letterRequestId);

      return (
        request !== undefined && request.letterTemplateVersionId !== letter.letterTemplateVersionId
      );
    })
    .map((letter) => ({
      finding: 'template_version_mismatch',
      letterRequestId: letter.letterRequestId,
      issuedLetterId: letter.issuedLetterId,
    }));

/** A letter issued from a request whose approval chain does not currently stand as approved. */
const inconsistent = (tables: Tables): readonly ReconciliationFinding[] =>
  [...tables.issued.values()]
    .filter((letter) => {
      const request = tables.requests.get(letter.letterRequestId);
      const template = tables.templates.get(letter.letterTemplateId);

      if (request === undefined || template === undefined || !template.requiresApproval) {
        return false;
      }
      const decisions = tables.decisions.filter(
        (one) => one.letterRequestId === request.letterRequestId,
      );

      return approvalState(decisions) !== 'approved';
    })
    .map((letter) => ({
      finding: 'approval_no_longer_stands',
      letterRequestId: letter.letterRequestId,
      issuedLetterId: letter.issuedLetterId,
    }));
