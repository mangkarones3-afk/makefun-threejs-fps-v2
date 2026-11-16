// YARDLINE: SODIUM RAIN — entrypoint.
//
// The game is a static site living in game/ (ES modules, no build
// step). This program is the handover the scorer runs: it copies game/
// and screenshots/ into the output directory and writes a dossier.json
// there, built with the vendored make.fun library, so the dossier the
// scorer rebuilds from the same files matches this one byte for byte.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// To play the game instead:  node serve.ts  →  http://localhost:8080

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game tree goes over whole; the screenshots directory is created
// even when empty so the output shape never depends on the checkout.
mkdirSync(outDir, { recursive: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps are the competition gate's own: dossier text capped at
// 160 KiB, at most 4 screenshots of at most 256 KiB each, and game/
// held to 993 entries and 48 MiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
