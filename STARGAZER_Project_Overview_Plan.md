# Stargazer — Project Overview & Action Plan

**Project:** Stargazer, a lunar landing-site explorer and analysis toolkit  
**Context:** NASA Space Apps Challenge 2026  
**Direction updated:** 14 November 2026, based on the team's discussion of user roles and the current prototype.

> This document distinguishes the working prototype from the team's target product. Planned capabilities are not claims about the current implementation.

## 1. Project at a glance

Stargazer helps people understand how lunar terrain and celestial geometry affect sunlight and direct-to-Earth visibility at candidate landing sites. It is designed for a broad audience, from educators and the public to mission planners and technical researchers.

The product has two connected surfaces:

1. **A visual website** for exploring sites and understanding the results without specialist tools.
2. **A Python library and CLI** for technical users who need the underlying calculations and data in their own workflows.

Both surfaces should use the same documented calculation methods and data. The website's backend/API is part of this project and serves the website and technical interfaces; the team clarified that a separate, unrelated API product is not being proposed.

## 2. Users and product shape

| Audience | What they need from Stargazer |
| --- | --- |
| Educators and general public | An intuitive way to explore the lunar surface and see why lighting and Earth visibility change. |
| Non-technical mission-planning stakeholders | Clear site comparisons, readable visibility windows, and explainable assumptions. |
| Scientists and engineers | Terrain-aware geometry, time-series data, source and method details, and reproducible outputs. |
| Developers and data users | A Python API/CLI for querying the same site and time analysis used by the website. |

The website should make the visual story accessible first and provide deeper charts and details when users need them. The library/CLI should expose data directly rather than requiring users to interpret a 3D scene.

## 3. Website experience

The website is intended to have three primary experiences, with cost estimates available as an analysis layer.

### 3.1 Lunar surface explorer

Provide a Google Earth or Street View-like way to inspect candidate landing sites from the surface. The target is recognizable local terrain driven by NASA lunar elevation data, with LOLA/DEM products investigated as the terrain source. Users should be able to select a site, orient themselves, and see the Sun and Earth in context.

The existing surface scene is a visual prototype. Its local terrain is procedurally generated and must not be described as a LOLA-derived terrain model yet. The required elevation product, coverage, resolution, processing, and rendering path still need to be selected and documented.

### 3.2 Sun and Earth visibility analysis

Provide clear 2D time-series graphs for sunlight and Earth visibility across a lunar day, including comparisons between candidate sites and, where supported, dates. The intended reference is the team's earlier comparison-oriented graph prototype.

The current prototype has a **Compare sites** action and a comparison panel with summary values. The agreed direction is to grow this into a dedicated graph view or tab, with a full-screen option for detailed visualizations. Keep comparison results tied to the same site, date, and calculation pipeline as the rest of the application.

### 3.3 Celestial-motion overview

Make an attractive, immediately understandable 3D overview a prominent first impression. Show the Moon stationary while the Sun and Earth appear to move around it, so users can quickly grasp their relative apparent motion. This is an overview of celestial geometry, not a replacement for the site-level terrain analysis.

The current 3D prototype is a lunar surface view with Sun and Earth objects. The stationary-Moon orbital overview and its presentation as the opening screen are target behavior and should be treated as planned until implemented.

### 3.4 Cost estimates

Add financial cost estimates as a decision-support feature. Since costs are uncertain and depend on assumptions, represent them with probability distributions or ranges rather than an unsupported single precise value. State the input assumptions, source data, and uncertainty. Do not imply a mission-grade estimate until the model and inputs are defensible.

## 4. Python library, CLI, and project API

The technical interface should expose the core site/time analysis available to the website. Initial outputs identified by the team are:

- Earth visibility intervals and duration.
- Sun visibility intervals and duration.
- Solar elevation angle at a site and time.
- Site/time financial cost estimates, including uncertainty when supported.
- The data and metadata needed to interpret those results, including coordinates, units, sources, and method assumptions.

The Python library should be importable in other code; the CLI should make common queries usable from a terminal. The project API should provide the website and other clients with the same capabilities where appropriate. Agree on one calculation pipeline so website, library, CLI, and API results do not diverge.

Potential workflow shape (names and schemas remain to be agreed): choose a site and time range, request visibility and elevation outputs, and retrieve the source/method metadata alongside the values. Prioritize a small documented set of candidate sites before generalizing to arbitrary lunar coordinates.

## 5. Core user workflow and shared concepts

1. Choose a candidate lunar landing site and analysis start time.
2. Explore the location in the surface view or begin with the celestial-motion overview.
3. Inspect Sun and Earth visibility over a 29.53-day interval.
4. Compare sites in the graph view and understand the differences.
5. Review solar elevation, visibility periods, and any available cost estimate with its uncertainty and assumptions.
6. Technical users retrieve the same analysis through the Python library, CLI, or project API.

