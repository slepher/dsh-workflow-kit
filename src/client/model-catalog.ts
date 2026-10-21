import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the ctx.remote Context merge into this browser program.
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type { WorkflowRpc } from "./rpc.js";

/** One selectable model with the efforts its adapter advertises. */
export interface ModelOption {
  model: string;
  name: string;
  efforts: readonly { id: string; name: string }[];
  /** Adapter-configured default materialized when the caller omits an effort. */
  defaultEffort?: string;
}

/** One adapter-owned provider and the models it advertises, in catalog order. */
export interface ModelGroup {
  provider: string;
  name: string;
  models: readonly ModelOption[];
}

/** One catalog read: the advertised provider groups plus whether any failed to load. */
export interface ModelOptions {
  groups: readonly ModelGroup[];
  partial: boolean;
}

/**
 * Read the adapter-owned model catalog at root scope — the same wire read the
 * native composer model seat performs, so the routes offered per role match the
 * ones the deployment can serve, grouped the way that seat groups them. A route
 * the composer menu hides (`allowMainSession: false`) still has to be selectable
 * for workflow roles, so the plugin's own channel contributes those groups too.
 * @param ctx - client context carrying the remote session namespace.
 * @param rpc - the plugin's own channel, which carries the hidden-route catalog.
 * @returns advertised provider groups and provider-failure state.
 */
export async function loadModelOptions(ctx: Context, rpc?: WorkflowRpc): Promise<ModelOptions> {
  const response = await ctx.remote.session.modelCatalog();
  if (!response.ok) throw new Error(response.error.message);
  const groups: ModelGroup[] = response.value.groups.map(group => ({
    provider: group.id,
    name: group.name,
    models: group.models.map(model => ({
      model: model.id,
      name: model.name,
      efforts: (model.reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name })),
      ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
    })),
  }));
  let partial = response.value.failures.length > 0;
  if (rpc !== undefined) {
    try {
      const hidden = await rpc.catalog();
      for (const group of hidden.groups ?? []) {
        if (groups.some(existing => existing.provider === group.provider)) continue;
        groups.push({
          provider: group.provider,
          name: group.name,
          models: group.models.map(model => ({
            model: model.id,
            name: model.name,
            efforts: model.efforts,
            ...(model.defaultEffort === undefined ? {} : { defaultEffort: model.defaultEffort }),
          })),
        });
      }
    } catch {
      // The hidden-route read is an addition to a catalog that already loaded;
      // losing it marks the read partial instead of failing the page.
      partial = true;
    }
  }
  return { groups, partial };
}
