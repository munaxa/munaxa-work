/**
 * Munaxa Work's licensing catalogue — ADR-0079.
 *
 * The keys a plan in the central subscription service (or a licence) names for this product. The
 * catalogue is Work's: the central service stores plans whose keys it never interprets, and this
 * file is the one place that says what each key unlocks here.
 *
 * Prices are not here and never will be: what a key costs is a commercial decision recorded in the
 * central service, not a property of the code.
 */

/**
 * The modules that are the HR record system itself. Never gated by a feature: an organisation on
 * any plan holds its people, its structure, their employment, time and leave, and the documents and
 * letters about them. Gating these would hold a customer's own records hostage to an upsell.
 */
export const CORE_MODULES: readonly string[] = [
  'identity',
  'organization',
  'people',
  'employment',
  'onboarding',
  'attendance',
  'leave',
  'document',
  'letter',
  'workflow',
];

/**
 * The licensable modules, by the feature key a plan includes to unlock them. Each key unlocks the
 * module whose permissions share its name: `payroll` unlocks every `payroll.*` operation.
 */
export const WorkFeature = {
  PAYROLL: 'payroll',
  COMPENSATION: 'compensation',
  RECRUITMENT: 'recruitment',
  PERFORMANCE: 'performance',
  LEARNING: 'learning',
  CAREER: 'career',
  RELATIONS: 'relations',
  ASSETS: 'assets',
} as const;
export type WorkFeature = (typeof WorkFeature)[keyof typeof WorkFeature];

/** The limits a plan sets for this product. `null` in a plan means unlimited. */
export const WorkLimit = {
  /** Licensed headcount: employments that are not ended (draft, pending, active, suspended). */
  EMPLOYEES: 'employees',
} as const;
export type WorkLimit = (typeof WorkLimit)[keyof typeof WorkLimit];

const FEATURES = new Set<string>(Object.values(WorkFeature));
const CORE = new Set<string>(CORE_MODULES);

/**
 * The feature an operation needs, from the permission it declares: `null` for a core module.
 *
 * A permission whose module is neither core nor licensable needs a feature named after it that no
 * plan includes — so a module added without a catalogue decision is refused under licensing rather
 * than silently free. Adding it to one list or the other is the decision.
 */
export const featureFor = (permission: string): string | null => {
  const module = permission.split('.')[0] ?? permission;
  if (CORE.has(module)) return null;
  return FEATURES.has(module) ? module : `unlisted.${module}`;
};
