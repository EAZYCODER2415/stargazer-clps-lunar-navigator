# Stargazer Brandbook

This guide records the brand as it appears in the current Stargazer lunar mission navigator. It is a practical reference for product copy, interface styling, and future project materials; it describes the current prototype rather than a formal NASA or Artemis identity.

## Brand at a glance

**Name:** Stargazer  
**Descriptor:** CLPS Lunar Mission Navigator  
**Current context line:** NASA CLPS · ARTEMIS  
**Product type:** Interactive lunar surface and visibility explorer for comparing candidate south-polar landing sites.

Stargazer helps people explore how local terrain and the positions of the Sun and Earth shape visibility at a lunar landing site. Its interface brings a three-dimensional surface view, mission time, visibility windows, and site comparisons into one place.

### Brand idea

**A clear view of the lunar surface and the mission conditions around it.**

The name evokes observation and orientation. The product makes that idea concrete through a navigable surface scene and readable time-based measurements.

### Brand traits

- **Exploratory:** invites users to look around, scrub time, and compare places.
- **Instrument-like:** organizes the experience around site, UTC/MET, elevation, visibility, and link status.
- **Grounded:** connects celestial geometry to terrain and clearly distinguishes estimates from validated mission results.
- **Approachable:** explains specialist terms in plain language and provides direct controls.

## Audience and use

The current experience is suited to students, educators, and people exploring lunar mission concepts. It can support early comparison and discussion of candidate sites. It is a research and education prototype, not flight software or a mission-planning authority.

## Messaging

### Core message

Explore when the Sun and Earth are visible from candidate lunar landing sites.

### Supporting points

- Move through a lunar day and inspect changing Sun and Earth visibility.
- Relate visibility to a terrain-aware horizon and a 3D surface view.
- Compare bundled candidate locations, including Malapert Mountain / Massif, Shackleton Rim, and Mons Mouton.

### Voice and writing

Use a calm, concise, technically literate voice. Prefer familiar verbs and short labels. Explain acronyms at first use or in context: for example, “Direct-to-Earth (DTE) link.” Use exact units and time standards where useful, especially degrees and UTC.

Interface copy should help the user understand what they can do or what a displayed value means. “Pick a landing site,” “Next Earth rise,” and “Earth below horizon” are good models: direct, specific, and easy to scan.

Avoid inflated claims, dramatic space clichés, unexplained acronyms, and language that implies a prototype estimate is a validated engineering result. Keep the NASA CLPS / Artemis context line descriptive; do not imply NASA endorsement or official affiliation beyond the project's actual status.

## Visual identity

### Overall direction

The current home experience is a dark mission workstation: near-black space, restrained blue-gray surfaces, thin borders, compact telemetry, and bright signals reserved for important data and controls. The 3D lunar terrain is the main visual focus. Interface chrome should support it without competing for attention.

### Color palette

The values below are sampled from the current application styles. Keep text contrast high and use signal colors consistently.

| Role | Color | Use |
| --- | --- | --- |
| Deep background | `#050505` | Header and deepest panels |
| Main background | `#0A0A0A` | Primary application canvas |
| Card surface | `#111111` | Panels and grouped controls |
| Blue-violet surface | `#1A1A2E` | Secondary accent surfaces |
| Border | `#2A2A3A` | Quiet dividers and panel edges |
| Primary text | `#E0E0FF` | Main labels and values |
| Secondary text | `#A0A0C0` | Supporting labels and descriptions |
| Interface cyan | `#4CC9F0` | Active controls, focus, and key UI accents |
| Cyan hover | `#66D9FF` | Hover and emphasized interactive states |
| Sun / illumination | `#FBBF24` | Sun visibility and solar timeline bands |
| Earth / communications | `#66B2FF` | Earth visibility and DTE timeline bands |

Use cyan for interface interaction, gold for Sun-related information, and blue for Earth or radio-link information. Do not rely on color alone to communicate status; pair color with labels, values, or shapes. Reserve red/orange for genuine warnings rather than ordinary visibility states.

### Typography

The current interface uses the native system sans-serif stack for general UI text and a system monospace stack for technical readouts. Continue with this pairing:

- **UI and prose:** system sans-serif, with clear weight and size hierarchy.
- **Telemetry and coordinates:** system monospace for stable alignment and a mission-console feel.
- **Labels:** short, often uppercase, and visually secondary to their values.

Avoid introducing display typefaces that reduce legibility or make the interface feel like a promotional landing page.

### Layout and components

- Keep the 3D lunar scene visually dominant and give it room to read.
- Group controls and metrics in compact, clearly bounded panels.
- Use thin borders, dark surfaces, and modest corner radii; avoid heavy shadows and decorative gradients in data-heavy areas.
- Make the selected site, current time, Sun state, and Earth/DTE state easy to find.
- Use consistent button states for default, hover, active, disabled, and focus.
- Preserve responsive behavior: controls and information should remain readable on narrower screens without obscuring the key scene or timeline.

### Data visualization

Use the same visual mapping throughout the product:

- **Sun / solar illumination:** warm gold.
- **Earth visibility / DTE:** clear blue.
- **Terrain / horizon:** neutral lunar stone and muted gray-blue.
- **Current time:** a distinct high-contrast marker that remains visible over both visibility bands.

Label timeline bands and explain transitions. Report times in UTC when that is the displayed standard; retain units on values. Distinguish direct source data from derived or illustrative telemetry.

### Mark and imagery

The application title is **Stargazer**. The current favicon is a faceted purple mark with blue and pale highlights. Preserve its silhouette and proportions if reusing it; do not redraw or recolor it as though the favicon were an established full logo system. The interface's primary accent is cyan, so use the favicon as a small brand mark rather than letting its purple dominate the product palette.

Use lunar surface and mission-context imagery that supports orientation and site understanding. Favor restrained, high-contrast scientific visualization over decorative star fields, generic space stock imagery, or cinematic effects that obscure terrain and data. The current 3D scene is illustrative in its nearby surface detail; do not present it as a high-resolution terrain photograph or survey rendering.

## Product language and accuracy

Use **landing site**, **lunar day**, **horizon**, **Sun visibility**, **Earth visibility**, and **Direct-to-Earth (DTE)** consistently. Expand unfamiliar terms in help content. Keep coordinates explicit about direction and units.

When discussing model outputs, distinguish estimates from measurements and simulations from validated engineering analysis. The displayed solar power, array flux, DTE SNR, and radio-contact verdict are illustrative estimates. The app is for exploration, not mission planning. Preserve these qualifications in product descriptions, screenshots, and presentations.

## Quick reference

**Do:** make the mission state legible; let terrain and visibility data lead; explain technical terms; use gold for Sun and blue for Earth/DTE; state uncertainty plainly.

**Avoid:** implying official NASA endorsement; presenting illustrative telemetry as validated; using the signal colors inconsistently; adding decorative space effects that reduce readability; using unexplained acronyms in user-facing copy.

## Source of this guide

This brandbook is based on the current frontend home experience, including the Stargazer header, 3D lunar scene, timeline and visibility bands, telemetry styling, help copy, application color tokens, and favicon. Treat it as a snapshot: update it when the product's visual system or scope changes.
