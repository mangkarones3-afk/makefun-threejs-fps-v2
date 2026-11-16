// YARDLINE: SODIUM RAIN — a round-based tactical FPS on three.js. This
// program is the entry's handover: the game itself is the static site in
// game/ (ES modules, no build step), and this file copies game/ and
// screenshots/ into the output directory and writes dossier.json there
// with buildDossier from the vendored make.fun library, so the scorer can
// rebuild the same dossier from the same files and compare the two byte
// for byte.
//
// Run it locally the way the grader does, with another output directory:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game with:  node serve.ts   (then open http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own: the dossier text is capped at 160 KiB, at most
// 4 screenshots of at most 256 KiB each, and game/ at 993 entries / 48 MiB.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
