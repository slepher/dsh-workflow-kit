import { readdirSync, readFileSync } from "node:fs";
import type { Effort } from "./types.js";
import { ROLES, resolveRole } from "./roles.js";
import { SETTINGS_EFFORTS } from "./settings.js";
import type { WorkflowSettingsSection } from "./profile-types.js";

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const EFFORTS = new Set<string>(SETTINGS_EFFORTS);
/** One role's captured execution inputs, including the provider that serves its model. */
export interface RoleInput { provider: string; model: string; reasoningEffort: Effort }
export interface RoleExecution extends RoleInput { developerInstructions: string }
export interface Profile { roles: Record<string, RoleInput> }

/** The catalog layer shipped inside this package, keyed by configuration id. */
export type BuiltinProfiles = Record<string, Profile>;

/** Composes one role's developer instructions for this deployment. */
export type RoleInstructions = (role: string) => string;

/** Directory of the configurations this package ships. */
const SHIPPED_DIRECTORY = new URL("../profiles/", import.meta.url);

/**
 * Read the configurations shipped inside this package. They are plugin content,
 * not user configuration: nothing here is installed into DSH home, and the
 * stored user layer in `settings.yaml` is the only per-deployment state.
 * @param directory - shipped-configuration directory; defaults to the package's own.
 * @returns one parsed profile per shipped file.
 */
export function loadBuiltinProfiles(directory: URL = SHIPPED_DIRECTORY): BuiltinProfiles {
  const builtin: BuiltinProfiles = Object.create(null);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -".json".length);
    if (!entry.isFile() || !ID.test(id)) throw new Error(`Invalid shipped workflow configuration: ${entry.name}`);
    builtin[id] = parseProfile(JSON.parse(readFileSync(new URL(entry.name, directory), "utf8")));
  }
  if (Object.keys(builtin).length === 0) throw new Error("The package ships no workflow configuration");
  return builtin;
}

/**
 * Parse one configuration definition. Strict on purpose: a malformed shipped
 * file or stored section is a defect, never silently dropped.
 * @param value - the parsed JSON value.
 * @returns the validated profile.
 */
export function parseProfile(value: unknown): Profile {
  const profile = object(value, "profile");
  if (Object.keys(profile).some(key => key !== "roles")) throw new Error("Unknown profile field");
  const roles = object(profile.roles, "roles"), result: Profile = { roles: Object.create(null) };
  for (const [id, raw] of Object.entries(roles)) {
    if (!ID.test(id)) throw new Error(`Invalid role ID: ${id}`);
    const row = object(raw, `role ${id}`);
    if (Object.keys(row).some(key => key !== "model" && key !== "reasoningEffort" && key !== "provider")
      || typeof row.provider !== "string" || !row.provider.trim()
      || typeof row.model !== "string" || !row.model.trim()
      || typeof row.reasoningEffort !== "string" || !EFFORTS.has(row.reasoningEffort)) throw new Error(`Invalid provider/model/reasoningEffort mapping: ${id}`);
    result.roles[id] = { provider: row.provider, model: row.model, reasoningEffort: row.reasoningEffort as Effort };
  }
  return result;
}

/** Compose the deployment's role-instruction resolver from its installed skills. */
export function roleInstructions(workflowSkillDir?: string, implementationStandardDir?: string): RoleInstructions {
  return role => resolveRole(role, workflowSkillDir, implementationStandardDir).developerInstructions;
}

/**
 * The effective configuration catalog. The role set is fixed by the shipped
 * role catalog; each role resolves through the stored user override, then the
 * shipped configuration, then the shipped role default. Captured execution
 * inputs survive later reloads of the stored layer.
 */
export class WorkflowConfiguration {
  private user: WorkflowSettingsSection["configs"] = Object.create(null);
  private profiles = new Map<string, Profile>();

  /**
   * @param builtin - the package's shipped configurations.
   * @param instructions - composes one role's developer instructions.
   */
  constructor(private readonly builtin: BuiltinProfiles, private readonly instructions: RoleInstructions) {
    this.merge();
  }

  /**
   * Replace the stored user layer.
   * @param configs - stored per-configuration role overrides; unknown ids and roles are ignored.
   */
  setUserConfigs(configs: WorkflowSettingsSection["configs"]): void {
    const next: WorkflowSettingsSection["configs"] = Object.create(null);
    for (const [id, config] of Object.entries(configs)) {
      if (!ID.test(id)) continue;
      const roles: Record<string, RoleInput> = Object.create(null);
      for (const [name, row] of Object.entries(config.roles)) {
        if (!ROLES.some(role => role.name === name)) continue;
        // The settings schema already restricts this field to the effort union.
        roles[name] = { provider: row.provider, model: row.model, reasoningEffort: row.reasoningEffort as Effort };
      }
      next[id] = { roles };
    }
    this.user = next;
    this.merge();
  }

  /** Recompute every configuration: stored override, then shipped file, then shipped role default. */
  private merge(): void {
    const ids = new Set([...Object.keys(this.builtin), ...Object.keys(this.user)]);
    const profiles = new Map<string, Profile>();
    for (const id of [...ids].sort()) {
      const shipped = this.builtin[id], overrides = this.user[id]?.roles;
      const roles: Record<string, RoleInput> = Object.create(null);
      for (const role of ROLES) {
        // Both layers are validated where they enter: the shipped parser and the settings schema.
        const resolved = overrides?.[role.name] ?? shipped?.roles[role.name]
          ?? { provider: role.provider, model: role.model, reasoningEffort: role.effort };
        roles[role.name] = {
          provider: resolved.provider, model: resolved.model, reasoningEffort: resolved.reasoningEffort as Effort,
        };
      }
      profiles.set(id, { roles });
    }
    this.profiles = profiles;
  }

  view() {
    return {
      configs: [...this.profiles].map(([id, profile]) => ({
        id,
        builtin: Object.hasOwn(this.builtin, id),
        roles: Object.fromEntries(Object.entries(profile.roles).map(([name, row]) => [name, {
          ...row,
          overridden: this.user[id]?.roles[name] !== undefined,
        }])),
        missingRequiredRoles: ROLES.filter(role => !Object.hasOwn(profile.roles, role.name)).map(role => role.name),
      })),
      roleNames: ROLES.map(role => role.name),
    };
  }

  capture(profileId: string | undefined, role: string, requiredRoles: readonly string[] = []): RoleExecution {
    if (profileId === undefined) throw new Error("No workflow profile selected");
    const profile = this.profiles.get(profileId);
    if (profile === undefined) throw new Error(`Selected workflow profile is unavailable: ${profileId}`);
    const missing = [...new Set([...requiredRoles, role])].filter(id => !Object.hasOwn(profile.roles, id));
    if (missing.length) throw new Error(`Profile ${profileId} lacks required roles: ${missing.join(", ")}`);
    return { ...profile.roles[role], developerInstructions: this.instructions(role) };
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
