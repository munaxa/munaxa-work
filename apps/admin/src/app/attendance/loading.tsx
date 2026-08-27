import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the attendance register shows while Attendance is being asked.
 *
 * A skeleton rather than a spinner because it holds the layout still. It carries no text at all, so
 * it can carry no placeholder figure — a count on an attendance screen is one somebody acts on, and
 * a fake one is worse than none.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" aria-busy="true">
    <div className="h-8 w-40 animate-pulse rounded bg-muted" />
    <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
    {Array.from({ length: 3 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
