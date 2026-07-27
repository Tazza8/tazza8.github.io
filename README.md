# Iron — Gym Tracker

A gym tracker, installable on iPhone as a real app. No build step, no UI
framework — plain HTML/CSS/JS. Sign in with just an email (no password) and
your programs, workouts and history sync to your account, so multiple people
can install the same app and each see only their own data.

**Try it: https://tazza8.github.io/** — open in Safari on iPhone,
then Share → **Add to Home Screen**.

## Run it locally

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173. Signing in needs a real Supabase project
wired up in `supabase-config.js` (see that file) — without it the app still
loads and shows the sign-in screen, but sending a magic link will fail.

## How it works

**Sign in** — enter your email and get a one-time link back, no password to
create or remember. Every person who signs in gets their own private set of
programs, workouts and history — nothing is shared between accounts. Data is
synced to your account in the background (a couple of seconds after each
change), but actually **saving** a set needs a live connection; a dropped
connection mid-workout doesn't lose anything, it just retries once you're
back online. The app itself still opens instantly with no connection at all.

**Programs** — build a training program by picking exercises from the library
(chest press, squats, deadlifts, ~40 built in, grouped by muscle) or by creating a
custom one. Set how many sets each exercise gets and rename the program. Drag the
⠿ handle to reorder exercises — press and drag anywhere on the handle, the cards
shuffle around the one you're holding and the list auto-scrolls when you reach the
top or bottom edge. The rest of the card still scrolls normally.

**Workout** — start a session on a program and log weight × reps per set. Tick a set
to log it. Under every set, the app shows what you did for that same set last time
("Previous: 62.5 kg × 9"), and those numbers appear as greyed placeholders in the
inputs — tick a set without typing and last time's numbers are reused. Sets can be
added or removed mid-workout.

**Rest timer** — the bar above the tab bar counts down from your rest interval
(default 90 s, changeable in settings). It restarts automatically every time you
tick a set, beeps and vibrates at zero, then counts up into overtime so you know how
long you actually rested. `±15`, pause and manual reset are there too.

**History** — two tabs.

*Workouts* lists finished sessions with date, duration, sets, total volume and how
that volume compares with the last time you ran the same program. Opening one shows
the full set-by-set breakdown, any records broken, and a comparison table against
your previous run of that program — top set and volume per exercise, with the change
in green or red.

*Records* holds a personal best for every exercise you've trained: heaviest set,
best estimated 1RM (Epley: `weight × (1 + reps/30)`, so sets at different reps stay
comparable) and best session volume. Tap one for its progress page — an interactive
chart you can tap point by point to read back any session, switchable between top
set, estimated 1RM and volume, over a session-by-session list showing the change
each time. Bodyweight exercises logged at 0 kg are tracked by reps instead.

Beat a record and the app tells you the moment you finish the workout; those records
are stored with the session, so the history keeps a permanent 🏅 marker.

Unfinished sets aren't saved.

Settings (⚙) cover kg/lb, rest length, alarm sound, JSON export of all your data,
sign-out, and a full erase (which also clears your synced account data, not just
this device).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell: top bar, timer bar, tab bar |
| `styles.css` | All styling; dark, mobile-first |
| `exercises.js` | Built-in exercise library (stable ids — history references them) |
| `app.js` | State, persistence/sync, rendering, rest timer |
| `auth.js` | Sign-in screen and session handling |
| `supabase-config.js` | Your Supabase project's URL + public key |
| `vendor/supabase.js` | The Supabase JS client, vendored so it works offline too |
| `sw.js` | Service worker — caches the app so it opens with no connection |
| `manifest.webmanifest`, `icons/` | Home-screen icon and standalone-app behavior |
| `supabase/schema.sql` | One-time setup SQL for a new Supabase project |

An in-progress workout survives a refresh or a phone lock — it's saved on every
keystroke and restored on load. The screen is kept awake during a session where the
browser supports it.
