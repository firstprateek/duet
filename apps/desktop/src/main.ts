import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@duet/ui/tokens.css";
import "@duet/ui";
import { Store } from "@duet/core";
import { App } from "./app/app.ts";
import "./app/shell.ts";
import type { DuetApp } from "./app/shell.ts";
import { createPlatform } from "./platform/index.ts";

async function start() {
  const platform = await createPlatform();
  const store = await Store.open(platform.db);
  const app = new App(store, platform);
  const basics = await app.refresh();

  // The browser preview can open straight into sample data (?sample); the demo always does.
  const demo = import.meta.env.MODE === "demo";
  if (
    platform.kind === "web" &&
    !basics.setUp &&
    (demo || new URLSearchParams(location.search).has("sample"))
  ) {
    const { seedSampleHousehold } = await import("./demo/seed.ts");
    await seedSampleHousehold(store);
    await app.refresh();
  }

  if (demo) showDemoNote();

  const el = document.querySelector("duet-app") as DuetApp;
  el.app = app;
  el.hidden = false;
  platform.onJoinCode((code) => app.receiveJoinCode(code));
  void app.sync.start().then(() => app.sorting.check());
  (window as unknown as { duet: App }).duet = app;
}

/** On the website: a small note that this is Jack and Jill's year, and where to get Duet. */
function showDemoNote() {
  const style = document.createElement("style");
  style.textContent = `
    .demo-note {
      position: fixed; z-index: 5; right: 16px; bottom: 16px;
      display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 16px;
      border-radius: 999px; background: var(--du-ink); color: var(--du-on-ink);
      font: 700 13px/1.2 var(--du-font-text); box-shadow: var(--du-shadow-sheet);
      white-space: nowrap;
    }
    .demo-note a {
      padding: 7px 14px; border-radius: 999px; background: #c24e1c; color: #fff;
      text-decoration: none;
    }
    .demo-note a:hover { filter: brightness(1.06); }
    .demo-note button {
      width: 28px; height: 28px; border: 0; border-radius: 50%; padding: 0;
      background: transparent; color: inherit; font: 600 18px/1 var(--du-font-text);
      cursor: pointer; opacity: 0.7;
    }
    .demo-note button:hover, .demo-note button:focus-visible { opacity: 1; }
    @media (max-width: 720px) { .demo-note span { display: none; } }
  `;
  const note = document.createElement("aside");
  note.className = "demo-note";
  note.setAttribute("aria-label", "About this demo");
  note.innerHTML = `<b>Demo</b><span>Jack and Jill's year. Changes stay in this tab.</span><a href="../">Get Duet</a><button type="button" aria-label="Hide this note">×</button>`;
  note.querySelector("button")?.addEventListener("click", () => note.remove());
  document.head.append(style);
  document.body.append(note);
  // Duet is a Mac app: on a phone, show the whole window zoomed out rather than half of it.
  if (matchMedia("(max-width: 1099px)").matches) {
    document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=1280");
  }
}

start().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:32px;font:14px/1.5 system-ui;white-space:pre-wrap">Duet couldn't start.\n\n${
    error instanceof Error ? error.message : String(error)
  }</pre>`;
});
