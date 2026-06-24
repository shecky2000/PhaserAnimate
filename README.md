# Animate (Phaser) — OBS Browser Source

This is a browser-only Phaser 3.60 port of Animate intended for OBS Browser Source. It preserves the core flow and UI patterns from the Godot client, reusing the same ShowBlam HTTP endpoints.

## Quick Start
- Open `index.html` in a modern browser or load it in OBS as a Browser Source.
- Pass `my_key` via URL, e.g. `index.html?my_key=S7V74GMC3Mwww`.

## Features Implemented
- Initialization button that posts to `animate_init`.
- Promo text rotator.
- Tabbed toolbar with tween in/out and active-tab slide tracking.
- Polling loop with simple watchdog (parity with existing logic).

## Next Steps
- Map sounds and real textures; refine easing to match Godot feel.
- Implement RantViewer UI and actions in Phaser.
- Add build script (Vite/Rollup) if bundling is preferred; CDN build works for OBS.
