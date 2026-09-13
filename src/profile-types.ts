/** Browser projection; developer instructions remain in workflow Host configuration. */
export interface ProfileView {
  selectedProfile: string | null;
  profiles: { id: string; roles: Record<string, { model: string; reasoningEffort: string }>; missingRequiredRoles: string[] }[];
  diagnostics: { file: string; error: string }[];
}

export type ProfileAction = "profiles" | "select-profile" | "reload-configuration";
