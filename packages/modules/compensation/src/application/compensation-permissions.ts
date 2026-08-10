/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **Compensation is the most sensitive data this product holds** — more sensitive than a leave
 * reason, because a salary is both universally interesting and permanently damaging to disclose.
 * Six separations are deliberate, and each protects a different thing.
 *
 * *Managing is not approving.* This is the separation of duties the whole approval model rests on,
 * and it holds even for somebody granted both: the domain refuses self-approval and a check
 * constraint refuses it in the database. A control that depends on nobody holding two roles is a
 * control that fails the first time somebody does.
 *
 * *Reading a figure is not reading the reason behind it.* `compensation.read` sees amounts;
 * `compensation.adjust` sees the adjustment reasons and notes — the sentence somebody wrote about
 * why a person's pay changed, which is frequently about performance or a dispute.
 *
 * *Drafting a plan is not publishing it.* A published plan version governs everybody assigned to it
 * and cannot be edited afterwards; drafting next year's is ordinary work.
 *
 * *Defining components is its own permission.* A component definition decides what a payroll
 * treatment code says about everybody's tax, and it is configuration rather than a personal record.
 *
 * *Importing is not approving.* A bulk load is the highest-volume *write* this module can make, and
 * a person who can submit one should not thereby be able to decide it.
 *
 * *Exporting is held by fewer people than reading.* An export is the highest-volume disclosure this
 * module can make, and what it discloses is everybody's pay.
 */
export const CompensationPermissions = {
  /** Compensation across the tenant. **The most sensitive read in this product.** */
  read: 'compensation.read',
  /** An employee's own compensation. The portal's permission; Phase 18 wires it to a person. */
  readOwn: 'compensation.read-own',

  /** Assigning and amending recurring compensation, and recording one-time items. */
  manage: 'compensation.manage',
  /** Recording an adjustment, and reading the reasons on one. The change no rule produced. */
  adjust: 'compensation.adjust',
  /** **Deciding.** Never the same permission as managing. */
  approve: 'compensation.approve',

  planManage: 'compensation.plan.manage',
  /** Freezing a plan version. Separate, because a published plan governs everybody. */
  planPublish: 'compensation.plan.publish',
  componentManage: 'compensation.component.manage',

  /** Bulk load. Bounded, validated through the same domain rules as a manual write. */
  import: 'compensation.import',
  /** Taking the compensation register out of the product. Held by fewer people than read. */
  export: 'compensation.export',
} as const;

export type CompensationPermission =
  (typeof CompensationPermissions)[keyof typeof CompensationPermissions];

export const ALL_COMPENSATION_PERMISSIONS: readonly CompensationPermission[] =
  Object.values(CompensationPermissions);
