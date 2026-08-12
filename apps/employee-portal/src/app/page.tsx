import type { ReactNode } from 'react';
import { Button, Card, ProductLogo } from '@munaxa/ui';

/**
 * Bootstrap page. It consumes the platform design system and the product API; it owns no
 * business logic and holds no state a domain owns.
 *
 * The Button and Card are here deliberately rather than as decoration: they prove the design
 * system resolves, renders and themes correctly in a real build. A dependency nothing imports
 * is a dependency nobody has verified. `ProductLogo` earns its place the same way — it proves
 * the approved Work artwork is actually being served from this application's `public/`, which
 * a path in a config file does not.
 *
 * The heading was the product's name set as text. This surface is where somebody first sees
 * which product they are in, and that is what the approved lockup is for; the name is the
 * logo's own accessible name, so nothing is lost to a screen reader and nothing is said twice.
 * Below the `sm` breakpoint the lockup gives way to the symbol rather than being
 * squeezed into a phone-width card.
 */
const HomePage = (): ReactNode => (
  <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
    <Card className="flex flex-col gap-4 p-6">
      <h1>
        <ProductLogo variant="horizontal" height={34} compactBelow="sm" priority />
      </h1>
      <p className="text-sm opacity-80">
        Employee self-service. Every action here is a transaction that routes through Workflow
        (ADR-0026).
      </p>
      <div>
        <Button>Continue</Button>
      </div>
    </Card>
  </main>
);

export default HomePage;
