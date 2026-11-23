// The three arenas, ported line for line from fps_game.py.
// Map code keeps the desktop game's (Ursina) coordinates: x right, y up, z forward,
// rotation_y clockwise in degrees. place() and solidBox() convert to three.js
// (z flipped, yaw negated), so every number below matches the Python version.
import * as THREE from 'three';
import { PyRandom } from './rng.js';
import { model, modelInfo, makeBox, DEG } from './engine.js';

export const level = new THREE.Group();     // current map (also what AI raycasts against)
export const decor = new THREE.Group();     // no collision: clouds, far islands
export const levelBoxes = [];
export const clouds = [];

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();

export function place(rel, x = 0, y = 0, z = 0, rot = 0, scale = 1,
  { solid = true, shrink = 1, parent = level, lit = true } = {}) {
  const obj = model(rel, { lit });
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  obj.position.set(x, y, -z);
  obj.rotation.y = -rot * DEG;
  obj.scale.set(s[0], s[1], s[2]);
  parent.add(obj);
  if (solid) {
    const b = modelInfo(rel).bounds;
    b.getCenter(_v);
    const cx = _v.x * s[0], cy = _v.y * s[1], cz = _v.z * s[2];
    const yaw = obj.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw);
    b.getSize(_v);
    levelBoxes.push(makeBox(
      obj.position.x + cx * c + cz * sn, obj.position.y + cy, obj.position.z - cx * sn + cz * c,
      (_v.x * s[0] * shrink) / 2, (_v.y * s[1]) / 2, (_v.z * s[2] * shrink) / 2, yaw));
  }
  return obj;
}

/** Invisible collision box (ground, map boundary). */
export function solidBox(x, y, z, sx, sy, sz) {
  levelBoxes.push(makeBox(x, y, -z, sx / 2, sy / 2, sz / 2));
}

function groundAndBounds(half, walls = true) {
  solidBox(0, -0.5, 0, half * 2, 1, half * 2);
  if (walls) {
    for (const [x, z, sx, sz] of [[0, half, half * 2, 1], [0, -half, half * 2, 1],
      [half, 0, 1, half * 2], [-half, 0, 1, half * 2]]) {
      solidBox(x, 10, z, sx, 20, sz);
    }
  }
}

function buildColosseum() {
  const s = 4, n = 12, half = (s * n) / 2;
  groundAndBounds(half);
  place('arena/floor.glb', 0, 0, 0, 0, [half * 2, 1, half * 2], { solid: false });
  const rnd = new PyRandom(4);
  for (let k = 0; k < 46; k++) {
    place('arena/floor-detail.glb', rnd.uniform(-half + 3, half - 3), 0.02,
      rnd.uniform(-half + 3, half - 3), rnd.choice([0, 90, 180, 270]), s, { solid: false });
  }
  for (let i = 0; i < n; i++) {                                     // two-storey outer wall
    const t = -half + s / 2 + i * s;
    const gate = i === 5 || i === 6;
    for (const [x, z, rot] of [[t, half, 0], [t, -half, 180], [half, t, 90], [-half, t, 270]]) {
      place(gate && i === 5 ? 'arena/wall-gate.glb' : 'arena/wall.glb', x, 0, z, rot, s, { solid: false });
      place('arena/wall.glb', x, s, z, rot, s, { solid: false });
      if (i % 3 === 1) {
        const len = Math.hypot(x, z);
        place('arena/banner.glb', x - (x / len) * 1.25, 3.2, z - (z / len) * 1.25, rot, s, { solid: false });
      }
    }
  }
  for (const x of [-half, half]) {
    for (const z of [-half, half]) place('arena/column.glb', x, 0, z, 0, [7, 9.5, 7], { solid: false });
  }
  place('arena/block.glb', 0, 0, 0, 0, [6, 4, 6]);                    // centre piece
  place('arena/statue.glb', 0, 2, 0, 180, 5);
  for (let a = 0; a < 8; a++) {                                       // ring of columns
    const ang = (a * 45 + 22.5) * DEG;
    const kind = a % 3 === 0 ? 'arena/column-damaged.glb' : 'arena/column.glb';
    place(kind, Math.sin(ang) * 11.5, 0, Math.cos(ang) * 11.5, a * 45, [4, 5, 4]);
  }
  for (const [x, z, tall] of [[-7, -13, 1], [7, -13, 0], [-7, 13, 0], [7, 13, 1], [-16, 0, 1],
    [16, 0, 0], [-15, -9, 0], [15, 9, 0], [0, 17, 0], [-17, 15, 0]]) {
    place('arena/block.glb', x, 0, z, 0, [4, 3.4, 4]);
    if (tall) place('arena/block.glb', x, 1.7, z, 0, [4, 3.4, 4]);
  }
  for (const [x, z] of [[4, -7], [-4, 7], [12, -3], [-12, 4], [9, 17], [-10, -18], [18, -15]]) {
    place('arena/bricks.glb', x, 0, z, rnd.uniform(0, 360), 4);
  }
  for (const [x, z] of [[-20, -20], [20, -20], [-20, 20], [20, 20], [20, 4], [-20, -5]]) {
    place('arena/tree.glb', x, 0, z, rnd.uniform(0, 360), 6, { shrink: 0.35 });
  }
  place('arena/weapon-rack.glb', -3.5, 0, -22, 0, 3.4);
  place('arena/weapon-rack.glb', 3.5, 0, -22, 0, 3.4);
  place('arena/trophy.glb', 0, 3.4, 17, 180, 4, { solid: false });
  return { half, spawn: [0, 0.1, -18], drones: 0.25, sky: '#ffe9c9' };
}

