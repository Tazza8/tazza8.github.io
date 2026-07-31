/* ============================================================
   Evolv — gym tracker
   State lives in localStorage; everything renders from `state`.
   ============================================================ */

const LS_KEY = 'iron.gymtracker.v1';          // legacy, pre-accounts key
const lsKey = (userId) => LS_KEY + '.' + userId;

const defaultState = () => ({
  programs: [],
  plans: [],            // multi-week schedules built out of programs
  customExercises: [],
  history: [],          // finished sessions, newest first
  daily: [],            // one check-in per day, newest first
  active: null,         // in-progress session
  settings: { unit: 'kg', rest: 90, sound: true },
});

let state = defaultState();
let view = { name: 'home', arg: null };

const stripProtoReviver = (k, v) => (k === '__proto__' ? undefined : v);

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw, stripProtoReviver);
  } catch (e) {
    return null;
  }
}

// Supabase's client already parses the response body itself, so a row's
// `data` column arrives as a plain object rather than a raw string — this
// re-parses it through the same __proto__-stripping reviver `safeParse` uses,
// closing the same prototype-pollution gap for data read back from the
// server, not just from localStorage.
function stripProto(obj) {
  if (!obj) return obj;
  try {
    return JSON.parse(JSON.stringify(obj), stripProtoReviver);
  } catch (e) {
    return obj;
  }
}

/* Loads the signed-in user's data: local cache first (instant, works
   offline), then reconciles with their Supabase row in the background.
   Brand-new accounts get an empty row, then a one-time offer to import any
   pre-accounts data already sitting in this browser under the old flat key. */
async function loadForUser(userId) {
  const bootView = () => {
    go(state.active ? 'session' : 'home');
    if (state.active) setWakeLock(true);
  };

  const cached = safeParse(localStorage.getItem(lsKey(userId)));
  if (cached) {
    state = Object.assign(defaultState(), cached);
    bootView();
  }

  try {
    const { data: row, error } = await supabaseClient
      .from('gymtracker_data')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (row) {
      state = Object.assign(defaultState(), stripProto(row.data));
      localStorage.setItem(lsKey(userId), JSON.stringify(state));
      bootView();
    } else {
      state = defaultState();
      localStorage.setItem(lsKey(userId), JSON.stringify(state));
      await supabaseClient.from('gymtracker_data').insert({ user_id: userId, data: state });
      bootView();
      offerLegacyImport();
    }
  } catch (e) {
    console.warn('Could not reach Supabase; using local cache if available', e);
    if (!cached) bootView();   // still show the (empty) app rather than a blank screen
  }
}

function offerLegacyImport() {
  const legacy = safeParse(localStorage.getItem(LS_KEY));
  const hasData = legacy && ((legacy.programs && legacy.programs.length) || (legacy.history && legacy.history.length));
  if (!hasData) return;
  confirmModal(
    'Import existing data?',
    'This device has workout data saved from before accounts existed. Import it into your new account?',
    () => {
      state = Object.assign(defaultState(), legacy);
      save();
      render();
    },
    'Import'
  );
}

let syncTimer = null;
let syncPending = false;

/* Writes to the local cache instantly (so typing never waits on a network
   round-trip), then pushes to Supabase on a short debounce so rapid edits
   (e.g. every keystroke in a set's weight/reps field) coalesce into one
   request instead of one per keystroke. */
function save() {
  if (!session) return;   // render() gates the whole app behind sign-in
  try {
    localStorage.setItem(lsKey(session.user.id), JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save locally', e);
  }
  syncPending = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 2000);
}

async function syncNow() {
  if (!session || !syncPending) return;
  syncPending = false;
  try {
    const { error } = await supabaseClient
      .from('gymtracker_data')
      .upsert({ user_id: session.user.id, data: state });
    if (error) throw error;
  } catch (e) {
    console.warn('Sync failed, will retry once back online', e);
    syncPending = true;
  }
}

window.addEventListener('online', () => { if (syncPending) syncNow(); });

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function allExercises() {
  return [...EXERCISE_LIBRARY, ...state.customExercises];
}
function exerciseById(id) {
  return allExercises().find((e) => e.id === id) || { id, name: 'Unknown exercise', muscle: 'Other' };
}
const unit = () => state.settings.unit;

/* A rep target is free text ("8-12", "5", "AMRAP", "30s") so it can express
   whatever a program actually prescribes. This pulls out the first number for
   the one place that needs a real value — filling in a set ticked done while
   blank — and returns '' when there isn't one, which callers treat as "no
   target, use last time's". */
const targetReps = (t) => (String(t || '').match(/\d+/) || [''])[0];

/* Rising-line glyph marking anything that opens an exercise's progress chart.
   Inline SVG rather than an emoji so it inherits currentColor and matches the
   angular house style. */
const TREND_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12 L6 7 L9.5 10 L14 3.5"/></svg>`;

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  const day = 86400000;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ts >= midnight) return 'Today';
  if (ts >= midnight - day) return 'Yesterday';
  const days = Math.floor((midnight - ts) / day) + 1;
  if (days < 7) return days + ' days ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function fmtClock(sec) {
  const s = Math.abs(Math.round(sec));
  return (sec < 0 ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

/* Total weight moved in a session */
function volume(session) {
  return session.entries.reduce((t, en) =>
    t + en.sets.reduce((s, set) => s + (set.done ? num(set.weight) * num(set.reps) : 0), 0), 0);
}
function doneSets(session) {
  return session.entries.reduce((t, en) => t + en.sets.filter((s) => s.done).length, 0);
}
function totalSets(session) {
  return session.entries.reduce((t, en) => t + en.sets.length, 0);
}

/* Most recent logged performance of an exercise, ignoring the live session. */
function lastPerformance(exerciseId) {
  for (const s of state.history) {
    const entry = s.entries.find((e) => e.exerciseId === exerciseId && e.sets.some((x) => x.done));
    if (entry) return { date: s.finishedAt || s.startedAt, sets: entry.sets.filter((x) => x.done) };
  }
  return null;
}

/* ---------- performance maths ---------- */
/* Epley estimate of a one-rep max — lets sets at different reps be compared. */
const setE1rm = (s) => num(s.weight) * (1 + num(s.reps) / 30);
const fmtN = (n) => (Math.round(n * 10) / 10).toLocaleString();

/* One data point per session in which an exercise was trained, oldest first. */
function exerciseSeries(exerciseId, history = state.history) {
  const out = [];
  history.forEach((s) => {
    const e = s.entries.find((x) => x.exerciseId === exerciseId);
    if (!e || !e.sets.length) return;
    const heaviest = e.sets.reduce((b, x) => (num(x.weight) > num(b.weight) ? x : b), e.sets[0]);
    const strongest = e.sets.reduce((b, x) => (setE1rm(x) > setE1rm(b) ? x : b), e.sets[0]);
    out.push({
      date: s.finishedAt || s.startedAt,
      sessionId: s.id,
      weight: num(heaviest.weight),
      reps: num(heaviest.reps),
      e1rm: setE1rm(strongest),
      e1rmSet: strongest,
      volume: e.sets.reduce((t, x) => t + num(x.weight) * num(x.reps), 0),
      bestReps: Math.max(...e.sets.map((x) => num(x.reps))),
      totalReps: e.sets.reduce((t, x) => t + num(x.reps), 0),
      setCount: e.sets.length,
    });
  });
  return out.reverse();
}

const METRICS = {
  weight: { label: 'Top set',  get: (p) => p.weight,    suffix: () => ' ' + unit(), detail: (p) => `${fmtN(p.weight)} ${unit()} × ${p.reps}` },
  e1rm:   { label: 'Est. 1RM', get: (p) => p.e1rm,      suffix: () => ' ' + unit(), detail: (p) => `from ${fmtN(num(p.e1rmSet.weight))} ${unit()} × ${p.e1rmSet.reps}` },
  volume: { label: 'Volume',   get: (p) => p.volume,    suffix: () => ' ' + unit(), detail: (p) => `${p.setCount} sets` },
  reps:   { label: 'Best set', get: (p) => p.bestReps,  suffix: () => ' reps',      detail: (p) => `${p.totalReps} reps over ${p.setCount} sets` },
  totalReps: { label: 'Session reps', get: (p) => p.totalReps, suffix: () => ' reps', detail: (p) => `${p.setCount} sets` },
};

/* Exercises always logged at zero weight (push-ups, dips…) are tracked by reps. */
const isBodyweight = (pb) => pb.weight.weight === 0;

/* Best-ever point for each metric. */
function personalBests(exerciseId, history = state.history) {
  const series = exerciseSeries(exerciseId, history);
  if (!series.length) return null;
  const best = (get) => series.reduce((b, p) => (get(p) > get(b) ? p : b), series[0]);
  return {
    series,
    weight: best(METRICS.weight.get),
    e1rm: best(METRICS.e1rm.get),
    volume: best(METRICS.volume.get),
    reps: best(METRICS.reps.get),
  };
}

/* Which records a just-finished session broke, measured against everything before it. */
function findPRs(session, history = state.history) {
  const prs = [];
  session.entries.forEach((entry) => {
    const done = entry.sets.filter((s) => s.done !== false);
    if (!done.length) return;
    const prev = personalBests(entry.exerciseId, history);
    const now = {
      weight: Math.max(...done.map((s) => num(s.weight))),
      e1rm: Math.max(...done.map(setE1rm)),
      volume: done.reduce((t, s) => t + num(s.weight) * num(s.reps), 0),
      reps: Math.max(...done.map((s) => num(s.reps))),
    };
    // Unweighted work can only beat a rep record.
    const kinds = now.weight === 0 && (!prev || isBodyweight(prev))
      ? ['reps']
      : ['weight', 'e1rm', 'volume'];
    kinds.forEach((kind) => {
      const before = prev ? METRICS[kind].get(prev[kind]) : 0;
      if (now[kind] > 0 && now[kind] > before) {
        prs.push({ exerciseId: entry.exerciseId, kind, value: now[kind], prev: before });
      }
    });
  });
  return prs;
}

const PR_LABEL = { weight: 'Heaviest set', e1rm: 'Best est. 1RM', volume: 'Most volume', reps: 'Most reps in a set' };
const prText = (pr) => fmtN(pr.value) + METRICS[pr.kind].suffix();

/* The session before `session` that used the same program. */
function previousSessionOf(session) {
  const i = state.history.findIndex((s) => s.id === session.id);
  return state.history.slice(i + 1).find((s) => s.programId === session.programId) || null;
}
function entryStats(entry) {
  const sets = entry.sets.filter((s) => s.done !== false);
  return {
    volume: sets.reduce((t, s) => t + num(s.weight) * num(s.reps), 0),
    top: sets.reduce((b, s) => (num(s.weight) > num(b.weight) ? s : b), sets[0] || { weight: 0, reps: 0 }),
    count: sets.length,
  };
}
function deltaHTML(now, then, suffix) {
  if (then == null) return '<span class="delta flat">new</span>';
  const d = now - then;
  if (Math.abs(d) < 0.05) return '<span class="delta flat">=</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmtN(Math.abs(d))}${suffix || ''}</span>`;
}

/* ============================================================
   Rest timer
   ============================================================ */
const timer = {
  endAt: null,       // epoch ms when countdown hits zero
  remaining: null,   // seconds left while paused
  running: false,
  tick: null,
  beeped: false,

  seconds() {
    if (this.running) return (this.endAt - Date.now()) / 1000;
    return this.remaining == null ? state.settings.rest : this.remaining;
  },
  start(seconds) {
    const s = seconds == null ? this.seconds() : seconds;
    this.endAt = Date.now() + s * 1000;
    this.running = true;
    this.beeped = false;
    this.loop();
  },
  pause() {
    if (!this.running) return;
    this.remaining = this.seconds();
    this.running = false;
    clearInterval(this.tick);
    this.tick = null;
    this.render();
  },
  reset(autostart) {
    clearInterval(this.tick);
    this.tick = null;
    this.remaining = state.settings.rest;
    this.running = false;
    this.beeped = false;
    if (autostart) this.start(state.settings.rest);
    else this.render();
  },
  adjust(delta) {
    if (this.running) this.endAt += delta * 1000;
    else this.remaining = Math.max(0, this.seconds() + delta);
    if (this.seconds() > 0) this.beeped = false;
    this.render();
  },
  loop() {
    clearInterval(this.tick);
    this.tick = setInterval(() => this.render(), 250);
    this.render();
  },
  render() {
    const bar = $('#timerBar');
    if (!bar || bar.hidden) return;
    const s = this.seconds();
    $('#timerValue').textContent = fmtClock(s);
    $('#timerToggle').textContent = this.running ? 'Pause' : 'Start';
    bar.classList.toggle('running', this.running && s > 0);
    bar.classList.toggle('over', s <= 0);
    $('#timerLabel').textContent = s <= 0 ? 'Rest over' : 'Rest';
    if (s <= 0 && !this.beeped) {
      this.beeped = true;
      alarm();
    }
  },
};

let audioCtx = null;
function alarm() {
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.28].forEach((offset) => {
      const t = audioCtx.currentTime + offset;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch (e) { /* audio unavailable — vibration/visual still fire */ }
}

/* Keep the screen awake mid-workout where supported. */
let wakeLock = null;
async function setWakeLock(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) { /* non-fatal */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.active) setWakeLock(true);
    timer.render();
  }
});

