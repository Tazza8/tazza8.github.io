# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Evolv — a gym tracker, installable on iPhone as a PWA. No build step, no
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
{ programs, plans, customExercises, history, active, settings }
```
- `programs` — user-defined workout templates
  (`{ id, name, exercises: [{ exerciseId, sets, reps }] }`). `reps` is a free-text
  *target* ("8-12", "5", "AMRAP") — deliberately not a number, so it can say
  whatever a program actually prescribes. Programs written before targets
  existed simply have no `reps` key; every read goes through `item.reps || ''`.
- `plans` — multi-week schedules built out of programs; see **Plans** below.
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
both the per-user cache read and the legacy-import read (see below). Data read
back from Supabase (`row.data`) arrives pre-parsed by the Supabase client, so
it can't go through `safeParse` directly — `stripProto(obj)` re-parses it via
a `JSON.stringify`/`JSON.parse` round-trip using the same reviver, closing the
same gap for that path too. Both share the `stripProtoReviver` function —
don't duplicate the `k === '__proto__'` check inline elsewhere.

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
  `brand.js` sits between `exercises.js` and `app.js` but is
  order-independent: it only defines functions, and nothing calls them until
  the first `render()`, long after every script has run.
  `register-sw.js` loads last and is order-independent (it only calls
  `navigator.serviceWorker.register()` on `window.load`, doesn't touch any
  app globals) — it's a separate file rather than inline purely because of
  the CSP (see **Security**), not because of load-order needs.
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
- **Sign-in is code-first, not link-first, because of iOS.** A web app added
  to the iOS home screen runs in a storage partition of its own, and a magic
  link can only ever open in Safari — so following the link writes the session
  into Safari's storage, the installed app never sees it, and it sits on the
  sign-in screen forever. There is no iOS mechanism to hand a session between
  the two, and no way to make a link open in an installed web app. The one
  exchange that stays inside the app's partition is typing the 6-digit code,
  which is why `renderSignIn`'s sent state leads with a code field and
  `verifyOtp({ email, token, type: 'email' })`. The link still works and is
  fine in Safari; don't collapse this back to link-only.
- **Two settings live in the Supabase dashboard, not this repo**, and both
  have bitten us:
  - **Authentication → URL Configuration.** Site URL must be
    `https://tazza8.github.io`, with `https://tazza8.github.io/**` and
    `http://localhost:4173/**` both in Redirect URLs. `emailRedirectTo` is
    validated against that allow-list, and an unlisted URL doesn't error —
    Supabase silently falls back to Site URL. Left at the default
    (`http://localhost:3000`), every magic link from the live site points at
    localhost.
  - **Authentication → Emails → Magic Link template** must render
    `{{ .Token }}`. The code is always minted server side, but the stock
    template shows only the link — without the token in the template there's
    no code for anyone to type, and the iOS flow above is dead. The code's
    length is a project setting as well (6–10 digits; this project uses 8),
    which is why `renderSignIn` validates only that the field is non-empty
    and lets the server reject a wrong length. Don't reintroduce a length
    check — it silently breaks the moment that setting changes.
- **New accounts**: `loadForUser` creates an empty Supabase row on first
  sign-in, then calls `offerLegacyImport()`, which checks the *old* flat
  `iron.gymtracker.v1` key (pre-accounts local data) and offers a one-time
  import via the existing `confirmModal` helper — declining just leaves an
  empty account, it never blocks rendering the app.
- **`LS_KEY` still literally says `'iron.gymtracker.v1'`** even though the app
  was renamed to Evolv — intentionally. It's a frozen historical key name used
  only to detect pre-accounts local data on someone's device; renaming it
  would just break that detection for zero user-visible benefit. Don't "fix"
  this to match current branding.

**Plans** (`app.js`, the section above `startSession`) are a layer on top of
programs, not a replacement: `{ id, name, weeks, rotation: [programId…], progress }`.
"10 weeks, full body, 3× a week as A/B/C" is `weeks: 10, rotation: [A, B, C]`.
- **Every week runs the same rotation**, by design. Progression is meant to come
  from the weight on the bar, not from authoring thirty separate workouts. That
  keeps the whole plan a flat ordered queue of `weeks × rotation.length`
  sessions, which is why a single integer — `progress`, the number completed —
  is enough to place you in it (`planWeekOf`/`planLetterOf` derive the rest).
  Per-week overrides would break that and need a real schedule array.
- `rotation` holds program **ids**, so editing a program updates it everywhere
  it's used. Ids may repeat (A/B/A is legal), and a program deleted out from
  under a plan leaves a hole the UI labels rather than crashing on.
