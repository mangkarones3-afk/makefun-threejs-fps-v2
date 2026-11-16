# YARDLINE: SODIUM RAIN

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/mangkarones3-afk/makefun-threejs-fps-v2/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/mangkarones3-afk/makefun-threejs-fps-v2/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS built on three.js: five Breachers against five
Wardens in a rain-slick freight yard at night, lit by sodium floodlights.
Carry the breach charge to Site A (the Loading Dock) or Site B (the Tank
Farm), plant it and hold — or win by elimination. Rounds pay out, the buy
menu opens between them, and the first team to 8 rounds takes the yard.

Six weapons (sidearm, scattergun, SMG, rifle, DMR, long rifle), armour and
helmets, and frag / flash / smoke grenades. Accuracy is positional: spread
punishes movement and jumping, crouching steadies the cone, and headshots
pay up to 3.4×. The bots see through a field of view with line-of-sight and
smoke occlusion, hear gunfire, path a waypoint graph, and play their roles
— push, hold, roam, plant, defuse.

Everything is procedural: the textures are painted on canvases at boot,
the sounds are synthesised with WebAudio, and the game ships no image or
audio files.

## The feel pass

- **Trauma-based camera shake** — events add trauma; the offset is
  trauma² through summed sines at incommensurate rates, camera-only,
  decaying in real time even while hit-stop freezes the world.
- **Tiered feedback** — small / medium / large event bundles (trauma,
  hit-stop, burst particles) fired from one `feedback(tier, pos)` entry.
- **Hit-stop with overlap-safe restore** — monotonic request ids, the
  newest stop owns the restore point, no freeze longer than 0.15 s.
- **A graded finish** — a fullscreen shader pass: vignette, warm sodium
  grade, grain, damage vignette and flash white-out; fresnel rim light
  on the soldiers; fresnel puddles with lamp glints on the wet ground.
- **Density** — ejecting shell casings that bounce and settle, impact
  sparks with gravity and floor bounce, rain drips off the container
  eaves, shader rain wrapped around the camera.

## Run it

```
node serve.ts          # then open http://localhost:8080
node main.ts           # build the competition dossier into /output
```

## Layout

- `game/index.html` — the page and all HUD styling
- `game/src/` — the game modules: config, state, physics, map, textures,
  actors, bots, weapons, rounds, player, hud, audio, effects, feedback,
  shaders, postfx, shot, main
- `game/vendor/three/` — three.js 0.187.0, vendored
- `screenshots/` — staged renders (`game/src/shot.js` poses them)

---

<sub>Entered on [make.fun](https://make.fun/?ref=ram1fzcx&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