/* ============================================================
   Daily check-in & readiness

   Everything here is self-reported. The app has no sensors and can't get
   any: iOS gives a web app no HealthKit access, no Web Bluetooth and no
   background execution, so passive measurement of the kind a Whoop strap
   does is off the table entirely — see the note in CLAUDE.md before
   promising otherwise. What this *can* do that a strap can't is line those
   numbers up against the training that caused them.

   Readiness is therefore a subjective score, and is labelled as one in the
   UI. It must never be presented as a physiological measurement.
   ============================================================ */
const SLEEP_TARGET = 8;      // hours; the denominator for the sleep component

/* Local calendar day, not UTC — a 11pm check-in belongs to that evening's
   date, which toISOString() would get wrong for anyone west of UTC. */
function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* 1–5 scales. `better` says which end is good, so scoring can invert the two
   where a high number is a bad thing. */
const RATINGS = {
  energy:       { label: 'Energy',        low: 'Drained',   high: 'Firing',   better: 'high' },
  sleepQuality: { label: 'Sleep quality', low: 'Broken',    high: 'Deep',     better: 'high' },
  soreness:     { label: 'Soreness',      low: 'Fresh',     high: 'Wrecked',  better: 'low' },
  stress:       { label: 'Stress',        low: 'Calm',      high: 'Frazzled', better: 'low' },
};

const hasVal = (v) => v !== undefined && v !== null && v !== '';
const ratingScore = (r, better) => (better === 'high' ? (r - 1) : (5 - r)) / 4 * 100;

function dailyFor(key) {
  return state.daily.find((d) => d.date === key) || null;
}
/* Days are kept newest-first like history, so an inserted day is spliced into
   place rather than appended. */
function dailyUpsert(key) {
  let day = dailyFor(key);
  if (!day) {
    day = { date: key };
    const at = state.daily.findIndex((d) => d.date < key);
    state.daily.splice(at === -1 ? state.daily.length : at, 0, day);
  }
  return day;
}

/* Acute:chronic workload ratio — the last 3 days of training volume against
   what 3 days usually looks like over the past 28. Around 1 means you're
   training at your normal load; well above it means a spike, which is the
   only objective input readiness has. Null when there's too little history
   for the comparison to say anything. */
function loadRatio(ts = Date.now()) {
  const DAY = 86400000;
  const volumeWithin = (days) => state.history.reduce((sum, s) => {
    const t = s.finishedAt || s.startedAt;
    return t <= ts && t > ts - days * DAY ? sum + volume(s) : sum;
  }, 0);
  const chronic = volumeWithin(28) / 28 * 3;
  if (!chronic) return null;
  return volumeWithin(3) / chronic;
}

/* Weighted mean of whatever the user actually filled in — a check-in with
   only sleep and energy still scores, it just leans on those two. Returns
   null when nothing scorable is present, so the UI can prompt instead of
   showing a meaningless zero. */
function readiness(day, ts) {
  if (!day) return null;
  const parts = [];

  const hours = num(day.sleep);
  if (hasVal(day.sleep) && hours > 0) {
    parts.push({ key: 'sleep', weight: 0.25, score: Math.min(1, hours / SLEEP_TARGET) * 100, label: `${fmtN(hours)}h sleep` });
  }
  Object.entries(RATINGS).forEach(([key, meta]) => {
    if (!hasVal(day[key])) return;
    const weight = key === 'energy' ? 0.25 : key === 'stress' ? 0.10 : 0.15;
    parts.push({ key, weight, score: ratingScore(num(day[key]), meta.better), label: meta.label.toLowerCase() });
  });

  const ratio = loadRatio(ts == null ? Date.now() : ts);
  if (ratio != null) {
    parts.push({
      key: 'load',
      weight: 0.10,
      score: Math.max(0, Math.min(100, 100 - Math.max(0, ratio - 1) * 60)),
      label: 'training load',
    });
  }

  if (!parts.length) return null;
  const total = parts.reduce((t, p) => t + p.weight, 0);
  const score = Math.round(parts.reduce((t, p) => t + p.score * p.weight, 0) / total);
  // Whatever scored worst is what the user can most usefully act on.
  const worst = parts.reduce((w, p) => (p.score < w.score ? p : w), parts[0]);
  // How many of the five self-reported fields backed this up. Training load
  // doesn't count — it arrives free and would flatter a near-empty check-in.
  // One field answered is not a readiness verdict, and the card says so.
  const selfReported = parts.filter((p) => p.key !== 'load').length;
  return { score, parts, worst, ratio, selfReported };
}

const readinessWord = (score) =>
  score >= 80 ? 'Primed' : score >= 65 ? 'Good' : score >= 45 ? 'Moderate' : 'Low';

/* Chartable daily metrics, same shape as METRICS. */
const DAILY_METRICS = {
  readiness:  { label: 'Readiness', suffix: () => '',           get: (p) => p.value },
  sleep:      { label: 'Sleep',     suffix: () => ' h',         get: (p) => p.value },
  energy:     { label: 'Energy',    suffix: () => ' / 5',       get: (p) => p.value },
  weight:     { label: 'Weight',    suffix: () => ' ' + unit(), get: (p) => p.value },
  restingHR:  { label: 'Rest HR',   suffix: () => ' bpm',       get: (p) => p.value },
};

/* Oldest first, skipping days where that metric wasn't filled in — the chart
   plots what was recorded rather than inventing zeroes for blank days. */
function dailySeries(key) {
  return [...state.daily]
    .reverse()
    .map((d) => {
      const ts = new Date(d.date + 'T12:00:00').getTime();
      if (key === 'readiness') {
        const r = readiness(d, ts);
        return r ? { date: ts, value: r.score } : null;
      }
      return hasVal(d[key]) && num(d[key]) > 0 ? { date: ts, value: num(d[key]) } : null;
    })
    .filter(Boolean);
}

/* ============================================================
   Drag to reorder
   Cards are dragged by their grip; the rest of the card still scrolls.
   Positions are tracked in page coordinates so mid-drag scrolling is safe.
   ============================================================ */
function enableDragReorder(container, onReorder) {
  let drag = null;
  let autoScroll = null;

  const apply = () => {
    const pageY = drag.lastClientY + window.scrollY;
    const dy = pageY - drag.startY;
    drag.item.style.transform = `translateY(${dy}px)`;

    const centre = drag.tops[drag.from] + drag.h / 2 + dy;
    let to = drag.from;
    drag.tops.forEach((top, i) => {
      if (i === drag.from) return;
      const mid = top + drag.heights[i] / 2;
      if (i > drag.from && centre > mid) to = Math.max(to, i);
      if (i < drag.from && centre < mid) to = Math.min(to, i);
    });
    if (to !== drag.to) {
      drag.to = to;
      drag.items.forEach((el, i) => {
        if (i === drag.from) return;
        let shift = 0;
        if (drag.from < to && i > drag.from && i <= to) shift = -drag.step;
        else if (drag.from > to && i >= to && i < drag.from) shift = drag.step;
        el.style.transform = `translateY(${shift}px)`;
      });
    }
  };

  const stopScroll = () => { clearInterval(autoScroll); autoScroll = null; };

  const onMove = (e) => {
    if (!drag) return;
    e.preventDefault();
    drag.lastClientY = e.clientY;
    apply();

    // Nudge the page when dragging against the top or bottom edge.
    const near = e.clientY < 90 ? -9 : e.clientY > window.innerHeight - 150 ? 9 : 0;
    drag.dir = near;
    if (near && !autoScroll) {
      autoScroll = setInterval(() => {
        if (!drag) return stopScroll();
        window.scrollBy(0, drag.dir);
        apply();
      }, 16);
    }
    if (!near) stopScroll();
  };

  const end = () => {
    if (!drag) return;
    stopScroll();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const { from, to } = drag;
    drag.items.forEach((el) => {
      el.style.transform = '';
      el.classList.remove('dragging');
    });
    drag = null;
    if (from !== to) onReorder(from, to);
  };

  container.querySelectorAll('.grip').forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const items = [...container.querySelectorAll('.drag-item')];
      const item = grip.closest('.drag-item');
      const from = items.indexOf(item);
      const rects = items.map((el) => el.getBoundingClientRect());
      const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;

      drag = {
        items, item, from, to: from,
        tops: rects.map((r) => r.top + window.scrollY),
        heights: rects.map((r) => r.height),
        h: rects[from].height,
        step: rects[from].height + gap,
        startY: e.clientY + window.scrollY,
        lastClientY: e.clientY,
      };
      item.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(8);

      // Tracked on window: the pointer regularly leaves the grip mid-drag.
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  });
}