Key terms:

- **Elevation:** angle above the local horizon; 0° is the horizon and 90° is overhead.
- **Azimuth:** direction around the horizon, from 0° to 360° under a documented convention.
- **Ephemeris:** positions of celestial bodies over time.
- **Visibility interval:** a time period when the Sun or Earth clears the relevant terrain horizon.
- **Horizon profile/mask:** terrain elevation as a function of direction from a site.
- **Uncertainty distribution:** a range of plausible cost outcomes under stated assumptions, rather than a falsely precise point estimate.

Sun visibility does not by itself calculate electrical power. Earth visibility does not by itself prove a working radio link. Use geometric visibility terminology unless power-system and communications link-budget models are actually implemented.

## 6. Data and calculation approach

### Candidate inputs

| Purpose | Candidate source/approach | Work still required |
| --- | --- | --- |
| Lunar terrain | NASA LOLA elevation products / DEM | Select product, verify coverage and resolution, document projection and processing. |
| Sun/Earth positions | JPL Horizons for reference; choose and document the runtime calculation pipeline | Validate sample timestamps and define accuracy tolerances. |
| Candidate sites | NASA Artemis/CLPS public materials and other traceable sources | Verify each site's name, coordinates, and source. |
| Cost estimates | Traceable mission, launch, logistics, or other relevant inputs | Define scope, assumptions, distributions, and limitations with the team. |

Do not treat a source as integrated merely because it is listed here. Keep source metadata with derived results.

### Terrain and visibility method

The intended terrain workflow is to derive a local terrain representation and a horizon profile for each supported site, then compare the Sun/Earth direction to the terrain horizon at that azimuth:

```text
Geometrically visible when: body elevation > terrain horizon elevation at its azimuth
Terrain-obstructed when:    body elevation <= terrain horizon elevation at its azimuth
```

Document sampling, interpolation, coordinate conventions, observer height, and whether apparent disc size is included. A 360-bin horizon profile and a local heightmap are candidate outputs from the earlier plan; confirm that they fit the selected data and rendering approach.

### Shared time model

Use one analysis timestamp and a 29.53-day lunar-day interval across the website's scene, charts, summaries, and comparison. The library, CLI, and API should accept and return explicit timestamps and time standards. Existing frontend playback and timeline are prototypes based on simplified demonstration ephemeris; they are not yet evidence of a validated scientific pipeline.

## 7. Current project state (repository review, 14 November 2026)

### Implemented in the frontend prototype

- React/Vite application with a Three.js lunar surface scene.
- Three selectable demonstration locations: Malapert Mountain/Massif, Shackleton Crater, and Wiechert Circle.
- Shared time state, playback, stepping, a 29.53-day timeline, visibility bands, and next-transition navigation using local demonstration calculations.
- Sun/Earth scene objects, camera controls, and a site comparison panel showing prototype visibility summaries.

### Not yet present or not verified in this repository

- The backend directory contains only its ignore file; no backend service, API, Python library, or CLI implementation was found in this review.
- The frontend ephemeris explicitly describes itself as simplified demonstration logic.
- The displayed local terrain is procedurally generated in the scene, not connected to a verified LOLA DEM.
- The site comparison is a panel, not the proposed dedicated graph tab/full-screen visualization.
- The stationary-Moon celestial overview is not the current opening experience.
- Probabilistic cost estimation is not implemented.
- No independent validation of terrain, ephemeris, visibility outputs, or cost estimates was found.

These points describe the repository inspected for this update. Recheck status as the team integrates work.

## 8. Priorities for the hackathon build

### P0 — coherent, honest demo

- Keep one end-to-end site/time flow usable and visually clear.
- Make current prototype/demo data limitations visible wherever results could be mistaken for validated NASA-derived outputs.
- Ensure the scene, timeline, summaries, and comparison use the same timestamp and calculations.
- Choose one small set of candidate sites and cite their coordinates.
- Decide and document the terrain and ephemeris plan; integrate actual source data only if it can be done and checked in time.
- Prepare a compelling opening overview and a clear path from it into site analysis.

### P1 — target product capabilities

- Terrain-backed surface explorer using a selected NASA elevation product.
- Dedicated 2D Sun/Earth graph view with site comparison and full-screen layout.
- Stationary-Moon overview with apparent Sun/Earth motion.
- Project API plus an initial Python library/CLI path to core analysis.
- Initial cost model expressed as a distribution/range with transparent assumptions.

### P2 — extensions

