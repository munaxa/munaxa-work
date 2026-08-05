import type { CommandHandler, Query, QueryHandler, Command } from '../cqrs/pipeline.js';
import type { EventHandler } from '../persistence/unit-of-work.js';

/**
 * Automatic module registration.
 *
 * A module declares what it offers; nothing registers it by hand. Manual registration means a
 * permission that exists in code but not in the administration screen, a route with no health
 * check, an event nobody subscribed to — each invisible until a customer finds it.
 */

export interface NavigationEntry {
  readonly key: string;
  readonly path: string;
  readonly permission: string;
  readonly order: number;
}

export interface ModuleHealth {
  readonly name: string;
  check(): Promise<'up' | 'down'>;
}

export interface WorkModule {
  readonly name: string;
  readonly commands?: readonly CommandHandler<Command, unknown>[];
  readonly queries?: readonly QueryHandler<Query, unknown>[];
  readonly eventHandlers?: readonly EventHandler[];
  readonly navigation?: readonly NavigationEntry[];
  readonly health?: readonly ModuleHealth[];
  /** Permissions the module owns beyond those its handlers declare. */
  readonly permissions?: readonly string[];
}

export interface ModuleRegistration {
  readonly modules: readonly WorkModule[];
  readonly permissions: readonly string[];
  readonly navigation: readonly NavigationEntry[];
}

export class ModuleRegistry {
  private readonly modules = new Map<string, WorkModule>();

  public register(module: WorkModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module ${module.name} is registered twice.`);
    }
    this.modules.set(module.name, module);
  }

  public get registered(): readonly WorkModule[] {
    return [...this.modules.values()];
  }

  /** Everything the application needs to wire itself, derived rather than maintained. */
  public describe(): ModuleRegistration {
    const modules = this.registered;
    const permissions = new Set<string>();

    for (const module of modules) {
      for (const handler of module.commands ?? []) permissions.add(handler.permission);
      for (const handler of module.queries ?? []) permissions.add(handler.permission);
      for (const permission of module.permissions ?? []) permissions.add(permission);
    }

    const navigation = modules
      .flatMap((module) => module.navigation ?? [])
      .sort((left, right) => left.order - right.order);

    return { modules, permissions: [...permissions].sort(), navigation };
  }

  public async health(): Promise<Readonly<Record<string, 'up' | 'down'>>> {
    const checks = this.registered.flatMap((module) => module.health ?? []);
    const results = await Promise.all(
      checks.map(async (check) => [check.name, await check.check()] as const),
    );
    return Object.fromEntries(results);
  }
}
