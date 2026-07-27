# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Iron — a gym tracker, installable on iPhone as a PWA. No build step, no
package manager, no bundler, no UI framework — plain HTML/CSS/JS files served
as-is. It does have one lightweight backend dependency: Supabase, used only
for accounts (magic-link email sign-in) and syncing each user's data. There is
still no framework, no server code of ours to run, and no build step for the
frontend — Supabase is a hosted service the client talks to directly over its
JS SDK.

Live at https://tazza8.github.io/, deployed via GitHub Pages
straight from the `main` branch root (see **Deployment** below) — pushing to
`main` is the entire deploy step.

## Running it

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. There is no build, bundle, lint, or test step —
edit the files and reload. `.claude/launch.json` defines this same server for
the Claude Code preview browser (`mcp__Claude_Browser__preview_start` with
name `gym-tracker`).

To sanity-check any script for syntax errors without a browser: `node --check
app.js` (swap in `auth.js`, `sw.js`, etc.).

`supabase-config.js` holds the two values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
that connect the app to its Supabase project — see **Accounts & sync** below.
With placeholder values the app still boots fine and shows the sign-in screen
(nothing crashes), but sending a magic link will fail. Real values are needed
to actually sign in and test data sync locally.

To test on a phone: either use the live GitHub Pages URL, or run the local
server on a computer and visit `http://<computer-ip>:4173` from a phone on the
same Wi-Fi, then "Add to Home Screen" — see **PWA / offline** below.

## Architecture

**State is one global object (`state`) rendered imperatively into `#app`.** There
is no framework, no virtual DOM, no component tree. The pattern throughout is:
mutate `state`, call `save()`, call the relevant `render*` function to
re-stringify the affected part of the DOM via `innerHTML`, then reattach event
listeners with `querySelectorAll` + `.onclick`/`.oninput`. `render()` is the router:
it reads the global `view = { name, arg }` and dispatches to `renderHome`,
`renderProgram`, `renderSession`, `renderHistory`, `renderHistoryDetail`, or
`renderExercise`. Navigate with `go(name, arg)`, never by mutating `view` directly.

**Persistence**: `state` is still one JSON blob with the same shape it always
had — accounts were added by changing *where* that blob is persisted, not its
shape, so every render/helper function below is unaffected. `defaultState()`
defines the shape:
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

`safeParse(raw)` (top of `app.js`) is the one place JSON from storage gets
parsed — it uses a reviver that strips any `__proto__` key before the result
reaches `Object.assign(defaultState(), parsed)`, so a crafted payload can't
repoint `state`'s prototype. Keep that reviver if you touch it; it's shared by
both the per-user cache read and the legacy-import read (see below).

## Accounts & sync

