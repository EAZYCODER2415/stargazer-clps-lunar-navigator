# Stargazer: Mission 001 — Game Narrative

## Purpose of this document

This document gives the team a shared narrative for the current Stargazer game prototype. It describes the player's role, the mission's dramatic arc, and the meaning of each gameplay phase. It also separates story framing from implemented mechanics so that prototype limitations are not mistaken for mission facts.

## The game in one sentence

The player is a mission-operations trainee who studies three lunar south-pole sites, chooses a useful Sun-and-Earth visibility opportunity, prepares a generic robotic lander, and guides it through a simplified mission to its first surface survey.

## Premise

Stargazer's fictional **Mission 001** is a robotic demonstration mission. A small exploration team has one lander and a limited preparation schedule. Before the team commits to a destination, the player investigates the changing local sky at Malapert Mountain / Massif, Shackleton Rim, and Mons Mouton.

At each site, the player looks for an interval when both the Sun and Earth are geometrically above the local terrain horizon. Those two conditions matter to a surface mission, but they do not guarantee continuous electrical power or a working radio link. The player records one valid interval for each site, compares the duration of the opportunity with the time available to prepare, then chooses which trade-off fits the mission.

Once the destination is confirmed, planning becomes operations. The player integrates the vehicle, prepares the launch pad, waits for a scenario launch opportunity, and manages the simplified flight to the Moon. The mission ends with the lander touching down and a robotic unit completing its first site survey.

The player's first assignment is one mission, not the construction of a lunar colony. A future outpost-building arc can grow from the survey results, but it is outside the current Mission 001 story.

## Player role

The player is a trainee mission planner and operator working with a small fictional mission team. They are responsible for interpreting the available site data, making the destination decision, and carrying out the procedures that follow.

The player is not asked to design a real spacecraft or make flight-ready decisions. Mission 001 uses a generic vehicle and simplified scenario systems. The role is about learning how mission choices connect: a site opportunity informs the plan, the plan sets a preparation allowance, and later operations determine whether the team reaches the surface and completes its first survey.

## Narrative principles

- **Observe before committing.** The player investigates the three sites before choosing one.
- **Make trade-offs legible.** The map compares recorded visibility duration and preparation allowance without hiding the choice behind a score.
- **Let procedure create tension.** Assembly, checks, countdown, staging, and descent provide the mission's pace; the story does not need an invented disaster.
- **Keep scientific language honest.** Geometric visibility is not the same as power generation, communications performance, a launch window, or mission readiness.
- **Make the team competent and calm.** Interface copy should sound like clear mission operations, not cinematic alarm chatter.
- **Keep the mission human-scaled.** A successful robotic survey is a meaningful first step, not a claim that an outpost has already been established.

## Story arc

### Prologue — The assignment

Mission Control introduces Mission 001: send a generic robotic lander to one of three candidate south-polar sites and complete an initial surface survey. The landing site and its operating opportunity are not yet chosen. The player's first task is to understand the local conditions rather than accept a preselected destination.

**Player question:** Which site's recorded opportunity best fits the mission's preparation and surface-work priorities?

### Stage 00 — Find the operating window

The player enters the planning workspace and scrubs through the supported ephemeris range. At each candidate site, the local sky instrument shows the Sun and Earth directions relative to the terrain skyline. When both are geometrically visible, the player can begin recording; they scrub until the overlap ends to save the interval.

After recording all three sites, the player opens the lunar site map. The markers use the project coordinates. Selecting a marker shows two measurements:

- **Operating window:** how long the recorded Sun-and-Earth visibility overlap lasts.
- **Preparation allowance:** how long the team has between the shared planning reference time and the start of that recorded opportunity.

Neither measurement is an overall quality score. A longer surface opportunity may support more planned work; a later opportunity may give the team more time to prepare. The player chooses according to mission priorities and confirms the site.

**Story turn:** The player moves from observing the data to owning a mission decision.

### Stage 01 — Assemble the launch stack

The player enters vehicle integration. Eight generic components must be matched to their sockets. Correct placement turns a collection of parts into a mission-ready training stack.

This phase represents careful integration work, not the assembly of a named real-world launch vehicle. Component labels and short explanations should teach what each part does without implying a specific provider or configuration.

**Story turn:** The destination is set; the team now has a vehicle to prepare for it.

### Stage 02 — Prepare the launch pad

At the pad, the player extends the access platform, connects fuel and oxidiser service lines, starts simulated loading, performs vehicle and spacecraft checks, assesses scenario weather, retracts the platform, and switches to onboard power. Three readiness indicators communicate whether the vehicle, spacecraft, and site/weather checks are clear.

The chosen lunar operating window sets a simplified preparation deadline. The scenario's three launch opportunities are separate, fictional gameplay events. They are not derived from the lunar visibility window and are not real launch forecasts. The player may skip an opportunity without losing completed preparation work, but the mission clock continues.

**Story turn:** The plan meets operational constraints. The player must balance readiness against the time available.

### Stage 03 — Terminal countdown

Once required checks are complete and a scenario launch opportunity is active, the player starts the countdown. They wait for the T−0 cue and issue the launch command within the forgiving timing tolerance.

A missed cue returns the player to pad operations with preparation progress intact. The story treats this as a recoverable procedural miss, not a catastrophic failure.

