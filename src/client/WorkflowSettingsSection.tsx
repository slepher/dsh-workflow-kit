/**
 * The Workflow settings page (`settings.section`): one configuration chosen
 * from a dropdown, then one row per role of that configuration. A shipped
 * configuration is editable in place through sparse user overrides and can be
 * reverted whole; a copy is an ordinary user configuration that can be renamed
 * or deleted. The main agent (`manager`) is listed but not editable — it runs
 * on the composer's model.
 */
import { useState, type ReactNode } from "react";
import { Button, IconChevronDownOutline14, Input, Menu, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ConfigView, RoleView } from "../profile-types.js";
import type { RoleDraft, WorkflowSettingsState } from "./settings-controller.js";
import { RouteMenu } from "./RouteMenu.js";
import type { WorkflowLocaleKey } from "./locales.js";
import { installClientStyles } from "./styles.js";

/** Registered face of the settings page: one store plus every write it offers. */
export interface WorkflowSettingsInjected {
  hooks: { workflowSettings: Pick<SnapshotStore<WorkflowSettingsState>, "getSnapshot" | "subscribe"> };
  setRole(configId: string, role: string, value: RoleDraft): Promise<void>;
  copyConfig(sourceId: string, newId: string): Promise<void>;
  renameConfig(oldId: string, newId: string): Promise<void>;
  resetConfig(configId: string): Promise<void>;
  setDefault(configId: string): Promise<void>;
}

type Props = PropsRuntime<"settings.section"> & PropsLocale<"dsh-workflow-kit"> & InjectFace<WorkflowSettingsInjected>;

/** One open confirmation or naming dialog. */
type Dialog =
  | { kind: "rename"; id: string; draft: string }
  | { kind: "copy"; id: string; draft: string }
  | { kind: "delete"; id: string }
  | { kind: "reset"; id: string }
  | null;

/** Short copy for each shipped role; an unknown role renders without one. */
const ROLE_DESCRIPTION: Record<string, WorkflowLocaleKey> = {
  planner: "rolePlanner",
  reviewer: "roleReviewer",
  context_collector: "roleContextCollector",
  def_coding_worker: "roleDefCodingWorker",
  sup_coding_worker: "roleSupCodingWorker",
  evidence_runner: "roleEvidenceRunner",
  full_tester: "roleFullTester",
};

/** Whether this configuration carries any user override. */
function modified(config: ConfigView): boolean {
  return Object.values(config.roles).some(role => role.overridden);
}

