// Account management uses server-authorized RPCs. These controls are presentation only;
// course and account permissions are also enforced by the database.
(function () {
  'use strict';

  let accounts = [];
  let courses = [];
  let selectedEmail = null;
  let baseline = '';
  let pending = null;
  let viewSequence = 0;
  const roleLabels = { global_admin: 'Global admin', admin: 'Admin', lecturer: 'Lecturer', student: 'Student / TA' };

  function isGlobalAdmin() { return S.access?.role === 'global_admin'; }
  function screen() { return document.getElementById('access-settings'); }
  function archiveFlag(value) { return value === true || value === 'true' || value === 1 || value === '1'; }
  function courseKey(course) { return JSON.stringify([course.sheet_name, archiveFlag(course.is_archive)]); }
  function selectedAccount() { return accounts.find(account => account.email === selectedEmail) || null; }
  function isLocked() { return selectedAccount()?.role === 'global_admin'; }

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
    const pageSize = 1000;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await sb.from('course_rows').select('sheet_name,is_archive,b,c')
        .eq('type', 'metadata').order('sheet_name').order('is_archive').order('row_uid')
        .range(start, start + pageSize - 1);
      if (error) throw error;
      for (const row of data || []) {
        const key = courseKey(row);
        if (!map.has(key)) map.set(key, { sheet_name: row.sheet_name, is_archive: archiveFlag(row.is_archive) });
        const field = String(row.b || '').trim().toLowerCase();
        if (['code', 'title', 'semester', 'year'].includes(field)) map.get(key)[field] = String(row.c || '').trim();
      }
      if (!data || data.length < pageSize) break;
    }
    return [...map.values()].sort((a, b) => Number(a.is_archive) - Number(b.is_archive) ||
      (a.code || a.sheet_name).localeCompare(b.code || b.sheet_name, undefined, { numeric: true }) ||
      (b.year || '').localeCompare(a.year || '') || a.sheet_name.localeCompare(b.sheet_name));
  }

  async function readAccounts() {
    const { data, error } = await sb.rpc('teaching_list_accounts');
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('The account list could not be loaded.');
    return data.map(account => ({ ...account, assignments: Array.isArray(account.assignments) ? account.assignments : [] }))
      .sort((a, b) => Number(b.role === 'global_admin') - Number(a.role === 'global_admin') ||
        (a.name || a.email).localeCompare(b.name || b.email));
  }

  window.openAccessSettings = async function () {
    if (!isGlobalAdmin()) { toast('Only the global admin can manage accounts.', 'err'); return; }
    if (!(await confirmLeaveIfDirty())) return;
    if (typeof closeInlineEdit === 'function') closeInlineEdit(true);
    S.course = null;
    S.isArchive = false;
    S.section = 'access';
    document.querySelectorAll('.course-btn').forEach(button => button.classList.remove('active'));
    if (window.innerWidth <= 768 && document.getElementById('sidebar')?.classList.contains('mobile-open')) toggleSidebar();
    const sequence = ++viewSequence;
    document.getElementById('main-area').innerHTML = `
      <section id="access-settings" class="access-settings" aria-labelledby="access-title">
        <div class="access-heading"><div><h2 id="access-title">Accounts &amp; course access</h2>
          <p>Manage your teaching team and their course permissions.</p></div></div>
        <p class="access-status" role="status">Loading accounts and courses…</p>
      </section>`;
    const container = screen();
    baseline = '';
    renderAccessControls();
    try {
      const results = await Promise.all([readAccounts(), readCourses()]);
      if (sequence !== viewSequence || screen() !== container || !isGlobalAdmin()) return;
      [accounts, courses] = results;
      selectedEmail = accounts.some(account => account.email === selectedEmail) ? selectedEmail : accounts[0]?.email || null;
      renderSettings();
    } catch (error) {
      if (sequence !== viewSequence || screen() !== container) return;
      const status = container.querySelector('.access-status');
      status.setAttribute('role', 'alert');
      status.textContent = 'Unable to load settings. ' + (error.message || 'Please try again.');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', openAccessSettings);
      container.appendChild(retry);
    }
  };

  function accountSummary(account) {
    if (account.role === 'global_admin' || account.role === 'admin') return 'All courses';
    const count = account.assignments.length;
    return count ? `${count} assigned course${count === 1 ? '' : 's'}` : 'No courses assigned';
  }

  function renderSettings() {
    const container = screen();
    if (!container) return;
    container.innerHTML = `
      <div class="access-heading"><div><h2 id="access-title">Accounts &amp; course access</h2>
        <p>Manage your teaching team and their course permissions.</p></div>
        <button type="button" id="access-add-account"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Add account</button>
      </div>
      <div class="access-layout">
        <aside class="access-card access-account-list" aria-labelledby="access-accounts-title">
          <h3 id="access-accounts-title">Accounts <span class="access-count">${accounts.length}</span></h3>
          <label class="access-search-label" for="access-account-search">Find an account</label>
          <input type="search" id="access-account-search" placeholder="Search name or email" autocomplete="off">
          <div id="access-accounts">${accounts.map((account, index) => `
            <button type="button" class="access-account${account.email === selectedEmail ? ' is-selected' : ''}"
              data-account-index="${index}" aria-pressed="${account.email === selectedEmail}">
              <span class="access-account-name">${x(account.name || account.email)}</span>
              ${account.name ? `<span class="access-account-email">${x(account.email)}</span>` : ''}
              <span class="access-account-meta"><span>${x(roleLabels[account.role] || account.role)}</span><span>${x(accountSummary(account))}</span></span>
            </button>`).join('')}
          </div>
          <p id="access-no-matches" class="access-hint" hidden>No matching accounts.</p>
          ${!accounts.length ? '<p class="access-hint">Add an account to give someone course access.</p>' : ''}
        </aside>
        <div id="access-editor" class="access-card"></div>
      </div>`;
    container.querySelector('#access-add-account').addEventListener('click', () => chooseAccount(null));
    container.querySelector('#access-accounts').addEventListener('click', event => {
      const button = event.target.closest('[data-account-index]');
      if (button) chooseAccount(accounts[Number(button.dataset.accountIndex)].email);
    });
    container.querySelector('#access-account-search').addEventListener('input', event => {
      const term = event.target.value.trim().toLocaleLowerCase();
      let visible = 0;
      container.querySelectorAll('[data-account-index]').forEach(button => {
        const account = accounts[Number(button.dataset.accountIndex)];
        button.hidden = !`${account.name || ''} ${account.email}`.toLocaleLowerCase().includes(term);
        if (!button.hidden) visible++;
      });
      container.querySelector('#access-no-matches').hidden = visible > 0 || !accounts.length;
    });
    renderEditor();
  }

  async function chooseAccount(email) {
    if (pending || email === selectedEmail) return;
    if (!(await confirmLeaveAccessSettings())) return;
    selectedEmail = email;
    screen()?.querySelectorAll('[data-account-index]').forEach(button => {
      const selected = accounts[Number(button.dataset.accountIndex)].email === email;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderEditor();
    document.getElementById(email ? 'access-name' : 'access-email')?.focus();
  }

  function renderEditor() {
    const editor = document.getElementById('access-editor');
    if (!editor) return;
    const account = selectedAccount();
    const locked = isLocked();
    const assigned = new Set((account?.assignments || []).map(courseKey));
    editor.innerHTML = `
      <h3>${account ? 'Account details' : 'Add account'}</h3>
      ${locked ? '<p class="access-notice">The global admin manages all accounts and courses. This account is protected.</p>' : ''}
      <form id="access-account-form">
        <fieldset id="access-account-fields"${locked ? ' disabled' : ''}>
          <div class="access-field"><label for="access-email">Sign-in email</label>
            <input id="access-email" name="email" type="email" required autocomplete="off" maxlength="320"
              value="${x(account?.email || '')}"${account ? ' readonly' : ''} aria-describedby="access-email-hint">
            <p id="access-email-hint" class="access-hint">Use the email address they sign in with.</p></div>
          <div class="access-field"><label for="access-name">Account name</label>
            <input id="access-name" name="name" type="text" required autocomplete="off" maxlength="200"
              value="${x(account?.name || '')}" aria-describedby="access-name-hint">
            <p id="access-name-hint" class="access-hint">Use the name on their signed-in account.</p></div>
          <div class="access-field"><label for="access-role">Role</label>
            <select id="access-role" name="role" aria-describedby="access-role-hint">
              ${locked ? '<option value="global_admin">Global admin</option>' : ['admin', 'lecturer', 'student'].map(role =>
                `<option value="${role}"${(account?.role || 'lecturer') === role ? ' selected' : ''}>${roleLabels[role]}</option>`).join('')}
            </select><p id="access-role-hint" class="access-hint"></p></div>
          <fieldset id="access-course-fields" class="access-courses">
            <legend>Assigned courses</legend>
            <p id="access-course-hint" class="access-hint"></p>
            <div id="access-course-choices">${courses.length ? courses.map((course, index) => `
              <label class="access-course-option"><input type="checkbox" name="course" data-course-index="${index}"${assigned.has(courseKey(course)) ? ' checked' : ''}>
                <span><strong>${x([course.code, course.title].filter(Boolean).join(' · ') || course.sheet_name)}</strong>
                  <span class="access-course-term">${x([course.semester, course.year, course.is_archive ? 'Archived' : 'Active'].filter(Boolean).join(' · '))}</span>
                </span></label>`).join('') : '<p class="access-hint">No courses are available yet.</p>'}
            </div>
          </fieldset>
        </fieldset>
        <p id="access-form-status" class="access-form-status" role="status" aria-live="polite"></p>
        ${locked ? '' : `<div class="access-form-actions">
          <button type="submit" id="access-save">${account ? 'Save changes' : 'Add account'}</button>
          ${account ? '<button type="button" id="access-remove" class="btn-secondary access-remove">Remove access</button>' : ''}
          <span id="access-unsaved" class="access-hint" hidden>Unsaved changes</span>
        </div>`}
      </form>`;
    editor.querySelector('#access-account-form').addEventListener('submit', event => { event.preventDefault(); saveAccessAccount(); });
    editor.querySelector('#access-role').addEventListener('change', updateRoleFields);
    editor.querySelector('#access-account-form').addEventListener('input', updateDirtyIndicator);
    editor.querySelector('#access-account-form').addEventListener('change', updateDirtyIndicator);
    editor.querySelector('#access-remove')?.addEventListener('click', removeAccount);
    updateRoleFields();
    baseline = formFingerprint();
    updateDirtyIndicator();
  }

  function updateRoleFields() {
    const role = document.getElementById('access-role')?.value;
    if (!role) return;
    const unrestricted = role === 'admin' || role === 'global_admin';
    document.getElementById('access-role-hint').textContent = {
      global_admin: 'Full access to every course and account settings.',
      admin: 'Full access to every course, including creating, archiving, restoring, and deleting courses.',
      lecturer: 'Can edit assigned courses and archive them. Course Identity and Dates are read-only. Only their matching professor profile can be edited.',
      student: 'Can edit Modules, Projects, and Announcements in assigned courses. Other tabs are view-only. Cannot create, archive, restore, or delete courses.'
    }[role] || '';
    document.getElementById('access-course-fields').disabled = unrestricted || !!pending;
    document.getElementById('access-course-choices').hidden = unrestricted;
    document.getElementById('access-course-hint').textContent = unrestricted
      ? 'Access to all active and archived courses is automatic, including future courses.'
      : 'Select the courses this account can work on. With no assignments, they cannot open a course in the control panel.';
  }

  function formValues() {
    const form = document.getElementById('access-account-form');
    if (!form) return null;
    const role = form.querySelector('#access-role').value;
    const assignments = role === 'admin' || role === 'global_admin' ? [] :
      [...form.querySelectorAll('[data-course-index]:checked')].map(input => courses[Number(input.dataset.courseIndex)])
        .filter(Boolean).map(course => ({ sheet_name: course.sheet_name, is_archive: course.is_archive }));
    return {
      email: form.querySelector('#access-email').value.trim().toLowerCase(),
      name: form.querySelector('#access-name').value.trim(),
      role,
      assignments
    };
  }

  function formFingerprint() { return JSON.stringify(formValues()); }
  window.accessSettingsDirty = function () { return !!screen() && !!baseline && !isLocked() && baseline !== formFingerprint(); };
  function updateDirtyIndicator() {
    const indicator = document.getElementById('access-unsaved');
    if (indicator) indicator.hidden = !accessSettingsDirty();
  }

  window.confirmLeaveAccessSettings = async function () {
    if (pending) await pending;
    if (!accessSettingsDirty()) return true;
    const choice = await confirmDialog('You have unsaved account changes.',
      { title: 'Save changes?', okLabel: 'Save', okIcon: 'fa-floppy-disk', altLabel: 'Discard' });
    if (choice === true) return await saveAccessAccount();
    if (choice === 'alt') { baseline = formFingerprint(); return true; }
    return false;
  };

  function setPending(value) {
    const container = screen();
    if (!container) return;
    container.setAttribute('aria-busy', String(value));
    container.querySelectorAll('button').forEach(button => { button.disabled = value; });
    const fields = document.getElementById('access-account-fields');
    if (fields) fields.disabled = value || isLocked();
    const save = document.getElementById('access-save');
    if (save) save.textContent = value ? 'Saving…' : selectedAccount() ? 'Save changes' : 'Add account';
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
    if (!isGlobalAdmin() || isLocked()) { toast('This account cannot be changed.', 'err'); return false; }
    const form = document.getElementById('access-account-form');
    if (!form || !form.reportValidity()) return false;
    const values = formValues();
    if (!values.name) { formStatus('Enter the name on their signed-in account.', true); return false; }
    if (!['admin', 'lecturer', 'student'].includes(values.role)) return false;
    if (!selectedEmail && accounts.some(account => account.email.toLowerCase() === values.email)) {
      formStatus('This account already exists. Select it from the account list to change its access.', true);
      return false;
    }
    formStatus('', false);
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_set_account', {
          p_email: values.email, p_name: values.name, p_role: values.role, p_assignments: values.assignments
        });
        if (error) throw error;
        baseline = formFingerprint();
        selectedEmail = values.email;
        // Keep the successful write visible even if a follow-up read is interrupted.
        accounts = accounts.filter(account => account.email !== values.email).concat(values);
        if (screen()) renderSettings();
        toast('Account access saved.', 'ok');
        return true;
      } catch (error) {
        formStatus('Could not save account access. ' + (error.message || 'Please try again.'), true);
        return false;
      }
    })();
    setPending(true);
    try { return await pending; }
    finally { pending = null; setPending(false); updateDirtyIndicator(); }
  };

  async function removeAccount() {
    const account = selectedAccount();
    if (pending || !isGlobalAdmin() || !account || isLocked()) return;
    const approved = await confirmDialog(`Remove control panel access for ${account.name || account.email} (${account.email})?`,
      { title: 'Remove account access?', okLabel: 'Remove access', danger: true });
    if (!approved || pending || !isGlobalAdmin() || selectedAccount()?.email !== account.email) return;
    pending = (async () => {
      try {
        const { error } = await sb.rpc('teaching_remove_account', { p_email: account.email });
        if (error) throw error;
        accounts = accounts.filter(item => item.email !== account.email);
        selectedEmail = accounts[0]?.email || null;
        baseline = '';
        if (screen()) renderSettings();
        toast('Account access removed.', 'ok');
        return true;
      } catch (error) {
        formStatus('Could not remove account access. ' + (error.message || 'Please try again.'), true);
        return false;
      }
    })();
    setPending(true);
    try { await pending; }
    finally { pending = null; setPending(false); }
  }
})();
