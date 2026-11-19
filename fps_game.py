"""
ARENA SHOOTER - a 3D first-person shooter in Python (Ursina engine)

All models, sprites, sounds, UI art and the font are free third-party assets
(mostly CC0 by Kenney, www.kenney.nl) stored in the "assets" folder next to
this file. See assets/CREDITS.txt.

Run:  python fps_game.py      (installs the 'ursina' package on first run)
"""
import json
import math
import os
import random
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
ASSETS = BASE / 'assets'
os.chdir(BASE)
if not ASSETS.is_dir():
    sys.exit('The "assets" folder is missing. Keep it in the same folder as fps_game.py.')

try:
    import ursina  # noqa: F401
except ImportError:                      # first run: install the game engine
    print('Installing requirements (ursina)... this takes a minute.')
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'ursina'])

import gltf
from direct.actor.Actor import Actor
from panda3d.core import Filename, NodePath, getModelPath
from ursina import *
from ursina.prefabs.first_person_controller import FirstPersonController
from ursina.prefabs.slider import Slider
from ursina.shaders import basic_lighting_shader as LIT
from ursina.shaders import unlit_shader

# ================================================================ settings
SETTINGS_FILE = BASE / 'settings.json'
settings = {'sensitivity': 40, 'volume': 0.8, 'fov': 90, 'fullscreen': False,
            'difficulty': 'NORMAL', 'map': 'colosseum', 'best': {}}
try:
    settings.update(json.loads(SETTINGS_FILE.read_text()))
except Exception:
    pass


def save_settings():
    try:
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2))
    except Exception:
        pass


DIFFICULTY = {            # enemy accuracy, damage per hit, health multiplier
    'EASY': (0.25, 6, 0.8),
    'NORMAL': (0.4, 9, 1.0),
    'HARD': (0.55, 12, 1.3),
}
WALK_SPEED, SPRINT_SPEED, CROUCH_SPEED = 6.5, 10, 3.2
EYE_HEIGHT, CROUCH_HEIGHT = 2.0, 1.25
BOT_NAMES = ['Viper', 'Rook', 'Ghost', 'Brick', 'Mako', 'Flint', 'Onyx', 'Sable',
             'Kite', 'Rust', 'Dagger', 'Moss', 'Cobalt', 'Ember', 'Wren', 'Talon']

app = Ursina(title='Arena Shooter')
for _name in ('fps_counter', 'entity_counter', 'collider_counter', 'cog_button',
              'exit_button'):                       # hide the engine's debug overlays
    if getattr(window, _name, None):
        getattr(window, _name).enabled = False
getModelPath().appendDirectory(Filename.fromOsSpecific(str(ASSETS / 'fonts')))
Text.default_font = 'lilita_one_regular.ttf'

YELLOW = color.hex('#ffcc00')
DARK = color.hex('#1d2433')
PANEL = color.rgba(0.07, 0.09, 0.14, 0.86)
RED = color.hex('#e5533d')

# ================================================================== assets
_models, _textures = {}, {}
_stash = NodePath('model-stash')


def model(rel):
    """A fresh copy of a downloaded .glb model (loaded once, then instanced)."""
    if rel not in _models:
        opts = gltf.GltfSettings()
        opts.no_srgb = True
        _models[rel] = NodePath(gltf.load_model(str(ASSETS / rel), gltf_settings=opts))
    return _models[rel].copyTo(_stash)


def tex(rel):
    if rel not in _textures:
        _textures[rel] = Texture(ASSETS / rel)
    return _textures[rel]


class Sound:
    """Small pool per sound so rapid fire can overlap."""
    pools = {}

    @classmethod
    def play(cls, name, volume=1.0, pitch=1.0):
        try:
            pool = cls.pools.setdefault(name, [])
            clip = next((a for a in pool if not a.playing), None)
            if clip is None:
                if len(pool) < 4:
                    clip = Audio(name, autoplay=False)
                    pool.append(clip)
                else:
                    clip = pool[0]
            clip.volume = volume * settings['volume']
            clip.pitch = pitch
            clip.play()
        except Exception:
            pass

    @classmethod
    def loop(cls, name, on, volume=1.0):
        try:
            pool = cls.pools.setdefault('loop:' + name, [])
            if not pool:
                pool.append(Audio(name, autoplay=False, loop=True))
            clip = pool[0]
            clip.volume = volume * settings['volume']
            if on and not clip.playing:
                clip.play()
            elif not on and clip.playing:
                clip.stop()
        except Exception:
            pass


# =================================================================== level
level = Entity()          # parent of the current map (also used for AI pathing)
decor = Entity()          # things that move or have no collision (clouds...)


def place(rel, x=0, y=0, z=0, rot=0, scale=1.0, solid=True, shrink=1.0, parent=level, lit=True):
    node = model(rel)
    e = Entity(parent=parent, model=node, position=(x, y, z), rotation_y=rot, scale=scale,
               shader=LIT if lit else unlit_shader)
    if solid:
        low, high = node.getTightBounds()
        size = high - low
        e.collider = BoxCollider(e, center=Vec3(*((low + high) / 2)),
                                 size=Vec3(size.x * shrink, size.y, size.z * shrink))
    return e


def solid_box(x, y, z, sx, sy, sz):
    """Invisible collision box (ground, map boundary)."""
    e = Entity(parent=level, position=(x, y, z), scale=(sx, sy, sz))
    e.collider = BoxCollider(e, center=Vec3(0, 0, 0), size=Vec3(1, 1, 1))
    return e


def ground_and_bounds(half, walls=True):
    solid_box(0, -0.5, 0, half * 2, 1, half * 2)
    if walls:
        for x, z, sx, sz in ((0, half, half * 2, 1), (0, -half, half * 2, 1),
                             (half, 0, 1, half * 2), (-half, 0, 1, half * 2)):
            solid_box(x, 10, z, sx, 20, sz)


def build_colosseum():
    s, n = 4, 12
    half = s * n / 2
    ground_and_bounds(half)
    place('arena/floor.glb', scale=(half * 2, 1, half * 2), solid=False)
    rnd = random.Random(4)
    for _ in range(46):
        place('arena/floor-detail.glb', rnd.uniform(-half + 3, half - 3), 0.02,
              rnd.uniform(-half + 3, half - 3), rnd.choice((0, 90, 180, 270)), s, solid=False)
    for i in range(n):                                   # two-storey outer wall
        t = -half + s / 2 + i * s
        gate = i in (5, 6)
        for x, z, rot in ((t, half, 0), (t, -half, 180), (half, t, 90), (-half, t, 270)):
            place('arena/wall-gate.glb' if gate and i == 5 else 'arena/wall.glb',
                  x, 0, z, rot, s, solid=False)
            place('arena/wall.glb', x, s, z, rot, s, solid=False)
            if i % 3 == 1:
                inward = Vec3(-x, 0, -z).normalized() * 1.25
                place('arena/banner.glb', x + inward.x, 3.2, z + inward.z, rot, s, solid=False)
    for x in (-half, half):
        for z in (-half, half):
            place('arena/column.glb', x, 0, z, 0, (7, 9.5, 7), solid=False)
    # centre piece
    place('arena/block.glb', 0, 0, 0, 0, (6, 4, 6))
    place('arena/statue.glb', 0, 2, 0, 180, 5)
    for a in range(8):                                   # ring of columns
        ang = math.radians(a * 45 + 22.5)
        kind = 'arena/column-damaged.glb' if a % 3 == 0 else 'arena/column.glb'
        place(kind, math.sin(ang) * 11.5, 0, math.cos(ang) * 11.5, a * 45, (4, 5, 4))
    for x, z, tall in ((-7, -13, 1), (7, -13, 0), (-7, 13, 0), (7, 13, 1), (-16, 0, 1),
                       (16, 0, 0), (-15, -9, 0), (15, 9, 0), (0, 17, 0), (-17, 15, 0)):
        place('arena/block.glb', x, 0, z, 0, (4, 3.4, 4))
        if tall:
            place('arena/block.glb', x, 1.7, z, 0, (4, 3.4, 4))
    for x, z in ((4, -7), (-4, 7), (12, -3), (-12, 4), (9, 17), (-10, -18), (18, -15)):
        place('arena/bricks.glb', x, 0, z, rnd.uniform(0, 360), 4)
    for x, z in ((-20, -20), (20, -20), (-20, 20), (20, 20), (20, 4), (-20, -5)):
        place('arena/tree.glb', x, 0, z, rnd.uniform(0, 360), 6, shrink=0.35)
    place('arena/weapon-rack.glb', -3.5, 0, -22, 0, 3.4)
    place('arena/weapon-rack.glb', 3.5, 0, -22, 0, 3.4)
    place('arena/trophy.glb', 0, 3.4, 17, 180, 4, solid=False)
    return dict(half=half, spawn=Vec3(0, 0.1, -18), drones=0.25, sky='#ffe9c9')


