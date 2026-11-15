# Stargazer Mission UI Overhaul Plan

## Purpose

Make the playable mission stages feel like one continuous Stargazer application after Stage 00, give the 3D scene room to lead, and remove the overlapping controls visible in the launch-pad screen.

This is a presentation and interaction overhaul. Keep the current mission sequence, reducer rules, ephemeris data, scenario weather, and scientific caveats intact unless a UI defect requires a narrowly scoped fix.

## Product goals

1. **Keep the header consistent.** Use Stage 00 as the reference for the brand, mission identity, stage label, and alignment. The header remains in the same place and keeps the same hierarchy throughout planning, assembly, pad operations, countdown, ascent, transit, descent, and surface operations.
2. **Make the 3D scene the work area.** In assembly, the player picks up the visible 3D component and places it on the matching vehicle location. Text cards must not be the primary assembly interaction.
3. **Give every stage one clear layout.** Controls, telemetry, scene, and guidance have explicit regions. No content should depend on overlapping absolute-positioned panels.
4. **Tune it for a laptop.** Optimize the layout for a fixed laptop-sized viewport. The experience does not need to reflow for phone or tablet sizes.
5. **Retain the Stargazer visual language.** Use the brandbook palette, restrained instrument styling, system sans-serif for instructions, monospace for telemetry, cyan for interface state, gold for Sun-related data, and blue for Earth or communications data.

## Current issues to resolve

- Stage 00 and later stages use different header structures and spacing. The mission header changes in height and alignment after site selection.
- The assembly screen shows a textual component list and schematic socket buttons even though the hangar already contains 3D component models. The 3D pieces need to become the primary draggable objects and the rocket needs clear placement targets.
- The launch-pad stage places its heading, mission target, monitor drop area, checklist, and weather/readiness panel in competing layers. The screenshot shows the stage heading and mission target compressed at the top while the controls sit over the 3D room without a stable grid.
- Several screens use `position:absolute`, viewport percentages, and nested scrolling together. At different viewport sizes those rules can cause collisions, oversized empty areas, or controls hidden below another panel.
- Current stage surfaces read as stacked cards instead of a consistent mission console surrounding a visible 3D work scene.

## Shared application shell

Build one reusable mission shell and use it in Stage 00 and all later stages:

- **Left:** Stargazer mark, product name, and Mission 001 identity.
- **Center:** current stage number and short stage name. Keep its position and text hierarchy stable; only its values change.
- **Right:** the time display and the controls appropriate to that phase. Planning shows planning UTC and scrub context; mission stages show elapsed time, pause/speed, and guide controls.
- Keep the shell height, padding, border, and column alignment consistent at the target laptop size.
- Remove the scenario-opportunities strip from the shared shell. Keep launch-window assessment and readiness information in the launch-pad stage where the player acts on it.
- Keep each stage's guidance directly below the shell in a predictable location, with the mission target and deadline represented once instead of duplicated across panels.

## Stage-by-stage design

### Stage 00 — Site planning

- Preserve the existing terrain view, site investigation, interval recording, comparison, and confirmation flow.
- Treat the current planning header as the canonical shell reference.
- Align later stages to its brand/stage/time hierarchy without disturbing the selector overlay, time scrub, or local sky instrument.

### Stage 01 — Vehicle assembly

- Make each visible 3D hangar component pickable. On pointer or touch drag, show the component following the pointer and highlight valid attachment regions on the 3D stack.
- On drop, raycast against the stack, resolve the nearest valid attachment point, snap the model into place, and show a short success or correction cue.
- Make installed models persist in the stack. Keep the installed count and concise component identity readable in the scene-side instrument panel.
- Remove the large text component cards and schematic text sockets as the default interface. Preserve keyboard-accessible selection, focusable target controls, and an optional compact component index as a fallback; fallback controls must not compete visually with the 3D interaction.
- Support mouse, touch, and keyboard input. A player should be able to complete the stage without relying on a precision drag.

### Stage 02 — Launch-pad preparation

Replace the current overlapping composition with a stable three-region layout:

1. **Scene region:** the 3D pad and launch monitor remain unobstructed and occupy the largest area.
2. **Procedure region:** one checklist panel contains platform, umbilicals, loading, checks, retraction, and onboard power. Each step has a clear state and one action.
3. **Window and readiness region:** scenario weather choice, recorded assessment, site check, and the three GO/WAIT indicators live together in a separate panel.

- Use CSS grid/flex layout for these regions. Do not position headings, mission-target information, or whole control panels by viewport percentages over the scene.
- Keep the two panels at the left and right sides of the scene, with the 3D pad view centered between them.
- Keep the drag-to-monitor interaction available, with visible drop feedback. Provide click actions as an accessible alternative.
- Keep the preparation deadline visible in the shared mission target area. Avoid repeating it inside procedure rows.

### Stage 03 — Countdown

