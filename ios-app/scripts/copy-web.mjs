// Copies the web app (repo root) into ios-app/www so Capacitor can bundle it.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", ".."), www = join(here, "..", "www");
rmSync(www, { recursive: true, force: true }); mkdirSync(www);
for (const f of ["index.html", "manifest.webmanifest", "firebase-config.js", "fonts", "icons", "img", "models", "tarot", "vendor"]) {
  if (existsSync(join(root, f))) cpSync(join(root, f), join(www, f), { recursive: true });
}
console.log("web files copied to", www);
