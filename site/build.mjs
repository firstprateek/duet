// Builds the website into _site/: the download page, the join page, install.sh, and the demo (the
// web build of the app, opening on Jack and Jill's year). GitHub Pages serves it at
// https://firstprateek.github.io/duet/.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "_site");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const entry of readdirSync(here)) {
  if (entry !== "build.mjs") cpSync(join(here, entry), join(out, entry), { recursive: true });
}

// The app's own tokens and fonts, so the site looks like Duet and asks nobody else for anything.
cpSync(join(root, "packages/ui/src/tokens.css"), join(out, "assets/tokens.css"));
const fontsource = join(root, "apps/desktop/node_modules/@fontsource");
for (const [family, weights] of [
  ["fredoka", [500, 600]],
  ["nunito", [400, 600, 700, 800]],
]) {
  for (const weight of weights) {
    const file = `${family}-latin-${weight}-normal.woff2`;
    cpSync(join(fontsource, family, "files", file), join(out, "assets/fonts", file));
  }
}

cpSync(join(root, "install.sh"), join(out, "install.sh"));

execFileSync(
  "pnpm",
  [
    "--filter",
    "@duet/desktop",
    "exec",
    "vite",
    "build",
    "--mode",
    "demo",
    "--outDir",
    join(out, "demo"),
    "--emptyOutDir",
  ],
  { cwd: root, stdio: "inherit" },
);
console.log(`The website is in ${out}`);
