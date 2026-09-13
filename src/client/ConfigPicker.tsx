/**
 * Composer seat (`conversation.input.left`): the one user-facing control for
 * choosing which workflow configuration new subagents of this Session use.
 * It selects only — every edit lives on the Workflow settings page — and it
 * re-reads the catalog each time it opens, so the explicit refresh control is
 * unnecessary.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconBranchOutline16, IconChevronDownOutline14, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ProfileAction, ProfileView } from "../profile-types.js";
import type { WorkflowLocaleKey } from "./locales.js";
import { installClientStyles } from "./styles.js";

/** Registered face: one channel call the picker performs for its Session. */
export interface ConfigPickerInjected {
  request(sessionId: string, action: ProfileAction, profileId?: string): Promise<ProfileView>;
}

type Props = PropsRuntime<"conversation.input.left"> & PropsLocale<"dsh-workflow-kit"> & InjectFace<ConfigPickerInjected>;

/** Render the composer configuration chip. @param props - composed slot props. @returns the chip element. */
export function ConfigPicker({ sessionId, useSession, request, t }: Props): ReactNode {
  const unavailable = useSession(snapshot => snapshot.removed || snapshot.openState === "error");
  const [view, setView] = useState<ProfileView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  installClientStyles();

  const load = (profileId?: string): void => {
    if (unavailable) return;
    const current = generation.current + 1;
    generation.current = current;
    setPending(true);
    setError("");
    void request(sessionId, profileId === undefined ? "profiles" : "select-profile", profileId)
      .then(value => { if (generation.current === current) setView(value); })
      .catch((reason: unknown) => { if (generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (generation.current === current) setPending(false); });
  };

  useEffect(() => {
    setView(null);
    setPending(false);
    load();
  }, [sessionId, unavailable]);

  const selected = view?.selectedProfile ?? "";
  const known = view?.configs.some(config => config.id === selected) === true;
  const items: MenuEntry[] = [{ type: "label", id: "title", text: t("pickerTitle") }];
  if (view === null || view.configs.length === 0) items.push({ type: "label", id: "empty", text: t("pickerMissing") });
  else for (const config of view.configs) {
    items.push({ id: config.id, label: config.id });
  }
  if (unavailable) items.push({ type: "label", id: "unavailable", text: t("pickerSessionUnavailable") });
  else if (error !== "") items.push({ type: "label", id: "error", text: error });
  else if (selected !== "" && !known) items.push({ type: "label", id: "stale", text: `${t("pickerUnavailable")}: ${selected}` });

  const label = selected === "" ? t("pickerChoose") : selected;

  return <Menu
    open={open}
    portal
    autoFocus
    selectedId={selected === "" ? undefined : selected}
    items={items}
    onClose={() => { setOpen(false); }}
    anchor={<button
      type="button"
      className="wf-trigger wf-chip"
      aria-label={t("pickerTitle")}
      aria-haspopup="menu"
      disabled={unavailable}
      onClick={() => {
        if (open) { setOpen(false); return; }
        load();
        setOpen(true);
      }}
    >
      <IconBranchOutline16 size={14} />
      <span className="wf-trigger-label">{pending && view === null ? t("pickerLoading") : label}</span>
      <IconChevronDownOutline14 size={14} />
    </button>}
    onSelect={id => {
      setOpen(false);
      if (id !== selected) load(id);
    }}
  />;
}
