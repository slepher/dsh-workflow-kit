import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type { Effort } from "./types.js";
import { ROLES, resolveRole } from "./roles.js";

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export interface RoleExecution { model: string; reasoningEffort: Effort; developerInstructions: string }
export interface Profile { roles: Record<string, { model: string; reasoningEffort: Effort }> }
export interface ConfigurationDiagnostic { file: string; error: string }

/** Host and installer share one DSH-home-relative directory, independent of cwd. */
export function configurationDirectory(subdir = "workflow-kit", home = resolveDshHome()): string {
  if (!subdir || isAbsolute(subdir) || subdir.split(/[\\/]/).some(part => !part || part === "." || part === "..")) {
    throw new Error("workflow subdir must be a nonempty relative directory without dot segments");
  }
  const root = resolve(home), target = resolve(root, subdir);
  // Resolve existing directory components before reads or installation creates descendants.
  let canonicalRoot: string;
  try { canonicalRoot = realpathSync(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return target; throw error; }
  let current = root;
  for (const part of subdir.split(/[\\/]/)) {
    current = join(current, part);
    try {
      const actual = realpathSync(current), suffix = relative(canonicalRoot, actual);
      if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error("workflow subdir escapes DSH home through a symlink");
      if (!lstatSync(actual).isDirectory()) throw new Error("workflow subdir is not a directory");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; break; }
  }
  return target;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function parseProfile(value: unknown): Profile {
  const profile = object(value, "profile");
  if (Object.keys(profile).some(key => key !== "roles")) throw new Error("Unknown profile field");
  const roles = object(profile.roles, "roles"), result: Profile = { roles: Object.create(null) };
  for (const [id, raw] of Object.entries(roles)) {
    if (!ID.test(id)) throw new Error(`Invalid role ID: ${id}`);
    const row = object(raw, `role ${id}`);
    if (Object.keys(row).some(key => key !== "model" && key !== "reasoningEffort")
      || typeof row.model !== "string" || !row.model.trim()
      || typeof row.reasoningEffort !== "string" || !EFFORTS.has(row.reasoningEffort)) throw new Error(`Invalid model/reasoningEffort mapping: ${id}`);
    result.roles[id] = { model: row.model, reasoningEffort: row.reasoningEffort as Effort };
  }
  return result;
}

/** One atomically replaced catalog; captured execution inputs survive later reloads. */
export class WorkflowConfiguration {
  private catalog = { roles: new Map<string, string>(), profiles: new Map<string, Profile>(), diagnostics: [] as ConfigurationDiagnostic[] };
  constructor(readonly subdir = "workflow-kit", readonly home = resolveDshHome()) { this.reload(); }

  reload(): void {
    const directory = configurationDirectory(this.subdir, this.home);
    const next = { roles: new Map<string, string>(), profiles: new Map<string, Profile>(), diagnostics: [] as ConfigurationDiagnostic[] };
    const scan = (kind: "roles" | "profiles", extension: string, consume: (id: string, text: string) => void) => {
      const path = join(directory, kind);
      let entries;
      try {
        if (!lstatSync(path).isDirectory()) throw new Error(`${kind} must be a real directory`);
        entries = readdirSync(path, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { next.diagnostics.push({ file: kind, error: "Not installed" }); return; }
        throw error;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.name.endsWith(extension)) continue;
        const file = `${kind}/${entry.name}`, id = entry.name.slice(0, -extension.length);
        try {
          if (!entry.isFile() || !ID.test(id)) throw new Error("Expected a regular file with a valid ID; symlinks are not followed");
          consume(id, new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(path, entry.name))));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EPERM") throw error;
          next.diagnostics.push({ file, error: String(error) });
        }
      }
    };
    scan("roles", ".md", (id, text) => {
      if (!text.trim()) throw new Error("Role instructions must not be empty");
      next.roles.set(id, text);
    });
    scan("profiles", ".json", (id, text) => {
      const profile = parseProfile(JSON.parse(text));
      const missing = Object.keys(profile.roles).filter(role => !next.roles.has(role));
      if (missing.length) throw new Error(`Missing or invalid roles: ${missing.join(", ")}`);
      next.profiles.set(id, profile);
    });
    this.catalog = next;
  }

  view(requiredRoles: readonly string[] = []) {
    return {
      profiles: [...this.catalog.profiles].map(([id, profile]) => ({ id, roles: structuredClone(profile.roles), missingRequiredRoles: requiredRoles.filter(role => !Object.hasOwn(profile.roles, role)) })),
      diagnostics: structuredClone(this.catalog.diagnostics),
    };
  }

  capture(profileId: string | undefined, role: string, requiredRoles: readonly string[] = []): RoleExecution {
    if (profileId === undefined) throw new Error("No workflow profile selected");
    const profile = this.catalog.profiles.get(profileId);
    if (profile === undefined) throw new Error(`Selected workflow profile is unavailable: ${profileId}`);
    const missing = [...new Set([...requiredRoles, role])].filter(id => !Object.hasOwn(profile.roles, id));
    if (missing.length) throw new Error(`Profile ${profileId} lacks required roles: ${missing.join(", ")}`);
    return { ...profile.roles[role], developerInstructions: this.catalog.roles.get(role)! };
  }
}

/** Explicit installer: prepare all defaults first; preserve every existing different file. */
export function installConfiguration(catalog: WorkflowConfiguration, workflowSkillDir: string, implementationStandardDir: string): void {
  if (!isAbsolute(workflowSkillDir) || !isAbsolute(implementationStandardDir)) throw new Error("Installed skill directories must be absolute");
  const directory = configurationDirectory(catalog.subdir, catalog.home);
  const files = new Map<string, string>(), roles: Profile["roles"] = {};
  if (!lstatSync(join(implementationStandardDir, "SKILL.md")).isFile()) throw new Error("Implementation standard is not installed");
  for (const role of ROLES) {
    if (!lstatSync(join(workflowSkillDir, "references", "roles", role.protocol)).isFile()) throw new Error(`Role protocol is not installed: ${role.name}`);
    const resolved = resolveRole(role.name, workflowSkillDir, implementationStandardDir);
    files.set(`roles/${role.name}.md`, resolved.developerInstructions + "\n");
    roles[role.name] = { model: role.model, reasoningEffort: role.effort };
  }
  const profile = parseProfile({ roles });
  files.set("profiles/workflow-default.json", JSON.stringify(profile, null, 2) + "\n");
  for (const kind of ["roles", "profiles"]) {
    try { if (!lstatSync(join(directory, kind)).isDirectory()) throw new Error(`${kind} must be a real directory`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const missing: string[] = [], conflicts: string[] = [];
  for (const [file, text] of files) {
    try {
      if (!lstatSync(join(directory, file)).isFile() || readFileSync(join(directory, file), "utf8") !== text) conflicts.push(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.push(file); }
  }
  if (conflicts.length) throw new Error(`Preserved existing files that differ from installation defaults: ${conflicts.join(", ")}`);
  for (const kind of ["roles", "profiles"]) mkdirSync(join(directory, kind), { recursive: true, mode: 0o700 });
  for (const file of missing) writeFileSync(join(directory, file), files.get(file)!, { flag: "wx", mode: 0o600 });
  catalog.reload();
}
