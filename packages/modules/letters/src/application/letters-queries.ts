import { success, type Query, type QueryHandler } from '@work/kernel';

import { notFound } from './letters-context.js';
import { LettersPermissions } from './letters-permissions.js';
import {
  decisionView,
  dual,
  issuedLetterView,
  requestView,
  templateVersionView,
  templateView,
} from './letters-views.js';
import type { LettersDependencies } from './letters-dependencies.js';
import type { LetterFilters, Page, Paged } from './letters-ports.js';
import type {
  ApprovalDecisionView,
  IssuedLetterDetailView,
  IssuedLetterView,
  LetterRequestView,
  LetterTemplateVersionView,
  LetterTemplateView,
  LetterVerificationView,
  LettersReconciliationFindingView,
} from '../contracts/views.js';

/**
 * The reads.
 *
 * Every collection takes a page and clamps it, as Payroll does: default 50, maximum 200. There is
 * no unbounded letter query in this module.
 *
 * The one read that is not like the others is `letters.verify` — the third-party check. It is the
 * only handler here with **no permission**, because the caller is a bank clerk holding a printed
 * letter and no account. What it discloses is correspondingly almost nothing: whether the token
 * names a genuine letter, when it was issued, and whether it has since been superseded. No name, no
 * employer, no salary, no purpose (AD-006).
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly size?: number;
}

export const bounded = (request: PageRequest): Paged => {
  const size = Math.min(Math.max(request.size ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(request.page ?? 1, 1);

  return { limit: size, offset: (page - 1) * size };
};

export interface ListTemplates extends Query {
  readonly queryName: 'letters.templates';
}

export const listTemplatesHandler = (
  dependencies: LettersDependencies,
): QueryHandler<ListTemplates, { readonly items: readonly LetterTemplateView[] }> => ({
  queryName: 'letters.templates',
  permission: LettersPermissions.templateRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const templates = await dependencies.stores.templates.all(transaction);

      return success({ items: templates.map(templateView) });
    }),
});

export interface ReadTemplate extends Query {
  readonly queryName: 'letters.read-template';
  readonly letterTemplateId: string;
}

export interface TemplateDetail {
  readonly template: LetterTemplateView;
  readonly versions: readonly LetterTemplateVersionView[];
}

export const readTemplateHandler = (
  dependencies: LettersDependencies,
): QueryHandler<ReadTemplate, TemplateDetail> => ({
  queryName: 'letters.read-template',
  permission: LettersPermissions.templateRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const template = await dependencies.stores.templates.byId(
        transaction,
        query.letterTemplateId,
      );

      if (template === undefined) return notFound<TemplateDetail>('letter_template');

      const versions = await dependencies.stores.templateVersions.forTemplate(
        transaction,
        template.letterTemplateId,
      );

      return success({
        template: templateView(template),
        versions: versions.map(templateVersionView),
      });
    }),
});

export interface SearchRequests extends Query, PageRequest {
  readonly queryName: 'letters.requests';
  readonly letterTemplateId?: string;
  readonly employmentId?: string;
  readonly personId?: string;
  readonly status?: string;
}

const filtersOf = (query: SearchRequests): LetterFilters => ({
  ...(query.letterTemplateId === undefined ? {} : { letterTemplateId: query.letterTemplateId }),
  ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
  ...(query.personId === undefined ? {} : { personId: query.personId }),
  ...(query.status === undefined ? {} : { status: query.status }),
});

export const searchRequestsHandler = (
  dependencies: LettersDependencies,
): QueryHandler<SearchRequests, Page<LetterRequestView>> => ({
  queryName: 'letters.requests',
  permission: LettersPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.search(
        transaction,
        filtersOf(query),
        bounded(query),
      );
      const items = await Promise.all(
        found.items.map(async (state) =>
          requestView(
            state,
            await dependencies.stores.decisions.forRequest(transaction, state.letterRequestId),
          ),
        ),
      );

      return success({ items, total: found.total });
    }),
});

export interface ReadRequest extends Query {
  readonly queryName: 'letters.read-request';
  readonly letterRequestId: string;
}

export interface RequestDetail {
  readonly request: LetterRequestView;
  readonly decisions: readonly ApprovalDecisionView[];
  readonly issued?: IssuedLetterView;
}

export const readRequestHandler = (
  dependencies: LettersDependencies,
): QueryHandler<ReadRequest, RequestDetail> => ({
  queryName: 'letters.read-request',
  permission: LettersPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request = await dependencies.stores.requests.byId(transaction, query.letterRequestId);

      if (request === undefined) return notFound<RequestDetail>('letter_request');

      const [decisions, issued] = await Promise.all([
        dependencies.stores.decisions.forRequest(transaction, request.letterRequestId),
        dependencies.stores.issued.byRequest(transaction, request.letterRequestId),
      ]);

      return success({
        request: requestView(request, decisions),
        decisions: decisions.map(decisionView),
        ...(issued === undefined ? {} : { issued: issuedLetterView(issued) }),
      });
    }),
});

export interface SearchIssued extends Query, PageRequest {
  readonly queryName: 'letters.issued';
  readonly letterTemplateId?: string;
  readonly employmentId?: string;
  readonly personId?: string;
}

export const searchIssuedHandler = (
  dependencies: LettersDependencies,
): QueryHandler<SearchIssued, Page<IssuedLetterView>> => ({
  queryName: 'letters.issued',
  permission: LettersPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.issued.search(
        transaction,
        {
          ...(query.letterTemplateId === undefined
            ? {}
            : { letterTemplateId: query.letterTemplateId }),
          ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
          ...(query.personId === undefined ? {} : { personId: query.personId }),
        },
        bounded(query),
      );

      return success({ items: found.items.map(issuedLetterView), total: found.total });
    }),
});

export interface ReadIssuedLetter extends Query {
  readonly queryName: 'letters.read-issued';
  readonly issuedLetterId: string;
}

/** One issued letter with what it said. Separate from the register because the values may be money. */
export const readIssuedLetterHandler = (
  dependencies: LettersDependencies,
): QueryHandler<ReadIssuedLetter, IssuedLetterDetailView> => ({
  queryName: 'letters.read-issued',
  permission: LettersPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const issued = await dependencies.stores.issued.byId(transaction, query.issuedLetterId);

      if (issued === undefined) return notFound<IssuedLetterDetailView>('issued_letter');

      return success({
        letter: issuedLetterView(issued),
        substitutedValues: issued.substitutedValues,
        sourceVersions: issued.sourceVersions,
      });
    }),
});