- Keep the countdown value as the primary readout within a framed terminal-control display.
- Group launch readiness, countdown progress, timing tolerance, and launch command in one stable region.
- Keep the pad scene visible as context, and keep the launch button reachable without scrolling at common desktop and laptop sizes.

### Stage 04 — Ascent and staging

- Keep the animated vehicle as the scene focus.
- Place elapsed time, stage state, fairing state, and the current separation action in a compact flight-instrument console.
- Make the active cue and disabled-until timing explicit. Keep the separation action visible at laptop height.

### Stage 05 — Lunar transit

- Keep the spacecraft, Earth, and Moon scene visible.
- Use a consistent monitoring/communications switch in a single console. Do not create separate floating panels for the same mission status.
- Keep scheduled/pending/answered messages understandable and usable by keyboard.

### Stage 06 — Powered descent

- Keep the lander and lunar surface scene visible behind a compact descent instrument.
- Group zone selection, descent progress, thrust cue, alignment, and touchdown confirmation in one predictable control area.
- Make the selected zone and current cue visually distinct without using color as the only signal.

### Stage 07 — Surface operations

- Preserve the existing terrain-aware surface scene and Sun/Earth visibility calculations.
- Treat deployment, survey progress, and review as one operations console associated with the surface scene.
- Keep the science caveat readable but compact; do not cover the terrain view with a large opaque card.

### Preparation-expired and completion states

- Use the shared shell and a clear status panel for recovery, restart, or mission completion.
- Keep the next available action obvious, and preserve the distinction between the lunar operating window and the fictional scenario launch opportunities.

## Interaction and layout rules

- Prefer grid/flex regions over absolute positioning for all content-bearing panels. Reserve absolute positioning for scene annotations and small non-interactive indicators.
- Establish explicit `min-width: 0`, `min-height: 0`, and overflow rules for grid children so long labels do not force panels over one another.
- Give each stage one primary action. Secondary controls should be grouped near the data that explains them.
- Keep minimum touch targets around 40–44 CSS pixels; provide focus-visible states and semantic button labels.
- Announce component placement, checklist completion, and stage changes through accessible status text.
- Respect reduced-motion preferences for scene transitions and interface movement.
- Preserve the stated prototype limits: scenario windows/weather are fictional; ascent, transit, and descent are simplified gameplay; geometric visibility does not guarantee power or communications.

## Implementation sequence

1. **Create the shared shell.** Extract the Stage 00/game header structure into a reusable component or shared layout. Match the later stage header to it and remove the scenario strip from the vertical stack.
2. **Stabilize the stage layout system.** Define common scene, guidance, mission-target, and control-panel regions with responsive grid templates. Replace overlapping launch-pad positioning first.
3. **Finish direct 3D assembly.** Add drag preview, valid-target highlighting, reliable raycast-to-slot mapping, snap feedback, and accessible fallback controls. Remove text cards as the default interaction.
4. **Refit pad preparation.** Move all procedure steps and weather/readiness information into the two planned panels, and keep the monitor drop target anchored to the visible monitor area.
5. **Apply the shared console system to countdown, ascent, transit, descent, and surface operations.** Keep each phase's controls and data specific to its task.
6. **Tune narrow-screen behavior and accessibility.** Test the same stage at desktop, tablet, and phone sizes; adjust stacking/collapse behavior without adding overlapping layers.
7. **Review copy and visual consistency.** Confirm brandbook colors, header rhythm, signal mapping, readable contrast, and scientific caveats across all stages.

## Acceptance criteria

- Stage 00 and every later stage show the same Stargazer/Mission 001 header structure, stage-label position, and time/control alignment.
- The scenario-opportunities bar does not return.
- A player can install the vehicle by dragging the visible 3D pieces onto the visible 3D vehicle; wrong targets provide clear feedback and correct targets snap the part into place.
- Assembly remains completable with keyboard and touch input, with no large text-card list replacing the 3D interaction.
- Launch-pad heading, mission target, drop monitor, checklist, and weather/readiness panel never overlap at tested viewport sizes.
- Countdown, ascent, transit, descent, surface operations, and recovery/completion states use the shared shell and have a clear primary action.
- No stage requires scrolling to reach its primary action at a standard desktop viewport. Narrow layouts may scroll in a single intentional content region.
- All existing mission mechanics, timing gates, data caveats, and science readouts remain intact.

## Suggested review sizes

- **Compact phone:** 360 × 800 CSS pixels.
- **Tablet:** 768 × 1024 CSS pixels.
- **Target laptop:** 1366 × 768 CSS pixels.

At the target size, inspect the header, stage title, scene visibility, panel positions, text wrapping, keyboard focus, drag/drop target feedback, and access to the stage's primary action. Do not spend implementation time on phone/tablet reflow.

## Scope boundary

This plan changes interface layout and interaction presentation. It does not change the story arc, launch-window schedule, site selection data, weather model, ascent/descent timing, scientific calculations, or mission outcomes.
