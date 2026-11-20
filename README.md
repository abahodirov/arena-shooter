<div align="center">

# 🎯 Arena Shooter

---

**A 3D wave-survival first-person shooter you run on your own machine.**
**Hold the Colosseum, the Sky Garden or Downtown — every wave sends one more.**

[![Download](https://img.shields.io/badge/%E2%96%B6%20DOWNLOAD-24292f?style=for-the-badge)](https://github.com/abahodirov/arena-shooter/archive/refs/heads/main.zip)&nbsp;[![Game page](https://img.shields.io/badge/GAME%20PAGE-2ea44f?style=for-the-badge)](https://abahodirov.github.io/arena-shooter)

![license MIT](https://img.shields.io/badge/license-MIT-blue)
![python 3.9+](https://img.shields.io/badge/python-3.9%2B-3776ab)
![engine Ursina](https://img.shields.io/badge/engine-Ursina-2ea44f)
![dependencies 1](https://img.shields.io/badge/dependencies-1-lightgrey)
![OpenGL 3D](https://img.shields.io/badge/OpenGL-3D-ff8c00)

![Arena Shooter - wave 1 in the Colosseum arena](docs/img/screenshot.png)

</div>

## Features

- **Three arenas** — Colosseum (walled sand arena with columns for cover), Sky Garden (floating islands above the clouds, no walls), and Downtown (a city block with long sight lines down the streets)
- **Three weapons** — a precise semi-auto Blaster, a full-auto Repeater, and a one-swing Sword, each with its own crosshair, spread and recoil
- **Endless waves** — every wave adds another hostile up to 12 at once, mixing ground soldiers with flying drones that scale in health as you go
- **Three difficulties** — Easy, Normal and Hard change enemy accuracy, damage and health
- **Scoring with headshots** — 100 points per soldier, 75 per drone, double damage and +50 for a headshot, plus a 250 × wave clear bonus
- **Pickups** — coins for score and ammo crates for the Repeater drop from fallen enemies
- **Full settings menu** — mouse sensitivity, FOV, volume and fullscreen, saved between sessions along with a per-map personal best
- **End-of-run scoreboard** — wave reached, kills, headshots and shot accuracy

## Requirements

- Python 3.9 or newer (developed on 3.11)
- Windows, macOS or Linux with a GPU that supports OpenGL 3.2+

## Install & run

```bash
git clone https://github.com/abahodirov/arena-shooter.git
cd arena-shooter
pip install -r requirements.txt
python fps_game.py
```

`fps_game.py` installs Ursina itself on first run if it is missing, so `python fps_game.py` alone also works. Keep the `assets` folder next to the script — the game exits with an error if it is missing.

> **Note:** this is a desktop game. Ursina runs on [Panda3D](https://www.panda3d.org/), which has no WebAssembly build, so the game cannot be played in a browser — it has to be downloaded and run locally.

## Controls

| Action | Key |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump | `Space` |
| Look | Mouse |
| Fire / swing | Left mouse |
| Reload | `R` |
| Select weapon | `1` `2` `3` |
| Previous weapon | `Q` |
| Cycle weapons | Mouse wheel |
| Pause / back | `Esc` |
| Restart after dying | `Enter` |

## Project layout

```
fps_game.py        the whole game - engine setup, maps, weapons, enemies, HUD and menus
requirements.txt   the single dependency (ursina)
assets/            models, sprites, sounds, UI art and the font
docs/              the GitHub Pages game page
settings.json      created on first run: your settings and high scores (not tracked)
```

## Credits

All art and audio are free third-party assets — nothing in `assets/` was drawn or recorded for this game. Full attribution is in [assets/CREDITS.txt](assets/CREDITS.txt).

- **3D models, sprites, UI art and sounds** — [Kenney](https://www.kenney.nl) ([CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/))
- **Font** — Lilita One by Juan Montoreano ([SIL Open Font License 1.1](assets/fonts/OFL-license.txt))
- **Engine** — [Ursina](https://www.ursinaengine.org/) (MIT) on [Panda3D](https://www.panda3d.org/) (BSD)

## License

The game code is released under the [MIT License](LICENSE). The bundled assets keep their own licenses — see [NOTICE](NOTICE) for the third-party notices and [assets/CREDITS.txt](assets/CREDITS.txt) for the full per-folder attribution.
