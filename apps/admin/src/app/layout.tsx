import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BrandProvider, brandIcons, brandOpenGraphImage, productBrands } from '@munaxa/ui';

import { WorkspaceShell } from '../shell/workspace-shell';

import './globals.css';

const brand = productBrands.work;
const DESCRIPTION = 'Enterprise HR administration.';

/**
 * What a browser shows for this surface.
 *
 * Read from the brand registry rather than typed out. Every value here — the icon, the share
 * image, the application name, the colour the browser paints its chrome — is product identity,
 * and product identity has one source. Three Munaxa products open in one window are otherwise
 * three identical tabs, and the tab icon is the only thing distinguishing them at that size.
 *
 * The title says which surface of Work this is; the brand says which product it belongs to.
 * `%s · Munaxa Work` puts the product last, where a truncated tab still reads as the screen.
 */
export const metadata: Metadata = {
  title: { default: 'Munaxa Work — Administration', template: `%s · ${brand.name}` },
  description: DESCRIPTION,
  applicationName: brand.name,
  icons: brandIcons(brand),
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: 'Munaxa Work — Administration',
    description: DESCRIPTION,
    images: [brandOpenGraphImage(brand)],
  },
  twitter: { card: 'summary_large_image', images: [brandOpenGraphImage(brand).url] },
};

/**
 * Every screen in this portal is rendered per request, and none is prerendered at build time.
 *
 * Two independent reasons, and either alone would decide it.
 *
 * **What is on these pages is one tenant's live data.** Every read goes out with `cache: 'no-store'`
 * because a cached page of somebody's personal file is a page of personal data sitting somewhere
 * nobody chose — and a page *prerendered at build time* is that, committed into the deployment
 * artefact. Nothing here is publishable, so nothing here is static.
 *
 * **The reader's language is `?lang=`.** The shell reads it to choose the navigation's language and
 * the document's direction, which a statically prerendered route cannot do: `useSearchParams()`
 * bails out of prerendering unless it is behind a Suspense boundary, and a boundary here would mean
 * shipping the frame in the reference language and correcting it after hydration — an Arabic reader
 * watching the page flip. Rendering per request is the honest version.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * The burgundy, and the one place in this application a raw hex is right: the browser paints
   * the address bar and the task-switcher card before a stylesheet exists to read `--primary`
   * from. It comes from the registry, which reads the theme, so it is still one value.
   */
  themeColor: brand.color,
};

/**
 * The document shell.
 *
 * `lang` and `dir` on `<html>` are the document's defaults and nothing more. The reader's language
 * arrives as `?lang=` on the request, which a layout in the App Router cannot see, so the pair that
 * actually follows the reader is set by `WorkspaceShell` on the element wrapping the navigation and
 * the content — where it applies to the frame as well as the page. Direction is never chosen
 * separately from language, in either place.
 *
 * `BrandProvider` declares the product once, beside the theme `globals.css` imports. Every
 * `ProductLogo` below reads it rather than being handed a file, so this application cannot show the
 * School or Docs mark.
 *
 * `WorkspaceShell` is what makes the fifteen screens one application: before it, no page linked to
 * any other and the only navigation was the address bar.
 */
const RootLayout = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <html lang="en" dir="ltr">
    <body className="bg-background text-foreground">
      <BrandProvider product="work">
        <WorkspaceShell>{children}</WorkspaceShell>
      </BrandProvider>
    </body>
  </html>
);

export default RootLayout;
