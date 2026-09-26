import { copyButton } from "./copy.js";

for (const button of document.querySelectorAll("[data-copy]")) copyButton(button);

// The latest release's version and download, straight from GitHub.
async function latest() {
  const res = await fetch("https://api.github.com/repos/firstprateek/duet/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return;
  const release = await res.json();
  const version = String(release.tag_name).replace(/^v/, "");
  const date = new Date(release.published_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  for (const el of document.querySelectorAll("[data-version]"))
    el.textContent = `Version ${version}`;
  for (const el of document.querySelectorAll("[data-version-long]")) {
    el.textContent = `The latest is ${version}, from ${date}.`;
  }
  const dmg = release.assets?.find((asset) => asset.name.endsWith(".dmg"));
  if (dmg)
    for (const el of document.querySelectorAll("[data-dmg]")) el.href = dmg.browser_download_url;
}
latest().catch(() => {});
