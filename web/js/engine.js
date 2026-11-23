// Small engine layer that stands in for the parts of Ursina the game uses:
// box colliders + raycasts, invoke() timers, animate() tweens, pooled sounds,
// and a loader that fetches every model, texture and sound up front.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const ASSETS = 'assets/';
export const DEG = Math.PI / 180;
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const now = () => performance.now() / 1000;

// ------------------------------------------------------------------ colliders
// Boxes may be turned about the vertical axis only (yaw, three.js radians).
// Fields: x y z = centre, hx hy hz = half size, c s = cos/sin of yaw.
export function makeBox(x, y, z, hx, hy, hz, yaw = 0, extra = {}) {
  return Object.assign({ x, y, z, hx, hy, hz, c: Math.cos(yaw), s: Math.sin(yaw) }, extra);
}

export function setBoxYaw(b, yaw) {
  b.c = Math.cos(yaw);
  b.s = Math.sin(yaw);
}

const _o = [0, 0, 0], _d = [0, 0, 0], _h = [0, 0, 0];

function rayBox(b, ox, oy, oz, dx, dy, dz) {
  const px = ox - b.x, pz = oz - b.z;
  _o[0] = px * b.c - pz * b.s; _o[1] = oy - b.y; _o[2] = px * b.s + pz * b.c;
  _d[0] = dx * b.c - dz * b.s; _d[1] = dy; _d[2] = dx * b.s + dz * b.c;
  _h[0] = b.hx; _h[1] = b.hy; _h[2] = b.hz;
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const p = _o[i], d = _d[i], h = _h[i];
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return null;
      continue;
    }
    let t1 = (-h - p) / d, t2 = (h - p) / d, sg = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // A ray that starts inside a box ignores that box, so nothing can get stuck.
  if (tmin < 0 || axis < 0) return null;
  return { t: tmin, ny: axis === 1 ? sign : 0 };
}

/** Closest hit along a normalised direction among one or more box lists. */
export function raycast(lists, ox, oy, oz, dx, dy, dz, maxDist = Infinity) {
  let best = null;
  for (const list of lists) {
    for (const b of list) {
      if (b.off) continue;
      const r = rayBox(b, ox, oy, oz, dx, dy, dz);
      if (r && r.t <= maxDist && (!best || r.t < best.dist)) {
        best = { dist: r.t, box: b, ny: r.ny };
      }
    }
  }
  if (best) {
    best.x = ox + dx * best.dist;
    best.y = oy + dy * best.dist;
    best.z = oz + dz * best.dist;
  }
  return best;
}

// --------------------------------------------------------- timers and tweens
const timers = [];
const tweens = [];

export function invoke(fn, delay) {
  timers.push({ t: delay, fn });
}

export const curves = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

/** Tween obj[key] to a value. A new tween on the same obj/key replaces the old
 *  one (like Ursina's animate) unless keep is set. */
export function animate(obj, key, to, duration, { delay = 0, curve = curves.linear, keep = false } = {}) {
  if (!keep) {
    for (const tw of tweens) if (tw.obj === obj && tw.key === key) tw.dead = true;
  }
  tweens.push({ obj, key, to, duration: Math.max(duration, 1e-4), delay, curve, t: 0, from: null });
}

export function stopTweens(obj) {
  for (const tw of tweens) if (tw.obj === obj) tw.dead = true;
}

export function tick(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i];
    tm.t -= dt;
    if (tm.t <= 0) {
      timers.splice(i, 1);
      tm.fn();
    }
  }
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.dead) { tweens.splice(i, 1); continue; }
    if (tw.delay > 0) { tw.delay -= dt; continue; }
    if (tw.from === null) tw.from = tw.obj[tw.key];
    tw.t += dt;
    const k = Math.min(tw.t / tw.duration, 1);
    tw.obj[tw.key] = tw.from + (tw.to - tw.from) * tw.curve(k);
    if (k >= 1) tweens.splice(i, 1);
  }
}

// ---------------------------------------------------------------------- audio
const SOUND_FILES = [
  'ambience.ogg', 'blaster.ogg', 'blaster_repeater.ogg', 'coin.ogg', 'enemy_attack.ogg',
  'enemy_destroy.ogg', 'enemy_hurt.ogg', 'fall.ogg', 'jump_a.ogg', 'jump_b.ogg', 'jump_c.ogg',
  'land.ogg', 'walking.ogg', 'weapon_change.ogg', 'ui_back_001.wav', 'ui_click_001.wav',
  'ui_confirmation_001.wav', 'ui_confirmation_002.wav', 'ui_open_001.wav', 'ui_switch_002.wav',
  'ui_tick_001.wav',
];

