import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the ctx.remote Context merge into this browser program.
import type {} from "@deepseek-ai/dsh-api-remotes/client";

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
 * ones the deployment can serve, grouped the way that seat groups them.
 * @param ctx - client context carrying the remote session namespace.
 * @returns advertised provider groups and provider-failure state.
 */
export async function loadModelOptions(ctx: Context): Promise<ModelOptions> {
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
  return { groups, partial: response.value.failures.length > 0 };
}
