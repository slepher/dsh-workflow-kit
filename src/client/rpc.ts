import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { CodingStrategy } from "../constants.js";
import type { ConfigurationsView, ProfileAction, ProfileView } from "../profile-types.js";

/** Browser calls this plugin makes on its own `/workflow` channel. */
export interface WorkflowRpc {
  /** Read every effective configuration; requires no Session. */
  configurations(signal?: AbortSignal): Promise<ConfigurationsView>;
  /** Read the catalog plus one native Session's recorded selection and strategy facts. */
  profiles(sessionId: string, signal?: AbortSignal): Promise<ProfileView>;
  /** Record one configuration as that native Session's selection. */
  selectProfile(sessionId: string, profileId: string, signal?: AbortSignal): Promise<ProfileView>;
  /** Record or clear that native Session's coding-strategy override. */
  selectStrategy(sessionId: string, strategy: CodingStrategy | null, signal?: AbortSignal): Promise<ProfileView>;
}

/**
 * Wrap the plugin's own channel in typed calls.
 * @param connection - the client connection carrying the authenticated channel.
 * @returns the call face both browser surfaces use.
 */
export function createWorkflowRpc(connection: ConnectionHandle): WorkflowRpc {
  const call = async <T>(action: ProfileAction, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    const result = await connection.rpc.call("/workflow", action, payload, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as T;
  };
  return {
    configurations: signal => call<ConfigurationsView>("configurations", {}, signal),
    profiles: (sessionId, signal) => call<ProfileView>("profiles", { sessionId }, signal),
    selectProfile: (sessionId, profileId, signal) =>
      call<ProfileView>("select-profile", { sessionId, profileId }, signal),
    selectStrategy: (sessionId, strategy, signal) =>
      call<ProfileView>("select-strategy", { sessionId, strategy }, signal),
  };
}
