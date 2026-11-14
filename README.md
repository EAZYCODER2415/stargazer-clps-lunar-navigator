# clps_lunar_mission_browser

## Frontend foundations

The prototype is a React/Vite lunar landing-site navigator. `frontend/src/App.jsx` owns shared mission time, selected site, visibility settings, and camera intent. `LunarScene3D.jsx` renders the WebGL scene with Three.js, while `Header`, `CameraControls`, `ToolDock`, `TimelineDeck`, and `ComparisonPanel` provide the planning UI.

### Interaction model

- The timeline represents one 29.53-day synodic lunar day.
- Play, step, scrubbing, sunrise/Earth-rise jumps, and best-overlap all update the same global time state.
- Arrow keys and WASD pan the camera; the controls expose Look at Sun/Earth and invert-look behavior.
- Gold and blue timeline bands represent simplified Sun and Earth visibility windows.
- Site comparison is a frontend prototype using the current simplified ephemeris.

### Data boundary

The frontend currently uses deterministic demonstration ephemeris calculations. Real JPL Horizons positions, LOLA horizon masks, and near-field heightmaps are backend-dependent and must not be represented as production data until those services are connected. The visible crater rim, terrain, Earth clouds, Sun rays, and sky grid are lightweight visual mockups for interaction testing.

### Validation

From `frontend`, run:

```bash
npm run lint
npm run build
```