- An **empty rotation** makes `planTotal` 0 and `planWeekOf` divide by zero, so
  every caller guards on `planTotal(plan)` first. Keep that guard.
- Sessions started from a plan carry `planId`, `planSlot` and `planLabel`.
  `planLabel` is a **snapshot string** ("Week 3 · B") rather than something
  recomputed on read, so history stays truthful after the plan is resized,
  reset or deleted. `finishSession` advances `progress` with `Math.max`, never
  assignment — replaying an earlier week must not undo later progress.

**Rep targets flow one way**: `startSession` copies each program exercise's
`reps` onto the session entry as `target`. Editing the program afterwards must
not rewrite what a logged workout told you to do, which is why it's copied
rather than looked up. In `renderSession` the target drives the reps
placeholder and the `.target-pill`; ticking a blank set fills reps from
`targetReps(entry.target)` (the first number in the string) so what gets
recorded is always what the placeholder was showing.

**`openExercise(id, from)`, never `go('exercise', id)`**: the chart is reachable
from History, from a logged workout and from a live session, so "back" isn't a
fixed destination — `exerciseReturn` records the origin and `#backBtn` reads it.
Calling `go('exercise', …)` directly strands the user wherever the last caller
happened to be.

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
client (see below). Its line and area fill are painted with `<linearGradient>`s
(`brandLine`, `brandFade`) whose stops get their colours from `styles.css` —
see **Brand** below. Those ids are fixed rather than generated because only one
chart is ever on screen at a time; if two charts ever coexist, they'd collide.
`chartMetric` and `chartSel` are module-level state for the
currently-viewed exercise's chart (which metric, which point is tapped);
they're intentionally not part of `state`/`localStorage` since they're
transient UI state, not data.

**Exercise identity**: `exercises.js` defines `EXERCISE_LIBRARY` (built-ins, ids
like `chest-press`) and `MUSCLE_ORDER` (display grouping). Custom exercises get
ids prefixed `c-` (see `openPicker`). `exerciseById()` in `app.js` is the only
lookup path — never index `EXERCISE_LIBRARY` directly, since custom exercises
live in `state.customExercises`.

The library is ~180 entries grouped finer than chest/back/legs (Quads,
Hamstrings, Glutes and Calves are separate; so are Biceps, Triceps and
Forearms) purely so the picker doesn't become one forty-row section. `muscle`
is display-only — nothing is persisted against it, so regrouping an exercise
is safe. Exercise **ids** are not: they're referenced from every logged
session, so add freely but never rename, reuse or repurpose one.

## Brand

The visual identity is the Evolv logo: an angular "E" on pure black, filled
with a teal → cyan → indigo gradient, alongside wide-tracked uppercase
lettering. Three things carry it through the app:

- **The ramp.** `--brand-1`/`--brand-2`/`--brand-3` in `:root` are the logo's
  three stops and `--brand` is the 135° gradient built from them. `--accent`
  is an alias for `--brand-2` (the cyan) — a flat colour reads better than a
  gradient at small sizes, so anything small or thin uses `--accent` and only
  larger filled surfaces (primary buttons, the done-set tick, the active
  segment, PB pills) get `--brand` itself. Text painted with the ramp uses
  `.grad-text` (or the same three background-clip lines inline); the
  `-webkit-background-clip` prefix is required for iOS Safari.
- **The mark.** `brand.js` defines `evolvMark(height)` and `evolvLockup()`,
  which return inline SVG. It's a separate file because both `auth.js` (the
  sign-in screen) and `app.js` (top bar, empty state) need it. Each call mints
  a unique gradient id, since the mark is often on screen more than once and
  SVG ids are document-global.
- **The tracking.** `--track` is the letter-spacing used by every uppercase
  label — section headers, field labels, stat keys, the top-bar title, tab
  labels. Uppercase + `--track` is the house style; body copy stays normal.

**Where the ramp is duplicated as literal hex** — two places, both unavoidable
because they render outside the stylesheet's reach, and both must be updated
by hand if the brand colours change:
1. the favicon `data:` URI in `index.html`;
2. `icons/icon-512.png` (and the 180/192 versions downscaled from it).

The PNGs were generated by drawing the same paths onto a canvas in the browser
and downscaling with `sips -z <n> <n>` — there's no rasteriser in this repo and
no build step to add one, so regenerating them is a manual job.

## Styling conventions

