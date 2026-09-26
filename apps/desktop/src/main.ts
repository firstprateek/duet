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

  // The browser preview can open straight into sample data: ?sample
  if (
    platform.kind === "web" &&
    !basics.setUp &&
    new URLSearchParams(location.search).has("sample")
  ) {
    const { seedSampleHousehold } = await import("./demo/seed.ts");
    await seedSampleHousehold(store);
    await app.refresh();
  }

  const el = document.querySelector("duet-app") as DuetApp;
  el.app = app;
  el.hidden = false;
  platform.onJoinCode((code) => app.receiveJoinCode(code));
  void app.sync.start().then(() => app.sorting.check());
  (window as unknown as { duet: App }).duet = app;
}

start().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:32px;font:14px/1.5 system-ui;white-space:pre-wrap">Duet couldn't start.\n\n${
    error instanceof Error ? error.message : String(error)
  }</pre>`;
});
