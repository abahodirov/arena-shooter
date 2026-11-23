// ARENA SHOOTER - browser version (three.js). A port of fps_game.py.
// Same arenas, weapons, enemies, numbers and menus; see the README for differences.
import * as THREE from 'three';
import {
  ASSETS, DEG, clamp, lerp, rand, pick, now, makeBox, setBoxYaw, raycast, invoke, animate,
  curves, tick, Sound, model, modelInfo, tex, loadAll,
} from './engine.js';
import { level, decor, levelBoxes, clouds, MAPS, MAP_ORDER, buildMap } from './maps.js';

// ================================================================ settings
const SETTINGS_KEY = 'arena-shooter-settings';
const settings = { sensitivity: 40, volume: 0.8, fov: 90, fullscreen: false,
                   difficulty: 'NORMAL', map: 'colosseum', best: {} };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
} catch (e) { /* private window or blocked storage: defaults */ }

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

const DIFFICULTY = {          // enemy accuracy, damage per hit, health multiplier
  EASY: [0.25, 6, 0.8],
  NORMAL: [0.4, 9, 1.0],
  HARD: [0.55, 12, 1.3],
};
const WALK_SPEED = 6.5, SPRINT_SPEED = 10, CROUCH_SPEED = 3.2;
const EYE_HEIGHT = 2.0, CROUCH_HEIGHT = 1.25, JUMP_HEIGHT = 1.7;
const BOT_NAMES = ['Viper', 'Rook', 'Ghost', 'Brick', 'Mako', 'Flint', 'Onyx', 'Sable',
  'Kite', 'Rust', 'Dagger', 'Moss', 'Cobalt', 'Ember', 'Wren', 'Talon'];

const YELLOW = '#ffcc00', DARK = '#1d2433', RED = '#e5533d', GREEN = '#6fd35a';
const PANEL = 'rgba(18, 23, 36, 0.86)', LIGHT_GRAY = '#bfbfbf', GRAY = '#808080';

// ==================================================================== input
const held = new Set();             // KeyboardEvent.code values + 'mouse0' / 'mouse2'
const key = (code) => (held.has(code) ? 1 : 0);
const sprintHeld = () => held.has('ShiftLeft') || held.has('ShiftRight');
const crouchHeld = () => held.has('KeyC') || held.has('ControlLeft');

// ================================================================= renderer
const canvas = document.getElementById('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('load-text').textContent =
    'Your browser could not start WebGL, which this game needs. Try an up-to-date Chrome, Edge or Firefox, ' +
    'or download the Windows version.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
camera.rotation.order = 'YXZ';
scene.add(level, decor, camera);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a497, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(0.45, 1, 0.3);
scene.add(sun);

let camFov = settings.fov;          // horizontal field of view, like Ursina/Panda3D
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
}
window.addEventListener('resize', resize);
resize();

// ====================================================================== UI
const stage = document.getElementById('stage');
const uiRoot = document.getElementById('ui');
const u = (v) => `calc(var(--u) * ${v})`;

function div(parent, cls = '', html = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (html) d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

function layer(parent = stage) {
  const d = div(parent, 'layer');
  d.hidden = true;
  return d;
}

/** Text placed like Ursina's Text: position is the corner/centre given by origin. */
function text(parent, str, x, y, scale = 1, { origin = [-0.5, 0.5], color = '#fff', lineHeight = 1 } = {}) {
  const d = div(parent, 'abs txt');
  d.textContent = str;
  d.style.left = `calc(50% + var(--u) * ${x})`;
  d.style.top = `calc(50% - var(--u) * ${y})`;
  d.style.transform = `translate(${-(origin[0] + 0.5) * 100}%, ${(origin[1] - 0.5) * 100}%)`;
  d.style.fontSize = u(0.027 * scale);
  d.style.lineHeight = String(1.05 * lineHeight);
  d.style.color = color;
  if (origin[0] > 0) d.style.textAlign = 'right';
  if (origin[0] === 0) d.style.textAlign = 'center';
  return d;
}

function setText(el, s) {
  if (el._t !== s) { el._t = s; el.textContent = s; }
}

/** A rectangle with Ursina quad semantics: (x, y) is where its origin sits. */
function quad(parent, x, y, w, h, color, origin = [0, 0]) {
  const d = div(parent, 'abs');
  d.style.left = `calc(50% + var(--u) * ${x - w * (0.5 + origin[0])})`;
  d.style.top = `calc(50% - var(--u) * ${y + h * (0.5 - origin[1])})`;
  d.style.width = u(w);
  d.style.height = u(h);
  d.style.background = color;
  return d;
}

const BUTTON_TEX = { blue: 'blue', yellow: 'yellow', green: 'green', red: 'red', grey: 'grey' };
const buttonImage = (style) => `url('${ASSETS}ui/${BUTTON_TEX[style]}_button00.png')`;

class MenuButton {
  /** A Kenney UI-pack button that turns yellow on hover. */
  constructor(parent, label, x, y, action, style = 'blue', width = 0.34, height = 0.088) {
    const el = (this.el = div(parent, 'btn'));
    this.label = div(el, '');
    this.label.textContent = label;
    el.style.left = `calc(50% + var(--u) * ${x - width / 2})`;
    el.style.top = `calc(50% - var(--u) * ${y + height / 2})`;
    el.style.width = u(width);
    el.style.height = u(height);
    el.style.paddingBottom = u(height * 0.12);
    this.action = action;
    this.setStyle(style);
    el.addEventListener('mouseenter', () => {
      this.hover = true;
      this.paint();
      Sound.play('ui_tick_001', 0.35);
    });
    el.addEventListener('mouseleave', () => { this.hover = false; this.paint(); });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      Sound.play('ui_click_001', 0.7);
      this.action();
    });
  }

  setStyle(style) { this.style = style; this.paint(); }

  setText(label) { this.label.textContent = label; }

  paint() {
    const style = this.hover ? 'yellow' : this.style;
    this.el.style.backgroundImage = buttonImage(style);
    this.el.classList.toggle('dark', style === 'yellow' || style === 'grey');
  }
}

/** A link styled as a menu button (opens in a new tab). */
function linkButton(parent, label, x, y, href, style = 'grey', width = 0.34, height = 0.088) {
  const b = new MenuButton(parent, label, x, y, () => window.open(href, '_blank', 'noopener'), style, width, height);
  return b;
}

// =================================================================== world
// Sky dome: the gradient runs from the horizon (bottom of skybox.png) up to 60 degrees,
// and the top colour fills the rest, which is how the desktop sky reads on screen.
const skyGeo = new THREE.SphereGeometry(1500, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
{
  const pos = skyGeo.attributes.position, uv = skyGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const elevation = Math.asin(clamp(pos.getY(i) / 1500, 0, 1)) / DEG;
    uv.setY(i, clamp(elevation / 60, 0.004, 0.996));
  }
}
const sky = new THREE.Mesh(skyGeo,
  new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, fog: false }));
sky.renderOrder = -1;
scene.add(sky);
const SKY_BOTTOM = new THREE.Color('#5ea0ff');

let current = {};                   // info about the loaded map

function loadMap(key) {
  current = buildMap(key);
  const tint = new THREE.Color(current.sky);
  sky.material.color.copy(tint);
  scene.background = SKY_BOTTOM.clone().multiply(tint);
  Sound.loop('ambience', Boolean(current.ambience), 0.5);
}

// ================================================================== player
const player = {
  pos: new THREE.Vector3(0, 1, 0),
  yaw: 0,             // degrees, clockwise from above (Ursina rotation_y)
  pitch: 0,           // degrees, positive looks down (Ursina camera_pivot.rotation_x)
  pivotY: EYE_HEIGHT,
  speed: WALK_SPEED,
  grounded: false,
  airTime: 0,
  jumping: false,
  jumpT: 0,
  jumpY0: 0,
};
const _dir = new THREE.Vector3();

function playerForward(out) {
  const y = player.yaw * DEG;
  return out.set(Math.sin(y), 0, -Math.cos(y));
}

