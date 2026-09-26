import { css } from "lit";

/** A category's pastel, softened on dark backgrounds. Theme tokens pass through as they are. */
export function tint(color: string): string {
  return color.startsWith("#")
    ? `color-mix(in srgb, ${color} var(--du-tint), var(--du-card))`
    : color;
}

/** Shared styles every screen includes: type, cards, pills, buttons, keys. */
export const baseStyles = css`
  :host {
    font-family: var(--du-font-text);
    color: var(--du-ink);
  }
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
  }
  a {
    color: var(--du-link);
  }
  a:hover {
    color: var(--du-link-hover);
  }
  :focus-visible {
    outline: 3px solid color-mix(in srgb, var(--du-ours) 70%, transparent);
    outline-offset: 2px;
  }
  .display {
    font-family: var(--du-font-display);
  }
  h1,
  .h1 {
    margin: 0;
    font-family: var(--du-font-display);
    font-weight: 600;
    font-size: 30px;
    line-height: 1.15;
  }
  h2,
  .h2 {
    margin: 0;
    font-family: var(--du-font-display);
    font-weight: 500;
    font-size: 18px;
  }
  .muted {
    color: var(--du-muted);
  }
  .card {
    background: var(--du-card);
    border-radius: var(--du-radius-card);
    box-shadow: var(--du-shadow-card);
  }
  .money {
    font-family: var(--du-font-display);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 0;
    border-radius: 999px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    background: var(--du-ink);
    color: var(--du-on-ink);
    text-decoration: none;
    white-space: nowrap;
  }
  .btn:hover {
    color: var(--du-on-ink);
    filter: brightness(1.08);
  }
  .btn[disabled] {
    opacity: 0.45;
    cursor: default;
  }
  .btn.big {
    padding: 13px 24px;
    font-size: 15px;
  }
  .btn.small {
    padding: 7px 14px;
    font-size: 13px;
  }
  .btn.ours {
    background: var(--du-ours);
    color: #2b2536;
  }
  .btn.soft {
    background: var(--du-soft);
    color: var(--du-ink);
  }
  .btn.white {
    background: var(--du-card);
    color: var(--du-ink);
    box-shadow: var(--du-shadow-small);
  }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    font-size: 13.5px;
    font-weight: 800;
    color: var(--du-link);
    cursor: pointer;
  }
  .linkish.muted {
    color: var(--du-muted);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 800;
    white-space: nowrap;
    background: var(--du-soft);
    color: var(--du-ink-2);
  }
  .pill.good {
    background: var(--du-good-bg);
    color: var(--du-good-fg);
  }
  .pill.warn {
    background: var(--du-warn-bg);
    color: var(--du-warn-fg);
  }
  .pill.ours {
    background: var(--du-ours-bg);
    color: var(--du-ours-fg);
  }
  .pill.mine {
    background: var(--du-mine-bg);
    color: var(--du-mine-fg);
  }
  .pill.aside {
    background: var(--du-aside-bg);
    color: var(--du-aside-fg);
  }
  .pill.peach {
    background: var(--du-peach-bg);
    color: var(--du-ours-fg);
  }
  .toggle {
    border: 0;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    background: var(--du-soft);
    color: var(--du-ink);
  }
  .toggle[aria-pressed="true"] {
    background: var(--du-ink);
    color: var(--du-on-ink);
  }
  kbd {
    font-family: var(--du-font-display);
    font-size: 12px;
    color: var(--du-ink);
    background: var(--du-soft);
    border-radius: 8px;
    padding: 2px 8px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    font-weight: 800;
    color: var(--du-ink-2);
  }
  .input {
    font: inherit;
    font-weight: 600;
    font-size: 14px;
    color: var(--du-ink);
    background: var(--du-bg);
    border: 2px solid transparent;
    border-radius: 14px;
    padding: 10px 14px;
    outline: none;
  }
  .input:focus {
    border-color: var(--du-ours);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .dotted-top {
    border-top: 2px dotted var(--du-line);
  }
`;
