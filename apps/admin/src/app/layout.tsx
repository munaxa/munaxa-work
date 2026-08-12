import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { BrandProvider, brandIcons, brandOpenGraphImage, productBrands } from '@munaxa/ui';

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
 * The document shell. Language and direction are placeholders until Phase 1 supplies locale
 * resolution — they are attributes here, never assumptions baked into layout or components.
 *
 * `BrandProvider` declares the product once, beside the theme `globals.css` imports. Every
 * `ProductLogo` below reads it rather than being handed a file, so this application cannot show
 * the School or Docs mark, and the shell this product grows later inherits that for free.
 */
const RootLayout = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <html lang="en" dir="ltr">
    <body className="bg-background text-foreground">
      <BrandProvider product="work">{children}</BrandProvider>
    </body>
  </html>
);

export default RootLayout;
