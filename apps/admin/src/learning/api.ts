import { loadPortalProcessEnvironment } from '@work/config';
import type {
  AssessmentResultView,
  AssessmentView,
  AssignmentView,
  CertificationView,
  CourseVersionView,
  CourseView,
  EnrolmentView,
  InstructorView,
  LearningHistoryView,
  MandatoryRuleView,
  PathDetailView,
  PathView,
} from '@work/learning/contracts';

/**
 * Reading the learning workspace from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about. **Nothing here touches a repository, a database or an application
 * handler.** Every value on the screen came down an HTTP response: Admin → API → dispatcher →
 * application → repository → PostgreSQL, in that order and no other.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page, because "not signed in yet" is the
 * expected condition today rather than a fault.
 *
 * **Several reads are expected to fail for most callers, and that is the design.** The catalogue
 * sits behind `learning.catalogue.read`, assignments behind `learning.assignment.read`,
 * certifications behind `learning.certification.read`. A caller who can list courses and not read
 * the compliance queue gets an empty queue — which is exactly what that permission separation means,
 * and the screen says so rather than showing a blank.
 *
 * **No employment identifier is ever sent as a claim about who is asking.** The assignment and
 * certification searches accept one as a *filter*, and this screen does not supply it: a caller
 * holding only `assignment.read-team` reads nothing whatever they name, because this product cannot
 * resolve a signed-in person to their employment. A picker here would be an administrator's filter
 * wearing an employee's identity.
 *
 * **Every read is bounded and the number of them is fixed.** No call omits `page` and `size`, and
 * the four detail reads are made **once, for the first row of their listing** — never one per
 * course, per employee, per assignment or per certificate. The request count does not grow with the
 * size of a tenant.
 */

/** One page, the size every listing on this screen uses. Nothing asks for more. */
const PAGE = 'page=1&size=50';

/**
 * How far ahead counts as expiring, for the certification read.
 *
 * Thirty days is a screen default and not a rule: the API derives validity against whatever window
 * the caller states, and `0` would ask a plain yes-or-no question instead. No column holds any of
 * these answers, so asking a different window here changes the answer and changes nothing stored.
 */
const NOTICE_DAYS = 30;

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/** The two searches that derive an answer against a day echo that day back. */
interface DerivedPage<TItem> extends Page<TItem> {
  readonly asOf: string;
}

interface CourseDetail {
  readonly course: CourseView;
  readonly versions: readonly CourseVersionView[];
  readonly assessments: readonly AssessmentView[];
}

