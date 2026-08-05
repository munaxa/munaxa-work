import type { DomainEvent } from './domain-event.js';
import type { EventDispatcher, EventHandler } from '../persistence/unit-of-work.js';

/**
 * Dispatches events to in-process handlers, in registration order.
 *
 * A failing handler must not hide the others: the events have already happened and cannot be
 * un-happened by a consumer that threw. Every handler therefore runs, and the failures are
 * reported together afterwards. The alternative — stopping at the first failure — means a
 * notification bug silently prevents an audit record.
 *
 * This is the Phase 1 adapter. A message bus replaces it later without any domain change,
 * which is the entire reason the dispatcher is an interface.
 */
export class InProcessEventDispatcher implements EventDispatcher {
  private readonly handlers = new Map<string, EventHandler[]>();

  public constructor(
    private readonly onHandlerError?: (error: unknown, event: DomainEvent) => void,
  ) {}

  public register(handler: EventHandler): void {
    const existing = this.handlers.get(handler.eventName) ?? [];
    this.handlers.set(handler.eventName, [...existing, handler]);
  }

  public async dispatch(events: readonly DomainEvent[]): Promise<void> {
    const failures: unknown[] = [];

    for (const event of events) {
      for (const handler of this.handlers.get(event.eventName) ?? []) {
        try {
          await handler.handle(event);
        } catch (error) {
          failures.push(error);
          this.onHandlerError?.(error, event);
        }
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `${String(failures.length)} event handler(s) failed.`);
    }
  }
}
