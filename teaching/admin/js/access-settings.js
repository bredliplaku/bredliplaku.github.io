// Account settings. Database RPCs remain the authority for every permission change.
(function () {
  'use strict';

  let accounts = [], courses = [];
  let selectedEmail = null, baseline = '', pending = null, viewSequence = 0;
  let downloadPending = false, downloadError = null, websiteNeedsUpdate = false;
  let accountQuery = '', courseQuery = '', courseFilter = 'active';
  let selectedCourses = new Set();
  const roleLabels = { admin: 'Admin', lecturer: 'Lecturer', student: 'Student' };
  const roleGroups = [
    { label: 'Admins', roles: ['admin'], icon: 'fa-solid fa-user-gear' },
    { label: 'Lecturers', roles: ['lecturer'], icon: 'fa-solid fa-chalkboard-user' },
    { label: 'Students', roles: ['student'], icon: 'fa-solid fa-user-graduate' }
  ];

  const isAdmin = () => ['admin', 'global_admin'].includes(S.access?.role);
  const canManageAccounts = () => isAdmin() || S.access?.role === 'lecturer';
  const screen = () => document.getElementById('access-settings');
  const archiveFlag = value => value === true || value === 'true' || value === 1 || value === '1';
  const courseKey = course => JSON.stringify([course.sheet_name, archiveFlag(course.is_archive)]);
  const selectedAccount = () => accounts.find(account => account.email === selectedEmail) || null;
  const isLocked = () => {
    const account = selectedAccount();
    if (!account) return false;
    return isAdmin() ? account.role === 'admin' && accounts.filter(item => item.role === 'admin').length === 1 :
      account.role !== 'student';
  };
  const canDownloadWebsite = account => canManageAccounts() && account?.role === 'lecturer' &&
    (isAdmin() || account.email === S.access?.email);
  const canRemoveAccount = () => !!selectedAccount() && !isLocked() &&
    (isAdmin() || selectedAccount().assignments.length > 0);
  const matchesQuery = (text, query) => query.trim().toLocaleLowerCase().split(/\s+/)
    .every(word => text.toLocaleLowerCase().includes(word));
  const accountName = account => account.name || account.email;
  const initials = account => accountName(account).split(/[\s@._-]+/).filter(Boolean)
    .slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase();
  const byName = (a, b) => accountName(a).localeCompare(accountName(b), undefined,
    { sensitivity: 'base', numeric: true }) || a.email.localeCompare(b.email);

  window.renderAccessControls = function () {
    const create = document.getElementById('new-course-btn');
    if (create) create.disabled = !['global_admin', 'admin'].includes(S.access?.role);
    const button = document.getElementById('access-settings-btn');
    if (!button) return;
    button.hidden = !canManageAccounts();
    button.setAttribute('aria-pressed', String(!!screen()));
  };

  async function readCourses() {
    const map = new Map();
    for (let start = 0; ; start += 1000) {
      const { data, error } = await sb.from('course_rows').select('sheet_name,is_archive,b,c')
        .eq('type', 'metadata').order('sheet_name').order('is_archive').order('row_uid').range(start, start + 999);
      if (error) throw error;
      for (const row of data || []) {
        if (!hasCourseAccess(row.sheet_name, archiveFlag(row.is_archive))) continue;
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
    return data.map(account => ({
      ...account, role: account.role === 'global_admin' ? 'admin' : account.role,
      assignments: Array.isArray(account.assignments) ? account.assignments : []
    })).sort(byName);
  }

  const needsDatabaseUpdate = error => ['PGRST202', '42883', '42703', '42P01'].includes(error?.code);

  async function checkWebsiteDatabase() {
    try {
      const { error } = await sb.rpc('teaching_resolve_lecturer', { p_id: '00000000-0000-0000-0000-000000000000' });
      return needsDatabaseUpdate(error);
    } catch { return false; } // A connection failure is reported when downloading.
  }

  window.openAccessSettings = async function () {
    if (!canManageAccounts()) { toast('Only Admins and Lecturers can open Settings.', 'err'); return; }
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
          <div class="ch-title-wrap"><h2 id="access-title">Settings</h2><div class="ch-meta">${isAdmin() ? 'Accounts' : 'My account and assigning courses'}</div></div>
          <button type="button" class="btn-ghost btn-sm" id="access-add-account" disabled><i class="fa-solid fa-user-plus" aria-hidden="true"></i> ${isAdmin() ? 'Add account' : 'Add student'}</button>
        </div>
        <div class="settings-group access-loading"><div class="settings-body access-status" role="status">Loading accounts…</div></div>
      </section>`;
    const container = screen();
    baseline = '';
    renderAccessControls();
    try {
      await refreshTeachingAccess();
      if (!canManageAccounts()) throw new Error('You no longer have access to Settings.');
      const results = await Promise.all([readAccounts(), readCourses(), checkWebsiteDatabase()]);
      if (sequence !== viewSequence || screen() !== container || !canManageAccounts()) return;
      [accounts, courses, websiteNeedsUpdate] = results;
      downloadError = null;
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
    container.querySelector('.ch-meta').textContent = isAdmin() ? 'Accounts' : 'My account and assigning courses';
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
    add.innerHTML = `<i class="fa-solid fa-user-plus" aria-hidden="true"></i> ${isAdmin() ? 'Add account' : 'Add student'}`;
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
        matchesQuery(`${accountName(account)} ${account.name || ''} ${account.email}`, accountQuery)).sort(byName);
      if (!members.length) return '';
      count += members.length;
      return `<div class="access-role-group">
        <h3 class="sidebar-label access-group-title"><i class="${group.icon}" aria-hidden="true"></i>${!isAdmin() && group.roles.includes('lecturer') ? 'My account' : group.label}<span>${members.length}</span></h3>
        ${members.map(account => `<button type="button" class="access-account${account.email === selectedEmail ? ' is-selected' : ''}"
          data-account-index="${accounts.indexOf(account)}" aria-pressed="${account.email === selectedEmail}">
          <span class="access-avatar" aria-hidden="true">${x(initials(account))}</span>
          <span class="access-account-text"><span class="access-account-name">${x(accountName(account))}</span>
            <span class="access-account-email">${x(account.name ? account.email : 'Not signed in yet')}</span></span>
          ${account.role === 'admin' ? '<i class="fa-solid fa-shield-halved access-owner-mark" title="Admin" aria-label="Admin"></i>' : ''}
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
    const roles = isAdmin() ? ['admin', 'lecturer', 'student'] : [account?.role || 'student'];
    const defaultRole = account?.role || (isAdmin() ? 'lecturer' : 'student');
    selectedCourses = new Set((account?.assignments || []).map(courseKey));
    editor.innerHTML = `<form id="access-account-form" class="access-form settings-panel">
      ${locked ? '' : `<div class="section-topbar">
        <button type="submit" class="btn-sm btn-save-section" id="access-save"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ${account ? 'Save' : isAdmin() ? 'Add account' : 'Add student'}</button>
        <div class="add-bar">
          <button type="button" class="btn-secondary btn-sm" id="access-discard">Discard</button>
          ${account ? '<button type="button" id="access-remove" class="btn-red btn-sm"><i class="fa-solid fa-user-minus" aria-hidden="true"></i> Remove access</button>' : ''}
        </div>
        <span id="access-unsaved" class="form-hint" hidden>Unsaved changes</span>
        <p id="access-form-status" class="access-form-status" role="status" aria-live="polite"></p>
      </div>`}
      <div class="settings-group">
        <div class="settings-head"><span>${account ? account.email === S.access?.email ? 'My account' : 'Account' : isAdmin() ? 'New account' : 'New student'}</span>
          ${locked ? `<span>${isAdmin() ? 'Keep at least one Admin' : 'Managed by an Admin'}</span>` : ''}</div>
        <div class="settings-body">
          ${account?.name ? `<div class="access-profile"><span class="access-avatar" aria-hidden="true">${x(initials(account))}</span><strong>${x(account.name)}</strong></div>` : ''}
          <fieldset id="access-account-fields"${locked ? ' disabled' : ''}>
            <div class="sg-grid">
              <div class="form-group"><label class="form-label" for="access-email">Email</label>
                <input id="access-email" name="email" type="email" required autocomplete="off" maxlength="320"
                  placeholder="name@epoka.edu.al" value="${x(account?.email || '')}"${account ? ' readonly' : ''}></div>
              <div class="form-group"><label class="form-label" for="access-role">Role</label>
                <select id="access-role" name="role"${!isAdmin() ? ' disabled' : ''}>${roles.map(role => `<option value="${role}"${defaultRole === role ? ' selected' : ''}>${roleLabels[role]}</option>`).join('')}
                </select></div>
            </div>
          </fieldset>
          ${!account?.name ? '<div class="form-hint">Name appears after Google sign-in.</div>' : ''}
        </div>
      </div>
      <div class="settings-group" id="access-website-group">
        <div class="settings-head"><span>Teaching website</span></div>
        <div class="settings-body">
          <div class="form-hint">Upload this lecturer’s file to any website folder. It shows their assigned courses.</div>
          <div class="access-website-actions">
            <button type="button" class="btn-secondary btn-sm" id="access-download-loader"><i class="fa-solid fa-download" aria-hidden="true"></i> Download index.html</button>
          </div>
          <p id="access-download-status" class="form-hint" role="status" aria-live="polite"></p>
          <div id="access-website-upgrade" class="access-website-upgrade" hidden>
            <p class="form-hint">Run the updated roles.sql in Supabase’s SQL Editor, then try downloading again.</p>
            <a class="btn-secondary btn-sm" href="${x(new URL('supabase/roles.sql', window.TEACHING_CONFIG.appBaseUrl).href)}" target="_blank" rel="noopener noreferrer">Open database update</a>
          </div>
        </div>
      </div>
      <div class="settings-group access-course-group">
        <div class="settings-head"><span>Assigned courses</span><span id="access-assigned-count" class="badge category-count-badge"></span></div>
        <div class="settings-body">
          ${!isAdmin() && !locked ? '<div class="form-hint">Only your courses are shown.</div>' : ''}
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
    editor.querySelector('#access-download-loader')?.addEventListener('click', downloadLoader);
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
        <input type="checkbox" name="course" data-course-index="${courses.indexOf(course)}"${selected ? ' checked' : ''}${pending || isLocked() ? ' disabled' : ''}>
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
    const counts = {
      active: courses.filter(course => !course.is_archive).length,
      archived: courses.filter(course => course.is_archive).length, all: courses.length, assigned: selectedCourses.size
    };
    screen().querySelectorAll('[data-filter-count]').forEach(label => { label.textContent = String(counts[label.dataset.filterCount]); });
    const visible = visibleCourses();
    document.getElementById('access-select-shown').parentElement.hidden = isLocked();
    document.getElementById('access-select-shown').disabled = !!pending || isLocked() || !visible.some(course => !selectedCourses.has(courseKey(course)));
    document.getElementById('access-clear-shown').disabled = !!pending || isLocked() || !visible.some(course => selectedCourses.has(courseKey(course)));
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
    fields.hidden = unrestricted; fields.disabled = unrestricted || !!pending;
    document.getElementById('access-all-courses').hidden = !unrestricted;
    document.getElementById('access-website-group').hidden = role !== 'lecturer';
    renderCourses(); updateDirtyIndicator();
  }

  function formValues() {
    const form = document.getElementById('access-account-form');
    if (!form) return null;
    const role = form.querySelector('#access-role').value;
    return {
      email: form.querySelector('#access-email').value.trim().toLowerCase(), role,
      assignments: ['admin', 'global_admin'].includes(role) ? [] : [...selectedCourses].sort().map(key => {
        const [sheet_name, is_archive] = JSON.parse(key); return { sheet_name, is_archive };
      })
    };
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
    const remove = document.getElementById('access-remove');
    if (remove) remove.disabled = !!pending || !canRemoveAccount();
    updateWebsiteDownload();
  }

  function updateWebsiteDownload() {
    const button = document.getElementById('access-download-loader');
    if (!button) return;
    const savedLecturer = selectedAccount()?.role === 'lecturer';
    const isLecturer = document.getElementById('access-role')?.value === 'lecturer';
    button.disabled = !!pending || downloadPending || !canDownloadWebsite(selectedAccount()) || !isLecturer;
    button.innerHTML = downloadPending ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Preparing file…' :
      '<i class="fa-solid fa-download" aria-hidden="true"></i> Download index.html';
    const error = downloadError?.email === selectedEmail ? downloadError.message : '';
    const status = document.getElementById('access-download-status');
    status.textContent = websiteNeedsUpdate ? 'Website downloads need a database update.' :
      !savedLecturer ? 'Save this lecturer account first.' : downloadPending ? 'Preparing this lecturer’s file…' :
        error || 'Upload once. Course changes update automatically.';
    status.classList.toggle('is-error', websiteNeedsUpdate || !!error);
    status.setAttribute('role', websiteNeedsUpdate || error ? 'alert' : 'status');
    document.getElementById('access-website-upgrade').hidden = !websiteNeedsUpdate;
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
      '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> ' + (selectedAccount() ? 'Save' : isAdmin() ? 'Add account' : 'Add student');
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
    if (!canManageAccounts() || isLocked()) return false;
    const form = document.getElementById('access-account-form');
    if (!form || !form.reportValidity()) return false;
    const values = formValues();
    if (!['admin', 'lecturer', 'student'].includes(values.role)) return false;
    if (!isAdmin() && values.role !== 'student') return false;
    if (!selectedEmail && accounts.some(account => account.email.toLowerCase() === values.email)) {
      formStatus('This account already exists. Select it from the list.', true); return false;
    }
    const previous = selectedAccount();
    if (!isAdmin() && !previous && !values.assignments.length) {
      formStatus('Select at least one of your courses.', true); return false;
    }
    formStatus('', false);
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_set_account', {
          p_email: values.email, p_role: values.role, p_assignments: values.assignments,
          p_name: ''
        });
        if (error) throw error;
        baseline = formFingerprint(); selectedEmail = values.email;
        if (values.email === S.access?.email && values.role !== (isAdmin() ? 'admin' : S.access?.role)) {
          baseline = ''; window.location.reload(); return true;
        }
        accounts = accounts.filter(account => account.email !== values.email);
        const site = values.role === 'lecturer' ? previous?.site :
          previous?.site ? { ...previous.site, hostname: null, base_path: null } : null;
        accounts.push({ ...values, site, name: previous?.name || '' });
        accounts.sort(byName);
        // Reload Google names and the database-filtered student list.
        try { accounts = await readAccounts(); } catch { /* Keep the successful save visible. */ }
        if (!accounts.some(account => account.email === selectedEmail)) selectedEmail = accounts[0]?.email || null;
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

  async function downloadLoader() {
    const account = selectedAccount();
    if (pending || downloadPending || !canDownloadWebsite(account) ||
      document.getElementById('access-role')?.value !== 'lecturer') return;
    downloadPending = true; downloadError = null; updateWebsiteDownload();
    try {
      // Ask the database for the stable ID; never rely on a possibly stale list response.
      const { data, error } = await sb.rpc('teaching_prepare_website', { p_email: account.email });
      if (error) throw error;
      if (!data?.id) throw new Error('Could not prepare the website file. Please try again.');
      websiteNeedsUpdate = false;
      const savedAccount = accounts.find(item => item.email === account.email);
      if (savedAccount) savedAccount.site = { ...savedAccount.site, id: data.id };
      const url = URL.createObjectURL(new Blob([TeachingSites.loaderHtml(data.id)], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'index.html';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (needsDatabaseUpdate(error)) websiteNeedsUpdate = true;
      downloadError = { email: account.email, message: 'Could not download. ' + (error.message || 'Please try again.') };
    } finally {
      downloadPending = false; updateWebsiteDownload();
    }
  }

  async function removeAccount() {
    const account = selectedAccount();
    if (pending || !canManageAccounts() || !canRemoveAccount()) return;
    const approved = await confirmDialog(isAdmin() ? `Remove access for ${account.name || account.email}?` :
      `Remove ${account.name || account.email} from your courses? Their other course access stays unchanged.`,
      { title: isAdmin() ? 'Remove account' : 'Remove student access', okLabel: 'Remove access', danger: true });
    if (!approved || pending || !canManageAccounts() || !canRemoveAccount() || selectedAccount()?.email !== account.email) return;
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_remove_account', { p_email: account.email });
        if (error) throw error;
        if (account.email === S.access?.email) { baseline = ''; window.location.reload(); return true; }
        if (isAdmin()) {
          accounts = accounts.filter(item => item.email !== account.email);
          selectedEmail = roleGroups.flatMap(group => accounts.filter(item => group.roles.includes(item.role)))[0]?.email || null;
        } else {
          account.assignments = [];
        }
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
