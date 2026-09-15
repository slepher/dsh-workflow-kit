import type { ModelOption } from "./model-catalog.js";

/**
 * The concrete effort one role route stores when its model changes.
 *
 * The settings schema and the execution inputs both name a real effort, so the
 * editor has no "provider default" sentinel it could persist: an empty string
 * would be rejected by the schema and could never reach a dispatch. A model
 * switch therefore keeps the current effort while the new model still
 * advertises it, and otherwise materializes the model's own default — or its
 * first advertised effort. A model that advertises no efforts keeps the stored
 * one, which stays valid instead of becoming an unpersistable empty value.
 * @param current - the effort the role currently stores.
 * @param target - the newly chosen model, when the catalog advertises it.
 * @returns an advertised effort id, or `current` when none is advertised.
 */
export function effortForModelChange(current: string, target: ModelOption | undefined): string {
  if (target === undefined || target.efforts.length === 0) return current;
  if (target.efforts.some(level => level.id === current)) return current;
  const preferred = target.efforts.find(level => level.id === target.defaultEffort) ?? target.efforts[0];
  return preferred.id;
}

/**
 * The effort menu's label for one stored value.
 *
 * The stored value is always a concrete effort, so an unadvertised one still
 * displays as its own id rather than as a nameless default.
 * @param current - the effort the role currently stores.
 * @param target - the model the role currently selects, when advertised.
 * @returns the advertised name, or the stored id when the catalog omits it.
 */
export function effortLabel(current: string, target: ModelOption | undefined): string {
  return target?.efforts.find(level => level.id === current)?.name ?? current;
}
