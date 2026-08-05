import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Munaxa Work Manager',
  description: 'Manager self-service.',
};

/**
 * The document shell. Language and direction are placeholders until Phase 1 supplies locale
 * resolution — they are attributes here, never assumptions baked into layout or components.
 */
const RootLayout = ({ children }: { readonly children: ReactNode }): ReactNode => (
  <html lang="en" dir="ltr">
    <body>{children}</body>
  </html>
);

export default RootLayout;