function playerPhysics(dt) {
  const lists = [levelBoxes, enemyBoxes];
  const p = player.pos;
  const y = player.yaw * DEG;
  const fw = key('KeyW') - key('KeyS'), rt = key('KeyD') - key('KeyA');
  _dir.set(Math.sin(y) * fw + Math.cos(y) * rt, 0, -Math.cos(y) * fw + Math.sin(y) * rt);
  if (_dir.lengthSq() > 0) {
    _dir.normalize();
    const feet = raycast(lists, p.x, p.y + 0.5, p.z, _dir.x, 0, _dir.z, 0.5);
    const head = raycast(lists, p.x, p.y + 1.9, p.z, _dir.x, 0, _dir.z, 0.5);
    if (!feet && !head) {
      let mx = _dir.x * dt * player.speed, mz = _dir.z * dt * player.speed;
      if (raycast(lists, p.x, p.y + 1, p.z, 1, 0, 0, 0.5)) mx = Math.min(mx, 0);
      if (raycast(lists, p.x, p.y + 1, p.z, -1, 0, 0, 0.5)) mx = Math.max(mx, 0);
      if (raycast(lists, p.x, p.y + 1, p.z, 0, 0, 1, 0.5)) mz = Math.min(mz, 0);
      if (raycast(lists, p.x, p.y + 1, p.z, 0, 0, -1, 0.5)) mz = Math.max(mz, 0);
      p.x += mx;
      p.z += mz;
    }
  }

  if (player.jumping) {                         // fast rise, cut short after 0.35 s
    player.jumpT += dt;
    player.airTime += dt * 0.25;
    p.y = player.jumpY0 + JUMP_HEIGHT * curves.outExpo(Math.min(player.jumpT / 0.5, 1));
    if (player.jumpT >= 0.35) player.jumping = false;
    return;
  }
  const ray = raycast(lists, p.x, p.y + 2, p.z, 0, -1, 0);
  const dist = ray ? ray.dist : Infinity;
  if (dist <= 2.1) {
    if (!player.grounded) player.airTime = 0;
    player.grounded = true;
    if (ray.ny > 0.7 && ray.y - p.y < 0.5) p.y = ray.y;     // step up small ledges
    return;
  }
  player.grounded = false;
  p.y -= Math.min(player.airTime, dist - 0.05) * dt * 100;
  player.airTime += dt * 0.25;
}

function jump() {
  if (!player.grounded) return;
  player.grounded = false;
  player.jumping = true;
  player.jumpT = 0;
  player.jumpY0 = player.pos.y;
  Sound.play(pick(['jump_a', 'jump_b', 'jump_c']), 0.5);
}

function syncCamera() {
  camera.position.set(player.pos.x, player.pos.y + player.pivotY, player.pos.z);
  camera.rotation.set(-player.pitch * DEG, -player.yaw * DEG, 0);
}

// ================================================================= weapons
const WEAPONS = [
  { name: 'BLASTER', model: 'fps/blaster.glb', auto: false, rate: 0.2, damage: 40, mag: 12,
    reserve: null, reload: 1.1, spread: 0.0015, bloom: 0.004, kick: 1.3, sound: 'blaster',
    cross: 'sprites/crosshair.png', pos: [0.2, -0.3, 0.55], scale: 0.2 },
  { name: 'REPEATER', model: 'fps/blaster-repeater.glb', auto: true, rate: 0.085, damage: 21,
    mag: 40, reserve: 160, reload: 1.9, spread: 0.003, bloom: 0.0045, kick: 0.5,
    sound: 'blaster_repeater', cross: 'sprites/crosshair-repeater.png', pos: [0.2, -0.3, 0.6], scale: 0.2 },
  { name: 'SWORD', model: 'arena/weapon-sword.glb', melee: true, rate: 0.5, damage: 120,
    reach: 3.4, sound: 'jump_b', cross: 'sprites/crosshair.png', pos: [0.3, -0.34, 0.7], scale: 1.3,
    rot: [15, 0, 172] },
];
const holder = new THREE.Group();
camera.add(holder);
const hold = { x: 0, y: 0, z: 0, rx: 0 };       // tweened, in Ursina units/degrees
const swordRot = { x: 15 };

let muzzle, muzzleFlash;

function buildWeapons() {
  for (const w of WEAPONS) {
    const obj = model(w.model);
    obj.position.set(w.pos[0], w.pos[1], -w.pos[2]);
    obj.scale.setScalar(w.scale);
    if (w.rot) obj.rotation.set(-w.rot[0] * DEG, -w.rot[1] * DEG, w.rot[2] * DEG, 'YXZ');
    else obj.rotation.y = Math.PI;
    obj.visible = false;
    holder.add(obj);
    w.obj = obj;
  }
  muzzle = new THREE.Group();
  muzzle.position.set(0.2, -0.2, -0.95);
  holder.add(muzzle);
  const flashTex = tex('sprites/burst.png').clone();
  flashTex.repeat.set(0.5, 1);
  flashTex.offset.set(0.5, 0);
  flashTex.needsUpdate = true;
  muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: flashTex, color: '#ffe9a0', transparent: true, depthWrite: false }));
  muzzleFlash.scale.setScalar(0.3);
  muzzleFlash.visible = false;
  muzzle.add(muzzleFlash);
}

// ===================================================================== HUD
const hud = layer();
const crosshair = div(hud, 'abs');
crosshair.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);background-size:100% 100%;';
const hitmarker = div(hud, 'abs hit');
hitmarker.style.cssText += `left:50%;top:50%;transform:translate(-50%,-50%);width:${u(0.07)};height:${u(0.07)};`;
hitmarker.hidden = true;

quad(hud, -0.70, -0.42, 0.34, 0.1, PANEL);
text(hud, 'HEALTH', -0.855, -0.38, 0.8, { color: YELLOW });
const hpText = text(hud, '100', -0.855, -0.405, 2.0);
quad(hud, -0.75, -0.43, 0.19, 0.016, 'rgba(255,255,255,0.15)', [-0.5, 0]);
const hpBar = quad(hud, -0.75, -0.43, 0.19, 0.016, GREEN, [-0.5, 0]);
hpBar.style.transformOrigin = 'left center';

quad(hud, 0.70, -0.42, 0.34, 0.1, PANEL);
const weaponText = text(hud, '', 0.545, -0.38, 0.8, { color: YELLOW });
const ammoText = text(hud, '', 0.545, -0.405, 2.0);
const reserveText = text(hud, '', 0.66, -0.42, 1.1, { color: LIGHT_GRAY });
const slotTexts = WEAPONS.map((w, i) => text(hud, String(i + 1), 0.78 + i * 0.03, -0.39, 0.9, { origin: [0, 0] }));

quad(hud, 0, 0.462, 0.42, 0.055, PANEL);
const topText = text(hud, '', 0, 0.462, 1.05, { origin: [0, 0] });
const scoreText = text(hud, '', 0.86, 0.485, 1.2, { origin: [0.5, 0.5], color: YELLOW });
const centerText = text(hud, '', 0, 0.26, 2.6, { origin: [0, 0] });
const subText = text(hud, '', 0, 0.19, 1.2, { origin: [0, 0], color: YELLOW });
const lockHint = text(hud, 'CLICK TO PLAY', 0, 0.08, 1.4, { origin: [0, 0], color: YELLOW });
lockHint.hidden = true;

const damageFlash = div(uiRoot, 'shade');
damageFlash.style.background = '#ff0000';
damageFlash.style.opacity = '0';
uiRoot.insertBefore(damageFlash, stage);
const flash = { a: 0 };

