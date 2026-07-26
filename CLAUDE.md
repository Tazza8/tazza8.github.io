# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Iron — a single-page gym tracker. No build step, no package manager, no framework,
no backend. Four static files (`index.html`, `styles.css`, `exercises.js`, `app.js`)
served as-is; all data lives in the browser's `localStorage` under the key
`iron.gymtracker.v1`.

## Running it

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. There is no build, bundle, lint, or test step —
edit the files and reload. `.claude/launch.json` defines this same server for the
Claude Code preview browser (`mcp__Claude_Browser__preview_start` with name
`gym-tracker`).

To sanity-check `app.js` for syntax errors without a browser: `node --check app.js`.

To test on a phone: run the server on a computer, visit
`http://<computer-ip>:4173` from a phone on the same Wi-Fi, then "Add to Home
Screen." Data is per-browser/per-device — there is no sync.

## Architecture

**State is one global object (`state`) rendered imperatively into `#app`.** There
is no framework, no virtual DOM, no component tree. The pattern throughout is:
mutate `state`, call `save()`, call the relevant `render*` function to
re-stringify the affected part of the DOM via `innerHTML`, then reattach event
listeners with `querySelectorAll` + `.onclick`/`.oninput`. `render()` is the router:
it reads the global `view = { name, arg }` and dispatches to `renderHome`,
`renderProgram`, `renderSession`, `renderHistory`, `renderHistoryDetail`, or
`renderExercise`. Navigate with `go(name, arg)`, never by mutating `view` directly.

**Persistence**: `load()`/`save()` are the only functions touching
`localStorage`. `defaultState()` defines the shape:
```
{ programs, customExercises, history, active, settings }
```
- `programs` — user-defined workout templates (`{ id, name, exercises: [{exerciseId, sets}] }`)
- `customExercises` — user-added exercises, merged with `EXERCISE_LIBRARY` (from
  `exercises.js`) via `allExercises()`. Exercise ids are stable and referenced from
  history, so never reuse/repurpose an id.
- `history` — finished sessions, **newest first**. Several functions rely on this
  order (`previousSessionOf`, `lastPerformance`, `exerciseSeries` before its
  `.reverse()`).
- `active` — the in-progress session, or `null`. Saved on every keystroke
  (`oninput` in `renderSession`) so a refresh or phone lock doesn't lose data.
- `settings` — `{ unit: 'kg'|'lb', rest: seconds, sound: bool }`.

**Rendering inputs without losing focus**: set-row inputs in `renderSession` only
write to `state` on `oninput` — they do NOT trigger a re-render. Re-rendering the
whole session on every keystroke would steal focus mid-type. Re-render only
happens on structural changes (ticking a set done, adding/removing a set).

**The rest timer** (`timer` object, ~line 200) is independent of the render cycle:
it runs its own `setInterval` and repaints `#timerBar` directly via DOM lookups,
not through `render()`. It restarts automatically whenever a set is ticked done
(see the `data-done` handler in `renderSession`). `document.body` gets an
`in-session` class while it's visible so page content gets extra bottom padding
and never sits under the fixed timer bar (see `--timer-h` in `styles.css`).

**Drag-to-reorder** (`enableDragReorder`, ~line 313) is a generic helper: pass a
container and an `onReorder(from, to)` callback. It's pointer-event based and
deliberately attaches `pointermove`/`pointerup` to `window` (not the grip element)
because the pointer routinely leaves the grip mid-drag — binding to the grip alone
drops events. Only `.grip` children start a drag (`touch-action: none`); the rest
of each `.drag-item` card keeps normal scroll behavior.

**Performance/PR math** (~lines 88–199) is the layer between raw session data and
the History views:
- `exerciseSeries(exerciseId)` — one point per session an exercise appears in,
  oldest first, with weight/reps/e1rm/volume/rep totals precomputed.
- `setE1rm` — Epley estimated 1-rep-max (`weight × (1 + reps/30)`), the basis for
  comparing sets done at different rep ranges.
- `personalBests(exerciseId)` — best-ever point per `METRICS` key.
- `findPRs(session)` — called once in `finishSession()`, diffs the just-finished
  session against `personalBests` computed from history *before* that session
  lands, and stores the result on `session.prs`. This must run before
  `state.history.unshift(s)`, or every session would be compared against itself.
- `isBodyweight(pb)` — exercises always logged at 0 kg (push-ups, dips, planks)
  are tracked by reps instead of weight; `METRICS` has parallel `reps`/`totalReps`
  entries and every PB/chart/history view branches on this flag.
- `METRICS` is the single source of truth for chart/stat labels, getters, and
  unit suffixes — add a new trackable metric here, not ad hoc in a render function.

**The chart** (`chartSVG`, ~line 413) is hand-rolled inline SVG, not a charting
library — there are no dependencies in this project at all. `chartMetric` and
`chartSel` are module-level state for the currently-viewed exercise's chart
(which metric, which point is tapped); they're intentionally not part of
`state`/`localStorage` since they're transient UI state, not data.

**Exercise identity**: `exercises.js` defines `EXERCISE_LIBRARY` (built-ins, ids
like `chest-press`) and `MUSCLE_ORDER` (display grouping). Custom exercises get
ids prefixed `c-` (see `openPicker`). `exerciseById()` in `app.js` is the only
lookup path — never index `EXERCISE_LIBRARY` directly, since custom exercises
live in `state.customExercises`.

## Styling conventions

All colors are CSS custom properties on `:root` in `styles.css` (`--bg`,
`--accent`, `--good`, `--danger`, etc.) — never hardcode a hex color in CSS.
`app.js` has a couple of unavoidable exceptions (inline SVG `stop-color` in
`chartSVG`) that must be kept in sync with `--accent` by hand since SVG can't
read CSS variables from a `<style>` block scoped this way.

The UI is mobile-first and single-column (`max-width: 720px`), built around a
fixed top bar, an optional fixed rest-timer bar, and a fixed bottom tab bar
(`#tabbar`). `[hidden]` is used to show/hide the timer bar; note the CSS has an
explicit `#timerBar[hidden] { display: none; }` rule because `#timerBar`'s own
`display: flex` would otherwise win over the `hidden` attribute.
