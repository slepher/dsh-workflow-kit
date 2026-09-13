/** Browser projection of the workflow configuration catalog; developer instructions remain Host-side. */

/** One role's effective execution inputs, plus whether the user layer overrides it. */
export interface RoleView {
  provider: string;
  model: string;
  reasoningEffort: string;
  overridden: boolean;
}

/** One configuration the picker and the settings page list. */
export interface ConfigView {
  id: string;
  /** Whether an installer-owned file defines this configuration. */
  builtin: boolean;
  roles: Record<string, RoleView>;
  missingRequiredRoles: string[];
}

/** Effective configurations plus the fixed role catalog. */
export interface CatalogView {
  configs: ConfigView[];
  roleNames: string[];
}

/** Session-scoped read: the catalog plus that native Session's recorded selection. */
export interface ProfileView extends CatalogView {
  selectedProfile: string | null;
}

/** Settings-page read: the catalog plus the stored new-Session default. */
export interface ConfigurationsView extends CatalogView {
  defaultConfig: string | null;
}

/** Endpoints the browser half calls on the `/workflow` channel. */
export type ProfileAction = "configurations" | "profiles" | "select-profile";

/** One stored role override as this browser writes it. */
export type StoredRoleValue = { provider: string; model: string; reasoningEffort: string };

/**
 * The `dsh-workflow-kit` settings section as the browser writes it. Role maps
 * are sparse, so a role this section omits keeps its installed value.
 */
export interface WorkflowSettingsSection {
  defaultConfig: string;
  configs: Record<string, { roles: Record<string, StoredRoleValue> }>;
}