export const Sound = {
  ctx: null,
  buffers: {},
  playing: {},
  loops: {},
  master: 1,

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) this.ctx = new Ctx();
    const resume = () => { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
  },

  /** One-shot; at most four copies of the same sound at once. */
  play(name, volume = 1, pitch = 1) {
    const buf = this.buffers[name];
    if (!this.ctx || !buf || this.ctx.state !== 'running') return;
    const live = (this.playing[name] ||= []);
    if (live.length >= 4) {
      try { live.shift().stop(); } catch (e) { /* already stopped */ }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const gain = this.ctx.createGain();
    gain.gain.value = volume * this.master;
    src.connect(gain).connect(this.ctx.destination);
    src.onended = () => {
      const i = live.indexOf(src);
      if (i >= 0) live.splice(i, 1);
    };
    live.push(src);
    src.start();
  },

  loop(name, on, volume = 1) {
    let l = this.loops[name];
    if (on) {
      if (!l) {
        const buf = this.buffers[name];
        if (!this.ctx || !buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = this.ctx.createGain();
        src.connect(gain).connect(this.ctx.destination);
        src.start();
        l = this.loops[name] = { src, gain, base: volume };
      }
      l.base = volume;
      l.gain.gain.value = volume * this.master;
    } else if (l) {
      try { l.src.stop(); } catch (e) { /* already stopped */ }
      delete this.loops[name];
    }
  },

  setMaster(v) {
    this.master = v;
    for (const l of Object.values(this.loops)) l.gain.gain.value = l.base * v;
  },
};

// --------------------------------------------------------------------- assets
export const MODEL_FILES = [
  'arena/banner.glb', 'arena/block.glb', 'arena/bricks.glb', 'arena/column-damaged.glb',
  'arena/column.glb', 'arena/floor-detail.glb', 'arena/floor.glb', 'arena/soldier-fixed.glb',
  'arena/statue.glb', 'arena/tree.glb', 'arena/trophy.glb', 'arena/wall-gate.glb',
  'arena/wall.glb', 'arena/weapon-rack.glb', 'arena/weapon-sword.glb',
  'city/building-garage.glb', 'city/building-small-a.glb', 'city/building-small-b.glb',
  'city/building-small-c.glb', 'city/building-small-d.glb', 'city/grass-trees-tall.glb',
  'city/grass-trees.glb', 'city/pavement-fountain.glb', 'city/pavement.glb',
  'city/road-corner.glb', 'city/road-straight-lightposts.glb', 'city/road-straight.glb',
  'fps/blaster-repeater.glb', 'fps/blaster.glb', 'fps/cloud.glb', 'fps/enemy-flying.glb',
  'fps/grass-small.glb', 'fps/grass.glb', 'fps/platform-large-grass.glb', 'fps/platform.glb',
  'fps/wall-high.glb', 'fps/wall-low.glb', 'platformer/coin.glb',
];
const TEXTURE_FILES = [
  'sprites/skybox.png', 'sprites/burst.png', 'sprites/particle.png', 'sprites/blob_shadow.png',
];

const models = {};     // rel -> { scene, animations, bounds: Box3 }
const textures = {};
const litCache = new Map();
const unlitCache = new Map();

function toMatte(src, lit) {
  const cache = lit ? litCache : unlitCache;
  if (!cache.has(src)) {
    const Mat = lit ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial;
    cache.set(src, new Mat({ map: src.map || null, color: src.color ? src.color.clone() : 0xffffff,
                             transparent: src.transparent, opacity: src.opacity, side: src.side }));
  }
  return cache.get(src);
}

function convertMaterials(root, lit) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => toMatte(m, lit))
        : toMatte(o.material, lit);
    }
  });
}

/** A fresh copy of a loaded model (geometry and materials are shared). */
export function model(rel, { lit = true } = {}) {
  const m = models[rel];
  const copy = m.skinned ? SkeletonUtils.clone(m.scene) : m.scene.clone(true);
  if (!lit) convertMaterials(copy, false);
  return copy;
}

export const modelInfo = (rel) => models[rel];
export const tex = (rel) => textures[rel];

export async function loadAll(onProgress) {
  const total = MODEL_FILES.length + TEXTURE_FILES.length + SOUND_FILES.length;
  let done = 0;
  const step = () => onProgress(++done / total);

  const gltf = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  const modelJobs = MODEL_FILES.map((rel) => gltf.loadAsync(ASSETS + rel).then((g) => {
    let skinned = false;
    g.scene.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    convertMaterials(g.scene, true);
    g.scene.updateMatrixWorld(true);
    models[rel] = { scene: g.scene, animations: g.animations, skinned,
                    bounds: new THREE.Box3().setFromObject(g.scene) };
    step();
  }));
  const texJobs = TEXTURE_FILES.map((rel) => texLoader.loadAsync(ASSETS + rel).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    textures[rel] = t;
    step();
  }));
  const soundJobs = SOUND_FILES.map((file) => fetch(ASSETS + 'sounds/' + file)
    .then((r) => r.arrayBuffer())
    .then((data) => (Sound.ctx ? new Promise((ok, fail) => Sound.ctx.decodeAudioData(data, ok, fail)) : null))
    .then((buf) => { if (buf) Sound.buffers[file.replace(/\.\w+$/, '')] = buf; })
    .catch(() => { /* a sound this browser cannot decode just stays silent */ })
    .finally(step));

  await Promise.all([...modelJobs, ...texJobs, ...soundJobs]);
}