/* ============================================================
   Interactive chart
   ============================================================ */
let chartMetric = 'e1rm';
let chartSel = null;   // index of the highlighted point

/* The exercise chart is reachable from History, from a logged workout and
   from a live session, so "back" can't be a fixed destination — this records
   where the user came from. Always open the view through openExercise(), not
   go('exercise', ...), or back will strand them somewhere they weren't. */
let exerciseReturn = { name: 'history', arg: null };

function openExercise(exerciseId, from) {
  exerciseReturn = from || { name: 'history', arg: null };
  chartSel = null;
  go('exercise', exerciseId);
}

/* Takes a getter rather than a METRICS key so both the exercise charts and the
   daily-trend charts can use it; they have entirely different point shapes but
   the same needs. Points only have to carry a `date`. */
function chartSVG(series, get, sel, label) {
  const W = 320, H = 148, padL = 36, padR = 10, padT = 12, padB = 20;
  const vals = series.map(get);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || Math.max(max * 0.12, 1);
  const hi = max + span * 0.18, lo = Math.max(0, min - span * 0.18);
  const x = (i) => series.length === 1
    ? padL + (W - padL - padR) / 2
    : padL + (i * (W - padL - padR)) / (series.length - 1);
  const y = (v) => padT + ((hi - v) * (H - padT - padB)) / (hi - lo || 1);

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const colW = (W - padL - padR) / Math.max(1, series.length - 1);

  return `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} over time">
    <defs>
      <!-- The line runs the brand ramp left-to-right across the plot; the fill
           under it is the same ramp fading out downward. Stop colours come
           from styles.css via the .chart-grad classes — see .evolv-mark for
           the same trick. -->
      <linearGradient id="brandLine" class="chart-grad" gradientUnits="userSpaceOnUse" x1="${padL}" x2="${W - padR}" y1="0" y2="0">
        <stop class="g1" offset="0"/>
        <stop class="g2" offset=".5"/>
        <stop class="g3" offset="1"/>
      </linearGradient>
      <linearGradient id="brandFade" class="chart-grad" x1="0" x2="0" y1="0" y2="1">
        <stop class="g2" offset="0" stop-opacity=".3"/>
        <stop class="g3" offset="1" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${ticks.map((t) => `
      <line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>
      <text class="chart-lbl" x="2" y="${(y(t) + 3).toFixed(1)}">${fmtN(t)}</text>`).join('')}
    ${series.length > 1 ? `<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>` : ''}
    ${series.map((p, i) => `<circle class="chart-dot ${i === sel ? 'sel' : ''}" cx="${x(i).toFixed(1)}" cy="${y(get(p)).toFixed(1)}" r="${i === sel ? 5 : 3.5}"/>`).join('')}
    ${series.map((p, i) => `<rect class="chart-hit" data-pt="${i}" x="${(x(i) - colW / 2).toFixed(1)}" y="0" width="${colW.toFixed(1)}" height="${H}"/>`).join('')}
    <text class="chart-lbl" x="${padL}" y="${H - 5}">${esc(new Date(series[0].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</text>
    <text class="chart-lbl" x="${W - padR}" y="${H - 5}" text-anchor="end">${esc(new Date(series[series.length - 1].date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</text>
  </svg>`;
}

function sparkline(series, get) {
  if (series.length < 2) return '';
  const vals = series.map(get);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const pts = series.map((p, i) =>
    `${(i * 58) / (series.length - 1)},${20 - ((get(p) - min) / span) * 18}`).join(' ');
  return `<svg width="60" height="22" viewBox="0 0 60 22" style="flex:0 0 60px">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round" opacity=".85"/></svg>`;
}

/* ============================================================
   Navigation
   ============================================================ */
function go(name, arg) {
  view = { name, arg: arg == null ? null : arg };
  render();
  window.scrollTo(0, 0);
}

/* ============================================================
   Render
   ============================================================ */
function render() {
  const app = $('#app');
  const back = $('#backBtn');
  const brand = $('#brand');
  const settingsBtn = $('#settingsBtn');
  const tabbar = $('#tabbar');

  if (!session) {
    $('#title').textContent = 'Evolv';
    back.hidden = true;
    brand.hidden = true;      // the sign-in screen has the full lockup already
    settingsBtn.hidden = true;
    tabbar.hidden = true;
    $('#timerBar').hidden = true;
    document.body.classList.remove('in-session');
    document.body.classList.add('signed-out');
    renderSignIn(app);
    return;
  }
  settingsBtn.hidden = false;
  tabbar.hidden = false;
  document.body.classList.remove('signed-out');

  back.hidden = view.name === 'home' || view.name === 'history'
    || view.name === 'session' || view.name === 'daily';
  brand.hidden = !back.hidden;
  if (!brand.innerHTML) brand.innerHTML = evolvMark(21);

  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.view === view.name ||
      (t.dataset.view === 'home' && view.name === 'program') ||
      (t.dataset.view === 'history' && (view.name === 'historyDetail' || view.name === 'exercise'));
    t.classList.toggle('active', active);
  });

  const bar = $('#timerBar');
  bar.hidden = !(view.name === 'session' && state.active);
  document.body.classList.toggle('in-session', !bar.hidden);
  if (!bar.hidden) timer.render();

  switch (view.name) {
    case 'home': return renderHome(app);
    case 'program': return renderProgram(app, view.arg);
    case 'plan': return renderPlan(app, view.arg);
    case 'session': return renderSession(app);
    case 'daily': return renderDaily(app);
    case 'history': return renderHistory(app);
    case 'historyDetail': return renderHistoryDetail(app, view.arg);
    case 'exercise': return renderExercise(app, view.arg);
  }
}

