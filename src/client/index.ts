import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ProfileView } from "../profile-types.js";
import { ProfileSelector, type ProfileSelectorInjected } from "./ProfileSelector.js";
import { en, zh } from "./locales.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap { "dsh-workflow-kit": keyof typeof zh }
}
export const inject = ["slots", "connection", "locale"];
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("dsh-workflow-kit", { zh, en }), "Workflow profile locales");
  const connection = ctx.get("connection") as ConnectionHandle;
  const request: ProfileSelectorInjected["request"] = async (sessionId, action, signal, profileId) => {
    const result = await connection.rpc.call("/workflow", action, { sessionId, ...(profileId === undefined ? {} : { profileId }) }, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as ProfileView;
  };
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities", id: "workflow-profile", order: 40, locale: "dsh-workflow-kit",
    inject: (): ProfileSelectorInjected => ({ request }),
  }, ProfileSelector));
}
