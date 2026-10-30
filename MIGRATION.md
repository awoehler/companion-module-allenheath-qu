# Companion 5.1.1 Migration

This branch ports the old Qu-series Companion 2.x module to the module API used by Companion 5.1.1. It retains the existing connection ID, action IDs, and MIDI channel/address mappings for legacy button configuration compatibility.

## Installation

1. Use a Companion 5.1.1 developer modules directory and place this repository in a folder named `companion-module-allenheath-qu`.
2. Install dependencies with `npm install` (Node.js 26).
3. Restart or rescan developer modules, then create or update the Allen & Heath Qu connection.
4. Select your console model (including QU32) and set the mixer IP address. The module uses MIDI over TCP, port 51325.

## Safety note: relative send levels

Relative **Level Input to Mix** actions require a known current value. The older module used an uninitialized variable, which could produce an invalid value that became MIDI zero (-inf). This version tracks absolute levels and received mixer level reports using the input and destination as the key. When the current send level is unavailable, a step action is skipped and a warning is logged **instead of moving the send to -inf**. First use an absolute level action (or move the relevant mixer send so it reports its state) before stepping.

The Qu MIDI level map is non-linear: the relative step targets the closest available level, with floor clamping. The -inf state only results from an intentional downward step at the minimum boundary. Validate against your mixer before using automation during a service.

## Verification

Run `npm test` and `npm run check`. Hardware validation should cover absolute and relative levels for channel-to-mix sends, changes made from the console, mute/PAFL feedback, scene recall, connection recovery, and saved button compatibility. No physical mixer testing has been performed by this change.
