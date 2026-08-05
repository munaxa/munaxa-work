import type { FeatureContext, FeatureFlagPort } from '../ports/index.js';

/**
 * Feature flag evaluation with tenant overrides.
 *
 * Resolution order is specific first: a user override beats a tenant override, which beats the
 * default. That order is what makes a flag usable for a staged rollout — enable for one tenant,
 * then for a pilot group inside it, without touching the default that everyone else sees.
 *
 * An unknown flag is **off**. A flag nobody defined is a flag nobody reviewed, and defaulting it
 * on ships unreviewed behaviour to every tenant at once.
 */

export interface FeatureFlagDefinition {
  readonly key: string;
  readonly enabledByDefault: boolean;
  /** Tenants whose value differs from the default. */
  readonly tenantOverrides?: Readonly<Record<string, boolean>>;
  /** Users whose value differs from their tenant's — a pilot group. */
  readonly userOverrides?: Readonly<Record<string, boolean>>;
}

export class InMemoryFeatureFlags implements FeatureFlagPort {
  private readonly definitions = new Map<string, FeatureFlagDefinition>();

  public constructor(definitions: readonly FeatureFlagDefinition[] = []) {
    for (const definition of definitions) this.definitions.set(definition.key, definition);
  }

  public define(definition: FeatureFlagDefinition): void {
    this.definitions.set(definition.key, definition);
  }

  public isEnabled(flag: string, context: FeatureContext): Promise<boolean> {
    const definition = this.definitions.get(flag);

    if (definition === undefined) return Promise.resolve(false);

    const forUser =
      context.userId === undefined ? undefined : definition.userOverrides?.[context.userId];
    const forTenant = definition.tenantOverrides?.[context.tenantId];

    return Promise.resolve(forUser ?? forTenant ?? definition.enabledByDefault);
  }

  /** Every flag and its default, for the administration screen. */
  public declared(): readonly FeatureFlagDefinition[] {
    return [...this.definitions.values()];
  }
}
