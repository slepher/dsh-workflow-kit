import { parseArgs } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { composeEntries, loadOptionalPatches, loadOverlayPatches, loadProfileDirectory, resolveProfileDir } from "@deepseek-ai/dsh-app-boot";
import { WorkflowConfiguration, configurationDirectory, installConfiguration } from "../lib/configuration.js";

/** Read the deployed patch layers without starting a Host or creating a profile. */
export function installForProfile({ profile, home = resolveDshHome(), patches = [] }) {
  if (!profile) throw new Error("--profile is required");
  const directory = resolveProfileDir(profile, home);
  const loaded = loadProfileDirectory("dsh", directory, join(directory, "package.json"));
  const entries = composeEntries([
    ...loaded.layers.map(layer => layer.patches), loaded.patches,
    loadOptionalPatches("dsh", join(home, "cordis.patch.yml")) ?? [],
    ...patches.map(path => loadOverlayPatches("dsh", resolve(path))),
  ]);
  const matches = entries.filter(entry => entry.id === "dsh-workflow-kit" || entry.name === "dsh-workflow-kit");
  if (matches.length !== 1 || matches[0].id !== "dsh-workflow-kit" || matches[0].name !== "dsh-workflow-kit" || matches[0].disabled === true) {
    throw new Error("The target profile must enable exactly one dsh-workflow-kit entry");
  }
  const config = matches[0].config;
  if (!config || typeof config.workflowSkillDir !== "string" || !isAbsolute(config.workflowSkillDir)
    || config.subdir !== undefined && typeof config.subdir !== "string"
    || config.implementationStandardDir !== undefined && (typeof config.implementationStandardDir !== "string" || !isAbsolute(config.implementationStandardDir))
    || matches[0].disabled !== undefined && matches[0].disabled !== false) {
    throw new Error("Installation requires literal workflowSkillDir, optional implementationStandardDir/subdir and enabled state in the effective profile");
  }
  const catalog = new WorkflowConfiguration(config.subdir, home);
  installConfiguration(catalog, config.workflowSkillDir, config.implementationStandardDir ?? resolve(config.workflowSkillDir, "../audit-implementation-simplicity"));
  return { profile, directory: configurationDirectory(config.subdir, home), ...catalog.view() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { profile: { type: "string" }, "dsh-home": { type: "string" }, patch: { type: "string", multiple: true } } });
  console.log(JSON.stringify(installForProfile({ profile: values.profile, home: values["dsh-home"] === undefined ? resolveDshHome() : resolve(values["dsh-home"]), patches: values.patch }), null, 2));
}