export interface LearningForDisplay {
  readonly courses: readonly CourseView[];
  readonly coursesTotal: number;
  /** One course in full: every version it has had, and their assessments (AD-004). */
  readonly course: CourseDetail | undefined;
  readonly paths: readonly PathView[];
  readonly pathsTotal: number;
  /** One path with its steps, in sequence. */
  readonly path: PathDetailView | undefined;
  readonly rules: readonly MandatoryRuleView[];
  readonly rulesTotal: number;
  readonly assignments: readonly AssignmentView[];
  readonly assignmentsTotal: number;
  readonly enrolments: readonly EnrolmentView[];
  readonly enrolmentsTotal: number;
  /** The outcomes recorded against one enrolment. Nothing totals them (see `records.tsx`). */
  readonly results: readonly AssessmentResultView[];
  readonly certifications: readonly CertificationView[];
  readonly certificationsTotal: number;
  readonly instructors: readonly InstructorView[];
  readonly instructorsTotal: number;
  /** One person's record, for the employment the assignment queue happened to surface. */
  readonly history: LearningHistoryView | undefined;
  /** The day the two derived answers were computed against, as the API reported it. */
  readonly asOf: string | undefined;
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when the catalogue is visible and the learner records are not: a permission boundary. */
  readonly recordsWithheld: boolean;
}

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/learning${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

/**
 * A page's rows and the server's own total, with the absent case answered once.
 *
 * Written as one helper rather than a `?.items ?? []` and a `?.total ?? 0` at each of the seven
 * call sites, because the pair must always travel together: a screen that fell back to an empty
 * list while keeping a stale total would print "0 of 4000", and one that fell back to a total of
 * `items.length` would report a page as an organization.
 */
const pageParts = <TItem>(
  page: Page<TItem> | undefined,
): { readonly items: readonly TItem[]; readonly total: number } => ({
  items: page?.items ?? [],
  total: page?.total ?? 0,
});

export const EMPTY: LearningForDisplay = {
  courses: [],
  coursesTotal: 0,
  course: undefined,
  paths: [],
  pathsTotal: 0,
  path: undefined,
  rules: [],
  rulesTotal: 0,
  assignments: [],
  assignmentsTotal: 0,
  enrolments: [],
  enrolmentsTotal: 0,
  results: [],
  certifications: [],
  certificationsTotal: 0,
  instructors: [],
  instructorsTotal: 0,
  history: undefined,
  asOf: undefined,
  unavailable: true,
  recordsWithheld: false,
};

/**
 * The reads the screen makes.
 *
 * The course listing is read first and its failure is the signal: if the service will not answer
 * the cheapest question, the rest is a page of empty tables and a wall of failed requests.
 *
 * `assignments` is read before the rest of the learner records because it is the one whose refusal
 * tells the screen something worth saying — the catalogue and the compliance queue sit behind
 * different permissions, and a caller who has one and not the other is looking at a boundary rather
 * than an outage.
 */
export const loadLearning = async (): Promise<LearningForDisplay> => {
  const courses = await read<Page<CourseView>>(`/courses?${PAGE}`);

  if (courses === undefined) return EMPTY;

  const paths = await read<Page<PathView>>(`/paths?${PAGE}`);
  const rules = await read<Page<MandatoryRuleView>>(`/mandatory-rules?${PAGE}`);
  const instructors = await read<Page<InstructorView>>(`/instructors?${PAGE}`);

  return {
    ...EMPTY,
    unavailable: false,
    courses: courses.items,
    coursesTotal: courses.total,
    paths: pageParts(paths).items,
    pathsTotal: pageParts(paths).total,
    rules: pageParts(rules).items,
    rulesTotal: pageParts(rules).total,
    instructors: pageParts(instructors).items,
    instructorsTotal: pageParts(instructors).total,
    ...(await catalogueDetail(courses.items[0], paths?.items[0])),
    ...(await learnerRecords()),
  };
};

/**
 * One course and one path in full.
 *
 * **The first of each listing, never each of them.** A workspace that read the versions of every
 * course in the page would issue fifty requests to render one table, and the number would grow with
 * the tenant's catalogue — the amplification this screen is written to avoid.
 */
const catalogueDetail = async (
  course: CourseView | undefined,
  path: PathView | undefined,
): Promise<Partial<LearningForDisplay>> => ({
  ...(course === undefined
    ? {}
    : { course: await read<CourseDetail>(`/courses/${course.courseId}`) }),
  ...(path === undefined ? {} : { path: await read<PathDetailView>(`/paths/${path.pathId}`) }),
});

/**
 * What has happened to people: the queues, the records and the certificates.
 *
 * Split out because it stands on its own permissions, and because its refusal means something
 * different from the catalogue's. `recordsWithheld` is the distinction: the caller could read
 * courses and could not read assignments, which is a permission boundary rather than a service
 * that is down.
 *
 * **No employment identifier is supplied to any of these.** See the file note.
 */
const learnerRecords = async (): Promise<Partial<LearningForDisplay>> => {
  const assignments = await read<DerivedPage<AssignmentView>>(`/assignments?${PAGE}`);
  const enrolments = await read<Page<EnrolmentView>>(`/enrolments?${PAGE}`);
  const certifications = await read<DerivedPage<CertificationView>>(
    `/certifications?${PAGE}&noticeDays=${String(NOTICE_DAYS)}`,
  );

  const queue = pageParts(assignments);
  const sat = pageParts(enrolments);
  const held = pageParts(certifications);

  return {
    assignments: queue.items,
    assignmentsTotal: queue.total,
    enrolments: sat.items,
    enrolmentsTotal: sat.total,
    certifications: held.items,
    certificationsTotal: held.total,
    // The day both derived answers were computed against, taken from whichever search answered.
    // Never `new Date()` here: the server decided, and a screen that stamped its own clock would
    // caption an answer with a day the answer was not computed for.
    ...definedOf('asOf', assignments?.asOf ?? certifications?.asOf),
    recordsWithheld: assignments === undefined,
    ...(await forRecords(enrolments?.items[0], assignments?.items[0])),
  };
};

/**
 * The two reads scoped to one row: one enrolment's assessment results, and one person's history.
 *
 * One of each, for the first row the listing returned. Reading the history of every employment in
 * the assignment queue would be one request per person, and the compliance screen of a real
 * workforce would issue fifty.
 */
const forRecords = async (
  enrolment: EnrolmentView | undefined,
  assignment: AssignmentView | undefined,
): Promise<Partial<LearningForDisplay>> => ({
  results:
    enrolment === undefined
      ? []
      : ((await read<readonly AssessmentResultView[]>(
          `/enrolments/${enrolment.enrolmentId}/assessment-results`,
        )) ?? []),
  ...(assignment === undefined
    ? {}
    : {
        history: await read<LearningHistoryView>(
          `/history/${assignment.employmentId}?noticeDays=${String(NOTICE_DAYS)}`,
        ),
      }),
});

/**
 * A key present only when it has a value.
 *
 * `exactOptionalPropertyTypes` is on, so `{ asOf: undefined }` is not the same as an absent key —
 * and spreading the first over a default would replace a value with nothing.
 */
const definedOf = <TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> =>
  value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
