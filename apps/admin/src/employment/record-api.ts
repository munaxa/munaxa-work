import { loadPortalProcessEnvironment } from '@work/config';
import type { AssetClearanceView } from '@work/assets/contracts';
import type { AttendanceDayView } from '@work/attendance/contracts';
import type { CareerSummaryView } from '@work/career/contracts';
import type { DocumentView } from '@work/documents/contracts';
import type {
  AssignmentView,
  ContractView,
  EmploymentView,
  ReportingLineView,
} from '@work/employment/contracts';
import type { LearningHistoryView } from '@work/learning/contracts';
import type { LeaveBalanceView } from '@work/leave/contracts';
import type { IssuedLetterView } from '@work/letters/contracts';
import type { PersonProfileView } from '@work/people/contracts';
import type { ViolationView } from '@work/relations/contracts';

/**
 * One employee, read from eleven modules.
 *
 * **Why the join is here and not in a module.** No module owns "an employee record": People owns
 * identity, Employment owns the relationship, and each operational module owns its own facts about
 * an employment. A module that assembled the others would be a module that read another's data,
 * which is the one thing the boundaries exist to prevent — so the composition belongs where every
 * other cross-module screen in this portal already puts it: in the presentation layer, over the
 * published contracts, with each module asked its own question.
 *
 * **Each section is its own authorization decision, and that is the point.** Thirteen requests mean
 * thirteen permission checks on the server. A caller who may read an employment but not a salary gets
 * the employment and not the salary, and the screen says a section was withheld rather than
 * rendering it empty — because an empty disciplinary section and a withheld one mean opposite
 * things to whoever is reading.
 *
 * **Open custody arrives through the clearance contract, not a second read.** `AssetClearanceView`
 * publishes the outstanding count and every blocking custody with its asset *tag* — a value a
 * human recognises — while `CustodyView` is deliberately not part of Assets' published contract.
 * One published read answers the question, and it answers it better than the unpublished one would.
 *
 * **Performance is deliberately absent.** `performance.reviews` filters by cycle, status and
 * manager, and by nothing else: the module states that confirming a review exists for a given
 * employment is itself the disclosure, because it says somebody is being appraised. Adding an
 * `employmentId` filter would be a change to that module's authorization reasoning rather than
 * ordinary product code, so this record says Performance publishes no per-employment read instead
 * of quietly widening one.
 *
 * **Nothing here derives anything.** No total is computed, no status inferred, no name assembled
 * from parts, no date reformatted. Every value on the record is a value a module returned.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contracts and fail closed: an unreachable or
 * unauthorized API leaves that section absent, which the screen states, because "not signed in yet"
 * is the expected condition today rather than a fault.
 */

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** How many rows of a per-employee list the record shows. A record is a summary, not an archive. */
const RECENT = 10;

interface Page<TItem> {
  readonly items: readonly TItem[];
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` on every read: this is one named person's file, and a cached page of it is a
 * page of personal data sitting somewhere nobody chose. It matters more here than on a listing,
 * because the record carries identifiers, documents and disciplinary history on one screen.
 *
 * `undefined` covers refusal and unreachability alike, deliberately: the screen distinguishes
 * *withheld* from *empty*, which is the distinction that matters to a reader, and it has never
 * needed to distinguish a 403 from a 404 to do that.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

const items = async <TItem>(path: string): Promise<readonly TItem[] | undefined> =>
  (await read<Page<TItem>>(path))?.items;

/**
 * One employee, as far as this deployment could answer.
 *
 * Every field is `| undefined` rather than optional, and that is the shape the record needs: a
 * section asks "did the module answer" and gets a straight answer, and assembling this object needs
 * no conditional per field. Absent means the module did not answer — refused, unreachable, or
 * nobody authenticated — and it is never the same as an empty list.
 */
export interface EmployeeRecord {
  readonly employment: EmploymentView | undefined;
  readonly profile: PersonProfileView | undefined;
  readonly assignments: readonly AssignmentView[] | undefined;
  readonly reportingLines: readonly ReportingLineView[] | undefined;
  readonly contracts: readonly ContractView[] | undefined;
  readonly documents: readonly DocumentView[] | undefined;
  readonly letters: readonly IssuedLetterView[] | undefined;
  readonly balances: readonly LeaveBalanceView[] | undefined;
  readonly attendanceDays: readonly AttendanceDayView[] | undefined;
  readonly career: CareerSummaryView | undefined;
  readonly learning: LearningHistoryView | undefined;
  readonly violations: readonly ViolationView[] | undefined;
  readonly clearance: AssetClearanceView | undefined;
}

/**
 * The employment itself, asked first and on its own.
 *
 * Every other read is keyed on an employment that exists, so asking for twelve more things about
 * an identifier the API would not resolve is twelve refusals to render nothing with. It also keeps
 * the "no such employment" page a single round trip rather than thirteen.
 */
export const loadEmployment = async (
  employmentId: string,
  asOf?: string,
): Promise<EmploymentView | undefined> =>
  read<EmploymentView>(`/employments/${employmentId}${asOf === undefined ? '' : `?asOf=${asOf}`}`);

/**
 * Everything else, in one round of parallel requests.
 *
 * Issued together rather than in sequence: twelve requests one after another is twelve times the
 * latency for a page that needs all of them before it renders. The page budget is two seconds and
 * a serial chain would spend it on waiting.
 */
export const loadRecord = async (
  employment: EmploymentView,
  asOf?: string,
): Promise<EmployeeRecord> => {
  const id = employment.employmentId;
  const dated = asOf === undefined ? '' : `?asOf=${encodeURIComponent(asOf)}`;

  const [
    profile,
    assignments,
    reportingLines,
    contracts,
    documents,
    letters,
    balances,
    attendanceDays,
    career,
    learning,
    violations,
    clearance,
  ] = await Promise.all([
    read<PersonProfileView>(`/people/${employment.personId}/profile${dated}`),
    items<AssignmentView>(`/employments/${id}/assignments`),
    items<ReportingLineView>(`/employments/${id}/reporting-lines`),
    items<ContractView>(`/employments/${id}/contracts`),
    items<DocumentView>(`/documents?ownerType=employment&ownerId=${id}&size=${RECENT}`),
    items<IssuedLetterView>(`/letters/issued?employmentId=${id}&size=${RECENT}`),
    items<LeaveBalanceView>(`/leave/balances?employmentId=${id}&limit=${RECENT}`),
    items<AttendanceDayView>(`/attendance/days?employmentId=${id}&size=${RECENT}`),
    read<CareerSummaryView>(`/career/summary/${id}`),
    read<LearningHistoryView>(`/learning/history/${id}`),
    items<ViolationView>(`/relations/violations?employmentId=${id}&pageSize=${RECENT}`),
    read<AssetClearanceView>(`/assets/custody/clearance?employmentId=${id}`),
  ]);

  return {
    employment,
    profile,
    assignments,
    reportingLines,
    contracts,
    documents,
    letters,
    balances,
    attendanceDays,
    career,
    learning,
    violations,
    clearance,
  };
};