// radar
const RADAR_R = 0.085, RADAR_RANGE = 34;
const radar = quad(hud, -0.77, 0.37, RADAR_R * 2.15, RADAR_R * 2.15, 'rgba(13,18,26,0.75)');
radar.style.borderRadius = '50%';
const radarCentre = div(radar, 'dot');
radarCentre.style.cssText += `left:50%;top:50%;width:${u(0.012)};height:${u(0.012)};background:#fff;`;
const radarDots = [];
for (let i = 0; i < 16; i++) {
  const d = div(radar, 'dot');
  d.style.width = d.style.height = u(0.014);
  d.hidden = true;
  radarDots.push(d);
}

// scoreboard (hold Tab)
const scoreboard = layer();
quad(scoreboard, 0, 0, 0.62, 0.42, PANEL);
quad(scoreboard, 0, 0.21, 0.62, 0.008, YELLOW);
text(scoreboard, 'SCOREBOARD', 0, 0.165, 1.6, { origin: [0, 0], color: YELLOW });
const STAT_LABELS = 'Map\nWave\nScore\nEliminations\nHeadshots\nAccuracy\nBest score';
text(scoreboard, STAT_LABELS, -0.26, 0.11, 1.15, { lineHeight: 1.45 });
const boardRight = text(scoreboard, '', 0.06, 0.11, 1.15, { lineHeight: 1.45, color: LIGHT_GRAY });

const feedLines = [];

function feed(message, color = '#fff') {
  const line = text(hud, message, 0.86, 0.43, 0.95, { origin: [0.5, 0.5], color });
  feedLines.push(line);
  if (feedLines.length > 5) feedLines.shift().remove();
  layoutFeed();
  invoke(() => dropFeed(line), 4.5);
}

function dropFeed(line) {
  const i = feedLines.indexOf(line);
  if (i >= 0) {
    feedLines.splice(i, 1);
    line.remove();
    layoutFeed();
  }
}

function layoutFeed() {
  feedLines.slice().reverse().forEach((line, i) => {
    line.style.top = `calc(50% - var(--u) * ${0.43 - i * 0.034})`;
  });
}

// ================================================================= effects
const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
const basicMats = {};
const basicMat = (color) => (basicMats[color] ||= new THREE.MeshBasicMaterial({ color }));
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function tracer(a, b, color, width = 0.012) {
  const length = a.distanceTo(b);
  if (length < 0.5) return;
  const t = new THREE.Mesh(tracerGeo, basicMat(color));
  t.position.copy(a).add(b).multiplyScalar(0.5);
  t.scale.set(width, width, length);
  t.lookAt(b);
  scene.add(t);
  invoke(() => scene.remove(t), 0.05);
}

const particles = [];
const spriteMats = {};

function puff(point, color, count = 1, size = 0.5, spread = 0) {
  const mat = (spriteMats[color] ||= new THREE.SpriteMaterial({
    map: tex('sprites/particle.png'), color, transparent: true, depthWrite: false }));
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(mat);
    const p = { sprite: s, size: size * rand(0.6, 1.1), t: 0, from: point.clone(), to: point.clone() };
    if (spread) p.to.add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).multiplyScalar(spread));
    s.position.copy(point);
    s.scale.setScalar(p.size);
    scene.add(s);
    particles.push(p);
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    const k = Math.min(p.t / 0.35, 1);
    p.sprite.position.lerpVectors(p.from, p.to, curves.outQuad(k));
    p.sprite.scale.setScalar(Math.max(p.size * (1 - k), 1e-4));
    if (p.t >= 0.4) {
      scene.remove(p.sprite);
      particles.splice(i, 1);
    }
  }
}

let shadowGeo, shadowMats = {};

function blobShadow(parent, y, scale, opacity) {
  shadowGeo ||= new THREE.PlaneGeometry(1, 1);
  const mat = (shadowMats[opacity] ||= new THREE.MeshBasicMaterial({
    map: tex('sprites/blob_shadow.png'), transparent: true, opacity, depthWrite: false }));
  const m = new THREE.Mesh(shadowGeo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.scale.setScalar(scale);
  parent.add(m);
  return m;
}

// ================================================================= enemies
let enemyBoxes = [];
const barMat = new THREE.SpriteMaterial({ color: RED, depthWrite: false });
const _eye = new THREE.Vector3(), _aim = new THREE.Vector3(), _camPos = new THREE.Vector3();

class Enemy {
  constructor(position) {
    this.obj = new THREE.Group();
    this.obj.position.copy(position);
    this.position = this.obj.position;
    this.boxes = [];
    scene.add(this.obj);
  }

  setup(wave, hp) {
    const [acc, dmg, hpMult] = DIFFICULTY[settings.difficulty];
    this.nameTag = pick(BOT_NAMES);
    this.maxHp = this.hp = Math.trunc((hp + wave * 5) * hpMult);
    this.accuracy = acc;
    this.damage = dmg;
    this.keepRange = rand(8, 16);
    this.fireCd = rand(0.9, 1.7);
    this.seeCd = rand(0, 0.2);
    this.sees = false;
    this.dead = false;
    this.bar = new THREE.Sprite(barMat);
    this.bar.scale.set(0.9, 0.07, 1);
    this.bar.visible = false;
    this.obj.add(this.bar);
  }

  addBox(lx, ly, lz, sx, sy, sz, extra = {}) {
    const b = makeBox(0, 0, 0, sx / 2, sy / 2, sz / 2, 0, Object.assign({ owner: this, lx, ly, lz }, extra));
    this.boxes.push(b);
    return b;
  }

  syncBoxes() {
    const yaw = this.obj.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw), p = this.position;
    for (const b of this.boxes) {
      b.x = p.x + b.lx * c + b.lz * s;
      b.y = p.y + b.ly;
      b.z = p.z - b.lx * s + b.lz * c;
      setBoxYaw(b, yaw);
    }
  }

  face(d) {
    this.obj.rotation.y = Math.atan2(d.x, d.z);
  }

  lookForPlayer(eye, dt) {
    this.seeCd -= dt;
    if (this.seeCd > 0) return;
    this.seeCd = 0.2;
    camera.getWorldPosition(_camPos);
    _aim.set(_camPos.x - eye.x, _camPos.y - 0.3 - eye.y, _camPos.z - eye.z);
    const len = _aim.length();
    const saw = this.sees;
    _aim.divideScalar(len || 1);
    this.sees = !raycast([levelBoxes], eye.x, eye.y, eye.z, _aim.x, _aim.y, _aim.z, len);
    if (this.sees && !saw) this.fireCd = Math.max(this.fireCd, rand(0.45, 0.8));   // reaction time
  }

  fire(start, dist) {
    this.fireCd = rand(0.6, 1.25);
    Sound.play('enemy_attack', clamp(1.2 - dist / 40, 0.15, 0.8), rand(0.9, 1.1));
    camera.getWorldPosition(_camPos);
    const target = _camPos.clone();
    target.y -= 0.3;
    let chance = this.accuracy * clamp(1.3 - dist / 30, 0.3, 1);
    if (sprintHeld() && game.moving) chance *= 0.75;
    if (crouchHeld()) chance *= 0.8;
    const col = '#ff9d5c';
    const toT = target.clone().sub(start).normalize();
    if (Math.random() < chance) {
      tracer(start, target.clone().addScaledVector(toT, -1.5), col);
      game.damagePlayer(this.damage);
    } else {
      const side = new THREE.Vector3(-toT.z, 0, toT.x).normalize();
      const miss = target.clone().addScaledVector(side, pick([-1, 1]) * rand(0.7, 1.6));
      tracer(start, start.clone().addScaledVector(miss.sub(start).normalize(), dist + 6), col);
    }
  }

  takeDamage(amount, headshot = false) {
    if (this.dead) return;
    this.hp -= amount;
    this.bar.visible = true;
    this.bar.scale.x = Math.max(0.9 * Math.max(this.hp / this.maxHp, 0), 1e-4);
    this.sees = true;
    this.fireCd = Math.min(this.fireCd, 0.5);
    if (this.hp <= 0) {
      this.dead = true;
      this.bar.visible = false;
      this.die();
      game.enemyKilled(this, headshot);
    } else {
      Sound.play('enemy_hurt', 0.5, rand(0.9, 1.15));
    }
  }

  keepInside() {
    const limit = current.half - 1.5;
    this.position.x = clamp(this.position.x, -limit, limit);
    this.position.z = clamp(this.position.z, -limit, limit);
  }

  remove() {
    this.removed = true;
    scene.remove(this.obj);
  }
}

