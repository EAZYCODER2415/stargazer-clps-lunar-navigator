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

### Data scripts

The Python data scripts live in `backend/`. Run them from the top of the repo:

```bash
pip install requests numpy
python backend/ephemeris_fetch.py                        # Sun/Earth positions from JPL Horizons -> ephemeris_long/ and frontend/src/data/ephemeris/
python backend/cost_mc.py ephemeris_long/malapert.json   # cost model -> ephemeris_long/malapert_cost.json
```

`ephemeris_fetch.py` overwrites the ephemeris files the frontend reads, so check the visibility hours after re-running it.

### Validation

From `frontend`, run:

```bash
npm run lint
npm run build
```