export interface VerifyLetter extends Query {
  readonly queryName: 'letters.verify';
  readonly verificationToken: string;
}

/**
 * The third-party check, and the least disclosing read in this module.
 *
 * A wrong token is `genuine: false` and nothing else — not "no such letter", which over enough
 * attempts would let somebody enumerate the register. A right one reveals the reference, the issue
 * date and whether the letter has been superseded, and **no employee data at all** (AD-006).
 *
 * It declares `letter.verify` rather than running unauthenticated, and that is a gap rather than a
 * design: every read here resolves a tenant before it reaches a row, and row-level security has no
 * anonymous cross-tenant path. The **anonymous public route is `NOT VERIFIED`**; the query in front
 * of which it would sit is built and behaves correctly.
 */
export const verifyLetterHandler = (
  dependencies: LettersDependencies,
): QueryHandler<VerifyLetter, LetterVerificationView> => ({
  queryName: 'letters.verify',
  permission: LettersPermissions.verify,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const issued = await dependencies.stores.issued.byVerificationToken(
        transaction,
        query.verificationToken,
      );

      if (issued === undefined) return success<LetterVerificationView>({ genuine: false });

      return success({
        genuine: true,
        referenceNumber: issued.referenceNumber,
        issuedOn: dual(issued.issuedAt),
        superseded: issued.supersededById !== undefined,
      });
    }),
});

export interface ReadLettersReconciliation extends Query {
  readonly queryName: 'letters.reconciliation';
}

/**
 * What reconciliation found. **It reports; it repairs nothing** (D-22).
 *
 * Pull-based, following Payroll: correctness never depends on an event having been delivered. None
 * of these checks modifies a row — automatically cancelling or rewriting a letter because a check
 * disagreed is how a register loses the evidence it existed for.
 */
export const readLettersReconciliationHandler = (
  dependencies: LettersDependencies,
): QueryHandler<
  ReadLettersReconciliation,
  { readonly findings: readonly LettersReconciliationFindingView[] }
> => ({
  queryName: 'letters.reconciliation',
  permission: LettersPermissions.manage,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const [incomplete, mismatched, inconsistent] = await Promise.all([
        dependencies.stores.reconciliation.incompleteIssuance(transaction, FINDING_LIMIT),
        dependencies.stores.reconciliation.templateVersionMismatch(transaction, FINDING_LIMIT),
        dependencies.stores.reconciliation.approvalInconsistency(transaction, FINDING_LIMIT),
      ]);

      return success({ findings: [...incomplete, ...mismatched, ...inconsistent] });
    }),
});

/** Bounded like everything else: a reconciliation that returns a million rows helps nobody. */
const FINDING_LIMIT = 200;