/* ---------- home: plans + programs ---------- */
function renderHome(app) {
  $('#title').textContent = 'Programs';

  const newButtons = `
    <div class="row" style="gap:10px;margin-top:14px">
      <button class="btn grow" id="newProgram">+ Program</button>
      <button class="btn grow" id="newPlan">+ Plan</button>
    </div>`;

  if (!state.programs.length && !state.plans.length) {
    app.innerHTML = `
      <div class="empty">
        <div class="big">${evolvMark(44)}</div>
        <div>Nothing here yet.</div>
        <div class="sub">Start with a program — a list of exercises you train together.
          Once you have a few, group them into a multi-week plan.</div>
      </div>
      <button class="btn primary block" id="newProgram">+ New program</button>`;
  } else {
    app.innerHTML = `
      ${state.active ? `
        <div class="card tappable" id="resume" style="border-color:var(--accent)">
          <div class="row between">
            <div class="grow">
              <div class="title">Workout in progress</div>
              <div class="sub">${esc(state.active.planLabel ? state.active.planLabel + ' · ' : '')}${esc(state.active.programName)} · ${doneSets(state.active)}/${totalSets(state.active)} sets done</div>
            </div>
            <div class="btn primary sm">Resume</div>
          </div>
        </div>` : ''}

      ${state.plans.length ? `
        <h2 class="section">Your plans</h2>
        ${state.plans.map((plan) => {
          const total = planTotal(plan);
          const done = planDone(plan);
          const complete = total > 0 && done >= total;
          const nextProgram = total ? programById(plan.rotation[done % plan.rotation.length]) : null;
          return `
          <div class="card">
            <div class="row between">
              <div class="grow" data-plan="${plan.id}" style="cursor:pointer">
                <div class="title truncate">${esc(plan.name)}</div>
                <div class="sub truncate">${!total
                  ? 'Tap to add workouts'
                  : complete
                    ? `Complete · ${total} workouts done`
                    : `Next: ${esc(planSlotLabel(plan, done))}${nextProgram ? ' · ' + esc(nextProgram.name) : ''}`}</div>
              </div>
              ${total && !complete && nextProgram
                ? `<button class="btn primary sm" data-plan-start="${plan.id}">Start</button>`
                : ''}
            </div>
            ${total ? `
              <div class="plan-bar" role="img" aria-label="${done} of ${total} workouts done">
                <div style="width:${Math.round((done / total) * 100)}%"></div>
              </div>
              <div class="sub" style="margin-top:6px">${done} of ${total} workouts · ${plan.weeks} week${plan.weeks === 1 ? '' : 's'}</div>
            ` : ''}
          </div>`;
        }).join('')}` : ''}

      <h2 class="section">Your programs</h2>
      ${state.programs.length ? state.programs.map((p) => {
        const last = state.history.find((h) => h.programId === p.id);
        return `
        <div class="card">
          <div class="row between">
            <div class="grow" data-edit="${p.id}" style="cursor:pointer">
              <div class="title truncate">${esc(p.name)}</div>
              <div class="sub truncate">${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'} · ${p.exercises.reduce((t, e) => t + e.sets, 0)} sets${last ? ' · last ' + fmtDate(last.finishedAt || last.startedAt).toLowerCase() : ''}</div>
            </div>
            <button class="btn primary sm" data-start="${p.id}">Start</button>
          </div>
        </div>`;
      }).join('') : `<div class="empty" style="padding:22px">
          <div>No programs yet</div>
          <div class="sub">Plans are built out of these.</div>
        </div>`}
      ${newButtons}`;
  }

  const addProgram = () => {
    const p = { id: uid(), name: '', exercises: [] };
    state.programs.push(p);
    save();
    go('program', p.id);
  };
  $('#newProgram').onclick = addProgram;
  if ($('#newPlan')) {
    $('#newPlan').onclick = () => {
      const plan = { id: uid(), name: '', weeks: 10, rotation: [], progress: 0 };
      state.plans.push(plan);
      save();
      go('plan', plan.id);
    };
  }
  const resume = $('#resume');
  if (resume) resume.onclick = () => go('session');
  app.querySelectorAll('[data-edit]').forEach((el) => {
    el.onclick = () => go('program', el.dataset.edit);
  });
  app.querySelectorAll('[data-plan]').forEach((el) => {
    el.onclick = () => go('plan', el.dataset.plan);
  });
  app.querySelectorAll('[data-plan-start]').forEach((el) => {
    el.onclick = () => {
      const plan = state.plans.find((x) => x.id === el.dataset.planStart);
      const slot = planDone(plan);
      startSession(plan.rotation[slot % plan.rotation.length], plan, slot);
    };
  });
  app.querySelectorAll('[data-start]').forEach((el) => {
    el.onclick = () => startSession(el.dataset.start);
  });
}

/* ---------- program editor ---------- */
function renderProgram(app, id) {
  const p = state.programs.find((x) => x.id === id);
  if (!p) return go('home');
  $('#title').textContent = 'Edit program';

  app.innerHTML = `
    <label class="field">
      <span>Program name</span>
      <input type="text" id="pname" value="${esc(p.name)}" placeholder="e.g. Push Day" autocomplete="off">
    </label>

    <h2 class="section">Exercises${p.exercises.length > 1 ? ' · drag ⠿ to reorder' : ''}</h2>
    <div id="dragList">
    ${p.exercises.length ? p.exercises.map((item, i) => {
      const ex = exerciseById(item.exerciseId);
      return `
      <div class="card drag-item" data-i="${i}">
        <div class="row">
          <div class="grip" aria-label="Drag to reorder">⠿</div>
          <div class="grow">
            <div class="title truncate">${esc(ex.name)}</div>
            <div class="sub">${esc(ex.muscle)}</div>
          </div>
          <button class="btn sm ghost" data-remove="${i}" aria-label="Remove" style="color:var(--muted);padding:8px 11px">✕</button>
        </div>
        <div class="row" style="gap:6px;margin-top:10px">
          <button class="btn sm grow" data-sets="-1" data-i="${i}">−</button>
          <div style="min-width:70px;text-align:center;font-weight:600">${item.sets} set${item.sets === 1 ? '' : 's'}</div>
          <button class="btn sm grow" data-sets="1" data-i="${i}">+</button>
        </div>
        <label class="row between" style="margin-top:9px">
          <span class="badge">Target reps</span>
          <input class="target-input" type="text" data-reps="${i}" value="${esc(item.reps || '')}"
                 placeholder="e.g. 8-12" aria-label="Target reps for ${esc(ex.name)}">
        </label>
      </div>`;
    }).join('') : `<div class="empty" style="padding:26px"><div>No exercises yet</div></div>`}
    </div>

    <button class="btn block" id="addEx">+ Add exercises</button>

    <div class="row" style="gap:10px;margin-top:22px">
      <button class="btn danger grow" id="delProgram">Delete program</button>
      <button class="btn primary grow" id="doneProgram">Done</button>
    </div>`;

  const nameInput = $('#pname');
  nameInput.oninput = () => { p.name = nameInput.value; save(); };
  if (!p.name) nameInput.focus();

  app.querySelectorAll('[data-sets]').forEach((el) => {
    el.onclick = () => {
      const item = p.exercises[+el.dataset.i];
      item.sets = Math.min(12, Math.max(1, item.sets + +el.dataset.sets));
      save();
      renderProgram(app, id);
    };
  });
  // Free text ("8-12", "5", "AMRAP") — deliberately not validated, and like
  // the set-row inputs it writes on input without re-rendering, so typing
  // never loses focus.
  app.querySelectorAll('[data-reps]').forEach((el) => {
    el.oninput = () => {
      p.exercises[+el.dataset.reps].reps = el.value.trim();
      save();
    };
  });
  enableDragReorder($('#dragList'), (from, to) => {
    const [moved] = p.exercises.splice(from, 1);
    p.exercises.splice(to, 0, moved);
    save();
    renderProgram(app, id);
  });
  app.querySelectorAll('[data-remove]').forEach((el) => {
    el.onclick = () => {
      p.exercises.splice(+el.dataset.remove, 1);
      save();
      renderProgram(app, id);
    };
  });
  $('#addEx').onclick = () => openPicker(p, () => renderProgram(app, id));
  $('#doneProgram').onclick = () => {
    if (!p.name.trim()) p.name = 'Untitled program';
    save();
    go('home');
  };
  $('#delProgram').onclick = () => {
    confirmModal('Delete this program?', 'Logged workouts stay in your history.', () => {
      state.programs = state.programs.filter((x) => x.id !== p.id);
      save();
      go('home');
    });
  };
}

/* ---------- exercise picker ---------- */
function openPicker(program, onClose) {
  const chosen = new Set();

  const body = document.createElement('div');
  body.className = 'modal-back';
  body.innerHTML = `
    <div class="modal">
      <h3>Add exercises</h3>
      <input type="text" id="search" placeholder="Search exercises…" autocomplete="off">
      <div id="list" style="margin-top:12px"></div>
      <button class="btn block sm ghost" id="customBtn" style="margin-top:12px">+ Create custom exercise</button>
      <div class="modal-actions">
        <button class="btn" id="cancel">Cancel</button>
        <button class="btn primary" id="add">Add <span id="cnt"></span></button>
      </div>
    </div>`;
  $('#modalRoot').appendChild(body);

  function drawList() {
    const q = $('#search', body).value.trim().toLowerCase();
    const groups = {};
    allExercises()
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q))
      .forEach((e) => (groups[e.muscle] = groups[e.muscle] || []).push(e));

    const keys = Object.keys(groups).sort((a, b) => MUSCLE_ORDER.indexOf(a) - MUSCLE_ORDER.indexOf(b));
    $('#list', body).innerHTML = keys.length
      ? keys.map((m) => `
          <h2 class="section">${esc(m)}</h2>
          ${groups[m].map((e) => `
            <div class="pick-item ${chosen.has(e.id) ? 'on' : ''}" data-id="${e.id}">
              <div class="check">✓</div>
              <div class="grow truncate">${esc(e.name)}</div>
            </div>`).join('')}`).join('')
      : `<div class="empty" style="padding:24px">No matches</div>`;

    $('#list', body).querySelectorAll('.pick-item').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.id;
        chosen.has(id) ? chosen.delete(id) : chosen.add(id);
        el.classList.toggle('on');
        $('#cnt', body).textContent = chosen.size ? '(' + chosen.size + ')' : '';
      };
    });
  }
  drawList();

  $('#search', body).oninput = drawList;
  $('#customBtn', body).onclick = () => {
    promptModal('New exercise', 'Exercise name', '', (name) => {
      if (!name.trim()) return;
      const ex = { id: 'c-' + uid(), name: name.trim(), muscle: 'Other', custom: true };
      state.customExercises.push(ex);
      chosen.add(ex.id);
      save();
      drawList();
      $('#cnt', body).textContent = '(' + chosen.size + ')';
    });
  };
  const close = () => { body.remove(); onClose(); };
  $('#cancel', body).onclick = close;
  $('#add', body).onclick = () => {
    chosen.forEach((id) => {
      if (!program.exercises.some((e) => e.exerciseId === id)) {
        program.exercises.push({ exerciseId: id, sets: 3, reps: '8-12' });
      }
    });
    save();
    close();
  };
  body.onclick = (e) => { if (e.target === body) close(); };
}

/* ============================================================
   Plans
   A plan is a rotation of programs run for a number of weeks — "10 weeks,
   full body, 3x per week as A/B/C" is `weeks: 10, rotation: [A, B, C]`.
   Every week runs the same rotation by design: progression comes from the
   weight you put on the bar, not from authoring thirty separate workouts.

   That makes the whole plan a flat, ordered queue of `weeks x rotation`
   sessions, so one integer — `progress`, the number completed — is enough to
   place you in it. Slot n is week `n / rotation.length + 1`, letter
   `n % rotation.length`. Nothing else needs storing.

   `rotation` holds program ids rather than copies, so editing a program
   updates it everywhere it's used. Ids can repeat (A/B/A is legal), and a
   program deleted out from under a plan leaves a hole the UI labels rather
   than crashing on.
   ============================================================ */
const DAY_LETTERS = 'ABCDEFGH';
const programById = (id) => state.programs.find((p) => p.id === id);
const planTotal = (plan) => plan.weeks * plan.rotation.length;
const planWeekOf = (plan, slot) => Math.floor(slot / plan.rotation.length) + 1;
const planLetterOf = (plan, slot) => DAY_LETTERS[slot % plan.rotation.length] || '?';
const planDone = (plan) => Math.min(plan.progress || 0, planTotal(plan));
// Snapshotted onto the session so history stays readable even if the plan is
// later resized or deleted.
const planSlotLabel = (plan, slot) => `Week ${planWeekOf(plan, slot)} · ${planLetterOf(plan, slot)}`;

