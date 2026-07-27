/* Everything session-related: the Supabase client, tracking who (if anyone)
   is signed in, the sign-in screen, and signing out. app.js reads the
   `session`/`supabaseClient`/`authReady` globals defined here directly —
   same plain-global-script pattern already used for EXERCISE_LIBRARY in
   exercises.js. */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let session = null;

/* ---------- sign-in screen ---------- */
let signInStatus = { sending: false, sent: false, error: null, email: '' };

// A failed magic-link redirect (expired/already-used link, disallowed
// redirect URL, etc.) comes back as `#error=...&error_description=...`
// rather than a session — surface it instead of silently reverting to a
// blank sign-in form with no explanation.
(function surfaceRedirectError() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const description = params.get('error_description');
  if (description) {
    signInStatus.error = description.replace(/\+/g, ' ');
    history.replaceState(null, '', location.pathname + location.search);
  }
})();

// Resolves once we've checked for an existing (locally persisted) session,
// so app.js's boot sequence knows whether to show the app or the sign-in
// screen on first paint, instead of guessing.
const authReady = supabaseClient.auth.getSession().then(({ data }) => {
  session = data.session;
});

supabaseClient.auth.onAuthStateChange((_event, newSession) => {
  const hadSession = !!session;
  session = newSession;

  // Magic-link returns land back here with tokens in the URL hash; drop
  // them once Supabase has consumed them so the URL stays clean.
  if (location.hash.includes('access_token')) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  if (window.onAuthChange) window.onAuthChange(hadSession);
});

async function signOut() {
  await supabaseClient.auth.signOut();
}

function renderSignIn(app) {
  const s = signInStatus;
  app.innerHTML = `
    <div style="max-width:360px;margin:15vh auto 0;padding:0 20px;text-align:center">
      ${evolvLockup()}
      <div class="sub" style="margin:22px 0 24px">Sign in to sync your programs and history.</div>
      ${s.sent ? `
        <div class="card" style="text-align:left">
          <div class="title" style="font-size:15px">Check your email</div>
          <div class="sub">We sent a sign-in link to ${esc(s.email)}. Open it on this device to continue.</div>
          <button class="btn sm ghost block" id="resend" style="margin-top:12px">Use a different email</button>
        </div>
      ` : `
        <label class="field" style="text-align:left">
          <span>Email</span>
          <input type="email" id="signInEmail" placeholder="you@example.com" autocomplete="email" value="${esc(s.email)}">
        </label>
        ${s.error ? `<div class="sub" style="color:var(--danger);text-align:left;margin:-8px 0 14px">${esc(s.error)}</div>` : ''}
        <button class="btn primary block" id="sendLink" ${s.sending ? 'disabled' : ''}>${s.sending ? 'Sending…' : 'Send magic link'}</button>
      `}
    </div>`;

  if (s.sent) {
    $('#resend', app).onclick = () => {
      signInStatus = { sending: false, sent: false, error: null, email: s.email };
      renderSignIn(app);
    };
    return;
  }

  const input = $('#signInEmail', app);
  input.focus();
  const submit = async () => {
    const email = input.value.trim();
    if (!email) return;
    signInStatus = { sending: true, sent: false, error: null, email };
    renderSignIn(app);
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    signInStatus = error
      ? { sending: false, sent: false, error: error.message, email }
      : { sending: false, sent: true, error: null, email };
    renderSignIn(app);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  $('#sendLink', app).onclick = submit;
}