function toPlayer(e) {
  const d = new THREE.Vector3(player.pos.x - e.position.x, 0, player.pos.z - e.position.z);
  const dist = d.length();
  if (dist > 0.01) d.divideScalar(dist);
  else d.set(0, 0, 1);
  return [d, dist];
}

const GUN_OFFSET = new THREE.Vector3(0.05, -0.3, 0.3);   // from the shoulder, soldier space
const BARREL_FORWARD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

class Soldier extends Enemy {
  /** Kenney's animated Mini Arena character, armed with a blaster. */
  constructor(position, wave) {
    super(position);
    this.points = 100;
    this.setup(wave, 85);
    this.speed = Math.min(3.0 + wave * 0.2, 5.2) * rand(0.9, 1.1);
    this.detour = new THREE.Vector3();
    this.detourT = 0;
    this.anim = '';
    this.body = model('arena/soldier-fixed.glb');
    this.body.scale.setScalar(2.3);
    this.obj.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.play('holding-right');
    this.attachGun();
    blobShadow(this.obj, 0.04, 2.2, 0.7);
    this.addBox(0, 0.5, 0, 1.2, 1.0, 0.9);
    this.addBox(0, 1.45, 0, 1.15, 0.95, 1.0, { head: true });
    this.bar.position.y = 2.35;
    this.syncBoxes();
  }

  attachGun() {
    // Pose the arm, then orient the gun in the hand so it points where the soldier faces.
    const hand = this.body.getObjectByName('arm-right');
    if (!hand) return;
    this.mixer.update(0);
    this.obj.updateMatrixWorld(true);
    const qHand = hand.getWorldQuaternion(new THREE.Quaternion());
    const qBody = this.obj.getWorldQuaternion(new THREE.Quaternion());
    const toHand = qHand.clone().invert();
    const gun = model('fps/blaster.glb');
    gun.scale.setScalar(0.26);
    gun.quaternion.copy(toHand).multiply(qBody).multiply(BARREL_FORWARD);   // barrel runs along -x
    gun.position.copy(GUN_OFFSET).applyQuaternion(qBody).applyQuaternion(toHand).divideScalar(2.3);
    hand.add(gun);
  }

  startClip(name, loop) {
    const clip = THREE.AnimationClip.findByName(modelInfo('arena/soldier-fixed.glb').animations, name);
    if (!clip) return;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.play();
    this.action = action;
  }

  play(name, loop = true) {
    if (name !== this.anim) {
      this.anim = name;
      this.startClip(name, loop);
    }
  }

  update(dt) {
    this.mixer.update(dt);
    if (this.dead || game.state !== 'playing') return;
    const [d, dist] = toPlayer(this);
    this.face(d);
    this.lookForPlayer(_eye.copy(this.position).setY(this.position.y + 1.6), dt);

    let moving = false;
    if (!this.sees || dist > this.keepRange) moving = this.walk(d, dt);
    if (this.sees && dist < 48) {
      this.fireCd -= dt;
      if (this.fireCd <= 0) {
        const start = this.position.clone().addScaledVector(d, 0.9);
        start.y += 1.0;
        this.fire(start, dist);
        this.anim = '';
        this.startClip('holding-right-shoot', false);
      }
    }
    if (moving) this.play('walk');
    else if (!this.action || !this.action.isRunning()) this.play('holding-right');
    this.keepInside();
    this.syncBoxes();
  }

  walk(d, dt) {
    /** Walk toward the player; when blocked, side-step along the obstacle. */
    const ox = this.position.x, oy = this.position.y + 0.6, oz = this.position.z;
    this.detourT -= dt;
    const options = this.detourT > 0 ? [this.detour, d] : [d];
    const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(pick([-1, 1]));
    options.push(side, side.clone().negate());
    for (const dir of options) {
      if (!raycast([levelBoxes], ox, oy, oz, dir.x, dir.y, dir.z, 1.1)) {
        if (dir !== d && this.detourT <= 0) {
          this.detour = dir.clone();
          this.detourT = 0.9;
        }
        this.position.addScaledVector(dir, this.speed * dt);
        return true;
      }
    }
    return false;
  }

  die() {
    for (const b of this.boxes) b.off = true;
    this.anim = 'die';
    this.startClip('die', false);
    Sound.play('enemy_destroy', 0.7);
    invoke(() => this.remove(), 2.2);
  }
}

class Drone extends Enemy {
  /** Kenney's flying enemy from the FPS starter kit. */
  constructor(position, wave) {
    super(position.clone().setY(position.y + rand(3.5, 6)));
    this.points = 75;
    this.setup(wave, 45);
    this.speed = rand(3.5, 5.0);
    this.hover = this.position.y;
    this.phase = rand(0, 6);
    this.strafe = pick([-1, 1]);
    this.body = model('fps/enemy-flying.glb');
    this.body.scale.setScalar(1.6);
    this.body.position.y = -0.5;
    this.obj.add(this.body);
    this.addBox(0, 0.2, 0, 1.9, 1.5, 1.3);
    this.bar.position.y = 1.3;
    this.syncBoxes();
  }

  update(dt) {
    if (game.state !== 'playing') return;
    if (this.dead) {
      this.position.y -= 9 * dt;
      this.obj.rotation.z += 400 * DEG * dt;
      return;
    }
    const [d, dist] = toPlayer(this);
    this.face(d);
    this.lookForPlayer(this.position, dt);

    const move = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(this.strafe * 0.5);
    if (!this.sees || dist > this.keepRange) move.add(d);
    else if (dist < this.keepRange - 4) move.sub(d);
    const n = move.clone().normalize();
    if (raycast([levelBoxes], this.position.x, this.position.y, this.position.z, n.x, n.y, n.z, 2)) {
      this.hover = Math.min(this.hover + 6 * dt, 13);          // climb over obstacles
      this.strafe *= -1;
    } else {
      this.position.addScaledVector(move, this.speed * dt);
      this.hover = Math.max(this.hover - 0.4 * dt, 3.5);
    }
    this.phase += dt * 2.5;
    this.position.y = lerp(this.position.y, this.hover + Math.sin(this.phase) * 0.35, Math.min(1, dt * 3));
    if (this.sees && dist < 48) {
      this.fireCd -= dt;
      if (this.fireCd <= 0) this.fire(this.position.clone().addScaledVector(d, 0.9), dist);
    }
    this.keepInside();
    this.syncBoxes();
  }

  die() {
    for (const b of this.boxes) b.off = true;
    puff(this.position, '#ffb347', 7, 0.9, 2.0);
    Sound.play('enemy_destroy', 0.8, 1.2);
    invoke(() => this.remove(), 0.8);
  }
}

class Pickup {
  constructor(position, kind) {
    this.kind = kind;
    this.obj = new THREE.Group();
    this.obj.position.set(position.x, 0.9, position.z);
    const [rel, scale] = kind === 'coin' ? ['platformer/coin.glb', 1.6] : ['fps/blaster-repeater.glb', 0.55];
    const m = model(rel);
    m.scale.setScalar(scale);
    this.obj.add(m);
    blobShadow(this.obj, -0.86, 1.3, 0.6);
    this.born = now();
    scene.add(this.obj);
  }

  update(dt) {
    this.obj.rotation.y -= 120 * DEG * dt;
    if (game.state !== 'playing') return;
    const p = this.obj.position;
    if (now() - this.born > 25) {
      this.remove();
    } else if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 1.5 && Math.abs(player.pos.y) < 3) {
      if (this.kind === 'coin') {
        game.score += 50;
        feed('+50 coin', YELLOW);
        Sound.play('coin', 0.7);
      } else {
        game.reserve[1] += 40;
        feed('+40 repeater ammo', '#8fd3ff');
        Sound.play('weapon_change', 0.7);
      }
      this.remove();
    }
  }

  remove() {
    const i = game.pickups.indexOf(this);
    if (i >= 0) game.pickups.splice(i, 1);
    scene.remove(this.obj);
  }
}