function renderPlan(app, id) {
  const plan = state.plans.find((x) => x.id === id);
  if (!plan) return go('home');
  $('#title').textContent = 'Edit plan';

  const total = planTotal(plan);
  const done = planDone(plan);

  app.innerHTML = `
    <label class="field">
      <span>Plan name</span>
      <input type="text" id="planName" value="${esc(plan.name)}" placeholder="e.g. 10 Week Full Body" autocomplete="off">
    </label>

    <h2 class="section">Length</h2>
    <div class="card">
      <div class="row" style="gap:6px">
        <button class="btn sm grow" data-weeks="-1">−</button>
        <div style="min-width:96px;text-align:center;font-weight:600">${plan.weeks} week${plan.weeks === 1 ? '' : 's'}</div>
        <button class="btn sm grow" data-weeks="1">+</button>
      </div>
      <div class="sub" style="text-align:center;margin-top:10px">${plan.rotation.length
        ? `${plan.rotation.length}× per week · ${total} workouts in total`
        : 'Add workouts below to build the weekly rotation'}</div>
    </div>

    <h2 class="section">Weekly rotation${plan.rotation.length > 1 ? ' · drag ⠿ to reorder' : ''}</h2>
    <div id="dragList">
    ${plan.rotation.length ? plan.rotation.map((pid, i) => {
      const p = programById(pid);
      return `
      <div class="card drag-item">
        <div class="row">
          <div class="grip" aria-label="Drag to reorder">⠿</div>
          <div class="day-letter">${DAY_LETTERS[i] || '?'}</div>
          <div class="grow">
            <div class="title truncate">${p ? esc(p.name) : 'Deleted program'}</div>
            <div class="sub truncate">${p
              ? `${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'} · ${p.exercises.reduce((t, e) => t + e.sets, 0)} sets`
              : 'No longer exists — remove it'}</div>
          </div>
          <button class="btn sm ghost" data-rot-remove="${i}" aria-label="Remove" style="color:var(--muted);padding:8px 11px">✕</button>
        </div>
      </div>`;
    }).join('') : `<div class="empty" style="padding:26px">
        <div>No workouts yet</div>
        <div class="sub">A plan cycles through programs you've already built.</div>
      </div>`}
    </div>
    <button class="btn block" id="addRot">+ Add workout to rotation</button>

    ${total ? `
      <h2 class="section">Schedule</h2>
      <div class="card" style="padding:10px 12px">
        ${Array.from({ length: plan.weeks }, (_, w) => `
          <div class="week-row">
            <div class="week-no">W${w + 1}</div>
            <div class="week-days">
              ${plan.rotation.map((pid, d) => {
                const slot = w * plan.rotation.length + d;
                return `<button class="day-pill ${slot < done ? 'done' : slot === done ? 'now' : ''}"
                          data-slot="${slot}" aria-label="${esc(planSlotLabel(plan, slot))}">${DAY_LETTERS[d] || '?'}</button>`;
              }).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="sub" style="text-align:center;margin-top:8px">Tap any workout to start it</div>
      ${done ? `<button class="btn block sm ghost" id="resetPlan" style="margin-top:10px">Reset progress</button>` : ''}
    ` : ''}

    <div class="row" style="gap:10px;margin-top:22px">
      <button class="btn danger grow" id="delPlan">Delete plan</button>
      <button class="btn primary grow" id="donePlan">Done</button>
    </div>`;

  const nameInput = $('#planName');
  nameInput.oninput = () => { plan.name = nameInput.value; save(); };
  if (!plan.name) nameInput.focus();

  app.querySelectorAll('[data-weeks]').forEach((el) => {
    el.onclick = () => {
      plan.weeks = Math.min(52, Math.max(1, plan.weeks + +el.dataset.weeks));
      save();
      renderPlan(app, id);
    };
  });
  enableDragReorder($('#dragList'), (from, to) => {
    const [moved] = plan.rotation.splice(from, 1);
    plan.rotation.splice(to, 0, moved);
    save();
    renderPlan(app, id);
  });
  app.querySelectorAll('[data-rot-remove]').forEach((el) => {
    el.onclick = () => {
      plan.rotation.splice(+el.dataset.rotRemove, 1);
      save();
      renderPlan(app, id);
    };
  });
  app.querySelectorAll('[data-slot]').forEach((el) => {
    el.onclick = () => {
      const slot = +el.dataset.slot;
      startSession(plan.rotation[slot % plan.rotation.length], plan, slot);
    };
  });
  $('#addRot').onclick = () => openProgramPicker((pid) => {
    plan.rotation.push(pid);
    save();
    renderPlan(app, id);
  });
  if ($('#resetPlan')) {
    $('#resetPlan').onclick = () => {
      confirmModal('Reset progress?', 'The plan starts again from week 1. Logged workouts stay in your history.', () => {
        plan.progress = 0;
        save();
        renderPlan(app, id);
      }, 'Reset');
    };
  }
  $('#donePlan').onclick = () => {
    if (!plan.name.trim()) plan.name = 'Untitled plan';
    save();
    go('home');
  };
  $('#delPlan').onclick = () => {
    confirmModal('Delete this plan?', 'The programs it uses and your logged workouts both stay.', () => {
      state.plans = state.plans.filter((x) => x.id !== plan.id);
      save();
      go('home');
    });
  };
}

/* Single-select list of existing programs, for building a rotation. */
function openProgramPicker(onPick) {
  const body = document.createElement('div');
  body.className = 'modal-back';
  body.innerHTML = `
    <div class="modal">
      <h3>Add to rotation</h3>
      ${state.programs.length
        ? state.programs.map((p) => `
          <div class="pick-item" data-id="${p.id}">
            <div class="grow">
              <div class="title truncate" style="font-size:15px">${esc(p.name)}</div>
              <div class="sub">${p.exercises.length} exercise${p.exercises.length === 1 ? '' : 's'}</div>
            </div>
            <div class="sub" style="margin:0">＋</div>
          </div>`).join('')
        : `<div class="empty" style="padding:24px">
             <div>No programs yet</div>
             <div class="sub">Build a program first — a plan is made of them.</div>
           </div>`}
      <div class="modal-actions"><button class="btn" id="cancel">Cancel</button></div>
    </div>`;
  $('#modalRoot').appendChild(body);

  const close = () => body.remove();
  body.querySelectorAll('.pick-item').forEach((el) => {
    el.onclick = () => { close(); onPick(el.dataset.id); };
  });
  $('#cancel', body).onclick = close;
  body.onclick = (e) => { if (e.target === body) close(); };
}

/* ============================================================
   Session
   ============================================================ */
function startSession(programId, plan, slot) {
  const p = state.programs.find((x) => x.id === programId);
  if (!p) return;
  if (!p.exercises.length) {
    confirmModal('Nothing to train', 'Add some exercises to this program first.', () => go('program', p.id), 'Edit program');
    return;
  }
  const begin = () => {
    state.active = {
      id: uid(),
      programId: p.id,
      programName: p.name,
      startedAt: Date.now(),
      ...(plan ? { planId: plan.id, planSlot: slot, planLabel: planSlotLabel(plan, slot) } : {}),
      entries: p.exercises.map((item) => ({
        exerciseId: item.exerciseId,
        // Snapshot of the program's target at the time the session started —
        // editing the program later must not rewrite what you were told to do
        // in a workout you've already logged.
        target: item.reps || '',
        sets: Array.from({ length: item.sets }, () => ({ weight: '', reps: '', done: false })),
      })),
    };
    save();
    timer.reset(false);
    setWakeLock(true);
    go('session');
  };
  if (state.active) {
    confirmModal('Discard current workout?', 'You have an unfinished workout in progress.', () => begin(), 'Discard & start');
  } else begin();
}

function renderSession(app) {
  const s = state.active;
  $('#title').textContent = s ? s.programName || 'Workout' : 'Workout';

  if (!s) {
    app.innerHTML = `
      <div class="empty">
        <div class="big">▶</div>
        <div>No workout in progress</div>
        <div class="sub">Pick a program to get started.</div>
      </div>
      ${state.programs.map((p) => `
        <div class="card tappable" data-start="${p.id}">
          <div class="row between">
            <div class="grow">
              <div class="title truncate">${esc(p.name)}</div>
              <div class="sub">${p.exercises.length} exercises</div>
            </div>
            <div class="btn primary sm">Start</div>
          </div>
        </div>`).join('')}
      ${!state.programs.length ? '<button class="btn primary block" id="toPrograms">Create a program</button>' : ''}`;
    app.querySelectorAll('[data-start]').forEach((el) => { el.onclick = () => startSession(el.dataset.start); });
    if ($('#toPrograms')) $('#toPrograms').onclick = () => go('home');
    return;
  }

  app.innerHTML = `
    <div class="card" style="padding:11px 14px">
      <div class="row between">
        <div class="sub" style="margin:0">${s.planLabel ? esc(s.planLabel) + ' · ' : ''}${doneSets(s)}/${totalSets(s)} sets · ${Math.round(volume(s)).toLocaleString()} ${unit()} volume</div>
        <div class="sub" style="margin:0" id="elapsed">${fmtDuration(Date.now() - s.startedAt)}</div>
      </div>
    </div>

    ${s.entries.map((entry, ei) => {
      const ex = exerciseById(entry.exerciseId);
      const prev = lastPerformance(entry.exerciseId);
      return `
      <div class="card ex-card">
        <div class="ex-head">
          <div class="grow">
            <div class="title truncate">${esc(ex.name)}</div>
            <div class="badge">${esc(ex.muscle)}${prev ? ' · last ' + esc(fmtDate(prev.date).toLowerCase()) : ' · first time'}</div>
          </div>
          ${entry.target ? `<div class="target-pill">${entry.sets.length} × ${esc(entry.target)}</div>` : ''}
          ${prev ? `<button class="chart-btn" data-chart="${entry.exerciseId}" aria-label="Progress for ${esc(ex.name)}">${TREND_ICON}</button>` : ''}
        </div>
        <div class="set-head"><div>Set</div><div>${unit()}</div><div>Reps</div><div></div></div>
        ${entry.sets.map((set, si) => {
          const p = prev ? prev.sets[Math.min(si, prev.sets.length - 1)] : null;
          return `
          <div class="set-row ${set.done ? 'done' : ''}">
            <div class="setno">${si + 1}</div>
            <input type="number" inputmode="decimal" step="any" min="0" placeholder="${p ? esc(p.weight) : '—'}"
                   value="${esc(set.weight)}" data-f="weight" data-e="${ei}" data-s="${si}">
            <input type="number" inputmode="numeric" step="1" min="0"
                   placeholder="${entry.target ? esc(entry.target) : (p ? esc(p.reps) : '—')}"
                   value="${esc(set.reps)}" data-f="reps" data-e="${ei}" data-s="${si}">
            <button class="tick ${set.done ? 'on' : ''}" data-done="${ei}-${si}">✓</button>
          </div>
          <div class="prev ${p ? '' : 'none'}">${p
            ? `Previous: <b>${esc(p.weight || '—')} ${unit()} × ${esc(p.reps || '—')}</b>`
            : 'No previous data'}</div>`;
        }).join('')}
        <div class="set-actions">
          <button class="btn sm ghost" data-addset="${ei}">+ Add set</button>
          ${entry.sets.length > 1 ? `<button class="btn sm ghost" data-delset="${ei}">− Remove set</button>` : ''}
        </div>
      </div>`;
    }).join('')}

    <div class="row" style="gap:10px;margin-top:18px">
      <button class="btn danger grow" id="discard">Discard</button>
      <button class="btn primary grow" id="finish">Finish workout</button>
    </div>`;

  // Typing only writes to state — no re-render, so focus is never stolen.
  app.querySelectorAll('input[data-f]').forEach((el) => {
    el.oninput = () => {
      state.active.entries[+el.dataset.e].sets[+el.dataset.s][el.dataset.f] = el.value;
      save();
    };
  });

  app.querySelectorAll('[data-done]').forEach((el) => {
    el.onclick = () => {
      const [ei, si] = el.dataset.done.split('-').map(Number);
      const entry = state.active.entries[ei];
      const set = entry.sets[si];
      set.done = !set.done;

      if (set.done) {
        // Fall back to whatever the placeholder was showing if left blank, so
        // ticking a set never records something other than what you saw.
        // Reps prefer the target (its low end — "8-12" isn't a number);
        // weight has no target to draw on, so it still uses last time's.
        const prev = lastPerformance(entry.exerciseId);
        const p = prev ? prev.sets[Math.min(si, prev.sets.length - 1)] : null;
        if (set.weight === '' && p) set.weight = p.weight;
        if (set.reps === '') set.reps = targetReps(entry.target) || (p ? p.reps : '');
        timer.reset(true);           // rest timer restarts on every completed set
      }
      save();
      renderSession(app);
      timer.render();
    };
  });

  app.querySelectorAll('[data-chart]').forEach((el) => {
    el.onclick = () => openExercise(el.dataset.chart, { name: 'session', arg: null });
  });

  app.querySelectorAll('[data-addset]').forEach((el) => {
    el.onclick = () => {
      state.active.entries[+el.dataset.addset].sets.push({ weight: '', reps: '', done: false });
      save();
      renderSession(app);
    };
  });
  app.querySelectorAll('[data-delset]').forEach((el) => {
    el.onclick = () => {
      const sets = state.active.entries[+el.dataset.delset].sets;
      if (sets.length > 1) sets.pop();
      save();
      renderSession(app);
    };
  });

  $('#finish').onclick = finishSession;
  $('#discard').onclick = () => {
    confirmModal('Discard this workout?', 'Nothing will be saved to your history.', () => {
      state.active = null;
      save();
      setWakeLock(false);
      go('home');
    });
  };
}

function finishSession() {
  const s = state.active;
  if (!doneSets(s)) {
    confirmModal('No sets completed', 'Tick at least one set, or discard the workout.', null, null);
    return;
  }
  confirmModal('Finish workout?', `${doneSets(s)} sets · ${Math.round(volume(s)).toLocaleString()} ${unit()} total volume`, () => {
    s.finishedAt = Date.now();
    // Keep only the sets actually performed.
    s.entries = s.entries
      .map((e) => ({ ...e, sets: e.sets.filter((x) => x.done) }))
      .filter((e) => e.sets.length);
    s.prs = findPRs(s);              // measured against history before this session lands
    state.history.unshift(s);
    state.active = null;
    // Advance the plan, but never backwards: replaying an earlier week
    // shouldn't undo progress you've already made.
    if (s.planId) {
      const plan = state.plans.find((x) => x.id === s.planId);
      if (plan) plan.progress = Math.max(plan.progress || 0, s.planSlot + 1);
    }
    save();
    timer.reset(false);
    setWakeLock(false);
    go('historyDetail', s.id);
    if (s.prs.length) showPRs(s);
  }, 'Finish');
}

/* ============================================================
   Daily view
   ============================================================ */
let dailyMetric = 'readiness';
let dailyOffset = 0;      // 0 = today, 1 = yesterday, … (never negative)

/* Progress ring. The arc takes a flat palette colour rather than the brand
   gradient, because here colour is carrying meaning — a poor score must not
   render in the same cheerful teal as a good one. The three tones are all
   existing palette vars, so the ramp still governs the look. */
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

function ringHTML(pct, tone, big) {
  const dash = RING_C * Math.max(0, Math.min(1, (pct || 0) / 100));
  return `
    <div class="ring-wrap">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="ring-track" cx="50" cy="50" r="${RING_R}"/>
        <circle class="ring-arc ${tone}" cx="50" cy="50" r="${RING_R}"
                stroke-dasharray="${dash.toFixed(1)} ${(RING_C - dash).toFixed(1)}"
                transform="rotate(-90 50 50)"/>
      </svg>
      <div class="ring-mid">${big}</div>
    </div>`;
}

const toneFor = (score) => (score >= 65 ? 'tone-high' : score >= 45 ? 'tone-mid' : 'tone-low');

/* Load sits best around your recent norm. Well above it is a spike worth
   noticing, so it reads as a warning rather than an achievement. */
const loadTone = (ratio) => (ratio > 1.5 ? 'tone-low' : ratio >= 0.8 && ratio <= 1.3 ? 'tone-high' : 'tone-mid');

/* A suggestion, not a prescription — the input is self-report. */
const readinessAdvice = (score) =>
  score >= 80 ? 'Good day to push. Chase a top set.'
  : score >= 65 ? 'Train as planned.'
  : score >= 45 ? 'Hold volume steady rather than adding to it.'
  : 'A lighter session or a rest day is the sensible call.';

function overviewHTML(day, ts) {
  const r = readiness(day, ts);
  if (!r) {
    return `<div class="card">
      <div class="title">No check-in yet</div>
      <div class="sub">Answer anything below and your readiness appears here.</div>
    </div>`;
  }
  // Under three answers there isn't enough to call it: the ring goes neutral
  // and the verdict word is withheld.
  const thin = r.selfReported < 3;
  const hours = num(day.sleep);
  const sleepPct = hours > 0 ? Math.round((hours / SLEEP_TARGET) * 100) : null;

  return `
    <div class="card hero">
      ${ringHTML(r.score, thin ? 'tone-thin' : toneFor(r.score), r.score)}
      <div class="grow">
        <div class="badge">Readiness</div>
        <div class="hero-word">${thin ? 'Partial' : readinessWord(r.score)}</div>
        <div class="sub" style="margin:2px 0 0">${thin
          ? `Based on ${r.selfReported} of 5 answers`
          : `Biggest drag: ${esc(r.worst.label)}`}</div>
      </div>
    </div>
    ${thin ? '' : `<div class="card advice">${esc(readinessAdvice(r.score))}</div>`}
    <div class="duo">
      <div class="card mini">
        ${sleepPct == null
          ? ringHTML(0, 'tone-thin', '—')
          : ringHTML(Math.min(100, sleepPct), toneFor(Math.min(100, sleepPct)), sleepPct + '%')}
        <div class="badge">Sleep</div>
        <div class="sub" style="margin:2px 0 0">${hours > 0 ? `${fmtN(hours)} of ${SLEEP_TARGET}h` : 'not logged'}</div>
      </div>
      <div class="card mini">
        ${r.ratio == null
          ? ringHTML(0, 'tone-thin', '—')
          : ringHTML(Math.min(100, (r.ratio / 1.5) * 100), loadTone(r.ratio), Math.round(r.ratio * 100) + '%')}
        <div class="badge">Load</div>
        <div class="sub" style="margin:2px 0 0">${r.ratio == null ? 'needs history' : 'of your norm'}</div>
      </div>
    </div>
    <div class="sub disclaimer">Self-reported — how you say you feel, plus your recent
      training load. Not a physiological measurement.</div>`;
}

/* The last seven days at a glance; each bar jumps to that day. */
function stripHTML() {
  const DAY = 86400000;
  return `
    <h2 class="section">Last 7 days</h2>
    <div class="strip">
      ${Array.from({ length: 7 }, (_, i) => {
        const off = 6 - i;
        const t = Date.now() - off * DAY;
        const key = dateKey(t);
        const d = dailyFor(key);
        const r = d ? readiness(d, new Date(key + 'T12:00:00').getTime()) : null;
        const score = r ? r.score : null;
        return `
          <button class="strip-day ${off === dailyOffset ? 'sel' : ''}" data-off="${off}"
                  aria-label="${esc(fmtDate(t))}${score == null ? ', no check-in' : ', readiness ' + score}">
            <div class="strip-track">
              ${score == null ? '' : `<div class="strip-fill ${toneFor(score)}" style="height:${Math.max(8, score)}%"></div>`}
            </div>
            <div class="strip-num">${score == null ? '·' : score}</div>
            <div class="strip-letter">${esc(new Date(t).toLocaleDateString(undefined, { weekday: 'narrow' }))}</div>
          </button>`;
      }).join('')}
    </div>`;
}

function renderDaily(app) {
  $('#title').textContent = 'Daily';

  const key = dateKey(Date.now() - dailyOffset * 86400000);
  const ts = new Date(key + 'T12:00:00').getTime();
  const day = dailyFor(key) || { date: key };
  const logged = state.daily.filter((d) => readiness(d, new Date(d.date + 'T12:00:00').getTime()));

  const dayName = dailyOffset === 0 ? 'Today'
    : dailyOffset === 1 ? 'Yesterday'
    : new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const numberField = (field, label, placeholder, step) => `
    <label class="row between" style="margin-bottom:12px">
      <span class="badge">${label}</span>
      <input class="target-input" type="number" inputmode="decimal" step="${step}" min="0"
             data-num="${field}" value="${esc(day[field] == null ? '' : day[field])}"
             placeholder="${placeholder}" aria-label="${label}">
    </label>`;

  const series = dailySeries(dailyMetric);
  const dm = DAILY_METRICS[dailyMetric];

  app.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <button class="btn sm" id="dayBack" aria-label="Previous day">‹</button>
      <div class="day-title">${esc(dayName)}</div>
      <button class="btn sm" id="dayFwd" aria-label="Next day" ${dailyOffset === 0 ? 'disabled style="opacity:.35"' : ''}>›</button>
    </div>

    <div id="overview">${overviewHTML(day, ts)}${stripHTML()}</div>

    <h2 class="section">How you slept</h2>
    <div class="card">
      ${numberField('sleep', 'Hours slept', 'e.g. 7.5', '0.25')}
      ${ratingHTML('sleepQuality', day)}
    </div>

    <h2 class="section">How you feel</h2>
    <div class="card">
      ${ratingHTML('energy', day)}
      ${ratingHTML('soreness', day)}
      ${ratingHTML('stress', day)}
    </div>

    <h2 class="section">Body</h2>
    <div class="card">
      ${numberField('weight', 'Bodyweight (' + unit() + ')', 'e.g. 78', '0.1')}
      ${numberField('restingHR', 'Resting HR (bpm)', 'e.g. 54', '1')}
      <label class="field" style="margin:4px 0 0">
        <span>Notes</span>
        <textarea id="dayNotes" rows="2" placeholder="Anything worth remembering">${esc(day.notes || '')}</textarea>
      </label>
    </div>

    ${logged.length ? `
      <h2 class="section">Trends</h2>
      <div class="card">
        <div class="seg scroll">
          ${Object.keys(DAILY_METRICS).map((k) => `
            <button data-dmetric="${k}" class="${dailyMetric === k ? 'on' : ''}">${DAILY_METRICS[k].label}</button>`).join('')}
        </div>
        ${series.length > 1 ? `
          <div class="chart-read">
            <div>
              <div class="v">${fmtN(series[series.length - 1].value)}<span style="font-size:12px;color:var(--muted)">${dm.suffix()}</span></div>
              <div class="sub" style="margin:0">latest · ${series.length} day${series.length === 1 ? '' : 's'} logged</div>
            </div>
            <div class="d">${esc(fmtDate(series[series.length - 1].date))}</div>
          </div>
          <div class="chart-wrap">${chartSVG(series, dm.get, series.length - 1, dm.label)}</div>
        ` : `<div class="empty" style="padding:22px 10px">
               <div>Not enough logged yet</div>
               <div class="sub">Two days of ${esc(dm.label.toLowerCase())} and a trend appears.</div>
             </div>`}
      </div>` : ''}`;

  $('#dayBack').onclick = () => { dailyOffset += 1; renderDaily(app); window.scrollTo(0, 0); };
  $('#dayFwd').onclick = () => { if (dailyOffset > 0) { dailyOffset -= 1; renderDaily(app); window.scrollTo(0, 0); } };

  // Writing anything creates the day's record lazily, so simply looking at a
  // date never leaves an empty entry behind.
  const edit = (mutate) => {
    mutate(dailyUpsert(key));
    save();
    $('#overview').innerHTML = overviewHTML(dailyFor(key), ts) + stripHTML();
  };

  // Delegated, so it survives the innerHTML swap above rather than needing
  // rebinding after every keystroke.
  $('#overview').onclick = (e) => {
    const bar = e.target.closest('[data-off]');
    if (!bar) return;
    dailyOffset = +bar.dataset.off;
    renderDaily(app);
    window.scrollTo(0, 0);
  };

  // Number fields and notes write without re-rendering, so typing keeps focus;
  // only the readiness card above repaints.
  app.querySelectorAll('[data-num]').forEach((el) => {
    el.oninput = () => edit((d) => { d[el.dataset.num] = el.value; });
  });
  $('#dayNotes').oninput = () => edit((d) => { d.notes = $('#dayNotes').value; });

  app.querySelectorAll('[data-rate]').forEach((el) => {
    el.onclick = () => {
      const field = el.dataset.rate;
      const value = +el.dataset.v;
      edit((d) => { if (d[field] === value) delete d[field]; else d[field] = value; });
      const now = dailyFor(key)[field];
      el.parentElement.querySelectorAll('.rate-pill').forEach((p) => {
        p.classList.toggle('on', +p.dataset.v === now);
      });
    };
  });

  app.querySelectorAll('[data-dmetric]').forEach((el) => {
    el.onclick = () => { dailyMetric = el.dataset.dmetric; renderDaily(app); };
  });
}

function ratingHTML(field, day) {
  const meta = RATINGS[field];
  return `
    <div style="margin-bottom:14px">
      <div class="row between" style="margin-bottom:7px">
        <span class="badge">${meta.label}</span>
        <span class="rate-ends">${esc(meta.low)} → ${esc(meta.high)}</span>
      </div>
      <div class="rate-row">
        ${[1, 2, 3, 4, 5].map((n) => `
          <button class="rate-pill ${day[field] === n ? 'on' : ''}" data-rate="${field}" data-v="${n}">${n}</button>`).join('')}
      </div>
    </div>`;
}

/* ============================================================
   History
   ============================================================ */
let historyTab = 'log';   // 'log' | 'records'

function renderHistory(app) {
  $('#title').textContent = 'History';

  if (!state.history.length) {
    app.innerHTML = `<div class="empty"><div class="big">◷</div><div>No workouts logged yet</div>
      <div class="sub">Finished workouts, records and progress charts show up here.</div></div>`;
    return;
  }

  const seg = `
    <div class="seg">
      <button data-tab="log" class="${historyTab === 'log' ? 'on' : ''}">Workouts</button>
      <button data-tab="records" class="${historyTab === 'records' ? 'on' : ''}">Records</button>
    </div>`;

  app.innerHTML = seg + (historyTab === 'log' ? logHTML() : recordsHTML());

  app.querySelectorAll('[data-tab]').forEach((el) => {
    el.onclick = () => { historyTab = el.dataset.tab; chartSel = null; renderHistory(app); window.scrollTo(0, 0); };
  });
  app.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => go('historyDetail', el.dataset.open);
  });
  app.querySelectorAll('[data-ex]').forEach((el) => {
    el.onclick = () => openExercise(el.dataset.ex, { name: 'history', arg: null });
  });
}