**Story turn:** The mission leaves the preparation phase and becomes a flight operation.

### Stage 04 — Ascent and staging

The player monitors an illustrative ascent sequence. At the appropriate cues, they separate the first stage, release the payload fairing, and separate the lander from the launch vehicle. The displayed altitude and flight path are schematic gameplay elements, not a solved trajectory.

**Story turn:** The lander is now on its simplified journey toward the Moon.

### Stage 05 — Lunar transit

The player alternates between vehicle monitoring and a communications console while the mission clock continues. Scheduled science-team questions introduce concepts relevant to lunar surface missions. The player can review each message and answer without turning transit into a high-pressure quiz.

The Earth-to-Moon graphic communicates progress through the game sequence only. It does not represent a mission trajectory or a communications link budget.

**Story turn:** The team prepares for arrival while keeping the vehicle and mission goals in view.

### Stage 06 — Powered descent

On approach, the player chooses among clearly labeled training zones, starts the simplified descent, adjusts thrust, aligns over the selected zone, and confirms touchdown. The zone cues are fictional and are not terrain hazard classifications or engineering safety advice.

A rough touchdown can still leave the first robotic operation possible. This keeps the mission moving and makes landing quality a story outcome rather than an all-or-nothing gate.

**Story turn:** The mission reaches the surface; the team can begin its first work at the selected site.

### Stage 07 — First surface survey

The player deploys the robotic unit and starts a short survey. During the 75-second gameplay sequence, the selected recorded operating window is mapped across the site-time display. At completion, the player reviews whether the Sun and Earth were geometrically above the local terrain horizon at the simulated time.

The survey is the current game's endpoint. It closes Mission 001 with a concrete result and provides a natural handoff to a later outpost-building chapter. It does not claim to establish usable power, a working communications link, or a permanent presence.

**Resolution:** The player has taken a mission from site investigation through robotic arrival and produced the first site-specific survey result.

## Choice and consequence model

The central story choice is the confirmed site and its recorded window. The consequences should come from the saved data:

- The selected window's start time determines the displayed preparation allowance relative to one shared planning reference.
- The simplified game schedule converts that allowance into a preparation deadline. The conversion is a gameplay rule, not a flight or trajectory calculation.
- The recorded window's duration remains attached to the mission plan and is used to represent the selected site's opportunity during the surface survey.
- A shorter preparation allowance creates greater schedule pressure; a longer allowance gives the player more scenario time.
- A longer visibility overlap may offer more opportunity for surface activities, but the prototype should not claim that visibility alone provides power or communications.

There is no hidden overall site score. The narrative should present the measurements and let the player explain their own choice.

## Current implementation versus narrative framing

### Implemented in the prototype

- Manual ephemeris exploration and terrain-aware local Sun/Earth visibility at the three bundled sites.
- Recording a joint-visibility interval for each site, comparing the recorded values, and confirming a site.
- A shared planning reference and a simplified preparation schedule carried into the mission state.
- Generic component matching, launch-pad procedure, scenario weather assessment, countdown, staging, transit questions, simplified descent, rover deployment, and a first survey.
- Pause and speed controls for mission time; planning time is manually scrubbed and separate from the mission clock.

### Story framing or future work

- Mission 001 and the trainee/team roles are narrative framing for the prototype, not a real NASA mission or official NASA affiliation.
- Launch windows and weather in the game are deterministic scenario data, not real forecasts.
- Ascent, transit, communications, and landing are simplified gameplay sequences, not flight dynamics, trajectory, or link-budget simulations.
- The current vehicle is generic. Detailed physical hangar and control-room environments remain future presentation work.
- A sustained lunar outpost, later robotic missions, power infrastructure, and long-term operations belong to a future chapter rather than this mission's ending.

## Suggested opening and ending copy

These are proposed lines for the game guide or future narrative presentation; they are not claims that a named mission team exists.

**Opening briefing**

> Your assignment is to prepare Mission 001, a robotic lander demonstration at the lunar south pole. Three candidate sites are available. Record each site's joint Sun-and-Earth visibility window, compare the time available for surface work with the time available to prepare, then confirm the destination.

**After site confirmation**

> Site and operating window confirmed. Your preparation allowance is a simplified game schedule based on the shared planning reference. The scenario launch opportunities that follow are separate from the lunar surface window.

**Mission completion**

> Touchdown confirmed. The robotic unit has completed its first site survey. Review the local Sun and Earth visibility result, then use what the mission learned to plan the next surface capability.

## Continuation beyond Mission 001

If the team expands the game, the survey can become the evidence base for a second chapter: decide what capability should arrive next, such as a power demonstrator, communications relay, mobility system, or additional instrument package. Each follow-up mission should add one capability and make its dependency on site conditions explicit. A future outpost should emerge from a sequence of supported steps rather than appearing as an instant base-building reward.

## Language guardrails

- Say **lunar operating window** for the recorded surface Sun-and-Earth visibility overlap.
- Say **scenario launch opportunity** for the fictional launch sequence in the game.
- Say **geometric visibility** when reporting Sun or Earth above the local terrain horizon.
- Do not call the selected surface window a rocket launch window.
- Do not describe visibility as guaranteed electrical power or radio contact.
- Describe simulated timing, positions, and descent cues as simplified or illustrative where shown.
- Do not imply NASA endorsement, mission approval, or operational readiness.