- More sites, date scenarios, terrain coverage, and arbitrary coordinate support.
- Explainable terrain obstruction and site-shift exploration.
- Scenario sharing/export, richer metadata, and advanced cost sensitivity analysis.

Sequence work so a feature is not presented as complete until integrated and its outputs are appropriately checked.

## 9. Team ownership and handoffs

The earlier team plan assigns Liam to backend/data processing, Thames to the React/Three.js frontend, Jason to visual and slide design, Jonny and Abdur to data analysis (with cost work proposed), and William to public-facing messaging. Confirm these assignments with the team against the latest roles discussed with Prof. Lee; this overview does not assume the earlier division is final.

Handoffs to settle:

- Data research → backend: source files, site coordinates, metadata, and quality notes.
- Backend/API → frontend: endpoints or package interface, schemas, units, coordinate conventions, and error handling.
- Calculation owners → website and Python/CLI: same formulas, sample cases, and versioning.
- Cost owners → product: estimate scope, input provenance, distributions, and plain-language caveats.
- Technical team → demo/presentation: screenshots and claims that match what is implemented and checked.

## 10. Integration and validation checklist

Agree and record:

- Coordinate frame; latitude/longitude convention; azimuth zero and direction; elevation convention; units; time standard.
- Site observer height; terrain product and processing; horizon profile bins/interpolation; heightmap extent and projection.
- Ephemeris source/runtime method, API/package schema, versioning, and missing-data behavior.
- Cost model scope, input sources, probability distributions, and what the estimate does not include.
- Example site/time cases and acceptable comparison tolerances.

Minimum checks before describing outputs as validated:

1. Verify candidate site coordinates against cited sources.
2. Record the LOLA product and terrain processing, if integrated.
3. Compare selected Sun/Earth positions with an independent reference such as JPL Horizons.
4. Check a clear and an obstructed terrain direction against a known horizon profile.
5. Confirm scene, graphs, summary, comparison, and technical interfaces agree at identical site/time inputs.
6. Check interval totals and transition labels across the stated 29.53-day period.
7. Review cost results against input ranges and ensure uncertainty is communicated.
8. Retain example inputs, expected/actual outputs, source metadata, and screenshots or command output.

## 11. Demo and submission framing

Tell one clear story: **“A landing-site decision depends on when the Sun and Earth clear the local terrain. How can the team compare locations and understand the uncertainty?”**

Suggested flow: open on the celestial-motion overview; enter a candidate site; show the surface context; compare Sun/Earth windows in the graph view; explain one site difference; then show how a technical user can access the same result. Include cost only if the model is implemented well enough to show its assumptions and distribution honestly.

For the 2026 submission, the team-shared judging guide lists a 7-slide maximum for a slide demo or 30 seconds for a video, and a local deadline of 15 November 2026 at 11:59 p.m. Confirm the event's current submission rules before submitting. Cite external code, datasets, images, and references in the submission materials.

## 12. Status tracker

| Workstream | Status from repository review | Next concrete step |
| --- | --- | --- |
| Website surface scene | Implemented prototype | Replace or clearly label procedural terrain; connect selected elevation data if feasible. |
| Site selection | Implemented with three demo sites | Verify coordinates and sources. |
| Time/timeline | Implemented prototype with simplified ephemeris | Validate calculation pipeline and align all views. |
| Site comparison | Implemented summary panel | Build the dedicated graph view/full-screen experience. |
| Celestial-motion opening view | Planned | Specify and implement stationary Moon with apparent Sun/Earth movement. |
| LOLA/DEM integration | Not found | Select product and demonstrate provenance/processing. |
| Backend/API | Not found | Agree contract and implement as part of the project. |
| Python library/CLI | Not found | Expose core site/time outputs using the shared calculation pipeline. |
| Cost distribution estimates | Planned | Define estimate scope, inputs, and uncertainty model. |
| Independent validation | Not found | Keep reproducible reference cases and results. |

Use these status labels consistently: **Proposed**, **Implemented**, **Integrated**, **Tested**, and **Validated**. They describe different levels of completion.

## 13. Guiding principles

1. Design for both accessible exploration and technical reuse.
2. Keep the website and Python/CLI/API on one documented analysis pipeline.
3. NASA data must drive a result before the product claims NASA-data-backed analysis.
4. Make assumptions, sources, and uncertainty visible.
5. Distinguish geometric visibility from power generation or communications performance.
6. Prefer one complete, understandable, evidence-backed site workflow over many unfinished features.
7. Make the first impression memorable while keeping scientific claims proportional to the evidence.

**Near-term goal:** deliver a coherent Stargazer demo that introduces the lunar geometry, lets users inspect and compare candidate sites, and clearly communicates what the current calculations can and cannot establish—while establishing the shared technical foundation for the website, API, Python library, and CLI.