// ============================================================== game logic
const pointerLocked = () => document.pointerLockElement === canvas;

function lockPointer() {
  try {
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) {
      r.catch(() => {
        try { const r2 = canvas.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* retried when the player clicks the view */ }
}

function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

class Game {
  constructor() {
    this.enemies = [];
    this.pickups = [];
    this.dying = [];                  // dead enemies still playing their death
    this.state = 'menu';              // menu | playing | paused | dead
    this.session = 0;                 // invalidates timers from older games
    this.moving = false;
    this.resetStats();
  }

  resetStats() {
    this.health = 100;
    this.ammo = WEAPONS.map((w) => w.mag || 0);
    this.reserve = WEAPONS.map((w) => w.reserve || 0);
    this.weapon = 1;
    this.lastWeapon = 0;
    this.score = this.wave = this.kills = this.headshots = this.shots = this.hits = 0;
    this.fireCd = this.spray = this.kick = this.switchCd = 0;
    this.reloading = this.wavePending = false;
    this.lastHurt = -99;
    this.wasGrounded = true;
  }

  clear() {
    for (const e of [...this.enemies, ...this.dying]) e.remove();
    for (const p of [...this.pickups]) p.remove();
    this.enemies = [];
    this.dying = [];
    this.pickups = [];
    for (const line of [...feedLines]) dropFeed(line);
  }

  start() {
    this.clear();
    this.session += 1;
    if (current.key !== settings.map) loadMap(settings.map);
    this.resetStats();
    showScreen(null);
    this.state = 'playing';
    player.pos.copy(current.spawn);
    player.yaw = 0;
    player.pitch = 0;
    player.pivotY = EYE_HEIGHT;
    player.grounded = false;
    player.jumping = false;
    player.airTime = 0;
    hud.hidden = false;
    holder.visible = true;
    lockPointer();
    if (settings.fullscreen && !document.fullscreenElement) setFullscreen(true);
    centerText.textContent = subText.textContent = '';
    this.equip(1, true);
    applySettings();
    this.nextWave(this.session);
  }

  toMenu() {
    this.clear();
    this.session += 1;
    this.state = 'menu';
    hud.hidden = true;
    scoreboard.hidden = true;
    holder.visible = false;
    unlockPointer();
    Sound.loop('walking', false);
    showScreen(mainMenu);
  }

  // ---- waves
  freeSpot() {
    const limit = current.spawnLimit ?? current.half - 3;
    let x = 0, z = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = rand(-limit, limit);
      z = rand(-limit, limit);
      const far = Math.hypot(x - player.pos.x, z - player.pos.z) > Math.min(17, limit * 0.8);
      const hit = raycast([levelBoxes], x, 30, z, 0, -1, 0, 40);
      if (far && hit && hit.y < 0.3) break;
    }
    return new THREE.Vector3(x, 0, z);
  }

  nextWave(session) {
    if (session !== this.session || this.state === 'menu') return;
    this.wavePending = false;
    this.wave += 1;
    this.banner(`WAVE ${this.wave}`, 'Eliminate all hostiles');
    Sound.play('ui_confirmation_001', 0.8);
    const total = Math.min(3 + this.wave, 12);
    const drones = this.wave > 1 ? Math.min(Math.round(total * current.drones), total - 1)
      : (current.drones > 0.5 ? 1 : 0);
    for (let i = 0; i < total; i++) {
      const Kind = i < drones ? Drone : Soldier;
      this.enemies.push(new Kind(this.freeSpot(), this.wave));
    }
  }

  banner(title, subtitle = '', seconds = 2.5) {
    centerText.textContent = title;
    subText.textContent = subtitle;
    invoke(() => {
      if (centerText.textContent === title) centerText.textContent = subText.textContent = '';
    }, seconds);
  }

  // ---- weapons
  equip(index, instant = false) {
    if (index === this.weapon && !instant) return;
    if (!instant) {
      this.lastWeapon = this.weapon;
      Sound.play('weapon_change', 0.6);
    }
    this.weapon = index;
    this.reloading = false;
    this.switchCd = instant ? 0 : 0.3;
    this.spray = 0;
    WEAPONS.forEach((w, i) => { w.obj.visible = i === index; });
    const w = WEAPONS[index];
    hold.rx = 0;
    hold.y = -0.25;
    animate(hold, 'rx', 0, 0.01);
    animate(hold, 'y', 0, 0.2, { curve: curves.outQuad });
    crosshair.style.backgroundImage = `url('${ASSETS}${w.cross}')`;
    weaponText.textContent = w.name;
    slotTexts.forEach((t, i) => { t.style.color = i === index ? YELLOW : GRAY; });
  }

  attack() {
    const w = WEAPONS[this.weapon];
    if (this.reloading || this.fireCd > 0 || this.switchCd > 0) return;
    this.fireCd = w.rate;
    if (w.melee) return this.swing(w);
    if (this.ammo[this.weapon] <= 0) {
      Sound.play('ui_tick_001', 0.6);
      return this.reload();
    }
    this.ammo[this.weapon] -= 1;
    this.shots += 1;
    Sound.play(w.sound, 0.55, rand(0.94, 1.06));

    muzzleFlash.visible = true;
    muzzleFlash.rotation.z = rand(0, Math.PI * 2);
    invoke(() => { muzzleFlash.visible = false; }, 0.045);
    hold.z = -0.06;
    animate(hold, 'z', 0, 0.1);
    player.pitch -= w.kick;
    this.kick += w.kick;

    const steady = (held.has('mouse2') ? 0.45 : 1) * (crouchHeld() ? 0.7 : 1);
    const spread = (w.spread + Math.min(this.spray, 8) * w.bloom) * steady * (this.moving ? 1.6 : 1);
    this.spray += 1;
    syncCamera();
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    const right = _a.set(e[0], e[1], e[2]);
    const up = _b.set(e[4], e[5], e[6]);
    const dir = _c.set(-e[8], -e[9], -e[10])
      .addScaledVector(right, rand(-spread, spread))
      .addScaledVector(up, rand(-spread, spread))
      .normalize();
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const hit = raycast([levelBoxes, enemyBoxes], origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 160);
    const end = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : origin.clone().addScaledVector(dir, 90);
    tracer(muzzle.getWorldPosition(new THREE.Vector3()), end, '#fff2b0', 0.01);
    if (hit) this.resolveHit(hit, end, w.damage);
    if (this.ammo[this.weapon] === 0) this.reload();
  }

  resolveHit(hit, point, damage) {
    const target = hit.box.owner;
    if (!target) {
      puff(point, '#fff2c4', 1, 0.35);
      return;
    }
    const headshot = Boolean(hit.box.head);
    this.hits += 1;
    puff(point, headshot ? RED : YELLOW, 3, 0.4, 0.6);
    hitmarker.style.background = headshot ? RED : '#fff';
    hitmarker.hidden = false;
    invoke(() => { hitmarker.hidden = true; }, 0.1);
    Sound.play('ui_tick_001', 0.5, headshot ? 1.4 : 1.0);
    target.takeDamage(damage * (headshot ? 2 : 1), headshot);
  }

  swing(w) {
    Sound.play(w.sound, 0.6, 1.3);
    animate(swordRot, 'x', 55, 0.1, { curve: curves.outQuad });
    animate(swordRot, 'x', w.rot[0], 0.25, { delay: 0.12, keep: true });
    syncCamera();
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const hit = raycast([levelBoxes, enemyBoxes], origin.x, origin.y, origin.z, -e[8], -e[9], -e[10], w.reach);
    if (hit) {
      this.shots += 1;
      this.resolveHit(hit, new THREE.Vector3(hit.x, hit.y, hit.z), w.damage);
    }
  }

  reload() {
    const w = WEAPONS[this.weapon];
    if (w.melee || this.reloading || this.ammo[this.weapon] === w.mag) return;
    if (w.reserve !== null && this.reserve[this.weapon] <= 0) return;
    this.reloading = true;
    Sound.play('ui_switch_002', 0.7);
    animate(hold, 'rx', 40, 0.25);
    const session = this.session, index = this.weapon;
    invoke(() => this.finishReload(session, index), w.reload);
  }

  finishReload(session, index) {
    if (session !== this.session || !this.reloading || index !== this.weapon) return;
    const w = WEAPONS[index];
    const need = w.mag - this.ammo[index];
    const take = w.reserve === null ? need : Math.min(need, this.reserve[index]);
    this.ammo[index] += take;
    if (w.reserve !== null) this.reserve[index] -= take;
    this.reloading = false;
    Sound.play('ui_open_001', 0.6);
    animate(hold, 'rx', 0, 0.2);
  }

  // ---- player
  damagePlayer(amount) {
    if (this.state !== 'playing') return;
    this.health -= amount;
    this.lastHurt = now();
    Sound.play('land', 0.7, 0.8);
    flash.a = 0.32;
    animate(flash, 'a', 0, 0.45);
    if (this.health <= 0) {
      this.health = 0;
      this.gameOver();
    }
  }

  gameOver() {
    this.state = 'dead';
    hud.hidden = true;
    scoreboard.hidden = true;
    holder.visible = false;
    unlockPointer();
    Sound.loop('walking', false);
    Sound.play('fall', 0.8);
    const best = settings.best[current.key] || {};
    const newBest = this.score > (best.score || 0);
    if (newBest) {
      settings.best[current.key] = { score: this.score, wave: this.wave };
      saveSettings();
    }
    overTitle.textContent = newBest ? 'NEW BEST SCORE!' : 'MISSION FAILED';
    overStats.textContent = this.statsText();
    showScreen(overMenu);
  }

  statsText() {
    const accuracy = this.shots ? `${Math.round((100 * this.hits) / this.shots)}%` : '-';
    const best = (settings.best[current.key] || {}).score || 0;
    return `${MAPS[current.key].name}\n${this.wave}\n${this.score}\n${this.kills}\n` +
      `${this.headshots}\n${accuracy}\n${Math.max(best, this.score)}`;
  }

  enemyKilled(enemy, headshot) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
    this.dying.push(enemy);
    this.kills += 1;
    this.headshots += headshot ? 1 : 0;
    this.score += enemy.points + (headshot ? 50 : 0);
    feed(`You  >  ${enemy.nameTag}` + (headshot ? '   HEADSHOT' : ''), headshot ? '#ff9a8a' : '#fff');
    const roll = Math.random();
    if (roll < 0.6) this.pickups.push(new Pickup(enemy.position, roll < 0.28 ? 'ammo' : 'coin'));
    if (!this.enemies.length && !this.wavePending) {
      this.wavePending = true;
      const bonus = 250 * this.wave;
      this.score += bonus;
      this.reserve[1] += 40;
      this.banner('WAVE CLEARED', `+${bonus} bonus   +40 ammo`, 2.8);
      Sound.play('ui_confirmation_002', 0.8);
      const session = this.session;
      invoke(() => this.nextWave(session), 3.5);
    }
  }

  pause(paused) {
    this.state = paused ? 'paused' : 'playing';
    hud.hidden = paused;
    scoreboard.hidden = true;
    held.clear();
    Sound.loop('walking', false);
    showScreen(paused ? pauseMenu : null);
    if (paused) unlockPointer();
    else lockPointer();
  }
}

const game = new Game();

// =================================================================== menus
// A left-hand vertical menu over a live view of the map, a map-select screen
// with a briefing panel, and one settings screen shared by main and pause menus.
const dim = div(uiRoot, 'shade');
dim.style.background = 'rgba(8, 13, 26, 0.45)';
uiRoot.insertBefore(dim, stage);
dim.hidden = true;

function title(parent, heading, subtitle = '') {
  text(parent, heading, -0.8, 0.43, 3.6);
  quad(parent, -0.8, 0.315, 0.34, 0.008, YELLOW, [-0.5, 0]);
  if (subtitle) text(parent, subtitle, -0.8, 0.3, 1.1, { color: YELLOW });
}

function panel(parent, x, y, w, h, heading = '') {
  quad(parent, x, y, w, h, PANEL);
  quad(parent, x, y + h / 2, w, 0.008, YELLOW);
  if (heading) text(parent, heading, x - w / 2 + 0.03, y + h / 2 - 0.03, 1.3, { color: YELLOW });
}

let screens = [];
let previousScreen = null;

function showScreen(target) {
  for (const s of screens) s.hidden = s !== target;
  dim.hidden = !target;
}

function openSettings() {
  previousScreen = game.state === 'paused' ? pauseMenu : mainMenu;
  showScreen(settingsMenu);
}

function closeSettings() {
  saveSettings();
  Sound.play('ui_back_001', 0.6);
  showScreen(previousScreen);
}

function backToMain() {
  Sound.play('ui_back_001', 0.6);
  showScreen(mainMenu);
}

// ---- main menu
const mainMenu = layer();
title(mainMenu, 'ARENA SHOOTER', 'WAVE SURVIVAL');
new MenuButton(mainMenu, 'PLAY', -0.63, 0.17, () => openMapSelect());
new MenuButton(mainMenu, 'SETTINGS', -0.63, 0.07, openSettings);
new MenuButton(mainMenu, 'HOW TO PLAY', -0.63, -0.03, () => showScreen(helpMenu));
new MenuButton(mainMenu, 'CREDITS', -0.63, -0.13, () => showScreen(creditsMenu));
linkButton(mainMenu, 'DOWNLOAD FOR PC', -0.63, -0.23, 'download.html', 'grey');
text(mainMenu, 'Assets: Kenney (CC0)  |  Engine: three.js', -0.8, -0.45, 0.8, { color: LIGHT_GRAY });
const touchNote = text(mainMenu, 'This game needs a keyboard and mouse.', -0.8, -0.4, 0.9, { color: YELLOW });
touchNote.hidden = !window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// ---- map select
const mapMenu = layer();
title(mapMenu, 'SELECT MAP', 'CHOOSE YOUR BATTLEGROUND');
const mapButtons = {};
panel(mapMenu, 0.42, 0.02, 0.78, 0.5, 'BRIEFING');
const mapName = text(mapMenu, '', 0.06, 0.18, 2.4);
const mapText = text(mapMenu, '', 0.06, 0.09, 1.1, { lineHeight: 1.3, color: LIGHT_GRAY });
const mapBest = text(mapMenu, '', 0.06, -0.06, 1.1, { color: YELLOW });

function selectMap(key) {
  settings.map = key;
  if (current.key !== key) loadMap(key);
  const info = MAPS[key];
  mapName.textContent = info.name;
  mapText.textContent = info.text;
  const best = settings.best[key];
  mapBest.textContent = best ? `BEST   ${best.score} points   wave ${best.wave}` : 'BEST   no record yet';
  for (const [k, b] of Object.entries(mapButtons)) b.setStyle(k === key ? 'green' : 'blue');
}

function openMapSelect() {
  selectMap(settings.map);
  showScreen(mapMenu);
}

function cycleDifficulty() {
  const names = Object.keys(DIFFICULTY);
  settings.difficulty = names[(names.indexOf(settings.difficulty) + 1) % names.length];
  difficultyButton.setText(`DIFFICULTY:  ${settings.difficulty}`);
}

function startFromMenu() {
  saveSettings();
  game.start();
}

MAP_ORDER.forEach((key, i) => {
  mapButtons[key] = new MenuButton(mapMenu, MAPS[key].name, -0.63, 0.17 - i * 0.1, () => selectMap(key));
});
const difficultyButton = new MenuButton(mapMenu, `DIFFICULTY:  ${settings.difficulty}`, 0.24, -0.16,
  cycleDifficulty, 'grey', 0.36);
new MenuButton(mapMenu, 'START', 0.62, -0.16, startFromMenu, 'green', 0.3);
new MenuButton(mapMenu, 'BACK', -0.63, -0.23, backToMain, 'grey');

// ---- settings
const settingsMenu = layer();
title(settingsMenu, 'SETTINGS');
panel(settingsMenu, 0.0, -0.03, 1.0, 0.5);

function applySettings() {
  if (!held.has('mouse2')) camFov = settings.fov;
  Sound.setMaster(settings.volume);
}

function settingSlider(label, key, low, high, y, step = 1) {
  text(settingsMenu, label, -0.44, y + 0.012, 1.15);
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min: low, max: high, step, value: settings[key] });
  input.style.left = `calc(50% + var(--u) * -0.05)`;
  input.style.top = `calc(50% - var(--u) * ${y + 0.015})`;
  input.style.width = u(0.36);
  input.style.height = u(0.03);
  settingsMenu.appendChild(input);
  const value = text(settingsMenu, String(settings[key]), 0.35, y + 0.012, 1.0, { color: LIGHT_GRAY });
  input.addEventListener('input', () => {
    settings[key] = Math.round(Number(input.value) * 100) / 100;
    value.textContent = String(settings[key]);
    applySettings();
  });
  input.addEventListener('keydown', (e) => e.stopPropagation());
}