/** Render the settings page. @param props - composed slot props. @returns the section element tree. */
export function WorkflowSettingsSection({
  useWorkflowSettings, setRole, copyConfig, renameConfig, resetConfig, setDefault, t,
}: Props): ReactNode {
  const state = useWorkflowSettings(value => value);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  installClientStyles();
  const editable = state.status === "ready" && state.writable && !state.saving;
  const taken = state.configs.map(config => config.id);
  // A chosen id can vanish (rename, delete, a cleared stored section), so the
  // projection falls back to the stored default and then to the first entry.
  const selected = state.configs.find(config => config.id === chosen)
    ?? state.configs.find(config => config.id === state.defaultConfig)
    ?? state.configs[0];

  const confirmDialog = (): void => {
    if (dialog === null) return;
    if (dialog.kind === "rename") { setChosen(dialog.draft); void renameConfig(dialog.id, dialog.draft); }
    else if (dialog.kind === "copy") { setChosen(dialog.draft); void copyConfig(dialog.id, dialog.draft); }
    else { if (dialog.id === chosen) setChosen(null); void resetConfig(dialog.id); }
    setDialog(null);
  };

  const items: MenuEntry[] = state.configs.map(config => ({
    id: config.id,
    label: <span className="wf-option">
      <span className="wf-option-name">{config.id}</span>
      <ConfigBadges config={config} isDefault={state.defaultConfig === config.id} t={t} />
    </span>,
  }));

  return <div className="wf-section">
    <p className="wf-intro">{t("sectionIntro")}</p>
    {state.status === "loading" && <div className="wf-notice" role="status">{t("loading")}</div>}
    {state.status === "unavailable" && <div className="wf-notice" role="status">{t("serviceUnavailable")}</div>}
    {state.status === "ready" && !state.writable && <div className="wf-notice" role="status">{t("readonly")}</div>}
    {state.error !== null && <div className="wf-error" role="alert">{state.error}</div>}
    {state.catalog === "error" && <div className="wf-error" role="alert">
      {t("catalogFailed")}{state.catalogError === null ? "" : ` · ${state.catalogError}`}
    </div>}
    {state.catalog === "ready" && state.catalogPartial && <div className="wf-notice">{t("catalogPartial")}</div>}
    {state.status === "ready" && state.configs.length === 0 && <div className="wf-notice">{t("empty")}</div>}

    {selected !== undefined && <section className="wf-config">
      <div className="wf-picker">
        <span className="wf-picker-label">{t("configsTitle")}</span>
        <Menu
          open={open}
          portal
          autoFocus
          selectedId={selected.id}
          items={items}
          onClose={() => { setOpen(false); }}
          anchor={<button
            type="button"
            className="wf-trigger"
            aria-label={t("configsTitle")}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={state.configs.length === 0}
            onClick={() => { setOpen(value => !value); }}
          >
            <span className="wf-trigger-label">{selected.id}</span>
            <ConfigBadges config={selected} isDefault={state.defaultConfig === selected.id} t={t} />
            <IconChevronDownOutline14 size={14} />
          </button>}
          onSelect={id => { setOpen(false); setChosen(id); }}
        />
      </div>

      <div className="wf-config-actions">
        <button type="button" className="wf-action" disabled={!editable}
          onClick={() => { setDialog({ kind: "copy", id: selected.id, draft: nextId(selected.id, taken) }); }}>{t("actionCopy")}</button>
        {!selected.builtin && <button type="button" className="wf-action" disabled={!editable}
          onClick={() => { setDialog({ kind: "rename", id: selected.id, draft: selected.id }); }}>{t("actionRename")}</button>}
        {!selected.builtin && <button type="button" className="wf-action" disabled={!editable}
          onClick={() => { setDialog({ kind: "delete", id: selected.id }); }}>{t("actionDelete")}</button>}
        {selected.builtin && modified(selected) && <button type="button" className="wf-action" disabled={!editable}
          onClick={() => { setDialog({ kind: "reset", id: selected.id }); }}>{t("actionReset")}</button>}
        {state.defaultConfig !== selected.id && <button type="button" className="wf-action" disabled={!editable}
          onClick={() => { void setDefault(selected.id); }}>{t("actionSetDefault")}</button>}
      </div>

      <div className="wf-role">
        <span className="wf-role-text">
          <span className="wf-role-name">{t("managerRole")}</span>
          <span className="wf-role-desc">{t("managerDescription")}</span>
        </span>
      </div>

      {state.roleNames.map(role => {
        const value: RoleView | undefined = selected.roles[role];
        if (value === undefined) return null;
        const description = ROLE_DESCRIPTION[role];
        return <div className="wf-role" key={role}>
          <span className="wf-role-text">
            <span className="wf-role-name">{role}</span>
            {description !== undefined && <span className="wf-role-desc">{t(description)}</span>}
          </span>
          {value.overridden && <span className="wf-role-modified">{t("badgeModified")}</span>}
          <RouteMenu role={role} value={value} groups={state.groups} editable={editable}
            onChange={next => setRole(selected.id, role, next)} t={t} />
        </div>;
      })}
    </section>}

    <Modal
      open={dialog !== null}
      onClose={() => { setDialog(null); }}
      title={dialog?.kind === "delete" ? t("confirmDelete") : dialog?.kind === "reset" ? t("confirmReset") : dialog?.kind === "copy" ? t("promptCopy") : t("promptRename")}
      closeLabel={t("actionCancel")}
      footer={<>
        <Button variant="outline" onClick={() => { setDialog(null); }}>{t("actionCancel")}</Button>
        <Button
          variant="primary"
          disabled={dialog === null || state.saving || ((dialog.kind === "rename" || dialog.kind === "copy") && (dialog.draft.trim().length === 0 || taken.includes(dialog.draft.trim())))}
          onClick={confirmDialog}
        >
          {state.saving ? t("saving") : t("actionConfirm")}
        </Button>
      </>}
    >
      {(dialog?.kind === "rename" || dialog?.kind === "copy") && <Input
        value={dialog.draft}
        autoFocus
        onChange={event => { setDialog({ ...dialog, draft: event.target.value }); }}
      />}
    </Modal>
  </div>;
}

/** The source badge set one configuration carries in the picker and the trigger. */
function ConfigBadges({ config, isDefault, t }: {
  config: ConfigView; isDefault: boolean; t: (key: WorkflowLocaleKey) => string;
}): ReactNode {
  return <span className="wf-badges">
    <span className="wf-badge">{t(config.builtin ? "badgeBuiltin" : "badgeCustom")}</span>
    {modified(config) && <span className="wf-badge">{t("badgeModified")}</span>}
    {isDefault && <span className="wf-badge">{t("badgeDefault")}</span>}
  </span>;
}

/** A free configuration id derived from one that already exists. */
function nextId(base: string, taken: readonly string[]): string {
  const stem = base.endsWith("-copy") ? base : `${base}-copy`;
  if (!taken.includes(stem)) return stem;
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}-${String(index)}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
