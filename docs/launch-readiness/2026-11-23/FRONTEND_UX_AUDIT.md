# Frontend and user experience audit

Baseline `61c115b`. The admin was read from source; it was not started in this session (the
`@munaxa/ui` package could not be installed, AUDIT_EVIDENCE.md §6). Earlier evidence: the 24 Aug product
readiness audit (`docs/verification/product-readiness-audit.md`), whose §1 to §19 describe `4e69b5d` and
are partly out of date; this file supersedes them where they differ.

## What changed since the August audit

| August finding                         | Today                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| No shell or navigation                 | **Fixed.** `apps/admin/src/shell/workspace-shell.tsx` uses `AppShell`, `Sidebar`, `SidebarNav`; four sections (workforce, operations, talent, governance) in `shell/navigation.ts` |
| No detail pages                        | **Mostly fixed.** 12 detail routes (employment record, approval instance, asset, attendance day, leave balance and request, payroll run and result, performance goal and review, recruitment application and requisition) |
| No loading states                      | **Partly fixed.** `loading.tsx` in 7 sections (approvals, assets, attendance, leave, payroll, performance, recruitment) |
| No forms                               | **Unchanged.** No `<form>`, server action or mutating request anywhere in `apps/admin/src`                    |
| Relations, Identity have no screen     | **Unchanged** for both; Assets now has one                                                                  |
| Sign-in                                | The admin reads Identity's `__Host-mx_session` cookie and forwards it (`shell/platform-session.ts`); it links to `PLATFORM_SIGN_IN_URL` when signed out |

## Inventory

- 30 pages under `apps/admin/src/app`, 141 non-test `.tsx` files, one client component.
- Components used from `@munaxa/ui`: `AppShell`, `Sidebar`, `SidebarNav`, `Badge`, `Card`, `EmptyState`,
  `Grid`, `Inline`, `KpiGrid`, `Page`, `PageHeader`, `Section`, `Stack`, `StatCard`, `Surface`, `Table`
  and its parts, `BrandProvider`. Not used although shipped: `DataGrid`, `Pagination`, `FilterBuilder`,
  `SearchBuilder`, `Dialog`, `Drawer`, `Toast`, `EntityPicker`, `Dropzone`, `OrganizationSwitcher`,
  `UserMenu`, `NotificationMenu`.
- Employee portal and manager portal: one bootstrap card each with a `Continue` button that does
  nothing (`apps/employee-portal/src/app/page.tsx`). No Dockerfile, not in the AWS stack.
- Mobile: `apps/mobile/lib/main.dart` only, one widget test.

## Findings

| ID     | Severity | Stage   | Finding                                                                                                                                                                                                 |
| ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MW-011 | Critical | Pilot   | **No write capability.** Nothing can be created, edited, approved, rejected, cancelled or run from a screen. Every workflow in END_TO_END_WORKFLOWS.md needs the API.                                   |
| MW-013 | High     | Pilot   | **No self-service.** Employee and manager portals are bootstrap pages; mobile is a bootstrap screen.                                                                                                     |
| MW-007 | Medium   | Testing | **No session refresh and no tenant picker.** The access cookie lives 15 minutes (`Max-Age=900`); after that every page shows signed-out until the browser visits Identity's refresh. `TENANT_SELECTION_COOKIE` is read but nothing writes it, so a member of two tenants gets 401. |
| MW-028 | Medium   | Pilot   | **Missing screens:** Employee relations, Identity (members, invitations, delegations), tenant settings editing, positions, calendars.                                                                    |
| MW-029 | Medium   | Pilot   | **Thin interaction patterns:** no `error.tsx` or `not-found.tsx` (a failed read becomes an "unavailable" section, so a 403 and an outage look alike); hand-rolled tables without sorting, column choice or pagination controls; no search; language only through `?lang=`; no Hijri date rendering. |
| MW-030 | Medium   | Pilot   | **Arabic terminology** has never been reviewed by a native HR or payroll speaker (stated in the August audit; nothing since changes it).                                                                 |
| MW-025 | Medium   | Pilot   | **No security headers** from the admin (CSP, frame-ancestors, HSTS). See SECURITY_AUDIT.md.                                                                                                             |

## What is good and should be kept

- **Localization is enforced.** `scripts/check-localization.mjs` passed in this session: 20 catalogue
  sets complete in English and Arabic (`apps/admin/locales/*.json` plus each module's `locales/`).
  Direction follows the language and is never a separate control.
- **Honest states.** Every section distinguishes "no rows" from "the API refused", and screens say
  what the product does not do instead of showing placeholders.
- **Per-request rendering with `no-store`**, so no page of personal data is cached or prerendered
  (`apps/admin/src/app/layout.tsx`).
- **Responsive shell** from the design system; tables still overflow on a phone.

## Workflows a normal user cannot complete without the API or the database

All of A to J (see END_TO_END_WORKFLOWS.md). In addition, the very first tenant and its first user
need database-level bootstrap (MW-005) and Identity role assignment by script (MW-003).

## Recommended order of UI work (for the implementation plan)

1. Form infrastructure once: a server-action or route-handler pattern that forwards the session token,
   maps problem details to field errors, and handles 401, 403 and 409. One pattern, used by every module.
2. Session refresh and tenant picker (MW-007).
3. Write screens in the order a pilot uses them: organization and positions; people and employment;
   leave (requests and approvals); attendance corrections; compensation; payroll run, approve,
   finalize; approvals decide; documents (after storage); letters.
4. Employee self-service: payslip, leave balance and request, own documents, letters; manager
   approvals and team view.
5. Missing screens (relations, identity), error pages, filters and pagination, Arabic review.
