import { useEffect, useRef, useState } from "react";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ProfileAction, ProfileView } from "../profile-types.js";

export interface ProfileSelectorInjected {
  request(sessionId: string, action: ProfileAction, signal: AbortSignal, profileId?: string): Promise<ProfileView>;
}
type Props = PropsRuntime<"conversation.session.header.utilities"> & PropsLocale<"dsh-workflow-kit"> & InjectFace<ProfileSelectorInjected>;

export function ProfileSelector({ sessionId, useSession, request, t }: Props) {
  const unavailable = useSession(snapshot => snapshot.removed || snapshot.openState === "error");
  const [view, setView] = useState<ProfileView | null>(null);
  const [pending, setPending] = useState<ProfileAction | null>(null), [error, setError] = useState("");
  const current = useRef<{ controller: AbortController; action: ProfileAction } | null>(null);
  const load = (action: ProfileAction = "profiles", profileId?: string) => {
    if (unavailable) return;
    if (action === "profiles" && current.current?.action === "select-profile") return;
    current.current?.controller.abort();
    const operation = { controller: new AbortController(), action };
    current.current = operation; setPending(action); setError("");
    void request(sessionId, action, operation.controller.signal, profileId).then(value => {
      if (current.current === operation) setView(value);
    }).catch(reason => {
      if (!operation.controller.signal.aborted && current.current === operation) setError(String(reason));
    }).finally(() => { if (current.current === operation) { current.current = null; setPending(null); } });
  };
  useEffect(() => {
    setView(null); setPending(null); load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { current.current?.controller.abort(); current.current = null; window.removeEventListener("focus", onFocus); };
  }, [sessionId, request, unavailable]);
  const selected = view?.profiles.find(profile => profile.id === view.selectedProfile);
  return <div>
    <label>{t("title")} <select value={view?.selectedProfile ?? ""} disabled={unavailable || pending === "select-profile" || view === null || view.profiles.length === 0}
      onFocus={() => { if (pending === null) load(); }} onChange={event => { if (event.target.value) load("select-profile", event.target.value); }}>
      <option value="">{t("choose")}</option>
      {view?.selectedProfile && selected === undefined && <option value={view.selectedProfile}>{view.selectedProfile} ({t("unavailable")})</option>}
      {view?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.id}</option>)}
    </select></label>
    <button type="button" disabled={unavailable || pending !== null} onClick={() => load("reload-configuration")}>{t("refresh")}</button>
    <div>{t("future")}</div>
    {pending && <div role="status">{t(pending === "select-profile" ? "saving" : "loading")}</div>}
    {unavailable && <div role="status">{t("sessionUnavailable")}</div>}
    {error && <div role="alert">{error}</div>}
    {view?.profiles.length === 0 && <div role="status">{t("missing")}</div>}
    {view?.selectedProfile && selected === undefined && <div role="alert">{t("unavailable")}: {view.selectedProfile}</div>}
    {!!selected?.missingRequiredRoles.length && <div role="alert">{t("required")}: {selected.missingRequiredRoles.join(", ")}</div>}
    {!!view?.diagnostics.length && <ul>{view.diagnostics.map(item => <li key={item.file}>{item.file}: {item.error}</li>)}</ul>}
    {selected && <details><summary>{t("roles")}</summary><table><thead><tr><th>{t("role")}</th><th>{t("model")}</th><th>{t("effort")}</th></tr></thead>
      <tbody>{Object.entries(selected.roles).map(([role, value]) => <tr key={role}><td>{role}</td><td>{value.model}</td><td>{value.reasoningEffort}</td></tr>)}</tbody>
    </table></details>}
  </div>;
}
