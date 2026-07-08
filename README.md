# Orbital Mechanics Simulations

Interactive physics simulations for learning orbital dynamics. All computation runs client-side.

## Simulations

| Simulation | Physics Engine | Description |
|---|---|---|
| **Kepler's Orbits** | Universal Kepler solver (Stumpff + Lagrange) | Two-body orbits with adjustable eccentricity, reference frames, vis-viva |
| **Two-Body Problem** | N-body Leapfrog integration | Gravitational interactions, drag bodies, add bodies |
| **Three-Body Effective Potential** | N-body Leapfrog integration | Per-body U_eff with 3D surface + bar graph |

## Controls

| Key/Mouse | Action |
|---|---|
| Space | Play / Pause |
| R | Reset |
| S | Step one frame |
| F | Fit 2D view to screen |
| Scroll | Zoom |
| Drag on 2D canvas | Pan (or reposition body if a body is under the cursor) |
| Right-click on 2D canvas | Add a body |
| Drag on 3D surface | Orbit camera |
| Right-click on 3D surface | Pan camera |
| Scroll on 3D surface | Zoom |

## Run Locally

```bash
python3 -m http.server 8000
# or: npx serve .
```

## Deploy

Static site — deploy to Render, Vercel, Netlify, or GitHub Pages as-is (no build step).