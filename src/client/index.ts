import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
// Type-only: the ctx.settingsScope merge and the scope contract.
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
// Type-only: pulls the ctx.remote Context merge into this program.
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import { WORKFLOW_SETTINGS_NAMESPACE, WORKFLOW_PLUGIN_ID } from "../constants.js";
import type { WorkflowSettingsSection as WorkflowSettingsData } from "../profile-types.js";
import type { CodingStrategy } from "../constants.js";
import { ConfigPicker, type ConfigPickerInjected } from "./ConfigPicker.js";
import { WorkflowSettingsSection, type WorkflowSettingsInjected } from "./WorkflowSettingsSection.js";
import { WorkflowSettingsController } from "./settings-controller.js";
import { createWorkflowRpc } from "./rpc.js";
import { registerSettingsNavIcon } from "./settings-nav-icon.js";
import { en, zh } from "./locales.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap { "dsh-workflow-kit": keyof typeof zh }
}

/**
 * Services this browser half reads: slots, the session carrier, copy, settings,
 * and the wire. `remote.session` is a separate injection from `remote` — the
 * settings page reads the adapter model catalog through that namespace.
 */
export const inject = ["slots", "connection", "locale", "settingsScope", "remote", "remote.session"];

/** Register the composer picker and the Workflow settings page. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("dsh-workflow-kit", { zh, en }), "Workflow locales");
  const connection = ctx.get("connection") as ConnectionHandle;
  const rpc = createWorkflowRpc(connection);
  const t = ctx.locale.bind(WORKFLOW_PLUGIN_ID);
  // The shell owns settings-nav glyphs; this marks our row so the plugin
  // stylesheet can paint the branch icon it asked to show.
  ctx.effect(() => registerSettingsNavIcon(() => t("nav")), "dsh-workflow-kit: settings nav icon");

  const request: ConfigPickerInjected["request"] = (sessionId, action, value) =>
    action === "select-profile" ? rpc.selectProfile(sessionId, value ?? "")
      : action === "select-strategy" ? rpc.selectStrategy(sessionId, value === undefined || value === null ? null : value as CodingStrategy)
      : rpc.profiles(sessionId);
  // The picker selects only; every edit lives on the settings page.
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left", id: "workflow-config", order: 30,
    locale: WORKFLOW_PLUGIN_ID,
    inject: (): ConfigPickerInjected => ({ request }),
  }, ConfigPicker));

  const scope = ctx.settingsScope.bind<WorkflowSettingsData>({ namespace: WORKFLOW_SETTINGS_NAMESPACE });
  const controller = new WorkflowSettingsController(ctx, scope, rpc);
  ctx.effect(() => () => { controller.dispose(); }, "dsh-workflow-kit: settings controller");
  // Ordered last: a deployment-shaping page belongs after the routine ones.
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section", id: "workflow", order: 50, label: () => t("nav"),
    locale: WORKFLOW_PLUGIN_ID,
    inject: (): WorkflowSettingsInjected => ({
      hooks: { workflowSettings: controller.store },
      setRole: (configId, role, value) => controller.setRole(configId, role, value),
      copyConfig: (sourceId, newId) => controller.copyConfig(sourceId, newId),
      renameConfig: (oldId, newId) => controller.renameConfig(oldId, newId),
      resetConfig: configId => controller.resetConfig(configId),
      setDefault: configId => controller.setDefault(configId),
      setStrategy: (kind, value) => controller.setStrategy(kind, value),
    }),
  }, WorkflowSettingsSection));
}