function buildSkyGarden() {
  const tile = 10.4, n = 5, half = (tile * n) / 2;
  groundAndBounds(half, false);
  const rnd = new PyRandom(11);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      place('fps/platform-large-grass.glb', -half + tile / 2 + i * tile, -1.0,
        -half + tile / 2 + j * tile, 0, 2, { solid: false });
    }
  }
  for (const [x, z, rot] of [[-10, -8, 0], [10, -8, 0], [0, 8, 0], [-16, 6, 90], [16, 6, 90],
    [-6, 18, 0], [8, 18, 90], [0, -14, 0], [-18, -16, 0], [18, -16, 90]]) {
    place('fps/wall-high.glb', x, 0, z, rot, 2.2);
  }
  for (const [x, z, rot] of [[-4, -4, 90], [5, 0, 90], [-12, 14, 0], [13, 13, 0], [-20, -2, 0],
    [20, -4, 0], [0, 20, 0], [-9, -19, 90], [9, -20, 90]]) {
    place('fps/wall-low.glb', x, 0, z, rot, 2.0);
  }
  for (const [x, z, levels] of [[0, 0, 2], [-14, -12, 1], [14, 12, 1], [14, -12, 1], [-14, 12, 2]]) {
    place('fps/platform.glb', x, 0, z, 0, 2);                         // jump-up vantage points
    if (levels === 2) {
      place('fps/platform.glb', x + 4.4, 0, z, 0, 2);
      place('fps/platform.glb', x, 1.0, z, 0, 2);
    }
  }
  for (let k = 0; k < 90; k++) {
    place(rnd.choice(['fps/grass.glb', 'fps/grass-small.glb']),
      rnd.uniform(-half + 1, half - 1), 0, rnd.uniform(-half + 1, half - 1),
      rnd.uniform(0, 360), rnd.uniform(1.5, 2.6), { solid: false });
  }
  for (let k = 0; k < 26; k++) {                                      // drifting clouds
    const ang = rnd.uniform(0, TAU), dist = rnd.uniform(half + 14, half + 70);
    const cloud = place('fps/cloud.glb', Math.cos(ang) * dist, rnd.uniform(-14, 22),
      Math.sin(ang) * dist, rnd.uniform(0, 360),
      [rnd.uniform(8, 18), rnd.uniform(4, 7), rnd.uniform(6, 12)],
      { solid: false, parent: decor, lit: false });
    cloud.userData.drift = rnd.uniform(0.3, 1.0);
    clouds.push(cloud);
  }
  for (const [x, z] of [[-46, 10], [48, -14], [6, 50], [-20, -48]]) {
    place('fps/platform-large-grass.glb', x, rnd.uniform(-6, 4), z, 0, 2, { solid: false, parent: decor });
  }
  return { half, spawn: [0, 0.1, -22], drones: 0.6, sky: '#ffffff', pit: true };
}

