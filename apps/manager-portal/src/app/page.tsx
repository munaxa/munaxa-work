import type { ReactNode } from 'react';
import { Button, Card } from '@munaxa/ui';

/**
 * Bootstrap page. It consumes the platform design system and the product API; it owns no
 * business logic and holds no state a domain owns.
 *
 * The Button and Card are here deliberately rather than as decoration: they prove the design
 * system resolves, renders and themes correctly in a real build. A dependency nothing imports
 * is a dependency nobody has verified.
 */
const HomePage = (): ReactNode => (
  <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
    <Card className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Munaxa Work — Manager</h1>
      <p className="text-sm opacity-80">
        Manager self-service. Team visibility follows the organizational hierarchy and backend
        permissions.
      </p>
      <div>
        <Button>Continue</Button>
      </div>
    </Card>
  </main>
);

export default HomePage;
