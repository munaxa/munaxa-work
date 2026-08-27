/**
 * Which screens this portal has, and how they are grouped.
 *
 * **Why this is not read from the module registry.** Every module declares a `NavigationEntry` with
 * a path, a permission and an order, and `ModuleRegistry.describe()` sorts them into one list. That
 * list is the right long-term source and it is deliberately not used here, for two reasons that are
 * facts about this deployment rather than preferences:
 *
 * 1. **Nothing publishes it.** No route exposes the registry, so a portal could not read it without
 *    the API growing an endpoint for the purpose — speculative architecture for a consumer that
 *    does not yet exist in the shape it will finally take.
 * 2. **It would render empty.** Each entry carries the permission that reveals it, and this
 *    deployment grants none (`PlatformPermissionChecker` holds an empty set until Platform supplies
 *    a checker). A permission-filtered sidebar today is a sidebar with nothing in it.
 *
 * So the frame lists **the screens this portal actually has**, which is a presentation fact it owns,
 * and permission-aware filtering arrives with the authorization adapter rather than being faked now.
 * Nine of the registry's thirty-two declared paths have no screen behind them; none of them is
 * listed here, because a navigation item that leads nowhere is worse than one that is missing.
 */

export interface NavigationDestination {
  /** Stable key, and the catalogue key's last segment. */
  readonly key: string;
  readonly href: string;
}

export interface NavigationSection {
  readonly key: string;
  readonly destinations: readonly NavigationDestination[];
}

const destination = (key: string): NavigationDestination => ({ key, href: `/${key}` });

export const NAVIGATION: readonly NavigationSection[] = [
  {
    key: 'workforce',
    destinations: [
      destination('people'),
      destination('employment'),
      destination('organization'),
      destination('recruitment'),
      destination('onboarding'),
    ],
  },
  {
    key: 'operations',
    destinations: [
      // Approvals first: it is the only destination in this portal whose content is addressed to
      // the reader personally, and a queue somebody has to go looking for is not work.
      destination('approvals'),
      destination('attendance'),
      destination('leave'),
      destination('compensation'),
      destination('payroll'),
      // Assets sits in Operations rather than Governance because issuing a laptop and getting it
      // back is daily work, like attendance and leave, not a record somebody files.
      destination('assets'),
    ],
  },
  {
    key: 'talent',
    destinations: [destination('performance'), destination('career'), destination('learning')],
  },
  {
    key: 'governance',
    // `workflow` is the *configuration* of approval processes — definitions, versions, groups,
    // routing. The approvals somebody is being asked to answer are `approvals`, in Operations.
    destinations: [destination('documents'), destination('letters'), destination('workflow')],
  },
];

/** Every destination, flattened — what a "which screen am I on" check reads. */
export const DESTINATIONS: readonly NavigationDestination[] = NAVIGATION.flatMap(
  (section) => section.destinations,
);

/**
 * Whether a destination is the one being shown.
 *
 * A prefix match, so `/employment/0190…` — an employee record — keeps *Employment* marked as the
 * current page. An exact match would leave a detail page with no current item at all, which reads
 * as having navigated out of the application.
 */
export const isCurrent = (destination: NavigationDestination, pathname: string): boolean =>
  pathname === destination.href || pathname.startsWith(`${destination.href}/`);