settingSlider('MOUSE SENSITIVITY', 'sensitivity', 10, 100, 0.14);
settingSlider('SOUND VOLUME', 'volume', 0, 1, 0.06, 0.05);
settingSlider('FIELD OF VIEW', 'fov', 70, 110, -0.02);

function setFullscreen(on) {
  try {
    if (on && !document.fullscreenElement) {
      const r = document.documentElement.requestFullscreen();
      if (r && r.catch) r.catch(() => {});
    } else if (!on && document.fullscreenElement) {
      document.exitFullscreen();
    }
  } catch (e) { /* not allowed here */ }
}

text(settingsMenu, 'FULLSCREEN', -0.44, -0.088, 1.15);
const fullscreenBox = div(settingsMenu, 'check');
fullscreenBox.style.left = `calc(50% + var(--u) * ${-0.02 - 0.025})`;
fullscreenBox.style.top = `calc(50% - var(--u) * ${-0.1 + 0.024})`;
fullscreenBox.style.width = u(0.05);
fullscreenBox.style.height = u(0.048);

function paintFullscreenBox() {
  fullscreenBox.style.backgroundImage =
    `url('${ASSETS}ui/${document.fullscreenElement ? 'blue_boxCheckmark' : 'grey_box'}.png')`;
}

fullscreenBox.addEventListener('click', () => {
  Sound.play('ui_click_001', 0.7);
  settings.fullscreen = !document.fullscreenElement;
  setFullscreen(settings.fullscreen);
});
document.addEventListener('fullscreenchange', paintFullscreenBox);
paintFullscreenBox();
new MenuButton(settingsMenu, 'BACK', 0.0, -0.21, closeSettings, 'grey', 0.3);