function logHTML() {
  const week = state.history.filter((s) => (s.finishedAt || s.startedAt) > Date.now() - 7 * 86400000);
  const totalVolume = state.history.reduce((t, s) => t + volume(s), 0);
  return `
    <div class="card">
      <div class="stat-grid">
        <div class="stat"><div class="v">${week.length}</div><div class="k">this week</div></div>
        <div class="stat"><div class="v">${state.history.length}</div><div class="k">all time</div></div>
        <div class="stat"><div class="v">${Math.round(totalVolume / 1000).toLocaleString()}k</div><div class="k">${unit()} lifted</div></div>
      </div>
    </div>
    ${state.history.map((s) => {
      const prev = previousSessionOf(s);
      const v = volume(s);
      return `
      <div class="card tappable" data-open="${s.id}">
        <div class="row between">
          <div class="grow">
            <div class="title truncate">${esc(s.programName || 'Workout')}
              ${s.prs && s.prs.length ? `<span class="pb-flag">${s.prs.length} PB</span>` : ''}</div>
            <div class="sub">${s.planLabel ? esc(s.planLabel) + ' · ' : ''}${fmtDate(s.finishedAt || s.startedAt)} · ${doneSets(s)} sets · ${Math.round(v).toLocaleString()} ${unit()}
              ${prev ? ' · ' + deltaHTML(v, volume(prev), ' ' + unit()) : ''}</div>
          </div>
          <div class="sub">${s.finishedAt ? fmtDuration(s.finishedAt - s.startedAt) : ''} ›</div>
        </div>
      </div>`;
    }).join('')}`;
}

