import type { ReactNode } from 'react';

/**
 * Bootstrap page. This application consumes the platform design system and the product API; it
 * owns no business logic, and it holds no state that a domain owns.
 */
const HomePage = (): ReactNode => (
  <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
    <h1 className="text-2xl font-semibold">Munaxa Work — Manager</h1>
    <p className="text-sm opacity-80">
      Manager self-service. Team visibility follows the organizational hierarchy and backend
      permissions.
    </p>
  </main>
);

export default HomePage;
