/**
 * One role's route selector: a two-level menu (`模型` / `推理等级`) whose model
 * pane groups models under their provider heading, the way the composer's own
 * model seat does. The shared `Menu` primitive renders no headings inside a
 * submenu, so this control draws its own rows and the two positioning/dismissal
 * hooks the primitive exposes, while the shared `MenuSurface` paints the card:
 * the translucent menu fill only reads as a surface once the backdrop material
 * (and, on macOS, the opaque backing) is under it.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  MenuSurface, useAnchoredPosition, useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ModelGroup } from "./model-catalog.js";
import { effortForModelChange, effortLabel } from "./effort.js";
import type { RoleDraft } from "./settings-controller.js";
import type { WorkflowLocaleKey } from "./locales.js";

/** Owner-free props of one role's route selector. */
export interface RouteMenuProps {
  /** Role id, used only for the trigger's accessible name. */
  role: string;
  /** The role's effective route. */
  value: RoleDraft;
  /** Adapter-advertised providers and models. */
  groups: readonly ModelGroup[];
  /** Whether the stored layer accepts writes right now. */
  editable: boolean;
  /** Store the chosen route. */
  onChange(value: RoleDraft): Promise<void>;
  /** Section translator. */
  t: (key: WorkflowLocaleKey) => string;
}

/** Which pane the open card shows. */
type Pane = "root" | "model" | "effort";

/** Render one role's route selector. @param props - see {@link RouteMenuProps}. @returns the trigger and its portaled card. */
export function RouteMenu({ role, value, groups, editable, onChange, t }: RouteMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const anchor = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const position = useAnchoredPosition({ open, anchorRef: anchor, panelRef: panel, gap: 4, margin: 8 });
  useDismissOnOutsidePointer(anchor, open, setOpen, panel);

  useEffect(() => {
    if (open) setPane("root");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Escape backs out of a drilled pane first, then closes — the composer
      // model seat's own semantics.
      if (pane !== "root") setPane("root");
      else { setOpen(false); anchor.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); };
  }, [open, pane]);

  const group = groups.find(candidate => candidate.provider === value.provider);
  const option = group?.models.find(candidate => candidate.model === value.model);
  const modelLabel = option?.name ?? `${value.provider}/${value.model}`;
  const shownEffort = effortLabel(value.reasoningEffort, option);

  const close = (): void => { setOpen(false); };

  /** Choose a model, keeping the current effort when the new model still advertises it. */
  const chooseModel = (provider: string, model: string): void => {
    const target = groups.find(candidate => candidate.provider === provider)?.models.find(candidate => candidate.model === model);
    close();
    void onChange({ provider, model, reasoningEffort: effortForModelChange(value.reasoningEffort, target) });
  };

  return <>
    <button
      ref={anchor}
      type="button"
      className="wf-trigger"
      aria-label={`${role} ${t("columnModel")}`}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={!editable || groups.length === 0}
      onClick={() => { setOpen(current => !current); }}
    >
      <span className="wf-trigger-label">{modelLabel}</span>
      <span className="wf-trigger-value">{shownEffort}</span>
      <IconChevronDownOutlineRegular size={14} />
    </button>
    {open && createPortal(
      <MenuSurface
        ref={panel}
        className="wf-menu"
        style={position ?? { visibility: "hidden", left: 0, top: 0 }}
        role="menu"
        aria-label={`${role} ${t("columnModel")}`}
      >
        {pane === "root" && <>
          <button type="button" role="menuitem" className="wf-item" onClick={() => { setPane("model"); }}>
            <span className="wf-item-label">{t("columnModel")}</span>
            <span className="wf-item-value">{modelLabel}</span>
            <IconChevronRightOutlineRegular size={14} className="wf-item-chevron" />
          </button>
          <button type="button" role="menuitem" className="wf-item" onClick={() => { setPane("effort"); }}>
            <span className="wf-item-label">{t("columnEffort")}</span>
            <span className="wf-item-value">{shownEffort}</span>
            <IconChevronRightOutlineRegular size={14} className="wf-item-chevron" />
          </button>
        </>}

        {pane === "model" && <div className="wf-groups scrollable">
          {groups.map(candidate => <section className="wf-group" role="group" key={candidate.provider}>
            {/* Provider heading, exactly as the composer's model seat lists them. */}
            <div className="wf-group-title">{candidate.name}</div>
            {candidate.models.map(model => {
              const selected = candidate.provider === value.provider && model.model === value.model;
              return <button
                key={model.model}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="wf-item"
                onClick={() => { chooseModel(candidate.provider, model.model); }}
              >
                <span className="wf-item-label">{model.name}</span>
                {selected && <IconCheckOutlineRegular size={14} className="wf-item-check" />}
              </button>;
            })}
          </section>)}
        </div>}

        {pane === "effort" && <>
          {(option?.efforts ?? []).map(level => {
            const selected = level.id === value.reasoningEffort;
            return <button
              key={level.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className="wf-item"
              onClick={() => { close(); void onChange({ ...value, reasoningEffort: level.id }); }}
            >
              <span className="wf-item-label">{level.name}</span>
              {selected && <IconCheckOutlineRegular size={14} className="wf-item-check" />}
            </button>;
          })}
        </>}
      </MenuSurface>,
      document.body,
    )}
  </>;
}