All colors are CSS custom properties on `:root` in `styles.css` (`--bg`,
`--accent`, `--good`, `--danger`, etc.) — never hardcode a hex color in CSS,
and never in `app.js`/`auth.js` either. Inline SVG isn't an exception: both the
mark and the chart put classes on their `<stop>` elements and let `styles.css`
set `stop-color` (see `.evolv-mark` and `.chart-grad`), which works where a
`stop-color="var(--x)"` *attribute* would not.

The UI is mobile-first and single-column (`max-width: 720px`), built around a
fixed top bar, an optional fixed rest-timer bar, and a fixed bottom tab bar
(`#tabbar`). In the top bar, `#brand` and `#backBtn` share one 40px slot and
are mutually exclusive (`render()` sets `brand.hidden = !back.hidden`), which
is what keeps the title optically centred on every view.
`[hidden]` is used to show/hide the timer bar; note the CSS has an
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

**Every `fetch()` in `sw.js` passes `{ cache: 'reload' }` explicitly** — both
in `install` (populating a brand-new named cache) and in the runtime
background-refresh path. Without this, `fetch()`/`cache.addAll()` use default
HTTP caching semantics, meaning a stale response already sitting in the
browser's own disk cache can get copied straight into the Cache Storage
entry that's supposed to represent the *fresh* version — silently
reintroducing the exact staleness this file exists to prevent. Don't drop
this when touching `sw.js`.

## Security

- **CSP**: `index.html` sets a `Content-Security-Policy` meta tag restricting
  `script-src`/`connect-src`/`object-src`/`base-uri`/`form-action` to same-origin
  plus the Supabase project's URL. `connect-src` must be kept in sync with
  `SUPABASE_URL` in `supabase-config.js` if the project ever changes, or
  Supabase calls will start failing silently (check for
  `securitypolicyviolation` events / console CSP errors first if auth/sync
  ever mysteriously stops working after a config change). `style-src` keeps
  `'unsafe-inline'` because `app.js`/`auth.js` render lots of inline `style="`
  attributes — removing it would need converting all of those to CSS classes.
- **Inline scripts are not allowed under this CSP** — that's why service worker
  registration lives in its own file, `register-sw.js`, instead of an inline
  `<script>` block in `index.html`. Any future one-off inline script needs the
  same treatment (its own file), not a CSP exception.
- **Clickjacking is NOT mitigated, and can't be from here.** `frame-ancestors`
  (the real fix) is silently ignored by browsers when delivered via a `<meta>`
  tag — it only works as an actual HTTP response header, and GitHub Pages
  doesn't support custom response headers. This is a known, accepted gap until
  the app is hosted somewhere that does (e.g. a custom domain routed through
  Cloudflare, which can inject the header). Don't try to "fix" this with a meta
  tag or JS frame-busting — neither reliably works; it needs a different host.
- **Row Level Security** (`auth.uid() = user_id`) and the `authenticated`-only
  table grants (see `supabase/schema.sql`) are the real access-control boundary
  for `gymtracker_data` — covered in **Accounts & sync** above. Verify these
  haven't regressed with a plain `curl` against the REST endpoint using only
  the anon key (no `Authorization` header) — it should 401 with "permission
  denied", both for reads and writes.
- **Branch protection** on `main` blocks force-pushes and branch deletion
  (set via the GitHub API, not a repo file). Deliberately has no required PR
  reviews or status checks — this repo's whole deploy model is "push to
  `main` directly", and adding required reviews would break that.
- Keep `vendor/supabase.js` reasonably current — check
  `https://registry.npmjs.org/@supabase/supabase-js/latest` occasionally and
  re-fetch from
  `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<version>/dist/umd/supabase.js`
  (pin an explicit version in the URL — the floating `@2` tag lags behind on
  jsdelivr's CDN cache and isn't reliable for picking up the actual latest).

## Deployment

GitHub Pages, serving directly from the `main` branch root — pushing to
`main` **is** the deploy step, no build/CI in between. `.nojekyll` is present
so GitHub serves the files as-is rather than running them through Jekyll.
Repo is public (required for GitHub Pages on the free plan); there's nothing
sensitive in it — the Supabase anon key is meant to be public, and no user
data ever touches the repo.

## Version control

Plain git repo on `main`, remote `origin` on GitHub
(`Tazza8/tazza8.github.io`, public). No CI, no hooks, no required status
checks — pushing to `main` both is the deploy and needs nothing else to pass
first. Branch protection blocks force-pushes/deletion (see **Security**) but
does not require PRs or reviews, so direct pushes to `main` still work exactly
as before.