function recordsHTML() {
  // Every exercise that appears anywhere in history, most recently trained first.
  const ids = [];
  state.history.forEach((s) => s.entries.forEach((e) => {
    if (!ids.includes(e.exerciseId)) ids.push(e.exerciseId);
  }));

  return `
    <h2 class="section">Personal bests</h2>
    ${ids.map((id) => {
      const pb = personalBests(id);
      if (!pb) return '';
      const bw = isBodyweight(pb);
      return `
      <div class="card tappable" data-ex="${id}">
        <div class="row">
          <div class="grow">
            <div class="title truncate">${esc(exerciseById(id).name)}</div>
            <div class="sub">${bw
              ? `Best ${pb.reps.bestReps} reps`
              : `Best ${fmtN(pb.weight.weight)} ${unit()} × ${pb.weight.reps} · 1RM ~${fmtN(pb.e1rm.e1rm)} ${unit()}`}
              · ${pb.series.length} session${pb.series.length === 1 ? '' : 's'}</div>
          </div>
          ${sparkline(pb.series, bw ? METRICS.reps.get : METRICS.e1rm.get)}
          <div class="sub" style="margin:0">›</div>
        </div>
      </div>`;
    }).join('')}`;
}

/* ---------- one exercise: records + interactive chart ---------- */
function renderExercise(app, exerciseId) {
  const ex = exerciseById(exerciseId);
  const pb = personalBests(exerciseId);
  $('#title').textContent = ex.name;
  if (!pb) return go('history');

  const series = pb.series;
  const bw = isBodyweight(pb);
  const keys = bw ? ['reps', 'totalReps'] : ['weight', 'e1rm', 'volume'];
  if (!keys.includes(chartMetric)) chartMetric = keys[0];
  const sel = chartSel == null ? series.length - 1 : Math.min(chartSel, series.length - 1);
  const point = series[sel];
  const m = METRICS[chartMetric];
  const prevPoint = sel > 0 ? series[sel - 1] : null;

  app.innerHTML = `
    <div class="card">
      <h2 class="section" style="margin-top:0">Personal bests</h2>
      <div class="stat-grid">
        ${bw ? `
          <div class="stat">
            <div class="v">${pb.reps.bestReps}</div>
            <div class="k">most reps</div>
            <div class="when">${esc(fmtDate(pb.reps.date))}</div>
          </div>
          <div class="stat">
            <div class="v">${Math.max(...series.map((p) => p.totalReps))}</div>
            <div class="k">best session</div>
            <div class="when">reps total</div>
          </div>
        ` : `
          <div class="stat">
            <div class="v">${fmtN(pb.weight.weight)}</div>
            <div class="k">heaviest (×${pb.weight.reps})</div>
            <div class="when">${esc(fmtDate(pb.weight.date))}</div>
          </div>
          <div class="stat">
            <div class="v">${fmtN(pb.e1rm.e1rm)}</div>
            <div class="k">est. 1RM</div>
            <div class="when">${esc(fmtDate(pb.e1rm.date))}</div>
          </div>
        `}
        <div class="stat">
          <div class="v">${bw ? series.length : Math.round(pb.volume.volume).toLocaleString()}</div>
          <div class="k">${bw ? 'sessions' : 'best volume'}</div>
          <div class="when">${bw ? '' : esc(fmtDate(pb.volume.date))}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="seg">
        ${keys.map((k) => `
          <button data-metric="${k}" class="${chartMetric === k ? 'on' : ''}">${METRICS[k].label}</button>`).join('')}
      </div>
      ${series.length > 1 ? `
        <div class="chart-read">
          <div>
            <div class="v">${fmtN(m.get(point))} <span style="font-size:12px;color:var(--muted)">${esc(m.suffix().trim())}</span></div>
            <div class="sub" style="margin:0">${esc(m.detail(point))}</div>
          </div>
          <div class="d">${esc(fmtDate(point.date))}<br>
            ${prevPoint ? 'vs prev ' + deltaHTML(m.get(point), m.get(prevPoint)) : 'first session'}</div>
        </div>
        <div class="chart-wrap">${chartSVG(series, m.get, sel, m.label)}</div>
        <div class="sub" style="text-align:center;margin-top:8px">Tap a point for that session</div>
      ` : `<div class="empty" style="padding:26px 10px">
             <div>Only one session logged</div>
             <div class="sub">Train this again to see the trend.</div>
           </div>`}
    </div>

    <h2 class="section">Session by session</h2>
    ${[...series].reverse().map((p, i, arr) => {
      const older = arr[i + 1];
      return `
      <div class="card tappable" data-open="${p.sessionId}">
        <div class="row between">
          <div class="grow">
            <div class="title">${bw ? `${p.bestReps} reps` : `${fmtN(p.weight)} ${unit()} × ${p.reps}`}</div>
            <div class="sub">${esc(fmtDate(p.date))} · ${p.setCount} sets · ${bw
              ? `${p.totalReps} reps total`
              : `${Math.round(p.volume).toLocaleString()} ${unit()} · 1RM ~${fmtN(p.e1rm)}`}</div>
          </div>
          <div>${older
            ? deltaHTML(bw ? p.bestReps : p.e1rm, bw ? older.bestReps : older.e1rm)
            : '<span class="delta flat">—</span>'}</div>
        </div>
      </div>`;
    }).join('')}`;

  app.querySelectorAll('[data-metric]').forEach((el) => {
    el.onclick = () => { chartMetric = el.dataset.metric; renderExercise(app, exerciseId); };
  });
  app.querySelectorAll('[data-pt]').forEach((el) => {
    el.onclick = () => { chartSel = +el.dataset.pt; renderExercise(app, exerciseId); };
  });
  app.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => go('historyDetail', el.dataset.open);
  });
}