`loadForUser(userId)` (`app.js` ~line 33) and `save()`/`syncNow()` (~lines 93,
105) replace the old plain `load()`/`save()`. The whole app is gated behind
being signed in — `render()`'s first check is `if (!session) return
renderSignIn(app)`; nothing else in `app.js` runs until a session exists.

- **`auth.js`** owns everything session-related as plain globals (same
  pattern as `EXERCISE_LIBRARY` in `exercises.js` — no modules, no imports):
  `supabaseClient`, `session`, `authReady` (a promise that resolves once the
  locally-persisted session has been checked), and `renderSignIn()`/
  `signOut()`. `app.js`'s boot code `await`s `authReady`, then either calls
  `loadForUser()` or renders the sign-in screen, and installs
  `window.onAuthChange` so later sign-in/sign-out events (magic-link return,
  manual sign-out, token refresh) re-drive the same logic.
- **Script load order matters now** (it didn't before): `vendor/supabase.js`
  → `supabase-config.js` → `auth.js` → `exercises.js` → `app.js`. Each of the
  first three defines globals the next one needs at top-level execution time
  (not just inside functions, where order wouldn't matter) — don't reorder
  the `<script>` tags in `index.html` without checking this still holds.
- **Storage model**: one row per user in Supabase (`gymtracker_data`, see
  `supabase/schema.sql`) storing the exact same JSON blob as `state`, in a
  `jsonb` column. Row Level Security (`auth.uid() = user_id`) is what actually
  keeps users' data apart — the anon key embedded in `supabase-config.js` is
  meant to be public; do not treat it as a secret that needs hiding.
- **Why `save()` still writes to `localStorage` synchronously**: `renderSession`'s
  per-keystroke `oninput` handler calls `save()` on every character typed
  into a weight/reps field. `save()` keeps that instant local write exactly as
  before (per-user key: `lsKey(userId)`), and separately schedules a ~2s
  debounced background `upsert` to Supabase — so typing never waits on a
  network round trip, and rapid edits coalesce into one write instead of one
  per keystroke. If the debounced push fails (offline), the local write is
  never lost; `syncPending` stays `true` and a `window` `'online'` listener
  retries.
- **New accounts**: `loadForUser` creates an empty Supabase row on first
  sign-in, then calls `offerLegacyImport()`, which checks the *old* flat
  `iron.gymtracker.v1` key (pre-accounts local data) and offers a one-time
  import via the existing `confirmModal` helper — declining just leaves an
  empty account, it never blocks rendering the app.

**Rendering inputs without losing focus**: set-row inputs in `renderSession` only
write to `state` on `oninput` — they do NOT trigger a re-render. Re-rendering the
whole session on every keystroke would steal focus mid-type. Re-render only
happens on structural changes (ticking a set done, adding/removing a set).

**The rest timer** (`timer` object, ~line 287) is independent of the render cycle:
it runs its own `setInterval` and repaints `#timerBar` directly via DOM lookups,
not through `render()`. It restarts automatically whenever a set is ticked done
(see the `data-done` handler in `renderSession`). `document.body` gets an
`in-session` class while it's visible so page content gets extra bottom padding
and never sits under the fixed timer bar (see `--timer-h` in `styles.css`).

**Drag-to-reorder** (`enableDragReorder`, ~line 397) is a generic helper: pass a
container and an `onReorder(from, to)` callback. It's pointer-event based and
deliberately attaches `pointermove`/`pointerup` to `window` (not the grip element)
because the pointer routinely leaves the grip mid-drag — binding to the grip alone
drops events. Only `.grip` children start a drag (`touch-action: none`); the rest
of each `.drag-item` card keeps normal scroll behavior.

**Performance/PR math** (~lines 186–280) is the layer between raw session data and
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

**The chart** (`chartSVG`, ~line 497) is hand-rolled inline SVG, not a charting
library — the only third-party code in this project is the vendored Supabase
client (see below). `chartMetric` and `chartSel` are module-level state for the
currently-viewed exercise's chart (which metric, which point is tapped);
they're intentionally not part of `state`/`localStorage` since they're
transient UI state, not data.

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

## PWA / offline

`manifest.webmanifest` + `icons/` + the `apple-touch-icon`/`apple-mobile-web-app-*`
meta tags in `index.html` make "Add to Home Screen" on iOS behave like a real
app (own icon, standalone window, no Safari chrome).

`sw.js` precaches the whole app shell (every same-origin file the app needs —
keep its `ASSETS` array in sync with reality) so the app opens instantly with
no connection at all. Its fetch handler explicitly bypasses the cache for any
cross-origin request (`new URL(...).origin !== self.location.origin`) — that's
what keeps Supabase auth/data calls always hitting the network live instead of
serving a stale cached response; don't remove that check when editing `sw.js`.

**`CACHE_NAME` must be bumped** whenever any cached file's content changes or
the `ASSETS` list changes — that's the only thing that makes the browser
refetch and recache. The `activate` handler deletes any cache not matching the
current `CACHE_NAME`, so bumping it is also how old caches get cleaned up.
Note there's an inherent one-reload lag: a page already loaded under the old
service worker keeps running the old cached JS even after a new worker
finishes installing in the background — a change won't be visible until the
*next* load after that.

## Deployment

GitHub Pages, serving directly from the `main` branch root — pushing to
`main` **is** the deploy step, no build/CI in between. `.nojekyll` is present
so GitHub serves the files as-is rather than running them through Jekyll.
Repo is public (required for GitHub Pages on the free plan); there's nothing
sensitive in it — the Supabase anon key is meant to be public, and no user
data ever touches the repo.

## Version control

Plain git repo on `main`, remote `origin` on GitHub
(`Tazza8/tazza8.github.io`, public). No CI, no hooks, no required checks —
pushing to `main` both is the deploy and needs nothing else to pass first.
