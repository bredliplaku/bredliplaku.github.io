// Account settings. Database RPCs remain the authority for every permission change.
(function () {
  'use strict';

  let accounts = [], courses = [];
  let selectedEmail = null, baseline = '', pending = null, viewSequence = 0;
  let accountQuery = '', courseQuery = '', courseFilter = 'active';
  let selectedCourses = new Set();
  const roleLabels = { global_admin: 'Global admin', admin: 'Admin', lecturer: 'Lecturer', student: 'Student' };
  const roleGroups = [
    { label: 'Admins', roles: ['global_admin', 'admin'], icon: 'fa-solid fa-user-gear' },
    { label: 'Lecturers', roles: ['lecturer'], icon: 'fa-solid fa-chalkboard-user' },
    { label: 'Students', roles: ['student'], icon: 'fa-solid fa-user-graduate' }
  ];

  const isGlobalAdmin = () => S.access?.role === 'global_admin';
  const screen = () => document.getElementById('access-settings');
  const archiveFlag = value => value === true || value === 'true' || value === 1 || value === '1';
  const courseKey = course => JSON.stringify([course.sheet_name, archiveFlag(course.is_archive)]);
  const selectedAccount = () => accounts.find(account => account.email === selectedEmail) || null;
  const isLocked = () => selectedAccount()?.role === 'global_admin';
  const matchesQuery = (text, query) => query.trim().toLocaleLowerCase().split(/\s+/)
    .every(word => text.toLocaleLowerCase().includes(word));
  const initials = account => (account.name || account.email).split(/[\s@._-]+/).filter(Boolean)
    .slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase();
  const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email, undefined,
    { sensitivity: 'base', numeric: true }) || a.email.localeCompare(b.email);

  window.renderAccessControls = function () {
    const create = document.getElementById('new-course-btn');
    if (create) create.disabled = !['global_admin', 'admin'].includes(S.access?.role);
    const button = document.getElementById('access-settings-btn');
    if (!button) return;
    button.hidden = !isGlobalAdmin();
    button.setAttribute('aria-pressed', String(!!screen()));
  };

  async function readCourses() {
    const map = new Map();
    for (let start = 0; ; start += 1000) {
      const { data, error } = await sb.from('course_rows').select('sheet_name,is_archive,b,c')
        .eq('type', 'metadata').order('sheet_name').order('is_archive').order('row_uid').range(start, start + 999);
      if (error) throw error;
      for (const row of data || []) {
        const key = courseKey(row);
        if (!map.has(key)) map.set(key, { sheet_name: row.sheet_name, is_archive: archiveFlag(row.is_archive) });
        const field = String(row.b || '').trim().toLowerCase();
        if (['code', 'title', 'semester', 'year'].includes(field)) map.get(key)[field] = String(row.c || '').trim();
        if (field === 'header_decoration') map.get(key).icon = String(row.c || '').trim();
      }
      if (!data || data.length < 1000) break;
    }
    return [...map.values()].sort((a, b) => Number(a.is_archive) - Number(b.is_archive) || courseOrder(a, b));
  }

  async function readAccounts() {
    const { data, error } = await sb.rpc('teaching_list_accounts');
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Could not load accounts.');
    return data.map(account => ({ ...account, assignments: Array.isArray(account.assignments) ? account.assignments : [] })).sort(byName);
  }

  window.openAccessSettings = async function () {
    if (!isGlobalAdmin()) { toast('Only the global admin can manage accounts.', 'err'); return; }
    if (!(await confirmLeaveIfDirty())) return;
    closeInlineEdit(true);
    S.course = null; S.isArchive = false; S.section = 'access';
    applyCourseTheme('');
    document.querySelectorAll('.course-btn').forEach(button => button.classList.remove('active'));
    if (window.innerWidth <= 768 && document.getElementById('sidebar')?.classList.contains('mobile-open')) toggleSidebar();
    const sequence = ++viewSequence;
    document.getElementById('main-area').innerHTML = `
      <section id="access-settings" class="access-settings" aria-labelledby="access-title">
        <div class="course-header access-header">
          <div class="ch-title-wrap"><h2 id="access-title">Settings</h2><div class="ch-meta">Accounts</div></div>
          <button type="button" class="btn-ghost btn-sm" id="access-add-account" disabled><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Add account</button>
        </div>
        <div class="settings-group access-loading"><div class="settings-body access-status" role="status">Loading accounts…</div></div>
      </section>`;
    const container = screen();
    baseline = '';
    renderAccessControls();
    try {
      const results = await Promise.all([readAccounts(), readCourses()]);
      if (sequence !== viewSequence || screen() !== container || !isGlobalAdmin()) return;
      [accounts, courses] = results;
      selectedEmail = accounts.some(account => account.email === selectedEmail) ? selectedEmail :
        roleGroups.flatMap(group => accounts.filter(account => group.roles.includes(account.role)))[0]?.email || null;
      renderSettings();
    } catch (error) {
      if (sequence !== viewSequence || screen() !== container) return;
      const status = container.querySelector('.access-status');
      status.setAttribute('role', 'alert');
      status.textContent = 'Could not load settings. ' + (error.message || '');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'btn-secondary btn-sm'; retry.textContent = 'Retry';
      retry.addEventListener('click', openAccessSettings);
      status.appendChild(retry);
    }
  };

  function renderSettings() {
    const container = screen();
    if (!container) return;
    container.querySelector('.access-loading, .access-layout')?.remove();
    container.insertAdjacentHTML('beforeend', `
      <div class="access-layout">
        <aside class="settings-group access-directory" aria-labelledby="access-accounts-title">
          <div class="settings-head"><span id="access-accounts-title">Accounts</span><span class="badge category-count-badge">${accounts.length}</span></div>
          <div class="settings-body access-directory-body">
            <div class="access-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input type="search" id="access-account-search" aria-label="Search accounts" placeholder="Search accounts" value="${x(accountQuery)}" autocomplete="off"></div>
            <div id="access-accounts"></div>
            <div id="access-no-matches" class="empty-content" hidden>No matching accounts.</div>
          </div>
        </aside>
        <div id="access-editor" class="settings-panel"></div>
      </div>`);
    const add = container.querySelector('#access-add-account');
    add.disabled = !!pending;
    add.onclick = () => chooseAccount(null);
    container.querySelector('#access-accounts').addEventListener('click', event => {
      const button = event.target.closest('[data-account-index]');
      if (button) chooseAccount(accounts[Number(button.dataset.accountIndex)].email);
    });
    container.querySelector('#access-account-search').addEventListener('input', event => {
      accountQuery = event.target.value;
      renderAccountList();
    });
    renderAccountList();
    renderEditor();
  }

  function renderAccountList() {
    const list = document.getElementById('access-accounts');
    if (!list) return;
    let count = 0;
    list.innerHTML = roleGroups.map(group => {
      const members = accounts.filter(account => group.roles.includes(account.role) &&
        matchesQuery(`${account.name || ''} ${account.email}`, accountQuery)).sort(byName);
      if (!members.length) return '';
      count += members.length;
      return `<div class="access-role-group">
        <h3 class="sidebar-label access-group-title"><i class="${group.icon}" aria-hidden="true"></i>${group.label}<span>${members.length}</span></h3>
        ${members.map(account => `<button type="button" class="access-account${account.email === selectedEmail ? ' is-selected' : ''}"
          data-account-index="${accounts.indexOf(account)}" aria-pressed="${account.email === selectedEmail}">
          <span class="access-avatar" aria-hidden="true">${x(initials(account))}</span>
          <span class="access-account-text"><span class="access-account-name">${x(account.name || account.email)}</span>
            <span class="access-account-email">${x(account.name ? account.email : 'Not signed in yet')}</span></span>
          ${account.role === 'global_admin' ? '<i class="fa-solid fa-shield-halved access-owner-mark" title="Global admin" aria-label="Global admin"></i>' : ''}
        </button>`).join('')}
      </div>`;
    }).join('');
    document.getElementById('access-no-matches').hidden = count > 0;
  }

  async function chooseAccount(email) {
    if (pending || email === selectedEmail) return;
    if (!(await confirmLeaveAccessSettings())) return;
    selectedEmail = email;
    courseQuery = ''; courseFilter = 'active';
    renderAccountList();
    renderEditor();
    document.getElementById(email ? 'access-role' : 'access-email')?.focus();
  }

  function renderEditor() {
    const editor = document.getElementById('access-editor');
    if (!editor) return;
    const account = selectedAccount(), locked = isLocked();
    selectedCourses = new Set((account?.assignments || []).map(courseKey));
    editor.innerHTML = `<form id="access-account-form" class="access-form settings-panel">
      ${locked ? '' : `<div class="section-topbar">
        <button type="submit" class="btn-sm btn-save-section" id="access-save"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ${account ? 'Save' : 'Add account'}</button>
        <div class="add-bar">
          <button type="button" class="btn-secondary btn-sm" id="access-discard">Discard</button>
          ${account ? '<button type="button" id="access-remove" class="btn-red btn-sm"><i class="fa-solid fa-user-minus" aria-hidden="true"></i> Remove access</button>' : ''}
        </div>
        <span id="access-unsaved" class="form-hint" hidden>Unsaved changes</span>
        <p id="access-form-status" class="access-form-status" role="status" aria-live="polite"></p>
      </div>`}
      <div class="settings-group">
        <div class="settings-head"><span>${account ? 'Account' : 'New account'}</span>
          ${locked ? '<span><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Global admin</span>' : ''}</div>
        <div class="settings-body">
          ${account?.name ? `<div class="access-profile"><span class="access-avatar" aria-hidden="true">${x(initials(account))}</span><strong>${x(account.name)}</strong></div>` : ''}
          <fieldset id="access-account-fields"${locked ? ' disabled' : ''}>
            <div class="sg-grid">
              <div class="form-group"><label class="form-label" for="access-email">Email</label>
                <input id="access-email" name="email" type="email" required autocomplete="off" maxlength="320"
                  placeholder="name@epoka.edu.al" value="${x(account?.email || '')}"${account ? ' readonly' : ''}></div>
              <div class="form-group"><label class="form-label" for="access-role">Role</label>
                <select id="access-role" name="role">${locked ? '<option value="global_admin">Global admin</option>' :
                  ['admin', 'lecturer', 'student'].map(role => `<option value="${role}"${(account?.role || 'lecturer') === role ? ' selected' : ''}>${roleLabels[role]}</option>`).join('')}
                </select></div>
            </div>
          </fieldset>
          ${!account?.name ? '<div class="form-hint">Name appears after Google sign-in.</div>' : ''}
        </div>
      </div>
      <div class="settings-group access-course-group">
        <div class="settings-head"><span>Assigned courses</span><span id="access-assigned-count" class="badge category-count-badge"></span></div>
        <div class="settings-body">
          <div id="access-all-courses" class="form-hint" hidden><i class="fa-solid fa-check" aria-hidden="true"></i> Access to all courses</div>
          <fieldset id="access-course-fields">
            <div class="access-course-tools">
              <div class="access-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" id="access-course-search" aria-label="Search courses by code, name, semester or year" placeholder="Search code, name, semester or year" value="${x(courseQuery)}" autocomplete="off"></div>
              <div class="access-course-filters" role="group" aria-label="Filter courses">
                ${[['active', 'Active'], ['archived', 'Archived'], ['all', 'All'], ['assigned', 'Assigned']].map(([filter, label]) =>
                  `<button type="button" class="btn-secondary btn-sm" data-course-filter="${filter}" aria-pressed="${filter === courseFilter}">${label}<span data-filter-count="${filter}"></span></button>`).join('')}
              </div>
            </div>
            <div class="access-selection-tools"><span id="access-course-result-count" class="form-hint" role="status"></span>
              <div><button type="button" class="btn-secondary btn-sm" id="access-select-shown">Select shown</button>
                <button type="button" class="btn-secondary btn-sm" id="access-clear-shown">Clear shown</button></div></div>
            <div id="access-course-choices"></div>
            <div id="access-course-empty" class="empty-content" hidden>No matching courses.</div>
          </fieldset>
        </div>
      </div>
    </form>`;
    const form = editor.querySelector('#access-account-form');
    form.addEventListener('submit', event => { event.preventDefault(); saveAccessAccount(); });
    editor.querySelector('#access-role').addEventListener('change', updateRoleFields);
    editor.querySelector('#access-email').addEventListener('input', updateDirtyIndicator);
    editor.querySelector('#access-remove')?.addEventListener('click', removeAccount);
    editor.querySelector('#access-discard')?.addEventListener('click', renderEditor);
    editor.querySelector('#access-course-search').addEventListener('input', event => { courseQuery = event.target.value; renderCourses(); });
    editor.querySelector('#access-course-search').addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    editor.querySelectorAll('[data-course-filter]').forEach(button => button.addEventListener('click', () => {
      courseFilter = button.dataset.courseFilter; renderCourses();
    }));
    editor.querySelector('#access-select-shown').addEventListener('click', () => selectShown(true));
    editor.querySelector('#access-clear-shown').addEventListener('click', () => selectShown(false));
    editor.querySelector('#access-course-choices').addEventListener('change', event => {
      const input = event.target.closest('[data-course-index]');
      if (!input) return;
      const key = courseKey(courses[Number(input.dataset.courseIndex)]);
      if (input.checked) selectedCourses.add(key); else selectedCourses.delete(key);
      input.closest('.access-course-option').classList.toggle('is-selected', input.checked);
      if (courseFilter === 'assigned') renderCourses(); else updateCourseCounts();
      updateDirtyIndicator();
    });
    baseline = formFingerprint();
    updateRoleFields();
  }

  function visibleCourses() {
    return courses.filter(course => {
      if (courseFilter === 'active' && course.is_archive) return false;
      if (courseFilter === 'archived' && !course.is_archive) return false;
      if (courseFilter === 'assigned' && !selectedCourses.has(courseKey(course))) return false;
      return matchesQuery([course.code, course.title, course.sheet_name, course.semester, course.year].filter(Boolean).join(' '), courseQuery);
    });
  }

  function renderCourses() {
    const list = document.getElementById('access-course-choices');
    if (!list) return;
    const visible = visibleCourses();
    list.innerHTML = visible.map(course => {
      const code = course.code || course.sheet_name;
      const title = course.title && course.title !== code ? course.title : '';
      const term = [course.semester, course.year].filter(Boolean).join(' ');
      const selected = selectedCourses.has(courseKey(course));
      return `<label class="access-course-option${selected ? ' is-selected' : ''}">
        <input type="checkbox" name="course" data-course-index="${courses.indexOf(course)}"${selected ? ' checked' : ''}>
        <i class="${x(course.icon || 'fa-solid fa-graduation-cap')} cb-icon" aria-hidden="true"></i>
        <span class="cb-text"><span class="cb-code">${x(code)}</span>${title ? `<span class="cb-name">${x(title)}</span>` : ''}
          ${term ? `<span class="cb-sub">${x(term)}</span>` : ''}</span>
        ${course.is_archive ? '<span class="access-course-state"><i class="fa-solid fa-box-archive" aria-hidden="true"></i><span>Archived</span></span>' : ''}
      </label>`;
    }).join('');
    document.getElementById('access-course-empty').hidden = visible.length > 0;
    document.getElementById('access-course-empty').textContent = !courses.length ? 'No courses yet.' :
      courseFilter === 'assigned' && !selectedCourses.size ? 'No courses assigned.' : 'No matching courses.';
    document.getElementById('access-course-result-count').textContent = `${visible.length} shown`;
    screen().querySelectorAll('[data-course-filter]').forEach(button => {
      const active = button.dataset.courseFilter === courseFilter;
      button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
    });
    updateCourseCounts();
  }

  function updateCourseCounts() {
    const unrestricted = ['admin', 'global_admin'].includes(document.getElementById('access-role')?.value);
    document.getElementById('access-assigned-count').textContent = unrestricted ? 'All' : String(selectedCourses.size);
    const counts = { active: courses.filter(course => !course.is_archive).length,
      archived: courses.filter(course => course.is_archive).length, all: courses.length, assigned: selectedCourses.size };
    screen().querySelectorAll('[data-filter-count]').forEach(label => { label.textContent = String(counts[label.dataset.filterCount]); });
    const visible = visibleCourses();
    document.getElementById('access-select-shown').disabled = !!pending || !visible.some(course => !selectedCourses.has(courseKey(course)));
    document.getElementById('access-clear-shown').disabled = !!pending || !visible.some(course => selectedCourses.has(courseKey(course)));
  }

  function selectShown(selected) {
    if (pending || isLocked()) return;
    for (const course of visibleCourses()) {
      if (selected) selectedCourses.add(courseKey(course)); else selectedCourses.delete(courseKey(course));
    }
    renderCourses(); updateDirtyIndicator();
  }

  function updateRoleFields() {
    const role = document.getElementById('access-role')?.value;
    if (!role) return;
    const unrestricted = ['admin', 'global_admin'].includes(role);
    const fields = document.getElementById('access-course-fields');
    fields.hidden = unrestricted; fields.disabled = unrestricted || !!pending || isLocked();
    document.getElementById('access-all-courses').hidden = !unrestricted;
    renderCourses(); updateDirtyIndicator();
  }

  function formValues() {
    const form = document.getElementById('access-account-form');
    if (!form) return null;
    const role = form.querySelector('#access-role').value;
    return { email: form.querySelector('#access-email').value.trim().toLowerCase(), role,
      assignments: ['admin', 'global_admin'].includes(role) ? [] : [...selectedCourses].sort().map(key => {
        const [sheet_name, is_archive] = JSON.parse(key); return { sheet_name, is_archive };
      }) };
  }

  function formFingerprint() { return JSON.stringify(formValues()); }
  window.accessSettingsDirty = () => !!screen() && !!baseline && !isLocked() && baseline !== formFingerprint();
  function updateDirtyIndicator() {
    const dirty = accessSettingsDirty();
    const indicator = document.getElementById('access-unsaved');
    if (indicator) indicator.hidden = !dirty;
    const discard = document.getElementById('access-discard');
    if (discard) discard.disabled = !!pending || !dirty;
    const save = document.getElementById('access-save');
    if (save) save.disabled = !!pending || (!!selectedAccount() && !dirty);
  }

  window.confirmLeaveAccessSettings = async function () {
    if (pending) await pending;
    if (!accessSettingsDirty()) return true;
    const choice = await confirmDialog('Save your account changes?',
      { title: 'Unsaved changes', okLabel: 'Save', okIcon: 'fa-floppy-disk', altLabel: 'Discard' });
    if (choice === true) return await saveAccessAccount();
    if (choice === 'alt') { renderEditor(); return true; }
    return false;
  };

  function setPending(value) {
    if (!screen()) return;
    screen().setAttribute('aria-busy', String(value));
    screen().querySelectorAll('button').forEach(button => { button.disabled = value; });
    document.getElementById('access-account-search').disabled = value;
    document.getElementById('access-account-fields').disabled = value || isLocked();
    const save = document.getElementById('access-save');
    if (save) save.innerHTML = value ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…' :
      '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ' + (selectedAccount() ? 'Save' : 'Add account');
    updateRoleFields();
  }

  function formStatus(message, error) {
    const status = document.getElementById('access-form-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', !!error);
    status.setAttribute('role', error ? 'alert' : 'status');
  }

  window.saveAccessAccount = async function () {
    if (pending) return await pending;
    if (!isGlobalAdmin() || isLocked()) return false;
    const form = document.getElementById('access-account-form');
    if (!form || !form.reportValidity()) return false;
    const values = formValues();
    if (!['admin', 'lecturer', 'student'].includes(values.role)) return false;
    if (!selectedEmail && accounts.some(account => account.email.toLowerCase() === values.email)) {
      formStatus('This account already exists. Select it from the list.', true); return false;
    }
    const previous = selectedAccount();
    formStatus('', false);
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_set_account', {
          p_email: values.email, p_name: '', p_role: values.role, p_assignments: values.assignments
        });
        if (error) throw error;
        baseline = formFingerprint(); selectedEmail = values.email;
        accounts = accounts.filter(account => account.email !== values.email)
          .concat({ ...values, name: previous?.name || '' }).sort(byName);
        // Names come back from Google's server-held identity, never from this form.
        try { accounts = await readAccounts(); } catch { /* Keep the successful save visible. */ }
        if (screen()) renderSettings();
        toast('Account saved', 'ok'); return true;
      } catch (error) {
        formStatus('Could not save. ' + (error.message || 'Try again.'), true); return false;
      }
    })();
    setPending(true);
    try { return await pending; }
    finally { pending = null; setPending(false); }
  };

  async function removeAccount() {
    const account = selectedAccount();
    if (pending || !isGlobalAdmin() || !account || isLocked()) return;
    const approved = await confirmDialog(`Remove access for ${account.name || account.email}?`,
      { title: 'Remove account', okLabel: 'Remove access', danger: true });
    if (!approved || pending || !isGlobalAdmin() || selectedAccount()?.email !== account.email) return;
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_remove_account', { p_email: account.email });
        if (error) throw error;
        accounts = accounts.filter(item => item.email !== account.email);
        selectedEmail = roleGroups.flatMap(group => accounts.filter(item => group.roles.includes(item.role)))[0]?.email || null;
        baseline = ''; courseQuery = ''; courseFilter = 'active';
        if (screen()) renderSettings();
        toast('Access removed', 'ok'); return true;
      } catch (error) {
        formStatus('Could not remove access. ' + (error.message || 'Try again.'), true); return false;
      }
    })();
    setPending(true);
    try { await pending; }
    finally { pending = null; setPending(false); }
  }
})();
