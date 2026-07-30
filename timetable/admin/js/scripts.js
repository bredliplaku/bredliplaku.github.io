/* ==========================================================================
   Timetable Panel — editor for the department Class Timetable (/timetable/).

   Reads and writes the `timetable_rows` table in the shared Supabase project,
   behind the same Google sign-in and the same `admins` allowlist as the
   teaching panel. The whole configuration is a few dozen rows, so this loads
   all of them once and each tab saves its own slice.

   Layout differs from the teaching panel on purpose: that one is
   course-per-sidebar-item, this one edits a single global configuration, so
   the four tabs sit directly under the top bar with no sidebar.
   ========================================================================== */
(function () {
  'use strict';

  const SUPABASE_URL = window.TEACHING_CONFIG.supabaseUrl;
  const SUPABASE_ANON_KEY = window.TEACHING_CONFIG.supabaseAnonKey;
  const { createClient } = supabase;

  // Synchronously drop only genuinely unusable session blobs BEFORE createClient
  // (corrupt JSON, or missing the refresh_token needed to revive the session). An
  // expired access_token alone is normal — that's what the refresh_token is for —
  // so it must NOT count as a reason to delete the session, or the admin gets
  // signed out on every visit once the short-lived access_token expires.
  (function () {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          try {
            const d = JSON.parse(localStorage.getItem(k));
            if (!d?.access_token || !d?.refresh_token) localStorage.removeItem(k);
          } catch { localStorage.removeItem(k); }
        }
      }
    } catch { }
  })();

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
  });

  const FA_SEARCH_URL = 'https://fontawesome.com/search?ic=free-collection';

  const SECTIONS = [
    { id: 'semester', label: 'Semester', icon: 'fa-solid fa-calendar-days' },
    { id: 'header', label: 'Header', icon: 'fa-solid fa-heading' },
    { id: 'categories', label: 'Categories', icon: 'fa-solid fa-layer-group' },
    { id: 'entries', label: 'Entries', icon: 'fa-solid fa-list-ul' },
  ];

  const SETTING_KEYS = ['semester_start', 'semester_end', 'holiday_start', 'holiday_weeks'];

  // All timetable_rows, keyed by row_uid. Loaded once at sign-in and kept in
  // step with every successful save, so a tab switch never needs a round trip.
  let ROWS = {};

  const S = { admin: null, section: 'semester', category: null };

  let _sessionHandled = false;
  let _confirmResolve = null;
  let _tt = null;


  /* === UNSAVED-CHANGES TRACKING ==========================================
     True once something is staged in the open tab but not yet in the DB:
     typing, adding, deleting, or reordering. Cleared when a tab (re)renders
     or a save succeeds.
     ====================================================================== */

  let _dirty = false;
  function markDirty() { _dirty = true; }
  function clearDirty() { _dirty = false; }

  // Delegated on document so it survives every re-render of the section body.
  // Programmatic value/innerHTML changes don't fire these, so a fresh render
  // never trips the flag on its own.
  document.addEventListener('input', e => { if (e.target.closest?.('#section-body')) markDirty(); });
  document.addEventListener('change', e => { if (e.target.closest?.('#section-body')) markDirty(); });

  // Leaving the page entirely can only use the browser's native prompt.
  window.addEventListener('beforeunload', e => {
    if (_dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  async function confirmLeaveIfDirty() {
    if (!_dirty) return true;
    const answer = await confirmDialog(
      'You have unsaved changes in this tab. Leave without saving?',
      { title: 'Unsaved Changes', okLabel: 'Discard', danger: true, okIcon: 'fa-trash-can' });
    if (answer) clearDirty();
    return answer;
  }


  /* === AUTH ===============================================================
     Lifted from the teaching panel — same allowlist, same Google client, so
     signing into one signs you into the other.
     ====================================================================== */

  // Whether a session blob with both tokens is in localStorage right now. Tells
  // "definitely logged out" apart from "getSession() returned empty because its
  // internal token-refresh race hasn't resolved" — the latter must not flash the
  // login screen, since onAuthStateChange corrects it a moment later.
  function hasStoredSession() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
          const d = JSON.parse(localStorage.getItem(k));
          if (d?.access_token && d?.refresh_token) return true;
        }
      }
    } catch { }
    return false;
  }

  // Sizes the ambiguous-session fallback from the browser's own reported
  // connection quality rather than a blind guess: a token refresh is one round
  // trip, so the wait only needs to be a small multiple of the real RTT.
  function estimateAuthTimeoutMs() {
    if (navigator.onLine === false) return 0;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if (typeof conn.rtt === 'number' && conn.rtt > 0) {
        return Math.min(6000, Math.max(1200, conn.rtt * 6));
      }
      const byType = { 'slow-2g': 6000, '2g': 5000, '3g': 3000, '4g': 1500 };
      if (conn.effectiveType && byType[conn.effectiveType] != null) return byType[conn.effectiveType];
    }
    return 3000;
  }

  // Race getSession() against a timeout so a slow refresh never leaves a blank
  // screen. A timeout only *shows* the login screen — it never deletes the
  // stored session, so a slow-but-valid session still logs in when it resolves.
  (async () => {
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      if (!_sessionHandled) { hideBootSpinner(); showScreen('login'); }
    }, estimateAuthTimeoutMs());

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session && !_sessionHandled) {
        clearTimeout(timeoutId);
        _sessionHandled = true;
        promoteToFullSkeleton();
        await handleSession(session);
      } else if (!session && !hasStoredSession() && !_sessionHandled && !didTimeout) {
        clearTimeout(timeoutId);
        hideBootSpinner();
        showScreen('login');
      }
      // else: empty result despite a stored session. Keep the neutral boot
      // spinner up and let onAuthStateChange decide, with the timeout as the
      // final fallback.
    } catch {
      if (!hasStoredSession() && !_sessionHandled) {
        clearTimeout(timeoutId);
        hideBootSpinner();
        showScreen('login');
      }
    }
  })();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') { _sessionHandled = false; hideBootSpinner(); showScreen('login'); return; }
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && !_sessionHandled) {
      _sessionHandled = true;
      promoteToFullSkeleton();
      await handleSession(session);
    }
  });

  async function signIn() {
    const btn = document.getElementById('signin-btn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px"></i>Signing in...';
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) { toast('Sign-in failed: ' + error.message, 'err'); btn.disabled = false; btn.innerHTML = orig; }
  }

  async function signOut() {
    _sessionHandled = false;
    // Stop One Tap silently re-selecting the same account the instant the login
    // screen reappears — without this, signing out becomes a re-login loop.
    try { google.accounts.id.disableAutoSelect(); } catch { }
    await sb.auth.signOut();
    window.history.replaceState(null, '', window.location.pathname);
  }

  /* --- Google One Tap ---------------------------------------------------
     Signs in with no redirect and no popup: GIS shows a browser-mediated
     (FedCM) prompt, and the resulting ID token is verified by Supabase.
     The button above stays as the fallback for when One Tap can't display.

     Nonce contract: Google gets the SHA-256 HASH of the nonce inside the ID
     token; Supabase gets the RAW nonce and checks the hash matches — proving
     the token was minted for this page load. */

  const GOOGLE_CLIENT_ID = window.TEACHING_CONFIG.googleClientId;
  let _oneTapNonce = null;
  let _oneTapInited = false;
  let _oneTapWanted = false;   // login screen showed before the GIS script loaded

  window._gsiOnLoad = () => { if (_oneTapWanted) showOneTap(); };

  async function initOneTap() {
    if (_oneTapInited) return true;
    if (!window.google?.accounts?.id || !window.crypto?.subtle) return false;

    const raw = crypto.getRandomValues(new Uint8Array(32));
    _oneTapNonce = btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_oneTapNonce));
    const hashedNonce = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onOneTapCredential,
      nonce: hashedNonce,
      context: 'signin',
      auto_select: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
    });
    _oneTapInited = true;
    return true;
  }

  async function showOneTap() {
    _oneTapWanted = false;
    if (!(await initOneTap())) { _oneTapWanted = true; return; }  // retried from _gsiOnLoad
    google.accounts.id.prompt();
  }

  function cancelOneTap() {
    if (_oneTapInited) { try { google.accounts.id.cancel(); } catch { } }
  }

  async function onOneTapCredential(resp) {
    const btn = document.getElementById('signin-btn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:8px"></i>Signing in...';
    const { error } = await sb.auth.signInWithIdToken({
      provider: 'google', token: resp.credential, nonce: _oneTapNonce,
    });
    if (error) { toast('Sign-in failed: ' + error.message, 'err'); btn.disabled = false; btn.innerHTML = orig; }
    // On success onAuthStateChange fires SIGNED_IN → handleSession().
  }

  /* --- Idle sign-out ----------------------------------------------------
     Guards against staying signed in on a shared machine. Only runs while
     the panel is actually on screen (started/stopped by showScreen). */

  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  let _idleTimer = null;
  let _idleWatchStarted = false;

  function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(async () => {
      toast('Signed out due to inactivity', 'err');
      await signOut();
    }, IDLE_TIMEOUT_MS);
  }

  function startIdleWatch() {
    resetIdleTimer();
    if (_idleWatchStarted) return;
    _idleWatchStarted = true;
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
      document.addEventListener(evt, resetIdleTimer, { passive: true }));
  }

  function stopIdleWatch() {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = null;
  }

  async function handleSession(session) {
    let admin;
    try {
      // Start the row fetch alongside the identity lookup: the two are
      // independent (both only need the token), so overlapping them saves a
      // full round trip on every sign-in.
      const rowsPromise = sb.from('timetable_rows').select('*').order('row_index');
      const result = await Promise.race([
        sb.from('admins').select('name,surname,email').single(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ]);
      admin = result.data;

      if (admin) {
        const { data, error } = await rowsPromise;
        if (error) throw error;
        ROWS = {};
        for (const r of (data || [])) ROWS[r.row_uid] = r;
      }
    } catch {
      // Supabase cold start or network blip. The auth session itself is fine,
      // so don't delete it — fall back to login and let a retry re-run this.
      _sessionHandled = false;
      hideLoading();
      showScreen('login');
      return;
    }

    hideLoading();

    if (!admin) {
      document.getElementById('error-msg').textContent =
        (session.user.email || 'Your account') + ' is not in the admin list.';
      showScreen('error');
      return;
    }

    S.admin = admin;
    document.getElementById('top-user').textContent = `${admin.name} ${admin.surname}`;
    // Strip the OAuth fragment so a refresh doesn't try to re-consume it.
    if (window.location.href.includes('#')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    showScreen('admin');
    renderTabs();
    selectSection(S.section);
  }


  /* === SCREENS ============================================================ */

  function hideBootSpinner() {
    const el = document.getElementById('boot-spinner');
    el.classList.add('hidden');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }

  function promoteToFullSkeleton() {
    hideBootSpinner();
    document.getElementById('app-loading').style.display = 'flex';
  }

  function hideLoading() {
    const el = document.getElementById('app-loading');
    el.classList.add('hidden');
    setTimeout(() => { el.style.display = 'none'; }, 400);
  }

  function showScreen(w) {
    hideBootSpinner();
    document.getElementById('login-screen').style.display = w === 'login' ? 'flex' : 'none';
    document.getElementById('error-screen').style.display = w === 'error' ? 'flex' : 'none';
    document.getElementById('admin-app').style.display = w === 'admin' ? 'flex' : 'none';
    if (w !== 'admin') hideLoading();
    if (w === 'admin') startIdleWatch(); else stopIdleWatch();
    if (w === 'login') showOneTap(); else cancelOneTap();
  }


  /* === ROW HELPERS ========================================================
     Every tab saves the same way: build the exact set of rows that tab owns,
     then replace what's in the database with it. Because a tab's rows are
     fully determined by its form, a diff-free replace is both simpler and
     immune to drifting out of sync — deletes are computed by comparing UIDs.
     ====================================================================== */

  function rowsOfType(...types) {
    return Object.values(ROWS)
      .filter(r => types.includes(r.type))
      .sort((a, b) => a.row_index - b.row_index);
  }

  function rowsInSection(section, type) {
    return Object.values(ROWS)
      .filter(r => r.section === section && r.type === type)
      .sort((a, b) => a.row_index - b.row_index);
  }

  const BLANK = { b: '', c: '', d: '', e: '', f: '', g: '', h: '', i: '', j: '' };

  // Replaces every row matching `owns` with `rows`, in one upsert + one delete.
  async function replaceRows(owns, rows) {
    const keep = new Set(rows.map(r => r.row_uid));
    const stale = Object.values(ROWS).filter(r => owns(r) && !keep.has(r.row_uid)).map(r => r.row_uid);

    if (rows.length) {
      const { error } = await sb.from('timetable_rows').upsert(rows, { onConflict: 'row_uid' });
      if (error) throw error;
    }
    if (stale.length) {
      const { error } = await sb.from('timetable_rows').delete().in('row_uid', stale);
      if (error) throw error;
    }

    // Mirror the write locally so a tab switch doesn't need to refetch.
    stale.forEach(uid => { delete ROWS[uid]; });
    rows.forEach(r => { ROWS[r.row_uid] = r; });
  }

  // Stable, readable primary keys. Author-supplied text is slugged because
  // row_uid is a text primary key that also ends up in the table editor.
  //
  // Slugging is lossy — "Year 1" and "Year-1" both become "year_1" — so it is
  // NEVER the sole discriminator for a repeatable row. Positional rows (chips,
  // buttons, entries) key off their index instead, and category names are
  // validated for slug-uniqueness in saveCategories() before being used here.
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  }
  function uid(...parts) { return parts.map(slug).join(':'); }

  // Primary key for an entry: category slug (unique by validation) + position.
  function entryUid(category, index) { return `e:${slug(category)}:${index}`; }

  async function withSaveButton(btn, fn) {
    if (!btn) return fn();
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Saving…';
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }


  /* === TABS =============================================================== */

  function renderTabs() {
    document.getElementById('section-tabs').innerHTML = SECTIONS.map((s, i, arr) => {
      // Pill ends on the outermost tabs so the strip reads as one control.
      const r = i === 0 ? 'border-radius:20px 8px 8px 20px'
        : i === arr.length - 1 ? 'border-radius:8px 20px 20px 8px' : '';
      return `<button class="section-tab${s.id === S.section ? ' active' : ''}" style="${r}" data-sec="${s.id}">
                <i class="${s.icon}" style="margin-right:5px;font-size:0.88em"></i>${s.label}
              </button>`;
    }).join('');

    document.querySelectorAll('#section-tabs .section-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.sec === S.section) return;
        if (!(await confirmLeaveIfDirty())) return;
        selectSection(btn.dataset.sec);
      });
    });
  }

  function selectSection(id) {
    S.section = id;
    document.querySelectorAll('#section-tabs .section-tab')
      .forEach(b => b.classList.toggle('active', b.dataset.sec === id));

    const body = document.getElementById('section-body');
    body.classList.remove('loaded');
    body.innerHTML = ({
      semester: renderSemester,
      header: renderHeader,
      categories: renderCategories,
      entries: renderEntries,
    })[id]();

    // Next frame so the entry animation actually plays on a fresh render.
    requestAnimationFrame(() => body.classList.add('loaded'));

    clearDirty();
    wireSection(id);
  }


  /* === TAB 1: SEMESTER ==================================================== */

  function settingValue(key) {
    return rowsOfType('setting').find(r => r.b === key)?.c || '';
  }

  function renderSemester() {
    const v = k => x(settingValue(k));
    return `
      <div class="section-topbar">
        <button class="btn-sm btn-save-section" id="section-save-btn"><i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Save</button>
      </div>
      <div class="settings-panel">
        <div class="settings-group">
          <div class="settings-head"><span style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-calendar-days"></i>Semester Dates</span></div>
          <div class="settings-body">
            <div class="sg-grid">
              <div class="form-group">
                <label class="form-label">Start Date</label>
                <input type="date" id="set_semester_start" value="${v('semester_start')}">
              </div>
              <div class="form-group">
                <label class="form-label">End Date</label>
                <input type="date" id="set_semester_end" value="${v('semester_end')}">
              </div>
              <div class="form-group">
                <label class="form-label">Break Start Date</label>
                <input type="date" id="set_holiday_start" value="${v('holiday_start')}">
              </div>
              <div class="form-group">
                <label class="form-label">Break Length (weeks)</label>
                <input type="number" id="set_holiday_weeks" min="0" max="8" step="1" value="${v('holiday_weeks') || '0'}">
              </div>
            </div>
            <div class="form-hint" style="margin-top:10px">
              During the break the week counter freezes on the last teaching week, and
              weeks after it are shifted back so week numbers keep matching the syllabus.
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-head"><span style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-eye"></i>Preview</span></div>
          <div class="settings-body">
            <div class="course-info" style="margin-bottom:12px">
              <span class="info-item"><i class="fa-regular fa-clock"></i> <span id="preview-week">—</span></span>
            </div>
            <div class="progress-bar"><div class="progress" id="preview-progress" style="width:0%"></div></div>
            <div class="form-hint" id="preview-note" style="margin-top:8px"></div>
          </div>
        </div>
      </div>`;
  }

  // Recomputes the preview from the form as it's typed, using the very same
  // functions the public page uses — so what's previewed can't drift from
  // what visitors actually see.
  function updateSemesterPreview() {
    const start = document.getElementById('set_semester_start').value;
    const end = document.getElementById('set_semester_end').value;
    const hStart = document.getElementById('set_holiday_start').value;
    const hWeeks = document.getElementById('set_holiday_weeks').value;

    const week = window.calculateSemesterWeek(start, end, hStart, hWeeks);
    const pct = window.semesterProgress(start, end);

    document.getElementById('preview-week').textContent = week ? `Week ${week}` : 'Semester dates not set';
    document.getElementById('preview-progress').style.width = `${pct}%`;

    const note = document.getElementById('preview-note');
    if (!start || !end) note.textContent = 'Set both dates to see the week counter.';
    else if (new Date(end) <= new Date(start)) note.textContent = '⚠ End date is not after the start date.';
    else note.textContent = `${Math.round(pct)}% of the semester elapsed.`;
  }

  async function saveSemester(btn) {
    const values = {
      semester_start: document.getElementById('set_semester_start').value,
      semester_end: document.getElementById('set_semester_end').value,
      holiday_start: document.getElementById('set_holiday_start').value,
      holiday_weeks: document.getElementById('set_holiday_weeks').value,
    };

    if (values.semester_start && values.semester_end &&
      new Date(values.semester_end) <= new Date(values.semester_start)) {
      toast('End date must be after the start date', 'err');
      return;
    }

    // Blank values are stored as empty rows rather than deleted, so the keys
    // stay visible in the table editor.
    const rows = SETTING_KEYS.map((key, i) => ({
      ...BLANK,
      row_uid: uid('settings', key),
      section: 'settings',
      row_index: i,
      type: 'setting',
      b: key,
      c: values[key] || '',
    }));

    await withSaveButton(btn, async () => {
      try {
        await replaceRows(r => r.type === 'setting', rows);
        clearDirty();
        toast('Semester saved', 'ok');
      } catch (err) {
        toast('Save failed: ' + err.message, 'err');
      }
    });
  }


  /* === TAB 2: HEADER (info chips + action buttons) ======================== */

  function renderHeader() {
    const info = rowsOfType('info_item');
    const buttons = rowsOfType('action_button');

    return `
      <div class="section-topbar">
        <button class="btn-sm btn-save-section" id="section-save-btn"><i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Save</button>
      </div>
      <div class="settings-panel">
        <div class="settings-group" style="margin-bottom:14px">
          <div class="settings-head">
            <span style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-circle-info"></i>Info Chips</span>
            <button class="btn-sm btn-secondary" type="button" id="add-info-btn"><i class="fa-solid fa-plus"></i></button>
          </div>
          <div class="settings-body" id="info-list">
            ${info.map(r => infoCardHtml(r.b, r.c)).join('') ||
      '<div class="form-hint" id="no-info-msg" style="padding:4px 0">No info chips yet.</div>'}
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-head">
            <span style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-link"></i>Action Buttons</span>
            <button class="btn-sm btn-secondary" type="button" id="add-action-btn"><i class="fa-solid fa-plus"></i></button>
          </div>
          <div class="settings-body" id="action-list">
            ${buttons.map(r => actionCardHtml(r.b, r.c, r.d, r.e)).join('') ||
      '<div class="form-hint" id="no-action-msg" style="padding:4px 0">No action buttons yet.</div>'}
          </div>
        </div>
      </div>`;
  }

  function infoCardHtml(icon = '', text = '') {
    return `<div class="dynamic-card" data-kind="info">
      <div class="dynamic-card-head">
        <span class="dynamic-card-label"><i class="fa-solid fa-grip-vertical drag-handle" style="margin-right:8px;opacity:0.5;cursor:grab"></i><span class="dcl-text">${x(text || 'New Chip')}</span></span>
        <button class="btn-red btn-sm" type="button" data-remove="1"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="dynamic-card-body sg-grid2">
        <div class="form-group">
          <label class="form-label">Icon</label>
          ${iconInputHtml('info_icon', icon)}
        </div>
        <div class="form-group">
          <label class="form-label">Text</label>
          <input type="text" name="info_text" value="${x(text)}" data-label-source="New Chip">
        </div>
      </div>
    </div>`;
  }

  function actionCardHtml(label = '', icon = '', url = '', cssClass = '') {
    return `<div class="dynamic-card" data-kind="action">
      <div class="dynamic-card-head">
        <span class="dynamic-card-label"><i class="fa-solid fa-grip-vertical drag-handle" style="margin-right:8px;opacity:0.5;cursor:grab"></i><span class="dcl-text">${x(label || 'New Button')}</span></span>
        <button class="btn-red btn-sm" type="button" data-remove="1"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="dynamic-card-body sg-grid2">
        <div class="form-group">
          <label class="form-label">Label</label>
          <input type="text" name="action_label" value="${x(label)}" data-label-source="New Button">
        </div>
        <div class="form-group">
          <label class="form-label">Icon</label>
          ${iconInputHtml('action_icon', icon)}
        </div>
        <div class="form-group">
          <label class="form-label">URL</label>
          <input type="text" name="action_url" value="${x(url)}" placeholder="https://…">
        </div>
        <div class="form-group">
          <label class="form-label">Style</label>
          <select name="action_class">
            <option value=""${cssClass === '' ? ' selected' : ''}>Primary</option>
            <option value="secondary-action"${cssClass === 'secondary-action' ? ' selected' : ''}>Secondary</option>
          </select>
        </div>
      </div>
    </div>`;
  }

  async function saveHeader(btn) {
    // A card the user added but never filled in is dropped silently — that's
    // just an abandoned "+" click. A *partly* filled one is a mistake worth
    // reporting rather than quietly discarding.
    const info = [...document.querySelectorAll('#info-list .dynamic-card')]
      .map(card => ({
        icon: fieldValue(card, 'info_icon'),
        text: fieldValue(card, 'info_text'),
      }))
      .filter(r => r.icon || r.text);

    const blankText = info.find(r => !r.text);
    if (blankText) { toast('Every info chip needs text', 'err'); return; }

    const actions = [...document.querySelectorAll('#action-list .dynamic-card')]
      .map(card => ({
        label: fieldValue(card, 'action_label'),
        icon: fieldValue(card, 'action_icon'),
        url: fieldValue(card, 'action_url'),
        cssClass: fieldValue(card, 'action_class'),
      }))
      .filter(r => r.label || r.icon || r.url);

    const incomplete = actions.find(r => !r.label || !r.url);
    if (incomplete) {
      toast(`"${incomplete.label || 'Untitled button'}" needs both a label and a URL`, 'err');
      return;
    }

    const rows = [
      ...info.map((r, i) => ({
        ...BLANK, row_uid: uid('settings', 'info', String(i)), section: 'settings',
        row_index: i, type: 'info_item', b: r.icon, c: r.text,
      })),
      ...actions.map((r, i) => ({
        ...BLANK, row_uid: uid('settings', 'action', String(i)), section: 'settings',
        row_index: i, type: 'action_button', b: r.label, c: r.icon, d: r.url, e: r.cssClass,
      })),
    ];

    await withSaveButton(btn, async () => {
      try {
        await replaceRows(r => r.type === 'info_item' || r.type === 'action_button', rows);
        clearDirty();
        toast('Header saved', 'ok');
      } catch (err) {
        toast('Save failed: ' + err.message, 'err');
      }
    });
  }


  /* === TAB 3: CATEGORIES ================================================== */

  function renderCategories() {
    const cats = rowsOfType('category');
    return `
      <div class="section-topbar">
        <div class="add-bar">
          <button class="btn-sm btn-secondary" type="button" id="add-category-btn"><i class="fa-solid fa-plus" style="margin-right:5px"></i>Add Category</button>
        </div>
        <button class="btn-sm btn-save-section" id="section-save-btn"><i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Save</button>
      </div>
      <div class="settings-panel">
        <div class="settings-group">
          <div class="settings-head"><span style="display:flex;align-items:center;gap:6px"><i class="fa-solid fa-layer-group"></i>Tabs on the public page</span></div>
          <div class="settings-body">
            <div class="form-hint" style="margin-bottom:10px">Drag to reorder — this is the tab order visitors see.</div>
            <div id="category-list">
              ${cats.map(r => categoryCardHtml(r.b, r.c, r.d)).join('') ||
      '<div class="form-hint" id="no-cat-msg" style="padding:4px 0">No categories yet.</div>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  function categoryCardHtml(name = '', icon = '', kind = 'timetable') {
    const isLecturer = kind === 'lecturer';
    return `<div class="dynamic-card" data-kind="category" data-original="${x(name)}">
      <div class="dynamic-card-head">
        <span class="dynamic-card-label"><i class="fa-solid fa-grip-vertical drag-handle" style="margin-right:8px;opacity:0.5;cursor:grab"></i><span class="dcl-text">${x(name || 'New Category')}</span></span>
        <button class="btn-red btn-sm" type="button" data-remove="1"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="dynamic-card-body sg-grid3">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input type="text" name="cat_name" value="${x(name)}" data-label-source="New Category">
        </div>
        <div class="form-group">
          <label class="form-label">Icon</label>
          ${iconInputHtml('cat_icon', icon)}
        </div>
        <div class="form-group">
          <label class="form-label">Kind</label>
          <select name="cat_kind">
            <option value="timetable"${isLecturer ? '' : ' selected'}>Class timetables</option>
            <option value="lecturer"${isLecturer ? ' selected' : ''}>Lecturers</option>
          </select>
        </div>
      </div>
    </div>`;
  }

  async function saveCategories(btn) {
    const cards = [...document.querySelectorAll('#category-list .dynamic-card')];
    const cats = cards.map(card => ({
      name: fieldValue(card, 'cat_name'),
      icon: fieldValue(card, 'cat_icon'),
      kind: fieldValue(card, 'cat_kind') === 'lecturer' ? 'lecturer' : 'timetable',
      original: card.dataset.original || '',
    })).filter(c => c.name);

    const names = cats.map(c => c.name);
    if (new Set(names).size !== names.length) {
      toast('Category names must be unique', 'err');
      return;
    }
    // Entry row_uids are keyed by the category's slug, so two names that differ
    // only in punctuation ("Year 1" / "Year-1") would collide in the database
    // even though they look distinct here.
    if (new Set(names.map(slug)).size !== names.length) {
      toast('Category names must differ by more than punctuation', 'err');
      return;
    }

    // A rename changes the `section` value the entries are filed under, so the
    // entry rows have to move with it or they'd be orphaned.
    const renames = cats.filter(c => c.original && c.original !== c.name);

    // Renames are applied one at a time, so a cycle (A→B while B→A) would have
    // the first move overwrite the rows the second one still needs. Rare enough
    // that splitting it into two saves is a fair ask, and far better than
    // silently destroying one category's entries.
    const cycle = renames.find(r => renames.some(o => o !== r && o.original === r.name));
    if (cycle) {
      toast(`Renaming to "${cycle.name}" swaps it with another category — do it in two saves`, 'err');
      return;
    }
    // Deleting a category takes its entries with it — otherwise they'd linger
    // invisibly and reappear if the name were ever reused.
    const keptOriginals = new Set(cats.map(c => c.original).filter(Boolean));
    const removed = rowsOfType('category')
      .map(r => r.b)
      .filter(name => !keptOriginals.has(name));

    if (removed.length) {
      const orphaned = removed.reduce(
        (n, name) => n + rowsInSection(name, 'entry').length + rowsInSection(name, 'lecturer').length, 0);
      const ok = await confirmDialog(
        orphaned
          ? `Deleting ${removed.join(', ')} will also delete ${orphaned} entr${orphaned === 1 ? 'y' : 'ies'} inside ${removed.length === 1 ? 'it' : 'them'}.`
          : `Delete ${removed.join(', ')}?`,
        { title: 'Delete Category', okLabel: 'Delete', danger: true, okIcon: 'fa-trash' });
      if (!ok) return;
    }

    const rows = cats.map((c, i) => ({
      ...BLANK,
      row_uid: uid('settings', 'cat', c.name),
      section: 'settings',
      row_index: i,
      type: 'category',
      b: c.name, c: c.icon, d: c.kind,
    }));

    await withSaveButton(btn, async () => {
      try {
        const isEntryRow = row => row.type === 'entry' || row.type === 'lecturer';

        // Deletions run BEFORE renames: renaming a category onto a name that's
        // being deleted in the same save would otherwise move the entries in
        // and then have the deletion sweep them straight back out.
        for (const name of removed) {
          await replaceRows(row => row.section === name && isEntryRow(row), []);
        }

        // Then the moves — before the category rows themselves, so a failure
        // here leaves the entries still reachable under the old name.
        for (const r of renames) {
          const moving = [...rowsInSection(r.original, 'entry'), ...rowsInSection(r.original, 'lecturer')]
            .map((row, i) => ({ ...row, row_uid: entryUid(r.name, i), row_index: i, section: r.name }));
          if (moving.length) {
            await replaceRows(row => row.section === r.original && isEntryRow(row), moving);
          }
        }

        await replaceRows(row => row.type === 'category', rows);

        // Kind may have flipped, and the selected category may be gone.
        if (!names.includes(S.category)) S.category = names[0] || null;

        clearDirty();
        toast('Categories saved', 'ok');
        selectSection('categories');   // re-render so data-original tracks the new names
      } catch (err) {
        toast('Save failed: ' + err.message, 'err');
      }
    });
  }


  /* === TAB 4: ENTRIES ===================================================== */

  function renderEntries() {
    const cats = rowsOfType('category');
    if (!cats.length) {
      return `<div class="empty-content">No categories yet — add one in the <strong>Categories</strong> tab first.</div>`;
    }

    if (!cats.some(c => c.b === S.category)) S.category = cats[0].b;
    const cat = cats.find(c => c.b === S.category);
    const isLecturer = cat.d === 'lecturer';
    const entries = rowsInSection(cat.b, isLecturer ? 'lecturer' : 'entry');

    return `
      <div class="section-topbar">
        <div class="add-bar">
          <select id="entry-category-select" style="max-width:220px">
            ${cats.map(c => `<option value="${x(c.b)}"${c.b === S.category ? ' selected' : ''}>${x(c.b)}</option>`).join('')}
          </select>
          <button class="btn-sm btn-secondary" type="button" id="add-entry-btn"><i class="fa-solid fa-plus" style="margin-right:5px"></i>Add Entry</button>
        </div>
        <button class="btn-sm btn-save-section" id="section-save-btn"><i class="fa-solid fa-floppy-disk" style="margin-right:6px"></i>Save</button>
      </div>
      <div class="settings-panel">
        <div class="settings-group">
          <div class="settings-head"><span style="display:flex;align-items:center;gap:6px"><i class="${x(cat.c || 'fa-solid fa-layer-group')}"></i>${x(cat.b)}</span></div>
          <div class="settings-body">
            <div class="form-hint" style="margin-bottom:10px">
              ${isLecturer
        ? 'Lecturer ID is the number in <code>eis.epoka.edu.al/publictimetable/live/<b>ID</b></code>.'
        : 'Both IDs come from the EIS public timetable URL: <code>…/publictimetable/<b>timetable</b>/show/programgrade/<b>class</b>/</code>. Use <b>Test</b> to check them before saving.'}
              Drag to reorder.
            </div>
            <div id="entry-list" data-kind="${isLecturer ? 'lecturer' : 'entry'}">
              ${entries.map(r => entryCardHtml(isLecturer, r.b, r.c, r.d)).join('') ||
      '<div class="form-hint" id="no-entry-msg" style="padding:4px 0">No entries yet.</div>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  function entryCardHtml(isLecturer, label = '', first = '', second = '') {
    const fields = isLecturer
      ? `<div class="form-group">
           <label class="form-label">Lecturer ID</label>
           <input type="text" name="entry_first" value="${x(first)}" inputmode="numeric" placeholder="e.g. 655">
         </div>`
      : `<div class="form-group">
           <label class="form-label">Timetable ID</label>
           <input type="text" name="entry_first" value="${x(first)}" inputmode="numeric" placeholder="e.g. 42">
         </div>
         <div class="form-group">
           <label class="form-label">Class ID</label>
           <input type="text" name="entry_second" value="${x(second)}" inputmode="numeric" placeholder="e.g. 118">
         </div>`;

    return `<div class="dynamic-card" data-kind="entry">
      <div class="dynamic-card-head">
        <span class="dynamic-card-label"><i class="fa-solid fa-grip-vertical drag-handle" style="margin-right:8px;opacity:0.5;cursor:grab"></i><span class="dcl-text">${x(label || 'New Entry')}</span></span>
        ${isLecturer ? '' : '<button class="btn-secondary btn-sm" type="button" data-test="1"><i class="fa-solid fa-flask" style="margin-right:5px"></i>Test</button>'}
        <button class="btn-red btn-sm" type="button" data-remove="1"><i class="fa-solid fa-trash"></i></button>
      </div>
      <div class="dynamic-card-body ${isLecturer ? 'sg-grid2' : 'sg-grid3'}">
        <div class="form-group">
          <label class="form-label">Label</label>
          <input type="text" name="entry_label" value="${x(label)}" data-label-source="New Entry">
        </div>
        ${fields}
      </div>
    </div>`;
  }

  async function saveEntries(btn) {
    const list = document.getElementById('entry-list');
    if (!list) return;

    const isLecturer = list.dataset.kind === 'lecturer';
    const category = S.category;

    const entries = [...list.querySelectorAll('.dynamic-card')].map(card => ({
      label: fieldValue(card, 'entry_label'),
      first: fieldValue(card, 'entry_first'),
      second: fieldValue(card, 'entry_second'),
    })).filter(e => e.label);

    // EIS ids are always numeric; catching a typo here beats a mystery "no
    // timetable found" on the public page.
    const bad = entries.find(e =>
      !/^\d+$/.test(e.first) || (!isLecturer && !/^\d+$/.test(e.second)));
    if (bad) {
      toast(`"${bad.label}" needs numeric ID${isLecturer ? '' : 's'}`, 'err');
      return;
    }

    const labels = entries.map(e => e.label);
    if (new Set(labels).size !== labels.length) {
      toast('Entry labels must be unique within a category', 'err');
      return;
    }

    const rows = entries.map((e, i) => ({
      ...BLANK,
      row_uid: entryUid(category, i),
      section: category,
      row_index: i,
      type: isLecturer ? 'lecturer' : 'entry',
      b: e.label,
      c: e.first,
      d: isLecturer ? '' : e.second,
    }));

    await withSaveButton(btn, async () => {
      try {
        await replaceRows(r => r.section === category && (r.type === 'entry' || r.type === 'lecturer'), rows);
        clearDirty();
        toast('Entries saved', 'ok');
      } catch (err) {
        toast('Save failed: ' + err.message, 'err');
      }
    });
  }

  // Fetches and renders a class timetable in the modal, using the exact same
  // Edge Function, sanitizer and renderer as the public page — so a table that
  // looks right here looks right there.
  async function testEntry(card) {
    const label = fieldValue(card, 'entry_label') || 'Entry';
    const tId = fieldValue(card, 'entry_first');
    const cId = fieldValue(card, 'entry_second');

    if (!/^\d+$/.test(tId) || !/^\d+$/.test(cId)) {
      toast('Both IDs must be numbers before testing', 'err');
      return;
    }

    document.getElementById('modal-title').textContent = `Preview — ${label}`;
    document.getElementById('modal-body').innerHTML =
      `<div class="table-container visible" id="test-container" style="display:grid">
         <div class="tt-inner"><div class="iframe-loader"></div></div>
       </div>`;
    document.getElementById('modal-overlay').classList.add('open');

    const container = document.getElementById('test-container');
    const inner = container.querySelector('.tt-inner');

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/eis-timetable?tId=${encodeURIComponent(tId)}&cId=${encodeURIComponent(cId)}`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // The modal may already be closed and reopened on another card.
      if (!document.body.contains(inner)) return;

      if (!html.includes('<table')) {
        inner.innerHTML = '<div class="tt-error">No timetable found for these IDs — double-check them in EIS.</div>';
        return;
      }
      inner.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ['style'], FORCE_BODY: true });
      fitTimetable(container);
    } catch (err) {
      if (!document.body.contains(inner)) return;
      inner.innerHTML = `<div class="tt-error">Could not reach the timetable service (${x(err.message)}).</div>`;
    }
  }


  /* === SECTION WIRING =====================================================
     Listeners are attached in JS rather than inline in the markup, so nothing
     extra has to be exposed on window and the card templates stay free of
     handler strings.

     The two delegated listeners below are bound ONCE, at module scope.
     #section-body is a permanent element — only its innerHTML is replaced on
     a tab switch — so binding them per render would stack a fresh copy every
     time, and one delete click would raise a confirm dialog per past render.
     ====================================================================== */

  const sectionBody = document.getElementById('section-body');

  // Live card-title updates, icon previews, and the semester preview.
  sectionBody.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset?.labelSource) {
      const lbl = t.closest('.dynamic-card')?.querySelector('.dcl-text');
      if (lbl) lbl.textContent = t.value.trim() || t.dataset.labelSource;
    }
    if (t.classList?.contains('icon-field')) {
      const preview = t.parentElement.querySelector('.icon-preview-el');
      if (preview) preview.className = 'icon-preview-el ' + (t.value.trim() || 'fa-solid fa-question');
    }
    if (S.section === 'semester') updateSemesterPreview();
  });

  // Delete / Test, delegated so newly added cards work without rebinding.
  sectionBody.addEventListener('click', async e => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const card = removeBtn.closest('.dynamic-card');
      const name = card.querySelector('.dcl-text')?.textContent || 'this item';
      if (await confirmDialog(`Remove ${name}? It's deleted from the site when you save.`,
        { title: 'Remove', okLabel: 'Remove', danger: true, okIcon: 'fa-trash' })) {
        card.remove();
        markDirty();
      }
      return;
    }

    const testBtn = e.target.closest('[data-test]');
    if (testBtn) testEntry(testBtn.closest('.dynamic-card'));
  });

  // Per-render wiring only: every element touched here is freshly created by
  // the render that just ran, so these bindings can't accumulate.
  function wireSection(id) {
    const saveBtn = document.getElementById('section-save-btn');
    if (saveBtn) {
      const savers = {
        semester: saveSemester, header: saveHeader,
        categories: saveCategories, entries: saveEntries,
      };
      saveBtn.addEventListener('click', () => savers[id](saveBtn));
    }

    if (id === 'semester') updateSemesterPreview();

    if (id === 'header') {
      wireAdd('add-info-btn', 'info-list', 'no-info-msg', () => infoCardHtml());
      wireAdd('add-action-btn', 'action-list', 'no-action-msg', () => actionCardHtml());
      initDnD('info-list');
      initDnD('action-list');
    }

    if (id === 'categories') {
      wireAdd('add-category-btn', 'category-list', 'no-cat-msg', () => categoryCardHtml());
      initDnD('category-list');
    }

    if (id === 'entries') {
      const select = document.getElementById('entry-category-select');
      if (select) {
        select.addEventListener('change', async () => {
          if (!(await confirmLeaveIfDirty())) {
            select.value = S.category;   // put the picker back
            return;
          }
          S.category = select.value;
          selectSection('entries');
        });
      }
      const list = document.getElementById('entry-list');
      wireAdd('add-entry-btn', 'entry-list', 'no-entry-msg',
        () => entryCardHtml(list?.dataset.kind === 'lecturer'));
      initDnD('entry-list');
    }
  }

  function wireAdd(buttonId, listId, emptyMsgId, html) {
    const btn = document.getElementById(buttonId);
    const list = document.getElementById(listId);
    if (!btn || !list) return;
    btn.addEventListener('click', () => {
      document.getElementById(emptyMsgId)?.remove();
      list.insertAdjacentHTML('beforeend', html());
      // Bookkeeping before the cosmetic scroll: if scrolling ever throws, the
      // card must still be registered as an unsaved change and be draggable.
      markDirty();
      initDnD(listId);
      // The new card lands below the fold on a long list.
      list.lastElementChild?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    });
  }

  const DND_OPTS = {
    animation: 180,
    handle: '.drag-handle',
    ghostClass: 'dnd-ghost',
    chosenClass: 'dnd-chosen',
    forceFallback: true,
    delay: 250,
    delayOnTouchOnly: true,
    touchStartThreshold: 5,
    onEnd: () => markDirty(),   // a reorder is an unsaved change
  };

  // Order is never persisted on drop — each tab's Save reads the final DOM
  // order. Called again after every add, so it must not attach a second
  // Sortable to a container that already has one.
  function initDnD(listId) {
    const el = document.getElementById(listId);
    if (!el || !window.Sortable || Sortable.get(el)) return;
    Sortable.create(el, DND_OPTS);
  }


  /* === SHARED WIDGETS ===================================================== */

  function iconInputHtml(name, value) {
    return `<div class="icon-input-wrap">
      <input type="text" class="icon-field" name="${name}" value="${x(value)}" placeholder="fa-solid fa-calendar">
      <i class="icon-preview-el ${x(value || 'fa-solid fa-question')}" style="font-size:1.5em;color:var(--primary-color);width:30px;text-align:center;flex-shrink:0"></i>
      <a class="icon-find-link" href="${FA_SEARCH_URL}" target="_blank" rel="noopener noreferrer" title="Find an icon on Font Awesome"><i class="fa-solid fa-magnifying-glass"></i></a>
    </div>`;
  }

  function fieldValue(card, name) {
    return card.querySelector(`[name="${name}"]`)?.value.trim() || '';
  }


  /* === MODAL / CONFIRM / TOAST ============================================ */

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('modal-body').innerHTML = '';
  }

  // Resolves true (OK) or false (Cancel / backdrop / Escape).
  function confirmDialog(message, opts = {}) {
    const { title = 'Please Confirm', okLabel = 'Confirm', danger = false, okIcon = 'fa-check' } = opts;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').textContent = message;

    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.className = 'btn-sm' + (danger ? ' btn-red' : '');
    okBtn.innerHTML = `<i class="fa-solid ${okIcon}" style="margin-right:5px"></i>${x(okLabel)}`;

    if (_confirmResolve) _resolveConfirm(false);   // supersede an open dialog
    document.getElementById('confirm-overlay').classList.add('open');
    return new Promise(resolve => { _confirmResolve = resolve; });
  }

  function _resolveConfirm(val) {
    document.getElementById('confirm-overlay').classList.remove('open');
    const resolve = _confirmResolve;
    _confirmResolve = null;
    if (resolve) resolve(val);
  }

  function toast(msg, type) {
    const el = document.getElementById('toast');
    const icon = type === 'ok' ? 'fa-circle-check' : type === 'err' ? 'fa-circle-exclamation' : 'fa-circle-info';
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${x(msg)}</span>`;
    el.className = 'toast show' + (type ? ' ' + type : '');
    // Errors linger so the reason is actually readable before it fades.
    clearTimeout(_tt);
    _tt = setTimeout(() => el.classList.remove('show'), type === 'err' ? 6000 : 3000);
  }

  function x(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Escape dismisses the topmost layer; Ctrl/Cmd+S saves the open tab rather
  // than triggering the browser's Save Page.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('confirm-overlay').classList.contains('open')) { _resolveConfirm(false); return; }
      if (document.getElementById('modal-overlay').classList.contains('open')) { closeModal(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      const btn = document.getElementById('section-save-btn');
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    }
  });


  /* === PAGE CHROME ======================================================== */

  applyThemeDefaults();
  applyOwnerBranding();
  setupThemeToggle();

  // The markup calls these from inline handlers, so they need to be reachable
  // from outside this IIFE. (_overlayMD / _confirmOverlayMD are set and read
  // entirely within those inline handlers, so they stay plain window globals
  // and need nothing here.)
  window.signIn = signIn;
  window.signOut = signOut;
  window.closeModal = closeModal;
  window._resolveConfirm = _resolveConfirm;
})();