/* Celebration after a record-breaking session. */
function showPRs(session) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h3 class="grad-text" style="font-size:20px">${session.prs.length} personal best${session.prs.length === 1 ? '' : 's'}</h3>
      ${session.prs.map((pr) => `
        <div class="row between" style="padding:9px 0;border-top:1px solid var(--line)">
          <div class="grow">
            <div class="title truncate" style="font-size:15px">${esc(exerciseById(pr.exerciseId).name)}</div>
            <div class="sub">${PR_LABEL[pr.kind]}${pr.prev ? ' · was ' + fmtN(pr.prev) + METRICS[pr.kind].suffix() : ' · first record'}</div>
          </div>
          <div style="color:var(--accent-soft);font-weight:700">${prText(pr)}</div>
        </div>`).join('')}
      <div class="modal-actions"><button class="btn primary" id="ok">Nice</button></div>
    </div>`;
  $('#modalRoot').appendChild(back);
  $('#ok', back).onclick = () => back.remove();
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}

function renderHistoryDetail(app, id) {
  const s = state.history.find((x) => x.id === id);
  if (!s) return go('history');
  $('#title').textContent = s.programName || 'Workout';

  const prev = previousSessionOf(s);

  app.innerHTML = `
    <div class="card">
      <div class="title">${fmtDate(s.finishedAt || s.startedAt)}</div>
      <div class="sub">${s.planLabel ? esc(s.planLabel) + ' · ' : ''}${new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        · ${s.finishedAt ? fmtDuration(s.finishedAt - s.startedAt) : ''}</div>
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat"><div class="v">${doneSets(s)}</div><div class="k">sets</div></div>
        <div class="stat"><div class="v">${Math.round(volume(s)).toLocaleString()}</div><div class="k">${unit()} volume</div></div>
        <div class="stat"><div class="v">${s.prs ? s.prs.length : 0}</div><div class="k">records</div></div>
      </div>
    </div>

    ${s.prs && s.prs.length ? `
      <h2 class="section">Personal bests set</h2>
      <div class="card" style="padding:2px 12px">
        ${s.prs.map((pr) => `
          <div class="row between" style="padding:10px 0;border-top:1px solid var(--line)">
            <div class="grow">
              <div class="title truncate" style="font-size:15px">${esc(exerciseById(pr.exerciseId).name)}</div>
              <div class="sub">${PR_LABEL[pr.kind]}${pr.prev ? ' · was ' + fmtN(pr.prev) : ''}</div>
            </div>
            <div class="pb-flag">${prText(pr)}</div>
          </div>`).join('')}
      </div>` : ''}

    ${prev ? `
      <h2 class="section">Compared with ${esc(fmtDate(prev.finishedAt || prev.startedAt).toLowerCase())}</h2>
      <div class="card" style="padding:0 0 6px">
        <div class="cmp-row" style="border-top:0;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.6px">
          <div>Exercise</div><div>Top set</div><div>Volume</div>
        </div>
        ${s.entries.map((e) => {
          const now = entryStats(e);
          const was = prev.entries.find((x) => x.exerciseId === e.exerciseId);
          const then = was ? entryStats(was) : null;
          return `
          <div class="cmp-row">
            <div class="truncate">${esc(exerciseById(e.exerciseId).name)}</div>
            <div style="text-align:right">
              <div class="now">${fmtN(num(now.top.weight))} × ${num(now.top.reps)}</div>
              <div class="then">${then ? 'was ' + fmtN(num(then.top.weight)) + ' × ' + num(then.top.reps) : 'new'}</div>
            </div>
            <div style="text-align:right;min-width:64px">
              <div class="now">${Math.round(now.volume).toLocaleString()}</div>
              <div class="then">${then ? deltaHTML(now.volume, then.volume) : 'new'}</div>
            </div>
          </div>`;
        }).join('')}
        <div class="cmp-row" style="font-weight:700">
          <div>Total</div>
          <div style="text-align:right">${doneSets(s)} sets</div>
          <div style="text-align:right;min-width:64px">
            <div class="now">${Math.round(volume(s)).toLocaleString()}</div>
            <div class="then">${deltaHTML(volume(s), volume(prev))}</div>
          </div>
        </div>
      </div>` : ''}

    <h2 class="section">Sets logged</h2>
    ${s.entries.map((e) => `
      <div class="card ex-card">
        <div class="ex-head">
          <div class="grow"><div class="title truncate">${esc(exerciseById(e.exerciseId).name)}</div></div>
          <button class="btn sm ghost" data-ex="${e.exerciseId}">${TREND_ICON} Progress</button>
        </div>
        ${e.sets.map((set, i) => `
          <div class="set-row" style="grid-template-columns:30px 1fr">
            <div class="setno">${i + 1}</div>
            <div style="font-variant-numeric:tabular-nums">${esc(set.weight || '—')} ${unit()} × ${esc(set.reps || '—')}</div>
          </div>`).join('')}
      </div>`).join('')}
    <button class="btn danger block" id="delSession" style="margin-top:16px">Delete workout</button>`;

  app.querySelectorAll('[data-ex]').forEach((el) => {
    el.onclick = () => openExercise(el.dataset.ex, { name: 'historyDetail', arg: s.id });
  });

  $('#delSession').onclick = () => {
    confirmModal('Delete this workout?', 'This cannot be undone.', () => {
      state.history = state.history.filter((x) => x.id !== s.id);
      save();
      go('history');
    });
  };
}

/* ============================================================
   Modals
   ============================================================ */
function confirmModal(title, body, onOk, okLabel) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      <div class="sub">${esc(body || '')}</div>
      <div class="modal-actions">
        <button class="btn" id="no">${onOk ? 'Cancel' : 'OK'}</button>
        ${onOk ? `<button class="btn primary" id="yes">${esc(okLabel || 'Confirm')}</button>` : ''}
      </div>
    </div>`;
  $('#modalRoot').appendChild(back);
  $('#no', back).onclick = () => back.remove();
  if (onOk) $('#yes', back).onclick = () => { back.remove(); onOk(); };
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}

function promptModal(title, label, value, onOk) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      <label class="field"><span>${esc(label)}</span>
        <input type="text" id="val" value="${esc(value)}" autocomplete="off"></label>
      <div class="modal-actions">
        <button class="btn" id="no">Cancel</button>
        <button class="btn primary" id="yes">Save</button>
      </div>
    </div>`;
  $('#modalRoot').appendChild(back);
  const input = $('#val', back);
  input.focus();
  input.onkeydown = (e) => { if (e.key === 'Enter') $('#yes', back).click(); };
  $('#no', back).onclick = () => back.remove();
  $('#yes', back).onclick = () => { const v = input.value; back.remove(); onOk(v); };
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}

function openSettings() {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal">
      <h3>Settings</h3>
      <label class="field"><span>Weight unit</span>
        <select id="unit">
          <option value="kg" ${unit() === 'kg' ? 'selected' : ''}>Kilograms (kg)</option>
          <option value="lb" ${unit() === 'lb' ? 'selected' : ''}>Pounds (lb)</option>
        </select></label>
      <label class="field"><span>Default rest between sets (seconds)</span>
        <input type="number" id="rest" min="10" max="600" step="5" value="${state.settings.rest}"></label>
      <label class="field"><span>Alarm sound</span>
        <select id="sound">
          <option value="1" ${state.settings.sound ? 'selected' : ''}>On</option>
          <option value="0" ${!state.settings.sound ? 'selected' : ''}>Off</option>
        </select></label>
      <button class="btn block sm" id="export" style="margin-bottom:8px">Export data (JSON)</button>
      <button class="btn block sm danger" id="wipe" style="margin-bottom:20px">Erase all data</button>
      <div class="sub" style="text-align:center;margin-bottom:8px">Signed in as ${esc(session ? session.user.email : '')}</div>
      <button class="btn block sm ghost" id="signOut">Sign out</button>
      <div class="modal-actions">
        <button class="btn primary" id="close">Done</button>
      </div>
    </div>`;
  $('#modalRoot').appendChild(back);

  $('#unit', back).onchange = (e) => { state.settings.unit = e.target.value; save(); render(); };
  $('#rest', back).onchange = (e) => {
    state.settings.rest = Math.min(600, Math.max(10, num(e.target.value) || 90));
    e.target.value = state.settings.rest;
    save();
    if (!timer.running) timer.reset(false);
  };
  $('#sound', back).onchange = (e) => { state.settings.sound = e.target.value === '1'; save(); };
  $('#export', back).onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'evolv-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#wipe', back).onclick = () => {
    confirmModal('Erase everything?', 'Programs, workouts and history will be deleted.', () => {
      state = defaultState();
      save();
      back.remove();
      go('home');
    }, 'Erase');
  };
  $('#signOut', back).onclick = () => {
    confirmModal('Sign out?', 'You can sign back in any time with the same email.', () => {
      back.remove();
      signOut();
    }, 'Sign out');
  };
  $('#close', back).onclick = () => back.remove();
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}

/* ============================================================
   Wiring
   ============================================================ */
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => go(t.dataset.view);
});
$('#backBtn').onclick = () => {
  if (view.name === 'exercise') return go(exerciseReturn.name, exerciseReturn.arg);
  return go(view.name === 'historyDetail' ? 'history' : 'home');
};
$('#settingsBtn').onclick = openSettings;

$('#timerToggle').onclick = () => (timer.running ? timer.pause() : timer.start());
$('#timerReset').onclick = () => timer.reset(true);
document.querySelectorAll('[data-adjust]').forEach((b) => {
  b.onclick = () => timer.adjust(+b.dataset.adjust);
});

// Refresh the elapsed-time readout during a workout.
setInterval(() => {
  const el = $('#elapsed');
  if (el && state.active) el.textContent = fmtDuration(Date.now() - state.active.startedAt);
}, 15000);

timer.remaining = state.settings.rest;

authReady.then(() => {
  window.onAuthChange = (hadSessionBefore) => {
    if (session && !hadSessionBefore) {
      loadForUser(session.user.id);
    } else if (!session) {
      state = defaultState();
      render();
    }
    // Any other transition (e.g. a background token refresh) leaves
    // already-loaded data alone.
  };
  if (session) {
    loadForUser(session.user.id);
  } else {
    render();
  }
});