// ---- how to play
const helpMenu = layer();
title(helpMenu, 'HOW TO PLAY');
panel(helpMenu, 0.0, -0.02, 1.0, 0.56);
text(helpMenu, 'W A S D\nMouse\nLeft mouse\nRight mouse\nR\n1 / 2 / 3  or  wheel\nQ\nSpace\n' +
  'Shift\nC\nTab\nEsc', -0.44, 0.22, 1.1, { lineHeight: 1.42 });
text(helpMenu, 'Move\nAim\nShoot (hold with the Repeater)\nAim down sights - steadier shots\n' +
  'Reload\nBlaster / Repeater / Sword\nPrevious weapon\nJump\nSprint\nCrouch\nScoreboard\nPause',
  -0.12, 0.22, 1.1, { lineHeight: 1.42, color: LIGHT_GRAY });
new MenuButton(helpMenu, 'BACK', 0.0, -0.37, backToMain, 'grey', 0.3);

// ---- credits
const creditsMenu = layer();
title(creditsMenu, 'CREDITS');
panel(creditsMenu, 0.0, -0.02, 1.2, 0.56);
text(creditsMenu, '3D MODELS, SPRITES AND SOUNDS  -  Kenney (www.kenney.nl), CC0\n' +
  '    Starter Kit FPS: blasters, drone, platforms, walls, HUD sprites, sounds\n' +
  '    Mini Arena: soldier character, arena walls, columns, statue, sword\n' +
  '    Starter Kit City Builder: buildings, roads, trees, city ambience\n' +
  '    Starter Kit 3D Platformer: coin, sounds\n' +
  '    UI Pack: buttons and checkboxes        Interface Sounds: menu sounds\n\n' +
  'FONT  -  Lilita One by Juan Montoreano, SIL Open Font License 1.1\n\n' +
  'ENGINE  -  three.js (browser)   |   Ursina / Panda3D (desktop)', -0.56, 0.22, 1.0, { lineHeight: 1.4 });
new MenuButton(creditsMenu, 'BACK', 0.0, -0.37, backToMain, 'grey', 0.3);

// ---- pause menu
const pauseMenu = layer();
title(pauseMenu, 'PAUSED');
new MenuButton(pauseMenu, 'RESUME', -0.63, 0.17, () => game.pause(false), 'green');
new MenuButton(pauseMenu, 'RESTART', -0.63, 0.07, () => game.start());
new MenuButton(pauseMenu, 'SETTINGS', -0.63, -0.03, openSettings);
new MenuButton(pauseMenu, 'MAIN MENU', -0.63, -0.13, () => game.toMenu());

// ---- game over
const overMenu = layer();
title(overMenu, 'YOU DIED');
const overTitle = text(overMenu, '', -0.8, 0.3, 1.1, { color: YELLOW });
panel(overMenu, 0.42, 0.02, 0.6, 0.46, 'RESULTS');
text(overMenu, STAT_LABELS, 0.16, 0.16, 1.15, { lineHeight: 1.45 });
const overStats = text(overMenu, '', 0.48, 0.16, 1.15, { lineHeight: 1.45, color: LIGHT_GRAY });
new MenuButton(overMenu, 'PLAY AGAIN', -0.63, 0.17, () => game.start(), 'green');
new MenuButton(overMenu, 'CHANGE MAP', -0.63, 0.07, () => { game.toMenu(); openMapSelect(); });
new MenuButton(overMenu, 'MAIN MENU', -0.63, -0.03, () => game.toMenu());

screens = [mainMenu, mapMenu, settingsMenu, helpMenu, creditsMenu, pauseMenu, overMenu];

// ============================================================ engine hooks
const _fwd = new THREE.Vector3();

