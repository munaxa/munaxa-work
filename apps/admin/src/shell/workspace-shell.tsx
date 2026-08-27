'use client';

import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  AppShell,
  AppShellProvider,
  NavigationDrawer,
  ProductLogo,
  Sidebar,
  SidebarNav,
  SidebarTrigger,
  TopBar,
  type NavigationGroup,
} from '@munaxa/ui';

import { NAVIGATION, isCurrent } from './navigation';
import { directionOf, isLanguage, otherThan, translator, type Language } from './locale';

/**
 * The frame every Admin screen sits inside.
 *
 * Until this existed the portal had fifteen screens and no way to reach any of them from any other:
 * each page was a bare `<main>`, the root route was a card with a button that did nothing, and the
 * only navigation was the address bar. That is the single largest reason the product did not read
 * as one product, and none of it needed anything to be built — `@munaxa/ui` has shipped
 * `AppShell`, `Sidebar`, `SidebarNav`, `TopBar`, `NavigationDrawer` and `SkipLink` all along.
 *
 * **This is the only client component in the portal, and it holds no business logic.** It knows
 * which screens exist, which one is being shown and which language the reader chose. It fetches
 * nothing, decides nothing about the domain, and renders no data.
 *
 * **Language and direction move together.** The reader's language is the `?lang=` every screen
 * already reads, so the switch changes one parameter and leaves the path alone. `dir` is set here,
 * on the element that wraps both the navigation and the content, because a shell that stayed
 * left-to-right around a right-to-left page is the exact defect `directionOf` exists to prevent.
 *
 * **Every link is a plain anchor.** `SidebarNav` takes a `renderLink` so a product can supply its
 * router's link element, and this one supplies none, which leaves the platform's own `<a>`. Two
 * reasons, and the second is the one that decided it: every screen here is server-rendered with
 * `cache: 'no-store'`, so a client-side transition would fetch the same page from the same server
 * and save a document parse; and `next/link` is a default export named `Link`, which this
 * workspace's naming rule refuses — a rule is changed by an ADR, never worked around, and a soft
 * navigation is not worth an ADR. When one is taken, this file is the only place that changes.
 *
 * **It offers no control that does nothing.** There is no search box, no notification bell and no
 * user menu, and the design system ships all three: search has no endpoint, notifications are
 * recorded and never delivered, and no principal is authenticated, so each would be a control that
 * lies. The collapse toggle and the drawer are real, because they do what they appear to do.
 */

/** Keeps the reader on the same screen and changes only the language. */
const withLanguage = (pathname: string, language: Language): string =>
  `${pathname}?lang=${language}`;

const groupsFor = (
  t: (key: string) => string,
  pathname: string,
  language: Language,
): NavigationGroup[] =>
  NAVIGATION.map((section) => ({
    id: section.key,
    title: t(`admin.group.${section.key}`),
    items: section.destinations.map((entry) => ({
      id: entry.key,
      href: withLanguage(entry.href, language),
      label: t(`admin.nav.${entry.key}`),
      active: isCurrent(entry, pathname),
    })),
  }));

const Brand = (collapsed: boolean): ReactNode => (
  <a href="/" aria-label="Munaxa Work">
    <ProductLogo variant={collapsed ? 'symbol' : 'horizontal'} height={collapsed ? 24 : 26} />
  </a>
);

/**
 * The two-language switch.
 *
 * A link rather than a control with state: the language *is* the URL, so switching is navigation,
 * and a button would need client state that the address bar already holds. It names the language it
 * switches to, in that language, which is the one label a reader of either language can read.
 *
 * A plain anchor, like every link in this portal — see the note on `SidebarNav` below.
 */
const LanguageSwitch = ({
  pathname,
  language,
  label,
  target,
}: {
  readonly pathname: string;
  readonly language: Language;
  readonly label: string;
  readonly target: string;
}): ReactNode => (
  <a
    href={withLanguage(pathname, otherThan(language))}
    hrefLang={otherThan(language)}
    lang={otherThan(language)}
    aria-label={`${label}: ${target}`}
    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    {target}
  </a>
);

/**
 * The application shell: the sidebar, the drawer, the language switch and the page.
 *
 * **Every name the rail exposes is translated, `railLabel` included.** The rail is a `navigation`
 * landmark, and `Sidebar` names it `'Workspace'` when nothing says otherwise — which would leave an
 * Arabic reader hearing an English landmark name inside an otherwise Arabic navigation tree. The
 * catalogue has carried `admin.shell.workspace` in both languages all along; this passes it. The
 * prop arrived in `@munaxa/platform` 1.5.0, so the line and the dependency move together: against
 * the 1.3.0 this repository used to pin, the rail was an unnamed `complementary` and the prop did
 * not exist to pass.
 */
export const WorkspaceShell = ({ children }: { readonly children: ReactNode }): ReactNode => {
  const pathname = usePathname() ?? '/';
  const requested = useSearchParams()?.get('lang') ?? undefined;
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const groups = groupsFor(t, pathname, language);
  const other = otherThan(language);

  return (
    <div lang={language} dir={directionOf(language)}>
      <AppShellProvider>
        <AppShell
          skipLinkLabel={t('admin.shell.skipToContent')}
          sidebar={
            <Sidebar
              brand={Brand}
              collapseLabel={t('admin.shell.collapse')}
              expandLabel={t('admin.shell.expand')}
              railLabel={t('admin.shell.workspace')}
            >
              <SidebarNav groups={groups} label={t('admin.shell.mainNavigation')} />
            </Sidebar>
          }
          drawer={
            <NavigationDrawer label={t('admin.shell.navigation')} brand={Brand(false)}>
              <SidebarNav
                groups={groups}
                label={t('admin.shell.mainNavigation')}
                collapsed={false}
              />
            </NavigationDrawer>
          }
          topBar={
            <TopBar
              sticky
              actions={
                <LanguageSwitch
                  pathname={pathname}
                  language={language}
                  label={t('admin.shell.language')}
                  target={t(other === 'ar' ? 'admin.shell.arabic' : 'admin.shell.english')}
                />
              }
            >
              <SidebarTrigger label={t('admin.shell.openNavigation')} />
            </TopBar>
          }
        >
          {children}
        </AppShell>
      </AppShellProvider>
    </div>
  );
};
