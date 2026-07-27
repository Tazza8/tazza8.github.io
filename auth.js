/* Everything session-related: the Supabase client, tracking who (if anyone)
   is signed in, the sign-in screen, and signing out. app.js reads the
   `session`/`supabaseClient`/`authReady` globals defined here directly —
   same plain-global-script pattern already used for EXERCISE_LIBRARY in
   exercises.js. */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let session = null;

/* ---------- sign-in screen ----------
   The same request sends both a link and a 6-digit code, and either one
   signs you in. The code isn't a convenience — on iOS it's the only thing
   that works once the app is on the home screen. A standalone web app there
   gets its own storage partition, and a magic link can only ever open in
   Safari, so following the link writes the session into Safari's storage
   where the installed app can't see it; it just sits on the sign-in screen
   forever. Typing the code into the app keeps the whole exchange inside the
   app's own partition. iOS gives us no way to hand a session across, and no
   way to make the link open in the installed app, so don't "simplify" this
   back down to a link-only flow.

   Note the code only reaches the user if the Supabase project's Magic Link
   email template renders {{ .Token }} — the code is always minted server
   side, but the default template shows the link alone. Its length is a
   project setting too (6–10 digits), which is why nothing here assumes one. */
let signInStatus = { sending: false, sent: false, error: null, email: '', code: '', verifying: false };

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
          <div class="sub">We sent a code and a sign-in link to ${esc(s.email)}.</div>
          <label class="field" style="margin:16px 0 12px">
            <span>Sign-in code</span>
            <input type="text" id="otp" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="10" value="${esc(s.code)}"
                   style="text-align:center;letter-spacing:.4em;font-size:22px;font-variant-numeric:tabular-nums">
          </label>
          ${s.error ? `<div class="sub" style="color:var(--danger);margin:-4px 0 12px">${esc(s.error)}</div>` : ''}
          <button class="btn primary block" id="verify" ${s.verifying ? 'disabled' : ''}>${s.verifying ? 'Checking…' : 'Sign in'}</button>
          <div class="sub" style="margin-top:12px">Tapping the link instead opens Safari and signs you in there — if you added Evolv to your home screen, use the code so you're signed in here.</div>
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
    const codeInput = $('#otp', app);
    codeInput.focus();
    const verify = async () => {
      // The code's length is a Supabase project setting (6–10 digits), so
      // don't validate it here — an assumed length just locks the app to
      // whatever the dashboard happened to say at the time. Let the server
      // be the judge; a wrong length comes back as an invalid token.
      const token = codeInput.value.trim();
      if (!token) return;
      signInStatus = { ...s, code: token, verifying: true, error: null };
      renderSignIn(app);
      const { error } = await supabaseClient.auth.verifyOtp({ email: s.email, token, type: 'email' });
      // On success onAuthStateChange fires and re-renders the whole app, so
      // there's nothing to do here but surface a bad/expired code.
      if (error) {
        signInStatus = { ...s, code: token, verifying: false, error: error.message };
        renderSignIn(app);
      }
    };
    codeInput.onkeydown = (e) => { if (e.key === 'Enter') verify(); };
    $('#verify', app).onclick = verify;
    $('#resend', app).onclick = () => {
      signInStatus = { sending: false, sent: false, error: null, email: s.email, code: '', verifying: false };
      renderSignIn(app);
    };
    return;
  }

  const input = $('#signInEmail', app);
  input.focus();
  const submit = async () => {
    const email = input.value.trim();
    if (!email) return;
    signInStatus = { sending: true, sent: false, error: null, email, code: '', verifying: false };
    renderSignIn(app);
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    signInStatus = error
      ? { sending: false, sent: false, error: error.message, email, code: '', verifying: false }
      : { sending: false, sent: true, error: null, email, code: '', verifying: false };
    renderSignIn(app);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  $('#sendLink', app).onclick = submit;
}
