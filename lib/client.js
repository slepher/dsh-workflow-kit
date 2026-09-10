window.__ModuleLoader__.load({ id: "dsh-workflow-kit", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  ConversationPanel: () => ConversationPanel,
  Dock: () => Dock,
  NewConversation: () => NewConversation,
  WORKFLOW_PLUGIN_ID: () => WORKFLOW_PLUGIN_ID,
  active: () => active,
  apply: () => apply,
  formatContext: () => formatContext,
  inject: () => inject,
  name: () => name,
  occupancy: () => occupancy,
  toggleWorker: () => toggleWorker,
  workerLabel: () => workerLabel
});
module.exports = __toCommonJS(client_exports);
var import_react_dom3 = require("react-dom");

// src/input-menu.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var commands = [
  ["model", "\u9009\u62E9\u6A21\u578B\u548C\u63A8\u7406\u7B49\u7EA7"],
  ["skills", "\u6253\u5F00\u6280\u80FD\u5217\u8868"],
  ["status", "\u67E5\u770B\u5F53\u524D\u4F1A\u8BDD\u72B6\u6001"],
  ["new", "\u6253\u5F00\u7A7A\u767D\u5BF9\u8BDD"],
  ["compact", "\u538B\u7F29\u5F53\u524D\u5BF9\u8BDD\u4E0A\u4E0B\u6587"],
  ["review", "\u5BA1\u67E5\u672A\u63D0\u4EA4\u7684\u6539\u52A8"],
  ["copy", "\u590D\u5236\u6700\u8FD1\u7684\u56DE\u7B54"]
];
function useInputMenu({ text, setText, input, sessionId, workerId, call, command }) {
  const [catalog, setCatalog] = (0, import_react.useState)([]), [selected, setSelected] = (0, import_react.useState)([]);
  const [error, setError] = (0, import_react.useState)(""), [loading, setLoading] = (0, import_react.useState)(false), [cursor, setCursor] = (0, import_react.useState)(0), [closed, setClosed] = (0, import_react.useState)(false);
  const [caret, setCaret] = (0, import_react.useState)(text.length), [revision, reload] = (0, import_react.useState)(0);
  const list = (0, import_react.useRef)(null);
  const maxHeight = (0, import_dsh_client_ui_primitives.useAnchoredMaxHeight)(list, 320, text);
  const id = (0, import_react.useId)(), slash = /^\/([\w-]*)$/.exec(text), skill = /(?:^|\s)\$([\w:-]*)$/.exec(text.slice(0, caret));
  const kind = slash ? "command" : skill ? "skill" : null, query = (slash?.[1] ?? skill?.[1] ?? "").toLowerCase();
  (0, import_react.useEffect)(() => {
    setClosed(false);
    setCursor(0);
  }, [text, caret]);
  (0, import_react.useEffect)(() => {
    if (kind !== "skill") return;
    let disposed = false;
    setLoading(true);
    setError("");
    void call(sessionId, { action: "skills", workerId }).then((value) => {
      if (!disposed) setCatalog(value);
    }).catch((e) => {
      if (!disposed) setError(String(e));
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [kind, sessionId, workerId, call, revision]);
  (0, import_react.useEffect)(() => {
    if (!kind || closed) return;
    const dismiss = (e) => {
      if (!input.current?.closest(".cw-composer-card")?.contains(e.target)) setClosed(true);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [kind, closed, input]);
  const options = kind === "command" ? commands.filter(([name2]) => name2.startsWith(query)).map(([name2, description]) => ({ name: name2, description, path: "" })) : catalog.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(query));
  const open = !!kind && !closed;
  const choose = async (index) => {
    const option = options[index];
    if (!option) return;
    if (kind === "command") {
      setClosed(true);
      await command(option.name);
      return;
    }
    const start = caret - (skill?.[1].length ?? 0) - 1;
    const prefix = text.slice(0, start) + `$${option.name} `;
    setText(prefix + text.slice(caret));
    setSelected((previous) => [...previous.filter((s) => s.path !== option.path), option]);
    setClosed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(prefix.length, prefix.length);
    });
  };
  const onKeyDown = (e) => {
    if (!open || e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      setClosed(true);
      return true;
    }
    if (options.length && ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(e.key) && !e.shiftKey) {
      e.preventDefault();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") setCursor((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
      else void choose(cursor);
      return true;
    }
    return false;
  };
  (0, import_react.useEffect)(() => {
    if (open) document.getElementById?.(`${id}-${cursor}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, id]);
  return {
    onKeyDown,
    setCaret,
    selected: selected.filter((s) => [...text.matchAll(/(?:^|\s)\$([\w:-]+)(?=\s|$|[.,!?，。！？])/g)].some((m) => m[1] === s.name)),
    clear: () => setSelected([]),
    aria: { "aria-autocomplete": "list", "aria-expanded": open, "aria-controls": open ? id : void 0, "aria-activedescendant": open && options.length ? `${id}-${cursor}` : void 0 },
    menu: open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: list, style: { maxHeight }, className: "cw-input-menu", onMouseDown: (e) => e.preventDefault(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "cw-input-menu-title", children: kind === "command" ? "Codex \u6307\u4EE4" : "Codex Skills" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "listbox", id, "aria-label": kind === "command" ? "Codex \u6307\u4EE4" : "Codex Skills", children: options.map((option, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "cw-input-option", role: "option", "aria-selected": cursor === index, id: `${id}-${index}`, onMouseMove: () => setCursor(index), onClick: () => void choose(index), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "cw-input-name", children: [
          kind === "command" ? "/" : "$",
          option.name
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "cw-input-description", title: option.description + (kind === "skill" ? " \xB7 " + option.path : ""), children: [
          option.description,
          kind === "skill" && catalog.filter((s) => s.name === option.name).length > 1 && ` \xB7 ${option.path}`
        ] })
      ] }, option.path || option.name)) }),
      kind === "skill" && loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6 Skills\u2026" }),
      kind === "skill" && error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", children: [
        error,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => reload((n) => n + 1), children: "\u91CD\u8BD5" })
      ] }),
      (kind === "command" || !loading && !error) && !options.length && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6CA1\u6709\u5339\u914D\u9879" })
    ] })
  };
}

// src/client.tsx
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/types.ts
function compactionTurnIds(history) {
  const grouped = /* @__PURE__ */ new Map();
  for (const item of history?.items ?? []) grouped.set(item.turnId, [...grouped.get(item.turnId) ?? [], item]);
  return new Set(
    [...grouped].filter(([, items]) => items.length > 0 && items.every((item) => item.kind === "contextCompaction")).map(([id]) => id)
  );
}

// src/stats.tsx
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/native-stat-dialog.ts
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var PANEL_MARGIN = 12;
var PANEL_GAP = 8;
var MEASURE_STYLE = { visibility: "hidden", left: 0, top: 0 };
function useStatDialog(controlled) {
  const [ownOpen, setOwnOpen] = (0, import_react2.useState)(false);
  const open = controlled?.open ?? ownOpen;
  const setOpen = controlled?.setOpen ?? setOwnOpen;
  const rootRef = (0, import_react2.useRef)(null);
  const panelRef = (0, import_react2.useRef)(null);
  const pos = (0, import_dsh_client_ui_primitives2.useAnchoredPosition)({
    open,
    anchorRef: rootRef,
    panelRef,
    side: "top",
    gap: PANEL_GAP,
    margin: PANEL_MARGIN
  });
  (0, import_dsh_client_ui_primitives2.useDismissOnOutsidePointer)(rootRef, open, setOpen, panelRef);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);
  return { open, setOpen, rootRef, panelRef, pos };
}

// src/stats.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var tokens = (n) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
var duration = (ms) => ms < 6e4 ? `${Math.round(ms / 1e3)}\u79D2` : `${Math.floor(ms / 6e4)}\u5206${Math.round(ms % 6e4 / 1e3)}\u79D2`;
function reportUsage(report, history) {
  if (report?.turnUsage) return report.turnUsage;
  if (report && history?.source === "thread" && history.turns?.[0]?.id === report.turnId) return report.usage?.total;
}
function usageRows(usage) {
  const rows = [];
  const add = (label, n) => {
    if (n !== null) rows.push([label, n.toLocaleString()]);
  };
  add("\u603B\u7528\u91CF", usage.totalTokens);
  if (usage.inputTokens !== null && usage.cachedInputTokens !== null) {
    add("\u672A\u7F13\u5B58\u8F93\u5165", Math.max(0, usage.inputTokens - usage.cachedInputTokens));
    if (usage.inputTokens > 0) rows.push(["\u7F13\u5B58\u547D\u4E2D", `${Math.round(100 * usage.cachedInputTokens / usage.inputTokens)}%`]);
  } else add("\u8F93\u5165", usage.inputTokens);
  add("\u7F13\u5B58\u8BFB\u53D6", usage.cachedInputTokens);
  add("\u7F13\u5B58\u5199\u5165", usage.cacheWriteInputTokens);
  add("\u8F93\u51FA", usage.outputTokens);
  add("\u63A8\u7406\u8F93\u51FA", usage.reasoningOutputTokens);
  return rows;
}
function Stat({ label, title, rows, icon }) {
  const seat = useStatDialog();
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { ref: seat.rootRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { className: "cw-stat", type: "button", "aria-expanded": seat.open, onClick: () => seat.setOpen(!seat.open), children: [
      icon,
      label
    ] }),
    seat.open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { ref: seat.panelRef, role: "dialog", "aria-label": title, className: "cw-stat-panel", style: seat.pos ?? MEASURE_STYLE, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cw-stat-title", children: title }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dl", { children: rows.map(([key, value]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: key }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dd", { children: value })
      ] }, key)) })
    ] }), document.body)
  ] });
}
function TurnStats({ usage, durationMs, completedAt }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    usage?.totalTokens != null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Stat, { icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives3.IconDatabaseOutline16, {}), label: `\u7528\u91CF ${tokens(usage.totalTokens)} tok`, title: "\u672C\u8F6E\u7528\u91CF", rows: usageRows(usage) }),
    durationMs !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Stat, { icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives3.IconClockOutline16, {}), label: `\u7528\u65F6 ${duration(durationMs)}`, title: "\u672C\u8F6E\u7528\u65F6", rows: [["\u5B9E\u9645\u7528\u65F6", duration(durationMs)]] }),
    completedAt !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("time", { title: new Date(completedAt * 1e3).toLocaleString(), dateTime: new Date(completedAt * 1e3).toISOString(), children: new Date(completedAt * 1e3).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
  ] });
}
function SessionStats({ worker, history }) {
  const maintenance = compactionTurnIds(history);
  for (const c of worker.compactions ?? []) if (c.turnId) maintenance.add(c.turnId);
  const turns = /* @__PURE__ */ new Set([...history?.turns?.map((t) => t.id) ?? [], ...history?.items.map((i) => i.turnId) ?? [], ...worker.reports.map((r) => r.turnId)]);
  for (const id of maintenance) turns.delete(id);
  const times = history?.turns?.filter((t) => !maintenance.has(t.id)).flatMap((t) => t.durationMs === void 0 ? [] : [t.durationMs]) ?? [];
  const toolTimes = history?.items.flatMap((i) => i.role === "tool" && i.kind !== "contextCompaction" && i.durationMs !== void 0 ? [i.durationMs] : []) ?? [];
  const rows = [["\u8F6E\u6570", String(turns.size)]];
  if (times.length) rows.push(["\u7D2F\u8BA1\u8F6E\u6B21\u7528\u65F6", duration(times.reduce((a, b) => a + b, 0))]);
  if (toolTimes.length) rows.push(["\u5DE5\u5177\u7528\u65F6", duration(toolTimes.reduce((a, b) => a + b, 0))]);
  const usage = worker.usage?.total;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cw-session-stats", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Stat, { icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives3.IconGaugeOutline16, {}), label: `${turns.size} \u8F6E${times.length ? ` \xB7 ${duration(times.reduce((a, b) => a + b, 0))}` : ""}`, title: "\u4F1A\u8BDD\u7528\u65F6", rows }),
    usage?.totalTokens != null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Stat, { icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives3.IconDatabaseOutline16, {}), label: `${tokens(usage.totalTokens)} tok${usage.inputTokens && usage.cachedInputTokens !== null ? ` \xB7 \u7F13\u5B58\u547D\u4E2D ${Math.round(100 * usage.cachedInputTokens / usage.inputTokens)}%` : ""}`, title: "\u4F1A\u8BDD\u603B\u7528\u91CF", rows: usageRows(usage) })
  ] });
}

// src/transcript.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/native-icons.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var IconChevronDownOutline14 = ({ size = 14, className }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { width: size, height: size, className, viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
  "path",
  {
    d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
    fill: "currentColor"
  }
) });
var IconChevronRightOutline14 = ({ size = 14, className }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { width: size, height: size, className, viewBox: "0 0 14 14", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
  "path",
  {
    d: "M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z",
    fill: "currentColor"
  }
) });
var IconCheckOutline16 = ({ size = 16, className }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("svg", { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
  "path",
  {
    d: "M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z",
    fill: "currentColor"
  }
) });
var IconDataOutline16 = ({ size = 16, className }) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("svg", { width: size, height: size, className, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: [
  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "path",
    {
      fillRule: "evenodd",
      clipRule: "evenodd",
      d: "M12.0997 8.54554C12.2905 8.54989 12.3541 8.58056 12.4535 8.74614L12.8849 9.46387C12.9851 9.63071 13.0464 9.66013 13.2388 9.66447H14.1138C14.3417 9.66448 14.3512 9.66937 14.4686 9.86507L14.892 10.5717C14.9942 10.7422 14.9948 10.8247 14.892 10.9961L14.4756 11.6906C14.3741 11.8677 14.3694 11.9379 14.4756 12.115L14.892 12.8096C14.9942 12.9801 14.9947 13.0625 14.892 13.234L14.4686 13.9406C14.3643 14.1028 14.3063 14.1354 14.1138 14.1412H13.2388C13.0465 14.1456 12.985 14.1752 12.8849 14.3418L12.4535 15.0595C12.353 15.2195 12.2895 15.2558 12.0997 15.2601H11.2237C10.9962 15.2601 10.9871 15.2548 10.8699 15.0595L10.4384 14.3418C10.3383 14.175 10.2767 14.1456 10.0846 14.1412H9.2096C9.01854 14.1355 8.95761 14.1006 8.85477 13.9406L8.43139 13.234C8.32562 13.0576 8.33148 12.9862 8.43139 12.8096L8.84771 12.115C8.95165 11.9416 8.94659 11.863 8.84771 11.6906L8.43139 10.9961C8.32767 10.8232 8.33411 10.7437 8.43139 10.5717L8.85477 9.86507C8.95447 9.69891 9.01875 9.67017 9.2096 9.66447H10.0846C10.2741 9.66441 10.3414 9.62547 10.4384 9.46387L10.8699 8.74614C10.987 8.55106 10.9963 8.54554 11.2237 8.54554H12.0997ZM11.6612 10.232C11.3326 10.7798 10.8155 11.0948 10.1743 11.106C10.4443 11.61 10.4425 12.1976 10.1743 12.6987C10.803 12.7096 11.3391 13.0359 11.6612 13.5727C11.9855 13.0323 12.5131 12.7098 13.148 12.6987C12.879 12.196 12.8789 11.6086 13.148 11.106C12.5076 11.0948 11.9894 10.7794 11.6612 10.232Z",
      fill: "currentColor"
    }
  ),
  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "path",
    {
      fillRule: "evenodd",
      clipRule: "evenodd",
      d: "M7.51205 0.790627C9.19055 0.790649 10.7401 1.0691 11.892 1.54364C12.4664 1.78029 12.9719 2.07885 13.3436 2.4408C13.7171 2.80467 13.9916 3.27253 13.9918 3.82384V7.90442C13.6067 7.69532 13.1907 7.53597 12.7529 7.43366V5.66454C12.4928 5.82898 12.2028 5.97601 11.892 6.10405C10.74 6.57865 9.19071 6.85706 7.51205 6.85706C5.8337 6.85703 4.285 6.57852 3.13309 6.10405C2.82215 5.97593 2.53164 5.8291 2.27121 5.66454V7.4135C2.27134 7.75678 2.6066 8.27106 3.62502 8.73405C4.58641 9.17097 5.95762 9.45591 7.50499 9.45681C7.24582 9.83133 7.03684 10.2434 6.88706 10.6826C5.44388 10.6162 4.12516 10.3216 3.11192 9.86104C2.81708 9.72698 2.53185 9.56866 2.27121 9.38928V11.2542C2.27158 11.5974 2.60697 12.1109 3.62502 12.5737C4.41933 12.9347 5.4937 13.1898 6.71569 13.2693C6.80349 13.7128 6.9513 14.1345 7.14814 14.5273C5.60324 14.4862 4.18593 14.1889 3.11192 13.7007C2.01039 13.1998 1.03366 12.3814 1.03333 11.2542V3.82384C1.03352 3.27273 1.30721 2.80461 1.68049 2.4408C2.05211 2.07893 2.55887 1.78026 3.13309 1.54364C4.28492 1.06926 5.83393 0.790683 7.51205 0.790627ZM7.51205 2.02851C5.95492 2.02857 4.57354 2.29079 3.60486 2.68979C3.11958 2.88977 2.76667 3.11253 2.5454 3.32788C2.32671 3.54101 2.2714 3.7089 2.27121 3.82384C2.27121 3.93882 2.32624 4.10625 2.5454 4.3198C2.76667 4.53527 3.11927 4.75781 3.60486 4.9579C4.5736 5.35699 5.95467 5.61914 7.51205 5.61918C9.06942 5.61918 10.4505 5.35695 11.4192 4.9579C11.9051 4.75773 12.2584 4.53536 12.4797 4.3198C12.6988 4.10627 12.7529 3.93882 12.7529 3.82384C12.7527 3.70889 12.6984 3.54104 12.4797 3.32788C12.2584 3.11239 11.9049 2.88989 11.4192 2.68979C10.4505 2.29079 9.06925 2.02853 7.51205 2.02851Z",
      fill: "currentColor"
    }
  )
] });

// src/native-Tooltip.tsx
var import_react3 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var css = { "bubble": "cw-native-tooltip-bubble" };
function Tooltip({ label, side = "right", delayMs = 0, disabled = false, maxWidth, children }) {
  const anchor = (0, import_react3.useRef)(null);
  const childRef = children.ref;
  const mergedRef = (0, import_react3.useCallback)((el) => {
    anchor.current = el;
    if (typeof childRef === "function") childRef(el);
    else if (childRef != null) childRef.current = el;
  }, [childRef]);
  const [pos, setPos] = (0, import_react3.useState)(null);
  const [placement, setPlacement] = (0, import_react3.useState)(side);
  const bubble = (0, import_react3.useRef)(null);
  const resolvedLabel = pos === null ? null : typeof label === "function" ? label() : label;
  const y = pos === null ? 0 : placement === "right" ? pos.top + (pos.bottom - pos.top) / 2 : placement === "top" ? pos.top - 8 : pos.bottom + 8;
  const EDGE_MARGIN = 12;
  (0, import_react3.useLayoutEffect)(() => {
    if (pos === null) return;
    const fit = () => {
      const el = bubble.current;
      if (el === null) return;
      el.style.left = `${pos.x}px`;
      const r = el.getBoundingClientRect();
      let dx = 0;
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right;
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left;
      el.style.left = `${pos.x + dx}px`;
      if (side === "right") return;
      const fitsBelow = pos.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN;
      const fitsAbove = pos.top - 8 - r.height >= EDGE_MARGIN;
      if (placement === "bottom" && !fitsBelow && fitsAbove) setPlacement("top");
      if (placement === "top" && !fitsAbove && fitsBelow) setPlacement("bottom");
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
    };
  }, [placement, pos, resolvedLabel, side]);
  const showTimer = (0, import_react3.useRef)(null);
  const triggers = (0, import_react3.useRef)({ hover: false, focus: false });
  const cancelShow = (0, import_react3.useCallback)(() => {
    if (showTimer.current === null) return;
    clearTimeout(showTimer.current);
    showTimer.current = null;
  }, []);
  (0, import_react3.useEffect)(() => {
    if (disabled) {
      cancelShow();
      triggers.current = { hover: false, focus: false };
      setPos(null);
    }
    return cancelShow;
  }, [cancelShow, disabled]);
  const show = () => {
    if (disabled) return;
    const el = anchor.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPlacement(side);
    setPos({ x: side === "right" ? r.right + 10 : r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };
  const showAfterHoverDelay = () => {
    cancelShow();
    if (delayMs <= 0) {
      show();
      return;
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null;
      show();
    }, delayMs);
  };
  const hide = () => {
    cancelShow();
    if (!triggers.current.hover && !triggers.current.focus) setPos(null);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    (0, import_react3.cloneElement)(children, {
      ref: mergedRef,
      onMouseEnter: (e) => {
        children.props.onMouseEnter?.(e);
        triggers.current.hover = true;
        showAfterHoverDelay();
      },
      onMouseLeave: (e) => {
        children.props.onMouseLeave?.(e);
        triggers.current.hover = false;
        cancelShow();
        setPos(null);
      },
      onFocus: (e) => {
        children.props.onFocus?.(e);
        triggers.current.focus = true;
        cancelShow();
        show();
      },
      onBlur: (e) => {
        children.props.onBlur?.(e);
        triggers.current.focus = false;
        hide();
      }
    }),
    pos !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "span",
      {
        ref: bubble,
        className: css.bubble,
        "data-side": placement,
        style: { left: pos.x, top: y, ...maxWidth === void 0 ? {} : { maxWidth } },
        role: "tooltip",
        children: resolvedLabel
      }
    )
  ] });
}

// src/transcript.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var markdownLabels = { code: { copyLabel: "\u590D\u5236", copiedLabel: "\u5DF2\u590D\u5236" }, footnotes: "\u811A\u6CE8" };
function mergeEvent(history, event) {
  if (event.type === "turn" && event.turn?.id) return { ...history, turns: [...(history.turns ?? []).filter((t) => t.id !== event.turn.id), event.turn] };
  const item = event.type === "item" ? event.item : event.type === "delta" && typeof event.delta === "string" ? { id: event.itemId, turnId: event.turnId, role: event.role, text: "" } : void 0;
  if (!item?.id || !item.turnId) return history;
  const items = [...history.items], index = items.findIndex((i) => i.id === item.id && i.turnId === item.turnId);
  if (event.type === "delta") {
    const previous = items[index] ?? item;
    const next = { ...previous, text: previous.text + event.delta, ...event.role === "tool" ? { output: (previous.output ?? "") + event.delta } : {} };
    if (index < 0) items.push(next);
    else items[index] = next;
  } else if (index < 0) items.push(item);
  else items[index] = item;
  return { ...history, items };
}
function useConversation(sessionId, workerId, call) {
  const [history, setHistory] = (0, import_react4.useState)(null), [error, setError] = (0, import_react4.useState)(""), [revision, retry] = (0, import_react4.useState)(0);
  (0, import_react4.useEffect)(() => {
    let disposed = false, connected = false, timer, pending = [], reading = false;
    setHistory(null);
    setError("");
    const read = async () => {
      if (reading) return;
      reading = true;
      pending = [];
      try {
        const value = await call(sessionId, { action: "conversation", workerId });
        if (!disposed) {
          setHistory(pending.reduce(mergeEvent, value));
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        reading = false;
        if (!disposed && !connected) timer = setTimeout(read, 2e3);
      }
    };
    const stream = typeof EventSource === "undefined" ? void 0 : new EventSource(`/codex-workers/events?${new URLSearchParams({ sessionId, workerId })}`);
    stream?.addEventListener("ready", () => {
      connected = true;
      clearTimeout(timer);
      void read();
    });
    if (stream) {
      stream.onmessage = (event) => {
        const value = JSON.parse(event.data);
        if (reading) pending.push(value);
        setHistory((h) => h ? mergeEvent(h, value) : h);
        if (value.type === "turn" && value.turn.status !== "inProgress") void read();
      };
      stream.onerror = () => {
        connected = false;
        clearTimeout(timer);
        timer = setTimeout(read, 2e3);
      };
    }
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
      stream?.close();
    };
  }, [sessionId, workerId, call, revision]);
  return { history, error, retry: () => retry((r) => r + 1) };
}
function Copy({ text }) {
  const [copied, setCopied] = (0, import_react4.useState)(false);
  (0, import_react4.useEffect)(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1e3);
    return () => clearTimeout(timer);
  }, [copied]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Tooltip, { label: copied ? "\u5DF2\u590D\u5236" : "\u590D\u5236", side: "top", delayMs: 500, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "cw-icon-action", "aria-label": "\u590D\u5236\u6D88\u606F", onClick: () => void (0, import_dsh_client_ui_primitives4.writeClipboard)(text).then(setCopied), children: copied ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.IconCheckOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.IconCopyOutline16, {}) }) });
}
var stateLabel = (status) => ({ inProgress: "\u8FD0\u884C\u4E2D", completed: "\u5B8C\u6210", failed: "\u5931\u8D25", interrupted: "\u5DF2\u4E2D\u65AD", declined: "\u5DF2\u62D2\u7EDD" })[status ?? ""] ?? status ?? "";
var mediaUrl = (url) => url.startsWith("/") && !url.startsWith("//") ? `/api/file?path=${encodeURIComponent(url)}` : /^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url) ? url : void 0;
function Message({ item, actions }) {
  const preview = (0, import_react4.useRef)(null), [image, setImage] = (0, import_react4.useState)("");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: `cw-entry cw-entry-${item.role}`, children: [
    item.role === "user" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cw-user-bubble", children: item.text }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.MarkdownText, { labels: markdownLabels, pathImages: { resolve: mediaUrl }, text: item.text, streaming: item.status === "inProgress" }),
    item.images?.filter(mediaUrl).map((url, index) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { className: "cw-image-button", "aria-label": "\u9884\u89C8\u56FE\u7247", onClick: () => {
      setImage(mediaUrl(url));
      preview.current?.showModal();
    }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { className: "cw-message-image", src: mediaUrl(url), alt: "\u6D88\u606F\u9644\u4EF6", loading: "lazy" }) }, index)),
    item.files?.map((file) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("a", { href: mediaUrl(file.path), target: "_blank", rel: "noreferrer", children: file.name || file.path }, file.path)),
    !!item.images?.length && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("dialog", { className: "cw-image-preview", ref: preview, onClick: (e) => {
      if (e.target === e.currentTarget) preview.current?.close();
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { "aria-label": "\u5173\u95ED\u56FE\u7247\u9884\u89C8", onClick: () => preview.current?.close(), children: "\xD7" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { src: image || void 0, alt: "\u6D88\u606F\u56FE\u7247\u9884\u89C8" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-message-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Copy, { text: item.text }),
      actions
    ] })
  ] });
}
function CompactionRow({ status, error }) {
  const label = status === "inProgress" ? "\u6B63\u5728\u538B\u7F29\u2026" : status === "failed" ? "\u538B\u7F29\u5931\u8D25" : status === "interrupted" ? "\u538B\u7F29\u5DF2\u4E2D\u65AD" : status === "unknown" ? "\u538B\u7F29\u72B6\u6001\u5F85\u786E\u8BA4" : "\u538B\u7F29\u5B8C\u6210";
  const row = /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-command-row", "data-state": status, role: status === "inProgress" ? "status" : void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: "1.5", y: "1.5", width: "13", height: "13", rx: "3", fill: "none", stroke: "currentColor" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "m4 5 3 3-3 3m5 0h3", fill: "none", stroke: "currentColor" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "compact" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("i", { "aria-hidden": "true" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "cw-command-summary", children: label })
  ] });
  return error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "cw-command", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("summary", { children: row }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "cw-command-error", children: error })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cw-command", children: row });
}
function Tool({ item, opened, toggle }) {
  if (item.kind === "contextCompaction") return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CompactionRow, { status: item.status });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "cw-tool-row", open: opened, onToggle: (e) => toggle(e.currentTarget.open), children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `cw-tool-state cw-state-${item.status}`, "aria-label": stateLabel(item.status), children: "\u25CF" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: item.title ?? item.kind ?? "\u5DE5\u5177" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("small", { children: [
        stateLabel(item.status),
        item.durationMs !== void 0 ? ` \xB7 ${(item.durationMs / 1e3).toFixed(1)}s` : ""
      ] })
    ] }),
    item.cwd && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-caption", children: [
      "\u5DE5\u4F5C\u76EE\u5F55\uFF1A",
      item.cwd
    ] }),
    item.arguments !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { children: JSON.stringify(item.arguments, null, 2) }),
    item.changes?.map((change, index) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "cw-file-change", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { children: [
        change.path,
        " \xB7 ",
        change.kind
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("a", { href: mediaUrl(change.path), target: "_blank", rel: "noreferrer", children: "\u6253\u5F00\u6587\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.MarkdownText, { labels: markdownLabels, text: "```diff\n" + change.diff + "\n```" })
    ] }, index)),
    !item.changes && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { className: "cw-tool-output", children: item.output ?? item.text }),
    item.exitCode !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-caption", children: [
      "\u9000\u51FA\u7801\uFF1A",
      item.exitCode
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Copy, { text: item.text })
  ] });
}
function Transcript({ sessionId, worker, history, error, busy, retry, act, footer, fullscreen = false }) {
  const storageKey = `codex-workers.view:${sessionId}:${worker.id}`;
  const [view, setView] = (0, import_react4.useState)(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? "null") ?? { top: -1, folds: {} };
    } catch {
      return { top: -1, folds: {} };
    }
  });
  const scroll = (0, import_react4.useRef)(null), following = (0, import_react4.useRef)(view.top < 0), restored = (0, import_react4.useRef)(false), state = (0, import_react4.useRef)(view);
  const shell = (0, import_react4.useRef)(null), dock = (0, import_react4.useRef)(null);
  const [size, setSize] = (0, import_react4.useState)({ width: 0, height: 0, dock: 0 }), [preview, setPreview] = (0, import_react4.useState)(null);
  const [preferred, setPreferred] = (0, import_react4.useState)(() => {
    try {
      const n = Number(localStorage.getItem("codex-workers.contentWidth"));
      return n >= 640 ? n : null;
    } catch {
      return null;
    }
  });
  const wide = fullscreen && size.width > 900;
  const contentWidth = wide ? Math.min(size.width - 176, Math.max(640, preferred ?? Math.max(680, Math.min(size.width * 0.64, 920)))) : void 0;
  const saveWidth = (width) => {
    const n = Math.max(640, Math.min(size.width - 176, width));
    setPreferred(n);
    try {
      localStorage.setItem("codex-workers.contentWidth", String(n));
    } catch {
    }
  };
  (0, import_react4.useEffect)(() => {
    if (typeof ResizeObserver === "undefined" || !shell.current) return;
    const observer = new ResizeObserver(() => setSize({ width: shell.current.clientWidth, height: shell.current.clientHeight, dock: dock.current?.offsetHeight ?? 0 }));
    observer.observe(shell.current);
    if (dock.current) observer.observe(dock.current);
    return () => observer.disconnect();
  }, []);
  const [atBottom, setBottom] = (0, import_react4.useState)(true), [activeTurn, setActiveTurn] = (0, import_react4.useState)(0);
  state.current = view;
  const maintenanceIds = compactionTurnIds(history);
  for (const c of worker.compactions ?? []) if (c.turnId) maintenanceIds.add(c.turnId);
  const turns = [.../* @__PURE__ */ new Set([...history?.items.map((i) => i.turnId) ?? [], ...history?.turns?.map((t) => t.id) ?? [], ...worker.reports.map((r) => r.turnId), ...worker.turnId ? [worker.turnId] : []])];
  const taskTurns = turns.map((id, index) => ({ id, index })).filter((t) => !maintenanceIds.has(t.id));
  const bottom = () => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    following.current = true;
    setBottom(true);
  };
  const remember = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state.current));
    } catch {
    }
  };
  (0, import_react4.useEffect)(() => () => remember(), [storageKey]);
  (0, import_react4.useLayoutEffect)(() => {
    const element = scroll.current;
    if (!element || !history) return;
    if (!restored.current) {
      if (view.top >= 0) element.scrollTop = view.top;
      else bottom();
      restored.current = true;
    } else if (following.current) bottom();
    setBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 40);
  }, [history]);
  (0, import_react4.useEffect)(() => {
    if (typeof ResizeObserver === "undefined" || !scroll.current) return;
    const observer = new ResizeObserver(() => {
      if (following.current) bottom();
    });
    const content = scroll.current.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const fold = (key, open) => setView((v) => v.folds[key] === open ? v : { ...v, folds: { ...v.folds, [key]: open } });
  const jump = (index) => {
    scroll.current?.querySelector(`[data-turn-index="${index}"]`)?.scrollIntoView({ block: "start" });
    following.current = false;
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: shell, className: "cw-transcript-shell", style: { "--cw-content-width": contentWidth ? `${contentWidth}px` : "100%", "--cw-dock-height": `${size.dock}px` }, children: [
    wide && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("nav", { className: "cw-turn-rail", "aria-label": "\u8F6E\u6B21\u5BFC\u822A", style: { maxHeight: Math.max(40, size.height - size.dock - 32) }, children: taskTurns.map(({ id, index }, number) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { "aria-label": `\u7B2C ${number + 1} \u8F6E`, "aria-current": activeTurn === index ? "step" : void 0, onMouseEnter: () => setPreview(index), onMouseLeave: () => setPreview(null), onFocus: () => setPreview(index), onBlur: () => setPreview(null), onClick: () => jump(index), onKeyDown: (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
          next?.focus();
        }
      }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", {}) }, id)) }),
      preview !== null && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-rail-preview", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: history?.items.find((i) => i.turnId === turns[preview] && i.role === "user")?.text || `\u7B2C ${preview + 1} \u8F6E` }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: [...history?.items ?? []].reverse().find((i) => i.turnId === turns[preview] && i.role === "assistant")?.text || worker.reports.find((r) => r.turnId === turns[preview])?.result })
      ] }),
      [-1, 1].map((side) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cw-width-handle", role: "separator", "aria-label": "\u8C03\u6574\u5BF9\u8BDD\u5BBD\u5EA6", "aria-orientation": "vertical", "aria-valuemin": 640, "aria-valuemax": Math.floor(size.width - 176), "aria-valuenow": Math.round(contentWidth), tabIndex: 0, style: { left: `calc(50% + ${side * contentWidth / 2}px)` }, onDoubleClick: () => {
        setPreferred(null);
        localStorage.removeItem("codex-workers.contentWidth");
      }, onKeyDown: (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          saveWidth(contentWidth + (e.key === "ArrowRight" ? 20 : -20) * side);
        }
      }, onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.origin = `${e.clientX},${contentWidth}`;
      }, onPointerMove: (e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const [x, width] = e.currentTarget.dataset.origin.split(",").map(Number);
        saveWidth(width + (e.clientX - x) * 2 * side);
      } }, side))
    ] }),
    fullscreen && !wide && taskTurns.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "cw-turn-nav", children: [
      "\u8F6E\u6B21 ",
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { "aria-label": "\u8DF3\u8F6C\u8F6E\u6B21", value: "", onChange: (e) => {
        scroll.current?.querySelector(`[data-turn-index="${e.target.value}"]`)?.scrollIntoView({ block: "start" });
        following.current = false;
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u8DF3\u8F6C\u5230\u2026" }),
        taskTurns.map(({ id, index }, number) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("option", { value: index, children: [
          number + 1,
          ". ",
          history?.items.find((i) => i.turnId === id && i.role === "user")?.text.slice(0, 36) || "\u6267\u884C\u8BB0\u5F55"
        ] }, id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: scroll, className: "cw-transcript", onScroll: (e) => {
      const el = e.currentTarget;
      const top = el.getBoundingClientRect().top;
      const visible = [...el.querySelectorAll(".cw-turn:not([data-maintenance])")].filter((n) => n.getBoundingClientRect().top <= top + 80);
      setActiveTurn(Number(visible.at(-1)?.dataset.turnIndex ?? 0));
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setBottom(following.current);
      setView((v) => ({ ...v, top: following.current ? -1 : el.scrollTop }));
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-transcript-content", children: [
        error && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-error", role: "alert", children: [
          error,
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: retry, children: "\u91CD\u65B0\u8BFB\u53D6" })
        ] }),
        !history && !error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", className: "cw-caption", children: "\u6B63\u5728\u52A0\u8F7D\u5BF9\u8BDD\u2026" }),
        history?.source === "reports" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "cw-caption", children: "\u5F53\u524D\u663E\u793A\u5DF2\u4FDD\u5B58\u62A5\u544A\u3002" }),
        turns.map((id, index) => {
          const items = history?.items.filter((i) => i.turnId === id) ?? [], meta = history?.turns?.find((t) => t.id === id), report = worker.reports.find((r) => r.turnId === id);
          const operation = worker.compactions?.find((c) => c.turnId === id), maintenance = maintenanceIds.has(id);
          if (maintenance) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("section", { "data-maintenance": "", className: "cw-turn", "data-turn-index": index, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CompactionRow, { status: meta?.status ?? operation?.status, error: meta?.error ?? operation?.error }) }, id);
          const final = [...items].reverse().find((i) => i.role === "assistant" && i.phase !== "commentary"), process = items.filter((i) => i.role !== "user" && i !== final);
          const pending = worker.turnId === id && ["running", "starting", "interrupt-requested"].includes(worker.state);
          const approvals = worker.turnId === id ? worker.approvals ?? [] : [];
          return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "cw-turn", "data-turn-index": index, children: [
            items.filter((i) => i.role === "user").map((i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Message, { item: i }, i.id)),
            process.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "cw-process", open: view.folds[id] ?? pending, onToggle: (e) => fold(id, e.currentTarget.open), children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("summary", { children: [
                pending ? "\u6267\u884C\u4E2D" : "\u6267\u884C\u8FC7\u7A0B",
                " \xB7 ",
                process.filter((i) => i.role === "tool" && i.kind !== "contextCompaction").length,
                " \u6B21\u5DE5\u5177\u8C03\u7528"
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: process.map((i) => i.role === "tool" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Tool, { item: i, opened: view.folds[i.id] ?? false, toggle: (open) => fold(i.id, open) }, i.id) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Message, { item: i }, i.id)) })
            ] }),
            final && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Message, { item: final, actions: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TurnStats, { usage: reportUsage(report, history), durationMs: meta?.durationMs, completedAt: meta?.completedAt }) }),
            !final && report?.result && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Message, { item: { id: id + "-report", turnId: id, role: "assistant", text: report.result }, actions: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TurnStats, { usage: reportUsage(report, history), durationMs: meta?.durationMs, completedAt: meta?.completedAt ?? (typeof report.createdAt === "number" ? report.createdAt / 1e3 : Date.parse(report.createdAt) / 1e3) }) }),
            pending && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "cw-caption", role: "status", children: approvals.length ? "\u7B49\u5F85\u6279\u51C6" : "Codex \u6B63\u5728\u8FD0\u884C\u2026" }),
            approvals.map((q) => {
              const params = q.params;
              return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "cw-approval", children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u9700\u8981\u6279\u51C6" }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { children: params?.command ?? params?.reason ?? q.method }),
                params?.cwd && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { children: [
                  "\u5DE5\u4F5C\u76EE\u5F55\uFF1A",
                  params.cwd
                ] }),
                params?.reason && params.reason !== params.command && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: params.reason }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("summary", { children: "\u8BF7\u6C42\u8BE6\u60C5" }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("pre", { children: JSON.stringify(params, null, 2) })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cw-approval-actions", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void act({ action: "approve", approvalId: q.id, decision: "accept" }), children: "\u6279\u51C6\u672C\u6B21\u8BF7\u6C42" }),
                  /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void act({ action: "approve", approvalId: q.id, decision: "decline" }), children: "\u62D2\u7EDD" })
                ] })
              ] }, q.id);
            }),
            (meta?.error || report?.error) && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cw-error", role: "alert", children: meta?.error ?? report?.error }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cw-turn-tail", children: worker.owner !== "user" && report && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: stateLabel(report.status) }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: report.acceptance === "accepted" ? "\u9A8C\u6536\u901A\u8FC7" : report.acceptance === "changes-requested" ? "\u8981\u6C42\u4FEE\u6539" : "\u5F85\u9A8C\u6536" }),
              !report.acknowledgedAt && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void act({ action: "ack", turnId: id }), children: "\u786E\u8BA4\u5DF2\u8BFB" }),
              report.acceptance === "pending" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void act({ action: "accept", turnId: id, acceptance: "accepted" }), children: "\u9A8C\u6536\u901A\u8FC7" }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { disabled: busy, onClick: () => void act({ action: "accept", turnId: id, acceptance: "changes-requested" }), children: "\u8981\u6C42\u4FEE\u6539" })
              ] })
            ] }) })
          ] }, id);
        })
      ] }),
      (worker.compactions ?? []).filter((c) => c.turnId === null).map((c) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CompactionRow, { status: c.status, error: c.error }, c.id)),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: dock, className: "cw-floating-dock", children: [
        footer,
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(SessionStats, { worker, history })
      ] })
    ] }),
    !atBottom && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Tooltip, { label: "\u8FD4\u56DE\u6700\u65B0\u6D88\u606F", side: "top", delayMs: 200, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { className: "cw-to-bottom", "aria-label": "\u8FD4\u56DE\u6700\u65B0\u6D88\u606F", onClick: bottom, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(IconChevronDownOutline14, {}) }) })
  ] });
}

// src/transcript-styles.ts
var transcriptStyles = `
/* DockKit reserves 12px for generic tabs; chat owns its scrollport and composer spacing. */
[data-dockkit-pane]>div:has(>div>.cw-chat){padding:0}
.cw-transcript-shell{flex:1;min-height:0;position:relative;display:flex;flex-direction:column}.cw-transcript{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:16px 20px;overflow-wrap:anywhere}.cw-transcript-content{max-width:var(--dsh-chat-content-width,900px);margin:0 auto;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}.cw-turn{margin-bottom:28px;scroll-margin-top:12px}.cw-entry{margin:14px 0}.cw-entry-user{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.cw-user-bubble{max-width:82%;background:var(--dsw-specific-bubble);border-radius:22px;padding:10px 16px;line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word}.cw-message-actions{display:flex;align-items:center;gap:8px;height:28px;opacity:0}.cw-entry:hover .cw-message-actions,.cw-entry:focus-within .cw-message-actions,.cw-turn:last-child .cw-entry-assistant .cw-message-actions{opacity:1}@media(hover:none){.cw-message-actions{opacity:1}}.cw-chat .cw-icon-action{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:8px;padding:0;color:var(--dsw-alias-label-tertiary)}.cw-chat .cw-icon-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-caption,.cw-turn-tail,.cw-process>summary{color:var(--dsw-alias-label-tertiary);font-size:13px}.cw-process{margin:12px 0}.cw-process>summary{cursor:pointer;padding:4px;border-radius:6px}.cw-process>summary:hover,.cw-tool-row>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-process>div{padding:6px 0 6px 12px;border-left:1px solid var(--dsw-alias-border-l2)}.cw-tool-row{padding:4px 0}.cw-tool-row>summary{display:flex;gap:8px;align-items:center;cursor:pointer;border-radius:6px;padding:4px}.cw-tool-row>summary>span:nth-child(2){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.cw-tool-row>summary>small{white-space:nowrap;color:var(--dsw-alias-label-tertiary)}.cw-tool-state{font-size:8px;color:var(--dsw-alias-label-tertiary)}.cw-state-inProgress{color:var(--dsw-alias-state-business-primary)}.cw-state-failed,.cw-state-declined{color:var(--dsw-alias-state-error-primary)}.cw-chat .cw-tool-output{max-height:320px;overflow:auto;white-space:pre;font-family:monospace;font-size:12px;background:var(--dsw-alias-bg-module-platform);padding:10px;border-radius:8px}.cw-file-change{margin:8px 0}.cw-file-change>summary{cursor:pointer}.cw-turn-tail{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}.cw-error,.cw-approval{padding:12px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;margin:12px 0;background:var(--dsw-specific-menu)}.cw-error{color:var(--dsw-alias-state-error-primary)}.cw-approval-actions{display:flex;gap:8px;margin-top:10px}.cw-approval-actions>button:first-child{background:var(--dsw-alias-button-info-fill);color:white}.cw-chat .cw-to-bottom{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:100px;corner-shape:round;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}.cw-chat .cw-to-bottom:hover{background:var(--dsw-alias-button-floating-hover)}.cw-turn-nav{display:flex;gap:8px;align-items:center;padding:6px 16px;font-size:12px;color:var(--dsw-alias-label-tertiary)}.cw-turn-nav select{max-width:80%;border:0;background:transparent;color:inherit;font:inherit}.cw-compaction{color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l2);padding:6px 0;margin:10px 0;font-size:13px}.cw-message-image{max-width:100%;max-height:240px;border-radius:12px}.cw-turn-usage{font-size:12px}.cw-turn-usage dl{display:grid;grid-template-columns:auto auto;gap:4px 16px}.cw-turn-usage dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.cw-chat .cw-image-button{padding:0;border:0;background:transparent}.cw-image-preview{max-width:90vw;max-height:90vh;border:0;border-radius:16px;background:var(--dsw-specific-menu);color:inherit}.cw-image-preview::backdrop{background:#0009}.cw-image-preview>button{position:absolute;right:8px;top:8px}.cw-image-preview>img{max-width:85vw;max-height:85vh;object-fit:contain}

.cw-transcript-shell{container-type:inline-size}.cw-transcript{padding:16px 12px 0;display:flex;flex-direction:column}.cw-transcript-content{max-width:var(--cw-content-width);padding:0 8px;width:100%;box-sizing:border-box;flex:1 0 auto}.cw-floating-dock{width:100%;box-sizing:border-box;flex-shrink:0;position:sticky;bottom:0;z-index:8;margin:0 auto;max-width:calc(var(--cw-content-width) + 32px);padding-bottom:0;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1));}.cw-floating-dock .cw-compose{padding:12px 0 4px}.cw-chat .cw-to-bottom{bottom:calc(var(--cw-dock-height) + 16px);z-index:9}.cw-message-actions{flex-wrap:wrap;height:auto;min-height:28px;color:var(--dsw-alias-label-tertiary);font-size:13px}.cw-session-stats{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;padding-top:4px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}.cw-session-stats>span{display:inline-flex;min-width:0}.cw-session-stats .cw-stat svg{width:14px;height:14px}.cw-chat .cw-stat{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:28px;padding:6px 8px;height:28px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer}.cw-stat svg{width:15px;height:15px}.cw-chat .cw-session-stats .cw-stat{height:auto;padding:1px 8px;gap:6px}.cw-chat .cw-stat:hover,.cw-chat .cw-stat[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.cw-stat-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));padding:16px;border:0;border-radius:12px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.cw-stat-title{font-weight:500;color:var(--dsw-alias-label-primary);padding-bottom:10px;border-bottom:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}.cw-stat-panel dl{margin:0;color:var(--dsw-alias-label-tertiary)}.cw-stat-panel dl>div{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:16px;margin-top:6px}.cw-stat-panel dt,.cw-stat-panel dd{margin:0}.cw-stat-panel dd{text-align:right;font-variant-numeric:tabular-nums}.cw-turn-rail{position:absolute;right:12px;top:calc((100% - var(--cw-dock-height))/2);transform:translateY(-50%);width:28px;overflow:auto;z-index:7;scrollbar-width:none;padding:6px 0}.cw-chat .cw-turn-rail button{display:flex;justify-content:flex-end;align-items:center;width:100%;height:10px;border:0;padding:0;background:transparent}.cw-turn-rail button span{height:2px;width:10px;border-radius:2px;background:var(--dsw-alias-label-dimmed)}.cw-turn-rail button[aria-current] span,.cw-turn-rail button:hover span,.cw-turn-rail button:focus span{width:20px;background:var(--dsw-alias-label-primary)}.cw-rail-preview{position:absolute;right:50px;top:calc((100% - var(--cw-dock-height))/2);transform:translateY(-50%);width:min(300px,calc(100cqw - 120px));max-height:100px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel);z-index:9;pointer-events:none;overflow:hidden}.cw-rail-preview strong{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px}.cw-rail-preview p{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-size:12px;color:var(--dsw-alias-label-tertiary);margin:6px 0 0}.cw-width-handle{position:absolute;top:30%;height:80px;width:12px;transform:translateX(-50%);cursor:ew-resize;touch-action:none;z-index:7;border-radius:8px}.cw-width-handle:hover,.cw-width-handle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}

.cw-command{margin:12px 8px;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}.cw-command-row{position:relative;display:flex;align-items:center;overflow:hidden;gap:8px;min-height:28px}.cw-command-row>svg{flex:none}.cw-command-row>i{flex:none;width:2px;height:2px;border-radius:1px;background:var(--dsw-alias-label-caption);margin:0 0 0 2px}.cw-command-summary{min-width:0;overflow:hidden;flex:1;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap}.cw-command-row[data-state=failed] .cw-command-summary{color:var(--dsw-alias-state-error-primary)}.cw-command-row[data-state=inProgress]::after{content:'';position:absolute;inset-block:0;left:0;width:300px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);animation:cw-command-sweep 2.6s ease-out infinite;pointer-events:none}.cw-command>summary{cursor:pointer}.cw-command-error{max-height:260px;margin:4px;padding:12px 16px;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-state-error-primary)}@keyframes cw-command-sweep{0%{left:-300px}90%,100%{left:100%}}@media(prefers-reduced-motion:reduce){.cw-command-row[data-state=inProgress]::after{animation:none}}
`;

// src/native-Toast.tsx
var import_react5 = require("react");
var import_react_dom2 = require("react-dom");
var import_jsx_runtime6 = require("react/jsx-runtime");
var css2 = { "text": "cw-native-toast-text", "tsx": "cw-native-toast-tsx", "toast": "cw-native-toast-toast", "icon": "cw-native-toast-icon" };
var HOLD_MS = 3e3;
var FADE_MS = 1e3;
function Toast({ text, icon, anchor, holdMs = HOLD_MS, onDone }) {
  (0, import_react5.useEffect)(() => {
    const timer = setTimeout(onDone, holdMs + FADE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [holdMs, onDone]);
  const [left, setLeft] = (0, import_react5.useState)(null);
  (0, import_react5.useLayoutEffect)(() => {
    if (anchor == null) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      setLeft(rect.left + rect.width / 2);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);
  return (0, import_react_dom2.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "div",
      {
        className: css2.toast,
        role: "alert",
        style: {
          ...left === null ? {} : { left },
          "--dsh-toast-hold": `${String(holdMs)}ms`
        },
        children: [
          icon !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: css2.icon, "aria-hidden": true, children: icon }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: css2.text, children: text })
        ]
      }
    ),
    document.body
  );
}

// src/native-styles.ts
var nativeStyles = ".cw-native-tooltip-bubble {\n  position: fixed;\n  z-index: 100;\n  /* Fixed-position shrink-to-fit measures only the space from `left` to the\n     viewport edge, so anchors near the right edge would wrap early;\n     max-content sizes by the label alone, capped at half the viewport. */\n  width: max-content;\n  max-width: 50vw;\n  padding: 3px 7px;\n  border-radius: 8px;\n  background: var(--dsw-alias-tooltip-bg);\n  color: var(--dsw-static-neutral-bluish-00);\n  font-size: 13px;\n  line-height: 20px;\n  white-space: pre-line;\n  /* Unbreakable tokens (URLs, paths) must not push past max-width. */\n  overflow-wrap: break-word;\n  pointer-events: none;\n  animation: tooltip-in 150ms var(--ds-ease-in-out);\n}\n\n.cw-native-tooltip-bubble[data-side='right'] {\n  transform: translateY(-50%);\n}\n\n.cw-native-tooltip-bubble[data-side='bottom'] {\n  transform: translateX(-50%);\n}\n\n.cw-native-tooltip-bubble[data-side='top'] {\n  transform: translate(-50%, -100%);\n}\n\n@keyframes tooltip-in {\n  from { opacity: 0; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .cw-native-tooltip-bubble {\n    animation: none;\n  }\n}\n/* The fade delay comes from the component as `--dsh-toast-hold`, so one value\n   drives both the unmount timer and this animation; the fallback matches the\n   component's own default. The fade DURATION still has to agree with FADE_MS\n   in Toast.cw-native-toast-tsx, which no owner varies. */\n\n.cw-native-toast-toast {\n  position: fixed;\n  top: 40px;\n  left: 50%;\n  /* Above the 1000 the image lightbox backdrop uses: a failure reported while\n     a preview is open must stay readable. */\n  z-index: 1100;\n  /* Announcements never intercept clicks. */\n  pointer-events: none;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  /* Fixed boxes with `left` set shrink-to-fit against the space RIGHT of\n     `left` (the -50% translate happens after sizing), so an anchored banner\n     near the window edge would wrap early. max-content sizes the box from\n     its text alone, capped by the max-width below. */\n  width: max-content;\n  max-width: min(640px, calc(100vw - 48px));\n  padding: 12px 16px;\n  border-radius: 14px;\n  background: var(--dsw-alias-button-contrast-fill);\n  color: var(--dsw-alias-label-primary-inverted);\n  font-size: 14px;\n  line-height: 22px;\n  box-shadow: var(--dsw-shadow-lv3);\n  transform: translateX(-50%);\n  animation:\n    dsh-toast-in 160ms ease-out,\n    dsh-toast-fade 1000ms ease var(--dsh-toast-hold, 3000ms) forwards;\n}\n\n.cw-native-toast-icon {\n  display: grid;\n  place-items: center;\n  flex: none;\n  color: var(--dsw-alias-state-warn-label);\n}\n\n.cw-native-toast-text {\n  min-width: 0;\n}\n\n@keyframes dsh-toast-in {\n  from {\n    opacity: 0;\n    transform: translate(-50%, -6px);\n  }\n\n  to {\n    opacity: 1;\n    transform: translate(-50%, 0);\n  }\n}\n\n@keyframes dsh-toast-fade {\n  to {\n    opacity: 0;\n  }\n}\n\n/* Reduced motion drops the slide-in; the delayed fade (an opacity change,\n   not movement) still ends the banner before the timed unmount. */\n@media (prefers-reduced-motion: reduce) {\n  .cw-native-toast-toast {\n    animation: dsh-toast-fade 1000ms ease var(--dsh-toast-hold, 3000ms) forwards;\n  }\n}\n";

// src/client.tsx
var import_react6 = require("react");

// src/constants.ts
var WORKFLOW_PLUGIN_ID = "dsh-workflow-kit";

// src/client.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var name = "dsh-workflow-kit";
var inject = ["connection", "slots", "sidebarRight", "sidebarRightTabs"];
var labels = { starting: "\u542F\u52A8\u4E2D", running: "\u8FD0\u884C\u4E2D", "interrupt-requested": "\u4E2D\u65AD\u4E2D", idle: "\u7A7A\u95F2", saved: "\u5DF2\u4FDD\u5B58", unknown: "\u72B6\u6001\u672A\u77E5" };
function workerLabel(w) {
  const model = (w.model ?? "\u6A21\u578B\u672A\u77E5").replace(/^gpt-/, "").replace(/^\d+(?:\.\d+)*-(?!mini(?:-|$)|nano(?:-|$)|codex(?:-|$)|pro(?:-|$))([a-z]+)$/, "$1");
  return w.role || `${model} \xB7 ${w.effort ?? "\u9ED8\u8BA4"}`;
}
function toggleWorker(sidebar, current, sessionId, w) {
  if (sidebar.isExpanded() && current?.sessionId === sessionId && current.workerId === w.id) sidebar.toggleExpanded();
  else sidebar.openTab("codex-worker", { params: { workerId: w.id } });
}
function active(w) {
  return ["starting", "running", "interrupt-requested", "unknown"].includes(w.state) || (w.approvals ?? []).length > 0 || w.reports.some((r) => !r.acknowledgedAt && r.acceptance === "pending");
}
function occupancy(w) {
  const used = w.usage?.last.totalTokens, capacity = w.usage?.modelContextWindow;
  return typeof used === "number" && used >= 0 && typeof capacity === "number" && capacity > 0 ? Math.min(100, used / capacity * 100) : null;
}
function useWorkers(sessionId, call) {
  const [workers, setWorkers] = (0, import_react6.useState)([]), [error, setError] = (0, import_react6.useState)("");
  (0, import_react6.useEffect)(() => {
    let disposed = false, timer;
    setWorkers([]);
    setError("");
    const update = async () => {
      try {
        const rows = await call(sessionId, { action: "list" });
        if (!disposed) {
          setWorkers(rows);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) timer = setTimeout(update, 1500);
      }
    };
    void update();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId, call]);
  return { workers, error };
}
function formatContext(value) {
  return typeof value === "number" ? `${Math.round(value / 100) / 10}k` : "\u2014";
}
function Meter({ worker }) {
  const panel = (0, import_react6.useRef)(null), [open, setOpen] = (0, import_react6.useState)(false);
  (0, import_react6.useEffect)(() => {
    const node = panel.current;
    const update = () => setOpen(node?.matches(":popover-open") ?? false);
    node?.addEventListener("toggle", update);
    return () => node?.removeEventListener("toggle", update);
  }, [worker.usage]);
  const value = occupancy(worker);
  if (value === null) return null;
  const usage = `${formatContext(worker.usage?.last.totalTokens)} / ${formatContext(worker.usage?.modelContextWindow)}`;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "cw-context-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { label: `\u4E0A\u4E0B\u6587\u5360\u7528 ${Math.round(value)}%`, side: "top", delayMs: 200, disabled: open, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cw-context-ring", "aria-label": `\u4E0A\u4E0B\u6587\u5360\u7528 ${Math.round(value)}%`, "aria-haspopup": "dialog", "aria-expanded": open, onClick: (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (panel.current) {
        panel.current.style.left = `${Math.max(12, Math.min(rect.right - 264, window.innerWidth - 276))}px`;
        panel.current.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        panel.current.togglePopover();
      }
      setOpen(panel.current?.matches(":popover-open") ?? false);
    }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("svg", { viewBox: "0 0 14 14", width: "14", height: "14", "aria-hidden": "true", fill: "none", strokeWidth: "2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("circle", { cx: "7", cy: "7", r: "5", stroke: "var(--dsw-alias-border-l3)" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("circle", { cx: "7", cy: "7", r: "5", stroke: "var(--dsw-alias-label-tertiary)", pathLength: "100", strokeDasharray: `${value} 100`, strokeLinecap: "round", transform: "rotate(-90 7 7)" })
    ] }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { ref: panel, ...{ popover: "auto" }, className: "cw-context-panel", role: "dialog", "aria-label": "\u4E0A\u4E0B\u6587\u7528\u91CF", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
        "\u4E0A\u4E0B\u6587\u5360\u7528 ",
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("strong", { children: [
          Math.round(value),
          "%"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: usage }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cw-context-bar", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { width: `${value}%` } }) })
    ] })
  ] });
}
function UserActions({ worker, call, sessionId, closed }) {
  const [busy, setBusy] = (0, import_react6.useState)(false), [error, setError] = (0, import_react6.useState)("");
  const act = async (action) => {
    setBusy(true);
    setError("");
    try {
      await call(sessionId, { action, workerId: worker.id });
      if (action === "detach") closed?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "cw-user-actions", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { label: "\u4EA4\u7ED9\u5F53\u524D agent", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", "aria-label": `Link ${worker.name}`, disabled: busy, onClick: () => void act("link"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0", transform: "translate(1 1)" }) }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { label: "\u79FB\u51FA\u7528\u6237\u5BF9\u8BDD\u7EC4\uFF0C\u4FDD\u7559\u5386\u53F2", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", "aria-label": `Close ${worker.name}`, disabled: busy, onClick: () => void act("detach"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "m6 6 12 12M18 6 6 18" }) }) }) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { role: "alert", children: error })
  ] });
}
function DockGroup({ label, children }) {
  const [open, setOpen] = (0, import_react6.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-fold", onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false), onFocus: () => setOpen(true), onBlur: (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }, onKeyDown: (e) => {
    if (e.key === "Escape") setOpen(false);
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { className: "cw-fold-trigger", "aria-expanded": open, onClick: () => setOpen((v) => !v), children: label }),
    open && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cw-fold-list", "aria-label": label.startsWith("\u975E\u6D3B\u8DC3") ? "\u975E\u6D3B\u8DC3\u5BF9\u8BDD" : label, children })
  ] });
}
function Dock({ sessionId, call, open, newChat, resumeChat, collapsed = false, closed }) {
  const { workers, error } = useWorkers(sessionId, call);
  const agents = workers.filter((w) => w.owner !== "user"), users = workers.filter((w) => w.owner === "user"), visible = agents.filter(active), folded = agents.filter((w) => !active(w));
  const pill = (w) => {
    const percent = occupancy(w) ?? 0, usage = `${formatContext(w.usage?.last.totalTokens)} / ${formatContext(w.usage?.modelContextWindow)}`;
    const button = /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { className: "cw-pill", onClick: () => open(w), "aria-label": `\u6253\u5F00 Codex \u5BF9\u8BDD ${w.name}`, title: `${w.name} \xB7 ${labels[w.state]}`, style: { backgroundImage: `linear-gradient(to right, color-mix(in srgb, #729ce1 24%, transparent) ${percent}%, transparent ${percent}%)` }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cw-type", children: workerLabel(w) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cw-usage", children: usage })
    ] });
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: `cw-pill-row${w.owner === "user" ? " cw-user-pill" : ""}`, children: [
      button,
      w.owner === "user" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(UserActions, { worker: w, call, sessionId, closed: () => closed?.(w) })
    ] }, w.id);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-dock", "aria-label": "\u4EE3\u7406\u4EFB\u52A1\u680F", children: [
    collapsed && visible.length ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DockGroup, { label: `\u6D3B\u8DC3 ${visible.length}`, children: visible.map(pill) }) : visible.map(pill),
    folded.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DockGroup, { label: `\u975E\u6D3B\u8DC3 ${folded.length}`, children: folded.map(pill) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(DockGroup, { label: `\u7528\u6237\u5BF9\u8BDD ${users.length}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-user-new", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { className: "cw-new", onClick: newChat, children: "\uFF0B New" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { className: "cw-resume", onClick: resumeChat, children: "Resume" })
      ] }),
      users.map(pill)
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { role: "alert", children: error })
  ] });
}
function ResumeBrowser({ sessionId, call, open }) {
  const [search, setSearch] = (0, import_react6.useState)(""), [rows, setRows] = (0, import_react6.useState)([]), [cursor, setCursor] = (0, import_react6.useState)(null), [error, setError] = (0, import_react6.useState)(""), [busy, setBusy] = (0, import_react6.useState)(false), [revision, retry] = (0, import_react6.useState)(0);
  (0, import_react6.useEffect)(() => {
    let disposed = false;
    setRows([]);
    setCursor(null);
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      void call(sessionId, { action: "sessions", search }).then((value) => {
        if (!disposed) {
          setRows(value.data);
          setCursor(value.nextCursor);
        }
      }).catch((e) => {
        if (!disposed) setError(String(e));
      }).finally(() => {
        if (!disposed) setBusy(false);
      });
    }, 200);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId, call, search, revision]);
  const more = async () => {
    setBusy(true);
    setError("");
    try {
      const page = await call(sessionId, { action: "sessions", search, cursor });
      setRows((r) => [...r, ...page.data]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "cw-chat cw-resume-browser", "aria-label": "Codex Resume", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { "aria-label": "\u641C\u7D22 Codex \u4F1A\u8BDD", placeholder: "\u641C\u7D22 Codex \u4F1A\u8BDD\u2026", value: search, onChange: (e) => setSearch(e.target.value) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-resume-list", children: [
      rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { disabled: busy, onClick: async () => {
        setBusy(true);
        setError("");
        try {
          open(await call(sessionId, { action: "adopt", threadId: row.id }));
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(false);
        }
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: row.name || row.preview || row.id }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("small", { children: row.cwd }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("small", { children: [
          new Date(row.updatedAt * 1e3).toLocaleString(),
          " \xB7 ",
          row.id
        ] })
      ] }, row.id)),
      busy && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u2026" }),
      !busy && !rows.length && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "\u6CA1\u6709\u53EF\u7528\u4F1A\u8BDD" }),
      cursor && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy, onClick: () => void more(), children: "\u52A0\u8F7D\u66F4\u591A" }),
      error && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { role: "alert", children: [
        error,
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { onClick: () => retry((n) => n + 1), children: "\u91CD\u8BD5" })
      ] })
    ] })
  ] });
}
function ModelPicker({ sessionId, call, workerId, initialModel, initialEffort, disabled, submit, onReady }) {
  const [catalog, setCatalog] = (0, import_react6.useState)(null), [model, setModel] = (0, import_react6.useState)(""), [effort, setEffort] = (0, import_react6.useState)(""), [error, setError] = (0, import_react6.useState)(""), [saving, setSaving] = (0, import_react6.useState)(false);
  (0, import_react6.useEffect)(() => {
    let disposed = false;
    void call(sessionId, { action: "models", workerId }).then((value) => {
      if (disposed) return;
      const data = value;
      setCatalog(data);
      let saved = {};
      if (onReady) {
        try {
          saved = JSON.parse(localStorage.getItem("codex-workers.new-defaults") ?? "{}") ?? {};
        } catch {
        }
      }
      const savedModel = data.models.find((m) => m.model === saved.model);
      const selected2 = initialModel ?? savedModel?.model ?? data.model ?? "";
      setModel(selected2);
      const savedEffort = savedModel?.supportedReasoningEfforts.some((e) => e.reasoningEffort === saved.effort) ? saved.effort : void 0;
      const level = initialEffort ?? savedEffort ?? (selected2 === data.model ? data.effort : null) ?? data.models.find((m) => m.model === selected2)?.defaultReasoningEffort ?? "";
      setEffort(level);
      if (selected2 && level) onReady?.(selected2, level);
    }).catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
    };
  }, [sessionId, call, initialModel, initialEffort]);
  const menu = (0, import_react6.useRef)(null), trigger = (0, import_react6.useRef)(null);
  const [isOpen, setOpen] = (0, import_react6.useState)(false);
  const menuId = (0, import_react6.useId)();
  const [pane, setPane] = (0, import_react6.useState)("root");
  (0, import_react6.useLayoutEffect)(() => {
    if (!isOpen) return;
    const place = () => {
      if (!menu.current || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect(), panel = menu.current;
      panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(rect.top - 8 - panel.offsetHeight, window.innerHeight - panel.offsetHeight - 12))}px`;
    };
    place();
    if (!menu.current?.contains(document.activeElement)) menu.current?.querySelector("button")?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen, pane, catalog]);
  const close = () => {
    menu.current?.hidePopover();
    setOpen(false);
    trigger.current?.focus();
  };
  (0, import_react6.useEffect)(() => {
    const panel = menu.current;
    const toggled = () => setOpen(panel?.matches(":popover-open") ?? false);
    panel?.addEventListener("toggle", toggled);
    return () => panel?.removeEventListener("toggle", toggled);
  }, []);
  const selected = catalog?.models.find((m) => m.model === model);
  const effortName = (value) => value ? value[0].toUpperCase() + value.slice(1) : "\u9ED8\u8BA4";
  const choose = async (nextModel, nextEffort) => {
    setSaving(true);
    setError("");
    try {
      await submit(nextModel, nextEffort);
      setModel(nextModel);
      setEffort(nextEffort);
      close();
    } catch (e) {
      close();
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-model-picker", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { ref: trigger, type: "button", className: "cw-model-trigger", "aria-label": `\u9009\u62E9\u6A21\u578B\uFF0C\u5F53\u524D ${selected?.displayName ?? model}\uFF0C\u63A8\u7406\u7B49\u7EA7 ${effortName(effort)}`, "aria-haspopup": "menu", "aria-expanded": isOpen, "aria-controls": isOpen ? menuId : void 0, disabled: disabled || saving || !catalog, onClick: () => {
      if (isOpen) close();
      else {
        setPane("root");
        menu.current?.showPopover();
        setOpen(true);
      }
    }, onKeyDown: (e) => {
      if (e.key === "ArrowDown" && isOpen) {
        e.preventDefault();
        menu.current?.querySelector("button")?.focus();
      }
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IconDataOutline16, { className: "cw-model-icon" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cw-model-name", children: selected?.displayName ?? (model || "\u8BFB\u53D6 Codex \u914D\u7F6E\u2026") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cw-model-effort", children: effortName(effort) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IconChevronDownOutline14, { className: "cw-chevron" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { ref: menu, id: menuId, ...{ popover: "auto" }, role: "menu", "aria-label": "\u6A21\u578B\u4E0E\u63A8\u7406\u7B49\u7EA7", className: "cw-model-menu", onBlur: (e) => {
      if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close();
    }, onKeyDown: (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pane !== "root") setPane("root");
        else close();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(e.currentTarget.querySelectorAll("button:not(:disabled)"));
        const index = items.indexOf(document.activeElement);
        items[((index < 0 ? e.key === "ArrowDown" ? -1 : 0 : index) + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }, children: pane === "root" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_jsx_runtime7.Fragment, { children: ["model", "effort"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", role: "menuitem", className: "cw-model-cell", onClick: () => setPane(key), children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: key === "model" ? "\u6A21\u578B" : "\u63A8\u7406\u7B49\u7EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cw-model-value", children: key === "model" ? selected?.displayName ?? model : effortName(effort) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IconChevronRightOutline14, {})
    ] }, key)) }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", role: "menuitem", className: "cw-model-cell", onClick: () => setPane("root"), children: [
        "\u2039 ",
        pane === "model" ? "\u6A21\u578B" : "\u63A8\u7406\u7B49\u7EA7"
      ] }),
      pane === "model" ? catalog?.models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "cw-model-option", disabled: saving, role: "menuitemradio", "aria-checked": model === m.model, onClick: () => void choose(m.model, m.defaultReasoningEffort), children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: m.displayName }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: model === m.model ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IconCheckOutline16, {}) : null })
      ] }, m.model)) : selected?.supportedReasoningEfforts.map((e) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("button", { type: "button", className: "cw-model-option", disabled: saving, role: "menuitemradio", "aria-checked": effort === e.reasoningEffort, onClick: () => void choose(model, e.reasoningEffort), children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: effortName(e.reasoningEffort) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: effort === e.reasoningEffort ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(IconCheckOutline16, {}) : null })
      ] }, e.reasoningEffort))
    ] }) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Toast, { text: error, anchor: trigger.current?.closest(".cw-composer-card"), onDone: () => setError("") }, error)
  ] });
}
function Composer({ sessionId, call, newChat, latestAnswer, worker, busy, ready, error, send, stop, picker }) {
  const [text, setText] = (0, import_react6.useState)(""), input = (0, import_react6.useRef)(null), submitting = (0, import_react6.useRef)(false), focusPending = (0, import_react6.useRef)(false);
  const [notice, setNotice] = (0, import_react6.useState)("");
  const command = async (name2) => {
    setNotice("");
    try {
      if (name2 === "skills") {
        setText("$");
        menu.setCaret(1);
        input.current?.focus();
        return;
      }
      if (name2 === "model") {
        input.current?.closest(".cw-composer-card")?.querySelector(".cw-model-trigger")?.click();
      } else if (name2 === "new") {
        if (!newChat) throw Error("\u5DF2\u5728\u7A7A\u767D\u5BF9\u8BDD\u4E2D");
        newChat();
      } else if (name2 === "status") setNotice(worker ? `${worker.model ?? "\u9ED8\u8BA4\u6A21\u578B"} \xB7 ${worker.effort ?? "\u9ED8\u8BA4\u5F3A\u5EA6"} \xB7 ${labels[worker.state]} \xB7 ${worker.threadId ?? ""}` : "\u7A7A\u767D\u5BF9\u8BDD\uFF0C\u53D1\u9001\u6D88\u606F\u540E\u521B\u5EFA");
      else if (name2 === "copy") {
        if (!latestAnswer) throw Error("\u6682\u65E0\u53EF\u590D\u5236\u7684\u56DE\u7B54");
        await (0, import_dsh_client_ui_primitives5.writeClipboard)(latestAnswer);
        setNotice("\u5DF2\u590D\u5236");
      } else if (name2 === "compact" || name2 === "review") {
        if (!worker || worker.state !== "idle") throw Error("\u8BF7\u5728\u5DF2\u8FDE\u63A5\u4E14\u7A7A\u95F2\u7684\u5BF9\u8BDD\u4E2D\u6267\u884C");
        await call(sessionId, { action: name2, workerId: worker.id });
        setNotice(name2 === "compact" ? "" : "\u5DF2\u5F00\u59CB\u5BA1\u67E5\u672A\u63D0\u4EA4\u6539\u52A8");
      } else throw Error(`\u6B64\u754C\u9762\u5C1A\u672A\u63A5\u5165 /${name2}\u3002\u53EF\u7528\u6307\u4EE4\uFF1A${commands.map(([n]) => "/" + n).join("\u3001")}`);
      setText("");
    } catch (e) {
      setNotice(String(e));
    }
  };
  const menu = useInputMenu({ text, setText, input, sessionId, workerId: worker?.id, call, command });
  const id = (0, import_react6.useId)(), running = worker?.state === "running";
  (0, import_react6.useEffect)(() => {
    if (!busy && focusPending.current) {
      focusPending.current = false;
      input.current?.focus();
    }
  }, [busy]);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("footer", { className: "cw-compose", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-composer-card", children: [
    menu.menu,
    notice && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "cw-input-notice", role: "status", children: notice }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("form", { id, onSubmit: async (e) => {
      e.preventDefault();
      if (busy || !ready || !text.trim() || submitting.current) return;
      submitting.current = true;
      try {
        if (/^\/[a-z][\w-]*(?:\s|$)/i.test(text)) {
          const parts = text.trim().split(/\s+/);
          if (parts.length > 1) setNotice("\u8BF7\u4ECE\u6307\u4EE4\u83DC\u5355\u9009\u62E9\u64CD\u4F5C\uFF1B\u6B64\u6307\u4EE4\u4E0D\u63A5\u53D7\u6587\u672C\u53C2\u6570");
          else await command(parts[0].slice(1));
        } else if (await send(text, menu.selected)) {
          setText("");
          menu.clear();
        }
      } finally {
        submitting.current = false;
        focusPending.current = true;
        input.current?.focus();
      }
    }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("textarea", { ref: input, ...menu.aria, onSelect: (e) => menu.setCaret(e.currentTarget.selectionStart), rows: 1, "aria-label": "\u53D1\u9001\u7ED9 Codex", placeholder: running ? "\u5411\u5F53\u524D\u4EFB\u52A1\u63D2\u8BDD\u2026" : "\u53D1\u6D88\u606F\u6216\u521B\u5EFA\u4EFB\u52A1\u2026", value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
      if (menu.onKeyDown(e)) return;
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    }, required: true, disabled: busy || !ready }) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cw-composer-toolbar", children: [
      picker,
      worker && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Meter, { worker }),
      running && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { label: "\u4E2D\u65AD", side: "top", delayMs: 500, disabled: busy, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cw-stop", "aria-label": "\u4E2D\u65AD", disabled: busy, onMouseDown: (e) => e.preventDefault(), onClick: stop, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("rect", { x: "3", y: "3", width: "10", height: "10", rx: "3", fill: "currentColor" }) }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Tooltip, { label: running ? "\u63D2\u8BDD" : "\u53D1\u9001", side: "top", delayMs: 500, disabled: busy || !ready || !text.trim(), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { className: "cw-send", type: "submit", form: id, "aria-label": running ? "\u63D2\u8BDD" : "\u53D1\u9001", disabled: busy || !ready || !text.trim(), onMouseDown: (e) => e.preventDefault(), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("path", { d: "M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z", fill: "currentColor" }) }) }) })
    ] })
  ] }) });
}
function NewConversation({ sessionId, call, open }) {
  const [selection, setSelection] = (0, import_react6.useState)(null);
  const [busy, setBusy] = (0, import_react6.useState)(false), [error, setError] = (0, import_react6.useState)("");
  const created = (0, import_react6.useRef)(null), sending = (0, import_react6.useRef)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "cw-chat", "aria-label": "\u65B0 Codex \u5BF9\u8BDD", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cw-messages" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Composer, { sessionId, call, busy, ready: selection !== null, error, send: async (text, skills) => {
      if (!selection || sending.current) return false;
      sending.current = true;
      setBusy(true);
      setError("");
      try {
        created.current ??= await call(sessionId, { action: "create", name: text.trim().slice(0, 40), ...selection });
        const result = await call(sessionId, { action: "append", workerId: created.current.id, text, skills });
        if (result?.error) throw Error(result.error);
        open(created.current);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        sending.current = false;
        setBusy(false);
      }
    }, picker: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ModelPicker, { sessionId, call, disabled: busy || created.current !== null, onReady: (model, effort) => setSelection({ model, effort }), submit: async (model, effort) => {
      setSelection({ model, effort });
      try {
        localStorage.setItem("codex-workers.new-defaults", JSON.stringify({ model, effort }));
      } catch {
      }
    } }) })
  ] });
}
function ConversationPanel({ sessionId, workerId, call, fullscreen = false, newChat, closeChat }) {
  const { workers, error: listError } = useWorkers(sessionId, call);
  const worker = workers.find((w) => w.id === workerId);
  const { history, error: historyError, retry } = useConversation(sessionId, workerId, call);
  const [error, setError] = (0, import_react6.useState)(""), [busy, setBusy] = (0, import_react6.useState)(false);
  const recovered = (0, import_react6.useRef)(false);
  (0, import_react6.useEffect)(() => {
    if (recovered.current || worker?.state !== "saved" || worker.savedState !== "idle") return;
    recovered.current = true;
    setBusy(true);
    setError("");
    void call(sessionId, { action: "resume", workerId }).then(retry).catch((e) => setError(String(e))).finally(() => setBusy(false));
  }, [sessionId, workerId, worker?.state, worker?.savedState, call]);
  const act = async (input) => {
    setBusy(true);
    setError("");
    try {
      const result = await call(sessionId, { ...input, workerId });
      if (result?.error) throw Error(result.error);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!worker) return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cw-chat", children: listError || "\u6B63\u5728\u52A0\u8F7D\u5BF9\u8BDD\u2026" });
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "cw-chat", "aria-label": `${worker.name} \u5BF9\u8BDD`, children: [
    worker.owner === "user" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cw-user-controls", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(UserActions, { worker, call, sessionId, closed: closeChat }) }),
    worker.state === "saved" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "cw-caption", role: "status", children: worker.savedState === "idle" ? "\u6B63\u5728\u4ECE Codex \u6062\u590D\u5BF9\u8BDD\u2026" : "\u91CD\u542F\u524D\u7684\u6267\u884C\u72B6\u6001\u5C1A\u672A\u786E\u8BA4\uFF1B\u53EF\u4EE5\u67E5\u770B\u5386\u53F2\uFF0C\u786E\u8BA4\u65E7\u8FDB\u7A0B\u9000\u51FA\u540E\u6062\u590D\u5BF9\u8BDD\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Transcript, { sessionId, worker, history, error: error || listError || historyError || worker.error || "", busy, retry, act, fullscreen, footer: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Composer, { sessionId, call, newChat, latestAnswer: [...history?.items ?? []].reverse().find((i) => i.role === "assistant" && i.phase !== "commentary")?.text ?? worker.reports.at(-1)?.result, worker, busy, ready: ["idle", "running"].includes(worker.state), send: async (text, skills) => act({ action: worker.state === "idle" ? "append" : "steer", turnId: worker.turnId ?? void 0, text, skills }), stop: () => void act({ action: "interrupt", turnId: worker.turnId }), picker: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ModelPicker, { sessionId, call, workerId: worker.id, initialModel: worker.model, initialEffort: worker.effort, disabled: busy || !["idle", "running"].includes(worker.state), submit: async (model, effort) => {
        setBusy(true);
        try {
          await call(sessionId, { action: "configure", workerId, model, effort });
        } finally {
          setBusy(false);
        }
      } }) }),
      ["saved", "unknown"].includes(worker.state) && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy, onClick: () => {
        if (worker.state === "saved" && worker.savedState === "idle" || window.confirm("\u6062\u590D\u524D\u8BF7\u786E\u8BA4\u65E7 Codex \u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u4E14\u6CA1\u6709\u5176\u4ED6\u8FDB\u7A0B\u6B63\u5728\u6267\u884C\u8BE5\u4F1A\u8BDD\u3002\u6062\u590D\u53EA\u8F7D\u5165\u5386\u53F2\uFF0C\u4E0D\u91CD\u53D1\u65E7\u4EFB\u52A1\u3002")) void act({ action: "resume", confirmedStopped: true }).then((ok) => {
          if (ok) retry();
        });
      }, children: busy ? "\u6B63\u5728\u91CD\u65B0\u8FDE\u63A5\u2026" : "\u6062\u590D\u5BF9\u8BDD" }),
      worker.owner !== "user" && ["saved", "unknown"].includes(worker.state) && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { disabled: busy, onClick: () => {
        if (window.confirm("\u786E\u8BA4\u65E7 Codex \u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u4E14\u6CA1\u6709\u5176\u4ED6\u8FDB\u7A0B\u6B63\u5728\u6267\u884C\u8BE5\u4F1A\u8BDD\uFF1F\u5173\u95ED\u5C06\u79FB\u51FA\u5BF9\u8BDD\u7EC4\u5E76\u4FDD\u7559\u5DF2\u6709\u5386\u53F2\uFF0C\u4E0D\u4F1A\u5C1D\u8BD5\u6062\u590D\u4F1A\u8BDD\u3002")) void act({ action: "close", confirmedStopped: true }).then((ok) => {
          if (ok) closeChat?.();
        });
      }, children: "\u5173\u95ED\u5BF9\u8BDD" })
    ] }) })
  ] });
}
var css3 = nativeStyles + transcriptStyles + `
.cw-native-header{display:grid!important;grid-template-columns:auto minmax(0,1fr);align-items:center}.cw-native-header>:first-child{grid-column:1/-1}.cw-native-header>[role=tablist]{grid-column:1;grid-row:2}.cw-native-header>.cw-dock{grid-column:2;grid-row:2;justify-self:end;justify-content:flex-end;min-width:0}.cw-pill-row{display:flex;align-items:center;gap:4px}.cw-user-pill{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:999px;overflow:visible;padding-right:5px;background:color-mix(in srgb,currentColor 4%,transparent)}.cw-user-pill>.cw-pill{flex:1;min-width:0;border:0;background-color:transparent}.cw-user-pill .cw-usage{margin-left:auto}.cw-user-pill .cw-type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cw-user-pill .cw-user-actions{padding-right:2px}.cw-user-actions{display:inline-flex;flex:none;gap:2px}.cw-user-actions button,.cw-chat .cw-user-actions button{display:grid;place-items:center;box-sizing:border-box;padding:0;width:26px;height:26px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.cw-user-actions button:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-user-controls{display:flex;justify-content:flex-end;padding:4px 12px}.cw-user-new{display:flex;gap:6px}.cw-resume-browser{padding:12px;box-sizing:border-box;gap:12px}.cw-resume-browser>input{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major);color:inherit;font:inherit}.cw-resume-list{overflow:auto;min-height:0}.cw-chat .cw-resume-list>button{display:flex;flex-direction:column;gap:4px;text-align:left;width:100%;border:0;padding:12px;border-radius:10px;white-space:normal}.cw-resume-list>button:hover{background:var(--dsw-alias-interactive-bg-hover)}.cw-resume-list strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}.cw-resume-list small{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}.cw-dock{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 0;font-size:12px}.cw-pill,.cw-fold-trigger,.cw-new{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:999px;padding:5px 10px;background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;cursor:pointer;font:inherit}.cw-pill:hover,.cw-fold-trigger:hover,.cw-new:hover{background:color-mix(in srgb,currentColor 10%,transparent)}.cw-pill:focus-visible,.cw-fold-trigger:focus-visible,.cw-new:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-type{font-weight:600}.cw-usage{font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:6px}.cw-muted{opacity:.65}.cw-context-ring{display:inline-flex;flex-shrink:0;color:var(--dsw-alias-label-secondary,#81858c);border-radius:50%}.cw-context-ring:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-meter{display:inline-flex;align-items:center;gap:5px;font-size:11px;white-space:nowrap}.cw-track{width:34px;height:4px;border-radius:4px;background:color-mix(in srgb,currentColor 15%,transparent);overflow:hidden;display:inline-block}.cw-track>span{display:block;height:100%;background:#729ce1}.cw-role-list{max-height:240px;overflow:auto;padding:8px;max-width:440px}.cw-role-list p{margin:4px 0}.cw-role-list>div{padding:6px 0}.cw-fold{position:relative}.cw-fold-list{position:absolute;top:100%;right:0;z-index:100;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:10px;min-width:max-content;max-height:240px;overflow:auto;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;box-shadow:0 6px 24px #0002}.cw-chat{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit;font-size:13px}.cw-chat-header{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:14px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent)}.cw-chat-header>strong{flex-basis:100%}.cw-messages{flex:1;min-height:0;overflow:auto;padding:14px;overflow-wrap:anywhere}.cw-message{margin-bottom:16px;border-radius:10px;padding:10px;background:color-mix(in srgb,currentColor 4%,transparent)}.cw-user{margin-left:22px;background:color-mix(in srgb,#729ce1 13%,transparent)}.cw-message small{opacity:.65}.cw-chat pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:6px 0}.cw-tool{font-size:12px}.cw-compose{padding:12px}.cw-composer-card{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));border-radius:22px;background:var(--dsw-specific-input-major,Canvas);box-shadow:var(--dsw-elevation-soft,0 2px 12px #0001);border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);padding:8px 0 0}.cw-composer-card textarea{box-sizing:border-box;display:block;resize:none;field-sizing:content;width:100%;min-height:36px;max-height:var(--dsh-composer-text-max-height,200px);border:0;outline:none;background:transparent;color:inherit;padding:4px 14px 0;font:inherit;line-height:inherit}.cw-composer-card textarea::placeholder{color:var(--dsw-alias-text-tertiary,#a6abb3)}.cw-composer-card:focus-within{border-color:var(--dsw-alias-border-l3,#8885)}.cw-composer-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:2px 8px 6px;min-width:0}.cw-chat button{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:7px;padding:5px 9px;cursor:pointer;color:inherit;background:transparent;white-space:nowrap}.cw-chat .cw-send,.cw-chat .cw-stop{display:grid;place-items:center;flex-shrink:0;width:34px;height:34px;padding:0;border:0;border-radius:999px;corner-shape:round}.cw-chat .cw-send{background:var(--dsw-alias-button-info-fill,#3964fe);color:white;transform:translateY(-2px)}.cw-chat .cw-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#3259e5)}.cw-chat .cw-stop{background:color-mix(in srgb,currentColor 7%,transparent)}.cw-chat button:focus-visible,.cw-chat select:focus-visible{outline:2px solid #548de9;outline-offset:2px}.cw-chat button:disabled{opacity:.4;cursor:default}.cw-report{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11px;margin-bottom:10px}
.cw-composer-card{position:relative}.cw-input-menu{position:absolute;bottom:calc(100% + 4px);left:0;right:0;z-index:100;max-height:320px;overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);padding:4px;display:flex;flex-direction:column;border:0;border-radius:20px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent)}.cw-input-menu [role=listbox]{display:flex;flex-direction:column;min-height:0;overflow-y:auto}.cw-input-menu-title{padding:8px 10px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.cw-chat .cw-input-option{display:flex;align-items:center;gap:8px;width:100%;flex-shrink:0;min-height:40px;padding:8px 10px;border:0;border-radius:10px;background:transparent;cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}.cw-chat .cw-input-option[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.cw-input-name{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cw-input-description{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}.cw-input-notice{margin:4px 14px;font-size:12px;overflow-wrap:anywhere}.cw-model-picker {
  position: relative;
  min-width: 0;
}


.cw-chat .cw-model-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;

  max-width: 220px;
  max-width: min(360px, 45cqw);
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;

  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}

.cw-chat .cw-model-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.cw-chat .cw-model-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.cw-chat .cw-model-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.cw-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


.cw-model-effort {
  flex-shrink: 1000;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-caption);
}


.cw-model-icon {
  display: none;
  flex: 0 0 auto;
}


@container (max-width: 360px) {
  .cw-model-icon {
    display: block;
  }

  .cw-model-name,
  .cw-model-effort {
    display: none;
  }
}

.cw-chevron {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}

.cw-model-chevronOpen {
  transform: rotate(180deg);
}


.cw-model-menu {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;

  width: max-content;
  min-width: min(240px, calc(100vw - 32px));
  max-width: min(420px, calc(100vw - 32px));
  max-height: min(360px, calc(100vh - 96px));
  overflow: hidden;
  padding: 4px;

  border: 0;
  border-radius: 20px;
  background: var(--dsw-specific-menu);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);

  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.cw-model-status,
.cw-model-empty {
  padding: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.cw-model-error,
.cw-model-warning {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  padding: 7px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}

.cw-model-warning {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-state-warn-label);
}

.cw-model-retry {
  flex: 0 0 auto;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.cw-model-groups {
  min-height: 0;
  overflow-y: auto;
}

.cw-model-group + .cw-model-group {
  margin-top: 4px;
}

.cw-model-groupTitle {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 8px 3px;
  background: var(--dsw-specific-menu);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}

.cw-chat .cw-model-option {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-width: 100%;
  min-height: 38px;
  padding: 6px 8px;
  border: none;
  border-radius: 10px;
  outline: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.cw-chat .cw-model-option:hover:not(:disabled),
.cw-chat .cw-model-option:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}


.cw-model-selected {
  background: transparent;
}

.cw-chat .cw-model-option:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.cw-chat .cw-model-optionCopy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cw-model-modelName {
  overflow: hidden;
  color: inherit;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cw-model-check {
  display: grid;
  place-items: center;
  flex: 0 0 18px;
  color: var(--dsw-alias-label-primary);
}


.cw-chat .cw-model-cell {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  min-width: 100%;
  height: 40px;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  text-align: left;
}

.cw-chat .cw-model-cell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.cw-chat .cw-model-cellLabel {
  flex: 0 0 auto;
  white-space: nowrap;
}

.cw-model-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
}

.cw-chat .cw-model-cellChevron {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}

.cw-model-menu:not(:popover-open){display:none}
.cw-model-menu{inset:auto;margin:0;overflow-y:auto}.cw-model-picker:has(:popover-open) .cw-chevron{transform:rotate(180deg)}
.cw-chat .cw-model-trigger:disabled{opacity:1}.cw-model-option>span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500;font-size:14px}.cw-model-option>span:last-child{display:grid;place-items:center;width:18px;flex:none}.cw-model-cell>svg{color:var(--dsw-alias-label-tertiary);flex:none}
.cw-composer-toolbar{container-type:inline-size;flex-wrap:wrap}.cw-model-effort{flex-shrink:1000;min-width:0;overflow:hidden;text-overflow:ellipsis}.cw-model-icon{display:none}
@container (max-width:360px){.cw-model-icon{display:block}.cw-model-name,.cw-model-effort{display:none}}
.cw-chat .cw-model-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cw-chat .cw-stop{background:var(--dsw-alias-button-info-fill);color:#fff;transform:translateY(-2px)}.cw-chat .cw-stop:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.cw-composer-card textarea{font-family:var(--dsw-font-family);padding:4px 8px 0 14px;width:calc(100% - 4px);color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);overflow-wrap:anywhere}
.cw-composer-card textarea::placeholder{color:var(--dsw-alias-label-caption);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.cw-context-root{display:inline-flex;position:relative}.cw-chat .cw-context-ring{display:grid;place-items:center;flex:none;width:28px;height:28px;border:0;border-radius:999px;corner-shape:round;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:pointer}.cw-chat .cw-context-ring:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cw-chat .cw-model-cell:focus-visible,.cw-chat .cw-model-option:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.cw-context-panel{inset:auto;margin:0;position:fixed;box-sizing:border-box;width:264px;max-width:calc(100vw - 24px);padding:12px;border:0;border-radius:12px;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}.cw-context-panel>strong{float:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.cw-context-bar{height:4px;margin:10px 0 12px;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;overflow:hidden}.cw-context-bar>span{display:block;height:100%;background:var(--dsw-alias-label-tertiary)}

`;
function apply(ctx) {
  const call = async (sessionId, input) => {
    const result = await ctx.connection.rpc.call("/codex-workers", "action", { sessionId, input });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  const viewListeners = /* @__PURE__ */ new Set();
  const changed = () => viewListeners.forEach((fn) => fn());
  let currentView;
  ctx.effect(() => {
    const style = document.createElement("style");
    style.textContent = css3;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: "codex-worker", kind: "codex-worker", title: () => "Codex \u5BF9\u8BDD" }));
  function HeaderDock({ sessionId }) {
    const anchor = (0, import_react6.useRef)(null), [header, setHeader] = (0, import_react6.useState)(null);
    const collapsed = (0, import_react6.useSyncExternalStore)((fn) => {
      viewListeners.add(fn);
      return () => {
        viewListeners.delete(fn);
      };
    }, () => !!currentView && currentView.sessionId === sessionId && ctx.sidebarRight.isExpanded());
    (0, import_react6.useLayoutEffect)(() => {
      const node = anchor.current?.closest("header");
      if (!node) return;
      node.classList.add("cw-native-header");
      setHeader(node);
      return () => node.classList.remove("cw-native-header");
    }, []);
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { ref: anchor, hidden: true }),
      header && (0, import_react_dom3.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Dock, { sessionId, call, collapsed, open: (w) => toggleWorker(ctx.sidebarRight, currentView, sessionId, w), newChat: () => ctx.sidebarRight.openTab("codex-worker", { params: { workerId: "new" } }), resumeChat: () => ctx.sidebarRight.openTab("codex-worker", { params: { workerId: "resume" } }), closed: (w) => {
        if (currentView?.workerId === w.id && ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
      } }), header)
    ] });
  }
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({ name: "conversation.session.header.utilities", id: "codex-workers", order: 21 }, ({ sessionId }) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(HeaderDock, { sessionId }, sessionId)));
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: "codex-worker" }, ({ sessionId, useTabInfo }) => {
    const { tab, sidebar } = useTabInfo();
    const params = tab.navigation.params;
    const workerId = params && "workerId" in params ? params.workerId : void 0;
    (0, import_react6.useEffect)(() => {
      if (!workerId || !tab.visible) return;
      const view = { sessionId, workerId };
      currentView = view;
      changed();
      return () => {
        if (currentView === view) {
          currentView = void 0;
          changed();
        }
      };
    }, [sessionId, workerId, tab.visible]);
    if (!workerId || !tab.visible) return null;
    if (workerId === "resume") return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ResumeBrowser, { sessionId, call, open: (w) => ctx.sidebarRight.openTab("codex-worker", { params: { workerId: w.id } }) });
    if (workerId === "new") return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(NewConversation, { sessionId, call, open: (w) => ctx.sidebarRight.openTab("codex-worker", { params: { workerId: w.id } }) }, sessionId);
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ConversationPanel, { sessionId, workerId, call, fullscreen: sidebar.fullscreen, closeChat: () => ctx.sidebarRight.toggleExpanded(), newChat: () => ctx.sidebarRight.openTab("codex-worker", { params: { workerId: "new" } }) }, `${sessionId}/${workerId}`);
  }));
}
return module.exports; } });
