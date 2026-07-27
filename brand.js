/* The Evolv mark — the angular "E" from the logo, as inline SVG.

   It lives in its own file because both auth.js (the sign-in screen) and
   app.js (top bar, empty states) render it. It defines one global function
   and reads nothing at load time, so unlike the rest of the script chain in
   index.html its position in that order doesn't matter — it only has to
   exist before the first render.

   Colours are NOT baked in here. The gradient stops carry `g1`/`g2`/`g3`
   classes that styles.css points at --brand-1/2/3, so the mark tracks the
   palette like everything else. The one place the ramp is duplicated as
   literal hex is the favicon data URI in index.html and the PNGs in icons/,
   which both have to render outside the stylesheet's reach — change those by
   hand if the brand colours ever move.

   Geometry, on a 112x100 grid: a left-pointing chevron spine plus three
   slabs. The spine's inner edge points left at mid-height, which is what
   tapers the two counters to a point where they meet it. The top and middle
   slabs are cut back on the right, the bottom slab flares out — that
   outward splay is what gives the mark its forward lean. */

// Gradient ids are document-global and the mark is often on screen more than
// once (top bar + empty state), so each instance gets its own.
let markSeq = 0;

function evolvMark(height = 24) {
  const id = `evolvGrad${++markSeq}`;
  const width = Math.round(height * 1.12);
  return `
  <svg class="evolv-mark" width="${width}" height="${height}" viewBox="0 0 112 100"
       fill="url(#${id})" role="img" aria-label="Evolv">
    <defs>
      <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="102" y2="100">
        <stop class="g1" offset="0"/>
        <stop class="g2" offset=".5"/>
        <stop class="g3" offset="1"/>
      </linearGradient>
    </defs>
    <path d="M22 0 L38 0 L14 48 L38 100 L22 100 L0 48 Z"/>
    <path d="M30 0 L108 0 L97 21 L19 21 Z"/>
    <path d="M16 40 L86 40 L78 56 L8 56 Z"/>
    <path d="M25 75 L100 75 L112 100 L37 100 Z"/>
  </svg>`;
}

/* The full logo lockup: mark, wordmark, tagline. Only used where there's room
   to breathe (the sign-in screen) — everywhere else uses the bare mark. */
function evolvLockup() {
  return `
  <div class="lockup">
    ${evolvMark(64)}
    <div class="wordmark">Evolv</div>
    <div class="tagline"><span>Train.</span> <span>Track.</span> <span>Evolve.</span></div>
  </div>`;
}
