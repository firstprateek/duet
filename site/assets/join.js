import { copyButton } from "./copy.js";

// The join code rides after the # in the link, which browsers never send to a server. This page
// reads it, then takes it out of the address bar, so it doesn't linger in bookmarks or on a
// shared screen. It never sends the code anywhere.
const code = decodeURIComponent(location.hash.slice(1)).match(/DUET1-[A-Za-z0-9_-]+/)?.[0] ?? null;
if (location.hash) history.replaceState(null, "", location.pathname + location.search);

/** The Mac mini's address inside the code, to say where Duet will connect. */
function relayHost(text) {
  try {
    const b64 = text.slice("DUET1-".length).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new URL(JSON.parse(new TextDecoder().decode(bytes)).u).host;
  } catch {
    return null;
  }
}

const host = code ? relayHost(code) : null;
if (code && host) {
  for (const el of document.querySelectorAll("[data-host]")) el.textContent = host;
  document.querySelector("[data-open]").href = `duet://join#${code}`;
  copyButton(document.querySelector("[data-copy-code]"), () => code);
} else {
  document.querySelector('[data-state="code"]').hidden = true;
  document.querySelector('[data-state="missing"]').hidden = false;
}
for (const button of document.querySelectorAll("[data-copy]")) copyButton(button);
