import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the run record shows while Payroll is being asked.
 *
 * A skeleton rather than a spinner, so the four counts and the eight sections arrive in the place
 * and at the size they will occupy. No placeholder figure: a payroll count somebody might act on
 * must never be invented, not even for a hundred milliseconds.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" aria-busy="true">
    <div className="h-8 w-36 animate-pulse rounded bg-muted" />
    <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
    <div className="h-28 w-full animate-pulse rounded-lg bg-muted" />
    {Array.from({ length: 3 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
