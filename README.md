# Orbital Mechanics Simulations

Interactive physics simulations for learning orbital dynamics. All computation runs client-side.

## Simulations

| Simulation | Physics Engine | Description |
|---|---|---|
| **Kepler's Orbits** | Universal Kepler solver (Stumpff + Lagrange) | Two-body orbits with adjustable eccentricity, reference frames, vis-viva |
| **Three-Body Problem** | N-body RK4 integration | Chaotic gravitational interactions, drag bodies, presets (Figure-8, etc.) |

## Controls

| Key | Action |
|---|---|
| Space | Play / Pause |
| R | Reset |
| S | Step |
| F | Fit to screen |
| Scroll | Zoom from center |
| Drag canvas | Pan |
| Drag body (3-body) | Reposition |

## Run Locally

```bash
python3 -m http.server 8000
# or: npx serve .
```

## Deploy

Static site — deploy to Render, Vercel, Netlify, or GitHub Pages as-is (no build step).