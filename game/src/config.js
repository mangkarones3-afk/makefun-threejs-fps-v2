// config.js — the numbers the whole game is tuned by: who fights, how
// long a round lasts, what the shop charges, how every gun behaves and
// how fast a body moves. Other modules read these tables and act.

export const TEAMS = {
  atk: { name: 'Breachers', color: 0xe8963c, css: '#e8963c' },
  def: { name: 'Wardens', color: 0x6f9fd8, css: '#6f9fd8' },
};
export const TEAM_SIZE = 5;

export const TIMING = {
  buyPhase: 12, roundLive: 100, chargeTimer: 40, plantTime: 3.5,
  defuseTime: 5, roundEnd: 5, firstTo: 8,
};

export const ECONOMY = {
  startMoney: 800, maxMoney: 12000, killReward: 300, plantReward: 300,
  winElimination: 2900, winObjective: 3200, winTimeout: 2900,
  lossBase: 1900, lossStep: 500, lossCap: 3400,
};

// spread is the resting cone (radians); spreadMove/spreadAir are the
// extra cone for firing at a run and mid-jump; crouchMult shrinks the
// cone while crouched; falloff is where damage starts to fade; kick is
// the recoil pitch per shot; weight scales the carrier's move speed.
export const WEAPONS = {
  p9: { name: 'P9 Sidearm', slot: 'pistol', price: 0, auto: false, rpm: 380, damage: 26, headMult: 3.2, pellets: 1, mag: 12, reserve: 96, reload: 1.4, spread: .011, spreadMove: .028, spreadAir: .09, crouchMult: .7, falloff: 18, kick: .011, weight: 1.0 },
  scatter: { name: 'Scattergun', slot: 'primary', price: 1100, auto: false, rpm: 68, damage: 11, headMult: 2.0, pellets: 8, mag: 6, reserve: 32, reload: 2.6, spread: .03, spreadMove: .05, spreadAir: .1, crouchMult: .85, falloff: 8, kick: .05, weight: .94 },
  raptor: { name: 'Raptor SMG', slot: 'primary', price: 1400, auto: true, rpm: 780, damage: 22, headMult: 2.6, pellets: 1, mag: 30, reserve: 120, reload: 1.9, spread: .017, spreadMove: .04, spreadAir: .1, crouchMult: .72, falloff: 12, kick: .008, weight: .97 },
  meridian: { name: 'Meridian Rifle', slot: 'primary', price: 2700, auto: true, rpm: 640, damage: 33, headMult: 3.4, pellets: 1, mag: 30, reserve: 120, reload: 2.2, spread: .013, spreadMove: .045, spreadAir: .12, crouchMult: .65, falloff: 30, kick: .013, weight: .93 },
  needle: { name: 'Needle DMR', slot: 'primary', price: 3300, auto: false, rpm: 240, damage: 55, headMult: 3.0, pellets: 1, mag: 10, reserve: 50, reload: 2.4, spread: .006, spreadMove: .05, spreadAir: .13, crouchMult: .6, falloff: 45, kick: .026, weight: .92 },
  farshot: { name: 'Farshot Long Rifle', slot: 'primary', price: 4500, auto: false, rpm: 42, damage: 105, headMult: 2.5, pellets: 1, mag: 5, reserve: 25, reload: 3.0, spread: .003, spreadMove: .06, spreadAir: .15, crouchMult: .55, falloff: 80, kick: .06, weight: .9 },
};

export const GEAR = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vestHelmet: { name: 'Vest + Helmet', price: 1000 },
  frag: { name: 'Shard Grenade', price: 300 },
  flash: { name: 'Flash Charge', price: 200 },
  smoke: { name: 'Smoke Pot', price: 300 },
};
export const MAX_GRENADES = 3;
export const BUY_ORDER = ['scatter', 'raptor', 'meridian', 'needle', 'farshot'];

export const MOVE = {
  runSpeed: 5.0, crouchSpeed: 1.9, accel: 42, airAccel: 4, gravity: 18,
  jumpSpeed: 5.4, radius: .35, eyeStand: 1.62, eyeCrouch: 1.14,
  heightStand: 1.78, heightCrouch: 1.28,
};