function update(dt) {
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.drift * dt;
    if (cloud.position.x > 110) cloud.position.x = -110;
  }
  enemyBoxes = [];
  for (const e of game.enemies) enemyBoxes.push(...e.boxes);
  for (const e of [...game.enemies, ...game.dying]) e.update(dt);
  game.dying = game.dying.filter((e) => !e.removed);
  for (const p of [...game.pickups]) p.update(dt);

  if (game.state === 'menu') {                        // slow fly-around behind the menu
    const t = now() * 0.1;
    const [far, high] = current.cam || [0.95, 0.5];
    const r = current.half * far, h = current.half * high;
    camera.position.set(Math.cos(t) * r, h, -Math.sin(t) * r);
    camera.lookAt(0, 2, 0);
    return;
  }
  if (game.state !== 'playing') {
    syncCamera();
    return;
  }

  const w = WEAPONS[game.weapon];
  game.fireCd -= dt;
  game.switchCd -= dt;
  game.spray = Math.max(0, game.spray - dt * 9);
  const recover = Math.min(game.kick, dt * 6);       // recoil settles back down
  player.pitch += recover;
  game.kick -= recover;

  const crouching = crouchHeld();
  const aiming = held.has('mouse2') && !w.melee;
  game.moving = Boolean(key('KeyW') || key('KeyA') || key('KeyS') || key('KeyD'));
  const sprinting = sprintHeld() && game.moving && !crouching && !aiming;
  player.speed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
  player.pivotY = lerp(player.pivotY, crouching ? CROUCH_HEIGHT : EYE_HEIGHT, Math.min(1, dt * 12));
  camFov = lerp(camFov, settings.fov * (aiming ? 0.68 : 1), Math.min(1, dt * 14));
  if (pointerLocked()) playerPhysics(dt);
  syncCamera();
  if (w.auto && held.has('mouse0') && pointerLocked()) game.attack();

  // weapon sway / aim-down-sights position
  const bob = game.moving && player.grounded ? Math.sin(now() * (sprinting ? 12 : 8)) * 0.008 : 0;
  const targetX = aiming ? -w.pos[0] * 0.82 : bob * 0.6;
  const targetY = aiming ? 0.06 : bob;
  hold.x = lerp(hold.x, targetX, Math.min(1, dt * 14));
  if (!game.reloading && game.switchCd <= 0) hold.y = lerp(hold.y, targetY, Math.min(1, dt * 14));

  // footsteps, landing
  Sound.loop('walking', game.moving && player.grounded && pointerLocked(), crouching ? 0.2 : 0.5);
  if (player.grounded && !game.wasGrounded) Sound.play('land', 0.5);
  game.wasGrounded = player.grounded;

  // health regenerates after a few seconds without being hit
  if (game.health < 100 && now() - game.lastHurt > 5) game.health = Math.min(100, game.health + 14 * dt);

  if (player.pos.y < -18) {                           // fell off the map
    player.pos.copy(current.spawn);
    player.airTime = 0;
    game.damagePlayer(35);
  }

  // HUD
  const gap = 0.05 + Math.min(game.spray, 8) * 0.006 + (game.moving ? 0.012 : 0);
  game.cross = lerp(game.cross || 0.05, gap * (aiming ? 0.75 : 1), Math.min(1, dt * 18));
  crosshair.style.width = crosshair.style.height = u(game.cross.toFixed(4));
  const hp = Math.ceil(game.health);
  setText(hpText, String(hp));
  hpBar.style.transform = `scaleX(${game.health / 100})`;
  hpBar.style.background = hp <= 30 ? RED : GREEN;
  if (w.melee) {
    setText(ammoText, '-');
    setText(reserveText, '');
    ammoText.style.color = '#fff';
  } else {
    setText(ammoText, game.reloading ? '--' : String(game.ammo[game.weapon]));
    ammoText.style.color = game.ammo[game.weapon] <= w.mag * 0.2 ? RED : '#fff';
    setText(reserveText, game.reloading ? 'RELOADING' : w.reserve === null ? '/ INF' : `/ ${game.reserve[game.weapon]}`);
  }
  setText(topText, `WAVE ${game.wave}    |    HOSTILES ${game.enemies.length}`);
  setText(scoreText, `SCORE ${game.score}`);

  // radar: dots are placed relative to where the player is facing
  playerForward(_fwd);
  radarDots.forEach((dot, i) => {
    const e = game.enemies[i];
    if (!e) { dot.hidden = true; return; }
    const rx = e.position.x - player.pos.x, rz = e.position.z - player.pos.z;
    const ahead = rx * _fwd.x + rz * _fwd.z;
    const side = rx * -_fwd.z + rz * _fwd.x;
    const dist = Math.hypot(ahead, side);
    const k = ((Math.min(dist, RADAR_RANGE) / RADAR_RANGE) * RADAR_R) / Math.max(dist, 0.001);
    dot.hidden = false;
    dot.style.left = `calc(50% + var(--u) * ${(side * k).toFixed(4)})`;
    dot.style.top = `calc(50% - var(--u) * ${(ahead * k).toFixed(4)})`;
    dot.style.background = e instanceof Drone ? '#ffb347' : RED;
  });

  scoreboard.hidden = !held.has('Tab');
  if (!scoreboard.hidden) setText(boardRight, game.statsText());
}

function render() {
  camera.fov = (2 * Math.atan(Math.tan((camFov * DEG) / 2) / camera.aspect)) / DEG;
  camera.updateProjectionMatrix();
  holder.position.set(hold.x, hold.y, -hold.z);
  holder.rotation.x = -hold.rx * DEG;
  const sword = WEAPONS[2].obj;
  if (sword) sword.rotation.x = -swordRot.x * DEG;
  damageFlash.style.opacity = flash.a.toFixed(3);
  camera.updateMatrixWorld(true);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}

// ================================================================== events
const GAME_KEYS = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown']);

window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.code) && game.state === 'playing') e.preventDefault();
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  held.add(e.code);
  if (e.code === 'Escape') {
    if (game.state === 'playing') game.pause(true);
    else if (game.state === 'paused') game.pause(false);
    else if (!settingsMenu.hidden) closeSettings();
    else if (game.state === 'menu' && mainMenu.hidden) backToMain();
    return;
  }
  if (game.state !== 'playing') {
    if (e.code === 'Enter' && game.state === 'dead') game.start();
    return;
  }
  if (!pointerLocked()) return;
  if (e.code === 'KeyR') game.reload();
  else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') game.equip(Number(e.code.slice(5)) - 1);
  else if (e.code === 'KeyQ') game.equip(game.lastWeapon);
  else if (e.code === 'Space') jump();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

canvas.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing') return;
  if (!pointerLocked()) {
    lockPointer();
    return;
  }
  held.add('mouse' + e.button);
  if (e.button === 0) game.attack();
});
window.addEventListener('mouseup', (e) => held.delete('mouse' + e.button));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (game.state !== 'playing' || !pointerLocked()) return;
  e.preventDefault();
  const n = WEAPONS.length;
  game.equip(e.deltaY < 0 ? (game.weapon - 1 + n) % n : (game.weapon + 1) % n);
}, { passive: false });

window.addEventListener('mousemove', (e) => {
  if (game.state !== 'playing' || !pointerLocked()) return;
  const aim = held.has('mouse2') && !WEAPONS[game.weapon].melee ? 0.6 : 1;
  const k = (settings.sensitivity * aim) / window.innerHeight;
  player.yaw += clamp(e.movementX, -400, 400) * k;
  player.pitch = clamp(player.pitch + clamp(e.movementY, -400, 400) * k, -90, 90);
});

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (pointerLocked()) {
    hadLock = true;
  } else if (hadLock && game.state === 'playing') {
    game.pause(true);                                 // Esc (or alt-tab) releases the mouse
  }
  if (!pointerLocked()) hadLock = false;
});

// ==================================================================== boot
let last = performance.now();

function frame(t) {
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  tick(dt);
  updateParticles(dt);
  update(dt);
  lockHint.hidden = !(game.state === 'playing' && !pointerLocked());
  render();
  requestAnimationFrame(frame);
}

async function boot() {
  Sound.init();
  const bar = document.getElementById('load-bar');
  await document.fonts.load(`20px Lilita`).catch(() => {});
  try {
    await loadAll((k) => { bar.style.width = `${Math.round(k * 100)}%`; });
  } catch (e) {
    document.getElementById('load-text').textContent =
      'Some game files failed to load. Check your connection and reload the page.';
    throw e;
  }
  const skyTex = tex('sprites/skybox.png');
  sky.material.map = skyTex;
  sky.material.needsUpdate = true;
  buildWeapons();
  if (!MAPS[settings.map]) settings.map = MAP_ORDER[0];
  if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'NORMAL';
  difficultyButton.setText(`DIFFICULTY:  ${settings.difficulty}`);
  loadMap(settings.map);
  game.toMenu();
  applySettings();
  document.getElementById('loading').remove();
  requestAnimationFrame((t) => { last = t; frame(t); });
}

boot();

// Exposed for automated smoke tests only.
window.__arena = { game, player, settings, WEAPONS };
