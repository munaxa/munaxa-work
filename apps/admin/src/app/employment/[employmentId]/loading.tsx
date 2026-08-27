import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

/**
 * What the record shows while thirteen modules are being asked.
 *
 * The portal had no loading surface at all: every page was server-rendered and a slow module left
 * the reader on the previous screen with nothing happening. This record asks thirteen modules at
 * once, so the slowest of them decides when the page appears, and the difference between "loading"
 * and "broken" has to be visible.
 *
 * It is a skeleton rather than a spinner because it also holds the layout still: the sections
 * arrive in the same place and at the same size they occupy, so the page does not jump when they do.
 */
const Loading = (): ReactNode => (
  <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8" aria-busy="true">
    <div className="h-8 w-64 animate-pulse rounded bg-muted" />
    {Array.from({ length: 6 }, (_, index) => index).map((index) => (
      <Card key={index} className="flex flex-col gap-3 p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </Card>
    ))}
  </div>
);

export default Loading;
