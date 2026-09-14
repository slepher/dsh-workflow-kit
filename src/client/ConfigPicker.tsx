/**
 * Composer seat (`conversation.input.left`): the user-facing controls for
 * choosing which workflow configuration new subagents of this Session use and
 * which coding strategy that Session dispatches under. They select only —
 * every edit lives on the Workflow settings page — and they re-read the
 * catalog each time they open, so the explicit refresh control is unnecessary.
 * The strategy control is hidden when the selected configuration's sup and def
 * entries share one provider and model, because that configuration already
 * fixes independent execution; the stored preference is retained, not erased.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconBranchOutline16, IconChevronDownOutline14, Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ProfileAction, ProfileView } from "../profile-types.js";
import { STRATEGIES, type CodingStrategy } from "../constants.js";
import type { WorkflowLocaleKey } from "./locales.js";
import { installClientStyles } from "./styles.js";

/** Registered face: one channel call the picker performs for its Session. */
export interface ConfigPickerInjected {
  request(sessionId: string, action: ProfileAction, value?: string | null): Promise<ProfileView>;
}

type Props = PropsRuntime<"conversation.input.left"> & PropsLocale<"dsh-workflow-kit"> & InjectFace<ConfigPickerInjected>;

/** Copy key for each strategy's display name. */
const STRATEGY_LABEL: Record<CodingStrategy, WorkflowLocaleKey> = {
  economy: "strategyEconomy",
  adaptive: "strategyAdaptive",
  bootstrap: "strategyBootstrap",
  expert: "strategyExpert",
};

/** Render the composer configuration and strategy chips. @param props - composed slot props. @returns the chip group. */
export function ConfigPicker({ sessionId, useSession, request, t }: Props): ReactNode {
  const unavailable = useSession(snapshot => snapshot.removed || snapshot.openState === "error");
  const [view, setView] = useState<ProfileView | null>(null);
  const [open, setOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  installClientStyles();

  const send = (action: ProfileAction, value?: string | null): void => {
    if (unavailable) return;
    const current = generation.current + 1;
    generation.current = current;
    setPending(true);
    setError("");
    void request(sessionId, action, value)
      .then(next => { if (generation.current === current) setView(next); })
      .catch((reason: unknown) => { if (generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (generation.current === current) setPending(false); });
  };

  useEffect(() => {
    setView(null);
    setPending(false);
    send("profiles");
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

  // The Session's coding preference, or the stored default it currently inherits.
  const strategy = view?.strategy;
  const strategyItems: MenuEntry[] = [{ type: "label", id: "title", text: t("pickerStrategyTitle") }];
  for (const id of STRATEGIES) strategyItems.push({ id, label: t(STRATEGY_LABEL[id]) });
  if (strategy !== undefined && strategy.preference !== null) {
    strategyItems.push({ id: "default", label: `${t("pickerStrategyFollow")} (${t(STRATEGY_LABEL[strategy.default])})` });
  }

  return <span className="wf-chip-group">
    <Menu
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
          send("profiles");
          setOpen(true);
        }}
      >
        <IconBranchOutline16 size={14} />
        <span className="wf-trigger-label">{pending && view === null ? t("pickerLoading") : label}</span>
        <IconChevronDownOutline14 size={14} />
      </button>}
      onSelect={id => {
        setOpen(false);
        if (id !== selected) send("select-profile", id);
      }}
    />
    {strategy !== undefined && !strategy.fixed && <Menu
      open={strategyOpen}
      portal
      autoFocus
      selectedId={strategy.preference ?? strategy.default}
      items={strategyItems}
      onClose={() => { setStrategyOpen(false); }}
      anchor={<button
        type="button"
        className="wf-trigger wf-chip"
        aria-label={t("pickerStrategyTitle")}
        aria-haspopup="menu"
        disabled={unavailable}
        onClick={() => {
          if (strategyOpen) { setStrategyOpen(false); return; }
          send("profiles");
          setStrategyOpen(true);
        }}
      >
        <span className="wf-trigger-label">{t(STRATEGY_LABEL[strategy.preference ?? strategy.default])}</span>
        <IconChevronDownOutline14 size={14} />
      </button>}
      onSelect={id => {
        setStrategyOpen(false);
        send("select-strategy", id === "default" ? null : id);
      }}
    />}
  </span>;
}