def build_sky_garden():
    tile, n = 10.4, 5
    half = tile * n / 2
    ground_and_bounds(half, walls=False)
    rnd = random.Random(11)
    for i in range(n):
        for j in range(n):
            place('fps/platform-large-grass.glb', -half + tile / 2 + i * tile, -1.0,
                  -half + tile / 2 + j * tile, 0, 2, solid=False)
    for x, z, rot in ((-10, -8, 0), (10, -8, 0), (0, 8, 0), (-16, 6, 90), (16, 6, 90),
                      (-6, 18, 0), (8, 18, 90), (0, -14, 0), (-18, -16, 0), (18, -16, 90)):
        place('fps/wall-high.glb', x, 0, z, rot, 2.2)
    for x, z, rot in ((-4, -4, 90), (5, 0, 90), (-12, 14, 0), (13, 13, 0), (-20, -2, 0),
                      (20, -4, 0), (0, 20, 0), (-9, -19, 90), (9, -20, 90)):
        place('fps/wall-low.glb', x, 0, z, rot, 2.0)
    for x, z, levels in ((0, 0, 2), (-14, -12, 1), (14, 12, 1), (14, -12, 1), (-14, 12, 2)):
        place('fps/platform.glb', x, 0, z, 0, 2)                 # jump-up vantage points
        if levels == 2:
            place('fps/platform.glb', x + 4.4, 0, z, 0, 2)
            place('fps/platform.glb', x, 1.0, z, 0, 2)
    for _ in range(90):
        place(rnd.choice(('fps/grass.glb', 'fps/grass-small.glb')),
              rnd.uniform(-half + 1, half - 1), 0, rnd.uniform(-half + 1, half - 1),
              rnd.uniform(0, 360), rnd.uniform(1.5, 2.6), solid=False)
    for _ in range(26):                                  # drifting clouds, far islands
        ang, dist = rnd.uniform(0, math.tau), rnd.uniform(half + 14, half + 70)
        cloud = place('fps/cloud.glb', math.cos(ang) * dist, rnd.uniform(-14, 22),
                      math.sin(ang) * dist, rnd.uniform(0, 360),
                      (rnd.uniform(8, 18), rnd.uniform(4, 7), rnd.uniform(6, 12)),
                      solid=False, parent=decor, lit=False)
        cloud.drift = rnd.uniform(0.3, 1.0)
    for x, z in ((-46, 10), (48, -14), (6, 50), (-20, -48)):
        place('fps/platform-large-grass.glb', x, rnd.uniform(-6, 4), z, 0, 2, solid=False,
              parent=decor)
    return dict(half=half, spawn=Vec3(0, 0.1, -22), drones=0.6, sky='#ffffff', pit=True)


