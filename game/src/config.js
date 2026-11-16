// config.js — every tunable number of the game in one place: teams, weapons,
// economy and round timings. Nothing here touches the DOM or three.js.

// Teams. The player always plays for the Breachers (the attacking side).
export const TEAMS = {
  atk: { id: 'atk', name: 'Breachers', color: 0xe8963c, css: '#e8963c' },
  def: { id: 'def', name: 'Wardens', color: 0x6f9fd8, css: '#6f9fd8' },
};
export const TEAM_SIZE = 5;

// Round and match timings (seconds).
export const TIMING = {
  buyPhase: 12,
  roundLive: 100,
  chargeTimer: 40,
  plantTime: 3.5,
  defuseTime: 5,
  roundEnd: 5,
  firstTo: 8, // round wins that take the match
};

// Economy (dollars). Round rewards land when the round ends.
export const ECONOMY = {
  startMoney: 800,
  maxMoney: 12000,
  killReward: 300,
  plantReward: 300, // paid to the planter at once
  winElimination: 2900,
  winObjective: 3200, // detonation for attackers, defuse for defenders
  winTimeout: 2900, // defenders, clock runs out with no plant
  lossBase: 1900,
  lossStep: 500, // extra per consecutive loss, capped
  lossCap: 3400,
};

// Weapon table. damage is per bullet (per pellet for the shotgun) at point
// blank; headMult multiplies a head hit before armour; falloff is in metres.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'pistol', price: 0, auto: false,
    rpm: 380, damage: 26, headMult: 3.2, mag: 12, reserve: 96, reload: 1.4,
    spread: 0.011, spreadMove: 0.028, spreadAir: 0.09, crouchMult: 0.7,
    falloff: 18, pellets: 1, kick: 0.011, weight: 1.0,
  },
  scatter: {
    id: 'scatter', name: 'Scattergun', slot: 'primary', price: 1100, auto: false,
    rpm: 68, damage: 11, headMult: 2.0, mag: 6, reserve: 32, reload: 2.6,
    spread: 0.055, spreadMove: 0.02, spreadAir: 0.05, crouchMult: 0.9,
    falloff: 8, pellets: 8, kick: 0.05, weight: 0.96,
  },
  raptor: {
    id: 'raptor', name: 'Raptor-9 SMG', slot: 'primary', price: 1400, auto: true,
    rpm: 780, damage: 22, headMult: 2.6, mag: 30, reserve: 120, reload: 1.9,
    spread: 0.02, spreadMove: 0.035, spreadAir: 0.1, crouchMult: 0.75,
    falloff: 12, pellets: 1, kick: 0.007, weight: 1.0,
  },
  meridian: {
    id: 'meridian', name: 'Meridian Rifle', slot: 'primary', price: 2700, auto: true,
    rpm: 640, damage: 33, headMult: 3.4, mag: 30, reserve: 120, reload: 2.2,
    spread: 0.013, spreadMove: 0.045, spreadAir: 0.12, crouchMult: 0.65,
    falloff: 30, pellets: 1, kick: 0.013, weight: 0.94,
  },
  needle: {
    id: 'needle', name: 'Needle DMR', slot: 'primary', price: 3300, auto: false,
    rpm: 240, damage: 55, headMult: 3.0, mag: 10, reserve: 50, reload: 2.4,
    spread: 0.004, spreadMove: 0.05, spreadAir: 0.12, crouchMult: 0.55,
    falloff: 45, pellets: 1, kick: 0.026, weight: 0.92,
  },
  farshot: {
    id: 'farshot', name: 'Farshot Long Rifle', slot: 'primary', price: 4500, auto: false,
    rpm: 42, damage: 105, headMult: 2.5, mag: 5, reserve: 25, reload: 3.0,
    spread: 0.0012, spreadMove: 0.09, spreadAir: 0.16, crouchMult: 0.5,
    falloff: 80, pellets: 1, kick: 0.06, weight: 0.88,
  },
};

// Gear bought from the same menu. Armour halves body damage while it lasts
// and soaks half of what it blocks; a helmet extends that cover to the head.
export const GEAR = {
  vest: { id: 'vest', name: 'Kevlar Vest', price: 650 },
  vestHelmet: { id: 'vestHelmet', name: 'Vest + Helmet', price: 1000 },
  frag: { id: 'frag', name: 'Shard Grenade', price: 300 },
  flash: { id: 'flash', name: 'Flash Charge', price: 200 },
  smoke: { id: 'smoke', name: 'Smoke Pot', price: 300 },
};
export const MAX_GRENADES = 3;

// Buy menu order: primaries first, then gear.
export const BUY_ORDER = ['scatter', 'raptor', 'meridian', 'needle', 'farshot'];

// Movement and actor dimensions (metres, seconds).
export const MOVE = {
  runSpeed: 5.0,
  crouchSpeed: 1.9,
  accel: 42,
  airAccel: 4,
  gravity: 18,
  jumpSpeed: 5.4,
  radius: 0.35,
  eyeStand: 1.62,
  eyeCrouch: 1.14,
  heightStand: 1.78,
  heightCrouch: 1.28,
};
