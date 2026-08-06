/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a
 * permission string that exists in two places will eventually differ in one — and the difference
 * fails open exactly once, on the endpoint whose spelling nobody checked.
 *
 * The split is read/manage per concern rather than one permission per endpoint. The one place
 * that splits further is the hierarchy: seeing the org chart and *reorganizing* the company are
 * held by very different people in every organization that has an HR function, and a single
 * `organization.manage` would hand a branch administrator the ability to reparent the group.
 *
 * Registration is automatic — the module registry derives the list from the handlers — so a
 * permission cannot exist in code and be missing from the administration screen. Platform
 * decides who holds them; this module only says what they are and what they guard.
 */
export const OrganizationPermissions = {
  unitTypeRead: 'organization.unit-type.read',
  unitTypeManage: 'organization.unit-type.manage',

  unitRead: 'organization.unit.read',
  unitManage: 'organization.unit.manage',

  /** Reading the structure. Held broadly: an org chart is not a secret inside a company. */
  hierarchyRead: 'organization.hierarchy.read',
  /** Moving a unit under a different parent. A reorganization, and held by very few. */
  hierarchyManage: 'organization.hierarchy.manage',

  legalEntityRead: 'organization.legal-entity.read',
  legalEntityManage: 'organization.legal-entity.manage',

  costCenterRead: 'organization.cost-center.read',
  costCenterManage: 'organization.cost-center.manage',

  profitCenterRead: 'organization.profit-center.read',
  profitCenterManage: 'organization.profit-center.manage',

  positionRead: 'organization.position.read',
  positionManage: 'organization.position.manage',

  establishmentRead: 'organization.establishment.read',
  establishmentManage: 'organization.establishment.manage',
  /** Approving budgeted headcount, which is what a requisition is validated against. */
  establishmentApprove: 'organization.establishment.approve',

  calendarRead: 'organization.calendar.read',
  calendarManage: 'organization.calendar.manage',

  tenantSettingsRead: 'organization.tenant-settings.read',
  tenantSettingsManage: 'organization.tenant-settings.manage',

  /** Bulk load of a structure. Separate because it writes everything at once. */
  importStructure: 'organization.import',
  exportStructure: 'organization.export',
} as const;

export type OrganizationPermission =
  (typeof OrganizationPermissions)[keyof typeof OrganizationPermissions];

export const ALL_ORGANIZATION_PERMISSIONS: readonly OrganizationPermission[] =
  Object.values(OrganizationPermissions);