function buildDowntown() {
  const t = 8, n = 7, half = (t * n) / 2;
  groundAndBounds(half);
  const rnd = new PyRandom(21);
  const buildings = ['city/building-small-a.glb', 'city/building-small-b.glb',
    'city/building-small-c.glb', 'city/building-small-d.glb', 'city/building-garage.glb'];
  const pos = (i, j) => [-half + t / 2 + i * t, -half + t / 2 + j * t];
  const mid = Math.floor(n / 2);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [x, z] = pos(i, j);
      const edge = i === 0 || i === n - 1 || j === 0 || j === n - 1;
      const ring = (i === 1 || i === n - 2 || j === 1 || j === n - 2) && !edge;
      if (edge) {                                                      // a wall of buildings
        const face = i === 0 ? 90 : i === n - 1 ? 270 : j === 0 ? 0 : 180;
        place('city/pavement.glb', x, 0, z, 0, t, { solid: false });
        place(rnd.choice(buildings.slice(0, 4)), x, 0, z, face, [t, t * rnd.uniform(1.0, 1.7), t],
          { shrink: 0.86 });
      } else if (ring) {                                               // ring road
        const corner = (i === 1 || i === n - 2) && (j === 1 || j === n - 2);
        if (corner) {
          const rot = i === 1 && j === 1 ? 180 : i === n - 2 && j === 1 ? 90 : i === 1 ? 270 : 0;
          place('city/road-corner.glb', x, 0, z, rot, t, { solid: false });
        } else {
          const alongX = j === 1 || j === n - 2;
          const kind = (i + j) % 2 ? 'city/road-straight-lightposts.glb' : 'city/road-straight.glb';
          place(kind, x, 0, z, alongX ? 90 : 0, t, { solid: false });
        }
      } else if (i === mid && j === mid) {
        place('city/pavement-fountain.glb', x, 0, z, 0, t, { shrink: 0.55 });
      } else if ((i === 2 && j === 2) || (i === n - 3 && j === n - 3)) {
        place('city/pavement.glb', x, 0, z, 0, t, { solid: false });
        place(i === 2 ? buildings[4] : buildings[1], x, 0, z, i === 2 ? 180 : 0, t, { shrink: 0.86 });
      } else if ((i === 2 && j === n - 3) || (i === n - 3 && j === 2)) {
        place('city/grass-trees-tall.glb', x, 0, z, 0, t, { solid: false });
        solidBox(x, 3, z, 3.8, 6, 3.8);
      } else if ((i + j) % 2) {
        place('city/grass-trees.glb', x, 0, z, rnd.choice([0, 90]), t, { solid: false });
        solidBox(x, 2, z, 3.4, 4, 3.4);
      } else {
        place('city/pavement.glb', x, 0, z, 0, t, { solid: false });
      }
    }
  }
  for (const [x, z, rot] of [[-16, -6, 90], [16, 6, 90], [-6, 16, 0], [6, -16, 0], [-16, 12, 90],
    [16, -12, 90], [12, 16, 0], [-12, -16, 0]]) {                     // road barricades
    place('fps/wall-low.glb', x, 0, z, rot, 2.0);
  }
  for (const [x, z] of [[-4.5, -4.5], [4.5, 4.5], [-4.5, 4.5], [4.5, -4.5]]) {
    place('arena/block.glb', x, 0, z, 45, [2.4, 2.6, 2.4]);
  }
  return { half, spawn: [0, 0.1, -16], drones: 0.4, sky: '#d9e8ff', ambience: true,
           cam: [0.5, 0.9], spawnLimit: 19 };
}

export const MAPS = {
  colosseum: { name: 'COLOSSEUM', build: buildColosseum,
    text: 'A walled sand arena. Columns and stone blocks\ngive cover, the statue marks the centre.' },
  sky_garden: { name: 'SKY GARDEN', build: buildSkyGarden,
    text: 'Floating grass islands above the clouds.\nMany drones, no walls - watch the edge.' },
  downtown: { name: 'DOWNTOWN', build: buildDowntown,
    text: 'A city block with a ring road and a fountain\nplaza. Long sight lines along the streets.' },
};
export const MAP_ORDER = Object.keys(MAPS);

/** Clear the old map and build a new one. Returns its info, in three.js coordinates. */
export function buildMap(key) {
  level.clear();
  decor.clear();
  levelBoxes.length = 0;
  clouds.length = 0;
  const info = MAPS[key].build();
  const [sx, sy, sz] = info.spawn;
  info.spawn = new THREE.Vector3(sx, sy, -sz);
  info.key = key;
  return info;
}
