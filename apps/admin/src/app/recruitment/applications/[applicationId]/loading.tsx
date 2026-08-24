import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the application record shows while Recruitment is being asked.
 *
 * A skeleton rather than a spinner, so the candidate block and the four sections arrive in the place
 * and at the size they will occupy. Nothing here suggests a status: an application's state is the
 * one thing on this record somebody acts on, and a placeholder for it would be a guess.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" aria-busy="true">
    <div className="h-8 w-44 animate-pulse rounded bg-muted" />
    <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
    {Array.from({ length: 3 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
