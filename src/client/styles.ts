/**
 * Client CSS owned by this plugin.
 *
 * The client half is bundled by esbuild without a CSS pipeline, so the sheet is
 * injected once per document. Geometry and tokens mirror the native settings
 * rows, chips, and menu cards so this feature reads as part of the shell.
 */
const PLUGIN_CSS_ID = "dsh-workflow-kit";

const CSS = `
.wf-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 0 8px;
}
.wf-intro {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.wf-notice {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.wf-error {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-error);
}
.wf-configs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wf-config {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-module-platform);
}
.wf-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
}
.wf-picker-label {
  flex: none;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.wf-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-badges {
  display: inline-flex;
  gap: 6px;
}
.wf-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.wf-config-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 8px;
}
/* Text actions keep the row compact; every string is registrant-localized. */
.wf-action {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 14px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.wf-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.wf-action:disabled {
  cursor: default;
  color: var(--dsw-alias-label-quaternary);
}
.wf-role {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.wf-role:last-child {
  border-bottom: none;
}
.wf-role-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wf-role-name {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.wf-role-desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.wf-role-modified {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.wf-trigger {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  max-width: 320px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.wf-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.wf-trigger:disabled {
  cursor: default;
  color: var(--dsw-alias-label-tertiary);
}
.wf-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-trigger-value {
  color: var(--dsw-alias-label-tertiary);
}
/* The composer chip is denser than a settings control. */
.wf-chip {
  height: 32px;
  padding: 0 10px;
  border-radius: 16px;
  gap: 6px;
  font-size: 13px;
  background: transparent;
}
.wf-chip:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.wf-catalog-error {
  padding: 8px 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
/* The shell picks settings-nav glyphs from a closed list of built-in ids, so
   this plugin marks its own row and paints the branch glyph itself. */
[data-dsh-workflow-kit-settings-nav] > svg:first-child {
  display: none;
}
[data-dsh-workflow-kit-settings-nav]::before {
  content: '';
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='black' fill-rule='evenodd' clip-rule='evenodd' d='M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='black' fill-rule='evenodd' clip-rule='evenodd' d='M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z'/%3E%3C/svg%3E") center / contain no-repeat;
}
/* Grouped route menu: the composer's model-seat card, drawn by this plugin
   because the shared Menu primitive renders no headings inside a submenu. */
.wf-menu {
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
.wf-groups {
  min-height: 0;
  overflow-y: auto;
}
.wf-group + .wf-group {
  margin-top: 4px;
}
.wf-group-title {
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
.wf-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
  text-align: left;
}
.wf-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.wf-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-item-value {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.wf-item-chevron,
.wf-item-check {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary);
}
.wf-item-check {
  color: var(--dsw-alias-label-primary);
}
`;

/** Install the plugin stylesheet once per document. */
export function installClientStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${PLUGIN_CSS_ID}"]`) !== null) return;
  const tag = document.createElement("style");
  tag.setAttribute("data-plugin-css", PLUGIN_CSS_ID);
  tag.textContent = CSS;
  document.head.append(tag);
}