def build_downtown():
    t, n = 8, 7
    half = t * n / 2
    ground_and_bounds(half)
    rnd = random.Random(21)
    buildings = ['city/building-small-a.glb', 'city/building-small-b.glb',
                 'city/building-small-c.glb', 'city/building-small-d.glb',
                 'city/building-garage.glb']

    def pos(i, j):
        return -half + t / 2 + i * t, -half + t / 2 + j * t

    for i in range(n):
        for j in range(n):
            x, z = pos(i, j)
            edge = i in (0, n - 1) or j in (0, n - 1)
            ring = (i in (1, n - 2) or j in (1, n - 2)) and not edge
            if edge:                                              # a wall of buildings
                face = 90 if i == 0 else 270 if i == n - 1 else 0 if j == 0 else 180
                place('city/pavement.glb', x, 0, z, 0, t, solid=False)
                place(rnd.choice(buildings[:4]), x, 0, z, face, (t, t * rnd.uniform(1.0, 1.7), t),
                      shrink=0.86)
            elif ring:                                            # ring road
                corner = i in (1, n - 2) and j in (1, n - 2)
                if corner:
                    rot = {(1, 1): 180, (n - 2, 1): 90, (1, n - 2): 270, (n - 2, n - 2): 0}[(i, j)]
                    place('city/road-corner.glb', x, 0, z, rot, t, solid=False)
                else:
                    along_x = j in (1, n - 2)
                    kind = 'city/road-straight-lightposts.glb' if (i + j) % 2 else \
                        'city/road-straight.glb'
                    place(kind, x, 0, z, 90 if along_x else 0, t, solid=False)
            elif (i, j) == (n // 2, n // 2):
                place('city/pavement-fountain.glb', x, 0, z, 0, t, shrink=0.55)
            elif (i, j) in ((2, 2), (n - 3, n - 3)):
                place('city/pavement.glb', x, 0, z, 0, t, solid=False)
                place(buildings[4] if i == 2 else buildings[1], x, 0, z, 180 if i == 2 else 0,
                      t, shrink=0.86)
            elif (i, j) in ((2, n - 3), (n - 3, 2)):
                place('city/grass-trees-tall.glb', x, 0, z, 0, t, solid=False)
                solid_box(x, 3, z, 3.8, 6, 3.8)
            elif (i + j) % 2:
                place('city/grass-trees.glb', x, 0, z, rnd.choice((0, 90)), t, solid=False)
                solid_box(x, 2, z, 3.4, 4, 3.4)
            else:
                place('city/pavement.glb', x, 0, z, 0, t, solid=False)
    for x, z, rot in ((-16, -6, 90), (16, 6, 90), (-6, 16, 0), (6, -16, 0), (-16, 12, 90),
                      (16, -12, 90), (12, 16, 0), (-12, -16, 0)):   # road barricades
        place('fps/wall-low.glb', x, 0, z, rot, 2.0)
    for x, z in ((-4.5, -4.5), (4.5, 4.5), (-4.5, 4.5), (4.5, -4.5)):
        place('arena/block.glb', x, 0, z, 45, (2.4, 2.6, 2.4))
    return dict(half=half, spawn=Vec3(0, 0.1, -16), drones=0.4, sky='#d9e8ff', ambience=True,
                cam=(0.5, 0.9), spawn_limit=19)


MAPS = {
    'colosseum': dict(name='COLOSSEUM', build=build_colosseum,
                      text='A walled sand arena. Columns and stone blocks\n'
                           'give cover, the statue marks the centre.'),
    'sky_garden': dict(name='SKY GARDEN', build=build_sky_garden,
                       text='Floating grass islands above the clouds.\n'
                            'Many drones, no walls - watch the edge.'),
    'downtown': dict(name='DOWNTOWN', build=build_downtown,
                     text='A city block with a ring road and a fountain\n'
                          'plaza. Long sight lines along the streets.'),
}
MAP_ORDER = list(MAPS)
current = {}              # info about the loaded map
sky = Sky(texture=tex('sprites/skybox.png'))


def load_map(key):
    for holder in (level, decor):
        for child in list(holder.children):
            destroy(child)
    current.clear()
    current.update(MAPS[key]['build']())
    current['key'] = key
    sky.color = color.hex(current['sky'])
    Sound.loop('ambience', bool(current.get('ambience')), 0.5)


# ================================================================== player
player = FirstPersonController(position=(0, 1, 0), speed=WALK_SPEED, jump_height=1.7)
player.cursor.scale = 0                       # replaced by sprite crosshairs
camera.fov = settings['fov']

WEAPONS = [
    dict(name='BLASTER', model='fps/blaster.glb', auto=False, rate=0.2, damage=40, mag=12,
         reserve=None, reload=1.1, spread=0.0015, bloom=0.004, kick=1.3, sound='blaster',
         cross='sprites/crosshair.png', pos=Vec3(0.2, -0.3, 0.55), scale=0.2),
    dict(name='REPEATER', model='fps/blaster-repeater.glb', auto=True, rate=0.085, damage=21,
         mag=40, reserve=160, reload=1.9, spread=0.003, bloom=0.0045, kick=0.5,
         sound='blaster_repeater', cross='sprites/crosshair-repeater.png',
         pos=Vec3(0.2, -0.3, 0.6), scale=0.2),
    dict(name='SWORD', model='arena/weapon-sword.glb', melee=True, rate=0.5, damage=120,
         reach=3.4, sound='jump_b', cross='sprites/crosshair.png',
         pos=Vec3(0.3, -0.34, 0.7), scale=1.3, rot=Vec3(15, 0, 172)),
]
holder = Entity(parent=camera)
for w in WEAPONS:
    w['entity'] = Entity(parent=holder, model=model(w['model']), position=w['pos'],
                         rotation=w.get('rot', Vec3(0, 180, 0)), scale=w['scale'],
                         shader=LIT, enabled=False)
muzzle = Entity(parent=holder, position=(0.2, -0.2, 0.95))
muzzle_flash = Entity(parent=muzzle, model='quad', texture=tex('sprites/burst.png'),
                      texture_scale=(0.5, 1), texture_offset=(0.5, 0), scale=0.3,
                      color=color.hex('#ffe9a0'), enabled=False)

# ===================================================================== HUD
hud = Entity(parent=camera.ui, enabled=False)
crosshair = Entity(parent=hud, model='quad', texture=tex('sprites/crosshair.png'), scale=0.05)
hitmarker = Entity(parent=hud, model='quad', texture=tex('sprites/hit.png'),
                   texture_scale=(0.5, 0.5), texture_offset=(0.5, 0.5), scale=0.07,
                   enabled=False)

Entity(parent=hud, model='quad', color=PANEL, scale=(0.34, 0.1), position=(-0.70, -0.42), z=0.1)
Text(parent=hud, text='HEALTH', position=(-0.855, -0.38), scale=0.8, color=YELLOW)
hp_text = Text(parent=hud, text='100', position=(-0.855, -0.405), scale=2.0)
Entity(parent=hud, model='quad', color=color.rgba(1, 1, 1, 0.15), scale=(0.19, 0.016),
       position=(-0.75, -0.43), origin=(-0.5, 0), z=0.05)
hp_bar = Entity(parent=hud, model='quad', color=color.hex('#6fd35a'), scale=(0.19, 0.016),
                position=(-0.75, -0.43), origin=(-0.5, 0), z=-0.01)

Entity(parent=hud, model='quad', color=PANEL, scale=(0.34, 0.1), position=(0.70, -0.42), z=0.1)
weapon_text = Text(parent=hud, text='', position=(0.545, -0.38), scale=0.8, color=YELLOW)
ammo_text = Text(parent=hud, text='', position=(0.545, -0.405), scale=2.0)
reserve_text = Text(parent=hud, text='', position=(0.66, -0.42), scale=1.1,
                    color=color.light_gray)
slot_texts = [Text(parent=hud, text=f'{i + 1}', origin=(0, 0), scale=0.9,
                   position=(0.78 + i * 0.03, -0.39)) for i in range(len(WEAPONS))]

Entity(parent=hud, model='quad', color=PANEL, scale=(0.42, 0.055), position=(0, 0.462), z=0.1)
top_text = Text(parent=hud, origin=(0, 0), position=(0, 0.462), scale=1.05)
score_text = Text(parent=hud, origin=(0.5, 0.5), position=(0.86, 0.485), scale=1.2,
                  color=YELLOW)
center_text = Text(parent=hud, origin=(0, 0), position=(0, 0.26), scale=2.6)
sub_text = Text(parent=hud, origin=(0, 0), position=(0, 0.19), scale=1.2, color=YELLOW)
damage_flash = Entity(parent=camera.ui, model='quad', scale=(2, 1), color=color.red, z=0.5)
damage_flash.alpha = 0

# radar
RADAR_R, RADAR_RANGE = 0.085, 34
radar = Entity(parent=hud, position=(-0.77, 0.37))
Entity(parent=radar, model='circle', scale=RADAR_R * 2.15, color=color.rgba(0.05, 0.07, 0.1, 0.75), z=0.1)
Entity(parent=radar, model='circle', scale=0.012, color=color.white, z=-0.02)
radar_dots = [Entity(parent=radar, model='circle', scale=0.014, color=RED, z=-0.01,
                     enabled=False) for _ in range(16)]

# scoreboard (hold Tab)
scoreboard = Entity(parent=camera.ui, enabled=False, z=-0.5)
Entity(parent=scoreboard, model='quad', color=PANEL, scale=(0.62, 0.42), z=0.1)
Entity(parent=scoreboard, model='quad', color=YELLOW, scale=(0.62, 0.008), y=0.21)
Text(parent=scoreboard, text='SCOREBOARD', origin=(0, 0), y=0.165, scale=1.6, color=YELLOW)
board_left = Text(parent=scoreboard, position=(-0.26, 0.11), scale=1.15, line_height=1.45,
                  text='Map\nWave\nScore\nEliminations\nHeadshots\nAccuracy\nBest score')
board_right = Text(parent=scoreboard, position=(0.06, 0.11), scale=1.15, line_height=1.45,
                   color=color.light_gray)

feed_lines = []


def feed(message, col=color.white):
    line = Text(parent=hud, text=message, origin=(0.5, 0.5), scale=0.95, color=col)
    feed_lines.append(line)
    if len(feed_lines) > 5:
        destroy(feed_lines.pop(0))
    layout_feed()
    invoke(drop_feed, line, delay=4.5)


def drop_feed(line):
    if line in feed_lines:
        feed_lines.remove(line)
        destroy(line)
        layout_feed()


def layout_feed():
    for i, line in enumerate(reversed(feed_lines)):
        line.position = (0.86, 0.43 - i * 0.034)


# ================================================================= effects
def tracer(a, b, col, width=0.012):
    length = (b - a).length()
    if length < 0.5:
        return
    t = Entity(model='cube', position=(a + b) / 2, scale=(width, width, length), color=col)
    t.look_at(b)
    destroy(t, delay=0.05)


def puff(point, col, count=1, size=0.5, spread=0.0):
    """Sprite particles (Kenney particle.png) at a hit or explosion."""
    for _ in range(count):
        p = Entity(model='quad', texture=tex('sprites/particle.png'), position=point,
                   scale=size * random.uniform(0.6, 1.1), color=col, billboard=True)
        if spread:
            offset = Vec3(random.uniform(-1, 1), random.uniform(-0.3, 1), random.uniform(-1, 1))
            p.animate_position(point + offset * spread, duration=0.35, curve=curve.out_quad)
        p.animate_scale(0, duration=0.35)
        destroy(p, delay=0.4)


# ================================================================= enemies
soldier_source = model('arena/soldier-fixed.glb')


class Enemy(Entity):
    points = 100

    def setup(self, wave, hp):
        acc, dmg, hp_mult = DIFFICULTY[settings['difficulty']]
        self.name_tag = random.choice(BOT_NAMES)
        self.max_hp = self.hp = int((hp + wave * 5) * hp_mult)
        self.accuracy, self.damage = acc, dmg
        self.keep_range = random.uniform(8, 16)
        self.fire_cd = random.uniform(0.9, 1.7)
        self.see_cd, self.sees, self.dead = random.uniform(0, 0.2), False, False
        self.bar = Entity(parent=self, model='quad', color=RED, scale=(0.9, 0.07),
                          billboard=True, enabled=False)

    def look_for_player(self, eye):
        self.see_cd -= time.dt
        if self.see_cd > 0:
            return
        self.see_cd = 0.2
        aim = camera.world_position + Vec3(0, -0.3, 0) - eye
        saw = self.sees
        self.sees = not raycast(eye, aim.normalized(), distance=aim.length(),
                                traverse_target=level).hit
        if self.sees and not saw:
            self.fire_cd = max(self.fire_cd, random.uniform(0.45, 0.8))   # reaction time

    def fire(self, start, dist):
        self.fire_cd = random.uniform(0.6, 1.25)
        Sound.play('enemy_attack', clamp(1.2 - dist / 40, 0.15, 0.8), random.uniform(0.9, 1.1))
        target = camera.world_position + Vec3(0, -0.3, 0)
        chance = self.accuracy * clamp(1.3 - dist / 30, 0.3, 1)
        if held_keys['shift'] and game.moving:
            chance *= 0.75
        if held_keys['left control']:
            chance *= 0.8
        col = color.hex('#ff9d5c')
        if random.random() < chance:
            tracer(start, target - (target - start).normalized() * 1.5, col)
            game.damage_player(self.damage)
        else:
            side = Vec3(-(target - start).z, 0, (target - start).x).normalized()
            miss = target + side * random.choice((-1, 1)) * random.uniform(0.7, 1.6)
            tracer(start, start + (miss - start).normalized() * (dist + 6), col)

    def take_damage(self, amount, headshot=False):
        if self.dead:
            return
        self.hp -= amount
        self.bar.enabled = True
        self.bar.scale_x = 0.9 * max(self.hp / self.max_hp, 0)
        self.sees, self.fire_cd = True, min(self.fire_cd, 0.5)
        if self.hp <= 0:
            self.dead = True
            self.bar.enabled = False
            self.die()
            game.enemy_killed(self, headshot)
        else:
            Sound.play('enemy_hurt', 0.5, random.uniform(0.9, 1.15))

    def keep_inside(self):
        limit = current['half'] - 1.5
        self.x, self.z = clamp(self.x, -limit, limit), clamp(self.z, -limit, limit)


class Soldier(Enemy):
    """Kenney's animated Mini Arena character, armed with a blaster."""
    SCALE = 2.3

    def __init__(self, position, wave):
        super().__init__(position=position)
        self.setup(wave, 85)
        self.speed = min(3.0 + wave * 0.2, 5.2) * random.uniform(0.9, 1.1)
        self.detour, self.detour_t = Vec3(0, 0, 0), 0
        self.anim = ''
        self.actor = Actor(soldier_source.copyTo(_stash))
        self.body = Entity(parent=self, model=self.actor, scale=self.SCALE, rotation_y=180,
                           shader=LIT)
        hand = self.actor.exposeJoint(None, 'modelRoot', 'arm-right')
        self.gun = model('fps/blaster.glb')
        self.gun.reparentTo(hand)
        self.gun.setScale(0.26)
        self.gun.setPos(-0.3, -0.02, 0)
        Entity(parent=self, model='quad', texture=tex('sprites/blob_shadow.png'), rotation_x=90,
               y=0.04, scale=2.2, color=color.rgba(1, 1, 1, 0.7))
        self.collider = BoxCollider(self, center=Vec3(0, 0.5, 0), size=Vec3(1.2, 1.0, 0.9))
        self.head = Entity(parent=self, position=(0, 1.45, 0), scale=(1.15, 0.95, 1.0))
        self.head.collider = BoxCollider(self.head, center=Vec3(0, 0, 0), size=Vec3(1, 1, 1))
        self.head.owner, self.head.is_head = self, True
        self.bar.y = 2.35
        self.play('holding-right')

    def play(self, name, loop=True):
        if name != self.anim:
            self.anim = name
            (self.actor.loop if loop else self.actor.play)(name)

    def update(self):
        if self.dead or game.state != 'playing':
            return
        to_player = player.position - self.position
        to_player.y = 0
        dist = to_player.length()
        d = to_player / dist if dist > 0.01 else Vec3(0, 0, 1)
        self.rotation_y = math.degrees(math.atan2(d.x, d.z))
        self.look_for_player(self.position + Vec3(0, 1.6, 0))

        moving = False
        if not self.sees or dist > self.keep_range:
            moving = self.walk(d)
        if self.sees and dist < 48:
            self.fire_cd -= time.dt
            if self.fire_cd <= 0:
                self.fire(self.position + Vec3(0, 1.0, 0) + d * 0.9, dist)
                self.anim = ''
                self.actor.play('holding-right-shoot')
        if moving:
            self.play('walk')
        elif not self.actor.getCurrentAnim():
            self.play('holding-right')
        self.keep_inside()

    def walk(self, d):
        """Walk toward the player; when blocked, side-step along the obstacle."""
        origin = self.position + Vec3(0, 0.6, 0)
        self.detour_t -= time.dt
        options = [self.detour, d] if self.detour_t > 0 else [d]
        side = Vec3(-d.z, 0, d.x) * random.choice((-1, 1))
        options += [side, -side]
        for direction in options:
            if not raycast(origin, direction, distance=1.1, traverse_target=level).hit:
                if direction is not d and self.detour_t <= 0:
                    self.detour, self.detour_t = direction, 0.9
                self.position += direction * self.speed * time.dt
                return True
        return False

    def die(self):
        self.collider = None
        self.head.collider = None
        self.anim = 'die'
        self.actor.play('die')
        Sound.play('enemy_destroy', 0.7)
        invoke(self.remove, delay=2.2)

    def remove(self):
        try:
            self.actor.cleanup()
        except Exception:
            pass
        destroy(self)


class Drone(Enemy):
    """Kenney's flying enemy from the FPS starter kit."""
    points = 75

    def __init__(self, position, wave):
        super().__init__(position=position + Vec3(0, random.uniform(3.5, 6), 0))
        self.setup(wave, 45)
        self.speed = random.uniform(3.5, 5.0)
        self.hover = self.y
        self.phase = random.uniform(0, 6)
        self.strafe = random.choice((-1, 1))
        self.body = Entity(parent=self, model=model('fps/enemy-flying.glb'), scale=1.6,
                           rotation_y=180, y=-0.5, shader=LIT)
        self.collider = BoxCollider(self, center=Vec3(0, 0.2, 0), size=Vec3(1.9, 1.5, 1.3))
        self.bar.y = 1.3

    def update(self):
        if game.state != 'playing':
            return
        if self.dead:
            self.y -= 9 * time.dt
            self.rotation_z += 400 * time.dt
            return
        to_player = player.position - self.position
        to_player.y = 0
        dist = to_player.length()
        d = to_player / dist if dist > 0.01 else Vec3(0, 0, 1)
        self.rotation_y = math.degrees(math.atan2(d.x, d.z))
        self.look_for_player(self.position)

        side = Vec3(-d.z, 0, d.x) * self.strafe
        move = side * 0.5
        if not self.sees or dist > self.keep_range:
            move += d
        elif dist < self.keep_range - 4:
            move -= d
        if raycast(self.position, move.normalized(), distance=2, traverse_target=level).hit:
            self.hover = min(self.hover + 6 * time.dt, 13)        # climb over obstacles
            self.strafe *= -1
        else:
            self.position += move * self.speed * time.dt
            self.hover = max(self.hover - 0.4 * time.dt, 3.5)
        self.phase += time.dt * 2.5
        self.y = lerp(self.y, self.hover + math.sin(self.phase) * 0.35, min(1, time.dt * 3))
        if self.sees and dist < 48:
            self.fire_cd -= time.dt
            if self.fire_cd <= 0:
                self.fire(self.position + d * 0.9, dist)
        self.keep_inside()

    def die(self):
        self.collider = None
        puff(self.world_position, color.hex('#ffb347'), count=7, size=0.9, spread=2.0)
        Sound.play('enemy_destroy', 0.8, 1.2)
        destroy(self, delay=0.8)


class Pickup(Entity):
    def __init__(self, position, kind):
        super().__init__(position=Vec3(position.x, 0.9, position.z))
        self.kind = kind
        rel, scale = ('platformer/coin.glb', 1.6) if kind == 'coin' else \
            ('fps/blaster-repeater.glb', 0.55)
        Entity(parent=self, model=model(rel), scale=scale, shader=LIT)
        Entity(parent=self, model='quad', texture=tex('sprites/blob_shadow.png'), rotation_x=90,
               y=-0.86, scale=1.3, color=color.rgba(1, 1, 1, 0.6))
        self.born = time.time()

    def update(self):
        self.rotation_y += 120 * time.dt
        if game.state != 'playing':
            return
        if time.time() - self.born > 25:
            game.pickups.remove(self)
            destroy(self)
        elif distance_xz(self.position, player.position) < 1.5 and abs(player.y - 0) < 3:
            if self.kind == 'coin':
                game.score += 50
                feed('+50 coin', YELLOW)
                Sound.play('coin', 0.7)
            else:
                game.reserve[1] += 40
                feed('+40 repeater ammo', color.hex('#8fd3ff'))
                Sound.play('weapon_change', 0.7)
            game.pickups.remove(self)
            destroy(self)


# ============================================================== game logic
class Game:
    def __init__(self):
        self.enemies, self.pickups = [], []
        self.state = 'menu'                 # menu | playing | paused | dead
        self.session = 0                    # invalidates timers from older games
        self.moving = False
        self.reset_stats()

    def reset_stats(self):
        self.health = 100
        self.ammo = [w.get('mag', 0) for w in WEAPONS]
        self.reserve = [w.get('reserve') or 0 for w in WEAPONS]
        self.weapon, self.last_weapon = 1, 0
        self.score = self.wave = self.kills = self.headshots = self.shots = self.hits = 0
        self.fire_cd = self.spray = self.kick = self.switch_cd = 0
        self.reloading = self.wave_pending = False
        self.last_hurt = -99
        self.was_grounded = True

    def clear(self):
        for e in self.enemies:
            e.remove() if isinstance(e, Soldier) else destroy(e)
        for p in self.pickups:
            destroy(p)
        self.enemies, self.pickups = [], []
        for line in feed_lines[:]:
            drop_feed(line)

    def start(self):
        self.clear()
        self.session += 1
        if current.get('key') != settings['map']:
            load_map(settings['map'])
        self.reset_stats()
        show_screen(None)
        self.state = 'playing'
        player.enabled = True
        player.position, player.rotation_y = current['spawn'], 0
        player.camera_pivot.rotation_x = 0
        player.camera_pivot.y = EYE_HEIGHT
        camera.position, camera.rotation = (0, 0, 0), (0, 0, 0)
        hud.enabled = holder.enabled = True
        mouse.locked = True
        center_text.text = sub_text.text = ''
        self.equip(1, instant=True)
        apply_settings()
        self.next_wave(self.session)

    def to_menu(self):
        self.clear()
        self.session += 1
        self.state = 'menu'
        player.enabled = False
        hud.enabled = holder.enabled = scoreboard.enabled = False
        mouse.locked = False
        Sound.loop('walking', False)
        show_screen(main_menu)

    # ---- waves
    def free_spot(self):
        limit = current.get('spawn_limit', current['half'] - 3)
        for _try in range(60):
            x, z = random.uniform(-limit, limit), random.uniform(-limit, limit)
            far = distance_xz(Vec3(x, 0, z), player.position) > min(17, limit * 0.8)
            hit = raycast(Vec3(x, 30, z), Vec3(0, -1, 0), distance=40, traverse_target=level)
            if far and hit.hit and hit.world_point.y < 0.3:
                break
        return Vec3(x, 0, z)

    def next_wave(self, session):
        if session != self.session or self.state == 'menu':
            return
        self.wave_pending = False
        self.wave += 1
        self.banner(f'WAVE {self.wave}', 'Eliminate all hostiles')
        Sound.play('ui_confirmation_001', 0.8)
        total = min(3 + self.wave, 12)
        drones = min(int(round(total * current['drones'])), total - 1) if self.wave > 1 else \
            (1 if current['drones'] > 0.5 else 0)
        for i in range(total):
            kind = Drone if i < drones else Soldier
            self.enemies.append(kind(self.free_spot(), self.wave))

    def banner(self, title, subtitle='', seconds=2.5):
        center_text.text, sub_text.text = title, subtitle
        invoke(self.clear_banner, title, delay=seconds)

    def clear_banner(self, title):
        if center_text.text == title:
            center_text.text = sub_text.text = ''

    # ---- weapons
    def equip(self, index, instant=False):
        if index == self.weapon and not instant:
            return
        if not instant:
            self.last_weapon = self.weapon
            Sound.play('weapon_change', 0.6)
        self.weapon = index
        self.reloading = False
        self.switch_cd = 0 if instant else 0.3
        self.spray = 0
        for i, w in enumerate(WEAPONS):
            w['entity'].enabled = i == index
        w = WEAPONS[index]
        holder.rotation_x = 0
        holder.y = -0.25
        holder.animate('y', 0, duration=0.2, curve=curve.out_quad)
        crosshair.texture = tex(w['cross'])
        weapon_text.text = w['name']
        for i, t in enumerate(slot_texts):
            t.color = YELLOW if i == index else color.gray

    def attack(self):
        w = WEAPONS[self.weapon]
        if self.reloading or self.fire_cd > 0 or self.switch_cd > 0:
            return
        self.fire_cd = w['rate']
        if w.get('melee'):
            return self.swing(w)
        if self.ammo[self.weapon] <= 0:
            Sound.play('ui_tick_001', 0.6)
            return self.reload()
        self.ammo[self.weapon] -= 1
        self.shots += 1
        Sound.play(w['sound'], 0.55, random.uniform(0.94, 1.06))

        muzzle_flash.enabled = True
        muzzle_flash.rotation_z = random.uniform(0, 360)
        invoke(setattr, muzzle_flash, 'enabled', False, delay=0.045)
        holder.z = -0.06
        holder.animate('z', 0, duration=0.1)
        player.camera_pivot.rotation_x -= w['kick']
        self.kick += w['kick']

        steady = (0.45 if held_keys['right mouse'] else 1) * (0.7 if held_keys['left control'] else 1)
        spread = (w['spread'] + min(self.spray, 8) * w['bloom']) * steady * (1.6 if self.moving else 1)
        self.spray += 1
        direction = (camera.forward + camera.right * random.uniform(-spread, spread)
                     + camera.up * random.uniform(-spread, spread)).normalized()
        hit = raycast(camera.world_position, direction, distance=160, ignore=[player])
        end = hit.world_point if hit.hit else camera.world_position + direction * 90
        tracer(muzzle.world_position, end, color.hex('#fff2b0'), 0.01)
        if hit.hit:
            self.resolve_hit(hit, w['damage'])
        if self.ammo[self.weapon] == 0:
            self.reload()

    def resolve_hit(self, hit, damage):
        target = hit.entity if isinstance(hit.entity, Enemy) else getattr(hit.entity, 'owner', None)
        if not target:
            puff(hit.world_point, color.hex('#fff2c4'), size=0.35)
            return
        headshot = getattr(hit.entity, 'is_head', False)
        self.hits += 1
        puff(hit.world_point, RED if headshot else YELLOW, count=3, size=0.4, spread=0.6)
        hitmarker.color = RED if headshot else color.white
        hitmarker.enabled = True
        invoke(setattr, hitmarker, 'enabled', False, delay=0.1)
        Sound.play('ui_tick_001', 0.5, 1.4 if headshot else 1.0)
        target.take_damage(damage * (2 if headshot else 1), headshot)

    def swing(self, w):
        Sound.play(w['sound'], 0.6, 1.3)
        sword = w['entity']
        sword.animate('rotation_x', 55, duration=0.1, curve=curve.out_quad)
        sword.animate('rotation_x', w['rot'].x, duration=0.25, delay=0.12)
        hit = raycast(camera.world_position, camera.forward, distance=w['reach'], ignore=[player])
        if hit.hit:
            self.shots += 1
            self.resolve_hit(hit, w['damage'])

    def reload(self):
        w = WEAPONS[self.weapon]
        if w.get('melee') or self.reloading or self.ammo[self.weapon] == w['mag']:
            return
        if w['reserve'] is not None and self.reserve[self.weapon] <= 0:
            return
        self.reloading = True
        Sound.play('ui_switch_002', 0.7)
        holder.animate('rotation_x', 40, duration=0.25)
        invoke(self.finish_reload, self.session, self.weapon, delay=w['reload'])

    def finish_reload(self, session, index):
        if session != self.session or not self.reloading or index != self.weapon:
            return
        w = WEAPONS[index]
        need = w['mag'] - self.ammo[index]
        take = need if w['reserve'] is None else min(need, self.reserve[index])
        self.ammo[index] += take
        if w['reserve'] is not None:
            self.reserve[index] -= take
        self.reloading = False
        Sound.play('ui_open_001', 0.6)
        holder.animate('rotation_x', 0, duration=0.2)

    # ---- player
    def damage_player(self, amount):
        if self.state != 'playing':
            return
        self.health -= amount
        self.last_hurt = time.time()
        Sound.play('land', 0.7, 0.8)
        damage_flash.alpha = 0.32
        damage_flash.animate('alpha', 0, duration=0.45)
        if self.health <= 0:
            self.health = 0
            self.game_over()

    def game_over(self):
        self.state = 'dead'
        player.enabled = False
        hud.enabled = holder.enabled = scoreboard.enabled = False
        mouse.locked = False
        Sound.loop('walking', False)
        Sound.play('fall', 0.8)
        best = settings['best'].get(current['key'], {})
        new_best = self.score > best.get('score', 0)
        if new_best:
            settings['best'][current['key']] = {'score': self.score, 'wave': self.wave}
            save_settings()
        over_title.text = 'NEW BEST SCORE!' if new_best else 'MISSION FAILED'
        over_stats.text = self.stats_text()
        show_screen(over_menu)

    def stats_text(self):
        accuracy = f'{100 * self.hits / self.shots:.0f}%' if self.shots else '-'
        best = settings['best'].get(current.get('key'), {}).get('score', 0)
        return (f"{MAPS[current['key']]['name']}\n{self.wave}\n{self.score}\n{self.kills}\n"
                f'{self.headshots}\n{accuracy}\n{max(best, self.score)}')

    def enemy_killed(self, enemy, headshot):
        if enemy in self.enemies:
            self.enemies.remove(enemy)
        self.kills += 1
        self.headshots += headshot
        self.score += enemy.points + (50 if headshot else 0)
        feed(f'You  >  {enemy.name_tag}' + ('   HEADSHOT' if headshot else ''),
             color.hex('#ff9a8a') if headshot else color.white)
        roll = random.random()
        if roll < 0.6:
            self.pickups.append(Pickup(enemy.position, 'ammo' if roll < 0.28 else 'coin'))
        if not self.enemies and not self.wave_pending:
            self.wave_pending = True
            bonus = 250 * self.wave
            self.score += bonus
            self.reserve[1] += 40
            self.banner('WAVE CLEARED', f'+{bonus} bonus   +40 ammo', 2.8)
            Sound.play('ui_confirmation_002', 0.8)
            invoke(self.next_wave, self.session, delay=3.5)

    def pause(self, paused):
        self.state = 'paused' if paused else 'playing'
        player.enabled = not paused
        mouse.locked = not paused
        hud.enabled = not paused
        scoreboard.enabled = False
        Sound.loop('walking', False)
        show_screen(pause_menu if paused else None)


game = Game()

# =================================================================== menus
# Layout follows the usual shooter pattern: a left-hand vertical menu over a live
# view of the map, a mission-select screen with a briefing panel, and one
# settings screen shared by the main menu and the pause menu.
dim = Entity(parent=camera.ui, model='quad', scale=(2, 1), z=1,
             color=color.rgba(0.03, 0.05, 0.1, 0.45), enabled=False)
BUTTON_TEX = {'blue': 'ui/blue_button00.png', 'yellow': 'ui/yellow_button00.png',
              'green': 'ui/green_button00.png', 'red': 'ui/red_button00.png',
              'grey': 'ui/grey_button00.png'}


class MenuButton(Button):
    """A Kenney UI-pack button that turns yellow on hover and clicks."""

    def __init__(self, parent, label, x, y, action, style='blue', width=0.34, height=0.088):
        super().__init__(parent=parent, model='quad', texture=tex(BUTTON_TEX[style]),
                         color=color.white, highlight_color=color.white,
                         pressed_color=color.light_gray, position=(x, y),
                         scale=(width, height), text=label, text_color=color.white)
        self.style, self.action = style, action
        self.text_entity.y = 0.06
        self.light = style in ('yellow', 'grey')
        self.text_entity.color = DARK if self.light else color.white

    def on_mouse_enter(self):
        super().on_mouse_enter()
        self.texture = tex(BUTTON_TEX['yellow'])
        self.text_entity.color = DARK
        Sound.play('ui_tick_001', 0.35)

    def on_mouse_exit(self):
        super().on_mouse_exit()
        self.texture = tex(BUTTON_TEX[self.style])
        self.text_entity.color = DARK if self.light else color.white

    def on_click(self):
        Sound.play('ui_click_001', 0.7)
        self.action()


def screen():
    return Entity(parent=camera.ui, enabled=False)


def title(parent, heading, subtitle=''):
    Text(parent=parent, text=heading, position=(-0.8, 0.43), scale=3.6)
    Entity(parent=parent, model='quad', color=YELLOW, scale=(0.34, 0.008), origin=(-0.5, 0),
           position=(-0.8, 0.315))
    if subtitle:
        Text(parent=parent, text=subtitle, position=(-0.8, 0.3), scale=1.1, color=YELLOW)


def panel(parent, x, y, w, h, heading=''):
    Entity(parent=parent, model='quad', color=PANEL, scale=(w, h), position=(x, y), z=0.1)
    Entity(parent=parent, model='quad', color=YELLOW, scale=(w, 0.008),
           position=(x, y + h / 2), z=0.05)
    if heading:
        Text(parent=parent, text=heading, position=(x - w / 2 + 0.03, y + h / 2 - 0.03),
             scale=1.3, color=YELLOW)


previous_screen = [None]


def show_screen(target):
    for s in screens:
        s.enabled = s is target
    dim.enabled = target is not None


def open_settings():
    previous_screen[0] = pause_menu if game.state == 'paused' else main_menu
    show_screen(settings_menu)


def close_settings():
    save_settings()
    Sound.play('ui_back_001', 0.6)
    show_screen(previous_screen[0])


def back_to_main():
    Sound.play('ui_back_001', 0.6)
    show_screen(main_menu)


# ---- main menu
main_menu = screen()
title(main_menu, 'ARENA SHOOTER', 'WAVE SURVIVAL')
MenuButton(main_menu, 'PLAY', -0.63, 0.17, lambda: open_map_select())
MenuButton(main_menu, 'SETTINGS', -0.63, 0.07, open_settings)
MenuButton(main_menu, 'HOW TO PLAY', -0.63, -0.03, lambda: show_screen(help_menu))
MenuButton(main_menu, 'CREDITS', -0.63, -0.13, lambda: show_screen(credits_menu))
MenuButton(main_menu, 'QUIT', -0.63, -0.23, application.quit, style='red')
Text(parent=main_menu, text='Assets: Kenney (CC0)  |  Engine: Ursina', position=(-0.8, -0.45),
     scale=0.8, color=color.light_gray)

# ---- mission (map) select
map_menu = screen()
title(map_menu, 'SELECT MAP', 'CHOOSE YOUR BATTLEGROUND')
map_buttons = {}
panel(map_menu, 0.42, 0.02, 0.78, 0.5, 'BRIEFING')
map_name = Text(parent=map_menu, position=(0.06, 0.18), scale=2.4)
map_text = Text(parent=map_menu, position=(0.06, 0.09), scale=1.1, line_height=1.3,
                color=color.light_gray)
map_best = Text(parent=map_menu, position=(0.06, -0.06), scale=1.1, color=YELLOW)


def select_map(key):
    settings['map'] = key
    if current.get('key') != key:
        load_map(key)
    info = MAPS[key]
    map_name.text, map_text.text = info['name'], info['text']
    best = settings['best'].get(key)
    map_best.text = (f"BEST   {best['score']} points   wave {best['wave']}" if best
                     else 'BEST   no record yet')
    for k, b in map_buttons.items():
        b.style = 'green' if k == key else 'blue'
        b.texture = tex(BUTTON_TEX[b.style])


def open_map_select():
    select_map(settings['map'])
    show_screen(map_menu)


def cycle_difficulty():
    names = list(DIFFICULTY)
    settings['difficulty'] = names[(names.index(settings['difficulty']) + 1) % len(names)]
    difficulty_button.text = f"DIFFICULTY:  {settings['difficulty']}"
    difficulty_button.text_entity.y = 0.06
    difficulty_button.text_entity.color = DARK


def start_from_menu():
    save_settings()
    game.start()


for i, key in enumerate(MAP_ORDER):
    map_buttons[key] = MenuButton(map_menu, MAPS[key]['name'], -0.63, 0.17 - i * 0.1,
                                  lambda k=key: select_map(k))
difficulty_button = MenuButton(map_menu, f"DIFFICULTY:  {settings['difficulty']}", 0.24, -0.16,
                               cycle_difficulty, style='grey', width=0.36)
MenuButton(map_menu, 'START', 0.62, -0.16, start_from_menu, style='green', width=0.3)
MenuButton(map_menu, 'BACK', -0.63, -0.23, back_to_main, style='grey')

# ---- settings (shared by main menu and pause menu)
settings_menu = screen()
title(settings_menu, 'SETTINGS')
panel(settings_menu, 0.0, -0.03, 1.0, 0.5)


def apply_settings():
    player.mouse_sensitivity = Vec2(settings['sensitivity'], settings['sensitivity'])
    if not held_keys['right mouse']:
        camera.fov = settings['fov']
    for name, pool in Sound.pools.items():
        if name.startswith('loop:'):
            for clip in pool:
                clip.volume = 0.5 * settings['volume']


def setting_slider(label, key, low, high, y, step=1):
    Text(parent=settings_menu, text=label, position=(-0.44, y + 0.012), scale=1.15)
    s = Slider(min=low, max=high, default=settings[key], step=step, dynamic=True,
               parent=settings_menu, position=(-0.05, y), scale=0.9)
    s.knob.color = YELLOW

    def changed():
        settings[key] = round(s.value, 2)
        apply_settings()
    s.on_value_changed = changed
    return s


setting_slider('MOUSE SENSITIVITY', 'sensitivity', 10, 100, 0.14)
setting_slider('SOUND VOLUME', 'volume', 0, 1, 0.06, step=0.05)
setting_slider('FIELD OF VIEW', 'fov', 70, 110, -0.02)


def toggle_fullscreen():
    settings['fullscreen'] = not settings['fullscreen']
    window.fullscreen = settings['fullscreen']
    fullscreen_box.texture = tex('ui/blue_boxCheckmark.png' if settings['fullscreen']
                                 else 'ui/grey_box.png')


Text(parent=settings_menu, text='FULLSCREEN', position=(-0.44, -0.088), scale=1.15)
fullscreen_box = Button(parent=settings_menu, model='quad', color=color.white,
                        highlight_color=YELLOW, position=(-0.02, -0.1), scale=(0.05, 0.048),
                        texture=tex('ui/grey_box.png'), on_click=toggle_fullscreen)
MenuButton(settings_menu, 'BACK', 0.0, -0.21, close_settings, style='grey', width=0.3)

# ---- how to play
help_menu = screen()
title(help_menu, 'HOW TO PLAY')
panel(help_menu, 0.0, -0.02, 1.0, 0.56)
Text(parent=help_menu, position=(-0.44, 0.22), scale=1.1, line_height=1.42,
     text='W A S D\nMouse\nLeft mouse\nRight mouse\nR\n1 / 2 / 3  or  wheel\nQ\nSpace\n'
          'Shift\nLeft Ctrl\nTab\nEsc')
Text(parent=help_menu, position=(-0.12, 0.22), scale=1.1, line_height=1.42,
     color=color.light_gray,
     text='Move\nAim\nShoot (hold with the Repeater)\nAim down sights - steadier shots\n'
          'Reload\nBlaster / Repeater / Sword\nPrevious weapon\nJump\nSprint\nCrouch\n'
          'Scoreboard\nPause')
MenuButton(help_menu, 'BACK', 0.0, -0.37, back_to_main, style='grey', width=0.3)

# ---- credits
credits_menu = screen()
title(credits_menu, 'CREDITS')
panel(credits_menu, 0.0, -0.02, 1.2, 0.56)
Text(parent=credits_menu, position=(-0.56, 0.22), scale=1.0, line_height=1.4,
     text='3D MODELS, SPRITES AND SOUNDS  -  Kenney (www.kenney.nl), CC0\n'
          '    Starter Kit FPS: blasters, drone, platforms, walls, HUD sprites, sounds\n'
          '    Mini Arena: soldier character, arena walls, columns, statue, sword\n'
          '    Starter Kit City Builder: buildings, roads, trees, city ambience\n'
          '    Starter Kit 3D Platformer: coin, sounds\n'
          '    UI Pack: buttons and checkboxes        Interface Sounds: menu sounds\n\n'
          'FONT  -  Lilita One by Juan Montoreano, SIL Open Font License 1.1\n\n'
          'ENGINE  -  Ursina / Panda3D')
MenuButton(credits_menu, 'BACK', 0.0, -0.37, back_to_main, style='grey', width=0.3)

# ---- pause menu
pause_menu = screen()
title(pause_menu, 'PAUSED')
MenuButton(pause_menu, 'RESUME', -0.63, 0.17, lambda: game.pause(False), style='green')
MenuButton(pause_menu, 'RESTART', -0.63, 0.07, lambda: game.start())
MenuButton(pause_menu, 'SETTINGS', -0.63, -0.03, open_settings)
MenuButton(pause_menu, 'MAIN MENU', -0.63, -0.13, lambda: game.to_menu())
MenuButton(pause_menu, 'QUIT', -0.63, -0.23, application.quit, style='red')

# ---- game over
over_menu = screen()
title(over_menu, 'YOU DIED')
over_title = Text(parent=over_menu, text='', position=(-0.8, 0.3), scale=1.1, color=YELLOW)
panel(over_menu, 0.42, 0.02, 0.6, 0.46, 'RESULTS')
Text(parent=over_menu, position=(0.16, 0.16), scale=1.15, line_height=1.45,
     text='Map\nWave\nScore\nEliminations\nHeadshots\nAccuracy\nBest score')
over_stats = Text(parent=over_menu, position=(0.48, 0.16), scale=1.15, line_height=1.45,
                  color=color.light_gray)
MenuButton(over_menu, 'PLAY AGAIN', -0.63, 0.17, lambda: game.start(), style='green')
MenuButton(over_menu, 'CHANGE MAP', -0.63, 0.07, lambda: (game.to_menu(), open_map_select()))
MenuButton(over_menu, 'MAIN MENU', -0.63, -0.03, lambda: game.to_menu())
MenuButton(over_menu, 'QUIT', -0.63, -0.13, application.quit, style='red')

screens = [main_menu, map_menu, settings_menu, help_menu, credits_menu, pause_menu, over_menu]

if settings['fullscreen']:
    settings['fullscreen'] = False
    toggle_fullscreen()
if settings['map'] not in MAPS:
    settings['map'] = MAP_ORDER[0]
load_map(settings['map'])
game.to_menu()
apply_settings()


# ============================================================ engine hooks
def update():
    for cloud in decor.children:
        if hasattr(cloud, 'drift'):
            cloud.x += cloud.drift * time.dt
            if cloud.x > 110:
                cloud.x = -110
    if game.state == 'menu':                      # slow fly-around behind the menu
        t = time.time() * 0.1
        far, high = current.get('cam', (0.95, 0.5))
        r, h = current['half'] * far, current['half'] * high
        camera.world_position = Vec3(math.cos(t) * r, h, math.sin(t) * r)
        camera.world_rotation = (math.degrees(math.atan2(h - 2, r)),
                                 math.degrees(math.atan2(-math.cos(t), -math.sin(t))), 0)
        return
    if game.state != 'playing':
        return

    dt = time.dt
    w = WEAPONS[game.weapon]
    game.fire_cd -= dt
    game.switch_cd -= dt
    game.spray = max(0, game.spray - dt * 9)
    recover = min(game.kick, dt * 6)              # recoil settles back down
    player.camera_pivot.rotation_x += recover
    game.kick -= recover

    crouching = held_keys['left control']
    aiming = held_keys['right mouse'] and not w.get('melee')
    game.moving = bool(held_keys['w'] or held_keys['a'] or held_keys['s'] or held_keys['d'])
    sprinting = held_keys['shift'] and game.moving and not crouching and not aiming
    player.speed = CROUCH_SPEED if crouching else SPRINT_SPEED if sprinting else WALK_SPEED
    player.camera_pivot.y = lerp(player.camera_pivot.y,
                                 CROUCH_HEIGHT if crouching else EYE_HEIGHT, min(1, dt * 12))
    camera.fov = lerp(camera.fov, settings['fov'] * (0.68 if aiming else 1), min(1, dt * 14))
    aim_scale = 0.6 if aiming else 1
    player.mouse_sensitivity = Vec2(settings['sensitivity'] * aim_scale,
                                    settings['sensitivity'] * aim_scale)
    if w['auto'] if 'auto' in w else False:
        if held_keys['left mouse']:
            game.attack()

    # weapon sway / aim-down-sights position
    bob = math.sin(time.time() * (12 if sprinting else 8)) * 0.008 if game.moving and player.grounded else 0
    target_x = -w['pos'].x * 0.82 if aiming else bob * 0.6
    target_y = 0.06 if aiming else bob
    holder.x = lerp(holder.x, target_x, min(1, dt * 14))
    if not game.reloading and game.switch_cd <= 0:
        holder.y = lerp(holder.y, target_y, min(1, dt * 14))

    # footsteps, landing
    Sound.loop('walking', game.moving and player.grounded, 0.5 if not crouching else 0.2)
    if player.grounded and not game.was_grounded:
        Sound.play('land', 0.5)
    game.was_grounded = player.grounded

    # health regenerates after a few seconds without being hit
    if game.health < 100 and time.time() - game.last_hurt > 5:
        game.health = min(100, game.health + 14 * dt)

    if player.y < -18:                            # fell off the map
        player.position = current['spawn']
        game.damage_player(35)

    # HUD
    gap = 0.05 + min(game.spray, 8) * 0.006 + (0.012 if game.moving else 0)
    crosshair.scale = lerp(crosshair.scale_x, gap * (0.75 if aiming else 1), min(1, dt * 18))
    hp = int(math.ceil(game.health))
    hp_text.text = str(hp)
    hp_bar.scale_x = 0.19 * game.health / 100
    hp_bar.color = RED if hp <= 30 else color.hex('#6fd35a')
    if w.get('melee'):
        ammo_text.text, reserve_text.text = '-', ''
    else:
        ammo_text.text = '--' if game.reloading else str(game.ammo[game.weapon])
        ammo_text.color = RED if game.ammo[game.weapon] <= w['mag'] * 0.2 else color.white
        reserve_text.text = 'RELOADING' if game.reloading else \
            ('/ INF' if w['reserve'] is None else f'/ {game.reserve[game.weapon]}')
    top_text.text = f'WAVE {game.wave}    |    HOSTILES {len(game.enemies)}'
    score_text.text = f'SCORE {game.score}'

    # radar: dots are placed relative to where the player is facing
    heading = math.radians(player.rotation_y)
    for i, dot in enumerate(radar_dots):
        if i >= len(game.enemies):
            dot.enabled = False
            continue
        rel = game.enemies[i].position - player.position
        rx = rel.x * math.cos(heading) - rel.z * math.sin(heading)
        rz = rel.x * math.sin(heading) + rel.z * math.cos(heading)
        dist = math.hypot(rx, rz)
        scale = min(dist, RADAR_RANGE) / RADAR_RANGE * RADAR_R / max(dist, 0.001)
        dot.enabled = True
        dot.position = (rx * scale, rz * scale, -0.01)
        dot.color = color.hex('#ffb347') if isinstance(game.enemies[i], Drone) else RED

    scoreboard.enabled = bool(held_keys['tab'])
    if scoreboard.enabled:
        board_right.text = game.stats_text()


def input(key):
    if key == 'escape':
        if game.state == 'playing':
            game.pause(True)
        elif game.state == 'paused':
            game.pause(False)
        elif settings_menu.enabled:
            close_settings()
        elif game.state == 'menu' and not main_menu.enabled:
            back_to_main()
        return
    if game.state != 'playing':
        if key == 'enter' and game.state == 'dead':
            game.start()
        return
    if key == 'left mouse down':
        game.attack()
    elif key == 'r':
        game.reload()
    elif key in ('1', '2', '3'):
        game.equip(int(key) - 1)
    elif key == 'q':
        game.equip(game.last_weapon)
    elif key == 'scroll up':
        game.equip((game.weapon - 1) % len(WEAPONS))
    elif key == 'scroll down':
        game.equip((game.weapon + 1) % len(WEAPONS))
    elif key == 'space' and player.grounded:
        Sound.play(random.choice(('jump_a', 'jump_b', 'jump_c')), 0.5)


app.run()
