// Config
let isAdmin = false;
let isGlobalAdmin = false;
let adminCourses = [];
const CLIENT_ID = '740588046540-npg0crodtcuinveu6bua9rd6c3hb2s1m.apps.googleusercontent.com';
const LOGS_SPREADSHEET_ID = '1AvVrBRt4_3GJTVMmFph6UsUsplV9h8jXU93n1ezbMME';
const LOGS_STORAGE_KEY = 'attendance_logs';
const BRAIN_URL = 'https://script.google.com/macros/s/AKfycbw080ZrgaSS2oQCpcrfY_T5Ko_QesXvucUi3h1Odp4SLfE2SF28b8BCnsXmR4W0B_A5hQ/exec';

// App state
let courseData = {};
let isScanning = false;
let nfcSupported = false;
let nfcReader = null;
let filter = '';
let dbFilter = '';
let databaseMap = {}; // Map UIDs to {name, email} objects
let uidToPrimaryUidMap = {};
let currentSort = localStorage.getItem('logs_sort') || 'date-desc';
let currentDbSort = localStorage.getItem('db_sort') || 'name-asc';
let soundEnabled = true; // Sound effects enabled by default
let isSignedIn = false; // User is signed in
let currentUser = null; // Current user info
let tokenClient = null; // Google OAuth token client
let currentCourse = ''; // Currently selected course
let availableCourses = []; // Will be populated from spreadsheet
let isOnline = navigator.onLine;
let isSyncing = false;
let isInitializing = true;
let isChangingCourses = false;
let pendingNotifications = [];
let criticalErrorsOnly = true;
let initialSignIn = true; // Flag to track initial sign-in
let lastScannedUID = null;
let courseIDMap = {}; // Object to store course information - name to ID mapping
let sheetNameMap = {}; // Maps display names to actual sheet names
let excusedUIDs = new Set();
let loadingTasks = new Set(['gapi', 'auth', 'courses', 'database']);
let cooldownUIDs = new Set();
let nfcAbortController = null;
let initialisedCourses = new Set();
let initialPullDone = false;
let guestCourse = null; // Track the course global admin is "visiting" but not officially admin of
let scanClockInterval = null;
let globalNotificationCount = 0;

// Auto syncing
let autoSyncInterval = null;
let autoSyncEnabled = true;
let lastSyncTime = 0;
let pendingChanges = false;
let syncAttempts = 0;
const MAX_SYNC_ATTEMPTS = 5;
const SYNC_INTERVAL = 60000; // Auto-sync every 60 seconds
const SYNC_RETRY_INTERVAL = 15000; // Retry failed syncs after 15 seconds
const ADMIN_REFRESH_INTERVAL = 30000; // Auto-refresh admin dashboard every 30 seconds
let adminAutoRefreshInterval = null;
let activeRequests = new Map(); // Track active requests per course
let studentLogCache = {};
let currentRequestId = 0; // Global request counter
let databaseLoadPromise = null;
let databaseResolve = null;
let databaseCache = null;
let databaseCacheTime = 0;
const DATABASE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let initInProgress = false;
let lastNotificationKey = '';
let lastNotificationTime = 0;
let isBulkMode = false;
let selectedLogIds = new Set(); // Stores IDs of selected rows
let lastCheckedLogId = null; // For Shift+Click logic
let activeSessionCategory = null;
let activeSessionGroup = null;
let currentCourseSections = {}; // Parsed structure

// Pagination State
let logsCurrentPage = 1;
let dbCurrentPage = 1;
const ITEMS_PER_PAGE = 25; // Number of items per page

// DOM Elements
let tabs, tabContents, importExcelBtn, excelInput, filterInput, sortSelect,
    dbFilterInput, importBtn, importInput, exportBtn, clearBtn, addLogBtn,
    addEntryBtn, exportExcelBtn, clearDbBtn, logsTbody, databaseTbody,
    emptyLogs, emptyDatabase, filteredCount, dbEntryCount, totalScans,
    lastScan, databaseStatus, notificationArea, successSound, errorSound,
    syncBtn, syncStatus, syncText, loginBtn, logoutBtn, loginContainer,
    userContainer, userName, userAvatar, scanHistoryModule;

// This constant can stay here
const SCOPES = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/spreadsheets";

function checkLoadingCompletion() {
    if (loadingTasks.size === 0) {
        setTimeout(showMainContent, 100); // Short delay for rendering
    } else {
    }
}

// --- Dialog Scroll Fix Helpers ---
let dialogOpenCount = 0; // Track nested dialogs

// Detect if device supports touch (for virtual keyboard handling)
function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function openDialogMode() {
    dialogOpenCount++;
    if (dialogOpenCount === 1) {
        document.body.classList.add('dialog-open');
        // Reset burn-in transform to prevent dialog offset
        document.body.style.transform = '';
    }
}


function closeDialogMode() {
    dialogOpenCount = Math.max(0, dialogOpenCount - 1);
    if (dialogOpenCount === 0) {
        document.body.classList.remove('dialog-open');
    }
}

// Emergency reset function - call this if scroll gets stuck
function resetDialogMode() {
    dialogOpenCount = 0;
    document.body.classList.remove('dialog-open');
}

// Prevent auto-scroll on focus for non-touch devices
// Touch devices need scroll for virtual keyboard visibility
document.addEventListener('focusin', function (e) {
    // Only prevent scroll on non-touch devices when dialog is open
    if (!isTouchDevice() && dialogOpenCount > 0) {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
            // Check if the element is inside a dialog
            if (target.closest('.dialog')) {
                // Prevent the browser's default scroll-into-view behavior
                e.preventDefault();
                // Focus without scrolling
                target.focus({ preventScroll: true });
            }
        }
    }
}, true); // Use capture phase to intercept early



/**
* Helper to get/create the persistent Device ID
*/
function getDeviceFingerprint() {
    let deviceId = localStorage.getItem('attendance_device_id');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('attendance_device_id', deviceId);
    }
    return deviceId;
}

// Helper to decode the Google ID Token
// Helper to decode the Google ID Token
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

function handleOneTapResponse(response) {
    const responsePayload = parseJwt(response.credential);
    console.log("One Tap Auto-Sign-In Detected for:", responsePayload.email);

    const loginContainer = document.getElementById('login-container');
    const loginBtn = document.getElementById('login-btn');

    // 1. UI State: Show "Verifying" spinner
    if (loginBtn) {
        loginBtn.dataset.originalText = loginBtn.innerHTML;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verifying...';
        loginBtn.style.backgroundColor = "#ccc";
        loginBtn.style.cursor = "wait";
    }

    // 2. Request Access Token SILENTLY
    // This prevents the "Flash/Popup" issue.
    if (tokenClient) {
        tokenClient.requestAccessToken({
            prompt: 'none',
            login_hint: responsePayload.email
        });
    } else {
        console.error("Token Client not initialized.");
        // Reset UI if GAPI failed
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = loginBtn.dataset.originalText || '<i class="fa-brands fa-google"></i> Sign in';
            loginBtn.style.backgroundColor = "";
            loginBtn.style.cursor = "pointer";
        }
    }
}

/**
* Parses "Theory A, Theory B, Lab" into { Theory: ['A', 'B'], Lab: [] }
*/
function parseAvailableSections(sectionString) {
    if (!sectionString) return {};
    const map = {};
    const items = sectionString.split(',').map(s => s.trim()).filter(Boolean);

    items.forEach(item => {
        // Split "Theory A" -> ["Theory", "A"]
        // Split "Lab" -> ["Lab"]
        const parts = item.split(' ');
        const cat = parts[0];
        const grp = parts[1] || ''; // Empty string if no group

        if (!map[cat]) map[cat] = [];
        if (grp && !map[cat].includes(grp)) map[cat].push(grp);
    });
    return map;
}

/**
 * Shows a dialog to Add or Edit a Staff Member.
 */
function showStaffEditorDialog(staffData = null) {
    const isEdit = !!staffData;
    const title = isEdit ? 'Edit Staff Member' : 'Add Staff Member';
    const icon = isEdit ? 'fa-user-pen' : 'fa-user-plus';
    const btnText = isEdit ? 'Save Changes' : 'Add Staff';

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    dialogBackdrop.style.zIndex = "10010";

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');

    let activeNfcSession = { controller: null, button: null };

    const nameVal = isEdit ? staffData.name : '';
    const emailVal = isEdit ? staffData.email : '';
    const uidVal = isEdit ? staffData.uid : '';

    // Default to 'Lecturer' if adding new
    const roleVal = isEdit ? staffData.role : 'Lecturer';

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid ${icon}"></i> ${title}</h3>
        <div class="dialog-content">
            
            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name*</label>
                <input type="text" id="staff-name" class="form-control" placeholder="Full Name" value="${escapeHtml(nameVal)}">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email*</label>
                <input type="email" id="staff-email" class="form-control" placeholder="nsurname@epoka.edu.al" value="${escapeHtml(emailVal)}">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-user-tie"></i> Role</label>
                <select id="staff-role" class="form-control">
                    <option value="Global" ${roleVal === 'Global' ? 'selected' : ''}>Administrator</option>
                    <option value="Lecturer" ${roleVal === 'Lecturer' ? 'selected' : ''}>Lecturer</option>
                    <option value="Student" ${roleVal === 'Student' ? 'selected' : ''}>Student</option>
                </select>
            </div>
            
            <div style="margin-left:115px; margin-bottom:15px; font-size:0.85em; color:#666; line-height:1.4;">
                <strong>Lecturer:</strong> Can login on trusted devices only and manage their courses.<br>
                <strong>Student:</strong> Can login on any device and only see their attendance.<br>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID*</label>
                <div class="admin-tool-bar" style="padding:0; border:none; background:transparent;"> 
                    <div class="admin-input-wrapper" style="margin:0;">
                        <input type="text" id="staff-uid" class="form-control" placeholder="AB:CD:12:34" value="${escapeHtml(uidVal)}">
                        ${nfcSupported ? '<button class="btn-blue btn-icon btn-sm scan-staff-uid-btn" title="Scan UID"><i class="fa-solid fa-wifi"></i></button>' : ''}
                    </div>
                </div>
            </div>
            
            <div id="staff-nfc-status" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-staff-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="save-staff-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${btnText}</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidInput = dialog.querySelector('#staff-uid');
    const statusContainer = dialog.querySelector('#staff-nfc-status');
    const scanBtn = dialog.querySelector('.scan-staff-uid-btn');

    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            if (activeNfcSession.button === scanBtn) {
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                activeNfcSession = { controller: null, button: null };
                scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                statusContainer.innerHTML = '';
            } else {
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                const controller = startNfcForInputDialog(uidInput, statusContainer, scanBtn);
                activeNfcSession = { controller, button: scanBtn };
            }
        });
    }

    const close = () => {
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        document.body.removeChild(dialogBackdrop);
    };
    dialog.querySelector('#cancel-staff-btn').onclick = close;

    dialog.querySelector('#save-staff-btn').onclick = async (e) => {
        const name = document.getElementById('staff-name').value.trim();
        const email = document.getElementById('staff-email').value.trim();
        const uid = document.getElementById('staff-uid').value.trim();
        const role = document.getElementById('staff-role').value;
        const btn = e.target;

        if (!name || !email || !uid) {
            showNotification('error', 'Missing Info', 'All fields are required.');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

        try {
            const payload = {
                actionType: isEdit ? 'edit' : 'add',
                name, email, uid, role
            };
            if (isEdit) payload.rowIndex = staffData.rowIndex;

            await callWebApp('manageStaff_Admin', payload, 'POST');

            showNotification('success', 'Success', `Staff member ${isEdit ? 'updated' : 'added'}.`);

            document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
            closeDialogMode();
            showGlobalSettingsDialog();

            setTimeout(() => {
                const staffTab = document.querySelector('.settings-tab-btn[data-target="sect-staff"]');
                if (staffTab) staffTab.click();
            }, 100);

        } catch (err) {
            showNotification('error', 'Error', err.message);
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> ${btnText}`;
        }
    };
}

/**
* Generates HTML options for a Session Select dropdown based on the current course.
* @param {string} selectedValue - The value to pre-select (e.g., "Theory A").
* @returns {string} HTML string of <option> tags.
*/
function generateSessionOptions(selectedValue = '') {
    if (!currentCourse || !courseInfoMap[currentCourse]) return '<option value="Default">Default</option>';

    const rawSections = courseInfoMap[currentCourse].availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections); // Uses your existing parser
    const categories = Object.keys(sectionsMap);

    if (categories.length === 0) return '<option value="Default">Default</option>';

    let html = '';

    categories.forEach(cat => {
        const groups = sectionsMap[cat] || [];
        if (groups.length > 0) {
            groups.forEach(grp => {
                const val = `${cat} ${grp}`;
                const isSel = val === selectedValue ? 'selected' : '';
                html += `<option value="${val}" ${isSel}>${val}</option>`;
            });
        } else {
            // Category with no specific groups
            const isSel = cat === selectedValue ? 'selected' : '';
            html += `<option value="${cat}" ${isSel}>${cat}</option>`;
        }
    });

    return html;
}

/**
* Generates Session Toggle Buttons.
* @param {string} prefix - ID prefix.
* @param {boolean} includeInherit - Show "Same as previous".
* @param {boolean} isCompact - Reduces padding/size for dialogs.
*/
function renderSessionControls(courseName) {
    const controls = document.getElementById('session-controls');

    // Hide immediately if not admin
    if (!isAdmin) {
        if (controls) controls.style.display = 'none';
        return;
    }

    const catGroup = document.getElementById('session-category-group');

    // Safety check
    if (!courseInfoMap || !courseInfoMap[courseName]) {
        controls.style.display = 'none';
        return;
    }

    const rawSections = courseInfoMap[courseName].availableSections || '';
    currentCourseSections = parseAvailableSections(rawSections);
    const categories = Object.keys(currentCourseSections);

    if (categories.length === 0) {
        controls.style.display = 'none';
        activeSessionCategory = null;
        activeSessionGroup = null;
        return;
    }

    // 1. Auto-select Category Logic
    if (!activeSessionCategory || !categories.includes(activeSessionCategory)) {
        activeSessionCategory = categories[0];
        activeSessionGroup = null; // Reset group
    }

    // 2. Render Categories
    catGroup.innerHTML = '';
    const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };

    categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        const iconClass = icons[lowerCat] || 'fa-tag';

        const btn = document.createElement('div');
        btn.className = 'course-button';
        btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}`;

        btn.onclick = () => selectSessionCategory(cat);

        if (activeSessionCategory === cat) btn.classList.add('active');
        catGroup.appendChild(btn);
    });

    // 3. Render Groups for the active category
    renderGroupsForCategory(activeSessionCategory);

    // 4. SMART VISIBILITY CHECK
    const showCategories = categories.length > 1;
    catGroup.style.display = showCategories ? 'flex' : 'none';

    const grpContainer = document.getElementById('session-group-container');
    const showGroups = grpContainer.style.display !== 'none';

    controls.style.display = (showCategories || showGroups) ? 'flex' : 'none';
}

/**
* Generates Session Toggle Buttons.
* @param {string} prefix - ID prefix.
* @param {boolean} includeInherit - Show "Same as previous".
* @param {boolean} isCompact - Reduces padding/size for dialogs.
*/
function renderSessionSelectorHTML(prefix, includeInherit = false, isCompact = false) {
    if (!currentCourse || !courseInfoMap[currentCourse]) return '';

    const rawSections = courseInfoMap[currentCourse].availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections);
    const categories = Object.keys(sectionsMap);

    if (categories.length === 0) return '';

    // Compact styles
    const btnStyle = isCompact ? 'padding: 8px 12px; font-size: 0.9em; min-width: auto;' : 'flex:1;';
    const rowStyle = isCompact ? 'margin-bottom:8px; justify-content:flex-start; gap:8px;' : 'margin-bottom:8px; justify-content:flex-start; gap:5px;';

    // 1. Inherit Button
    let inheritHtml = '';
    if (includeInherit) {
        inheritHtml = `
        <div class="course-buttons-container" style="${rowStyle}">
            <div class="course-button active" id="${prefix}-btn-inherit" data-val="INHERIT" style="${btnStyle} width:100%; text-align:center;">
                <i class="fa-solid fa-clock-rotate-left"></i>&nbsp; ${prefix === 'bulk' && includeInherit ? 'Latest / Same as Previous' : 'Same as Previous'}
            </div>
        </div>`;
    }

    // 2. Category Row
    let catHtml = '';
    const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };

    categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        const iconClass = icons[lowerCat] || 'fa-tag';
        const isActive = !includeInherit && cat === categories[0] ? 'active' : '';

        catHtml += `<div class="course-button ${isActive}" data-type="category" data-val="${cat}" style="${btnStyle}">
            <i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}
        </div>`;
    });

    // 3. Group Row
    let groupRowsHtml = '';
    categories.forEach(cat => {
        const groups = sectionsMap[cat] || [];
        const isVisible = !includeInherit && cat === categories[0] ? 'flex' : 'none';

        if (groups.length > 0) {
            let btns = '';
            groups.forEach((grp, idx) => {
                const isActive = (!includeInherit && idx === 0) ? 'active' : '';
                // Groups are always small squares
                btns += `<div class="course-button ${isActive}" data-type="group" data-val="${grp}" style="min-width:40px; padding:8px 0; justify-content:center;"><b>${grp}</b></div>`;
            });

            groupRowsHtml += `<div class="course-buttons-container group-row" id="${prefix}-groups-${cat}" style="display:${isVisible}; ${rowStyle}">${btns}</div>`;
        }
    });

    return `
    <div id="${prefix}-session-wrapper" style="margin-top:5px;">
        <input type="hidden" id="${prefix}-selected-session" value="${includeInherit ? 'INHERIT' : categories[0] + ' ' + (sectionsMap[categories[0]]?.[0] || '')}">
        ${inheritHtml}
        <div class="course-buttons-container" id="${prefix}-cat-row" style="${rowStyle}">
            ${catHtml}
        </div>
        ${groupRowsHtml}
    </div>`;
}

/**
 * Attaches event listeners to the generated Session Selector.
 * @param {string} containerIdPrefix - The prefix used in renderSessionSelectorHTML.
 * @param {Object} sectionsMap - The parsed sections object.
 */
function setupSessionToggleListeners(containerIdPrefix, sectionsMap) {
    const wrapper = document.getElementById(`${containerIdPrefix}-session-wrapper`);
    if (!wrapper) return;

    const input = document.getElementById(`${containerIdPrefix}-selected-session`);
    const inheritBtn = document.getElementById(`${containerIdPrefix}-btn-inherit`);
    const catRow = document.getElementById(`${containerIdPrefix}-cat-row`);
    const groupRows = wrapper.querySelectorAll('.group-row');

    const updateValue = () => {
        if (inheritBtn && inheritBtn.classList.contains('active')) {
            input.value = 'INHERIT';
            return;
        }

        const activeCat = catRow.querySelector('.course-button.active');
        if (!activeCat) {
            input.value = '';
            return;
        }

        const catVal = activeCat.dataset.val;
        const activeGroupRow = document.getElementById(`${containerIdPrefix}-groups-${catVal}`);
        let groupVal = '';

        if (activeGroupRow) {
            const activeGrp = activeGroupRow.querySelector('.course-button.active');
            if (activeGrp) groupVal = activeGrp.dataset.val;
        }

        // Construct session string (e.g., "Theory A" or just "Theory")
        input.value = groupVal ? `${catVal} ${groupVal}` : catVal;
    };

    // 1. Inherit Click
    if (inheritBtn) {
        inheritBtn.addEventListener('click', () => {
            inheritBtn.classList.add('active');
            // Deactivate all categories
            catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            // Hide all groups
            groupRows.forEach(r => r.style.display = 'none');
            updateValue();
        });
    }

    // 2. Category Click
    catRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;

        // Activate Category
        if (inheritBtn) inheritBtn.classList.remove('active');
        catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const catVal = btn.dataset.val;

        // Show relevant Group Row, hide others
        groupRows.forEach(row => {
            if (row.id === `${containerIdPrefix}-groups-${catVal}`) {
                row.style.display = 'flex';
                // Auto-select first group if none active
                if (!row.querySelector('.course-button.active')) {
                    const first = row.querySelector('.course-button');
                    if (first) first.classList.add('active');
                }
            } else {
                row.style.display = 'none';
            }
        });
        updateValue();
    });

    // 3. Group Click
    groupRows.forEach(row => {
        row.addEventListener('click', (e) => {
            const btn = e.target.closest('.course-button');
            if (!btn) return;

            row.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateValue();
        });
    });
}

/**
 * Attaches event listeners to the generated Session Selector.
 * @param {string} containerIdPrefix - The prefix used in renderSessionSelectorHTML.
 * @param {Object} sectionsMap - The parsed sections object.
 */
function setupSessionToggleListeners(containerIdPrefix, sectionsMap) {
    const wrapper = document.getElementById(`${containerIdPrefix}-session-wrapper`);
    if (!wrapper) return;

    const input = document.getElementById(`${containerIdPrefix}-selected-session`);
    const inheritBtn = document.getElementById(`${containerIdPrefix}-btn-inherit`);
    const catRow = document.getElementById(`${containerIdPrefix}-cat-row`);
    const groupRows = wrapper.querySelectorAll('.group-row');

    const updateValue = () => {
        if (inheritBtn && inheritBtn.classList.contains('active')) {
            input.value = 'INHERIT';
            return;
        }

        const activeCat = catRow.querySelector('.course-button.active');
        if (!activeCat) {
            input.value = '';
            return;
        }

        const catVal = activeCat.dataset.val;
        const activeGroupRow = document.getElementById(`${containerIdPrefix}-groups-${catVal}`);
        let groupVal = '';

        if (activeGroupRow) {
            const activeGrp = activeGroupRow.querySelector('.course-button.active');
            if (activeGrp) groupVal = activeGrp.dataset.val;
        }

        // Construct session string (e.g., "Theory A" or just "Theory")
        input.value = groupVal ? `${catVal} ${groupVal}` : catVal;
    };

    // 1. Inherit Click
    if (inheritBtn) {
        inheritBtn.addEventListener('click', () => {
            inheritBtn.classList.add('active');
            // Deactivate all categories
            catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            // Hide all groups
            groupRows.forEach(r => r.style.display = 'none');
            updateValue();
        });
    }

    // 2. Category Click
    catRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;

        // Activate Category
        if (inheritBtn) inheritBtn.classList.remove('active');
        catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const catVal = btn.dataset.val;

        // Show relevant Group Row, hide others
        groupRows.forEach(row => {
            if (row.id === `${containerIdPrefix}-groups-${catVal}`) {
                row.style.display = 'flex';
                // Auto-select first group if none active
                if (!row.querySelector('.course-button.active')) {
                    const first = row.querySelector('.course-button');
                    if (first) first.classList.add('active');
                }
            } else {
                row.style.display = 'none';
            }
        });
        updateValue();
    });

    // 3. Group Click
    groupRows.forEach(row => {
        row.addEventListener('click', (e) => {
            const btn = e.target.closest('.course-button');
            if (!btn) return;

            row.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateValue();
        });
    });
}

// --- SMART VERTICAL SESSION CONTROLS ---

function renderSessionControls(courseName) {
    const controls = document.getElementById('session-controls');
    const catGroup = document.getElementById('session-category-group');

    // Safety check
    if (!courseInfoMap || !courseInfoMap[courseName]) {
        controls.style.display = 'none';
        return;
    }

    const rawSections = courseInfoMap[courseName].availableSections || '';
    currentCourseSections = parseAvailableSections(rawSections);
    const categories = Object.keys(currentCourseSections);

    if (categories.length === 0) {
        controls.style.display = 'none';
        activeSessionCategory = null;
        activeSessionGroup = null;
        return;
    }

    // 1. Auto-select Category Logic
    // If no category selected, or current one invalid, pick first
    if (!activeSessionCategory || !categories.includes(activeSessionCategory)) {
        activeSessionCategory = categories[0];
        activeSessionGroup = null; // Reset group
    }

    // 2. Render Categories
    catGroup.innerHTML = '';
    const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };

    categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        const iconClass = icons[lowerCat] || 'fa-tag';

        const btn = document.createElement('div');
        btn.className = 'course-button';
        btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}`;

        btn.onclick = () => selectSessionCategory(cat);

        if (activeSessionCategory === cat) btn.classList.add('active');
        catGroup.appendChild(btn);
    });

    // 3. Render Groups for the active category
    renderGroupsForCategory(activeSessionCategory);

    // 4. SMART VISIBILITY CHECK
    // Hide Category Row if only 1 category exists
    const showCategories = categories.length > 1;
    catGroup.style.display = showCategories ? 'flex' : 'none';

    // Group visibility is determined inside renderGroupsForCategory
    const grpContainer = document.getElementById('session-group-container');
    const showGroups = grpContainer.style.display !== 'none';

    // Only show main container if at least one row is visible
    controls.style.display = (showCategories || showGroups) ? 'flex' : 'none';
}

function selectSessionCategory(category) {
    activeSessionCategory = category;
    activeSessionGroup = null; // Reset group

    // Visual Update
    const catGroup = document.getElementById('session-category-group');
    Array.from(catGroup.children).forEach(btn => {
        if (btn.innerText.trim() === category) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    renderGroupsForCategory(category);

    // Re-check parent visibility (Group row might have appeared/disappeared)
    const grpContainer = document.getElementById('session-group-container');
    const categories = Object.keys(currentCourseSections);
    const showCategories = categories.length > 1;
    const showGroups = grpContainer.style.display !== 'none';

    document.getElementById('session-controls').style.display = (showCategories || showGroups) ? 'flex' : 'none';
}

function renderGroupsForCategory(category) {
    const groups = currentCourseSections[category] || [];
    const grpContainer = document.getElementById('session-group-container');

    // 1. Auto-select Group Logic
    if (groups.length > 0) {
        if (!activeSessionGroup || !groups.includes(activeSessionGroup)) {
            activeSessionGroup = groups[0];
        }
    } else {
        activeSessionGroup = null;
    }

    // 2. Render Buttons
    grpContainer.innerHTML = '';

    groups.forEach(grp => {
        const btn = document.createElement('div');
        btn.className = 'course-button';
        btn.innerHTML = `<b>${grp}</b>`;

        btn.onclick = () => selectSessionGroup(grp);

        if (activeSessionGroup === grp) btn.classList.add('active');
        grpContainer.appendChild(btn);
    });

    // 3. SMART VISIBILITY CHECK (Groups)
    // Hide Group Row if <= 1 group exists
    if (groups.length <= 1) {
        grpContainer.style.display = 'none';
    } else {
        grpContainer.style.display = 'flex';
    }
}

function selectSessionGroup(group) {
    activeSessionGroup = group;
    const grpContainer = document.getElementById('session-group-container');
    Array.from(grpContainer.children).forEach(btn => {
        if (btn.innerText.trim() === group) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// --- Absence History Logic ---

// 1. Setup Listener
function setupAbsenceHistory() {
    const historyBtn = document.getElementById('absence-history-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', showAbsenceHistoryDialog);
    }
}


async function showAbsenceHistoryDialog() {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '900px';
    dialog.style.maxHeight = '85vh';
    dialog.setAttribute('role', 'dialog');

    dialog.innerHTML = `
    <div class="settings-modal-header">
        <h3 style="margin:0;"><i class="fa-solid fa-clock-rotate-left"></i> Request History</h3>
        <button id="close-hist-btn" class="btn-icon" style="background:transparent; color:var(--text-color); font-size:1.2em;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="dialog-content" style="overflow-y:auto; padding-top:0;">
        
        <div class="filter-container" style="position:sticky; top:0; background:var(--card-background); z-index:10; padding:10px 0; border-bottom:1px solid #eee;">
            <input type="text" id="hist-search" class="filter-input" placeholder="Search..." style="flex-grow:1;">
            <select id="hist-filter-status" class="sort-dropdown">
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
            </select>
        </div>

        <div id="history-list-container" style="margin-top:15px;">
            <div class="loading-spinner" style="margin:40px auto;"></div>
        </div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // Close Logic
    const close = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    dialog.querySelector('#close-hist-btn').onclick = close;

    // Fetch Data
    try {
        const history = await callWebApp('getAbsenceHistory_Admin', {}, 'POST');
        const container = dialog.querySelector('#history-list-container');

        if (!history || history.length === 0) {
            container.innerHTML = `<div class="empty-logs">No requests found.</div>`;
            return;
        }

        const renderList = () => {
            const searchText = dialog.querySelector('#hist-search').value.toLowerCase();
            const statusFilter = dialog.querySelector('#hist-filter-status').value;

            const filtered = history.filter(req => {
                const matchesText = (req.studentName.toLowerCase().includes(searchText) ||
                    req.course.toLowerCase().includes(searchText));
                const matchesStatus = statusFilter === 'All' || req.status === statusFilter;
                return matchesText && matchesStatus;
            });

            container.innerHTML = filtered.map(req => {
                // Determine status color/icon
                let statusBadge = '';
                if (req.status === 'Approved') statusBadge = `<span style="color:var(--success-color); font-weight:bold; font-size:0.85em; background:#e8f5e9; padding:2px 8px; border-radius:10px;">Approved</span>`;
                else if (req.status === 'Rejected') statusBadge = `<span style="color:var(--danger-color); font-weight:bold; font-size:0.85em; background:#ffebee; padding:2px 8px; border-radius:10px;">Rejected</span>`;
                else statusBadge = `<span style="color:var(--warning-color); font-weight:bold; font-size:0.85em; background:#fff3e0; padding:2px 8px; border-radius:10px;">Pending</span>`;

                // --- Session Badge ---
                let sessionBadge = '';
                if (req.session && req.session !== 'Default') {
                    sessionBadge = `<span style="background:#e3f2fd; color:var(--primary-color); font-weight:700; font-size:0.75em; padding:1px 6px; border-radius:4px; text-transform:uppercase; margin-left:6px;">${escapeHtml(req.session)}</span>`;
                }

                return `
        <div class="request-list-item clickable-hist-row" style="border:1px solid #eee; padding:10px; margin-bottom:8px; border-radius:8px; cursor:pointer;">
            <div style="flex-grow:1;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <strong>${escapeHtml(req.studentName)}</strong>
                    ${statusBadge}
                </div>
                <div style="font-size:0.9em; color:#666; display:flex; align-items:center;">
                    ${escapeHtml(req.course.replace(/_/g, ' '))} ${sessionBadge} 
                    <span style="margin:0 6px;">&bull;</span> 
                    ${escapeHtml(req.absenceDate)}
                </div>
                <div style="font-size:0.85em; opacity:0.7; margin-top:2px;">
                    ${escapeHtml(req.reasonType)}
                </div>
            </div>
        </div>`;
            }).join('');

            // Attach Click Listeners
            container.querySelectorAll('.clickable-hist-row').forEach((row, index) => {
                row.onclick = () => {
                    const req = filtered[index]; // Use filtered array index
                    showPermissionDetailsDialog({
                        requestId: req.requestID,
                        studentName: req.studentName,
                        studentEmail: req.studentEmail,
                        course: req.course,
                        session: req.session, // <--- Pass session
                        absenceDate: req.absenceDate,
                        hours: req.hours,
                        reasonType: req.reasonType,
                        description: req.description,
                        attachmentUrl: req.attachmentUrl
                    }, true); // true = readOnly
                };
            });
        };

        // Initial Render
        renderList();

        // Filter Listeners
        dialog.querySelector('#hist-search').addEventListener('input', renderList);
        dialog.querySelector('#hist-filter-status').addEventListener('change', renderList);

    } catch (e) {
        dialog.querySelector('#history-list-container').innerHTML = `<div class="error-message">Failed to load history: ${e.message}</div>`;
    }
}

/**
* Escapes HTML characters to prevent XSS attacks.
* @param {string} str - The raw string.
* @returns {string} The escaped string safe for innerHTML.
*/
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function renderTableSkeletons() {
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;

    let html = '';
    // Generate 5 skeleton rows
    for (let i = 0; i < 5; i++) {
        html += `
        <tr class="skeleton-row">
            <td><span class="skeleton-bar medium"></span></td> ${isAdmin ? '<td><span class="skeleton-bar short"></span></td>' : ''} <td><span class="skeleton-bar short"></span></td> <td><span class="skeleton-bar medium"></span></td> ${isAdmin ? '<td><span class="skeleton-bar short"></span></td>' : ''} </tr>`;
    }
    tbody.innerHTML = html;

    // Also update the count to "..."
    const countEl = document.getElementById('filtered-count');
    if (countEl) countEl.textContent = '...';
}

/**
* Check admin status from server
*/
async function checkAdminStatus() {
    try {
        const result = await callWebApp('checkAdminStatus', {}, 'POST');

        isAdmin = result.isAdmin;
        isGlobalAdmin = result.isGlobalAdmin;
        adminCourses = result.courses;

        console.log('Admin status:', {
            isAdmin,
            isGlobalAdmin,
            courses: adminCourses
        });

        return result;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return { isAdmin: false, courses: [] };
    }
}

/**
 * Check if user is admin for specific course
 */
function isAdminForCourse(courseName) {
    if (isGlobalAdmin) return true; // Global admins have access to all
    return adminCourses.includes(courseName);
}

/**
 * Finds and removes all data related to this app from localStorage.
 */
function clearAllAppData() {
    const keysToRemove = [];
    // Find all keys used by this application.
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance_') || key.startsWith('gapi_') || key.startsWith('eis_pref_') || ['theme', 'logs_sort', 'db_sort', 'last_active_course'].includes(key)) {
            keysToRemove.push(key);
        }
    }

    // Remove the collected keys.
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
    });

    // Trigger exit animation if cat is visible
    const cat = document.getElementById('cat-companion');
    if (cat && cat.classList.contains('visible')) {
        cat.classList.remove('visible');
        // Wait for animation (500ms) before reloading
        setTimeout(() => {
            window.location.reload();
        }, 500);
    } else {
        // Refresh immediately if no cat
        window.location.reload();
    }
}

/**
 * Normalises a name string for reliable comparison.
 * Converts to lowercase and removes all accents from any character.
 * @param {string} str - The name string to normalise.
 * @returns {string} The normalised name.
 */
function normalizeName(str) {
    if (!str) return '';
    return str
        .toLowerCase() // 1. Make everything lowercase
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // 2. Separate accents from letters, then remove the accents
        .replace(/\s+/g, ' ') // 3. Clean up whitespace
        .trim(); // 4. Trim the ends
}

function updateScanClock() {
    const scanBtn = document.getElementById('scan-button');
    if (!scanBtn || !scanBtn.classList.contains('is-scanning')) return;

    // Get device time
    const now = new Date();
    // Format: 10:45 (or 10:45 PM depending on locale)
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    scanBtn.innerHTML = `
        <div class="scan-time-display">
            <span class="scan-time-digits">${timeString}</span>
            <span class="scan-time-text">Stop scanning</span>
        </div>`;
}

function updateAdminDashboardBar(absencesCount, registrationsCount, isLoading = false) {
    const bar = document.getElementById('admin-dashboard-bar');

    // 1. Force Clean State if not global admin
    if (!isGlobalAdmin) {
        const regView = document.getElementById('pending-registrations-view');
        if (regView) regView.classList.remove('expanded');
    }

    if (!isAdmin || !bar) {
        if (bar) bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';

    if (isLoading) {
        bar.innerHTML = `<div class="action-chip loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking requests...</div>`;
        return;
    }

    let html = '';

    // 2. Generate Chips
    if (absencesCount > 0) {
        const isAbsExpanded = document.getElementById('pending-absences-view')?.classList.contains('expanded') ? 'active' : '';
        html += `
        <div class="action-chip has-items ${isAbsExpanded}" id="chip-absences" onclick="toggleAdminView('pending-absences-view', this)">
            <i class="fa-solid fa-hand-point-up"></i> 
            <span>Requests for Permission</span>
            <span class="badge">${absencesCount}</span>
        </div>`;
    }

    if (registrationsCount > 0 && isGlobalAdmin) {
        const isRegExpanded = document.getElementById('pending-registrations-view')?.classList.contains('expanded') ? 'active' : '';
        html += `
        <div class="action-chip has-items ${isRegExpanded}" id="chip-registrations" onclick="toggleAdminView('pending-registrations-view', this)">
            <i class="fa-solid fa-id-card"></i> 
            <span>Pending Registrations</span>
            <span class="badge">${registrationsCount}</span>
        </div>`;
    }

    // 3. "All Clean" State with Fade Out
    if (html === '') {
        // Only show if it wasn't already showing "All caught up" to prevent loop
        if (!bar.querySelector('.clean')) {
            html = `<div class="action-chip clean"><i class="fa-solid fa-check-circle"></i> All caught up</div>`;
            bar.innerHTML = html;

            // Trigger Fade Out after 2.5 seconds
            setTimeout(() => {
                const cleanChip = bar.querySelector('.clean');
                if (cleanChip) {
                    cleanChip.classList.add('fading-out'); // Add CSS animation class
                    // Remove from DOM after animation finishes (0.5s)
                    setTimeout(() => {
                        if (bar.contains(cleanChip)) bar.removeChild(cleanChip);
                    }, 500);
                }
            }, 2500);
        }
    } else {
        bar.innerHTML = html;
    }
}

function toggleAdminView(viewId, chipElement) {
    const view = document.getElementById(viewId);
    if (!view) return;

    const isExpanded = view.classList.contains('expanded');

    if (isExpanded) {
        view.classList.remove('expanded');
        if (chipElement) chipElement.classList.remove('active');
    } else {
        view.classList.add('expanded');
        if (chipElement) chipElement.classList.add('active');

        setTimeout(() => {
            view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);
    }
}

/**
 * Adds a +1 hour log to the latest entry for every student present on a given day.
 * @param {string} dateStr - The date string in "DD-MM-YYYY" format.
 */
function addPlusOneHourToDay(dateStr) {
    if (!isAdmin || !currentCourse) return;

    const logsForCurrentCourse = courseData[currentCourse].logs;
    const newLogsToAdd = [];

    // 1. Find all logs on the specified day.
    const logsOnDay = logsForCurrentCourse.filter(log => {
        const logDate = new Date(log.timestamp);
        const day = String(logDate.getDate()).padStart(2, '0');
        const month = String(logDate.getMonth() + 1).padStart(2, '0');
        const year = logDate.getFullYear();
        return `${day}-${month}-${year}` === dateStr;
    });

    // 2. Group by UID to find the latest log for each student.
    const latestLogByUid = {};
    logsOnDay.forEach(log => {
        if (!latestLogByUid[log.uid] || log.timestamp > latestLogByUid[log.uid].timestamp) {
            latestLogByUid[log.uid] = log;
        }
    });

    // 3. Create a new log for each student, +1 hour after their last scan.
    for (const uid in latestLogByUid) {
        const latestLog = latestLogByUid[uid];
        const newDate = new Date(latestLog.timestamp);
        newDate.setHours(newDate.getHours() + 1);

        let newLog = {
            uid: uid,
            timestamp: newDate.getTime(),
            id: Date.now() + Math.random().toString(36).substring(2, 11),
            manual: true
        };
        newLog = touchLogForEdit(newLog, currentUser?.email);
        newLogsToAdd.push(newLog);
    }

    // 4. Add the new logs and update everything.
    if (newLogsToAdd.length > 0) {
        courseData[currentCourse].logs.unshift(...newLogsToAdd);
        saveAndMarkChanges(currentCourse);
        updateUI();
        if (isOnline && isSignedIn) syncLogsWithSheet();
        showNotification('success', 'Bulk Add Complete', `Added a new timestamp for ${newLogsToAdd.length} students on ${dateStr}.`);
    } else {
        showNotification('info', 'No Action', `No students to add a new timestamp for on ${dateStr}.`);
    }
}

/**
 * Adds a new log entry one hour after the latest existing entry for a group.
 * @param {Object} group - The log group to add the time to.
 */
function addPlusOneHourLog(group) {
    if (!isAdmin) return;

    // Find the full log object with the latest timestamp
    const latestLog = group.originalLogs.reduce((prev, current) =>
        (prev.timestamp > current.timestamp) ? prev : current
    );

    const newDate = new Date(latestLog.timestamp);
    newDate.setHours(newDate.getHours() + 1);

    let newLog = {
        uid: group.originalLogs[0]?.uid, // Use the group's main UID
        timestamp: newDate.getTime(),
        id: Date.now() + Math.random().toString(36).substring(2, 11),
        manual: true,
        session: latestLog.session || 'Default' // <--- COPY SESSION FROM LATEST LOG
    };

    newLog = touchLogForEdit(newLog, currentUser?.email);

    // Add log to the correct course data array
    courseData[currentCourse].logs.unshift(newLog);

    saveAndMarkChanges(currentCourse);

    updateUI();

    if (isOnline && isSignedIn && isAdmin) {
        syncLogsWithSheet().catch(err => {
            console.error('Error syncing after adding +1 hour log:', err);
        });
    }
}

window.buildUIDToPrimaryUidMap = function () {
    uidToPrimaryUidMap = {};

    // For each student in database (keyed by Index)
    Object.keys(databaseMap).forEach(index => {
        const student = databaseMap[index];
        if (student && student.uids) {
            // Map each UID to the student's Index
            student.uids.forEach(uid => {
                uidToPrimaryUidMap[uid] = index;
            });
        }
    });

}

/**
     * @returns {Array} The array of logs for the current course and user.
     */
function getLogsForCurrentUser() {
    if (!currentCourse) return [];

    if (isGlobalAdmin) {
        // Global admins use GAPI
        return courseData[currentCourse]?.logs || [];
    } else {
        // Non-global admins and students use courseData (populated from backend)
        return courseData[currentCourse]?.logs || [];
    }
}

function addToTombstones(id, course = currentCourse) {
    // Ensure the data structure for the course exists.
    if (!courseData[course]) {
        courseData[course] = { logs: [], tombstones: new Set() };
    }
    // Add the ID to the in-memory tombstone set.
    courseData[course].tombstones.add(id);

    saveAndMarkChanges(course);
}

// Setup all event listeners in one place
function setupEventListeners() {
    // Set up tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            const newTabContent = document.getElementById(tabId);
            const oldTabContent = document.querySelector('.tab-content.active');
            const courseButtons = document.getElementById('course-buttons-container');

            // Do nothing if clicking the already active tab
            if (oldTabContent === newTabContent) {
                return;
            }

            // Prevent non-global admins AND non-admins from accessing database tab
            if (tabId === 'database-tab' && !isGlobalAdmin) {
                return; // Only global admins can access database tab
            }

            // Hide or show the course buttons based on the selected tab
            if (courseButtons) {
                const sessionControls = document.getElementById('session-controls');

                if (tabId === 'database-tab') {
                    courseButtons.style.display = 'none';
                    if (sessionControls) sessionControls.style.display = 'none'; // <--- HIDE
                } else {
                    courseButtons.style.display = isSignedIn ? 'flex' : 'none';
                    // Only show session controls if a course is selected and has sections
                    if (sessionControls && currentCourse && courseInfoMap[currentCourse]?.availableSections) {
                        // Re-trigger render logic to decide if it should be visible
                        renderSessionControls(currentCourse);
                    }
                }
            }

            // Update the active state on the tab buttons
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Transition the content panes
            if (oldTabContent) {
                oldTabContent.classList.remove('active');
            }
            if (newTabContent) {
                newTabContent.classList.add('active');
            }
        });
    });

    // Add this inside setupEventListeners()
    document.addEventListener('click', (e) => {
        // Only run if Bulk Mode is active
        if (isBulkMode) {
            const target = e.target;

            // Define safe zones (clicking here won't cancel)
            const isTable = target.closest('.logs-table');
            const isBulkBar = target.closest('#bulk-actions-bar');
            const isToggleBtn = target.closest('.logs-actions button'); // The toggle button itself
            const isDialog = target.closest('.dialog-backdrop'); // Don't cancel if a dialog is open

            // If clicked outside all safe zones, turn off bulk mode
            if (!isTable && !isBulkBar && !isToggleBtn && !isDialog) {
                toggleBulkMode();
            }
        }
    });

    // Button event listeners
    const importExcelBtn = document.getElementById('import-excel-btn');
    const excelInput = document.getElementById('excel-input');
    const filterInput = document.getElementById('filter-input');
    const sortSelect = document.getElementById('sort-select');
    const dbFilterInput = document.getElementById('db-filter-input');
    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-input');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    const addLogBtn = document.getElementById('add-log-btn');
    const addEntryBtn = document.getElementById('add-entry-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    const clearDbBtn = document.getElementById('clear-db-btn');
    const syncBtn = document.getElementById('sync-btn');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const dbSortSelect = document.getElementById('db-sort-select');

    const registerUidBtn = document.getElementById('register-uid-btn');
    if (registerUidBtn) registerUidBtn.addEventListener('click', showRegisterUIDDialog);

    const requestPermissionBtn = document.getElementById('request-permission-btn');
    if (requestPermissionBtn) requestPermissionBtn.addEventListener('click', showRequestPermissionDialog);

    const scanBtn = document.getElementById('scan-button');
    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            // Check if the button is in the 'is-scanning' (stop) state
            if (scanBtn.classList.contains('is-scanning')) {
                stopScanning();
            } else {
                startScanning();
            }
        });
    }

    document.addEventListener('focusin', (event) => {
        const target = event.target;
        // Check if the focus event happened on an input or textarea inside any of our dialogs.
        const isDialogInput = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.closest('.dialog');

        if (isDialogInput) {
            // When an input is focused, the mobile keyboard appears.
            // We wait a moment (300ms) for the keyboard animation to start and the viewport to resize.
            setTimeout(() => {
                // This command tells the browser to smoothly scroll the focused input 
                // into the center of the available view area.
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    });

    logsTbody.addEventListener('click', (event) => {
        const targetRow = event.target.closest('tr[data-key]');
        if (!targetRow) return;

        const key = targetRow.dataset.key;

        // Re-calculate the specific group data for the clicked row to ensure it's always correct
        const logsForCurrentCourse = getLogsForCurrentUser();
        const grouped = {};
        logsForCurrentCourse.forEach(log => {
            const dateObj = new Date(log.timestamp);
            if (isNaN(dateObj.getTime())) return;
            const scannedUid = log.uid;
            const dbKey = uidToPrimaryUidMap[scannedUid];
            const groupIdentifier = dbKey || scannedUid;

            const studentData = dbKey ? databaseMap[dbKey] : null;
            const name = studentData ? studentData.name : 'Unknown';
            const uidsForDisplay = studentData ? studentData.uids : [scannedUid];

            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const date = `${day}-${month}-${year}`;

            // This is the corrected line
            const groupKey = `${date}_${scannedUid}`;

            if (!grouped[groupKey]) {
                grouped[groupKey] = { key: groupKey, date, dateObj, uid: groupIdentifier, name: name, uidsForDisplay: uidsForDisplay, originalLogs: [] };
            }
            grouped[groupKey].originalLogs.push(log);
        });

        const group = grouped[key];
        if (!group) {
            console.error("Could not find group data for key:", key);
            return;
        }

        // Use reliable class-based detection for button clicks
        if (event.target.closest('.add-user-btn')) {
            // Use the first display UID which is the actual scanned UID for unknown users
            showAddEntryFromLog(group.uidsForDisplay[0]);
        } else if (event.target.closest('.add-time-btn')) {
            addPlusOneHourLog(group);
        } else if (event.target.closest('.delete-log-btn')) {
            confirmDeleteLog(group);
        } else if (event.target.closest('.edit-log-btn')) {
            showEditLogDialog(group);
        }
    });

    if (importExcelBtn) importExcelBtn.addEventListener('click', () => excelInput.click());
    if (excelInput) excelInput.addEventListener('change', handleExcelFile);
    if (filterInput) filterInput.addEventListener('input', debounce(handleFilterChange, 300));
    if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
    if (dbFilterInput) dbFilterInput.addEventListener('input', handleDbFilterChange);
    if (dbSortSelect) dbSortSelect.addEventListener('change', handleDbSortChange);
    if (importBtn) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', handleImportFile);
    if (exportBtn) exportBtn.addEventListener('click', exportLogs);
    if (clearBtn) clearBtn.addEventListener('click', clearLogs);
    if (addLogBtn) addLogBtn.addEventListener('click', showAddLogEntryDialog);
    if (addEntryBtn) addEntryBtn.addEventListener('click', showAddEntryDialog);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportDatabaseToExcel);
    if (clearDbBtn) clearDbBtn.addEventListener('click', clearDatabase);
    if (syncBtn) syncBtn.addEventListener('click', syncData);
    if (loginBtn) {
        // Use direct event listener without arrow function to ensure proper 'this' binding
        loginBtn.addEventListener('click', handleAuthClick);
    } else {
        console.error('Login button not found!');
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleSignoutClick);
        logoutBtn.addEventListener('click', () => {
            const cat = document.getElementById('cat-companion');
            if (cat) {
                cat.classList.remove('visible');
                // Wait for transition to finish
                setTimeout(() => {
                    cat.style.display = 'none';
                }, 400);
            }
        });
    }

    // Table header sort listeners
    document.querySelectorAll('.logs-table .sortable').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');
            currentSort = (currentSort === `${sortKey}-asc`) ? `${sortKey}-desc` : `${sortKey}-asc`;
            localStorage.setItem('logs_sort', currentSort);
            sortSelect.value = currentSort;

            // Add the same logic here
            const logsTable = document.querySelector('.logs-table');
            if (currentSort.startsWith('date')) {
                logsTable.classList.add('sorting-by-date');
            } else {
                logsTable.classList.remove('sorting-by-date');
            }

            updateSortIcons();
            updateLogsList();
        });
    });

    // --- Database table sort listeners ---
    document.querySelectorAll('.database-table .sortable').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');
            // Toggle direction or switch to the new sort key
            currentDbSort = (currentDbSort.startsWith(sortKey) && currentDbSort.endsWith('asc')) ? `${sortKey}-desc` : `${sortKey}-asc`;
            localStorage.setItem('db_sort', currentDbSort);
            document.getElementById('db-sort-select').value = currentDbSort;
            updateDbSortIcons(); // We will create this function next
            updateDatabaseList();
        });
    });
    setupAbsenceHistory();
}

// --- 3. Non-Global Admin Profile & Settings ---
function showGlobalSettingsDialog() {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '1000px';
    dialog.style.height = '85vh';
    dialog.setAttribute('role', 'dialog');

    // --- Variables for Bomb ---
    let avatarClickCount = 0;
    let lastAvatarClickTime = 0;

    // --- HTML STRUCTURE ---
    dialog.innerHTML = `
    <div class="settings-modal-header">
        <div style="display:flex; align-items:center; gap:15px;">
            <div style="position:relative; width:48px; height:48px; cursor: default;" id="admin-profile-pic-container">
                <img id="profile-avatar-img" src="${currentUser.picture}" style="width:100%; height:100%; border-radius:50%; border:2px solid var(--card-background); box-shadow:0 2px 8px rgba(0,0,0,0.1); object-fit:cover;">
            </div>
            <div>
                <h3 style="margin:0; font-size:1.3em;">Global Settings</h3>
                <div style="font-size:0.85em; opacity:0.7;">Administrator</div>
            </div>
        </div>
        <button id="close-settings-btn" class="btn-icon" style="background:transparent; color:var(--text-color); font-size:1.2em;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    
    <div class="settings-tabs-container">
        <button class="settings-tab-btn active" data-target="sect-courses">
            <i class="fa-solid fa-book-open"></i> Courses
        </button>
        <button class="settings-tab-btn" data-target="sect-staff">
            <i class="fa-solid fa-user-tie"></i> Staff</button>
        <button class="settings-tab-btn" data-target="sect-devices">
            <i class="fa-solid fa-laptop-code"></i> Trusted Devices
        </button>
    </div>

    <div class="dialog-content" style="padding:0; position:relative; display:flex; flex-direction:column; overflow:hidden;">
        
        <div id="settings-loader" class="settings-loader-overlay">
            <div class="loading-spinner"></div>
        </div>
        
        <div id="sect-courses" class="settings-section" style="display:flex; flex-direction:column; height:100%;">
            <div class="settings-controls-bar" style="padding:15px 20px; border-bottom:1px solid rgba(0,0,0,0.05);">
                <div class="input-with-icon" style="flex-grow:1;">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="course-search-input" class="settings-search-input" placeholder="Search courses...">
                </div>
                <button id="add-new-course-btn" class="btn-green btn-sm">
                    <i class="fa-solid fa-plus"></i> New Course
                </button>
            </div>
            <div style="flex-grow:1; overflow-y:auto; padding:20px;">
                <div id="settings-course-grid" class="modern-course-grid"></div>
            </div>
        </div>

        <div id="sect-staff" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div class="database-controls" style="padding:15px 20px; margin:0; border-bottom:1px solid rgba(0,0,0,0.05);">
                <div style="font-size:0.9em; opacity:0.8;">Manage NFC Login Access</div>
                <button id="add-staff-btn" class="btn-green btn-sm">
                    <i class="fa-solid fa-user-plus"></i> Add Staff
                </button>
            </div>
            <div style="flex-grow:1; overflow-y:auto; padding:20px;">
                <div class="table-container">
                    <table class="database-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>UID</th>
                                <th>Email</th>
                                <th class="actions-header">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="staff-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <div id="sect-devices" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div style="padding:20px 20px 0 20px;">
                <div style="background:rgba(33, 150, 243, 0.1); border:1px solid var(--info-color); padding:15px; border-radius:8px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div style="color:var(--text-color);">
                        <strong><i class="fa-solid fa-circle-info" style="color:var(--info-color);"></i> This Device ID</strong><br>
                        <small style="font-family:monospace; opacity:0.8;">${getDeviceFingerprint()}</small>
                    </div>
                    <button id="register-this-device-btn" class="btn-blue btn-sm">
                        <i class="fa-solid fa-fingerprint"></i> Register This Device
                    </button>
                </div>
            </div>
            <div style="flex-grow:1; overflow-y:auto; padding:0 20px 20px 20px;">
                <div class="table-container">
                    <table class="database-table">
                        <thead>
                            <tr>
                                <th>Device Name</th>
                                <th>Registered By</th>
                                <th>Date</th>
                                <th class="actions-header">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="devices-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- BOMB LOGIC (Restored) ---
    const profilePicContainer = dialog.querySelector('#admin-profile-pic-container');
    if (profilePicContainer) {
        profilePicContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastAvatarClickTime > 1000) avatarClickCount = 0;
            lastAvatarClickTime = now;
            avatarClickCount++;
            if (avatarClickCount === 5) {
                profilePicContainer.innerHTML = `<div style="width:100%; height:100%; border-radius:50%; background:#f44336; display:flex; align-items:center; justify-content:center; color:white; font-size:2em;"><i class="fa-solid fa-bomb"></i></div>`;
                profilePicContainer.onclick = () => { if (confirm("Clear local cache?")) clearAllAppData(); };
                avatarClickCount = 0;
            }
        });
    }

    // --- LOGIC ---

    // 1. Tab Switching
    dialog.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            dialog.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            dialog.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');

            btn.classList.add('active');

            // Flex display needed for the internal layout (sticky headers)
            const target = document.getElementById(btn.dataset.target);
            if (target) target.style.display = 'flex';
        });
    });

    // 2. Search Listener
    const searchInput = document.getElementById('course-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderCoursesInSettings(courseInfoMap, e.target.value);
        });
    }

    // 3. Load Data
    const loadSettingsData = async () => {
        try {
            const [courseInfo, globalData] = await Promise.all([
                callWebApp('getCourseInfo', {}, 'POST'),
                callWebApp('getGlobalSettingsData', {}, 'POST')
            ]);

            const loader = document.getElementById('settings-loader');
            if (loader) loader.style.display = 'none';

            courseInfoMap = courseInfo;

            // Render Courses
            renderCoursesInSettings(courseInfo);

            // --- RENDER STAFF (Safe Mode) ---
            const staffBody = document.getElementById('staff-tbody');
            if (staffBody && globalData.staff) {
                staffBody.innerHTML = globalData.staff.map(s => {
                    const isGlobal = (s.role === 'Global');
                    const roleBadge = isGlobal
                        ? `<span style="background:var(--purple-color); color:white; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-left:5px;">ADMIN</span>`
                        : ``;

                    // We use DATA attributes instead of onclick to handle quotes safely
                    return `
                <tr>
                    <td style="font-weight:500;">
                        ${escapeHtml(s.name)}
                        ${roleBadge}
                    </td>
                    <td><span class="uid-badge">${escapeHtml(s.uid)}</span></td>
                    <td>${escapeHtml(s.email)}</td>
                    <td class="actions-cell">
                        <div class="actions-cell-content">
                            <button class="btn-blue btn-icon edit-staff-btn" 
                                data-row-index="${s.rowIndex}" 
                                data-name="${escapeHtml(s.name)}" 
                                data-uid="${escapeHtml(s.uid)}" 
                                data-email="${escapeHtml(s.email)}" 
                                data-role="${escapeHtml(s.role || 'Lecturer')}"
                                title="Edit">
                                <i class="fa-solid fa-pencil"></i>
                            </button>
                            <button class="btn-red btn-icon delete-staff-btn" 
                                data-row-index="${s.rowIndex}" 
                                data-name="${escapeHtml(s.name)}"
                                title="Delete">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
                }).join('');

                // Attach Staff Listeners
                staffBody.querySelectorAll('.edit-staff-btn').forEach(btn => {
                    btn.onclick = () => window.editStaffKey(btn.dataset.rowIndex, btn.dataset.name, btn.dataset.uid, btn.dataset.email, btn.dataset.role);
                });
                staffBody.querySelectorAll('.delete-staff-btn').forEach(btn => {
                    btn.onclick = () => window.deleteStaffKey(btn.dataset.rowIndex, btn.dataset.name);
                });
            }

            // --- RENDER DEVICES (Safe Mode) ---
            const deviceBody = document.getElementById('devices-tbody');
            if (deviceBody && globalData.devices) {
                const myId = getDeviceFingerprint();
                const isRegistered = globalData.devices.some(d => d.id === myId);

                const regBtn = document.getElementById('register-this-device-btn');
                if (isRegistered && regBtn) {
                    regBtn.disabled = true;
                    regBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Trusted';
                    regBtn.classList.replace('btn-blue', 'btn-green');
                }

                deviceBody.innerHTML = globalData.devices.map(d => `
                <tr style="${d.id === myId ? 'background:rgba(76, 175, 80, 0.1);' : ''}">
                    <td>
                        <strong>${escapeHtml(d.name)}</strong>
                        ${d.id === myId ? '<span style="margin-left:5px; font-size:0.8em; background:#4caf50; color:white; padding:2px 6px; border-radius:4px;">CURRENT</span>' : ''}
                    </td>
                    <td>${escapeHtml(d.owner)}</td>
                    <td>${escapeHtml(d.date)}</td>
                    <td class="actions-cell">
                        <div class="actions-cell-content">
                            <button class="btn-red btn-icon delete-device-btn" 
                                data-row-index="${d.rowIndex}" 
                                data-name="${escapeHtml(d.name)}"
                                title="Remove">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

                // Attach Device Listeners (The Critical Fix)
                deviceBody.querySelectorAll('.delete-device-btn').forEach(btn => {
                    btn.onclick = () => window.deleteTrustedDevice(btn.dataset.rowIndex, btn.dataset.name);
                });
            }

        } catch (e) {
            console.error(e);
            showNotification('error', 'Error', 'Failed to load settings: ' + e.message);
            const loader = document.getElementById('settings-loader');
            if (loader) loader.style.display = 'none';
        }
    };

    loadSettingsData();

    // 4. Action Buttons
    document.getElementById('register-this-device-btn').onclick = () => {
        const dialogBackdrop = document.createElement('div');
        dialogBackdrop.className = 'dialog-backdrop';
        dialogBackdrop.style.zIndex = "10010";

        const dialog = document.createElement('div');
        dialog.className = 'dialog';
        dialog.setAttribute('role', 'dialog');

        dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-laptop-medical"></i> Trust This Device</h3>
        <div class="dialog-content">
            <p>Give this device a friendly name (e.g., "A-131 Tablet").</p>
            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-right"></i> Name</label>
                <input type="text" id="new-device-name" class="form-control" placeholder="Device Name">
            </div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-trust-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-trust-btn" class="btn-green"><i class="fa-solid fa-check"></i> Trust</button>
        </div>
    `;

        dialogBackdrop.appendChild(dialog);
        document.body.appendChild(dialogBackdrop);

        setTimeout(() => dialog.querySelector('#new-device-name').focus(), 100);

        const closeTrust = () => dialogBackdrop.remove();

        dialog.querySelector('#cancel-trust-btn').onclick = closeTrust;

        dialog.querySelector('#confirm-trust-btn').onclick = async (e) => {
            const name = dialog.querySelector('#new-device-name').value.trim();
            if (!name) {
                showNotification('warning', 'Name Required', 'Please enter a device name.');
                return;
            }

            const btn = e.target;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

            try {
                await callWebApp('registerDevice_Admin', {
                    deviceName: name,
                    deviceId: getDeviceFingerprint()
                }, 'POST');

                showNotification('success', 'Registered', 'Device is now trusted.');

                document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                closeDialogMode();

                showGlobalSettingsDialog();

                setTimeout(() => {
                    const tab = document.querySelector('.settings-tab-btn[data-target="sect-devices"]');
                    if (tab) tab.click();
                }, 100);

            } catch (err) {
                showNotification('error', 'Error', err.message);
                closeTrust();
            }
        };
    };

    document.getElementById('add-staff-btn').onclick = () => showStaffEditorDialog(null);
    document.getElementById('add-new-course-btn').onclick = () => showCourseEditorDialog(null);

    const close = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    document.getElementById('close-settings-btn').onclick = close;
}

/**
* Bridges the HTML onclick event to the Editor Dialog.
*/
window.editStaffKey = (rowIndex, name, uid, email, role) => {
    showStaffEditorDialog({
        rowIndex: rowIndex,
        name: name,
        uid: uid,
        email: email,
        role: role
    });
};

window.deleteStaffKey = (rowIndex, name) => {
    showConfirmationDialog({
        title: "Revoke Access?",
        message: `Are you sure you want to revoke key for <strong>${name}</strong>? They will no longer be able to log in via NFC.`,
        confirmText: "Revoke",
        isDestructive: true,
        onConfirm: () => {
            callWebApp('manageStaff_Admin', { actionType: 'delete', rowIndex }, 'POST')
                .then(() => {
                    // We must refresh the dialog data. 
                    // Simplest way: close and reopen.
                    document.querySelector('.dialog-backdrop').remove();
                    showGlobalSettingsDialog();
                    // We use a small timeout to let the dialog render before switching tabs
                    setTimeout(() => {
                        const tab = document.querySelector('.settings-tab-btn[data-target="sect-staff"]');
                        if (tab) tab.click();
                    }, 100);
                })
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};

window.deleteTrustedDevice = (rowIndex, name) => {
    showConfirmationDialog({
        title: '<i class="fa-solid fa-laptop-slash" style="color:var(--danger-color);"></i> Untrust Device?',
        message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong>? It will require a Google Login to re-register.`,
        confirmText: '<i class="fa-solid fa-trash"></i> Untrust', // Added Icon
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',   // Added Icon
        isDestructive: true,
        onConfirm: () => {
            callWebApp('deleteDevice_Admin', { rowIndex }, 'POST')
                .then(() => {
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();

                    showGlobalSettingsDialog();

                    // Auto-switch back to "Devices" tab
                    setTimeout(() => {
                        const tab = document.querySelector('.settings-tab-btn[data-target="sect-devices"]');
                        if (tab) tab.click();
                    }, 100);
                })
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};

window.deleteStaffKey = (rowIndex, name) => {
    showConfirmationDialog({
        title: '<i class="fa-solid fa-user-xmark" style="color:var(--danger-color);"></i> Revoke Access?',
        message: `Are you sure you want to revoke key for <strong>${escapeHtml(name)}</strong>? They will no longer be able to log in via NFC.`,
        confirmText: '<i class="fa-solid fa-trash"></i> Revoke', // Added Icon
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',   // Added Icon
        isDestructive: true,
        onConfirm: () => {
            callWebApp('manageStaff_Admin', { actionType: 'delete', rowIndex }, 'POST')
                .then(() => {
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();

                    showGlobalSettingsDialog();

                    // Auto-switch back to "Staff" tab
                    setTimeout(() => {
                        const tab = document.querySelector('.settings-tab-btn[data-target="sect-staff"]');
                        if (tab) tab.click();
                    }, 100);
                })
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};


// --- 2. Course Editor (Merged UI + Logic) ---
// --- 2. Course Editor (Renaming Support + Validation) ---
function showCourseEditorDialog(courseName, courseData = null) {
    const isNew = !courseName;
    const title = isNew ? 'New Course' : 'Edit Course';
    const data = courseData || {};
    const val = (v) => v !== undefined && v !== null ? v : '';

    // 1. LOGIC: Display name with spaces (e.g. "CE 202")
    const displayCourseName = (courseName || '').replace(/_/g, ' ');

    const formatDate = (d) => {
        if (!d) return '';
        // If it's already YYYY-MM-DD, trust it
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return '';

            // Use LOCAL getters to preserve the exact date selected by the user
            // This ignores UTC conversion entirely.
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (e) { return ''; }
    };

    const canEditSensitive = isGlobalAdmin;
    const disabledAttr = canEditSensitive ? '' : 'disabled';
    const readOnlyStyle = canEditSensitive ? '' : 'style="background-color:#f5f5f5; color:#666; cursor:not-allowed;"';

    // Parse existing sections
    let currentSections = [];
    if (data.availableSections) {
        currentSections = data.availableSections.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Parse existing admins into a Set
    let currentAdmins = new Set();
    if (data.adminEmails) {
        data.adminEmails.split(',').forEach(e => currentAdmins.add(e.trim().toLowerCase()));
    }

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    dialogBackdrop.style.zIndex = "10002";
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');

    // --- ADMIN ACCESS HTML ---
    let adminSectionHtml = '';
    if (isGlobalAdmin) {
        adminSectionHtml = `
        <div class="form-group" style="margin-bottom:5px; margin-top:15px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-user-shield"></i> Admins</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="admin-search-input" class="form-control" placeholder="Search...">
            </div>
        </div>
        
        <div style="position:relative;">
            <div id="admin-staff-loader" style="position:absolute; inset:0; display:flex; justify-content:center; align-items:center; z-index:10; background:var(--card-background); border-radius:8px;">
                <div class="loading-spinner" style="width:30px; height:30px; border-width:3px; margin:0;"></div>
            </div>
            <div id="admin-selection-list" class="student-list-container" style="margin-left:115px; height:220px; min-height:180px; margin-bottom:5px;"></div>
        </div>
        <div id="admin-count-hint" style="text-align:right; font-size:0.85em; color:var(--primary-color); font-weight:600;">${currentAdmins.size} selected</div>
        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">`;
    }

    let eisWarning = !isGlobalAdmin ? `<small style="color:var(--warning-color); display:block; margin-top:4px;"><i class="fa-solid fa-lock"></i> Admin only.</small>` : '';

    // Generate Buttons A-D
    let groupButtonsHtml = '';
    for (let i = 0; i < 4; i++) {
        const char = String.fromCharCode(65 + i);
        groupButtonsHtml += `<div class="course-button" data-val="${char}" style="min-width:35px; padding:6px 0; font-size:0.9em;"><b>${char}</b></div>`;
    }

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-book-open"></i> ${title}</h3>
    <div class="dialog-content">
        
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-heading"></i> Name</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-font"></i>
                <input id="edit-c-name" class="form-control" value="${escapeHtml(displayCourseName)}" ${disabledAttr} placeholder="e.g. CE 101">
            </div>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-fingerprint"></i> EIS ID</label>
            <div style="flex-grow:1;">
                <div class="input-with-icon">
                    <i class="fa-solid fa-id-badge"></i>
                    <input id="edit-c-eis" class="form-control" value="${escapeHtml(val(data.eisId))}" placeholder="12345" ${disabledAttr} ${readOnlyStyle}>
                </div>
                ${eisWarning}
            </div>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-clock"></i> Hours</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-hourglass-half"></i>
                <input type="number" id="edit-c-hours" class="form-control" value="${escapeHtml(val(data.defaultHours))}">
            </div>
        </div>
        
        <div class="form-group" style="align-items:flex-start; margin-top: 15px;">
            <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-layer-group"></i> Sections</label>
            
            <div style="flex-grow:1; min-width:0; display:flex; flex-direction:column; gap:10px;">
                <div id="section-builder-list" class="admin-pills-list" style="width:100%; box-sizing:border-box; min-height:40px; border-radius:8px; padding:5px; font-size:0.85em;"></div>

                <div class="admin-tool-bar" style="flex-direction:column; gap:8px; align-items:stretch; padding:10px;">
                    <div id="new-sec-cat" class="course-buttons-container" style="margin:0; width:100%; display:flex; gap:6px;">
                        <div class="course-button active" data-val="Theory" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-book"></i>&nbsp;Theory</div>
                        <div class="course-button" data-val="Lab" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-desktop"></i>&nbsp;Lab</div>
                        <div class="course-button" data-val="Practice" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-pen-to-square"></i>&nbsp;Practice</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <div id="new-sec-grp" class="course-buttons-container" style="margin:0; flex-wrap:nowrap; gap:6px; flex:1;">
                            ${groupButtonsHtml}
                        </div>
                        <button id="btn-add-section" class="btn-green btn-sm" style="padding:8px 15px; flex-shrink:0; margin-left:10px; font-size:0.85em;">
                            <i class="fa-solid fa-plus"></i> Add
                        </button>
                    </div>
                </div>
            </div>
        </div>

        ${adminSectionHtml}

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar"></i> Start Date</label>
            <input type="date" id="edit-c-start" class="form-control" value="${formatDate(data.startDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-check"></i> End Date</label>
            <input type="date" id="edit-c-end" class="form-control" value="${formatDate(data.endDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-plane-departure"></i> Hol. Start</label>
            <input type="date" id="edit-c-holiday-start" class="form-control" value="${formatDate(data.holidayStartDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-calendar-minus"></i> Hol. Weeks</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-hashtag"></i>
                <input type="number" id="edit-c-holidays" class="form-control" value="${escapeHtml(val(data.holidayWeeks))}" ${disabledAttr} ${readOnlyStyle}>
            </div>
        </div>

    </div>
    <div class="dialog-actions">
        ${(!isNew && isGlobalAdmin) ? '<button id="delete-course-btn" class="btn-red" style="margin-right:auto;"><i class="fa-solid fa-trash"></i> Delete</button>' : ''}
        <button id="cancel-edit-c" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-edit-c" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Section Builder Logic ---
    const sectionListContainer = document.getElementById('section-builder-list');
    const catContainer = document.getElementById('new-sec-cat');
    const grpContainer = document.getElementById('new-sec-grp');
    const addSectionBtn = document.getElementById('btn-add-section');

    let newSectionCat = 'Theory';
    let newSectionGrp = 'A';

    const updateAvailableOptions = () => {
        Array.from(grpContainer.children).forEach(btn => {
            const grp = btn.dataset.val;
            const fullSec = `${newSectionCat} ${grp}`;
            if (currentSections.includes(fullSec)) btn.classList.add('disabled');
            else btn.classList.remove('disabled');
        });

        const currentGrpBtn = grpContainer.querySelector(`[data-val="${newSectionGrp}"]`);
        if (currentGrpBtn.classList.contains('disabled')) {
            const firstAvailable = grpContainer.querySelector('.course-button:not(.disabled)');
            if (firstAvailable) {
                Array.from(grpContainer.children).forEach(b => b.classList.remove('active'));
                firstAvailable.classList.add('active');
                newSectionGrp = firstAvailable.dataset.val;
            }
        }
    };

    const renderSections = () => {
        sectionListContainer.innerHTML = '';
        currentSections.forEach((sec, index) => {
            const pill = document.createElement('div');
            pill.className = 'admin-pill-item';
            pill.innerHTML = `<b>${sec}</b> <i class="fa-solid fa-times remove-pill" style="margin-left:8px; cursor:pointer; color:var(--danger-color);" data-index="${index}"></i>`;
            sectionListContainer.appendChild(pill);
        });
        sectionListContainer.querySelectorAll('.remove-pill').forEach(btn => {
            btn.onclick = (e) => {
                currentSections.splice(parseInt(e.target.dataset.index), 1);
                renderSections(); updateAvailableOptions();
            };
        });
    };
    renderSections();

    const bindToggleGroup = (container, onClick) => {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.course-button');
            if (btn && !btn.classList.contains('disabled')) {
                Array.from(container.children).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                onClick(btn.dataset.val);
                if (container === catContainer) updateAvailableOptions();
            }
        });
    };
    bindToggleGroup(catContainer, (val) => newSectionCat = val);
    bindToggleGroup(grpContainer, (val) => newSectionGrp = val);
    grpContainer.querySelector('[data-val="A"]').classList.add('active');
    updateAvailableOptions();

    addSectionBtn.onclick = () => {
        const fullSection = `${newSectionCat} ${newSectionGrp}`;
        if (!currentSections.includes(fullSection)) {
            currentSections.push(fullSection);
            const catOrderMap = { 'Theory': 1, 'Lab': 2, 'Practice': 3 };
            currentSections.sort((a, b) => {
                const [catA, grpA] = a.split(' ');
                const [catB, grpB] = b.split(' ');
                if (catOrderMap[catA] !== catOrderMap[catB]) return catOrderMap[catA] - catOrderMap[catB];
                return grpA.localeCompare(grpB);
            });
            renderSections(); updateAvailableOptions();
        } else {
            showNotification('warning', 'Duplicate', 'Section already exists.');
        }
    };

    // --- ADMIN STAFF PICKER LOGIC ---
    if (isGlobalAdmin) {
        const listContainer = document.getElementById('admin-selection-list');
        const searchInput = document.getElementById('admin-search-input');
        const countHint = document.getElementById('admin-count-hint');
        const loader = document.getElementById('admin-staff-loader');
        let staffList = [];

        // 1. Render Function
        const renderStaffList = (filter = '') => {
            listContainer.innerHTML = '';
            const lowerFilter = filter.toLowerCase();
            const filtered = staffList.filter(s =>
                s.name.toLowerCase().includes(lowerFilter) ||
                s.email.toLowerCase().includes(lowerFilter)
            );

            if (filtered.length === 0) {
                listContainer.innerHTML = `<div style="padding:20px; text-align:center; opacity:0.6;">No staff found</div>`;
                return;
            }

            filtered.forEach(staff => {
                const emailLower = staff.email.toLowerCase();
                const isSelected = currentAdmins.has(emailLower);

                const div = document.createElement('div');
                div.className = `student-item ${isSelected ? 'selected' : ''}`;
                const initials = staff.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

                div.innerHTML = `
                            <div class="student-avatar-placeholder" style="${isSelected ? 'background:var(--primary-color); color:white;' : ''}">${initials}</div>
                            <div class="student-info" style="flex-grow:1;">
                                <div class="student-name">${escapeHtml(staff.name)}</div>
                                <div class="student-uid" style="font-size:0.8em;">${escapeHtml(staff.role === 'Global' ? 'Admin' : (staff.role || 'Staff'))} &bull; ${escapeHtml(staff.email)}</div>
                            </div>
                            ${isSelected ? '<i class="fa-solid fa-check" style="color:var(--primary-color);"></i>' : ''}
                        `;

                div.onclick = () => {
                    if (isSelected) currentAdmins.delete(emailLower);
                    else currentAdmins.add(emailLower);
                    renderStaffList(searchInput.value);
                    countHint.textContent = `${currentAdmins.size} selected`;
                };
                listContainer.appendChild(div);
            });
        };

        // 2. Fetch Data
        callWebApp('getGlobalSettingsData', {}, 'POST')
            .then(data => {
                if (loader) loader.style.display = 'none';
                if (data && data.staff) {
                    staffList = data.staff;
                    staffList.sort((a, b) => a.name.localeCompare(b.name));
                    renderStaffList();
                }
            })
            .catch(e => {
                if (loader) loader.style.display = 'none';
                listContainer.innerHTML = `<div class="error-message">Failed to load staff list.</div>`;
            });

        // 3. Search Listener
        searchInput.addEventListener('input', (e) => renderStaffList(e.target.value));
    }

    const close = () => document.body.removeChild(dialogBackdrop);
    dialog.querySelector('#cancel-edit-c').onclick = close;

    // --- Save Logic ---
    dialog.querySelector('#save-edit-c').onclick = async (e) => {
        const btn = e.target;
        const nameInput = document.getElementById('edit-c-name');
        const rawName = nameInput.value.trim();
        const systemName = rawName.replace(/\s+/g, '_');

        // --- VALIDATION: Max Length ---
        if (systemName.length > 50) {
            showInputError(nameInput, 'Name is too long (max 50 chars).');
            return;
        }

        // --- VALIDATION: Forbidden Characters ---
        if (/[:\\\/?*\[\]]/.test(systemName)) {
            showInputError(nameInput, 'Name contains invalid characters (: \\ / ? * [ ]).');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        if (currentSections.length === 0) {
            showNotification('error', 'Missing Data', 'Please add at least one section.');
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
            return;
        }

        const finalAdminString = Array.from(currentAdmins).join(', ');

        const payload = {
            originalName: courseName,
            courseName: systemName, // SEND UNDERSCORES
            defaultHours: document.getElementById('edit-c-hours').value,
            startDate: document.getElementById('edit-c-start').value,
            endDate: document.getElementById('edit-c-end').value,
            holidayStartDate: document.getElementById('edit-c-holiday-start').value,
            holidayWeeks: document.getElementById('edit-c-holidays').value,
            eisId: document.getElementById('edit-c-eis').value,
            availableSections: currentSections.join(', '),
            adminEmails: isGlobalAdmin ? finalAdminString : (data.adminEmails || '')
        };

        try {
            const res = await callWebApp('saveCourseSettings_Admin', payload, 'POST');
            if (res.result === 'success') {
                showNotification('success', 'Saved', 'Course updated.');
                close();
                document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                closeDialogMode();
                if (isGlobalAdmin) showGlobalSettingsDialog();
                else showAdminProfileDialog();
            } else { throw new Error(res.message); }
        } catch (err) {
            showNotification('error', 'Save Failed', err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
        }
    };

    if (!isNew && isGlobalAdmin) {
        dialog.querySelector('#delete-course-btn').onclick = async (e) => {
            if (confirm('Delete this course from settings?')) {
                const btn = e.currentTarget;
                const originalText = btn.innerHTML;

                try {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Deleting...';

                    await callWebApp('saveCourseSettings_Admin', { originalName: courseName, isDelete: true }, 'POST');

                    showNotification('success', 'Deleted', 'Course removed.');

                    close();
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();

                    showGlobalSettingsDialog();

                } catch (err) {
                    showNotification('error', 'Delete Failed', err.message);
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        };
    }
}


// --- 3. Non-Global Admin Profile & Settings ---
function showAdminProfileDialog() {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '900px';
    dialog.style.height = '85vh';
    dialog.setAttribute('role', 'dialog');

    // --- Variables for Bomb ---
    let avatarClickCount = 0;
    let lastAvatarClickTime = 0;

    // --- Header (Unified "Global Settings" Look) ---
    const headerHtml = `
    <div class="settings-modal-header">
        <div style="display:flex; align-items:center; gap:15px;">
            <div style="position:relative; width:48px; height:48px; cursor: default;" id="non-admin-profile-pic-container">
                <img id="profile-avatar-img" src="${currentUser.picture}" style="width:100%; height:100%; border-radius:50%; border:2px solid var(--card-background); box-shadow:0 2px 8px rgba(0,0,0,0.1); object-fit:cover;">
            </div>
            <div>
                <h3 style="margin:0; font-size:1.3em;">My Courses</h3>
                <div style="font-size:0.85em; opacity:0.7;">${escapeHtml(currentUser.name)}</div>
            </div>
        </div>
        <button id="close-profile-btn" class="btn-icon" style="background:transparent; color:var(--text-color); font-size:1.2em;"><i class="fa-solid fa-xmark"></i></button>
    </div>`;

    // --- Initial State: Loading ---
    dialog.innerHTML = `
    ${headerHtml}
    <div class="dialog-content" style="overflow-y:auto; position:relative;">
        <div id="profile-loader" style="display:flex; justify-content:center; align-items:center; height:200px;">
            <div class="loading-spinner"></div>
        </div>
        <div id="profile-content" style="opacity:0; transition:opacity 0.3s;"></div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Bomb Logic (Attached immediately) ---
    const profilePicContainer = dialog.querySelector('#non-admin-profile-pic-container');
    profilePicContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastAvatarClickTime > 1000) avatarClickCount = 0;
        lastAvatarClickTime = now;
        avatarClickCount++;
        if (avatarClickCount === 5) {
            profilePicContainer.innerHTML = `<div style="width:100%; height:100%; border-radius:50%; background:#f44336; display:flex; align-items:center; justify-content:center; color:white; font-size:2em;"><i class="fa-solid fa-bomb"></i></div>`;
            profilePicContainer.onclick = () => { if (confirm("Clear local cache?")) clearAllAppData(); };
            avatarClickCount = 0;
        }
    });

    const close = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    dialog.querySelector('#close-profile-btn').onclick = close;

    // --- Async Data Fetch ---
    (async () => {
        await fetchCourseInfo(); // Fetch data while spinner shows

        const myCourses = availableCourses.filter(c => courseInfoMap[c]);
        let html = '';

        if (myCourses.length > 0) {
            html = `<div class="modern-course-grid">`;
            myCourses.forEach(courseName => {
                const data = courseInfoMap[courseName];
                const category = (data.defaultCategory || 'theory').toLowerCase();
                let stripClass = category.includes('theory') ? 'strip-theory' :
                    category.includes('lab') ? 'strip-lab' : 'strip-practice';

                html += `
                <div class="modern-course-card" id="card-${escapeHtml(courseName)}">
                    <div class="card-color-strip ${stripClass}"></div>
                    <div class="card-body">
                        <div class="card-title-row">
                            <div class="card-course-name">${escapeHtml(courseName.replace(/_/g, ' '))}</div>
                            ${data.eisId ? `<span class="card-eis-badge">#${escapeHtml(data.eisId)}</span>` : ''}
                        </div>
                        <div class="card-meta-row">
                            <div class="card-meta-item"><i class="fa-regular fa-clock"></i> ${escapeHtml(data.defaultHours || 0)}h</div>
                            <div class="card-meta-item" style="text-transform:capitalize;"><i class="fa-solid fa-tag"></i> ${category}</div>
                        </div>
                    </div>
                    <div class="card-footer">
                        <span class="admin-pill"><i class="fa-solid fa-user-tie"></i> Course Admin</span>
                        <i class="fa-solid fa-pen-to-square"></i>
                    </div>
                </div>`;
            });
            html += `</div>`;
        } else {
            html = `<div class="empty-logs"><p>No active courses assigned.</p></div>`;
        }

        const contentDiv = dialog.querySelector('#profile-content');
        const loaderDiv = dialog.querySelector('#profile-loader');

        contentDiv.innerHTML = html;
        loaderDiv.style.display = 'none';
        contentDiv.style.opacity = '1';

        // Attach listeners to cards
        myCourses.forEach(courseName => {
            const card = document.getElementById(`card-${courseName}`);
            if (card) {
                card.onclick = () => {
                    close();
                    showCourseEditorDialog(courseName, courseInfoMap[courseName]);
                };
            }
        });
    })();
}

/**
* Shows the Student Profile Dialog (Revamped Design)
*/
async function showStudentProfileDialog() {
    // 1. Find UIDs (Local)
    let userUIDs = [];
    for (const dbKey in databaseMap) {
        const entry = databaseMap[dbKey];
        if (entry.email && entry.email.toLowerCase() === currentUser.email.toLowerCase()) {
            userUIDs = entry.uids;
            break;
        }
    }

    // 2. Build UID List HTML
    let uidContent = '';
    if (userUIDs.length > 0) {
        const listItems = userUIDs.map(uid =>
            `<li class="profile-uid-badge">${escapeHtml(uid)}</li>`
        ).join('');
        uidContent = `<ul class="profile-uid-list">${listItems}</ul>`;
    } else {
        uidContent = `<p style="text-align: center; opacity: 0.6; font-style:italic;">No UIDs linked.</p>`;
    }

    // 3. Prepare Base HTML
    // Added: Link to https://myaccount.google.com/ around the avatar
    const profileHtml = `
<div class="profile-header-section">
    <a href="https://myaccount.google.com/" target="_blank" title="Manage Google Account">
        <img src="${currentUser.picture}" class="profile-avatar-large" alt="Avatar" style="cursor:pointer;">
    </a>
    <div style="text-align:center;">
        <h3 class="profile-name-large">${escapeHtml(currentUser.name)}</h3>
        <p class="profile-email-large">${escapeHtml(currentUser.email)}</p>
    </div>
</div>

<div class="form-section-title">My Student IDs</div>
${uidContent}

<div class="form-section-title" style="margin-top:20px;">Permission History</div>
<div id="student-requests-loader" style="text-align:center; padding:20px; opacity:0.6;">
    <i class="fas fa-circle-notch fa-spin"></i> Loading requests...
</div>
<div id="student-requests-list"></div>
`;

    // 4. Show Dialog
    showAlertDialog('', profileHtml);

    // 5. Fetch & Render Requests
    try {
        const requests = await callWebApp('getStudentAbsenceRequests', {}, 'POST');
        const loader = document.getElementById('student-requests-loader');
        const listContainer = document.getElementById('student-requests-list');

        if (loader) loader.style.display = 'none';
        if (!listContainer) return;

        if (!requests || requests.length === 0) {
            listContainer.innerHTML = `<div class="empty-logs" style="padding:10px;">No requests found.</div>`;
        } else {
            // Build Cards
            const cardsHtml = requests.map(req => {
                const statusClass = `status-${req.status.toLowerCase()}`;

                // Admin note logic
                let noteHtml = '';
                if (req.adminNotes) {
                    noteHtml = `<div class="req-note"><i class="fas fa-reply" style="margin-right:5px; opacity:0.6;"></i> <strong>Reply:</strong> ${escapeHtml(req.adminNotes)}</div>`;
                } else if (req.reason) {
                    noteHtml = `<div class="req-note" style="font-style:italic; opacity:0.8;">"${escapeHtml(req.reason)}"</div>`;
                }

                return `
        <div class="req-card ${statusClass}">
            <div class="req-header">
                <div class="req-course">${escapeHtml(req.course.replace(/_/g, ' '))}</div>
                <div class="req-status-pill">${escapeHtml(req.status)}</div>
            </div>
            <div class="req-details">
                <span><i class="far fa-calendar"></i> ${escapeHtml(req.absenceDate)}</span>
                <span><i class="far fa-clock"></i> ${escapeHtml(req.hours)}</span>
            </div>
            ${noteHtml}
        </div>`;
            }).join('');

            listContainer.innerHTML = cardsHtml;
        }

    } catch (err) {
        const loader = document.getElementById('student-requests-loader');
        if (loader) {
            loader.innerHTML = `<span style="color:var(--danger-color)"><i class="fas fa-exclamation-circle"></i> Failed to load requests.</span>`;
        }
    }
}

// Function to show the main content when ready
function showMainContent() {
    const loadingIndicator = document.getElementById('app-loading');
    const mainContainer = document.getElementById('main-container');

    // Start fading out the loader
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
    }

    // After the fade-out is complete (500ms), hide the loader and show the content.
    setTimeout(() => {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        if (mainContainer) {
            mainContainer.classList.remove('content-hidden');
        }
        // Re-enable scrolling
        document.body.classList.remove('is-loading');

        // --- Ensure auth UI state (hiding modules) is applied correctly ---
        updateAuthUI();
        updateUI();

    }, 500); // This MUST match the CSS transition duration

    isInitializing = false;
    criticalErrorsOnly = false;
    processPendingNotifications();
}

function handleRouting() {
    if (isInitializing) {
        return;
    }

    const hash = window.location.hash.replace('#', '');

    // If no hash, go to default course
    if (!hash) {
        // If we were on a guest course, clear it
        if (guestCourse) {
            const oldGuestCourse = guestCourse;
            guestCourse = null;
            if (courseData[oldGuestCourse]) delete courseData[oldGuestCourse];
            populateCourseButtons();
        }

        const defaultCourse = (currentCourse && availableCourses.includes(currentCourse)) ? currentCourse : (availableCourses.length > 0 ? availableCourses[0] : '');
        if (defaultCourse) {
            // Use replaceState to avoid firing hashchange again
            history.replaceState(null, null, '#' + defaultCourse);
            if (currentCourse !== defaultCourse) {
                handleCourseChange(defaultCourse);
            }
        }
        return;
    }

    // Optimization: If hash is already the active course, do nothing.
    if (hash === currentCourse) {
        return;
    }

    // Case 1: Is it an official, available course? (Fastest check)
    if (availableCourses.includes(hash)) {
        if (guestCourse) {
            // We are switching from a guest course to an official one
            const oldGuestCourse = guestCourse;
            guestCourse = null;
            if (courseData[oldGuestCourse]) delete courseData[oldGuestCourse];
            populateCourseButtons();
        }
        handleCourseChange(hash); // This is an authorized change
        return;
    }

    // Case 2: Is it a guest course for a Global Admin?
    // We check courseInfoMap, which is the *full* list of all courses.
    if (isGlobalAdmin && courseInfoMap[hash]) {
        const oldGuestCourse = guestCourse;
        guestCourse = hash; // Set new guest course

        // Unload old guest course if it was different
        if (oldGuestCourse && oldGuestCourse !== hash && courseData[oldGuestCourse]) {
            delete courseData[oldGuestCourse];
        }

        populateCourseButtons(); // Redraw buttons to include the new guest one
        handleCourseChange(hash); // Load the guest course data
        return;
    }

    // Case 3: Is it an unauthorized course for a non-Global Admin?
    if (!isGlobalAdmin && courseInfoMap[hash]) {
        console.warn('Access denied to course:', hash);
        showNotification('error', 'Access Denied', 'You do not have access to this course.');
        // Redirect to current (or default) course
        window.location.hash = currentCourse || (availableCourses.length > 0 ? availableCourses[0] : '');
        return;
    }

    // Case 4: The course doesn't exist at all (not in the full map).
    if (!courseInfoMap[hash]) {
        console.warn('Course not found:', hash);
        showNotification('error', 'Not Found', 'The course you tried to access does not exist.');
        // Redirect to current (or default) course
        window.location.hash = currentCourse || (availableCourses.length > 0 ? availableCourses[0] : '');
        return;
    }
}

/**
* Update sort icons in the database table headers.
*/
function updateDbSortIcons() {
    // Reset all sort icons in the database table
    document.querySelectorAll('.database-table .sort-icon').forEach(icon => {
        icon.className = 'sort-icon fa-solid fa-sort';
    });

    // Set the active sort icon
    const [field, direction] = currentDbSort.split('-');
    const header = document.querySelector(`.database-table .sortable[data-sort="${field}"]`);
    if (header) {
        const icon = header.querySelector('.sort-icon');
        icon.className = `sort-icon fa-solid fa-sort-${direction === 'asc' ? 'up' : 'down'}`;
    }
}

/**
* Handle sort dropdown change for the database.
*/
function handleDbSortChange() {
    currentDbSort = document.getElementById('db-sort-select').value;
    localStorage.setItem('db_sort', currentDbSort); // Save the choice
    updateDbSortIcons();
    updateDatabaseList();
}

// New function to update sync button appearance and behavior
function updateSyncButton() {
    const syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;

    // Update button text to show auto-sync status
    if (autoSyncEnabled) {
        syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        syncBtn.title = 'Auto-sync enabled (click to sync now)';
        syncBtn.classList.add('auto-sync-enabled');
    } else {
        syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        syncBtn.title = 'Manual sync mode';
        syncBtn.classList.remove('auto-sync-enabled');
    }
}

/**
* Export logs to JSON file.
*/
function exportLogs() {
    // Use getLogsForCurrentUser() to ensure we get the correct data subset
    const logsForCurrentCourse = getLogsForCurrentUser();

    if (logsForCurrentCourse.length === 0) {
        showNotification('warning', 'Export Failed', 'No logs to export');
        return;
    }

    // Format timestamps for export AND include session
    const exportData = logsForCurrentCourse.map(log => ({
        ...log, // This grabs uid, id, manual, version, etc.
        timestamp: new Date(log.timestamp).toISOString(),
        session: log.session || '' // Explicitly include session
    }));

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentCourse || 'attendance'}_logs.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    showNotification('success', 'Export Complete', 'Logs exported to JSON file');
}

/**
 * Export database to Excel file.
 */
function exportDatabaseToExcel() {
    const entries = Object.entries(databaseMap);
    if (entries.length === 0) return showNotification('warning', 'Export Failed', 'Database is empty.');

    const wsData = [["Name", "UID", "Email"]]; // new header
    entries.sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([uid, data]) => {
        wsData.push([data.name, uid, data.email || '']);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(wsData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Database");
    XLSX.writeFile(workbook, "uid_database.xlsx");
    showNotification('success', 'Export Complete', 'Database exported to Excel file.');
}

/**
 * Applies the selected theme (light, dark, or auto) to the document.
 * @param {string} theme - The theme to apply: 'auto', 'light', or 'dark'.
 */
function applyTheme(theme) {
    const isDarkMode = (theme === 'dark') || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-mode', isDarkMode);

    // Find the theme-color meta tag and update it
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isDarkMode ? '#000000' : '#f4f4f4');
    }

    const toggleIcon = document.querySelector('#theme-toggle-btn i');
    if (toggleIcon) {
        if (theme === 'light') {
            toggleIcon.className = 'fa-solid fa-sun';
            toggleIcon.parentElement.title = 'Switch to Dark Mode';
        } else if (theme === 'dark') {
            toggleIcon.className = 'fa-solid fa-moon';
            toggleIcon.parentElement.title = 'Switch to Auto Mode';
        } else {
            toggleIcon.className = 'fa-solid fa-circle-half-stroke';
            toggleIcon.parentElement.title = 'Switch to Light Mode';
        }
    }
}

/**
         * Sets up the theme toggle button and applies the stored/system theme on load.
         */
function setupThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (!themeToggleBtn) return;

    let currentTheme = localStorage.getItem('theme') || 'auto';
    applyTheme(currentTheme); // Apply theme on initial load

    themeToggleBtn.addEventListener('click', () => {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // Determine the next theme in the cycle
        switch (currentTheme) {
            case 'auto':
                currentTheme = isSystemDark ? 'light' : 'dark';
                break;
            case 'light':
                currentTheme = isSystemDark ? 'auto' : 'dark';
                break;
            case 'dark':
                currentTheme = isSystemDark ? 'light' : 'auto';
                break;
        }

        localStorage.setItem('theme', currentTheme);
        applyTheme(currentTheme);
    });

    // Listen for changes in the system's preferred color scheme
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (localStorage.getItem('theme') === 'auto' || !localStorage.getItem('theme')) {
            applyTheme('auto');
        }
    });
}

// New function to setup the enhanced sync button
function setupEnhancedSyncButton() {
    const syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;

    // Restore auto-sync preference from localStorage
    const savedPref = localStorage.getItem('auto_sync_enabled');
    if (savedPref !== null) {
        autoSyncEnabled = savedPref === 'true';
    }

    // Update button appearance
    updateSyncButton();

    // Clear any existing event listeners (optional, but helps prevent duplicates)
    const newSyncBtn = syncBtn.cloneNode(true);
    syncBtn.parentNode.replaceChild(newSyncBtn, syncBtn);

    // Add long-press functionality to toggle auto-sync
    let pressTimer;
    let isLongPress = false;

    newSyncBtn.addEventListener('mousedown', function (e) {
        isLongPress = false;
        pressTimer = setTimeout(function () {
            isLongPress = true;

            // Toggle auto-sync on long press
            autoSyncEnabled = !autoSyncEnabled;
            localStorage.setItem('auto_sync_enabled', autoSyncEnabled.toString());

            // Show notification
            if (autoSyncEnabled) {
                showNotification('success', 'Auto-Sync Enabled',
                    'Changes will sync automatically when online');

                // Try to sync immediately if we have pending changes
                if (pendingChanges && isOnline && isSignedIn) {
                    setTimeout(autoSyncData, 1000);
                }
            } else {
                showNotification('info', 'Auto-Sync Disabled',
                    'You will need to manually sync changes');
            }

            // Update the button appearance
            updateSyncButton();
        }, 800); // Long press duration - 800ms
    });

    // Clear timer on mouse up
    newSyncBtn.addEventListener('mouseup', function () {
        clearTimeout(pressTimer);

        // Only trigger sync on short press
        if (!isLongPress) {
            syncData();
        }
    });

    // Clear timer when mouse leaves the button
    newSyncBtn.addEventListener('mouseleave', function () {
        clearTimeout(pressTimer);
    });

    // Handle touch events for mobile
    newSyncBtn.addEventListener('touchstart', function (e) {
        isLongPress = false;
        pressTimer = setTimeout(function () {
            isLongPress = true;

            // Toggle auto-sync on long press
            autoSyncEnabled = !autoSyncEnabled;
            localStorage.setItem('auto_sync_enabled', autoSyncEnabled.toString());

            // Show notification
            if (autoSyncEnabled) {
                showNotification('success', 'Auto-Sync Enabled',
                    'Changes will sync automatically when online');
            } else {
                showNotification('info', 'Auto-Sync Disabled',
                    'You will need to manually sync changes');
            }

            // Update the button appearance
            updateSyncButton();
        }, 800);
    });

    newSyncBtn.addEventListener('touchend', function (e) {
        clearTimeout(pressTimer);

        // Only trigger sync on short touch
        if (!isLongPress) {
            syncData();
        }

        // Prevent additional click events
        e.preventDefault();
    });
}

/**
* Clears the local database cache to force a re-fetch from the server.
*/
function invalidateDatabaseCache() {
    databaseCache = null;
    databaseCacheTime = 0;
}

// Add this function to implement auto-save and auto-sync
function setupAutoSync() {
    // Always save changes to localStorage immediately when logs change
    const originalAddLog = handleNfcReading;
    handleNfcReading = async function (event) {
        await originalAddLog.call(this, event);
        pendingChanges = true;
        saveLogsToLocalStorage(); // Save immediately after any change
    };

    // Setup auto-sync interval
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
    }

    autoSyncInterval = setInterval(() => {
        if (!autoSyncEnabled) return;

        // Only sync if online, signed in, and we have pending changes or it's been 3+ minutes
        const timeSinceLastSync = Date.now() - lastSyncTime;
        if (isOnline && isSignedIn && (pendingChanges || timeSinceLastSync > 180000)) {
            autoSyncData();
        }
    }, SYNC_INTERVAL);

    // Also sync whenever we detect coming back online
    window.addEventListener('online', () => {
        updateOnlineStatus();
        // Wait a moment for connection to stabilize
        setTimeout(() => {
            if (pendingChanges && isOnline && isSignedIn) {
                autoSyncData();
            }
        }, 2000);
    });

    // --- Admin Dashboard Auto-Refresh ---
    // Start auto-refresh for admin views after a short delay
    setTimeout(() => {
        if (isAdmin && isSignedIn) {
            startAdminAutoRefresh();
        }
    }, 5000); // Wait 5s after init to start polling

    // Pause/resume auto-refresh when tab visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAdminAutoRefresh();
        } else if (isAdmin && isSignedIn) {
            // Refresh immediately when tab becomes visible, then restart interval
            silentRefreshAdminViews();
            startAdminAutoRefresh();
        }
    });
}

// Auto-sync function with retry logic
async function autoSyncData() {
    if (!autoSyncEnabled || !isOnline || !isSignedIn || isSyncing) return;

    try {
        isSyncing = true;
        updateSyncStatus("Syncing...", "syncing");

        await syncLogsWithSheet();

        // Reset state after successful sync
        pendingChanges = false;
        lastSyncTime = Date.now();
        syncAttempts = 0;
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        updateSyncStatus(`Synced (${time})`, "success");

        // Hide success indication after a few seconds
        setTimeout(() => {
            if (!pendingChanges) {
                updateSyncStatus("Online", "online");
            }
        }, 3000);
    } catch (error) {
        console.error('Sync error!:', error);
        syncAttempts++;

        // Update UI to show sync failed
        updateSyncStatus("Sync failed!", "error");

        if (syncAttempts < MAX_SYNC_ATTEMPTS) {
            // Schedule retry with exponential backoff
            const retryDelay = SYNC_RETRY_INTERVAL * Math.pow(2, syncAttempts - 1);
            updateSyncStatus(`Retry in ${Math.round(retryDelay / 1000)} s...`, "waiting");

            setTimeout(() => {
                if (isOnline && isSignedIn) {
                    autoSyncData();
                }
            }, retryDelay);
        }
    } finally {
        isSyncing = false;
    }
}

/**
* Converts a comma-separated string of hours into HTML pills.
* @param {string} hoursString - e.g., "8:40, 9:40"
* @returns {string} - HTML string of <span class="time-tag">...</span>
*/
function formatHoursAsPills(hoursString) {
    if (!hoursString) return 'N/A';

    return hoursString.split(',')
        .map(hour => hour.trim())
        .filter(hour => hour)
        .map(hour => `<span class="time-tag">${escapeHtml(hour)}</span>`)
        .join(' ');
}

/**
* Direct EIS Export function with interactive UI, performance fixes, and dynamic sections.
*/

async function showDirectEisExportDialog(prefilledDateStr = null) {
    if (!isAdmin || !currentCourse) {
        showNotification('warning', 'No Course Selected', 'Please select a course first.');
        return;
    }

    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');

    const formattedCourseName = currentCourse.replace(/_/g, ' ');

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-list-check"></i> Add to EIS</h3>
        <div class="dialog-content">
            <div class="dialog-loader" style="display:flex; justify-content:center; align-items:center; padding: 50px 0;">
                <div class="loading-spinner"></div>
            </div>
            
            <div class="dialog-main-content" style="display:none; opacity:0; transition: opacity 0.3s ease;">
                
                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
                    <input id="export-course-display" class="form-control" value="${escapeHtml(formattedCourseName)}" disabled>
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-calendar-week"></i> Week</label>
                    <select id="export-week" class="form-control"></select>
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
                    <input type="date" id="export-date" class="form-control">
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Topic</label>
                    <input type="text" id="export-topic" class="form-control" value="Lecture">
                </div>

                <div class="form-group" style="align-items:flex-start;">
                    <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-users"></i> Group</label>
                    <div style="flex-grow:1; display:flex; flex-direction:column; gap:8px;">
                        <div id="export-cat-group" class="course-buttons-container" style="margin-bottom:0; justify-content:flex-start;"></div>
                        <div id="export-subgroup-group" class="course-buttons-container" style="margin-bottom:0; justify-content:flex-start; display:none;"></div>
                    </div>
                </div>

                <div class="form-group" style="align-items:flex-start;">
                    <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-tag"></i> Category</label>
                    <div id="export-section-group" class="course-buttons-container" style="margin-bottom:0; width:100%; display:flex; gap:8px;">
                        <div class="course-button active" data-value="theory" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-book"></i>&nbsp; Theory</div>
                        <div class="course-button" data-value="lab" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-desktop"></i>&nbsp; Lab</div>
                        <div class="course-button" data-value="practice" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-pen-to-square"></i>&nbsp; Practice</div>
                    </div>
                </div>

                <div class="collapsible-trigger" style="width: fit-content; margin-left: auto; display:flex; align-items:center; margin-top:15px; margin-bottom:0; cursor:pointer;">
                    <span style="margin-right:5px;">More Options</span> <i class="fa-solid fa-chevron-down" style="font-size:0.8em;"></i>
                </div>
                
                <div class="collapsible-content">
                    
                    <div class="custom-hours-container">
                        <div style="display:flex; align-items:center;">
                            <input type="checkbox" id="manual-hours-check" style="margin-right:8px; width:16px; height:16px;">
                            <label for="manual-hours-check" style="margin:0; font-weight:500; cursor:pointer;">Set Custom Hours</label>
                        </div>
                        <input type="number" id="hours-custom-input" class="form-control" style="width:30px; height:15px; padding:2px 5px; text-align: right; display:none;" value="2" min="1" max="25">
                    </div>

                    <label><input type="checkbox" id="mark-exempted-option"> Always mark exempted students as absent</label>
                    <label><input type="checkbox" id="new-tab-option"> Open EIS in new tab</label>
                    <label><input type="checkbox" id="mark-missing-option"> Mark students without UID as absent</label>
                    <hr>
                    <button id="save-export-btn" class="btn-blue btn-sm" style="width:100%; justify-content:center;"><i class="fa-solid fa-file-export"></i> Export to File</button>
                </div>
            </div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-export-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-eis-export-btn" class="btn-green"><i class="fa-solid fa-wand-magic-sparkles"></i> Add to EIS</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    try { await fetchCourseInfo(); } catch (e) { }
    const eisId = courseIDMap[currentCourse.trim()] || courseIDMap[currentCourse];
    if (!eisId) {
        document.body.removeChild(dialogBackdrop); closeDialogMode();
        showNotification('error', 'EIS ID Missing', `ID for "${currentCourse}" is not set.`); return;
    }
    document.getElementById('export-course-display').value = `${formattedCourseName} (ID: ${eisId})`;

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    const courseMetadata = getCourseMetadata(currentCourse);
    const rawSections = courseMetadata?.availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections);
    const categories = Object.keys(sectionsMap);

    let defaultCategory = categories.length > 0 ? categories[0] : 'Theory';
    let defaultSubgroup = (categories.length > 0 && sectionsMap[defaultCategory].length > 0) ? sectionsMap[defaultCategory][0] : null;

    let selectedCategory = defaultCategory;
    let selectedSubgroup = defaultSubgroup;
    let selectedSection = selectedCategory.toLowerCase();

    const catContainer = document.getElementById('export-cat-group');
    const subContainer = document.getElementById('export-subgroup-group');
    const sectionContainer = document.getElementById('export-section-group');

    const updateSectionToggle = () => {
        sectionContainer.querySelectorAll('.course-button').forEach(btn => {
            if (btn.dataset.value === selectedSection.toLowerCase()) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    const renderSubgroups = () => {
        const groups = sectionsMap[selectedCategory] || [];
        subContainer.innerHTML = '';
        if (groups.length > 0 && !selectedSubgroup) selectedSubgroup = groups[0];
        subContainer.style.display = groups.length > 0 ? 'flex' : 'none';

        groups.forEach(grp => {
            const btn = document.createElement('div');
            btn.className = `course-button ${selectedSubgroup === grp ? 'active' : ''}`;
            btn.innerHTML = `<b>${grp}</b>`;
            btn.style.padding = "8px 15px"; btn.style.minWidth = "35px";
            btn.onclick = () => { selectedSubgroup = grp; renderSubgroups(); };
            subContainer.appendChild(btn);
        });
    };

    const renderCategories = () => {
        catContainer.innerHTML = '';
        const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };
        categories.forEach(cat => {
            const lowerCat = cat.toLowerCase();
            const iconClass = icons[lowerCat] || 'fa-tag';
            const btn = document.createElement('div');
            btn.className = `course-button ${selectedCategory === cat ? 'active' : ''}`;
            btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}`;
            btn.style.padding = "8px 12px"; btn.style.fontSize = "0.9em"; btn.style.minWidth = "auto";
            btn.onclick = () => {
                selectedCategory = cat; selectedSubgroup = null; selectedSection = cat.toLowerCase();
                updateSectionToggle(); renderCategories(); renderSubgroups();
            };
            catContainer.appendChild(btn);
        });
    };

    renderCategories(); renderSubgroups(); updateSectionToggle();

    sectionContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;
        selectedSection = btn.dataset.value;
        updateSectionToggle();
    });

    // Date & Week
    const weekSelect = document.getElementById('export-week');
    for (let i = 1; i <= 14; i++) weekSelect.innerHTML += `<option value="${i}">Week ${i}</option>`;
    const dateInput = document.getElementById('export-date');
    if (prefilledDateStr) {
        const [day, month, year] = prefilledDateStr.split('-');
        dateInput.value = `${year}-${month}-${day}`;
        if (courseMetadata) weekSelect.value = calculateWeekForDate(courseMetadata, new Date(dateInput.value)) || 1;
    } else {
        dateInput.value = courseMetadata ? getSuggestedDate(courseMetadata) : new Date().toISOString().split('T')[0];
        weekSelect.value = courseMetadata ? calculateCurrentWeek(courseMetadata) : 1;
    }

    // --- HOURS LOGIC (Custom Toggle) ---
    const hoursInput = document.getElementById('hours-custom-input');
    const manualCheck = document.getElementById('manual-hours-check');

    hoursInput.value = parseInt(courseMetadata?.defaultHours || 2);
    manualCheck.addEventListener('change', (e) => {
        hoursInput.style.display = e.target.checked ? 'block' : 'none';
    });

    // Prefs
    ['mark-exempted-option', 'new-tab-option', 'mark-missing-option'].forEach(id => {
        const cb = document.getElementById(id);
        const saved = localStorage.getItem(`eis_pref_${id}`);
        if (saved !== null) cb.checked = JSON.parse(saved);
        else if (id !== 'mark-exempted-option') cb.checked = true;
        cb.addEventListener('change', () => localStorage.setItem(`eis_pref_${id}`, cb.checked));
    });

    dialog.querySelector('.collapsible-trigger').onclick = (e) => {
        const content = e.currentTarget.nextElementSibling;
        content.classList.toggle('is-open');
        e.currentTarget.querySelector('i').className = content.classList.contains('is-open') ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
        content.style.marginTop = content.classList.contains('is-open') ? '10px' : '0';
    };

    const prepareData = () => {
        let targetSession = selectedCategory;
        if (selectedSubgroup) targetSession += ' ' + selectedSubgroup;
        const sectionParam = selectedSubgroup ? targetSession : 'ALL';

        const logsForCourse = courseData[currentCourse]?.logs || [];
        const uidCounts = {};
        const selectedDateStr = dateInput.value;

        logsForCourse.forEach(log => {
            const logDateStr = new Date(log.timestamp).toISOString().split('T')[0];
            if (logDateStr !== selectedDateStr) return;
            const logSession = log.session || 'Default';
            let isMatch = (logSession === targetSession);
            if (logSession === 'Default' && categories.length <= 1) isMatch = true;
            if (isMatch) {
                const primaryKey = uidToPrimaryUidMap[log.uid];
                if (primaryKey) uidCounts[primaryKey] = (uidCounts[primaryKey] || 0) + 1;
            }
        });

        const nameMap = {};
        Object.entries(databaseMap).forEach(([k, v]) => nameMap[k] = v.name);

        return {
            parameters: {
                week: weekSelect.value,
                hours: hoursInput.value,
                category: selectedSection,
                date: dateInput.value,
                topic: document.getElementById('export-topic').value,
                course: currentCourse,
                section: sectionParam
            },
            options: {
                markMissingAsAbsent: document.getElementById('mark-missing-option').checked,
                markExemptedAsAbsent: document.getElementById('mark-exempted-option').checked,
                manualHours: document.getElementById('manual-hours-check').checked // <-- KEY FLAG
            },
            attendance: uidCounts,
            nameMap: nameMap
        };
    };

    document.getElementById('confirm-eis-export-btn').onclick = () => {
        const data = prepareData();
        copyToClipboard(JSON.stringify(data)).then(() => {
            const url = `https://eis.epoka.edu.al/courseattendance/${eisId}/newcl`;
            showNotification('success', 'Copied', `Data for ${selectedCategory} ${selectedSubgroup || ''} copied.`);
            if (document.getElementById('new-tab-option').checked) window.open(url, '_blank');
            else window.location.href = url;
            closeDialog();
        }).catch(() => showNotification('error', 'Error', 'Clipboard failed.'));
    };

    document.getElementById('save-export-btn').onclick = () => {
        const data = prepareData();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const a = document.createElement('a');
        a.href = dataStr; a.download = `eis_${currentCourse}_${data.parameters.date}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showNotification('success', 'Saved', 'File exported.');
    };

    document.getElementById('cancel-export-btn').onclick = closeDialog;

    const loader = dialog.querySelector('.dialog-loader');
    const content = dialog.querySelector('.dialog-main-content');
    setTimeout(() => { loader.style.display = 'none'; content.style.display = 'block'; void content.offsetWidth; content.style.opacity = '1'; }, 300);
}

/**
* Adds or subtracts business days (skipping Sat/Sun) to a date.
* @param {Date} startDate - The starting date.
* @param {number} days - Number of business days to add (positive) or subtract (negative).
* @returns {Date} The calculated date.
*/
function addBusinessDays(startDate, days) {
    let count = 0;
    const currentDate = new Date(startDate);
    const direction = days > 0 ? 1 : -1;

    while (count < Math.abs(days)) {
        currentDate.setDate(currentDate.getDate() + direction);
        const day = currentDate.getDay();
        if (day !== 0 && day !== 6) { // 0 is Sunday, 6 is Saturday
            count++;
        }
    }
    return currentDate;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise} - Resolves when copied successfully
 */
function copyToClipboard(text) {
    // Use modern clipboard API if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    } else {
        // Fallback for older browsers
        return new Promise((resolve, reject) => {
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';  // Prevent scrolling to bottom
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    resolve();
                } else {
                    reject(new Error('Clipboard copy failed'));
                }
            } catch (err) {
                reject(err);
            }
        });
    }
}


// Check for auth redirect
function checkAuthRedirect() {
    if (window.location.hash && window.location.hash.includes('access_token=')) {

        const originalHash = sessionStorage.getItem('redirect_hash');
        sessionStorage.removeItem('redirect_hash');

        const params = {};
        window.location.hash.substring(1).split('&').forEach(pair => {
            const [key, value] = pair.split('=');
            params[key] = decodeURIComponent(value);
        });

        // Clean the URL, but restore the original course hash
        if (history.replaceState) {
            history.replaceState(null, null, window.location.pathname + (originalHash || ''));
        } else {
            window.location.hash = originalHash || '';
        }

        if (params.access_token) {
            // JUST save to localStorage. DO NOT try to init gapi.
            localStorage.setItem('gapi_token', JSON.stringify({ access_token: params.access_token }));
            // We saved the token. initGoogleApi will now find it on its own.
        }
    }
}

/**
* Initialize the application.
* Sets up event listeners, checks NFC support, and prepares the UI.
*/
function init() {
    if (!localStorage.getItem('gapi_token')) {
        localStorage.removeItem('last_active_course');
    }

    document.body.classList.add('is-loading');
    isInitializing = true;

    // --- Assign DOM Elements ---
    tabs = document.querySelectorAll('.tab');
    tabContents = document.querySelectorAll('.tab-content');
    importExcelBtn = document.getElementById('import-excel-btn');
    excelInput = document.getElementById('excel-input');
    filterInput = document.getElementById('filter-input');
    sortSelect = document.getElementById('sort-select');
    dbFilterInput = document.getElementById('db-filter-input');
    importBtn = document.getElementById('import-btn');
    importInput = document.getElementById('import-input');
    exportBtn = document.getElementById('export-btn');
    clearBtn = document.getElementById('clear-btn');
    addLogBtn = document.getElementById('add-log-btn');
    addEntryBtn = document.getElementById('add-entry-btn');
    exportExcelBtn = document.getElementById('export-excel-btn');
    clearDbBtn = document.getElementById('clear-db-btn');
    logsTbody = document.getElementById('logs-tbody');
    databaseTbody = document.getElementById('database-tbody');
    emptyLogs = document.getElementById('empty-logs');
    emptyDatabase = document.getElementById('empty-database');
    filteredCount = document.getElementById('filtered-count');
    dbEntryCount = document.getElementById('db-entry-count');
    totalScans = document.getElementById('total-scans');
    lastScan = document.getElementById('last-scan');
    databaseStatus = document.getElementById('database-status');
    notificationArea = document.getElementById('in-page-notification-area');
    successSound = document.getElementById('success-sound');
    errorSound = document.getElementById('error-sound');
    syncBtn = document.getElementById('sync-btn');
    syncStatus = document.getElementById('sync-status');
    syncText = document.getElementById('sync-text');
    loginBtn = document.getElementById('login-btn');
    logoutBtn = document.getElementById('logout-btn');
    loginContainer = document.getElementById('login-container');
    userContainer = document.getElementById('user-container');
    userName = document.getElementById('user-name');
    userAvatar = document.getElementById('user-avatar');
    scanHistoryModule = document.getElementById('scan-history-module');

    cleanupOldLocalStorage();

    setupThemeToggle();

    setupCatCompanion();

    // Start with nfcSupported as false
    nfcSupported = false;

    // Update current year in footer
    updateYear();

    // Set up online/offline listeners
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    window.addEventListener('hashchange', handleRouting, false);

    // Check if NFC is supported - ONLY in Google Chrome on Android
    const isAndroid = /Android/i.test(navigator.userAgent);

    // This is a more specific check for Google Chrome, excluding other Chromium browsers
    const isGoogleChrome = /Chrome/i.test(navigator.userAgent) && !/SamsungBrowser|OPR|Brave|YaBrowser/i.test(navigator.userAgent);

    if (isAndroid && isGoogleChrome && 'NDEFReader' in window) {
        console.log('NFC support detected (Google Chrome on Android with NDEFReader)');
        nfcSupported = true;
    } else {
        console.log('NFC not supported on this device/browser');
        nfcSupported = false;

        // Only show notification on mobile devices where NFC might be expected
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
            pendingNotifications.push({
                type: 'warning',
                title: 'NFC Unsupported',
                message: 'NFC scanning is only supported in Chrome on Android.'
            });
        }
    }

    updateScanButtons();

    // Set up event listeners
    setupEventListeners();
    setupRefreshButtons();

    // Restore and apply the last saved sort UI state
    sortSelect.value = currentSort;
    document.getElementById('db-sort-select').value = currentDbSort;
    updateSortIcons();
    updateDbSortIcons();

    if (currentSort.startsWith('date')) {
        document.querySelector('.logs-table').classList.add('sorting-by-date');
    }

    // Set up auto-sync with the new combined button approach
    setupAutoSync();
    setupEnhancedSyncButton();
    setupAuthStateTracking();

    // Handle auth redirect
    checkAuthRedirect();

    // Override syncLogsWithSheet to track sync status
    const originalSyncLogs = syncLogsWithSheet;
    syncLogsWithSheet = async function () {
        try {
            await originalSyncLogs.call(this);

            // On successful sync, update the last sync time in localStorage
            localStorage.setItem(`${LOGS_STORAGE_KEY}_${currentCourse}_last_sync`, Date.now().toString());
            pendingChanges = false;

            return true;
        } catch (error) {
            throw error;
        }
    };
    // Auto-start disabled for security - user must manually start scanning
    // if (nfcSupported) {
    //     startScanning();
    // }


    // Audio unlock removed - was causing annoying sound on first interaction

    // This prevents the phone from sleeping and killing the sync process
    if ('wakeLock' in navigator) {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock active');
            } catch (err) {
                console.warn(`Wake Lock failed: ${err.name}, ${err.message}`);
            }
        };

        // Request immediately
        requestWakeLock();

        // Re-request if the user minimizes and returns
        document.addEventListener('visibilitychange', async () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        });

        // AMOLED Burn-in Prevention: Subtle pixel shifting every 2 minutes
        // Shifts content by ±2 pixels - imperceptible to users but prevents static burn-in
        // Note: Applied to main-container to avoid breaking position:fixed elements (notifications, cat)
        const mainContainer = document.getElementById('main-container');
        if (mainContainer) {
            setInterval(() => {
                // Only apply shift when no dialogs are open
                if (dialogOpenCount === 0) {
                    const shiftX = Math.floor(Math.random() * 5) - 2; // -2 to +2 pixels
                    const shiftY = Math.floor(Math.random() * 5) - 2;
                    mainContainer.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
                }
            }, 120000); // Every 2 minutes
        }


    }
}


function processPendingNotifications() {
    if (pendingNotifications.length > 0) {
        // Only show the most recent notification of each type
        const uniqueNotifications = {};
        for (const notification of pendingNotifications) {
            uniqueNotifications[notification.type + notification.title] = notification;
        }

        // Display only the unique notifications
        Object.values(uniqueNotifications).forEach(notification => {
            showNotification(
                notification.type,
                notification.title,
                notification.message,
                notification.duration
            );
        });

        pendingNotifications = [];
    }
}

/**
* Helper function that your existing initGoogleApi() is trying to call
*/
function gapiLoaded() {
    return new Promise((resolve, reject) => {
        if (typeof gapi === 'undefined') {
            setTimeout(() => gapiLoaded().then(resolve).catch(reject), 100);
            return;
        }

        gapi.load('client', {
            callback: resolve,
            onerror: reject,
            timeout: 5000,
            ontimeout: () => reject(new Error('gapi.client load timeout'))
        });
    });
}

async function attemptTokenRestore() {
    try {
        const storedToken = localStorage.getItem('gapi_token');
        if (!storedToken) return false;

        const tokenObj = JSON.parse(storedToken);
        if (!tokenObj || !tokenObj.access_token) {
            localStorage.removeItem('gapi_token');
            return false;
        }

        gapi.client.setToken(tokenObj);

        await gapi.client.request({
            path: 'https://www.googleapis.com/oauth2/v3/userinfo'
        });

        return true;
    } catch (error) {
        localStorage.removeItem('gapi_token');
        return false;
    }
}

/**
 * Helper function that your existing initGoogleApi() is trying to call
 */
function gisLoaded() {
    return new Promise((resolve) => {
        // If google identity services is already loaded, resolve immediately
        if (typeof google !== 'undefined' && google.accounts) {
            resolve();
        } else {
            // Wait a bit and try again
            setTimeout(() => resolve(), 100);
        }
    });
}

/**
 * Initialize Google API client.
 * Set up auth token client and event listeners for login/logout.
 */
async function initGoogleApi() {
    if (initInProgress) return;
    initInProgress = true;
    isInitializing = true;

    try {
        await gapiLoaded();
        await gisLoaded();

        await gapi.client.init({});

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: handleTokenResponse, // This now handles the silent fail gracefully
        });

        // Try to restore session from LocalStorage first
        const restored = await attemptTokenRestore();

        if (restored) {
            onSuccessfulAuth(true);
        } else {
            // Only show One Tap if we are NOT signed in
            google.accounts.id.initialize({
                client_id: CLIENT_ID,
                callback: handleOneTapResponse,
                auto_select: true, // Auto-signin returning users
                cancel_on_tap_outside: false,
                use_fedcm_for_prompt: true
            });

            google.accounts.id.prompt();

            isInitializing = false;
            showMainContent();
        }

    } catch (error) {
        console.error('initGoogleApi error:', error);
        isInitializing = false;
        showMainContent();

        // FORCE UI RESET: Ensure login button is visible and clickable
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fa-brands fa-google"></i> Sign in';
            loginBtn.style.cursor = "pointer";
        }
    } finally {
        initInProgress = false;
    }
}

/**
* Loads data in phases for a fast boot
*/
async function onSuccessfulAuth(isRestore = false) {
    isSignedIn = true;

    // Show cat companion with transition
    const cat = document.getElementById('cat-companion');
    if (cat) {
        cat.style.display = 'block';
        // Force reflow
        void cat.offsetHeight;
        cat.classList.add('visible');
    }

    try {
        // --- PHASE 1: CRITICAL BOOT ---

        // 1. Get user info
        // CHANGE: Only ask Google if we don't already have the user (Standard Login).
        // In Kiosk mode, 'currentUser' is already set by handleNfcReading.
        if (!currentUser) {
            const userInfoResponse = await gapi.client.request({
                path: 'https://www.googleapis.com/oauth2/v3/userinfo'
            });
            currentUser = {
                email: userInfoResponse.result.email,
                name: userInfoResponse.result.name,
                picture: userInfoResponse.result.picture
            };
        }

        // Update UI (Moved outside the if-block so it runs for both modes)
        console.log('User:', currentUser.email);
        userName.textContent = currentUser.name;
        userAvatar.src = currentUser.picture;

        // 2. Get ALL boot data in ONE call (Admin Status + Course List)
        // This goes to YOUR backend, which knows how to handle the Kiosk token.
        const bootData = await callWebApp('getBootData', {}, 'POST');

        // 3. Process Admin Status from boot data
        if (bootData.adminStatus) {
            isAdmin = bootData.adminStatus.isAdmin || false;
            isGlobalAdmin = bootData.adminStatus.isGlobalAdmin || false;
            adminCourses = bootData.adminStatus.courses || [];
            console.log('Admin status:', { isAdmin, isGlobalAdmin, adminCourses });
        }

        // 4. Process Available Courses from boot data
        const fetchedCourseDict = bootData.courses;
        if (fetchedCourseDict && typeof fetchedCourseDict === 'object') {
            courseDictionary = fetchedCourseDict;
            availableCourses = Object.keys(courseDictionary);

            const filteredDict = {};
            availableCourses.forEach(course => {
                if (courseDictionary[course]) {
                    filteredDict[course] = courseDictionary[course];
                }
            });
            courseDictionary = filteredDict;

            // Determine which course to show first
            const hashCourse = window.location.hash.replace('#', '');
            const lastActiveCourse = localStorage.getItem('last_active_course');

            if (hashCourse) {
                if (availableCourses.includes(hashCourse)) {
                    currentCourse = hashCourse;
                } else if (isGlobalAdmin) {
                    currentCourse = hashCourse;
                    guestCourse = hashCourse;
                } else {
                    currentCourse = (lastActiveCourse && availableCourses.includes(lastActiveCourse)) ? lastActiveCourse : (availableCourses.length > 0 ? availableCourses[0] : null);
                }
            } else if (lastActiveCourse && availableCourses.includes(lastActiveCourse)) {
                currentCourse = lastActiveCourse;
            } else if (availableCourses.length > 0) {
                currentCourse = availableCourses[0];
            } else {
                currentCourse = null;
            }
        }

        // 5. Process Database
        if (bootData.database) {
            databaseMap = bootData.database;
            databaseCache = bootData.database;
            databaseCacheTime = Date.now();
            window.buildUIDToPrimaryUidMap();
            updateDatabaseStatus();
        }

        // 6. Process Course Info
        if (bootData.courseInfo) {
            courseInfoMap = bootData.courseInfo;
            Object.entries(courseInfoMap).forEach(([courseName, metadata]) => {
                if (metadata && metadata.eisId) {
                    courseIDMap[courseName] = metadata.eisId;
                }
            });
        }

        // --- PHASE 2: SHOW THE APP ---
        isInitializing = false;
        showMainContent();
        updateAuthUI();
        handleRouting();
        populateCourseButtons();
        updatePageTitle();
        updateUI();

        // --- PHASE 3: BACKGROUND DATA LOADING ---
        (async () => {
            try {
                if (currentCourse) {
                    // REPLACED: Use safe loader instead of direct fetch
                    await loadAndMergeCourseData(currentCourse);

                    // Background load others
                    if (isAdmin && !isGlobalAdmin) {
                        setTimeout(loadRemainingCourseAdminLogs, 1000);
                    } else if (!isAdmin) {
                        setTimeout(loadRemainingStudentLogs, 1000);
                    }
                }

                updateUI();

                if (isAdmin) {
                    refreshAdminViews();
                }
            } catch (backgroundError) {
                console.error('Error during background data load:', backgroundError);
            }
        })();

        // --- PHASE 4: SESSION AUTO-DESTRUCT (KIOSK ONLY) ---
        // Only run this timer if we are in Kiosk mode (token starts with "KIOSK_")
        const storedTokenStr = localStorage.getItem('gapi_token');
        const isKioskMode = storedTokenStr && storedTokenStr.includes('KIOSK_');

        if (isKioskMode) {
            // Set this to MATCH your Backend.js SESSION_DURATION (in milliseconds)
            // e.g. 10800 * 1000 for 3 hours
            const SESSION_TIMEOUT_MS = 1800 * 1000;

            if (window.sessionTimer) clearTimeout(window.sessionTimer);

            window.sessionTimer = setTimeout(() => {
                console.warn("Kiosk session time limit reached. Reloading...");
                localStorage.removeItem('gapi_token');
                window.location.reload();
            }, SESSION_TIMEOUT_MS);
        }

    } catch (bootError) {
        console.error('Error during auth:', bootError);
        showNotification('error', 'Authentication Error', 'Failed to complete sign-in. Please try again.');
        isInitializing = false;
        showMainContent();
        updateAuthUI();
    }
}

/**
 * Saves the data for a single, specified course to local storage.
 * @param {string} courseName - The name of the course to save.
 */
function saveCourseToLocalStorage(courseName) {
    if (!courseName || !courseData[courseName]) return;

    const storageKey = `${LOGS_STORAGE_KEY}_${courseName}`;
    try {
        const dataToSave = {
            logs: courseData[courseName].logs,
            tombstones: Array.from(courseData[courseName].tombstones) // Convert Set to Array for JSON
        };
        localStorage.setItem(storageKey, JSON.stringify(dataToSave));
        localStorage.setItem(`${storageKey}_timestamp`, Date.now().toString());
    } catch (e) {
        console.error(`Error saving course ${courseName} to localStorage:`, e);
    }
}

// Helper function to clean up old localStorage data
function cleanupOldLocalStorage() {
    const keysToCheck = [];
    const now = Date.now();
    const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

    // Find all attendance log keys
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LOGS_STORAGE_KEY)) {
            keysToCheck.push(key);
        }
    }

    // Remove old data
    keysToCheck.forEach(key => {
        const timestampKey = `${key}_timestamp`;
        const timestamp = localStorage.getItem(timestampKey);

        if (timestamp) {
            const age = now - parseInt(timestamp);
            if (age > ONE_MONTH) {
                console.log(`Removing old data for key: ${key} (${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`);
                localStorage.removeItem(key);
                localStorage.removeItem(timestampKey);
            }
        }
    });
}


/**
 * Handle token response from Google OAuth.
 * @param {Object} resp - The token response object.
 */
function handleTokenResponse(resp) {
    const loginContainer = document.getElementById('login-container');
    const userContainer = document.getElementById('user-container');
    const loginBtn = document.getElementById('login-btn');

    // 1. Handle Silent Failure / Missing Permissions / Popup Blocked
    // If 'error' exists, it means the silent attempt failed (user needs to click).
    if (resp.error || !resp.access_token) {
        console.warn('Silent auth failed or consent missing:', resp);

        // Reset UI to show the "Grant Permissions" button
        if (userContainer) userContainer.style.display = 'none';
        if (loginContainer) loginContainer.style.display = 'flex';

        if (loginBtn) {
            // Important: We change the button to indicate action is needed
            loginBtn.disabled = false; // Re-enable button
            loginBtn.style.cursor = "pointer";
            loginBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Grant Permissions';
            loginBtn.style.backgroundColor = "#fb8c00"; // Orange color

            // Ensure the click handler uses the STANDARD prompt (popup)
            // We clone to strip old listeners and add a fresh one
            const newBtn = loginBtn.cloneNode(true);
            loginBtn.parentNode.replaceChild(newBtn, loginBtn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // When clicked MANUALLY, we are allowed to use 'consent' or ''
                tokenClient.requestAccessToken({ prompt: 'consent' });
            });
        }
        return;
    }

    // 2. Success - We have the Token!
    try {
        // Set the token in GAPI immediately
        gapi.client.setToken(resp);
        localStorage.setItem('gapi_token', JSON.stringify(resp));

        isSignedIn = true;

        // Proceed to boot the app
        onSuccessfulAuth(false);

    } catch (error) {
        console.error('Error processing token:', error);
        showNotification('error', 'Login Error', 'Token processed but boot failed.');

        // Reset button on fatal error
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fa-brands fa-google"></i> Sign in';
            loginBtn.style.backgroundColor = "";
        }
    }
}

/**
 * Fetch user info (profile) from Google.
 * @returns {Promise} A promise that resolves when user info is fetched.
 */
async function fetchUserInfo() {
    try {
        const tokenObj = gapi.client.getToken();
        if (!tokenObj || !tokenObj.access_token) {
            console.error('No valid token available');
            throw new Error('No valid token available');
        }


        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenObj.access_token}` }
        });

        if (!response.ok) {
            console.error('Failed to fetch user info, status:', response.status);
            throw new Error(`Failed to fetch user info: ${response.status} ${response.statusText}`);
        }

        const userInfo = await response.json();

        const initials = (userInfo.name || userInfo.email)
            .split(' ')
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

        const randomColor = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=${randomColor}&color=ffffff&size=64&bold=true`;

        currentUser = {
            id: userInfo.sub,
            name: userInfo.name || userInfo.email,
            email: userInfo.email,
            picture: userInfo.picture || avatarUrl
        };

        // Update user info in UI
        userName.textContent = currentUser.name;
        userAvatar.src = currentUser.picture;

        return currentUser;
    } catch (error) {
        console.error('Error fetching user info:', error);
        showNotification('error', 'User Info Error', error.message || 'Failed to get user information');
        throw error;
    }
}

function showRegisterUIDDialog() {
    if (!isSignedIn || isAdmin || !currentUser) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // Message for devices that don't support NFC
    const nfcUnsupportedMsg = `
        <div style="text-align: center; padding: 10px; border-radius: 8px; margin-top: 15px;">
            <p style="margin: 0; color: var(--text-color); opacity: 1;">NFC scanning requires <a href="https://play.google.com/store/apps/details?id=com.android.chrome" target="_blank">Chrome on Android</a>.</p>
            <p style="margin: 10px 0 0 0;">You can enter your UID manually.</p>
        </div>`;

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-id-card"></i> Register Your Student ID Card</h3>
        <div class="dialog-content"><p>Your details will be sent to the lecturer for approval.</p>
        <div class="form-group"><label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name:</label><input class="form-control" value="${escapeHtml(currentUser.name)}" disabled></div>
        <div class="form-group"><label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email:</label><input class="form-control" value="${escapeHtml(currentUser.email)}" disabled></div>
        <div class="form-group">
            <label class="dialog-label-fixed" for="register-uid-input"><i class="fa-solid fa-wifi"></i> UID:</label>
            <input type="text" id="register-uid-input" class="form-control" placeholder="AB:CD:12:34">
        </div>
        <div id="nfc-status-container"></div>
        </div><div class="dialog-actions">
            <button id="cancel-register-btn" class="btn-red">Cancel</button>
            <button id="submit-register-btn" class="btn-green" disabled>Submit</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidInput = document.getElementById('register-uid-input');
    const submitBtn = document.getElementById('submit-register-btn');
    const nfcStatusContainer = document.getElementById('nfc-status-container');
    let registrationNfcController = null;

    const closeDialog = () => {
        if (registrationNfcController) registrationNfcController.abort();
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    const checkSubmitButton = () => {
        submitBtn.disabled = uidInput.value.trim() === '';
    };

    uidInput.addEventListener('input', checkSubmitButton);

    // Start scanning if supported
    if (nfcSupported) {
        nfcStatusContainer.innerHTML = `<div class="sync-status syncing" style="justify-content: center; padding: 30px 0; font-size: 1em; color: var(--primary-color);"><i class="fa-solid fa-wifi"></i> <span>Ready to Scan...</span></div>`;
        registrationNfcController = new AbortController();
        const reader = new NDEFReader();
        reader.scan({ signal: registrationNfcController.signal }).then(() => {
            reader.onreading = ({ serialNumber }) => {
                uidInput.value = serialNumber;
                playSound(true);
                nfcStatusContainer.innerHTML = `<div class="sync-status success" style="justify-content: center; padding: 30px 0; font-size: 1em; color: var(--success-color);"><i class="fa-solid fa-circle-check"></i> <span>Card Scanned!</span></div>`;
                checkSubmitButton();
                registrationNfcController.abort(); // Stop scanning after success
            };
        }).catch(err => {
            if (err.name !== 'AbortError') nfcStatusContainer.innerHTML = `<div class="sync-status error" style="justify-content: center; padding: 30px 0; font-size: 1em; color: var(--danger-color);"><i class="fa-solid fa-circle-xmark"></i> <span>Couldn't scan the card. Please make sure NFC is turned on and try again.</span></div>`;
        });
    } else {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            nfcStatusContainer.innerHTML = nfcUnsupportedMsg;
        }
    }

    document.getElementById('submit-register-btn').addEventListener('click', () => {
        const uid = uidInput.value.trim();
        if (!uid || !currentUser) return;

        const submitBtn = document.getElementById('submit-register-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';

        const submitData = {
            action: "submitRegistration", // <-- ADD THIS LINE
            name: currentUser.name,
            email: currentUser.email,
            uid: uid
        };

        // Use fetch to send the data and wait for a real response
        callWebApp('submitRegistration', submitData, 'POST')
            .then(data => { // 'data' is already the parsed result from ContentService
                if (data && data.result === 'success') {
                    showNotification('success', 'Submission Sent!', 'Your Student ID Card application has been sent for approval.');
                    closeDialog();
                } else {
                    const errorMessage = (data && data.message) ? data.message : "An unknown error occurred.";
                    console.error('Script Error:', errorMessage);
                    showNotification('error', 'Submission Failed', errorMessage);
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Submit';
                }
            }).catch(err => {
                console.error('API Error:', err);
                showNotification('error', 'Submission Failed', `A network error occurred: ${err.message}`);
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Submit';
            });
    });

    document.getElementById('cancel-register-btn').addEventListener('click', closeDialog);
}

/**
* Show registration dialog with pre-filled UID (for Admin scanning unknown card)
*/
function showRegisterUIDDialogWithPrefill(prefillUid) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const actionText = isGlobalAdmin ? 'Add to Database' : 'Submit Request';
    const infoText = isGlobalAdmin
        ? 'Add this student directly to the database.'
        : 'Submit a registration request for approval.';

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-address-card"></i> Register Student</h3>
        <div class="dialog-content">
            
            <div class="dialog-disclaimer" style="margin-bottom:15px;">
                <i class="fa-solid fa-circle-info"></i> <strong>New Card:</strong> ${infoText}
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-name"><i class="fa-solid fa-quote-left"></i> Name*</label>
                <input type="text" id="register-name" class="form-control" placeholder="Full Name" autocomplete="off">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-email"><i class="fa-solid fa-at"></i> Email*</label>
                <input type="email" id="register-email" class="form-control" placeholder="student@epoka.edu.al" autocomplete="off">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
                <input type="text" id="register-uid" class="form-control" value="${escapeHtml(prefillUid)}" disabled style="background-color:rgba(0,0,0,0.05); color:var(--text-color); opacity:0.7;">
            </div>

        </div>
        <div class="dialog-actions">
            <button id="cancel-register-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="submit-register-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${actionText}</button>
        </div>
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    document.getElementById('cancel-register-btn').addEventListener('click', closeDialog);

    const submitBtn = document.getElementById('submit-register-btn');
    submitBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('register-name');
        const emailInput = document.getElementById('register-email');
        const uidInput = document.getElementById('register-uid');

        // Clear previous errors
        clearInputError(nameInput);
        clearInputError(emailInput);

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const uid = uidInput.value.trim();

        // Validation
        let hasError = false;
        if (!name) {
            showInputError(nameInput, 'Name is required');
            hasError = true;
        }
        if (!email) {
            showInputError(emailInput, 'Email is required');
            hasError = true;
        } else if (!isValidEmail(email)) {
            showInputError(emailInput, 'Invalid email format');
            hasError = true;
        }

        if (hasError) return;

        // Disable button and show loading
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';

        try {
            const submissionData = {
                name: name,
                email: email,
                uid: uid,
                sentBy: {
                    name: currentUser?.name || '',
                    email: currentUser?.email || ''
                }
            };

            if (isGlobalAdmin) {
                // Global admins add directly
                const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Added', `${name} added to database.`);
                    invalidateDatabaseCache();
                    await fetchDatabaseFromSheet();
                    window.buildUIDToPrimaryUidMap();
                    updateUI();
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Failed to add entry');
                }
            } else {
                // Non-global admins submit request
                const result = await callWebApp('submitRegistration', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Sent', `Registration request sent for ${name}.`);
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Submission failed');
                }
            }
        } catch (error) {
            showNotification('error', 'Error', error.message);
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${actionText}`;
        }
    });
}

/**
 * Checks for duplicates in the local databaseMap.
 * @param {object} entry - The new entry to check {name, email, uid}.
 * @returns {object | null} A match object if found, or null.
 */
function findDuplicateInDatabase(entry) {
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u00e0-\u00f6]/g, "").toLowerCase().trim();
    const newUid = norm(entry.uid);
    const newName = norm(entry.name);
    const newEmail = norm(entry.email);

    for (const [dbKey, studentData] of Object.entries(databaseMap)) {
        const existingUids = studentData.uids.map(norm);
        const existingName = norm(studentData.name);
        const existingEmail = norm(studentData.email);

        const duplicateData = {
            index: dbKey, // This is the PRIMARY KEY from the databaseMap
            name: studentData.name,
            uid: studentData.uids.join(', '),
            email: studentData.email || '',
            rowIndex: parseInt(dbKey) // Use the index as the key
        };

        if (existingUids.includes(newUid)) return { type: 'uid', duplicate: duplicateData };
        if (newEmail && existingEmail && existingEmail === newEmail) return { type: 'email', duplicate: duplicateData };
        if (existingName === newName) return { type: 'name', duplicate: duplicateData };
    }
    return null;
}

/**
 * Creates the warning dialog for adding a new entry that is a duplicate.
 * This version modifies the local databaseMap directly.
 */
function showDuplicateWarningForNewEntry(newData, duplicates, onCompleteCallback) {
    openDialogMode();
    const existing = duplicates[0];
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- Comparison logic ---
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const isNameMatch = norm(newData.name) === norm(existing.name);
    const isEmailMatch = norm(newData.email) === norm(existing.email);
    const existingUids = (existing.uid || '').toString().split(',').map(norm);
    const isUidMatch = existingUids.includes(norm(newData.uid));

    // --- Dynamic HTML ---
    const nameActionHTML = isNameMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(Names match)</span>' :
        `<div class="field-action" style="margin-top: 5px;"><input type="checkbox" id="replace-name-check" data-field="name"><label for="replace-name-check">Replace</label></div>`;

    const emailActionHTML = isEmailMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(Emails match)</span>' :
        `<div class="field-action" style="margin-top: 5px;"><input type="checkbox" id="replace-email-check" data-field="email"><label for="replace-email-check">Replace</label></div>`;

    const uidActionHTML = isUidMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(UID exists)</span>' :
        `<div class="field-action" style="margin-top: 5px;">
            <select id="uid-action-select" class="form-control" style="padding: 4px 8px; font-size: 0.9em;">
                <option value="none" selected>Do Nothing</option>
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
            </select>
        </div>`;

    dialog.innerHTML = `
    <h3 class="dialog-title" style="color: var(--warning-color);"><i class="fa-solid fa-triangle-exclamation"></i> Similar Entry Found</h3>
    <div class="dialog-content">
        <p style="margin-bottom: 15px;">An entry with similar data already exists.</p>
        
        <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">Existing Data</div>
            
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID(s)</label>
                <input class="form-control" value="${escapeHtml(existing.uid)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Entry</div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-quote-left"></i> Name</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.name)}" disabled>
                ${nameActionHTML}
            </div>
        </div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-at"></i> Email</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.email)}" disabled>
                ${emailActionHTML}
            </div>
        </div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-wifi"></i> UID</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.uid)}" disabled>
                ${uidActionHTML}
            </div>
        </div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-red">Cancel</button>
        <button id="add-anyway-btn" class="btn-orange">Add as Separate</button>
        <button id="apply-btn" class="btn-green">Apply Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    const addAnywayBtn = document.getElementById('add-anyway-btn');
    const applyBtn = document.getElementById('apply-btn');
    const actionControls = dialog.querySelectorAll('[data-field="name"], [data-field="email"], #uid-action-select');

    const updateButtonStates = () => {
        const isAnyActionSelected = Array.from(actionControls).some(control =>
            (control.type === 'checkbox' && control.checked) ||
            (control.tagName === 'SELECT' && control.value !== 'none')
        );
        addAnywayBtn.disabled = isAnyActionSelected;
        applyBtn.disabled = !isAnyActionSelected;
    };

    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    updateButtonStates();
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    addAnywayBtn.addEventListener('click', () => {
        const existingKeys = Object.keys(databaseMap).map(Number);
        const newDbKey = existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 1;
        databaseMap[newDbKey] = { name: newData.name, email: newData.email, uids: [newData.uid] };
        showNotification('success', 'Entry Added', `Added ${newData.name} as a separate entry.`);
        onCompleteCallback(); closeDialog();
    });

    applyBtn.addEventListener('click', () => {
        const existingEntryKey = existing.index;
        const existingEntryData = databaseMap[existingEntryKey];
        if (!existingEntryData) { showNotification('error', 'Error', 'Could not find existing entry.'); closeDialog(); return; }

        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');

        if (nameCheck && nameCheck.checked) existingEntryData.name = newData.name;
        if (emailCheck && emailCheck.checked) existingEntryData.email = newData.email;
        if (uidSelect) {
            if (uidSelect.value === 'merge') { if (!existingEntryData.uids.includes(newData.uid)) existingEntryData.uids.push(newData.uid); }
            else if (uidSelect.value === 'replace') { existingEntryData.uids = [newData.uid]; }
        }
        showNotification('success', 'Entry Updated', `Updated details for ${existingEntryData.name}.`);
        onCompleteCallback(); closeDialog();
    });
}

/**
* Formats a date object to ISO 8601 (YYYY-MM-DD HH:mm:ss).
* @param {Date|number} dateInput - The date object or timestamp.
* @returns {string} The formatted string.
*/
function formatISODateTime(dateInput) {
    if (!dateInput) return 'N/A';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'N/A';

    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Attaches click listeners to the clickable pending registration rows.
 */
function attachRegistrationRowListeners() {
    document.querySelectorAll('#registrations-tbody .clickable-request-row').forEach(row => {
        row.addEventListener('click', function (e) {
            e.stopPropagation();
            const data = { ...this.dataset };
            // Parse row number back to an integer
            data.rowNumber = parseInt(data.row, 10);
            showRegistrationDetailsDialog(data);
        });
    });
}

/**
 * Shows a dialog with all details for a registration request.
 */
function showRegistrationDetailsDialog(data) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const formattedTimestamp = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'N/A';

    let actionsHtml = '';
    if (isReadOnly) {
        actionsHtml = `<button id="cancel-details-btn" class="btn-blue">Close</button>`;
    } else {
        actionsHtml = `
    <button id="cancel-details-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Close</button>
    <button id="reject-details-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
    <button id="approve-details-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>`;
    }

    dialog.innerHTML = `
<h3 class="dialog-title">Review Registration</h3>
<div class="dialog-content">
    <div class="form-group" style="align-items: flex-start;">
        <label><i class="fa-solid fa-quote-left"></i> Student:</label>
        <input class="form-control form-group-control" value="${escapeHtml(data.name)}" disabled>
    </div>
    <div class="form-group" style="align-items: flex-start;">
        <label><i class="fa-solid fa-at"></i> Email:</label>
        <input class="form-control form-group-control" value="${escapeHtml(data.email)}" disabled>
    </div>
    <div class="form-group" style="align-items: flex-start;">
        <label><i class="fa-solid fa-wifi"></i> UID:</label>
        <div class="form-group-control dialog-time-pill-container" style="padding-top: 13px; padding-bottom: 13px;">
            <span class="uid-badge" style="font-size: 1.1em; padding: 8px 10px;">${escapeHtml(data.uid)}</span>
        </div>
    </div>
    <div class="form-group" style="align-items: flex-start;">
        <label>Sent By:</label>
        <input class="form-control form-group-control" value="${escapeHtml(data.sentBy)}" disabled>
    </div>
    <div class="form-group" style="align-items: flex-start;">
        <label>Timestamp:</label>
        <input class="form-control form-group-control" value="${formattedTimestamp}" disabled>
    </div>
</div>
<div class="dialog-actions">
    ${actionsHtml}
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    // --- Wire up buttons ---
    dialog.querySelector('#cancel-details-btn').addEventListener('click', closeDialog);

    // These buttons just call the *existing* dialog functions
    dialog.querySelector('#approve-details-btn').addEventListener('click', () => {
        closeDialog();
        showApproveDialog(data); // data = { rowNumber, name, uid, email }
    });

    dialog.querySelector('#reject-details-btn').addEventListener('click', () => {
        closeDialog();
        showRejectDialog(data); // data = { rowNumber, name, email }
    });

    dialog.querySelector('#delete-details-btn').addEventListener('click', () => {
        closeDialog();
        showDeleteDialog(data); // data = { rowNumber, name }
    });
}

/**
 * Shows a simple confirmation dialog to delete a pending registration without sending an email.
 */
function showDeleteDialog(registration) {
    showConfirmationDialog({
        title: 'Delete Registration?',
        message: `Are you sure you want to delete the pending registration for "${escapeHtml(registration.name)}"?<br><br><strong>This will not send an email.</strong>`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: () => {
            // Call the new backend action
            callWebApp('deleteRegistration', { rowNumber: registration.rowNumber }, 'POST')
                .then(result => {
                    if (result && result.result === 'success') {
                        showNotification('delete', 'Deleted', `Registration for ${registration.name} was deleted.`);
                        refreshAdminViews(); // Refresh the list
                    } else {
                        throw new Error(result ? result.message : 'Delete failed.');
                    }
                })
                .catch(err => {
                    showNotification('error', 'Delete Failed', err.message);
                });
        }
    });
}


/**
 * Shows an editable dialog to approve a registration with loading feedback.
 */
function showApproveDialog(registration) {
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u00e0-\u00f6]/g, "").toLowerCase().trim();
    const newUid = norm(registration.uid);
    const newName = norm(registration.name);
    const newEmail = norm(registration.email);

    let match = null;

    // Iterate through the local database to find a match
    for (const [dbKey, studentData] of Object.entries(databaseMap)) {
        const existingUids = studentData.uids.map(norm);
        const existingName = norm(studentData.name);
        const existingEmail = norm(studentData.email);

        const duplicateData = {
            index: dbKey,
            name: studentData.name,
            uid: studentData.uids.join(', '),
            email: studentData.email || '',
            rowIndex: parseInt(dbKey) + 1 // Approximate rowIndex for consistency
        };

        // Priority 1: UID Match
        if (existingUids.includes(newUid)) {
            match = { type: 'uid', duplicate: duplicateData };
            break;
        }
        // Priority 2: Email Match
        if (newEmail && existingEmail && existingEmail === newEmail) {
            match = { type: 'email', duplicate: duplicateData };
            break;
        }
        // Priority 3: Name Match
        if (existingName === newName) {
            if (!match) {
                match = { type: 'name', duplicate: duplicateData };
            }
        }
    }

    // --- DECISION POINT ---
    if (match) {
        // A duplicate was found, show the interactive warning dialog
        showDuplicateWarningDialog(registration, [match.duplicate]);
    } else {
        // No duplicates found, show the simple final approval dialog
        showFinalApprovalDialog(registration);
    }
}

/**
 * Step 2: Shows the final editable approval dialog for non-duplicate entries.
 */
function showFinalApprovalDialog(registration) {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
    <h3 class="dialog-title">Approve Application</h3>
    <div class="dialog-content">
        <p style="margin-bottom:15px;">Please review and confirm the details below.</p>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-name"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input type="text" id="approve-name" class="form-control" value="${escapeHtml(registration.name)}">
        </div>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-email"><i class="fa-solid fa-at"></i> Email</label>
            <input type="email" id="approve-email" class="form-control" value="${escapeHtml(registration.email)}">
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-uid"><i class="fa-solid fa-wifi"></i> UID</label>
            <input type="text" id="approve-uid" class="form-control" value="${escapeHtml(registration.uid)}" disabled>
        </div>
        
    </div> 
    <div class="dialog-actions">
        <button id="cancel-approve-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="confirm-approve-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    document.getElementById('cancel-approve-btn').addEventListener('click', closeDialog);

    const confirmBtn = document.getElementById('confirm-approve-btn');
    confirmBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('approve-name');
        const emailInput = document.getElementById('approve-email');
        clearInputError(nameInput); clearInputError(emailInput);

        const finalName = nameInput.value.trim();
        const finalEmail = emailInput.value.trim();
        let isValid = true;
        if (finalName === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(finalEmail)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!isValid) return;

        confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...';
        const finalData = { action: 'approveRegistration', approvalMode: 'final_approve', name: finalName, uid: registration.uid, email: finalEmail, rowNumber: registration.rowNumber };
        if (!currentCourse) return;
        callWebApp('approveRegistration', finalData, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Approved!', `${finalData.name} has been added to the database.`);
                invalidateDatabaseCache(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Approval failed.'); }
        }).catch(err => { showNotification('error', 'Approval Failed', err.message); confirmBtn.disabled = false; confirmBtn.innerHTML = 'Approve'; });
    });
}

/**
* Creates the special dialog for handling duplicate registrations.
*/
function showDuplicateWarningDialog(newData, duplicates) {
    openDialogMode();
    const existing = duplicates[0];
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- Core comparison logic ---
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const isNameMatch = norm(newData.name) === norm(existing.name);
    const isEmailMatch = norm(newData.email) === norm(existing.email);
    const existingUids = (existing.uid || '').toString().split(',').map(norm);
    const isUidMatch = existingUids.includes(norm(newData.uid));

    // --- Dynamic HTML for checkboxes ---
    // Note: We use flex-end justification to align actions to the right
    const nameActionHTML = isNameMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(Names match)</span>' :
        `<div class="field-action" style="margin-top: 5px;"><input type="checkbox" id="replace-name-check" data-field="name"><label for="replace-name-check">Replace</label></div>`;

    const emailActionHTML = isEmailMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(Emails match)</span>' :
        `<div class="field-action" style="margin-top: 5px;"><input type="checkbox" id="replace-email-check" data-field="email"><label for="replace-email-check">Replace</label></div>`;

    const uidActionHTML = isUidMatch ?
        '<span style="opacity: 0.6; font-size: 0.9em; margin-top: 5px; text-align: right;">(UID exists)</span>' :
        `<div class="field-action" style="margin-top: 5px;">
            <select id="uid-action-select" class="form-control" style="padding: 4px 8px; font-size: 0.9em;">
                <option value="none" selected>Do Nothing</option>
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
            </select>
        </div>`;

    dialog.innerHTML = `
    <h3 class="dialog-title" style="color: var(--warning-color);"><i class="fa-solid fa-triangle-exclamation"></i> Similar Entry Found</h3>
    <div class="dialog-content">
        <p style="margin-bottom: 15px;">An entry with similar data already exists.</p>
        
        <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">Existing Data</div>
            
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID(s)</label>
                <input class="form-control" value="${escapeHtml(existing.uid)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Application</div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-quote-left"></i> Name</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.name)}" disabled>
                ${nameActionHTML}
            </div>
        </div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-at"></i> Email</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.email)}" disabled>
                ${emailActionHTML}
            </div>
        </div>
        
        <div class="form-group" style="align-items: flex-start;">
            <label class="dialog-label-fixed" style="margin-top: 10px;"><i class="fa-solid fa-wifi"></i> UID</label>
            <div style="flex-grow: 1;">
                <input class="form-control" value="${escapeHtml(newData.uid)}" disabled>
                ${uidActionHTML}
            </div>
        </div>

    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="add-anyway-btn" class="btn-orange"><i class="fa-solid fa-user-plus"></i> Add as Separate</button>
        <button id="replace-btn" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Apply Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    const addAnywayBtn = document.getElementById('add-anyway-btn');
    const replaceBtn = document.getElementById('replace-btn');
    const actionControls = dialog.querySelectorAll('[data-field="name"], [data-field="email"], #uid-action-select');

    // Function to manage button states
    const updateButtonStates = () => {
        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');

        const isAnyActionSelected = (nameCheck && nameCheck.checked) ||
            (emailCheck && emailCheck.checked) ||
            (uidSelect && uidSelect.value !== 'none');

        addAnywayBtn.disabled = isAnyActionSelected;
        replaceBtn.disabled = !isAnyActionSelected;
    };

    // Attach listeners and initialize states
    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    updateButtonStates(); // Set initial state
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    // "Add as Separate" button listener
    addAnywayBtn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
        const payload = { ...newData, approvalMode: 'add_new_separate' };
        if (!currentCourse) return;
        callWebApp('approveRegistration', payload, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Action Complete', `Registration for ${newData.name} has been processed.`);
                invalidateDatabaseCache(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Action failed'); }
        }).catch(err => { showNotification('error', 'Action Failed', err.message); button.disabled = false; button.innerHTML = 'Add as Separate'; });
    });

    replaceBtn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');
        const updates = {};
        if (nameCheck && nameCheck.checked) updates.name = newData.name;
        if (emailCheck && emailCheck.checked) updates.email = newData.email;
        if (uidSelect && uidSelect.value !== 'none') updates.uid_action = uidSelect.value;

        const payload = { ...newData, action: 'approveRegistration', approvalMode: 'custom_replace', duplicateRowIndex: existing.rowIndex, updates: updates };
        button.disabled = true; button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...`;
        callWebApp('approveRegistration', payload, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Action Complete', 'The entry has been updated.');
                invalidateDatabaseCache(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Action failed'); }
        }).catch(err => { showNotification('error', 'Action Failed', err.message); button.disabled = false; button.innerHTML = 'Replace Selected'; });
    });
}

/**
 * Helper function to smoothly refresh both admin lists.
 */
async function refreshAdminViews() {
    if (!isAdmin) return;

    // 1. Show Loading State
    updateAdminDashboardBar(0, 0, true);

    try {
        // 2. Fetch Data
        const [registrations, absences] = await Promise.all([
            callWebApp('getPendingRegistrations', {}, 'POST'),
            callWebApp('getPendingAbsences', {}, 'POST')
        ]);

        // Only count registrations if the user is a Global Admin
        const regCount = isGlobalAdmin ? registrations.length : 0;
        const absCount = absences.length;

        globalNotificationCount = regCount + absCount;
        updatePageTitle();

        // 3. Update the Bar
        updateAdminDashboardBar(absCount, registrations.length, false);

        // 4. Automatically collapse views if they are empty
        if (regCount === 0) {
            const regView = document.getElementById('pending-registrations-view');
            if (regView) regView.classList.remove('expanded');
        }

        if (absCount === 0) {
            const absView = document.getElementById('pending-absences-view');
            if (absView) absView.classList.remove('expanded');
        }

        // 5. Render Tables
        renderRegistrationsTable(registrations);
        renderAbsencesTable(absences);

    } catch (e) {
        console.error("Error refreshing admin views", e);
        updateAdminDashboardBar(0, 0, false);
    }
}

/**
 * Silent refresh - updates admin dashboard without showing loading spinner.
 * Used for background polling to avoid disrupting the user.
 */
async function silentRefreshAdminViews() {
    if (!isAdmin || !isOnline || !isSignedIn) return;

    try {
        const [registrations, absences] = await Promise.all([
            callWebApp('getPendingRegistrations', {}, 'POST'),
            callWebApp('getPendingAbsences', {}, 'POST')
        ]);

        const regCount = isGlobalAdmin ? registrations.length : 0;
        const absCount = absences.length;
        const newTotal = regCount + absCount;

        // Only update UI if counts changed
        if (newTotal !== globalNotificationCount) {
            globalNotificationCount = newTotal;
            updatePageTitle();
            updateAdminDashboardBar(absCount, registrations.length, false);
            renderRegistrationsTable(registrations);
            renderAbsencesTable(absences);

            // Notify user if new requests came in
            if (newTotal > 0) {
                console.log(`[Auto-Refresh] Updated: ${absCount} absences, ${regCount} registrations`);
            }
        }
    } catch (e) {
        console.warn("Silent admin refresh failed:", e.message);
    }
}

/**
 * Starts the auto-refresh interval for admin dashboard.
 */
function startAdminAutoRefresh() {
    if (adminAutoRefreshInterval) return; // Already running
    if (!isAdmin) return;

    console.log("[Admin Auto-Refresh] Started (every 30s)");
    adminAutoRefreshInterval = setInterval(silentRefreshAdminViews, ADMIN_REFRESH_INTERVAL);
}

/**
 * Stops the auto-refresh interval for admin dashboard.
 */
function stopAdminAutoRefresh() {
    if (adminAutoRefreshInterval) {
        clearInterval(adminAutoRefreshInterval);
        adminAutoRefreshInterval = null;
        console.log("[Admin Auto-Refresh] Stopped");
    }
}

function renderRegistrationsTable(registrations) {
    const tbody = document.getElementById('registrations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!registrations || registrations.length === 0) return;

    registrations.forEach(reg => {
        const row = document.createElement('tr');
        // REMOVED: row.className = 'clickable-request-row'; 
        // This prevents the pointer cursor and the hover effect

        let formattedTimestamp = reg.timestamp ? new Date(reg.timestamp).toLocaleString() : 'N/A';

        row.innerHTML = `
            <td>${escapeHtml(reg.name) || 'N/A'}</td>
            <td><span class="uid-badge">${escapeHtml(reg.uid) || 'N/A'}</span></td>
            <td style="font-size: 0.9em;">${escapeHtml(reg.email) || 'N/A'}</td>
            <td style="font-size: 0.9em;">${escapeHtml(formattedTimestamp)}</td>
            <td style="font-size: 0.9em;">${escapeHtml(reg.sentBy) || 'Unknown'}</td>
            <td class="actions-cell">
                <div class="actions-cell-content">
                    <button class="btn-icon btn-green approve-reg-btn" title="Approve"><i class="fa-solid fa-check"></i></button>
                    <button class="btn-icon btn-red reject-reg-btn" title="Reject"><i class="fa-solid fa-ban"></i></button>
                </div>
            </td>
        `;

        // Attach inline listeners ONLY for buttons
        const approveBtn = row.querySelector('.approve-reg-btn');
        approveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showApproveDialog(reg);
        });

        const rejectBtn = row.querySelector('.reject-reg-btn');
        rejectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showRejectDialog(reg);
        });

        tbody.appendChild(row);
    });

}

function renderAbsencesTable(requests) {
    const tbody = document.getElementById('absences-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!requests || requests.length === 0) return;

    requests.forEach(req => {
        const row = document.createElement('tr');
        row.className = 'clickable-request-row';

        // Add Session to dataset
        row.dataset.requestId = req.requestID;
        row.dataset.studentName = req.name;
        row.dataset.studentEmail = req.email;
        row.dataset.course = req.course;
        row.dataset.session = req.session || '';
        row.dataset.absenceDate = req.absenceDate;
        row.dataset.hours = req.hours;
        row.dataset.reasonType = req.reasonType;
        row.dataset.description = req.description;
        row.dataset.attachmentUrl = req.attachmentURL || req.attachmentUrl || '';

        // Create Session Badge (Cat Label style)
        let sessionBadge = '';
        if (req.session && req.session !== 'Default') {
            sessionBadge = `<span style="background:#e3f2fd; color:var(--primary-color); font-weight:700; font-size:0.75em; padding:2px 6px; border-radius:4px; text-transform:uppercase; margin-left:5px;">${escapeHtml(req.session)}</span>`;
        }

        row.innerHTML = `
            <td>
                <div>${escapeHtml(req.name)}</div>
                <small style="opacity:0.7">${escapeHtml(req.email)}</small>
            </td>
            <td>
                ${escapeHtml(req.course.replace(/_/g, ' '))}
                ${sessionBadge}
            </td>
            <td>${escapeHtml(req.absenceDate)}</td>
            <td class="times-cell">${formatHoursAsPills(req.hours)}</td>
            <td>${escapeHtml(req.reasonType)}</td>
            <td class="actions-cell">
                <div class="actions-cell-content">
                    <button class="btn-icon btn-red delete-absence-btn" title="Delete Request" data-request-id="${req.requestID}" data-student-name="${escapeHtml(req.name)}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>`;
        tbody.appendChild(row);
    });
    attachPermissionRowListeners();
    attachAbsenceActionListeners();
}

/**
 * Attaches click listeners to the clickable pending permission rows.
 */
function attachPermissionRowListeners() {
    document.querySelectorAll('.clickable-request-row').forEach(row => {
        row.addEventListener('click', function (e) {
            // --- Do not open dialog if a button inside the row was clicked ---
            if (e.target.closest('button')) {
                return;
            }

            e.stopPropagation();
            const data = { ...this.dataset };
            showPermissionDetailsDialog(data);
        });
    });
}

/**
 * Attaches click listeners to the approve/reject/delete absence buttons.
 */
function attachAbsenceActionListeners() {
    // Delete buttons (Approve/Reject are now in the dialog)
    document.querySelectorAll('.delete-absence-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const data = { ...this.dataset }; // Clone data
            showDeleteAbsenceDialog(data);
        });
    });
}

/**
* Shows a dialog with full details of a permission request.
* Used by both the Pending list and History list.
*/
function showPermissionDetailsDialog(data, isReadOnly = false) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    let attachmentHtml = '<span style="opacity:0.5; font-style:italic;">No attachment</span>';
    if (data.attachmentUrl) {
        attachmentHtml = `<a href="${data.attachmentUrl}" target="_blank" class="btn-attachment"><i class="fa-solid fa-paperclip"></i> View Document</a>`;
    }

    // Determine Action Buttons based on context
    let actionsHtml = '';
    if (isReadOnly) {
        actionsHtml = `<button id="close-details-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Close</button>`;
    } else {
        actionsHtml = `
            <button id="close-details-btn" class="btn-blue" style="margin-right:auto;"><i class="fa-solid fa-xmark"></i> Close</button>
            <button id="reject-req-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
            <button id="approve-req-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
        `;
    }

    // Handle session badge if present
    let sessionHtml = '';
    if (data.session && data.session !== 'Default') {
        sessionHtml = `<span style="background:#e3f2fd; color:var(--primary-color); font-weight:700; font-size:0.8em; padding:2px 8px; border-radius:4px; margin-left:10px;">${escapeHtml(data.session)}</span>`;
    }

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-circle-info"></i> Request Details</h3>
        <div class="dialog-content">
            <div class="form-group" style="align-items: flex-start;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-user"></i> Student</label>
                <div class="form-control" style="background:#f9f9f9; border:none;">
                    <strong>${escapeHtml(data.studentName)}</strong><br>
                    <small style="opacity:0.7">${escapeHtml(data.studentEmail)}</small>
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
                <div class="form-control" style="background:#f9f9f9; border:none; display:flex; align-items:center;">
                    ${escapeHtml(data.course ? data.course.replace(/_/g, ' ') : 'N/A')}
                    ${sessionHtml}
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-regular fa-clock"></i> Date/Time</label>
                <input class="form-control" value="${escapeHtml(data.absenceDate)} (${escapeHtml(data.hours)})" disabled>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-tag"></i> Reason</label>
                <input class="form-control" value="${escapeHtml(data.reasonType)}" disabled>
            </div>

            <div class="form-group" style="align-items:flex-start;">
                <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-align-left"></i> Description</label>
                <textarea class="form-control" rows="3" disabled>${escapeHtml(data.description || 'No description provided.')}</textarea>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-paperclip"></i> Proof</label>
                <div style="flex-grow:1;">${attachmentHtml}</div>
            </div>
        </div>
        <div class="dialog-actions">
            ${actionsHtml}
        </div>
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    document.getElementById('close-details-btn').addEventListener('click', closeDialog);

    if (!isReadOnly) {
        document.getElementById('approve-req-btn').addEventListener('click', () => {
            closeDialog();
            showApproveAbsenceDialog(data);
        });

        document.getElementById('reject-req-btn').addEventListener('click', () => {
            closeDialog();
            showRejectAbsenceDialog(data);
        });
    }
}

/**
* Shows the dialog for students to request an excused absence.
*/
function showRequestPermissionDialog() {
    if (!isSignedIn || isAdmin || !currentUser) return;

    const getLocalDateString = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const today = new Date();
    const minDateStr = getLocalDateString(addBusinessDays(today, -2));
    const maxDateStr = getLocalDateString(addBusinessDays(today, 7));
    const todayStr = getLocalDateString(today);

    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');

    const courseOptions = Object.keys(courseInfoMap).sort().map(courseName =>
        `<option value="${escapeHtml(courseName)}">${courseName.replace(/_/g, ' ')}</option>`
    ).join('');

    const hoursList = ['8:40–9:30', '9:40–10:30', '10:40–11:30', '11:40–12:30', '12:40–13:30', '13:40–14:30', '14:40–15:30', '15:40–16:30', '16:00–16:50', '17:00–17:50', '18:00–18:50', '19:00–19:50'];
    const hourButtons = hoursList.map(h => `<button type="button" class="toggle-button" data-value="${h}" style="font-family:'Google Sans Flex', sans-serif; overflow:visible; text-overflow:clip; font-size:0.8em; padding:10px 2px;">${h}</button>`).join('');




    dialog.innerHTML = `
<h3 class="dialog-title"><i class="fa-solid fa-hand-point-up"></i> Request for Permission</h3>
<div class="dialog-content">

<div class="dialog-disclaimer">
        <i class="fa-solid fa-circle-info"></i> Per university regulations, absences are unexcused by default. Although missing a few classes is normal, this form is provided as a professional courtesy.
    </div>
    
    <div class="form-section-title" style="margin-top:0;">Details</div>
    
    <div class="form-group required">
        <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
        <select id="request-course" class="form-control form-group-control">
            <option value="" disabled selected>Select Course...</option>
            ${courseOptions}
        </select>
    </div>

    <div id="request-session-container" style="display:none; margin-bottom:15px;">
        <div class="form-group required" style="align-items:flex-start;">
            <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-users"></i> Group</label>
            <div style="flex-grow:1;">
                <div id="req-session-wrapper"></div>
            </div>
        </div>
    </div>

    <div class="form-group required" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-regular fa-calendar-days"></i> Date</label>
        <div class="form-group-control">
            <input type="date" id="request-date" class="form-control" value="" min="${minDateStr}" max="${maxDateStr}" required>
            <small style="color:#666; font-size:0.8em; display:block; margin-top:4px;">
                <i class="fa-solid fa-circle-info"></i> Select the date you were (or will be) absent.
            </small>
        </div>
    </div>

    <div class="form-group required" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-regular fa-clock"></i> Hours</label>
        <div id="request-hours-group" class="form-group-control" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
            ${hourButtons}
        </div>
    </div>


    <div class="form-section-title">Reason</div>

    <div id="reason-grid" class="reason-grid">
        <div class="reason-card" data-value="Medical">
            <i class="fa-solid fa-bed"></i>
            <span>Calling Sick</span>
        </div>
        <div class="reason-card" data-value="Conference">
            <i class="fa-solid fa-person-chalkboard"></i>
            <span>Academic Event</span>
        </div>
        <div class="reason-card" data-value="Official">
            <i class="fa-solid fa-person-military-pointing"></i>
            <span>Official Appointment</span>
        </div>
        <div class="reason-card" data-value="Bus">
            <i class="fa-solid fa-bus"></i>
            <span>Bus Issue</span>
        </div>
        <div class="reason-card" data-value="Club">
            <i class="fa-solid fa-people-robbery"></i>
            <span>Student Event</span>
        </div>
        <div class="reason-card" data-value="Confidential">
            <i class="fa-solid fa-user-tie"></i>
            <span>Personal Matter</span>
        </div>
    </div>
    
    <div id="reason-help-text" style="display:none; background-color:#e3f2fd; color:#0d47a1; padding:12px; border-radius:8px; margin-bottom:15px; font-size:0.9em; line-height:1.4; border-left:4px solid #2196F3;"></div>

    <div class="form-group" id="request-file-group" style="display:none; align-items:flex-start;">
        <label class="dialog-label-fixed" id="request-file-label" style="margin-top:10px;">Document</label>
        <div class="form-group-control">
           <input type="file" id="request-file-upload" class="form-control" accept=".pdf,image/*">
           <small style="opacity:0.7;">Max 10MB</small>
        </div>
    </div>

    <div class="form-group" id="request-expl-group" style="display:none; align-items:flex-start;">
        <label class="dialog-label-fixed" id="request-expl-label" style="margin-top:10px;">Details</label>
        <textarea id="request-explanation" class="form-control form-group-control" rows="3"></textarea>
    </div>

    <div class="form-section-title" style="margin-top:20px;">Verification</div>
    <div class="form-group" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-calculator"></i> Solve</label>
        <div class="form-group-control">
            <div id="captcha-question" style="font-size:1.2em; font-weight:600; margin-bottom:10px; font-family:'Google Sans Code', monospace; background:var(--card-background); color:var(--text-color); padding:10px 15px; border-radius:8px; text-align:center; border:1px solid var(--border-color, #ddd);-webkit-user-select: none;
            /* Safari */
            -moz-user-select: none;
            /* Firefox */
            -ms-user-select: none;
            /* IE10+/Edge */
            user-select: none;
            /* Standard */"></div>
            <div id="captcha-choices" class="course-buttons-container" style="margin-bottom:0; gap:8px; flex-wrap:nowrap;"></div>
        </div>
    </div>

</div>
<div class="dialog-actions">
    <button id="cancel-request-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="submit-request-btn" class="btn-green" disabled><i class="fa-solid fa-paper-plane"></i> Submit</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Variables ---
    const courseSelect = document.getElementById('request-course');
    const sessionContainer = document.getElementById('request-session-container');
    const sessionWrapper = document.getElementById('req-session-wrapper');
    const reasonGrid = document.getElementById('reason-grid');
    const helpText = document.getElementById('reason-help-text');
    const fileGroup = document.getElementById('request-file-group');
    const fileLabel = document.getElementById('request-file-label');
    const explGroup = document.getElementById('request-expl-group');
    const explLabel = document.getElementById('request-expl-label');
    const explInput = document.getElementById('request-explanation');
    const submitBtn = document.getElementById('submit-request-btn');
    const hoursGroup = document.getElementById('request-hours-group');

    let selectedReason = null;
    let captchaAnswer = null;
    let captchaSolved = false;

    // --- CAPTCHA LOGIC ---
    function generateCaptcha() {
        captchaSolved = false;
        const captchaChoices = document.getElementById('captcha-choices');
        const captchaQuestion = document.getElementById('captcha-question');

        // Generate complex math expression with random templates
        const ops = ['+', '−', '×'];
        const getOp = () => ops[Math.floor(Math.random() * ops.length)];
        const getNum = (max = 10) => Math.floor(Math.random() * max) + 1;
        const toJs = (op) => op === '−' ? '-' : op === '×' ? '*' : '+';

        // Random numbers
        const a = getNum(12), b = getNum(10), c = getNum(8), d = getNum(6), e = getNum(5);
        const op1 = getOp(), op2 = getOp(), op3 = getOp();

        // Different expression templates
        const templates = [
            // (a op b) op c × d
            { display: `(${a} ${op1} ${b}) ${op2} ${c} × ${d}`, js: `(${a} ${toJs(op1)} ${b}) ${toJs(op2)} ${c} * ${d}` },
            // a × (b op c) op d
            { display: `${a} × (${b} ${op1} ${c}) ${op2} ${d}`, js: `${a} * (${b} ${toJs(op1)} ${c}) ${toJs(op2)} ${d}` },
            // a op b × (c op d)
            { display: `${a} ${op1} ${b} × (${c} ${op2} ${d})`, js: `${a} ${toJs(op1)} ${b} * (${c} ${toJs(op2)} ${d})` },
            // (a op b) × (c op d)
            { display: `(${a} ${op1} ${b}) × (${c} ${op2} ${d})`, js: `(${a} ${toJs(op1)} ${b}) * (${c} ${toJs(op2)} ${d})` },
            // a × b op c × d
            { display: `${a} × ${b} ${op1} ${c} × ${d}`, js: `${a} * ${b} ${toJs(op1)} ${c} * ${d}` },
            // (a op b op c) × d
            { display: `(${a} ${op1} ${b} ${op2} ${c}) × ${d}`, js: `(${a} ${toJs(op1)} ${b} ${toJs(op2)} ${c}) * ${d}` },
            // a op (b × c op d)
            { display: `${a} ${op1} (${b} × ${c} ${op2} ${d})`, js: `${a} ${toJs(op1)} (${b} * ${c} ${toJs(op2)} ${d})` },

            // TEMPLATES
            // a + b + c + d
            { display: `${a} + ${b} + ${c} + ${d}`, js: `${a} + ${b} + ${c} + ${d}` },
            // (a + b) × (c - d)
            { display: `(${a} + ${b}) × (${c} − ${d})`, js: `(${a} + ${b}) * (${c} - ${d})` },
            // a × b − c × d
            { display: `${a} × ${b} − ${c} × ${d}`, js: `${a} * ${b} - ${c} * ${d}` },
            // (a × b) + (c × d)
            { display: `(${a} × ${b}) + (${c} × ${d})`, js: `(${a} * ${b}) + (${c} * ${d})` },
            // a + (b × c) - d
            { display: `${a} + (${b} × ${c}) − ${d}`, js: `${a} + (${b} * ${c}) - ${d}` },
            // (a - b) × (c + d)
            { display: `(${a} − ${b}) × (${c} + ${d})`, js: `(${a} - ${b}) * (${c} + ${d})` },
            // a × b + c - d
            { display: `${a} × ${b} + ${c} − ${d}`, js: `${a} * ${b} + ${c} - ${d}` },
            // a + b × c + d
            { display: `${a} + ${b} × ${c} + ${d}`, js: `${a} + ${b} * ${c} + ${d}` },
            // (a + b + c) × d
            { display: `(${a} + ${b} + ${c}) × ${d}`, js: `(${a} + ${b} + ${c}) * ${d}` },
            // a × (b - c) + d
            { display: `${a} × (${b} − ${c}) + ${d}`, js: `${a} * (${b} - ${c}) + ${d}` },
            // a - b + c - d
            { display: `${a} − ${b} + ${c} − ${d}`, js: `${a} - ${b} + ${c} - ${d}` },
            // a × (b + c + d)
            { display: `${a} × (${b} + ${c} + ${d})`, js: `${a} * (${b} + ${c} + ${d})` },
            // (a - b) - (c - d)
            { display: `(${a} − ${b}) − (${c} − ${d})`, js: `(${a} - ${b}) - (${c} - ${d})` },
            // a × b × c - d
            { display: `${a} × ${b} × ${c} − ${d}`, js: `${a} * ${b} * ${c} - ${d}` },
            // a + b - (c × d)
            { display: `${a} + ${b} − (${c} × ${d})`, js: `${a} + ${b} - (${c} * ${d})` },
            // (a × b) - (c + d)
            { display: `(${a} × ${b}) − (${c} + ${d})`, js: `(${a} * ${b}) - (${c} + ${d})` },
            // a × b × (c - d)
            { display: `${a} × ${b} × (${c} − ${d})`, js: `${a} * ${b} * (${c} - ${d})` },
            // (a + b) × c - d
            { display: `(${a} + ${b}) × ${c} − ${d}`, js: `(${a} + ${b}) * ${c} - ${d}` },
        ];

        const template = templates[Math.floor(Math.random() * templates.length)];
        captchaAnswer = eval(template.js);
        captchaQuestion.textContent = template.display + ' = ?';

        // Generate choices: 1 correct + 3 wrong
        const wrongAnswers = new Set();
        while (wrongAnswers.size < 3) {
            const offset = Math.floor(Math.random() * 40) - 20; // Random offset between -20 and +20
            const wrong = captchaAnswer + offset;
            if (wrong !== captchaAnswer && !wrongAnswers.has(wrong)) {
                wrongAnswers.add(wrong);
            }
        }

        const allChoices = [captchaAnswer, ...wrongAnswers];
        // Shuffle
        for (let i = allChoices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
        }

        captchaChoices.innerHTML = allChoices.map(val =>
            `<div class="course-button captcha-choice" data-value="${val}" style="flex:1; min-width:0; padding:10px 8px; justify-content:center;">${val}</div>`
        ).join('');


        // Reset visual state
        captchaChoices.querySelectorAll('.captcha-choice').forEach(btn => {
            btn.classList.remove('active', 'correct', 'incorrect');
        });
    }

    // Initialize captcha
    generateCaptcha();

    // Handle captcha choice clicks
    document.getElementById('captcha-choices').addEventListener('click', (e) => {
        const btn = e.target.closest('.captcha-choice');
        if (!btn || captchaSolved) return;

        const chosen = parseInt(btn.dataset.value, 10);

        // Reset all buttons
        document.querySelectorAll('.captcha-choice').forEach(b => b.classList.remove('active', 'correct', 'incorrect'));

        if (chosen === captchaAnswer) {
            btn.classList.add('active', 'correct');
            btn.style.background = '#4caf50';
            btn.style.color = '#fff';
            captchaSolved = true;
        } else {
            btn.classList.add('incorrect');
            btn.style.background = '#f44336';
            btn.style.color = '#fff';
            // Generate new captcha after wrong answer
            setTimeout(() => {
                generateCaptcha();
            }, 1500);
        }
    });

    // --- SESSION SELECTOR LOGIC ---
    courseSelect.addEventListener('change', () => {
        const courseName = courseSelect.value;
        if (!courseName) return;

        const rawSections = courseInfoMap[courseName]?.availableSections || '';
        const sectionsMap = parseAvailableSections(rawSections);
        const categories = Object.keys(sectionsMap);

        if (categories.length > 0) {
            sessionContainer.style.display = 'block';

            let html = `<div id="req-session-controls" style="margin-top:5px;">`;
            html += `<input type="hidden" id="req-selected-session" value="">`;

            const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };
            let catHtml = '';
            categories.forEach((cat, idx) => {
                const icon = icons[cat.toLowerCase()] || 'fa-tag';
                catHtml += `<div class="course-button ${idx === 0 ? 'active' : ''}" data-type="cat" data-val="${cat}" style="flex:1; padding:8px 5px; font-size:0.9em; min-width:0;"><i class="fa-solid ${icon}"></i>&nbsp;${cat}</div>`;
            });
            html += `<div class="course-buttons-container" id="req-cat-row" style="display:flex; margin-bottom:8px; gap:5px; flex-wrap:nowrap;">${catHtml}</div>`;

            categories.forEach((cat, idx) => {
                const groups = sectionsMap[cat] || [];
                if (groups.length > 0) {
                    let grpHtml = '';
                    groups.forEach((grp, gIdx) => {
                        grpHtml += `<div class="course-button ${gIdx === 0 ? 'active' : ''}" data-type="grp" data-val="${grp}" style="min-width:35px; padding:8px 0; justify-content:center;"><b>${grp}</b></div>`;
                    });

                    const isInitialActive = (idx === 0);
                    const hasMultipleGroups = (groups.length > 1);
                    const grpDisplay = (isInitialActive && hasMultipleGroups) ? 'flex' : 'none';

                    html += `<div class="course-buttons-container req-grp-row" id="req-grp-${cat}" data-has-multiple="${hasMultipleGroups}" style="display:${grpDisplay}; gap:5px; margin-bottom:0;">${grpHtml}</div>`;
                }
            });
            html += `</div>`;
            sessionWrapper.innerHTML = html;

            updateRequestSessionValue();

            const catRow = document.getElementById('req-cat-row');
            catRow.addEventListener('click', (e) => {
                const btn = e.target.closest('.course-button');
                if (!btn) return;
                catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cat = btn.dataset.val;

                sessionWrapper.querySelectorAll('.req-grp-row').forEach(row => row.style.display = 'none');
                const targetRow = document.getElementById(`req-grp-${cat}`);

                if (targetRow && targetRow.dataset.hasMultiple === 'true') {
                    targetRow.style.display = 'flex';
                }
                updateRequestSessionValue();
            });

            sessionWrapper.querySelectorAll('.req-grp-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    const btn = e.target.closest('.course-button');
                    if (!btn) return;
                    row.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateRequestSessionValue();
                });
            });

        } else {
            sessionContainer.style.display = 'none';
            sessionWrapper.innerHTML = '';
        }
    });

    function updateRequestSessionValue() {
        const catBtn = document.querySelector('#req-cat-row .active');
        if (!catBtn) return;
        const cat = catBtn.dataset.val;

        const grpRow = document.getElementById(`req-grp-${cat}`);
        let session = cat;

        if (grpRow) {
            const grpBtn = grpRow.querySelector('.active');
            if (grpBtn) session += ' ' + grpBtn.dataset.val;
        }
        document.getElementById('req-selected-session').value = session;
    }

    // --- Hours Logic ---
    courseSelect.addEventListener('change', () => {
        hoursGroup.querySelectorAll('.active').forEach(b => b.classList.remove('active'));
    });

    hoursGroup.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-button')) {
            if (!courseSelect.value) {
                showNotification('warning', 'Missing Info', 'Select a course first.');
                return;
            }
            e.target.classList.toggle('active');
        }
    });

    // --- REASON LOGIC ---
    reasonGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.reason-card');
        if (!card) return;

        document.querySelectorAll('.reason-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedReason = card.dataset.value;

        // 1. RESET EVERYTHING
        helpText.style.display = 'none';
        helpText.style.background = '#e3f2fd'; // Reset info blue
        helpText.style.color = '#0d47a1';
        helpText.style.borderLeftColor = '#2196F3';

        fileGroup.style.display = 'none';
        explGroup.style.display = 'none';
        submitBtn.disabled = false;
        explInput.value = '';
        explInput.removeAttribute('minlength');
        explInput.placeholder = "";

        // Reset Labels
        fileLabel.innerHTML = 'Document';
        explLabel.innerHTML = 'Details';

        // 2. APPLY LOGIC
        switch (selectedReason) {
            case 'Medical': // Calling Sick
                // File Required, Expl Optional
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Medical Report <span style="color:red">*</span>';

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation';

                helpText.innerHTML = `Please attach your Medical Report (Raporti Mjekësor) or any other documentation.`;
                helpText.style.display = 'block';
                break;

            case 'Conference':
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Invitation <span style="color:red">*</span>';
                helpText.innerHTML = `Please attach your invitation letter.`;
                helpText.style.display = 'block';
                break;

            case 'Official': // Official Appointment
                // File Required, Expl Optional
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Document <span style="color:red">*</span>';

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation';

                helpText.innerHTML = `Please attach your official summon (Court, Embassy, Police).`;
                helpText.style.display = 'block';
                break;

            case 'Bus':
                explGroup.style.display = 'flex';
                explInput.setAttribute('minlength', '20');
                explLabel.innerHTML = 'Explanation <span style="color:red">*</span>';

                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Attachment';
                helpText.innerHTML = `<strong>Note:</strong> Only applies to the university's bus line.`;
                helpText.style.display = 'block';
                break;

            case 'Club':
                submitBtn.disabled = true; // Disabled - Dean must email
                helpText.style.background = '#fff3e0';
                helpText.style.color = '#ef6c00';
                helpText.style.borderLeftColor = '#ff9800';
                helpText.innerHTML = `<i class="fa-solid fa-envelope"></i> The Dean of Students Office must email the lecturer to request permission on your behalf.`;
                helpText.style.display = 'block';
                break;

            case 'Confidential': // Personal Matter
                // Enabled, REQUIRED Explanation
                submitBtn.disabled = false;

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation <span style="color:red">*</span>';
                explInput.placeholder = "Please explain the situation in detail...";

                // Set min length for validation later
                explInput.setAttribute('minlength', '50');

                helpText.style.background = '#fff3e0';
                helpText.style.color = '#ef6c00';
                helpText.style.borderLeftColor = '#ff9800';
                helpText.innerHTML = `<i class="fa-solid fa-lock"></i> If you cannot write it here, please visit the lecturer's office to discuss in person.`;
                helpText.style.display = 'block';
                break;
        }
    });

    // --- SUBMIT LOGIC ---
    submitBtn.addEventListener('click', () => {
        const hours = Array.from(hoursGroup.querySelectorAll('.active')).map(b => b.dataset.value);
        const date = document.getElementById('request-date').value;
        const course = courseSelect.value;
        const file = document.getElementById('request-file-upload').files[0];
        const explanation = explInput.value.trim();

        const sessionInput = document.getElementById('req-selected-session');
        const session = sessionInput ? sessionInput.value : 'Default';

        // 1. General Validation
        let errors = [];
        if (!course) errors.push("Select a course.");
        if (!date) errors.push("Select a date.");
        if (hours.length === 0) errors.push("Select at least one hour.");
        if (!selectedReason) errors.push("Select a reason.");
        if (!captchaSolved) errors.push("Please solve the verification puzzle.");



        // 2. Reason Specific Validation
        if (selectedReason === 'Medical' && !file) errors.push("Medical report is required.");
        if (selectedReason === 'Official' && !file) errors.push("Official document is required.");
        if (selectedReason === 'Conference' && !file) errors.push("Event document is required.");

        // 3. Explanation Validation
        if (selectedReason === 'Bus') {
            if (!explanation) errors.push("Explanation is required for bus issues.");
            else if (explanation.length < 20) errors.push("Please explain the bus issue in detail (at least 20 characters).");
        }

        if (selectedReason === 'Confidential') {
            if (!explanation) errors.push("Explanation is required for personal matters.");
            else if (explanation.length < 50) errors.push("Please provide more detail for personal matters (at least 50 characters).");
        }

        if (errors.length > 0) {
            showNotification('warning', 'Missing Info', errors.join('<br>'));
            return;
        }

        // Submit
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spin fa-circle-notch"></i> Sending...';

        const payload = {
            name: currentUser.name,
            email: currentUser.email,
            course: course,
            absenceDate: date,
            hours: hours.join(', '),
            reasonType: selectedReason,
            description: explanation,
            session: session
        };

        if (file) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                payload.fileData = reader.result;
                payload.fileName = file.name;
                payload.fileType = file.type;
                sendRequest(payload);
            };
        } else {
            sendRequest(payload);
        }
    });

    async function sendRequest(payload) {
        try {
            const res = await callWebApp('submitAbsenceRequest', payload, 'POST');
            if (res.result === 'success') {
                showNotification('success', 'Sent', 'Request submitted.');
                document.body.removeChild(dialogBackdrop); closeDialogMode();
            } else throw new Error(res.message);
        } catch (e) {
            showNotification('error', 'Error', e.message);
            submitBtn.disabled = false; submitBtn.innerHTML = 'Submit';
        }
    }

    document.getElementById('cancel-request-btn').onclick = () => {
        document.body.removeChild(dialogBackdrop); closeDialogMode();
    };
}

// --- Dialogs for Admin Actions ---
function showApproveAbsenceDialog(data) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- 1. Create Hour Toggle Buttons ---
    const originalHours = data.hours.split(',').map(h => h.trim());
    const hourButtons = originalHours.map(hour =>
        `<button type="button" class="toggle-button active" data-value="${hour}">${hour}</button>`
    ).join('');

    // --- 2. Create Default Message (with FIRST NAME) ---
    const firstName = data.studentName ? data.studentName.split(' ')[0] : 'Student';
    const greeting = `Dear ${firstName},`;

    const defaultMessage = "";

    // --- 3. Build Dialog HTML ---
    dialog.innerHTML = `
<h3 class="dialog-title">Approve Permission Request</h3>
<div class="dialog-content">
    <p>Approve hours for <strong>${escapeHtml(data.studentName)}</strong>. Unselect any hours you wish to deny.</p>
    
    <div class="form-group" style="align-items: flex-start;">
        <label>Hours:</label>
        <div id="approve-hours-group" class="toggle-button-group" style="flex-wrap: wrap;">
            ${hourButtons}
        </div>
    </div>
    
    <hr style="margin: 20px 0;">

    <div class="form-group" style="align-items: flex-start;">
        <label for="approve-message-area">Email Message:</label>
        <textarea id="approve-message-area" class="form-control" rows="6" placeholder="Add a custom message...">${defaultMessage}</textarea>
    </div>
    <div style="text-align: right; font-size: 0.8em; opacity: 0.7;">
        An approval email will be sent.
    </div>
</div>
<div class="dialog-actions">
    <button id="cancel-approve-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="confirm-approve-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- 4. Add Event Listeners ---
    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const confirmBtn = dialog.querySelector('#confirm-approve-btn');
    const cancelBtn = dialog.querySelector('#cancel-approve-btn');
    const messageArea = dialog.querySelector('#approve-message-area');
    const hoursGroup = dialog.querySelector('#approve-hours-group');

    // Multi-select toggle logic
    hoursGroup.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-button')) {
            e.target.classList.toggle('active');

            const approvedCount = hoursGroup.querySelectorAll('.toggle-button.active').length;

            // Disable the confirm button if no hours are selected
            confirmBtn.disabled = (approvedCount === 0);
            if (approvedCount === 0) {
                confirmBtn.title = 'You must select at least one hour to approve.';
            } else {
                confirmBtn.title = 'Approve Selected Hours';
            }
        }
    });

    cancelBtn.addEventListener('click', closeDialog);

    confirmBtn.addEventListener('click', () => {
        const approvedHours = Array.from(hoursGroup.querySelectorAll('.toggle-button.active'))
            .map(btn => btn.dataset.value);


        const message = messageArea.value; // Get the message (it can be empty)


        // --- 5. Show Loading State ---
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...';

        // --- 6. Call Backend ---
        callWebApp('approveAbsenceRequest', {
            requestID: data.requestId,
            studentName: data.studentName,
            studentEmail: data.studentEmail,
            originalHours: originalHours.join(', '),
            approvedHours: approvedHours.join(', '),
            customMessage: message,
            courseName: data.course
        }, 'POST')
            .then(result => {
                if (result && result.result === 'success') {
                    showNotification('success', 'Approved', `Permission for ${data.studentName} approved.`);
                    refreshAdminViews();

                    if (result.newLogs && result.newLogs.length > 0) {
                        const courseName = result.newLogs[0].course || currentCourse;
                        if (courseData[courseName]) {
                            courseData[courseName].logs.unshift(...result.newLogs);
                            courseData[courseName].logs.sort((a, b) => b.timestamp - a.timestamp);
                            if (courseName === currentCourse) {
                                updateLogsList();
                            }
                        }
                    }
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Approval failed.');
                }
            })
            .catch(err => {
                showNotification('error', 'Approval Failed', err.message);
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.innerHTML = 'Approve';
            });
    });
}

function showRejectAbsenceDialog(data) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const defaultMessage = "";

    dialog.innerHTML = `
<h3 class="dialog-title">Reject Permission Request</h3>
<div class="dialog-content">
    <p>This will reject the request for <strong>${escapeHtml(data.studentName)}</strong>. The student will be notified by email.</p>
    <div class="form-group" style="margin-top: 15px;">
        <label for="reject-message-area">Reason:</label>
        <textarea id="reject-message-area" class="form-control" rows="6" placeholder="Add a reason for rejection...">${defaultMessage}</textarea>
    </div>
</div>
<div class="dialog-actions">
    <button id="cancel-reject-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="confirm-reject-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const confirmBtn = dialog.querySelector('#confirm-reject-btn');
    const cancelBtn = dialog.querySelector('#cancel-reject-btn');
    const messageArea = dialog.querySelector('#reject-message-area');

    cancelBtn.addEventListener('click', closeDialog);

    confirmBtn.addEventListener('click', () => {
        const message = messageArea.value;

        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';

        callWebApp('rejectAbsenceRequest', {
            requestID: data.requestId,
            studentName: data.studentName,
            studentEmail: data.studentEmail,
            rejectionMessage: message,
            courseName: data.course
        }, 'POST')
            .then(result => {
                if (result && result.result === 'success') {
                    showNotification('success', 'Rejected', `Rejection email sent to ${data.studentName}.`);
                    refreshAdminViews();
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Rejection failed.');
                }
            })
            .catch(err => {
                showNotification('error', 'Rejection Failed', err.message);
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.innerHTML = 'Reject';
            });
    });
}

function showDeleteAbsenceDialog(data) {
    showConfirmationDialog({
        title: 'Delete Request?',
        message: `Are you sure you want to delete this pending request from <strong>${escapeHtml(data.studentName)}</strong>?<br><br><strong>This action is permanent and sends no email.</strong>`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: () => {
            callWebApp('deleteAbsenceRequest', { requestID: data.requestId }, 'POST')
                .then(result => {
                    if (result && result.result === 'success') {
                        showNotification('delete', 'Deleted', `Request from ${data.studentName} was deleted.`);
                        refreshAdminViews(); // Refresh the list
                    } else {
                        throw new Error(result?.message || 'Delete failed.');
                    }
                })
                .catch(err => showNotification('error', 'Delete Failed', err.message));
        }
    });
}

/**
 * Shows a custom dialog to reject a registration with a refined default message.
 */
function showRejectDialog(registration) {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    let firstName = "Student";
    let greeting = "Dear,";
    if (registration.name) {
        firstName = registration.name.split(' ')[0];
        greeting = `Dear ${firstName},`;
    }
    const defaultMessage = `${greeting}\nI hope this email finds you well.\n\nI am writing to inform you that your application for your Student ID Card has been rejected. This is typically because the information provided was incorrect or incomplete.\n\nPlease submit your registration again, ensuring all details are correct.\n\nBest,\nBredli`;

    dialog.innerHTML = `
    <h3 class="dialog-title">Reject Application</h3>
    <div class="dialog-content">
        <p style="margin-bottom:15px;">Edit the reason for rejection below.</p>
        
        <div class="form-group" style="align-items:flex-start;">
            <label class="dialog-label-fixed" style="margin-top:10px;">Reason</label>
            <textarea id="reject-message" class="form-control" rows="10">${defaultMessage}</textarea>
        </div>
        
        <p style="font-size:0.85em; color:#666; text-align:right; margin-top:5px;">This message will be emailed to ${escapeHtml(registration.email)}.</p>
    </div>
    <div class="dialog-actions">
        <button id="cancel-reject-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="confirm-reject-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    document.getElementById('cancel-reject-btn').addEventListener('click', closeDialog);

    const confirmBtn = document.getElementById('confirm-reject-btn');
    confirmBtn.addEventListener('click', () => {
        const messageTextarea = document.getElementById('reject-message');
        clearInputError(messageTextarea);
        const message = messageTextarea.value.trim();
        if (!message) { showInputError(messageTextarea, 'Rejection message cannot be empty.'); return; }

        confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Rejecting...';
        const data = { message: message, email: registration.email, rowNumber: registration.rowNumber, name: registration.name };
        if (!currentCourse) return;
        callWebApp('rejectRegistration', data, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Rejected', `Rejection email sent to ${registration.name}.`);
                refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Rejection failed.'); }
        }).catch(err => { showNotification('error', 'Rejection Failed', err.message); confirmBtn.disabled = false; confirmBtn.innerHTML = 'Reject'; });
    });
}

async function callWebApp(action, payload = {}, method = 'POST') {
    const token = gapi.client.getToken()?.access_token;
    if (!token) {
        handleSignoutClick();
        throw new Error("User not signed in or token expired.");
    }

    let url = BRAIN_URL;
    const options = {
        method: method,
        redirect: 'follow',  // IMPORTANT: Must include this
    };

    // Add context parameters needed by Apps Script
    payload.logsSpreadsheetId = LOGS_SPREADSHEET_ID;
    if (!('courseName' in payload)) { // Check if courseName is not already set
        payload.courseName = currentCourse || '';
    }
    payload.access_token = token;

    if (method === 'GET') {
        const params = new URLSearchParams(payload);
        params.append('action', action);
        url += '?' + params.toString();
    } else { // POST
        options.headers = {
            'Content-Type': 'text/plain;charset=utf-8'
        };
        payload.action = action;
        options.body = JSON.stringify(payload);
    }

    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data && data.result === 'error') {
            // --- HANDLE SESSION EXPIRY ---
            if (data.message === 'KIOSK_SESSION_EXPIRED') {
                console.warn("Kiosk session expired. Reloading.");
                localStorage.removeItem('gapi_token');

                // Optional: Show a quick alert before reloading
                document.body.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:sans-serif;"><h1>Session Expired</h1><p>Refreshing...</p></div>`;

                setTimeout(() => window.location.reload(), 1000);
                throw new Error("Session expired"); // Stop execution
            }

            throw new Error(data.message || 'Script execution failed.');
        }
        return data;

    } catch (error) {
        console.error(`Error calling Web App action "${action}" via fetch:`, error);
        throw error;
    }
}

/**
 * Handle auth button click to sign in.
 */
// Replace your handleAuthClick function with this updated version
function handleAuthClick(e) {
    sessionStorage.setItem('redirect_hash', window.location.hash);
    if (e) e.preventDefault();


    // Get the exact current URL as redirect URI (very important!)
    const redirectUri = window.location.origin + window.location.pathname;

    // Create Google OAuth URL with scopes
    const scopes = encodeURIComponent('openid ' + SCOPES);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=token&` +
        `scope=${scopes}`;


    // Add a small delay before redirecting to ensure the notification is displayed
    setTimeout(() => {
        // Redirect to Google login
        window.location.href = authUrl;
    }, 100);
}

/**
 * Get course metadata for the specified course
 */
function getCourseMetadata(course) {
    if (!course) {
        return null;
    }

    // Check if the global courseInfoMap exists and contains this course
    if (window.courseInfoMap && window.courseInfoMap[course]) {
        return window.courseInfoMap[course];
    }

    // No metadata found
    return null;
}

/**
* Starts an NFC reader to populate a given input field.
* @param {HTMLInputElement} inputElement The input field to fill with the scanned UID.
* @param {HTMLElement} statusContainer The div where status messages will be shown.
* @returns {AbortController | null} The controller to stop the scan, or null if not supported.
*/
function startNfcForInputDialog(inputElement, statusContainer, scanButton) {
    if (!nfcSupported) {
        if (/Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            statusContainer.innerHTML = `<p style="text-align:center; font-size: 0.9em; opacity: 0.8;">NFC scanning requires Chrome on Android.</p>`;
        }
        return null;
    }

    statusContainer.style.minHeight = '48px';
    statusContainer.innerHTML = `<div class="sync-status syncing" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-wifi"></i> <span>Ready to Scan...</span></div>`;

    // 1. Abort any existing controller before creating a new one
    if (window.activeNfcController) {
        window.activeNfcController.abort();
    }

    const nfcController = new AbortController();
    const reader = new NDEFReader();

    reader.scan({ signal: nfcController.signal }).then(() => {
        reader.onreading = ({ serialNumber }) => {
            inputElement.value = serialNumber;
            playSound(true);
            statusContainer.innerHTML = `<div class="sync-status success" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-circle-check"></i> <span>Card Scanned!</span></div>`;

            if (scanButton) {
                scanButton.disabled = true; // Deactivate the button
                scanButton.innerHTML = '<i class="fa-solid fa-check"></i>'; // Show a checkmark
            }
            // Fade out the status message after 2.5 seconds
            setTimeout(() => {
                statusContainer.innerHTML = '';
                statusContainer.style.minHeight = '0';
            }, 2000);

            nfcController.abort();
        };
    }).catch(err => {
        if (err.name !== 'AbortError') {
            statusContainer.innerHTML = `<div class="sync-status error" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-circle-xmark"></i> <span>Scan failed. Is NFC on?</span></div>`;
        }
        window.activeNfcController = null; // Clean up on error
    });

    return nfcController;
}

/**
* Handles the click on either refresh button.
* Shows a spinner, runs a full sync, then stops the spinner.
*/
/**
* REVISED: Handles refresh differently for Admins and Students.
*/
async function handleManualRefresh(buttonId) {
    if (isSyncing) return; // Don't refresh if already syncing

    const refreshBtn = document.getElementById(buttonId);
    if (!refreshBtn) return;

    const icon = refreshBtn.querySelector('i');
    const originalIconClass = icon.className;

    // Start spinner
    icon.className = 'fa-solid fa-arrows-rotate fa-spin';
    refreshBtn.disabled = true;

    try {
        if (isAdmin) {
            // --- ADMIN REFRESH (Full Sync) ---
            await syncData(); // Admins run the full sync

            await refreshAdminViews();

        } else {
            // --- STUDENT REFRESH (Course List + Current Logs) ---
            if (!isSignedIn) {
                showNotification('info', 'Please Sign In', 'Sign in to refresh your courses and logs.');
                return; // Nothing to refresh if not signed in
            }

            updateSyncStatus("Refreshing...", "syncing"); // Show temporary status

            // 1. Re-fetch Available Courses (using the efficient boot function)
            const bootData = await callWebApp('getBootData', {}, 'POST');
            const fetchedCourseDict = bootData.courses;

            if (fetchedCourseDict && typeof fetchedCourseDict === 'object') {
                // Update the global availableCourses list
                availableCourses = Object.keys(fetchedCourseDict);

                // Update the global course dictionary
                const filteredDict = {};
                availableCourses.forEach(course => {
                    if (fetchedCourseDict[course]) {
                        filteredDict[course] = fetchedCourseDict[course];
                    }
                });
                courseDictionary = filteredDict;

                // Check if the *currently selected* course is still valid
                if (currentCourse && !availableCourses.includes(currentCourse)) {
                    // If the current course is no longer available, switch to the first available one
                    currentCourse = availableCourses.length > 0 ? availableCourses[0] : null;
                    if (currentCourse) window.location.hash = currentCourse; // Update URL hash if needed
                    localStorage.setItem('last_active_course', currentCourse);
                }

                // 2. Repopulate the Course Buttons
                populateCourseButtons(); // Redraw buttons with the new list

                // 3. Refresh Logs for the (potentially new) Current Course
                if (currentCourse) {
                    const serverLogs = await callWebApp('getStudentLogs', { courseName: currentCourse }, 'POST');
                    studentLogCache[currentCourse] = serverLogs;
                    courseData[currentCourse] = { logs: serverLogs, tombstones: new Set() };
                } else {
                    // Handle case where student has NO courses after refresh
                    courseData = {}; // Clear all local course data
                    studentLogCache = {};
                }

                // 4. Update the entire UI (including the log list)
                updateUI();

            } else {
                throw new Error("Could not fetch course list.");
            }
            updateSyncStatus("Online", "online"); // Revert status
        }

    } catch (error) {
        console.error('Manual refresh failed:', error);
        const errorMsg = isAdmin ? 'Could not sync data.' : 'Could not refresh courses/logs.';
        showNotification('error', 'Refresh Failed', `${errorMsg} ${error.message}`);
        updateSyncStatus("Error", "error"); // Show error status
    } finally {
        // Stop spinner
        icon.className = originalIconClass;
        refreshBtn.disabled = false;
        // Ensure sync status reverts if it wasn't an error
        if (!syncStatus.classList.contains('error')) {
            // Small delay to let the "success" message show briefly
            setTimeout(() => updateSyncStatus("Online", "online"), 2000);
        }
    }
}

function setupRefreshButtons() {
    const scannerRefreshBtn = document.getElementById('scanner-refresh-btn');
    const databaseRefreshBtn = document.getElementById('database-refresh-btn');

    if (scannerRefreshBtn) {
        scannerRefreshBtn.addEventListener('click', () => {
            handleManualRefresh('scanner-refresh-btn');
        });
    }

    if (databaseRefreshBtn) {
        databaseRefreshBtn.addEventListener('click', () => {
            handleManualRefresh('database-refresh-btn');
        });
    }
}

/**
 * Calculate the current week of the course
 * @param {Object} metadata - Course metadata with start_date, end_date, and holiday_weeks
 * @returns {number|null} Current week number or null if metadata is invalid
 */
function calculateCurrentWeek(metadata) {
    if (!metadata || !metadata.startDate) return null;

    const startDate = new Date(metadata.startDate);
    const today = new Date();
    const holidayWeeks = parseInt(metadata.holidayWeeks || 0);

    // Get the holiday start date, if it exists
    const holidayStartDate = metadata.holidayStartDate ? new Date(metadata.holidayStartDate) : null;

    if (isNaN(startDate.getTime())) return null;

    // Calculate the current calendar week of the semester
    const currentWeek = Math.ceil((today - startDate) / (7 * 24 * 60 * 60 * 1000));

    let adjustedWeek = currentWeek;

    // Only subtract holiday weeks if today's date is ON or AFTER the holiday start date
    if (holidayWeeks > 0 && holidayStartDate && !isNaN(holidayStartDate.getTime()) && today >= holidayStartDate) {
        adjustedWeek = currentWeek - holidayWeeks;
    }

    // Ensure week is within a valid range (at least 1)
    return Math.max(adjustedWeek, 1);
}

/**
 * Displays an error message for a specific input field.
 * @param {HTMLInputElement} inputElement The input field to validate.
 * @param {string} message The error message to display.
 */
function showInputError(inputElement, message) {
    inputElement.classList.add('is-invalid');
    const formGroup = inputElement.closest('.form-group');
    if (formGroup) {
        // Remove any existing error to prevent duplicates
        const existingError = formGroup.nextElementSibling;
        if (existingError && existingError.classList.contains('error-message')) {
            existingError.remove();
        }

        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = message;

        // This is the key: insert the error message AFTER the form group.
        formGroup.after(errorElement);
    }
}

/**
 * Clears any validation error from a specific input field.
 * @param {HTMLInputElement} inputElement The input field to clear.
 */
function clearInputError(inputElement) {
    inputElement.classList.remove('is-invalid');
    const formGroup = inputElement.closest('.form-group');
    if (formGroup) {
        // Look for the error message as the NEXT sibling
        const errorElement = formGroup.nextElementSibling;
        if (errorElement && errorElement.classList.contains('error-message')) {
            errorElement.remove();
        }
    }
}

/**
 * Get a suggested date for attendance export
 * @param {Object} metadata - Course metadata
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getSuggestedDate(metadata) {
    // Current date is a good default
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // If we're on a weekend, suggest the previous Friday
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        const friday = new Date(today);
        // Go back to the previous Friday
        friday.setDate(today.getDate() - (dayOfWeek === 0 ? 2 : 1));
        return friday.toISOString().split('T')[0];
    }

    return todayStr;
}

// REPLACEMENT FUNCTION
function handleSignoutClick() {
    // --- STANDARD SIGN-OUT ---
    // Always clear the token and reload to ensure a clean state.
    localStorage.removeItem('gapi_token');
    localStorage.removeItem('last_active_course');
    window.location.reload();
}

// Update sync status indicator
function updateSyncStatus(message, status) {
    // When status is good (online/success), clear any previous error/warning messages.
    if (status === 'online' || status === 'success') {
        removeNotifications('error');
        removeNotifications('warning');
    }

    const syncText = document.getElementById('sync-text');
    const syncStatus = document.getElementById('sync-status');

    // If the browser is offline, ALWAYS show the offline status, regardless of the requested change.
    if (!isOnline) {
        if (syncText) syncText.textContent = 'Offline';
        if (syncStatus) syncStatus.className = 'sync-status offline';
        return; // Exit the function early
    }

    if (syncText) syncText.textContent = message;
    if (syncStatus) {
        syncStatus.className = 'sync-status ' + (status || 'offline');
    }
}

function updateAuthUI() {
    // --- Initial UI State ---
    if (loadingTasks.has('auth')) {
        loadingTasks.delete('auth');
        checkLoadingCompletion();
    }

    const appHeader = document.querySelector('.app-header');
    if (appHeader) appHeader.style.display = isSignedIn ? 'block' : 'none';

    // Temporarily hide course buttons; we'll show them later if needed
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (courseButtonsContainer) courseButtonsContainer.style.display = 'none';

    document.body.classList.toggle('is-admin', isAdmin);

    const sessionControls = document.getElementById('session-controls');
    if (!isAdmin && sessionControls) {
        sessionControls.style.setProperty('display', 'none', 'important');
    }

    // --- Sort Select Logic ---
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        const options = Array.from(sortSelect.options);
        options.forEach(option => {
            const isStudentOnlyOption = option.value.includes('date');
            // Allow all options if Admin
            option.style.display = (isAdmin || isStudentOnlyOption) ? '' : 'none';
        });

        // Only reset sort if NOT Admin
        if (!isAdmin && !currentSort.startsWith('date')) {
            currentSort = 'date-desc';
            sortSelect.value = currentSort;
        }
    }

    // --- Element References ---
    const loginContainer = document.getElementById('login-container');
    const userContainer = document.getElementById('user-container');
    const userInfo = userContainer.querySelector('.user-info');
    userAvatar = document.getElementById('user-avatar');
    const logoutBtn = document.getElementById('logout-btn');
    const tabsContainer = document.querySelector('.tabs');
    const directEisExportBtn = document.getElementById('direct-eis-export-btn');
    const logsHeader = document.querySelector('.logs-header');
    const filterContainer = document.querySelector('.filter-container');
    const tableContainer = document.querySelector('.table-container');
    const notSignedInMsgElement = document.getElementById('not-signed-in-message');

    // --- Core Auth UI Toggling ---
    if (loginContainer) loginContainer.style.display = isSignedIn ? 'none' : 'flex';
    if (userContainer) userContainer.style.display = isSignedIn ? 'flex' : 'none';
    if (tabsContainer) tabsContainer.style.display = isGlobalAdmin ? 'flex' : 'none';

    // Allow Export button in Lecturer Mode too
    // Allow Export button in Admin Mode
    if (directEisExportBtn) directEisExportBtn.style.display = isAdmin ? 'inline-block' : 'none';

    // --- Signed In State ---
    if (isSignedIn) {
        if (currentUser) {
            userName.textContent = currentUser.name;
            userAvatar.src = currentUser.picture;
        }

        let chip = document.getElementById('student-profile-chip');
        if (!chip) {
            chip = document.createElement('div');
            chip.id = 'student-profile-chip';
            chip.className = 'student-profile-chip';
            if (userInfo && logoutBtn) userInfo.insertBefore(chip, logoutBtn);
            else if (userInfo) userInfo.appendChild(chip);
            chip.appendChild(userAvatar);
            chip.appendChild(userName);
        }

        const newChip = chip.cloneNode(true);
        chip.parentNode.replaceChild(newChip, chip);
        chip = newChip;
        const newAvatar = chip.querySelector('.user-avatar');
        if (newAvatar) userAvatar = newAvatar;

        chip.addEventListener('click', () => {
            if (isGlobalAdmin) showGlobalSettingsDialog();
            else if (isAdmin) showAdminProfileDialog();
            else showStudentProfileDialog();
        });

        userName.style.color = 'inherit';
        userName.style.textDecoration = 'none';
        userName.classList.remove('student-name-clickable');

        if (isAdmin) {
            document.body.classList.add('is-admin');
            const databaseTab = document.querySelector('.tab[data-tab="database-tab"]');
            if (databaseTab) {
                if (isGlobalAdmin) {
                    databaseTab.style.setProperty('display', 'flex', 'important');
                } else {
                    databaseTab.style.setProperty('display', 'none', 'important');
                    if (document.querySelector('.tab-content.active')?.id === 'database-tab') {
                        document.querySelector('.tab[data-tab="scanner-tab"]')?.click();
                    }
                }
            }
        } else {
            document.body.classList.remove('is-admin');
        }

        if (courseButtonsContainer) courseButtonsContainer.style.display = 'flex';
        if (notSignedInMsgElement) notSignedInMsgElement.remove();
        if (logsHeader) logsHeader.style.display = 'flex';
        if (filterContainer) filterContainer.style.display = 'flex';
        if (tableContainer) tableContainer.style.display = 'block';

        const hasActiveData = isSignedIn || (Object.keys(courseData).length > 0 && currentCourse);
        if (scanHistoryModule) scanHistoryModule.style.display = hasActiveData ? 'block' : 'none';

        // --- UID Column Visibility ---
        document.querySelectorAll('.uid-column').forEach(col => {
            col.style.display = isAdmin ? 'table-cell' : 'none';
        });

    } else {
        // --- Signed Out (Default) ---
        let signedOutChip = document.getElementById('student-profile-chip');
        if (signedOutChip && logoutBtn && userInfo) {
            userInfo.insertBefore(userAvatar, logoutBtn);
            userInfo.insertBefore(userName, logoutBtn);
            signedOutChip.remove();
        }

        document.body.classList.remove('is-admin');

        // Hide course buttons
        if (courseButtonsContainer) courseButtonsContainer.style.display = 'none';

        let notSignedInMsg = notSignedInMsgElement;
        if (!notSignedInMsg) {
            notSignedInMsg = document.createElement('div');
            notSignedInMsg.id = 'not-signed-in-message';
            notSignedInMsg.className = 'not-signed-in-message';
            const mainContainer = document.getElementById('main-container');
            const appHeaderElement = mainContainer.querySelector('.app-header');
            if (mainContainer && appHeaderElement) mainContainer.insertBefore(notSignedInMsg, appHeaderElement);
            else if (mainContainer) mainContainer.appendChild(notSignedInMsg);
        }

        if (lastScannedUID) {
            notSignedInMsg.innerHTML = `
                <p><i class="fa-solid fa-id-card"></i> The UID of your ID Card is:</p>
                <h2 style="margin-top: 10px; font-weight: bold; font-family: monospace; font-size: 1.8em; letter-spacing: 1px; word-break: break-all; color: var(--primary-dark);">${lastScannedUID}</h2>`;
        } else {
            notSignedInMsg.innerHTML = `
                <h3><i class="fa-solid fa-circle-info"></i> Welcome to Smart Attendance</h3>
                <p>Please sign in with your <b>EPOKA Mail</b> to track your attendance.</p>`;
        }

        // --- CLEANUP ---
        if (logsHeader) logsHeader.style.display = 'none';
        if (filterContainer) filterContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'none';
        if (scanHistoryModule) scanHistoryModule.style.display = 'none';
    }

    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.disabled = !isOnline || !isSignedIn || isSyncing;
        syncBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    const emptyLogs = document.getElementById('empty-logs');
    if (emptyLogs) {
        // Show empty logs if Signed In
        if (isSignedIn) {
            const logsForCurrentCourse = courseData[currentCourse]?.logs || [];
            if (!currentCourse) {
                emptyLogs.innerHTML = '<i class="fa-solid fa-circle-info"></i> Please select a course to view attendance logs.';
                emptyLogs.style.display = 'block';
            } else if (logsForCurrentCourse.length === 0 && courseData[currentCourse]) {
                emptyLogs.innerHTML = '<i class="fa-solid fa-ghost"></i> No attendance records found for this course.';
                emptyLogs.style.display = 'block';
            } else if (!courseData[currentCourse]) {
                // Loading...
            } else {
                emptyLogs.style.display = 'none';
            }
        } else {
            emptyLogs.style.display = 'none';
        }
    }
}

/**
 * Switches the active course and loads data on-demand if needed.
 */
async function handleCourseChange(courseName) {
    if (currentCourse === courseName) return;

    isChangingCourses = true;
    currentCourse = courseName;
    localStorage.setItem('last_active_course', currentCourse);

    // Show skeletons
    renderTableSkeletons();
    document.getElementById('empty-logs').style.display = 'none';

    // Use the safe loader
    await loadAndMergeCourseData(courseName);

    updateUI();
}

/**
 * Background loads remaining logs for a Course Admin... SLOWLY, to avoid rate-limits.
 */
async function loadRemainingCourseAdminLogs() {
    const remainingCourses = availableCourses.filter(c => c !== currentCourse);

    // Use a standard for loop so we can 'await' inside it
    for (let i = 0; i < remainingCourses.length; i++) {
        const course = remainingCourses[i];
        try {
            // Check if already in cache (in case of fast-switching)
            if (!studentLogCache[course]) {
                // Await the fetch for this single course
                const serverLogs = await callWebApp('getCourseLogs_Admin', { courseName: course }, 'POST');
                studentLogCache[course] = serverLogs;
                courseData[course] = { logs: serverLogs, tombstones: new Set() };
            }

            // Wait 1.5 seconds before fetching the next course.
            // This respects the Google Apps Script rate limit.
            await sleep(1500);

        } catch (err) {
            console.error(`Failed to background load logs for ${course}:`, err);
            // If one fails, wait a bit and try the next one
            await sleep(1500);
        }
    }
}

/**
 * Background loads remaining logs for a Student
 */
async function loadRemainingStudentLogs() {
    const remainingCourses = availableCourses.filter(c => c !== currentCourse);
    for (const course of remainingCourses) {
        try {
            // Check if already in cache (in case of fast-switching)
            if (!studentLogCache[course]) {
                const serverLogs = await callWebApp('getStudentLogs', { courseName: course }, 'POST');
                studentLogCache[course] = serverLogs;
                courseData[course] = { logs: serverLogs, tombstones: new Set() };
            }
        } catch (err) {
            console.error(`Failed to background load logs for ${course}:`, err);
        }
    }
}

/**
 * Loads data for a single course from local storage.
 * @param {string} courseName - The name of the course to load.
 * @returns {Promise<{logs: Array, tombstones: Set}>}
 */
async function loadCourseFromLocalStorage(courseName) {
    const storageKey = `${LOGS_STORAGE_KEY}_${courseName}`;
    try {
        const rawData = localStorage.getItem(storageKey);
        if (!rawData) return { logs: [], tombstones: new Set() };

        const parsedData = JSON.parse(rawData);
        return {
            logs: parsedData.logs || [],
            tombstones: new Set(parsedData.tombstones || [])
        };
    } catch (e) {
        console.warn(`Failed to restore logs for ${courseName} from localStorage:`, e);
        return { logs: [], tombstones: new Set() };
    }
}

// Add this to track authentication state better
function setupAuthStateTracking() {
    // Check if we are in Kiosk mode first
    const storedTokenStr = localStorage.getItem('gapi_token');
    if (storedTokenStr && storedTokenStr.includes('KIOSK_')) {
        return; // Kiosk tokens cannot be refreshed via Google. Stop here.
    }

    // Refresh token every 30 minutes (Safer buffer)
    const REFRESH_INTERVAL = 30 * 60 * 1000;

    setInterval(async () => {
        if (!isSignedIn) return;

        console.log("Performing proactive token refresh...");
        try {
            const tokenObj = gapi.client.getToken();
            if (tokenObj) {
                if (tokenClient) {
                    // Silent refresh
                    tokenClient.requestAccessToken({
                        prompt: 'none',
                        login_hint: currentUser?.email
                    });
                }
            }
        } catch (error) {
            console.warn('Proactive refresh failed', error);
        }
    }, REFRESH_INTERVAL);
}

// Try to silently refresh the token without popup
async function attemptSilentAuth() {
    try {
        // Check if we have a valid token stored
        const tokenObj = gapi.client.getToken();
        if (!tokenObj) {
            return;
        }

        // Try to make a simple API call to test if token is still valid
        // If it succeeds, token is good; if it fails, we'll catch it elsewhere
        await gapi.client.request({
            path: 'https://www.googleapis.com/oauth2/v3/tokeninfo',
            method: 'GET'
        });

    } catch (error) {
        console.warn('Token expired, user will need to sign in again');
        showNotification('warning', 'Session Expired', 'Please sign in again to continue.');
        // Don't use requestAccessToken here as it opens popup
        // Let the user naturally re-authenticate next time they interact
    }
}

// Show a warning in the UI about authentication issues
function updateAuthWarningUI(show) {
    const userContainer = document.getElementById('user-container');

    if (show && userContainer) {
        // Add warning indicator
        if (!document.getElementById('auth-warning')) {
            const warning = document.createElement('div');
            warning.id = 'auth-warning';
            warning.style.backgroundColor = '#fb8c00';
            warning.style.color = 'white';
            warning.style.padding = '2px 8px';
            warning.style.borderRadius = '4px';
            warning.style.fontSize = '0.7em';
            warning.style.marginLeft = '5px';
            warning.style.animation = 'pulse 2s infinite';
            warning.textContent = 'Session Expiring';
            warning.title = 'Your login session may be expiring soon';

            // Add animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes pulse {
                    0% { opacity: 0.6; }
                    50% { opacity: 1; }
                    100% { opacity: 0.6; }
                }
            `;
            document.head.appendChild(style);

            userContainer.appendChild(warning);
        }
    } else {
        // Remove warning if present
        const warning = document.getElementById('auth-warning');
        if (warning) warning.remove();
    }
}

/**
 * Populate course dropdown with available courses.
 */
function populateCourseDropdown() {
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (!courseButtonsContainer) return;

    const activeTabId = document.querySelector('.tab.active')?.dataset.tab;

    if (!isSignedIn) {
        courseButtonsContainer.innerHTML = ''; // Clear any old buttons
        const button = document.createElement('div');
        button.className = 'course-button active'; // Make the default button active
        button.innerHTML = `<i class="fa-solid fa-table-list"></i>&nbsp; Default`;
        courseButtonsContainer.appendChild(button);
        courseButtonsContainer.style.display = 'flex';
        return; // Exit the function here for signed-out users
    }

    // This block handles the logic for signed-in users.
    if (activeTabId === 'database-tab') {
        courseButtonsContainer.style.display = 'none'; // Keep it hidden on the database tab
    } else {
        courseButtonsContainer.style.display = 'flex'; // Show it on other tabs
    }
    courseButtonsContainer.innerHTML = '';
    let coursesToDisplay = availableCourses;

    if (!isAdmin && currentUser) {
        const studentNameNormalised = normalizeName(currentUser.name);
        const studentEmail = currentUser.email ? currentUser.email.toLowerCase() : '';

        coursesToDisplay = availableCourses.filter(course => {
            const logsForCourse = studentLogCache[course] || [];

            // If no logs cached for this course, include it (student might have logs but cache failed)
            if (logsForCourse.length === 0) {
                return true; // Show the course, let the backend filter it
            }

            // Check if at least one log in this course belongs to the student
            return logsForCourse.some(log => {
                // Try multiple matching strategies for robustness

                // Strategy 1: Match by UID in database
                const logOwnerName = databaseMap[log.uid]?.name || '';
                if (logOwnerName && normalizeName(logOwnerName) === studentNameNormalised) {
                    return true;
                }

                // Strategy 2: Match by email if available in log
                if (log.email && studentEmail && log.email.toLowerCase() === studentEmail) {
                    return true;
                }

                // Strategy 3: Match by name if stored directly in log
                if (log.name && normalizeName(log.name) === studentNameNormalised) {
                    return true;
                }

                return false;
            });
        });
    }

    coursesToDisplay.forEach(course => {
        const button = document.createElement('div');
        button.className = 'course-button' + (currentCourse === course ? ' active' : '');
        button.innerHTML = `<i class="fa-solid fa-table-list"></i>&nbsp; ${escapeHtml(course.replace(/_/g, ' '))}`;
        button.addEventListener('click', () => selectCourseButton(course));
        courseButtonsContainer.appendChild(button);
    });

    if (!currentCourse && coursesToDisplay.length > 0) {
        selectCourseButton(coursesToDisplay[0]);
    }
}

async function loadAllCourseLogsForCourseAdmin() {
    if (!isAdmin || isGlobalAdmin || !isOnline || !isSignedIn) {
        return;
    }

    // Clear any old student cache
    studentLogCache = {};

    const fetchPromises = availableCourses.map(async (course) => {
        try {
            // Call the Web App endpoint
            const serverLogs = await callWebApp('getCourseLogs_Admin', { courseName: course }, 'POST');

            if (serverLogs && serverLogs.length > 0) {
                // We can use studentLogCache for this, its just a cache
                studentLogCache[course] = serverLogs;
            }
        } catch (err) {
            console.error(`Failed to call Apps Script for ${course}:`, err);
        }
    });

    await Promise.all(fetchPromises);

    // Populate courseData for the course admin
    availableCourses.forEach(course => {
        if (studentLogCache[course]) {
            courseData[course] = {
                logs: studentLogCache[course],
                tombstones: new Set() // Course admins don't use GAPI, so no tombstones
            };
        }
    });

    updateUI();
}

/**
* Proactively fetches and caches logs for all available courses FOR A STUDENT.
*/
async function loadAllCourseLogsForStudent() {
    if (isGlobalAdmin || !isOnline || !isSignedIn) {
        loadingTasks.delete('courses'); // CRITICAL: Remove from loading tasks
        loadingTasks.delete('database');
        loadingTasks.delete('gapi');
        checkLoadingCompletion();
        return;
    }
    if (!isOnline || !isSignedIn) return;
    studentLogCache = {};

    const fetchPromises = availableCourses.map(async (course) => {
        try {
            // Call the Web App using GET, parameters go in payload
            const serverLogs = await callWebApp('getStudentLogs', { courseName: course }, 'POST');
            // No need to parse JSON, callWebApp already does it
            if (serverLogs && serverLogs.length > 0) {
                studentLogCache[course] = serverLogs;
            }
        } catch (err) {
            console.error(`Failed to call Apps Script for ${course}:`, err);
        }
    });

    await Promise.all(fetchPromises);

    // Also populate courseData for students (without tombstones since they can't edit)
    availableCourses.forEach(course => {
        if (studentLogCache[course]) {
            courseData[course] = {
                logs: studentLogCache[course],
                tombstones: new Set() // Students can't delete, so no tombstones
            };
        }
    });

    updateUI();
}


/**
 * Update online/offline status indicator.
 */
function updateOnlineStatus() {
    isOnline = navigator.onLine;
    const statusIcon = syncStatus.querySelector("i");

    if (isOnline) {
        syncText.textContent = 'Online';
        syncStatus.className = 'sync-status online';
        syncBtn.disabled = !isSignedIn || isSyncing;
    } else {
        syncText.textContent = 'Offline';
        syncStatus.className = 'sync-status offline';
        syncBtn.disabled = true;
    }

    // After a successful sync, we might set a "success" status.
    // This ensures that when the status is updated again, it reverts to the correct online/offline state.
    if (pendingChanges && isOnline) {
        syncText.textContent = autoSyncEnabled ? 'Pending auto-sync' : 'Pending sync';
        syncStatus.className = 'sync-status waiting';
    }
}

/**
 * Sync data with Google Sheets.
 * Fetches and updates both database and logs.
 */
async function syncData() {
    if (!isOnline || !isSignedIn || isSyncing) return;

    isSyncing = true;
    const syncBtn = document.getElementById('sync-btn');
    const syncIcon = syncBtn.querySelector('i');
    if (syncIcon) syncIcon.classList.add('spin-animation');
    syncBtn.disabled = true;

    try {
        invalidateDatabaseCache();

        // --- Step 1: Sync Database ---
        try {
            await fetchDatabaseFromSheet();
            window.buildUIDToPrimaryUidMap();
        } catch (dbError) {
            console.error('Database sync error:', dbError);
            showNotification('error', 'Sync Paused', 'Database connection unstable. Local data preserved.');
            // CRITICAL: Abort sync to protect data integrity, 
            // BUT keep isSyncing=false so user can try again.
            // Do NOT clear local logs.
            isSyncing = false;
            updateSyncStatus("Sync failed", "error");
            if (syncIcon) syncIcon.classList.remove('spin-animation');
            syncBtn.disabled = false;
            return;
        }

        // --- Step 2: Course Info ---
        try { await fetchCourseInfo(); } catch (e) { }

        // --- Step 3: Sync Logs ---
        if (currentCourse && isSignedIn) {
            updateSyncStatus("Syncing...", "syncing");

            // 1. RELOAD DISK (Ensure we have the latest local state)
            const localData = await loadCourseFromLocalStorage(currentCourse);

            // 2. PULL SERVER
            let serverLogs = [];
            try {
                if (isAdmin) {
                    serverLogs = await callWebApp('getCourseLogs_Admin', { courseName: currentCourse }, 'POST');
                } else {
                    serverLogs = await callWebApp('getStudentLogs', { courseName: currentCourse }, 'POST');
                }
            } catch (pullErr) {
                throw new Error("Could not reach server to pull logs.");
            }

            // 3. MERGE
            const mergedLogs = mergeLogs(serverLogs, localData.logs, localData.tombstones, new Set());

            // Update state immediately so UI reflects merge
            courseData[currentCourse] = {
                logs: mergedLogs,
                tombstones: localData.tombstones
            };
            saveCourseToLocalStorage(currentCourse);

            // 4. PUSH (Only if Admin)
            // Note: We push the MERGED logs. 
            if (isAdmin && pendingChanges) {
                try {
                    if (isGlobalAdmin) {
                        await syncLogsWithSheet();
                        courseData[currentCourse].tombstones.clear();
                    } else {
                        await syncViaBackendAPI();
                    }

                    pendingChanges = false;
                    lastSyncTime = Date.now();
                    // Save the "Clean" state
                    saveCourseToLocalStorage(currentCourse);

                } catch (pushError) {
                    console.error("Push failed:", pushError);
                    // Keep pendingChanges = true so we try again later
                    pendingChanges = true;
                    throw new Error("Changes saved locally but upload failed.");
                }
            }
        }

        if (isAdmin) await refreshAdminViews();

        updateSyncStatus("Synced", "success");
        setTimeout(() => {
            if (!pendingChanges && isOnline) updateSyncStatus("Online", "online");
        }, 3000);

    } catch (error) {
        console.error('Sync error:', error);
        updateSyncStatus("Sync failed", "error");
        if (!error.message.includes('Database connection unstable')) {
            showNotification('warning', 'Offline Mode', 'Could not sync. Data saved locally.');
        }
    } finally {
        isSyncing = false;
        if (syncIcon) syncIcon.classList.remove('spin-animation');
        syncBtn.disabled = !isSignedIn || !isOnline;
        updateUI();
    }
}


/**
* Fetch database entries from Google Sheet with format detection
*/
async function fetchDatabaseFromSheet() {
    // Use cache if available and fresh
    const now = Date.now();
    if (databaseCache && (now - databaseCacheTime) < DATABASE_CACHE_DURATION) {
        databaseMap = databaseCache;
        return;
    }

    try {
        const result = await callWebApp('getDatabase', {}, 'POST');

        if (result && typeof result === 'object') {
            databaseMap = result;
            databaseCache = result;
            databaseCacheTime = now;
        } else {
            throw new Error('Invalid database format received');
        }
    } catch (error) {
        console.error('Error fetching database:', error);
        // If we have old cache, use it
        if (databaseCache) {
            console.warn('Using stale database cache due to fetch error');
            databaseMap = databaseCache;
        }
        throw error;
    }
}

/**
 * Get the actual sheet name for a course (handles display name mapping)
 */
function getSheetNameForCourse(courseName) {
    // If we have a mapping, use it, otherwise use the course name directly
    return sheetNameMap[courseName] || courseName;
}

/**
 * Format a sheet name for the Google Sheets API
 * Encloses in single quotes if the name has spaces or special characters
 */
function formatSheetName(sheetName) {
    return sheetName.includes(' ') ||
        sheetName.includes('!') ||
        sheetName.includes('\'') ?
        `'${sheetName}'` : sheetName;
}

/**
 * Returns the current active session string (e.g., "Theory A", "Lab", or "Default")
 */
function getCurrentActiveSession() {
    if (!activeSessionCategory) return 'Default';

    let session = activeSessionCategory;
    if (activeSessionGroup) {
        session += ' ' + activeSessionGroup;
    }
    return session;
}


/**
* Updates a log's version and updatedAt timestamp for an edit.
* @param {object} log - The log object to update.
* @param {string} [userEmail] - Optional: The email of the user making the change.
* @returns {object} The updated log object.
*/
function touchLogForEdit(log, userEmail) {
    log.version = (log.version || 0) + 1;
    log.updatedAt = Date.now();
    if (userEmail) log.updatedBy = userEmail;
    return log;
}


/**
         * Converts a log object into an array for writing to the Google Sheet.
         * @param {object} log - The log object.
         * @returns {Array} The log data as a row array.
         */
function toSheetRow(log) {
    return [
        log.uid || '',
        new Date(Number(log.timestamp || Date.now())).toISOString(),
        log.id,
        // Write an explicit string for 100% reliability with Google Sheets.
        log.manual ? 'TRUE' : 'FALSE',
        Number(log.version || 0),
        new Date(Number(log.updatedAt || log.timestamp || Date.now())).toISOString(),
        String(log.updatedBy || '')
    ];
}

/**
 * Safely loads logs by prioritizing local data first.
 * Ensures offline scans appear immediately and are not wiped by an empty server response.
 */
async function loadAndMergeCourseData(courseName) {
    if (!courseName) return;

    const localData = await loadCourseFromLocalStorage(courseName);

    // Initial render with local data
    courseData[courseName] = {
        logs: localData.logs || [],
        tombstones: localData.tombstones || new Set()
    };

    if (isOnline && isSignedIn) {
        try {
            let serverLogs = [];
            // Map<LogID, DeletedAtTimestamp>
            let serverTombstoneMap = new Map();

            if (isAdmin) {
                const response = await callWebApp('getCourseLogs_Admin', { courseName: courseName }, 'POST');

                if (response.logs) {
                    serverLogs = response.logs;

                    // Parse the new {id, deletedAt} object format
                    if (response.tombstones && Array.isArray(response.tombstones)) {
                        response.tombstones.forEach(t => {
                            // If t is an object {id, deletedAt}, map it. 
                            // If it's a string (legacy), default timestamp to now (safer to assume recent deletion)
                            if (typeof t === 'object') {
                                serverTombstoneMap.set(t.id, t.deletedAt);
                            } else {
                                serverTombstoneMap.set(t, Date.now());
                            }
                        });
                    }
                } else {
                    serverLogs = response;
                }
            } else {
                serverLogs = await callWebApp('getStudentLogs', { courseName: courseName }, 'POST');
            }

            // Merge using the Map
            const mergedLogs = mergeLogs(serverLogs, localData.logs, localData.tombstones, serverTombstoneMap);

            courseData[courseName].logs = mergedLogs;

            // Clean up local tombstones. 
            // If the server confirms deletion (via tombstoneMap), we can stop tracking it locally.
            serverTombstoneMap.forEach((_, id) => courseData[courseName].tombstones.delete(id));

            saveCourseToLocalStorage(courseName);

        } catch (err) {
            console.warn(`Background fetch failed for ${courseName}.`, err);
        }
    }
}


/**
* Merges Server and Local logs using CRDT logic (Time-based Tombstones).
*/
function mergeLogs(serverLogs, localLogs, localTombstones, serverTombstonesMap) {
    serverLogs = Array.isArray(serverLogs) ? serverLogs : [];
    localLogs = Array.isArray(localLogs) ? localLogs : [];

    // serverTombstonesMap is now expected to be a Map: ID -> Timestamp
    // localTombstones is a Set of IDs (pending deletions locally)

    const combinedMap = new Map();

    // Helper to check if a log is "Dead"
    const isDead = (log) => {
        // 1. Is it pending deletion locally?
        if (localTombstones.has(log.id)) return true;

        // 2. Is it deleted on server? Check Timing.
        // If Server Tombstone exists AND Log is OLDER than Tombstone -> Dead.
        if (serverTombstonesMap.has(log.id)) {
            const deletedAt = serverTombstonesMap.get(log.id);
            const logTime = log.updatedAt || 0;
            if (logTime < deletedAt) return true;
        }
        return false;
    };

    // 1. Process Server Logs (The Truth)
    serverLogs.forEach(log => {
        if (!isDead(log)) {
            combinedMap.set(log.id, log);
        }
    });

    // 2. Process Local Logs (The Potential Updates)
    localLogs.forEach(localLog => {
        if (isDead(localLog)) return;

        const serverLog = combinedMap.get(localLog.id);

        if (!serverLog) {
            // Log exists locally but not on server.
            // Since we already checked isDead(), we know it wasn't deleted on the server.
            // Therefore, it must be a offline creation. Keep it.
            combinedMap.set(localLog.id, localLog);
        } else {
            // Log exists in both. Standard conflict resolution.
            const localVer = Number(localLog.version || 0);
            const serverVer = Number(serverLog.version || 0);

            if (localVer > serverVer) {
                combinedMap.set(localLog.id, localLog);
            } else if (localVer === serverVer) {
                if ((localLog.updatedAt || 0) > (serverLog.updatedAt || 0)) {
                    combinedMap.set(localLog.id, localLog);
                }
            }
        }
    });

    return Array.from(combinedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
* Centralized function to save course data and flag it for auto-sync.
*/
function saveAndMarkChanges(courseName) {
    saveCourseToLocalStorage(courseName);
    pendingChanges = true;

    // Just update the UI to show pending changes.
    // The main auto-sync interval will handle the rest.
    if (isOnline && isSignedIn) {
        if (!isSyncing) { // Only update status if not already syncing
            updateSyncStatus("Pending sync...", "waiting");
        }
    }
}

// Helper function to convert a timestamp to a local ISO-like string (without timezone info)
function convertTimestampToLocalISOString(timestamp) {
    const date = new Date(timestamp);
    const pad = (num) => String(num).padStart(2, '0');
    // Build a string like "YYYY-MM-DDTHH:MM:SS"
    return date.getFullYear() + '-' +
        pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + 'T' +
        pad(date.getHours()) + ':' +
        pad(date.getMinutes()) + ':' +
        pad(date.getSeconds());
}

/**
* Syncs the logs for the CURRENTLY SELECTED course with its Google Sheet.
*/
async function syncLogsWithSheet() {
    // Basic conditions check
    if (!currentCourse || !isOnline || !isSignedIn) {
        return;
    }

    // ALL admins (global or not) will use the backend.
    if (isAdmin) {
        return syncViaBackendAPI();
    }

    // Note: Students don't sync, so this function will just return.
}

async function syncViaBackendAPI() {
    try {
        const logsToSync = courseData[currentCourse]?.logs || [];
        // Capture tombstones to send to server
        const tombstonesToSync = Array.from(courseData[currentCourse]?.tombstones || []);

        if (logsToSync.length === 0 && tombstonesToSync.length === 0) {
            console.log('No logs or tombstones to sync');
            return;
        }

        // Call backend to sync logs AND tombstones
        const result = await callWebApp('syncCourseLogs_Admin', {
            courseName: currentCourse,
            logs: logsToSync,
            tombstones: tombstonesToSync
        }, 'POST');

        if (result && result.result === 'success') {
            pendingChanges = false;
            lastSyncTime = Date.now();
            saveCourseToLocalStorage(currentCourse);
        } else {
            throw new Error(result?.message || 'Sync failed');
        }

    } catch (error) {
        console.error('Backend sync error:', error);
        throw error;
    }
}

/**
* Syncs the current frontend databaseMap UP to the Google Sheet via Apps Script.
* ONLY callable by admins.
*/
async function syncDatabaseToSheet() {
    if (!isAdmin || !isOnline) {
        console.warn("Skipping DB sync: not an admin or offline.");
        return;
    }

    try {
        // databaseMap is the global variable holding the frontend state
        const resultData = await callWebApp('syncDatabase_Admin', { databaseData: databaseMap }, 'POST');

        if (resultData && resultData.result === 'success') {
            console.log(`Successfully synced ${resultData.count} database entries via script.`);
            invalidateDatabaseCache(); // Invalidate cache after successful push
        } else {
            throw new Error(resultData ? resultData.message : 'Unknown error during database sync.');
        }

    } catch (error) {
        console.error('Error syncing database via script:', error);
        showNotification('error', 'Database Sync Error', `Failed to sync database: ${error.message}`);
        // Rethrow the error to be caught by the caller (e.g., completeAction)
        throw error;
    }
}


/**
 * Update sort icons in the table headers.
 */
function updateSortIcons() {
    // Reset all sort icons
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.className = 'sort-icon fa-solid fa-sort';
    });

    // Set sort icon for current sort field
    const [field, direction] = currentSort.split('-');
    const header = document.querySelector(`.sortable[data-sort="${field}"]`);

    if (header) {
        const icon = header.querySelector('.sort-icon');
        icon.className = `sort-icon fa-solid fa-sort-${direction === 'asc' ? 'up' : 'down'}`;
    }
}



/**
 * Handle filter input change for logs.
 */
function handleFilterChange() {
    filter = filterInput.value.toLowerCase();
    updateLogsList();
}

/**
 * Handle sort dropdown change for logs.
 */
function handleSortChange() {
    currentSort = sortSelect.value;
    localStorage.setItem('logs_sort', currentSort);
    const logsTable = document.querySelector('.logs-table'); // Get the table

    // Add or remove class based on the sort option
    if (currentSort.startsWith('date')) {
        logsTable.classList.add('sorting-by-date');
    } else {
        logsTable.classList.remove('sorting-by-date');
    }

    updateSortIcons();
    updateLogsList();
}

/**
 * Handle filter input change for database.
 */
function handleDbFilterChange() {
    dbFilter = dbFilterInput.value.toLowerCase();
    updateDatabaseList();
}

/**
 * Add new database entry.
 */
function showAddEntryDialog() {
    if (!isAdmin) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // State tracker for the NFC scan session
    let activeNfcSession = { controller: null, button: null };

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-user-plus"></i> Add New Student</h3>
        <div class="dialog-content">
            <p style="margin-bottom: 15px; opacity: 0.7;">Enter details for the new database entry.</p>
            
            <div class="form-group">
                <label class="dialog-label-fixed" for="add-name"><i class="fa-solid fa-quote-left"></i> Name*</label>
                <input type="text" id="add-name" class="form-control" placeholder="Full Name">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-email"><i class="fa-solid fa-at"></i> E-mail*</label>
                <input type="email" id="add-email" class="form-control" placeholder="nsurname00@epoka.edu.al">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID*</label>
                <div class="admin-input-wrapper">
                    <input type="text" id="add-uid" class="form-control" placeholder="AB:CD:12:34">
                    ${nfcSupported ? '<button class="btn-blue btn-icon btn-sm scan-uid-btn" title="Scan UID"><i class="fa-solid fa-wifi"></i></button>' : ''}
                </div>
            </div>
            
            <div id="nfc-status-container" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-add-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-add-btn" class="btn-green"><i class="fa-solid fa-plus"></i> Add Student</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const close = () => {
        // Ensure any active scan is stopped when the dialog closes
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const uidInput = dialog.querySelector('#add-uid');
    const nfcStatusContainer = dialog.querySelector('#nfc-status-container');
    const scanBtn = dialog.querySelector('.scan-uid-btn');

    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            // Check if the clicked button is already the active one
            if (activeNfcSession.button === scanBtn) {
                // If so, treat it as a "stop" button
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                activeNfcSession = { controller: null, button: null };
                scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                nfcStatusContainer.innerHTML = '';
                nfcStatusContainer.style.minHeight = '0';
            } else {
                // If another scan is active, stop it first.
                if (activeNfcSession.controller) {
                    activeNfcSession.controller.abort();
                    activeNfcSession.button.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                }
                // Start a new scan for this button
                scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>'; // Show a 'stop' icon
                const controller = startNfcForInputDialog(uidInput, nfcStatusContainer, scanBtn);
                activeNfcSession = { controller, button: scanBtn };
            }
        });
    }

    document.getElementById('cancel-add-btn').addEventListener('click', close);

    // --- Event Listener ---
    document.getElementById('confirm-add-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('add-name');
        const emailInput = document.getElementById('add-email');
        const uidInput = document.getElementById('add-uid');

        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        clearInputError(uidInput);
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const uid = uidInput.value.trim();
        let isValid = true;
        if (name === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (uid === '') { showInputError(uidInput, 'UID is required.'); isValid = false; }
        if (!isValid) return;

        const submissionData = {
            name: name,
            email: email,
            uid: uid,
            sentBy: {
                name: currentUser?.name || '',
                email: currentUser?.email || ''
            }
        };

        // Check for local duplicates first
        const match = findDuplicateInDatabase(submissionData);
        if (match) {
            // Duplicate found. Define the optimistic-UI callback for the warning dialog.
            const completeAction = () => {
                // This callback will be triggered by the warning dialog *after* it updates
                // the local databaseMap.
                window.buildUIDToPrimaryUidMap();
                updateUI(); // Refresh UI immediately

                // Now, sync the *entire* database in the background.
                if (isOnline) {
                    // This now calls the fast function
                    syncDatabaseToSheet().catch(err => {
                        console.error("Background sync failed:", err);
                        showNotification('error', 'Sync Failed', 'Changes saved locally but failed to sync.');
                    });
                }
            };

            showDuplicateWarningForNewEntry(submissionData, [match.duplicate], completeAction);
            close(); // Close the current 'Add' dialog
            return;
        }

        // NO DUPLICATE: Use the fast backend call `addEntryToDatabase_Admin`
        const confirmBtn = document.getElementById('confirm-add-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Adding...';

        try {
            const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');

            if (result && result.result === 'success') {
                showNotification('success', 'Added to Database', `${name} has been added.`);

                // The entry was added on the backend. Invalidate our local cache
                // and re-fetch the *entire* database to get the new entry with its proper key.
                invalidateDatabaseCache();
                await fetchDatabaseFromSheet(); // This is the fast backend call 'getDatabase'

                window.buildUIDToPrimaryUidMap();
                updateUI(); // Re-render everything with the new data
                close(); // 
            } else {
                throw new Error(result?.message || 'Failed to add entry');
            }
        } catch (error) {
            showNotification('error', 'Submission Failed', error.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Add Student';
        }
    });
}

function editDatabaseEntry(dbKey) {
    if (!isAdmin || !databaseMap[dbKey]) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const entry = databaseMap[dbKey];
    let activeNfcSession = { controller: null, button: null };

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-user-pen"></i> Edit Student</h3>
    <div class="dialog-content">
        <div class="form-group">
            <label class="dialog-label-fixed" for="edit-name"><i class="fa-solid fa-quote-left"></i> Name*</label>
            <input type="text" id="edit-name" class="form-control" placeholder="Full Name" value="${escapeHtml(entry.name)}">
        </div>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="edit-email"><i class="fa-solid fa-at"></i> Email*</label>
            <input type="email" id="edit-email" class="form-control" placeholder="nsurname00@epoka.edu.al" value="${escapeHtml(entry.email || '')}">
        </div>
        
        <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">
        
        <div id="uid-list-container"></div>
        
        <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
             <button id="add-new-uid-row-btn" class="btn-blue btn-sm"><i class="fa-solid fa-plus"></i> Add UID</button>
        </div>
        <div id="nfc-status-container" style="margin-top:10px;"></div>
    </div> 
    <div class="dialog-actions">
        <button id="cancel-request-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="submit-request-btn" class="btn-green"><i class="fa-solid fa-check"></i> Submit</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidListContainer = dialog.querySelector('#uid-list-container');
    const nfcStatusContainer = dialog.querySelector('#nfc-status-container');

    const createUidRow = (uidValue = '') => {
        const uidGroup = document.createElement('div');
        uidGroup.className = 'form-group uid-edit-row';
        uidGroup.style.marginBottom = '15px'; // Increased margin
        uidGroup.innerHTML = `
    <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
    <input type="text" class="form-control uid-input" value="${escapeHtml(uidValue)}" placeholder="AB:CD:12:34">
    <div class="uid-button-group"> ${nfcSupported ? '<button class="btn-blue btn-icon btn-sm scan-uid-btn" title="Scan UID"><i class="fa-solid fa-wifi"></i></button>' : ''}
        <button class="btn-red btn-icon btn-sm remove-uid-btn" title="Remove UID"><i class="fa-solid fa-minus"></i></button>
    </div> `;
        uidListContainer.appendChild(uidGroup);

        uidGroup.querySelector('.remove-uid-btn').addEventListener('click', () => {
            if (uidListContainer.querySelectorAll('.form-group').length > 1) {
                uidGroup.remove();
            } else {
                showNotification('warning', 'Cannot Remove', 'At least one UID field is required.');
            }
        });

        const scanBtn = uidGroup.querySelector('.scan-uid-btn');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => {
                const inputTarget = uidGroup.querySelector('.uid-input');

                if (activeNfcSession.button === scanBtn) {
                    // If clicking the already active button, stop the scan.
                    if (activeNfcSession.controller) activeNfcSession.controller.abort();
                    activeNfcSession = { controller: null, button: null };
                    scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                    nfcStatusContainer.innerHTML = '';
                    nfcStatusContainer.style.minHeight = '0';
                } else {
                    // If another scan is active, stop it first.
                    if (activeNfcSession.controller) {
                        activeNfcSession.controller.abort();
                        activeNfcSession.button.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                    }
                    // Start a new scan.
                    scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>'; // Show a 'stop' icon
                    const controller = startNfcForInputDialog(inputTarget, nfcStatusContainer, scanBtn);
                    activeNfcSession = { controller, button: scanBtn };
                }
            });
        }
    };

    entry.uids.forEach(uid => createUidRow(uid));
    if (entry.uids.length === 0) createUidRow();

    dialog.querySelector('#add-new-uid-row-btn').addEventListener('click', () => createUidRow());

    const closeDialog = () => {
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    // 1. Fixed ID: cancel-request-btn
    document.getElementById('cancel-request-btn').addEventListener('click', closeDialog);

    // 2. Fixed ID: submit-request-btn
    document.getElementById('submit-request-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('edit-name');
        const emailInput = document.getElementById('edit-email');
        const uidInputs = Array.from(dialog.querySelectorAll('.uid-input'));

        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        uidInputs.forEach(clearInputError);
        const newName = nameInput.value.trim();
        const newEmail = emailInput.value.trim();
        let isValid = true;
        if (newName === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(newEmail)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        const updatedUids = uidInputs.map(input => input.value.trim());
        if (updatedUids.some(uid => uid === '')) {
            showInputError(uidInputs.find(input => input.value.trim() === ''), 'UID fields cannot be empty.');
            isValid = false;
        }
        if (!isValid) return;

        // 1. Update local map
        databaseMap[dbKey] = { name: newName, email: newEmail, uids: updatedUids.filter(Boolean) };

        // 2. UPDATE UI IMMEDIATELY
        window.buildUIDToPrimaryUidMap();
        updateUI();

        // 3. SHOW SUCCESS AND CLOSE DIALOG IMMEDIATELY
        showNotification('success', 'Entry Updated', `Updated details for ${newName}.`);
        closeDialog();

        // 4. SYNC IN THE BACKGROUND
        if (isOnline) {
            const updateData = {
                dbKey: dbKey,
                name: newName,
                email: newEmail,
                uids: updatedUids.filter(Boolean)
            };

            callWebApp('updateStudentInDatabase_Admin', updateData, 'POST')
                .then(() => {
                    invalidateDatabaseCache();
                })
                .catch((err) => {
                    console.error("Background sync failed:", err);
                    showNotification('error', 'Sync Failed', 'Changes saved locally but failed to sync.');
                });
        }
    });
}

/**
 * Delete database entry.
 * @param {string} uid - The UID of the entry to delete.
 */
function deleteDatabaseEntry(dbKey) {
    if (!isAdmin) return;
    const name = databaseMap[dbKey]?.name;
    if (!name) return;

    showConfirmationDialog({
        title: `Delete "${escapeHtml(name)}" ?`,
        message: `Are you sure you want to delete "${escapeHtml(name)}" (Key: ${escapeHtml(dbKey)}) from the database?`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: async () => {
            // 1. Optimistic UI update
            delete databaseMap[dbKey];
            window.buildUIDToPrimaryUidMap();
            updateUI();
            showNotification('delete', 'Entry Deleted', `Removed ${name} from the database.`);

            // 2. Sync deletion to backend
            if (isOnline && isSignedIn) {
                try {
                    await callWebApp('deleteEntryFromDatabase_Admin', { dbKey: dbKey }, 'POST');
                    invalidateDatabaseCache(); // Invalidate cache after successful delete
                } catch (err) {
                    console.error('Error deleting entry from backend:', err);
                    showNotification('error', 'Sync Error', 'Entry deleted locally but failed to sync.');
                    // Since it failed, force a re-fetch to get back the deleted item
                    // to keep UI consistent with the server.
                    await fetchDatabaseFromSheet();
                    window.buildUIDToPrimaryUidMap();
                    updateUI();
                }
            }
        }
    });
}

/**
* Fetch course information from COURSE_INFO sheet
* @returns {Promise} A promise that resolves when course info is fetched
*/
async function fetchCourseInfo() {
    try {
        const result = await callWebApp('getCourseInfo', {}, 'POST');
        if (result) {
            courseInfoMap = result;
            courseIDMap = {}; // Reset map
            Object.entries(result).forEach(([courseName, metadata]) => {
                if (metadata && metadata.eisId) {
                    // Ensure key matches the currentCourse variable exactly (trim just in case)
                    courseIDMap[courseName.trim()] = metadata.eisId;
                }
            });
        }
    } catch (e) {
        console.error('Error fetching course info:', e);
    }
}

/**
        * Displays a custom, non-blocking alert dialog.
        * @param {string} title - The title of the dialog. (This is now ignored but kept for compatibility)
        * @param {string} message - The main text/HTML for the user.
        */
function showAlertDialog(title, message) {
    openDialogMode(); // Prevent background scroll
    const existingDialog = document.querySelector('.dialog-backdrop');
    if (existingDialog) existingDialog.remove();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <div class="dialog-content" style="padding-top: 10px;">${message}
        </div><div class="dialog-actions">
            <button id="dialog-ok-btn" class="btn-blue">OK</button>
        </div>
    `; // Removed title and <p> wrapper, adjusted padding

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        // Add fade-out animation
        dialog.classList.add('dialog-fade-out');
        dialogBackdrop.classList.add('backdrop-fade-out'); // Also fade backdrop

        setTimeout(() => {
            if (document.body.contains(dialogBackdrop)) {
                document.body.removeChild(dialogBackdrop);
            }
            closeDialogMode(); // Restore background scrolling
        }, 300); // Match animation duration
    };

    document.getElementById('dialog-ok-btn').addEventListener('click', closeDialog);
    dialogBackdrop.addEventListener('click', (e) => {
        if (e.target === dialogBackdrop) closeDialog();
    });
}

/**
* Displays a custom, non-blocking prompt dialog.
* @param {object} options - The options for the dialog.
*/
function showPromptDialog({ title, message, initialValue = '', confirmText = 'Confirm', cancelText = 'Cancel', onConfirm }) {
    openDialogMode();
    const existingDialog = document.querySelector('.dialog-backdrop');
    if (existingDialog) existingDialog.remove();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <h3 class="dialog-title">${title}</h3>
        <div class="dialog-content"><p>${message}</p>
        <div class="form-group">
            <input type="text" id="dialog-prompt-input" class="form-control" value="${initialValue}">
        </div>
        </div><div class="dialog-actions">
            <button id="dialog-cancel-btn" class="btn-red">${cancelText}</button>
            <button id="dialog-confirm-btn" class="btn-green">${confirmText}</button>
        </div>
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');
    const input = document.getElementById('dialog-prompt-input');
    input.focus();
    input.select();

    const closeDialog = () => {
        // This line assumes 'dialogBackdrop' is available in the function's scope.
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode(); // Restore background scrolling
    };

    const confirmAction = () => {
        onConfirm(input.value);
        closeDialog();
    };

    confirmBtn.addEventListener('click', confirmAction);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmAction();
    });

    cancelBtn.addEventListener('click', closeDialog);
    dialogBackdrop.addEventListener('click', (e) => {
        if (e.target === dialogBackdrop) closeDialog();
    });
}


/**
* Displays a custom confirmation dialog with dynamic button colors.
* @param {object} options - The options for the dialog.
* @param {boolean} [options.isDestructive=false] - If true, the confirm button will be red.
*/
function showConfirmationDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, isDestructive = false }) {
    openDialogMode();
    const existingDialog = document.querySelector('.dialog-backdrop');
    if (existingDialog) existingDialog.remove();

    const confirmBtnClass = isDestructive ? 'btn-red' : 'btn-green';
    const cancelBtnClass = 'btn-blue';

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
                <h3 class="dialog-title">${title}</h3>
                <div class="dialog-content"><p>${message}</p>
                </div><div class="dialog-actions">
                    <button id="dialog-cancel-btn" class="${cancelBtnClass}">${cancelText}</button>
                    <button id="dialog-confirm-btn" class="${confirmBtnClass}">${confirmText}</button>
                </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');

    const closeDialog = () => {
        // This line assumes 'dialogBackdrop' is available in the function's scope.
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode(); // Restore background scrolling
    };

    confirmBtn.addEventListener('click', () => {
        // This is the key: Run the action, THEN close the dialog.
        onConfirm();
        closeDialog();
    });

    cancelBtn.addEventListener('click', closeDialog);
    dialogBackdrop.addEventListener('click', (e) => {
        if (e.target === dialogBackdrop) {
            closeDialog();
        }
    });
}

/**
 * Clear the entire database.
 */
function clearDatabase() {
    if (!isAdmin) return;

    showConfirmationDialog({
        title: 'Wipe the ENTIRE Database?',
        message: 'This will remove all UID-name mappings permanently. This action cannot be undone.',
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: () => {
            databaseMap = {};
            // Sync to sheet if online
            if (isOnline && isSignedIn) {
                syncDatabaseToSheet().catch(err => console.error('Error syncing database:', err));
                refreshAdminViews();
            }
            updateUI();
            showNotification('success', 'Database Cleared', 'All database entries have been removed.');
        }
    });
}

/**
 * Shows a dialog to add a manual log entry with a searchable student list.
 */
function showAddLogEntryDialog() {
    if (!isAdmin) return;
    if (!currentCourse) {
        showNotification('warning', 'No Course', 'Select a course first.');
        return;
    }

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const formattedTime = now.toTimeString().split(' ')[0].substring(0, 5);

    // Prepare Session Toggles
    const sessionHtml = renderSessionSelectorHTML('manual', false, true);

    // Prepare student list
    const studentList = [];
    Object.entries(databaseMap).forEach(([dbKey, data]) => {
        data.uids.forEach(uid => {
            studentList.push({
                name: data.name,
                uid: uid,
                initials: data.name.substring(0, 2).toUpperCase()
            });
        });
    });
    studentList.sort((a, b) => a.name.localeCompare(b.name));

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fas fa-clock"></i> Add Manual Log</h3>
    <div class="dialog-content">
        
        <div class="form-group" style="margin-bottom:0;">
            <label class="dialog-label-fixed"><i class="fas fa-search"></i> Search</label>
            <input type="text" id="manual-name-search" class="form-control" placeholder="Type name or UID..." autocomplete="off">
        </div>

        <div id="student-list-container" class="student-list-container"></div>
        <div id="selection-hint" style="font-size:0.85em; color:#888; margin-top:5px; text-align:right;">No student selected</div>

        <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
            <input type="date" id="manual-date" class="form-control" value="${formattedDate}">
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-clock"></i> Time</label>
            <input type="time" id="manual-time" class="form-control" value="${formattedTime}">
        </div>

        <div class="form-group" style="align-items:flex-start; margin-top:15px;">
            <label class="dialog-label-fixed" style="margin-top:12px;"><i class="fa-solid fa-users"></i> Group</label>
            <div style="flex-grow:1;">
                ${sessionHtml || '<input type="text" id="manual-session-fallback" class="form-control" value="Default" disabled>'}
            </div>
        </div>

    </div>
    <div class="dialog-actions">
        <button id="cancel-manual-btn" class="btn-red">Cancel</button>
        <button id="save-manual-log-btn" class="btn-green" disabled>Add Entry</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Activate Toggles ---
    if (sessionHtml) {
        const rawSections = courseInfoMap[currentCourse].availableSections || '';
        setupSessionToggleListeners('manual', parseAvailableSections(rawSections));

        // Auto-select based on Main UI State
        const currentActive = getCurrentActiveSession();
        if (currentActive && currentActive !== 'Default') {
            const [cat, grp] = currentActive.split(' ');

            // Trigger clicks to simulate selection
            const catBtn = document.querySelector(`#manual-cat-row .course-button[data-val="${cat}"]`);
            if (catBtn) catBtn.click();

            if (grp) {
                const grpBtn = document.querySelector(`#manual-groups-${cat} .course-button[data-val="${grp}"]`);
                if (grpBtn) grpBtn.click();
            }
        }
    }

    // --- Logic (Student Search) ---
    let selectedUid = null;
    const listContainer = dialog.querySelector('#student-list-container');
    const searchInput = dialog.querySelector('#manual-name-search');
    const saveBtn = dialog.querySelector('#save-manual-log-btn');
    const selectionHint = dialog.querySelector('#selection-hint');

    const renderList = (filterText = '') => {
        listContainer.innerHTML = '';
        const lowerFilter = filterText.toLowerCase();
        const filtered = studentList.filter(s =>
            s.name.toLowerCase().includes(lowerFilter) ||
            s.uid.toLowerCase().includes(lowerFilter)
        );

        if (filtered.length === 0) {
            listContainer.innerHTML = `<div style="padding:20px; text-align:center; opacity:0.6;">No results found</div>`;
            return;
        }

        const itemsToShow = filtered.slice(0, 50);
        itemsToShow.forEach(student => {
            const div = document.createElement('div');
            div.className = `student-item ${selectedUid === student.uid ? 'selected' : ''}`;
            div.innerHTML = `
                <div class="student-avatar-placeholder">${student.initials}</div>
                <div class="student-info">
                    <div class="student-name">${escapeHtml(student.name)}</div>
                    <div class="student-uid">${escapeHtml(student.uid)}</div>
                </div>`;
            div.onclick = () => selectStudent(student);
            listContainer.appendChild(div);
        });
    };

    const selectStudent = (student) => {
        selectedUid = student.uid;
        renderList(searchInput.value);
        selectionHint.textContent = `Selected: ${student.name}`;
        selectionHint.style.color = "var(--primary-color)";
        saveBtn.disabled = false;
    };

    searchInput.addEventListener('input', (e) => renderList(e.target.value));
    renderList();

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    dialog.querySelector('#cancel-manual-btn').addEventListener('click', closeDialog);

    saveBtn.addEventListener('click', () => {
        if (!selectedUid) return;

        const manualDate = document.getElementById('manual-date').value;
        const manualTime = document.getElementById('manual-time').value;

        let manualSession = 'Default';
        const sessionInput = document.getElementById('manual-selected-session');
        if (sessionInput) manualSession = sessionInput.value;

        let newLog = {
            uid: selectedUid,
            timestamp: new Date(`${manualDate}T${manualTime}:00`).getTime(),
            id: Date.now() + Math.random().toString(36).substring(2, 11),
            manual: true,
            session: manualSession
        };

        newLog = touchLogForEdit(newLog, currentUser?.email);

        if (!courseData[currentCourse]) {
            courseData[currentCourse] = { logs: [], tombstones: new Set() };
        }

        courseData[currentCourse].logs.unshift(newLog);
        saveAndMarkChanges(currentCourse);
        updateUI();

        if (isOnline && isSignedIn) syncLogsWithSheet();

        showNotification('success', 'Entry Added', 'Manual log recorded.');
        closeDialog();
    });
}

/**
 * Validates an email string.
 * @param {string} email - The email to validate.
 * @returns {boolean} True if the email is valid, false otherwise.
 */
function isValidEmail(email) {
    if (!email || email.trim() === '') return false; // Check if empty
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Basic email format regex
    return emailRegex.test(email);
}

/**
* Show dialog to edit a log entry group.
* @param {Object} group - The log group to edit.
*/
function showEditLogDialog(group) {
    if (!isAdmin) return;
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    group.originalLogs.sort((a, b) => a.timestamp - b.timestamp);
    const firstLog = group.originalLogs[0];
    const commonDateObj = new Date(firstLog.timestamp);
    const formattedDate = commonDateObj.toISOString().split('T')[0];

    // --- Determine correct UID display value ---
    // If we have the display array (actual card IDs), use that. Otherwise fallback to uid.
    const uidDisplayValue = (group.uidsForDisplay && group.uidsForDisplay.length > 0)
        ? group.uidsForDisplay.join(', ')
        : group.uid;

    let timestampFields = '';
    group.originalLogs.forEach((log, index) => {
        const timeObj = new Date(log.timestamp);
        const formattedTime = timeObj.getHours().toString().padStart(2, '0') + ':' + timeObj.getMinutes().toString().padStart(2, '0');
        const manualClass = (log.manual === true || log.manual === 'true') ? 'manual-timestamp-input' : '';

        // --- Session Dropdown ---
        const sessionLabel = log.session ? log.session : 'Default';
        const optionsHtml = generateSessionOptions(sessionLabel);

        timestampFields += `
        <div class="timestamp-edit-group" data-log-id="${log.id}">
            <div class="form-group" style="align-items:center;">
                <label class="dialog-label-fixed">Time ${index + 1}</label>
                
                <div style="flex-grow:1; display:flex; flex-direction:column; gap:5px;">
                    <div class="input-with-icon">
                        <i class="fa-regular fa-clock"></i>
                        <input type="time" class="form-control timestamp-time ${manualClass}" value="${formattedTime}">
                    </div>
                    <select class="form-control timestamp-session" style="font-size:0.85em; padding:4px 8px; height:auto;">
                        ${optionsHtml}
                    </select>
                </div>

                <button class="delete-time-btn btn-red btn-icon" data-index="${index}" title="Delete Timestamp" style="margin-left:10px;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`;
    });

    dialog.innerHTML = `
    <h3 class="dialog-title">Edit Log Entry</h3>
    <div class="dialog-content">
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-right"></i> Name</label>
            <input type="text" id="edit-name" class="form-control" value="${escapeHtml(group.name)}" disabled>
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input type="text" id="edit-uid" class="form-control" value="${escapeHtml(uidDisplayValue)}" disabled>
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
            <input type="date" id="edit-date" class="form-control" value="${formattedDate}">
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <label style="font-weight:700; color:var(--primary-color);"><i class="fa-regular fa-clock"></i> Timestamps</label>
            <div style="display:flex; gap:5px;">
                <button id="add-new-time-btn" class="btn-green btn-sm"><i class="fa-solid fa-plus"></i> Add Time</button>
                <button id="delete-all-logs-btn" class="btn-red btn-sm"><i class="fa-solid fa-trash"></i> Delete All</button>
            </div>
        </div>
        
        <div id="timestamp-container">${timestampFields}</div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-edit-log-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-edit-log-btn" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const timestampContainer = document.getElementById('timestamp-container');

    // Add New Time Logic
    document.getElementById('add-new-time-btn').addEventListener('click', () => {
        const allTimes = timestampContainer.querySelectorAll('.timestamp-time');
        let newTimeValue = '12:00';

        if (allTimes.length > 0) {
            const latestTime = Array.from(allTimes).reduce((latest, current) => current.value > latest ? current.value : latest, '00:00');
            const [hours, minutes] = latestTime.split(':').map(Number);
            const nextHour = (hours + 1) % 24;
            newTimeValue = `${String(nextHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        const defaultSessionOptions = generateSessionOptions(getCurrentActiveSession());

        const newTimestampGroup = document.createElement('div');
        newTimestampGroup.className = 'timestamp-edit-group new-item-flash';
        newTimestampGroup.dataset.isNew = "true";
        newTimestampGroup.innerHTML = `
        <div class="form-group">
            <label class="dialog-label-fixed">New Time</label>
            <div class="input-with-icon" style="flex-grow:1; display:flex; flex-direction:column; gap:5px;">
                <div class="input-with-icon">
                    <i class="fa-regular fa-clock"></i>
                    <input type="time" class="form-control timestamp-time manual-timestamp-input" value="${newTimeValue}">
                </div>
                <select class="form-control timestamp-session" style="font-size:0.85em; padding:4px 8px; height:auto;">
                    ${defaultSessionOptions}
                </select>
            </div>
            <button class="delete-time-btn btn-red btn-icon" title="Remove" style="margin-left:10px;">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;

        timestampContainer.appendChild(newTimestampGroup);
        newTimestampGroup.querySelector('.delete-time-btn').addEventListener('click', function () {
            this.closest('.timestamp-edit-group').remove();
        });
    });

    const closeDialog = () => { if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop); closeDialogMode(); };

    // Delete individual timestamp logic
    const logsToDelete = new Set();
    dialog.querySelectorAll('.delete-time-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const index = parseInt(this.getAttribute('data-index'));
            const logId = group.originalLogs[index].id;
            const timestampGroup = this.closest('.timestamp-edit-group');
            logsToDelete.add(logId);
            timestampGroup.classList.add('deleted');
            timestampGroup.style.display = 'none';
        });
    });

    // --- Delete All Logic ---
    document.getElementById('delete-all-logs-btn').addEventListener('click', () => {
        showConfirmationDialog({
            title: 'Delete Entire Entry?',
            message: `Are you sure you want to delete <strong>ALL ${group.originalLogs.length} timestamps</strong> for this date? This cannot be undone.`,
            confirmText: 'Delete All',
            isDestructive: true,
            onConfirm: () => {
                const idsToRemove = group.originalLogs.map(log => log.id);

                if (isGlobalAdmin) {
                    idsToRemove.forEach(id => addToTombstones(id));
                    courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToRemove.includes(log.id));
                    saveAndMarkChanges(currentCourse);
                    updateUI();
                    showNotification('delete', 'Deleted', 'All timestamps were deleted.');
                    if (isOnline && isSignedIn) syncLogsWithSheet();
                } else {
                    Promise.all(idsToRemove.map(id => deleteLogViaBackend(id)))
                        .then(() => {
                            courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToRemove.includes(log.id));
                            updateUI();
                            showNotification('delete', 'Deleted', 'All timestamps were deleted.');
                        })
                        .catch(err => {
                            showNotification('error', 'Error', 'Failed to delete some logs.');
                            console.error(err);
                        });
                }
                closeDialog();
            }
        });
    });

    // SAVE LOGIC
    document.getElementById('save-edit-log-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('edit-name');
        const newDateStr = document.getElementById('edit-date').value;
        const newName = nameInput.value.trim();
        const logsForCurrentCourse = courseData[currentCourse].logs;
        const [year, month, day] = newDateStr.split('-').map(Number);

        // Update Existing Logs
        const visibleGroups = dialog.querySelectorAll('.timestamp-edit-group:not(.deleted)');
        visibleGroups.forEach(groupElement => {
            const logId = groupElement.getAttribute('data-log-id');
            if (!logId) return;

            const timeInput = groupElement.querySelector('.timestamp-time');
            const sessionInput = groupElement.querySelector('.timestamp-session');
            const [hours, minutes] = timeInput.value.split(':').map(Number);

            const log = logsForCurrentCourse.find(l => l.id === logId);
            if (log) {
                const newTimestampObj = new Date(year, month - 1, day, hours, minutes, 0);
                log.timestamp = newTimestampObj.getTime();
                log.manual = timeInput.classList.contains('manual-timestamp-input');
                log.session = sessionInput.value;
                touchLogForEdit(log, currentUser?.email);
            }
        });

        if (logsToDelete.size > 0) {
            courseData[currentCourse].logs = logsForCurrentCourse.filter(log => !logsToDelete.has(log.id));
            logsToDelete.forEach(id => addToTombstones(id));
        }

        const newTimestampGroups = dialog.querySelectorAll('.timestamp-edit-group[data-is-new="true"]');
        newTimestampGroups.forEach(newGroup => {
            const timeValue = newGroup.querySelector('.timestamp-time').value;
            const sessionValue = newGroup.querySelector('.timestamp-session').value;
            const [hours, minutes] = timeValue.split(':').map(Number);
            const newTimestampObj = new Date(year, month - 1, day, hours, minutes, 0);

            let newLog = {
                uid: group.originalLogs[0]?.uid,
                timestamp: newTimestampObj.getTime(),
                id: Date.now() + Math.random().toString(36).substring(2, 11),
                manual: true,
                session: sessionValue
            };
            newLog = touchLogForEdit(newLog, currentUser?.email);
            courseData[currentCourse].logs.unshift(newLog);
        });

        saveAndMarkChanges(currentCourse);
        if (isOnline && isSignedIn) {
            syncLogsWithSheet();
        }
        updateUI();
        closeDialog();
    });

    document.getElementById('cancel-edit-log-btn').addEventListener('click', closeDialog);
}

/**
 * Confirms deletion of the latest log or the entire group.
 */
function confirmDeleteLog(group) {
    if (!isAdmin) return;

    const logsForCurrentCourse = courseData[currentCourse]?.logs || [];

    if (group.originalLogs.length > 1) {
        // Case 1: Deleting just the latest timestamp
        const latestLog = group.originalLogs.reduce((latest, log) => log.timestamp > latest.timestamp ? log : latest);

        // 1. Optimistic UI Update: Remove the log locally first.
        courseData[currentCourse].logs = logsForCurrentCourse.filter(log => log.id !== latestLog.id);
        updateUI(); // Update UI immediately (FAST!)

        // 2. Call backend in the background.
        deleteLogViaBackend(latestLog.id)
            .then(() => {
                // Success! Show notification.
                showNotification('delete', 'Timestamp Deleted', 'Log removed.');
            })
            .catch(err => {
                // 3. Handle Failure: Revert the change.
                console.error('Delete failed, reverting UI:', err);
                showNotification('error', 'Delete Failed', 'Could not delete log, restoring.');
                // Add the log back and refresh
                courseData[currentCourse].logs.unshift(latestLog);
                updateUI(); // Refresh UI again to show the restored log
            });

    } else if (group.originalLogs.length === 1) {
        // Case 2: Deleting the last timestamp (show confirmation)
        showConfirmationDialog({
            title: 'Delete all logs for this date?',
            message: `This will remove all logs for ${escapeHtml(group.name)} on this date. This is the last timestamp.`,
            confirmText: 'Delete',
            isDestructive: true,
            onConfirm: () => {
                const idsToRemove = group.originalLogs.map(log => log.id);
                const removedLogs = logsForCurrentCourse.filter(log => idsToRemove.includes(log.id)); // Store what we're removing

                // 1. Optimistic UI Update
                courseData[currentCourse].logs = logsForCurrentCourse.filter(log => !idsToRemove.includes(log.id));
                updateUI();
                showNotification('delete', 'Entry Deleted', `All timestamps for ${group.name} were deleted.`);

                // 2. Call backend in the background
                Promise.all(idsToRemove.map(id => deleteLogViaBackend(id)))
                    .then(() => {
                        // Success!
                    })
                    .catch(err => {
                        // 3. Handle Failure: Revert
                        console.error('Bulk delete failed, reverting UI:', err);
                        showNotification('error', 'Delete Failed', 'Could not delete entry, restoring.');
                        courseData[currentCourse].logs.unshift(...removedLogs); // Add them back
                        updateUI();
                    });
            }
        });
    }
}

// --- Advanced Selection Logic ---

function handleLogCheckbox(e, logId) {
    e.stopPropagation();

    // Handle Shift+Click Range Selection
    if (e.shiftKey && lastCheckedLogId) {
        const checkboxes = Array.from(document.querySelectorAll('.bulk-checkbox'));
        const startIdx = checkboxes.findIndex(cb => cb.value === lastCheckedLogId);
        const endIdx = checkboxes.findIndex(cb => cb.value === logId);

        if (startIdx !== -1 && endIdx !== -1) {
            const low = Math.min(startIdx, endIdx);
            const high = Math.max(startIdx, endIdx);

            // Check everything in range
            for (let i = low; i <= high; i++) {
                checkboxes[i].checked = e.target.checked;
                // Extract ID from value (which might be comma separated if group)
                const ids = checkboxes[i].value.split(',');
                ids.forEach(id => {
                    if (e.target.checked) selectedLogIds.add(id);
                    else selectedLogIds.delete(id);
                });
            }
        }
    } else {
        // Normal Click
        const ids = e.target.value.split(',');
        ids.forEach(id => {
            if (e.target.checked) selectedLogIds.add(id);
            else selectedLogIds.delete(id);
        });
    }

    lastCheckedLogId = logId;
    updateBulkUI();
}

function toggleDateGroup(dateStr, isChecked) {
    // Find only rows that belong to this specific date
    // (We added data-date to the rows in the previous step)
    const rows = document.querySelectorAll(`tr[data-date="${dateStr}"]`);

    rows.forEach(row => {
        const cb = row.querySelector('.bulk-checkbox');
        if (cb) {
            cb.checked = isChecked;
            const ids = cb.value.split(',');
            ids.forEach(id => {
                if (isChecked) selectedLogIds.add(id);
                else selectedLogIds.delete(id);
            });
        }
    });
    updateBulkUI();
}

function toggleSelectAll(isChecked) {
    // Only select checkboxes inside the table BODY (ignoring the header one itself)
    const rowCheckboxes = document.querySelectorAll('#logs-tbody .bulk-checkbox');

    rowCheckboxes.forEach(cb => {
        cb.checked = isChecked;

        // The value contains the Log ID(s) for that row
        const ids = cb.value.split(',');

        ids.forEach(id => {
            if (isChecked) selectedLogIds.add(id);
            else selectedLogIds.delete(id);
        });
    });

    // Also visually toggle all Date Group checkboxes to match
    document.querySelectorAll('.day-separator-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });

    updateBulkUI();
}

function updateBulkUI() {
    const countBadge = document.getElementById('bulk-count');
    if (countBadge) countBadge.textContent = selectedLogIds.size;
}

// --- Bulk Operations ---

async function performBulkAction(action) {
    if (selectedLogIds.size === 0) return;

    let confirmMsg = "", confirmTitle = "";
    let extraHtml = "";

    // Enable inherit option for BOTH add1h AND sub1h
    const includeInherit = (action === 'add1h' || action === 'sub1h');
    const sessionHtml = renderSessionSelectorHTML('bulk', includeInherit);

    if (action === 'delete') {
        confirmTitle = `Delete ${selectedLogIds.size} Entries?`;
        confirmMsg = "Delete all logs for the selected rows? This cannot be undone.";
    } else if (action === 'add1h') {
        confirmTitle = `Add +1 Hour?`;
        confirmMsg = `Create a new log 1 hour later for every selected student.`;
        if (sessionHtml) extraHtml = `<div style="margin-top:15px; text-align:left;"><label style="font-size:0.85em; font-weight:600; color:var(--primary-color);">Target Session:</label>${sessionHtml}</div>`;
    } else if (action === 'sub1h') {
        confirmTitle = `Delete Latest Hour?`;
        // Shorter message as requested
        confirmMsg = `Remove the latest log entry for the selected rows?`;
        if (sessionHtml) {
            extraHtml = `
            <div style="margin-top:15px; text-align:left;">
                <label style="font-size:0.85em; font-weight:600; color:var(--primary-color);">Target:</label>
                ${sessionHtml}
                <div style="font-size:0.8em; color:#666; margin-top:5px; font-style:italic;">
                    "Latest" deletes the most recent log regardless of group.
                </div>
            </div>`;
        }
    }

    showConfirmationDialog({
        title: confirmTitle,
        message: confirmMsg + extraHtml,
        confirmText: "Confirm",
        isDestructive: action === 'delete' || action === 'sub1h',
        onConfirm: async () => {
            let targetSession = 'INHERIT';
            const sessionInput = document.getElementById('bulk-selected-session');
            if (sessionInput) targetSession = sessionInput.value;

            const allLogs = courseData[currentCourse].logs;
            const allSelectedIds = Array.from(selectedLogIds);
            let logsModified = false;

            // --- DELETE ALL ---
            if (action === 'delete') {
                allSelectedIds.forEach(id => addToTombstones(id));
                courseData[currentCourse].logs = allLogs.filter(l => !selectedLogIds.has(l.id));
                logsModified = true;
                showNotification('delete', 'Deleted', `Deleted selected logs.`);
            }

            // --- ADD +1 HOUR ---
            else if (action === 'add1h') {
                const newLogs = [];
                const groupsProcessed = new Set();
                allSelectedIds.forEach(id => {
                    const originalLog = allLogs.find(l => l.id === id);
                    if (!originalLog) return;
                    const d = new Date(originalLog.timestamp);
                    const key = `${originalLog.uid}_${d.getDate()}_${d.getMonth()}`;

                    if (!groupsProcessed.has(key)) {
                        const siblings = allLogs.filter(l => l.uid === originalLog.uid && new Date(l.timestamp).getDate() === d.getDate() && new Date(l.timestamp).getMonth() === d.getMonth());
                        if (siblings.length > 0) {
                            const latestSibling = siblings.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            const newTime = new Date(latestSibling.timestamp);
                            newTime.setHours(newTime.getHours() + 1);

                            let finalSession = latestSibling.session;
                            if (targetSession !== 'INHERIT') finalSession = targetSession;

                            let newLog = { uid: latestSibling.uid, timestamp: newTime.getTime(), id: Date.now() + Math.random().toString(36).substring(2, 11), manual: true, session: finalSession };
                            newLogs.push(touchLogForEdit(newLog, currentUser?.email));
                            groupsProcessed.add(key);
                        }
                    }
                });
                courseData[currentCourse].logs.unshift(...newLogs);
                logsModified = true;
                showNotification('success', 'Added', `${newLogs.length} new logs.`);
            }

            // --- REMOVE -1 HOUR (Updated Logic) ---
            else if (action === 'sub1h') {
                const groupsProcessed = new Set();
                const idsToDelete = [];
                let ignoredCount = 0;

                allSelectedIds.forEach(id => {
                    const originalLog = allLogs.find(l => l.id === id);
                    if (!originalLog) return;
                    const d = new Date(originalLog.timestamp);
                    const key = `${originalLog.uid}_${d.getDate()}_${d.getMonth()}`;

                    if (!groupsProcessed.has(key)) {
                        const siblings = allLogs.filter(l => l.uid === originalLog.uid && new Date(l.timestamp).getDate() === d.getDate() && new Date(l.timestamp).getMonth() === d.getMonth());
                        let logToDelete = null;

                        // Logic to handle INHERIT vs Specific Session
                        if (targetSession === 'INHERIT') {
                            // Just find the absolute latest log, regardless of session
                            if (siblings.length > 0) {
                                logToDelete = siblings.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            }
                        } else {
                            // Find latest log that MATCHES the target session
                            const matchingLogs = siblings.filter(l => (l.session || 'Default') === targetSession);
                            if (matchingLogs.length > 0) {
                                logToDelete = matchingLogs.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            } else {
                                ignoredCount++; // Found student, but no log in that specific session
                            }
                        }

                        if (logToDelete) idsToDelete.push(logToDelete.id);
                        groupsProcessed.add(key);
                    }
                });

                if (idsToDelete.length > 0) {
                    idsToDelete.forEach(id => addToTombstones(id));
                    courseData[currentCourse].logs = allLogs.filter(l => !idsToDelete.includes(l.id));
                    logsModified = true;
                    showNotification('success', 'Updated', `Removed ${idsToDelete.length} logs.${ignoredCount > 0 ? ` (Ignored ${ignoredCount})` : ''}`);
                } else if (ignoredCount > 0) {
                    showNotification('info', 'No Action', `No logs found matching "${targetSession}".`);
                }
            }

            if (logsModified) {
                saveAndMarkChanges(currentCourse);
                toggleBulkMode();
                updateUI();
                if (isOnline && isSignedIn) syncLogsWithSheet();
            }
        }
    });

    // Activate toggles in dialog (Standard)
    if (extraHtml) {
        setTimeout(() => {
            const rawSections = courseInfoMap[currentCourse].availableSections || '';
            setupSessionToggleListeners('bulk', parseAvailableSections(rawSections));
        }, 0);
    }
}

function toggleBulkMode() {
    isBulkMode = !isBulkMode;
    selectedLogIds.clear(); // Clear selections on toggle

    const table = document.querySelector('.logs-table');
    const bulkBar = document.getElementById('bulk-actions-bar');

    // Toggle classes
    if (isBulkMode) {
        table.classList.add('bulk-mode');
        bulkBar.classList.add('visible');

        // Add Master Checkbox to Header if missing
        const theadRow = table.querySelector('thead tr');
        if (!theadRow.querySelector('.select-column-header')) {
            const th = document.createElement('th');
            th.className = 'select-column select-column-header';
            // Note: We do NOT use 'bulk-checkbox' class here to avoid selecting it in loops
            th.innerHTML = `<input type="checkbox" onclick="toggleSelectAll(this.checked)" style="cursor:pointer; width:18px; height:18px;">`;
            theadRow.insertBefore(th, theadRow.firstChild);
        }
    } else {
        table.classList.remove('bulk-mode');
        bulkBar.classList.remove('visible');

        // Remove Master Checkbox
        const th = table.querySelector('.select-column-header');
        if (th) th.remove();

        // Uncheck everything visually
        document.querySelectorAll('.bulk-checkbox').forEach(cb => cb.checked = false);
        document.querySelectorAll('.day-separator-checkbox').forEach(cb => cb.checked = false);
    }
    updateLogsList(); // Re-render rows to show/hide columns
    updateBulkUI();
}

function deleteSelectedLogs() {
    if (selectedLogIds.size === 0) return;

    showConfirmationDialog({
        title: `Delete ${selectedLogIds.size} entries?`,
        message: "All selected logs will be deleted. This cannot be undone.",
        confirmText: "Delete All",
        isDestructive: true,
        onConfirm: () => {
            // 1. Optimistic UI update
            // We need to filter out ALL logs that match the selected "Group Keys" or IDs
            // Ideally, we collected log IDs. 

            const idsToDelete = Array.from(selectedLogIds);

            if (isGlobalAdmin) {
                idsToDelete.forEach(id => addToTombstones(id));
                courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToDelete.includes(log.id));

                toggleBulkMode();
                saveAndMarkChanges(currentCourse);
                updateUI();
                if (isOnline && isSignedIn) syncLogsWithSheet();
            } else {
                // Course Admin: Delete one by one via backend
                Promise.all(idsToDelete.map(id => deleteLogViaBackend(id))).then(() => {
                    courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToDelete.includes(log.id));
                    toggleBulkMode();
                    updateUI();
                });
            }
        }
    });
}

/**
 * Delete a log via backend API (for non-global admins)
 * This ensures tombstones are written to DELETED_LOG_IDS sheet
 */
async function deleteLogViaBackend(logId) {
    try {
        const result = await callWebApp('deleteLog_Admin', {
            courseName: currentCourse,
            logId: logId
        }, 'POST');

        if (result && result.result === 'success') {
            return true;
        } else {
            throw new Error(result?.message || 'Delete failed');
        }
    } catch (error) {
        console.error('Backend delete error:', error);
        showNotification('error', 'Delete Failed', error.message);
        throw error;
    }
}

/**
 * Clear logs for the currently selected course.
 */
function clearLogs() {
    if (!isAdmin || !currentCourse || !courseData[currentCourse]) return;

    const onConfirmAction = () => {
        const currentLogs = courseData[currentCourse].logs;
        const currentTombstones = courseData[currentCourse].tombstones;

        // Add all existing log IDs to the tombstones for syncing the deletion.
        currentLogs.forEach(log => currentTombstones.add(log.id));

        // Clear the logs array.
        courseData[currentCourse].logs = [];

        saveAndMarkChanges(currentCourse);
        updateUI();

        if (isOnline && isSignedIn) {
            syncLogsWithSheet()
                .then(() => showNotification('delete', 'Logs Cleared', `All logs for ${currentCourse} have been removed.`))
                .catch(err => console.error('Error clearing logs:', err));
        }
    };

    showConfirmationDialog({
        title: `Delete logs for ${escapeHtml(currentCourse.replace(/_/g, ' '))}?`,
        message: 'This will remove all logs for the current course. This action cannot be undone.',
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: onConfirmAction
    });
}


/**
 * Handle file selection for Excel import.
 * @param {Event} event - The change event from the file input.
 */
function handleExcelFile(event) {
    if (!isAdmin) return;
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // Read as array of arrays

            const excelMappings = {};
            // Skip header row (index 0)
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (row && row.length >= 2) {
                    const name = row[0];
                    const uid = String(row[1]);
                    const email = row[2] || ''; // Read email from 3rd column, default to empty

                    if (name && uid) {
                        excelMappings[uid.trim()] = { name: String(name).trim(), email: String(email).trim() };
                    }
                }
            }

            const excelCount = Object.keys(excelMappings).length;
            if (excelCount === 0) {
                return showNotification('error', 'Import Failed', 'Could not find Name and UID.');
            }
            showDatabaseImportDialog(excelMappings);
        } catch (error) {
            console.error('Excel import error:', error);
            showNotification('error', 'Import Failed', 'Could not process the Excel file.');
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

/**
 * Show import dialog for database Excel data.
 * @param {Object} excelMappings - The UID-name mappings from Excel.
 */
function showDatabaseImportDialog(excelMappings) {
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
        <h3 class="dialog-title">Import UID Database</h3>
        <div class="dialog-content"><p>Found ${Object.keys(excelMappings).length} entries in the Excel file. How would you like to import them?</p>
        </div><div class="dialog-actions">
            <button id="merge-db-btn" class="btn-blue">Merge</button>
            <button id="replace-db-btn" class="btn-orange">Replace</button>
            <button id="cancel-db-import-btn" class="btn-red">Cancel</button>
        </div>
    `;
    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    document.getElementById('merge-db-btn').addEventListener('click', () => {
        let newCount = 0;
        for (const [uid, data] of Object.entries(excelMappings)) {
            if (!databaseMap[uid]) {
                databaseMap[uid] = data; // Add the {name, email} object
                newCount++;
            }
        }
        if (isOnline) {
            syncDatabaseToSheet();
            refreshAdminViews();
        }
        updateUI();
        showNotification('success', 'Database Merged', `Added ${newCount} new entries.`);
        document.body.removeChild(dialogBackdrop);
    });

    document.getElementById('replace-db-btn').addEventListener('click', () => {
        databaseMap = { ...excelMappings }; // Replace with the new map structure
        if (isOnline) {
            syncDatabaseToSheet();
            refreshAdminViews();
        }
        updateUI();
        showNotification('success', 'Database Replaced', `Database now contains ${Object.keys(excelMappings).length} entries.`);
        document.body.removeChild(dialogBackdrop);
    });

    document.getElementById('cancel-db-import-btn').addEventListener('click', () => {
        document.body.removeChild(dialogBackdrop);
    });
}

/**
 * Handle file selection for logs JSON import.
 * @param {Event} event - The change event from the file input.
 */
function handleImportFile(event) {
    if (!isAdmin) return;

    if (!currentCourse) {
        showNotification('warning', 'No Course Selected', 'Please select a course before importing logs');
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const importedLogs = JSON.parse(e.target.result);

            if (!Array.isArray(importedLogs)) {
                throw new Error('Invalid format: Logs must be an array');
            }

            // Normalize timestamps to milliseconds and ensure IDs
            importedLogs.forEach(log => {
                if (log.timestamp) {
                    try {
                        log.timestamp = new Date(log.timestamp).getTime();

                        if (isNaN(log.timestamp)) {
                            console.warn(`Invalid timestamp: ${log.timestamp}`);
                            log.timestamp = Date.now();
                        }
                    } catch (err) {
                        console.warn(`Error parsing timestamp: ${err}`);
                        log.timestamp = Date.now();
                    }
                } else {
                    log.timestamp = Date.now();
                }

                // Ensure each log has an ID
                if (!log.id) {
                    log.id = Date.now() + Math.random().toString(36).substring(2, 11);
                }
            });

            // Show import dialog
            showImportDialog(importedLogs);
        } catch (error) {
            showNotification('error', 'Import Failed', 'The selected file is not a valid logs file.');
            console.error('Import error:', error);
        }
    };

    reader.onerror = function () {
        showNotification('error', 'Import Failed', 'Failed to read the file.');
    };

    reader.readAsText(file);

    // Reset the file input
    event.target.value = '';
}

/**
 * Show import dialog for logs.
 * @param {Array} importedLogs - The logs to import.
 */
function showImportDialog(importedLogs) {
    // Create dialog backdrop
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';

    // Create dialog box
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
	<h3 class="dialog-title">Import Logs</h3>
	<div class="dialog-content"><p>Imported ${importedLogs.length} log entries. How would you like to proceed?</p>
	</div><div class="dialog-actions">
		<button id="merge-logs-btn" class="btn-green">Merge with Existing</button>
		<button id="replace-logs-btn" class="btn-orange">Replace All</button>
		<button id="cancel-import-btn" class="btn-red">Cancel</button>
	</div>
`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // Merge option
    document.getElementById('merge-logs-btn').addEventListener('click', () => {
        const logsForCurrentCourse = courseData[currentCourse].logs;
        const existingIds = new Set(logsForCurrentCourse.map(log => log.id));

        let newCount = 0;
        importedLogs.forEach(log => {
            if (!existingIds.has(log.id)) {
                // Push to the correct course's log array.
                logsForCurrentCourse.push(log);
                newCount++;
            }
        });

        logsForCurrentCourse.sort((a, b) => b.timestamp - a.timestamp);
        saveCourseToLocalStorage(currentCourse);

        if (isOnline && isSignedIn) {
            syncLogsWithSheet().catch(err => console.error('Error syncing logs:', err));
        }

        updateUI();
        showNotification('success', 'Import Complete', `Added ${newCount} new log entries.`);
        document.body.removeChild(dialogBackdrop);
    });

    // Replace option
    document.getElementById('replace-logs-btn').addEventListener('click', () => {
        // Replace the logs for the current course only.
        courseData[currentCourse].logs = [...importedLogs].sort((a, b) => b.timestamp - a.timestamp);
        saveCourseToLocalStorage(currentCourse);

        if (isOnline && isSignedIn) {
            syncLogsWithSheet().catch(err => console.error('Error syncing logs:', err));
        }

        updateUI();
        showNotification('success', 'Import Complete', `Replaced logs with ${importedLogs.length} imported entries.`);
        document.body.removeChild(dialogBackdrop);
    });

    // Cancel option
    document.getElementById('cancel-import-btn').addEventListener('click', () => {
        document.body.removeChild(dialogBackdrop);
    });
}


/**
* Creates a debounced function that delays invoking func until after wait milliseconds have elapsed
* since the last time the debounced function was invoked.
* @param {Function} func The function to debounce.
* @param {number} wait The number of milliseconds to delay.
* @returns {Function} Returns the new debounced function.
*/
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
* This version uses data-attributes for event delegation and no longer creates listeners in a loop.
*/
function updateLogsList() {
    const tableContainer = document.querySelector('#scanner-tab .table-container');
    if (isChangingCourses) {
        tableContainer.classList.add('reloading');
    }

    if (!currentCourse) {
        logsTbody.innerHTML = '';
        filteredCount.textContent = '0';
        emptyLogs.innerHTML = `<i class="fa-solid fa-hand-pointer" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                       <p style="font-size: 1.1em; margin-bottom: 5px;">Please select a course.</p>
                       <p style="font-size: 0.9em; color: #999;">Choose a course above to view its attendance history.</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        return;
    }

    // If the data object for the current course hasn't been created yet,
    // it means Phase 3 is still running. Show a spinner.
    if (!courseData[currentCourse]) {
        logsTbody.innerHTML = '';
        filteredCount.textContent = '0';
        emptyLogs.innerHTML = `<div class="loading-spinner" style="margin: 20px auto;"></div><p style="text-align: center;">Loading logs...</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        return; // Stop here and wait for the next updateUI() call
    }

    const currentCourseLogs = getLogsForCurrentUser();

    // For students, the logs are already filtered by the backend
    // No need to filter again - this was causing empty tables!
    let logsToDisplay = currentCourseLogs;

    // --- DETECT LECTURER MODE ---
    const isLecturerMode = !isSignedIn && currentCourse && courseData[currentCourse];
    const showAdminFeatures = isAdmin || isLecturerMode; // Combine for Logic

    // Only apply additional filtering for admins
    // Students' logs are already filtered on the server by getStudentLogs
    // (The backend matches logs by the student's UIDs from the database)

    const grouped = {};
    logsToDisplay.forEach(log => {
        const dateObj = new Date(log.timestamp);
        if (isNaN(dateObj.getTime())) return;

        const scannedUid = log.uid; // The actual UID from the card
        const dbKey = uidToPrimaryUidMap[scannedUid];

        const studentData = dbKey ? databaseMap[dbKey] : null;
        const name = studentData ? studentData.name : 'Unknown';
        const uidsForDisplay = studentData ? studentData.uids : [scannedUid];

        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const date = `${day}-${month}-${year}`;

        // --- THIS IS THE REVERTED LOGIC ---
        // The key now uses the specific card's UID (`scannedUid`), ensuring a separate row for each card.
        const key = `${date}_${scannedUid}`;

        if (!grouped[key]) {
            grouped[key] = {
                key: key,
                date,
                dateObj: new Date(year, month - 1, day),
                uid: scannedUid, // The specific UID for this group
                name: name,
                uidsForDisplay: uidsForDisplay, // All UIDs for the student, for context
                originalLogs: []
            };
        }
        grouped[key].originalLogs.push(log);
    });

    let result = Object.values(grouped);

    if (filter) {
        result = result.filter(group => {
            const name = group.name || '';
            // The main UID for the group is now the specific one that was scanned
            const uidMatch = group.uid.toLowerCase().includes(filter);
            const date = group.date || '';
            const hasMatchingTime = group.originalLogs.some(log => {
                const timeObj = new Date(log.timestamp);
                const timeStr = `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;
                return timeStr.includes(filter);
            });
            const sessionMatch = group.originalLogs.some(log =>
                (log.session || '').toLowerCase().includes(filter)
            );

            return name.toLowerCase().includes(filter) ||
                uidMatch ||
                date.includes(filter) ||
                hasMatchingTime ||
                sessionMatch;
        });
    }

    const finalLogCount = result.reduce((acc, group) => acc + group.originalLogs.length, 0);
    filteredCount.textContent = finalLogCount;

    const [field, direction] = currentSort.split('-');
    const sortMultiplier = direction === 'asc' ? 1 : -1;
    result.sort((a, b) => {
        if (field === 'date') {
            const dateCompare = sortMultiplier * (a.dateObj - b.dateObj);
            return dateCompare !== 0 ? dateCompare : a.name.localeCompare(b.name);
        }
        if (field === 'name') return sortMultiplier * a.name.localeCompare(b.name);
        if (field === 'uid') return sortMultiplier * (a.uid || '').localeCompare(b.uid || '');
        return 0;
    });

    // --- PAGINATION LOGIC ---
    const totalPages = Math.ceil(result.length / ITEMS_PER_PAGE);
    if (logsCurrentPage > totalPages) logsCurrentPage = Math.max(1, totalPages);

    const startIndex = (logsCurrentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedResult = result.slice(startIndex, endIndex);

    // Update count display to show pagination info
    if (result.length > ITEMS_PER_PAGE) {
        filteredCount.textContent = `${startIndex + 1}-${Math.min(endIndex, result.length)} of ${result.length}`;
    }

    // Render pagination controls
    renderLogsPagination(logsCurrentPage, totalPages);

    logsTbody.innerHTML = '';

    if (result.length === 0) {
        let emptyMessageHTML = `<i class="fa-solid fa-ghost" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                               <p style="font-size: 1.1em; margin-bottom: 5px;">No attendance records found.</p>`;
        if (isAdminForCourse(currentCourse)) {
            emptyMessageHTML += `<p style="font-size: 0.9em; color: #999;">Start scanning or try changing the filter.</p>`;
        } else {
            emptyMessageHTML += `<p style="font-size: 0.9em; color: #999;">There are no attendance records for you in this course.</p>`;
        }
        emptyLogs.innerHTML = emptyMessageHTML;
        emptyLogs.style.display = 'block';
    } else {
        emptyLogs.style.display = 'none';
    }

    // Use paginated result for rendering
    const resultToRender = paginatedResult;

    let currentDay = null;

    resultToRender.forEach((group) => {
        if (showAdminFeatures && currentSort.startsWith('date')) {
            const thisDay = group.date;
            if (thisDay !== currentDay) {
                currentDay = thisDay;
                const separatorRow = document.createElement('tr');
                separatorRow.className = 'day-separator';
                const separatorCell = document.createElement('td');
                separatorCell.colSpan = 100; // Span across all columns (100 is effectively "all")


                const flexWrapper = document.createElement('div');
                flexWrapper.className = 'day-separator-content';

                // --- 1. DATE GROUP CHECKBOX ---
                if (isBulkMode) {
                    const dateCheckbox = document.createElement('input');
                    dateCheckbox.type = 'checkbox';
                    dateCheckbox.className = 'day-separator-checkbox'; // Different class than row checkboxes
                    dateCheckbox.title = `Select all logs for ${thisDay}`;
                    // Pass the specific date string to the toggle function
                    dateCheckbox.onclick = (e) => toggleDateGroup(thisDay, e.target.checked);
                    flexWrapper.appendChild(dateCheckbox);
                }

                const dateText = document.createElement('span');
                dateText.className = 'day-separator-date';
                dateText.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${escapeHtml(group.date)}`;
                flexWrapper.appendChild(dateText);
                const buttonContainer = document.createElement('div');
                buttonContainer.className = 'day-separator-actions';
                const dateForButton = thisDay;
                const eisBtn = document.createElement('button');
                eisBtn.className = 'btn-sm eis-day-btn';
                eisBtn.innerHTML = '<i class="fa-solid fa-list-check"></i> Add to EIS';
                eisBtn.title = 'Add to EIS for this day';
                eisBtn.setAttribute('aria-label', `Add attendance for ${group.date} to EIS`);
                eisBtn.onclick = (e) => { e.stopPropagation(); showDirectEisExportDialog(dateForButton); };
                buttonContainer.appendChild(eisBtn);
                /* const bulkAddBtn = document.createElement('button');
                 bulkAddBtn.className = 'btn-green btn-sm';
                 bulkAddBtn.innerHTML = '<i class="fa-solid fa-clone"></i>';
                 bulkAddBtn.title = 'Add +1 Hour to All Students on This Day';
                 bulkAddBtn.setAttribute('aria-label', `Add a plus one hour log to all students on ${group.date}`);
                 bulkAddBtn.onclick = (e) => { e.stopPropagation(); addPlusOneHourToDay(dateForButton); }; 
                 buttonContainer.appendChild(bulkAddBtn); */
                flexWrapper.appendChild(buttonContainer);
                separatorCell.appendChild(flexWrapper);
                separatorRow.appendChild(separatorCell);
                logsTbody.appendChild(separatorRow);
            }
        }

        const row = document.createElement('tr');
        row.dataset.key = group.key;
        row.dataset.date = group.date; // --- Add date attribute for group selection ---
        if (group.name === 'Unknown') row.classList.add('unknown-row');

        // --- Bulk Checkbox Cell ---
        if (isBulkMode) {
            const selectCell = document.createElement('td');
            selectCell.className = 'select-column';
            const logIdsInGroup = group.originalLogs.map(l => l.id).join(','); // Join IDs

            // We use the first ID as the primary key for logic
            const primaryId = group.originalLogs[0].id;

            selectCell.innerHTML = `<input type="checkbox" class="bulk-checkbox" value="${logIdsInGroup}">`;
            const checkbox = selectCell.querySelector('input');

            if (selectedLogIds.has(primaryId)) checkbox.checked = true;

            // Use the new handler
            checkbox.addEventListener('click', (e) => handleLogCheckbox(e, logIdsInGroup));
            row.appendChild(selectCell);
        }

        const nameCell = document.createElement('td');
        nameCell.className = 'name-cell name-column';
        nameCell.textContent = group.name;
        row.appendChild(nameCell);

        if (isAdminForCourse(currentCourse)) {
            const uidCell = document.createElement('td');
            uidCell.className = 'uid-cell uid-column admin-only';
            uidCell.innerHTML = `<span class="uid-badge">${escapeHtml(group.uid)}</span>`;
            row.appendChild(uidCell);
        }

        const dateCell = document.createElement('td');
        dateCell.className = 'date-cell date-column';
        dateCell.textContent = group.date;
        row.appendChild(dateCell);

        const timesCell = document.createElement('td');
        timesCell.className = 'times-cell times-cell-stacked';

        // 1. Group logs by CATEGORY ONLY (Theory, Lab, Practice)
        const categoryGroups = {};

        group.originalLogs.sort((a, b) => a.timestamp - b.timestamp).forEach(log => {
            const rawSession = log.session || 'Default';

            // Split "Theory A" -> ["Theory", "A"] -> "Theory"
            // Split "Default" -> "Default"
            const category = rawSession.split(' ')[0];

            if (!categoryGroups[category]) categoryGroups[category] = [];
            categoryGroups[category].push(log);
        });

        // 2. Render rows
        Object.entries(categoryGroups).forEach(([categoryName, logs]) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'time-row';

            if (categoryName && categoryName !== 'Default') {
                const label = document.createElement('span');
                label.className = 'cat-label';
                label.textContent = categoryName;
                rowDiv.appendChild(label);
            }

            const pillContainer = document.createElement('div');
            pillContainer.className = 'pills-wrapper';

            logs.forEach(log => {
                const timeTag = document.createElement('span');
                timeTag.className = 'time-tag';
                if (log.manual === true || log.manual === 'true') {
                    timeTag.classList.add('manual', 'excused');

                    // Add click listener with 'warning' style and specific name
                    timeTag.addEventListener('click', (e) => {
                        e.stopPropagation(); // Stop the row from opening edit mode
                        showNotification(
                            'warning',
                            'Justified Absence',
                            `${escapeHtml(group.name)} was justified for this absence.`
                        );
                    });
                }

                const timeObj = new Date(log.timestamp);
                // Format time 00:00
                timeTag.textContent = `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;
                pillContainer.appendChild(timeTag);
            });

            rowDiv.appendChild(pillContainer);
            timesCell.appendChild(rowDiv);
        });

        row.appendChild(timesCell);

        if (isAdminForCourse(currentCourse)) {
            const actionsCell = document.createElement('td');
            actionsCell.className = 'actions-cell admin-only';
            const actionsWrapper = document.createElement('div');
            actionsWrapper.className = 'actions-cell-content';

            if (group.name === 'Unknown') {
                const addUserBtn = document.createElement('button');
                addUserBtn.className = 'btn-green btn-icon add-user-btn';
                addUserBtn.title = 'Register Student';
                addUserBtn.setAttribute('aria-label', `Register student with UID ${group.uid}`);
                addUserBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';

                // Open registration dialog instead of direct database add
                addUserBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showRegisterUIDDialogWithPrefill(group.uid);
                });

                actionsWrapper.appendChild(addUserBtn);
            }

            actionsWrapper.innerHTML += `
    <button class="btn-green btn-icon add-time-btn" title="Add +1 Hour" aria-label="Add another hour for ${escapeHtml(group.name)}">
        <i class="fa-solid fa-plus"></i>
    </button>
    <button class="btn-red btn-icon delete-log-btn" title="Delete Latest Timestamp" aria-label="Delete latest timestamp for ${escapeHtml(group.name)}">
        <i class="fa-solid fa-minus"></i>
    </button>
    <button class="btn-blue btn-icon edit-log-btn" title="Edit" aria-label="Edit entry for ${escapeHtml(group.name)}">
        <i class="fa-solid fa-pencil"></i>
    </button>`;

            actionsCell.appendChild(actionsWrapper);
            row.appendChild(actionsCell);
        }
        logsTbody.appendChild(row);
    });

    tableContainer.classList.remove('reloading');
    if (isChangingCourses) {
        isChangingCourses = false;
    }
}


/**
* Calculate the course week for a specific date.
* @param {Object} metadata - Course metadata.
* @param {Date} forDate - The specific date to calculate the week for.
* @returns {number} The calculated week number.
*/
function calculateWeekForDate(metadata, forDate) {
    if (!metadata || !metadata.startDate) return 1;

    const startDate = new Date(metadata.startDate);
    const holidayWeeks = parseInt(metadata.holidayWeeks || 0);
    const holidayStartDate = metadata.holidayStartDate ? new Date(metadata.holidayStartDate) : null;

    if (isNaN(startDate.getTime())) return 1;

    const weekNumber = Math.ceil((forDate - startDate) / (7 * 24 * 60 * 60 * 1000));
    let adjustedWeek = weekNumber;

    if (holidayWeeks > 0 && holidayStartDate && !isNaN(holidayStartDate.getTime()) && forDate >= holidayStartDate) {
        adjustedWeek = weekNumber - holidayWeeks;
    }
    return Math.max(adjustedWeek, 1);
}

/**
 * Shows a dialog to add a new database entry, pre-filled with the UID.
 * @param {string} uid - The UID of the unknown person to add.
 */
function showAddEntryFromLog(uid) {
    if (!isAdmin) return;
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
        <h3 class="dialog-title">Add to Database</h3>
        <div class="dialog-content"><p>Enter the details for the student with this UID.</p>
        <div class="form-group">
            <label><i class="fa-solid fa-wifi"></i> UID:</label>
            <input type="text" class="form-control" placeholder="AB:CD:12:34" value="${escapeHtml(uid)}" disabled>
        </div>
        <div class="form-group">
            <label for="add-log-name"><i class="fa-solid fa-quote-left"></i> Name*:</label>
            <input type="text" id="add-log-name" class="form-control" placeholder="Student's Full Name">
        </div>
        <div class="form-group">
            <label for="add-log-email"><i class="fa-solid fa-at"></i> Email*:</label>
            <input type="email" id="add-log-email" class="form-control" placeholder="nsurname00@epoka.edu.al">
        </div>
        </div> <div class="dialog-actions">
            <button id="cancel-add-log-btn" class="btn-red">Cancel</button>
            <button id="confirm-add-log-btn" class="btn-green">Add Student</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const nameInput = dialog.querySelector('#add-log-name');
    const emailInput = dialog.querySelector('#add-log-email');

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    dialog.querySelector('#cancel-add-log-btn').addEventListener('click', closeDialog);
    dialog.querySelector('#confirm-add-log-btn').addEventListener('click', async () => {
        const nameInput = dialog.querySelector('#add-log-name');
        const emailInput = dialog.querySelector('#add-log-email');

        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        let isValid = true;
        if (name === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!isValid) return;

        const confirmBtn = dialog.querySelector('#confirm-add-log-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';

        try {
            const submissionData = {
                name: name,
                email: email,
                uid: uid, // 'uid' is available from the outer function's scope
                sentBy: {
                    name: currentUser?.name || '',
                    email: currentUser?.email || ''
                }
            };

            if (isGlobalAdmin) {
                const match = findDuplicateInDatabase({ name, email, uid }); // Check for duplicates

                if (match) {
                    // DUPLICATE FOUND: Show the warning dialog
                    const completeAction = async () => { // Define the callback
                        if (isOnline) {
                            await syncDatabaseToSheet();
                            invalidateDatabaseCache();
                            await fetchDatabaseFromSheet();
                        }
                        window.buildUIDToPrimaryUidMap();
                        updateUI();
                    };
                    showDuplicateWarningForNewEntry(submissionData, [match.duplicate], completeAction);
                    closeDialog(); // Close the current 'Add from Log' dialog
                    return; // Stop further execution here
                } else {
                    // NO DUPLICATE: Add directly to the database via backend
                    const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');
                    if (result && result.result === 'success') {
                        showNotification('success', 'Added to Database', `${name} has been added.`);
                        invalidateDatabaseCache();
                        await fetchDatabaseFromSheet();
                        window.buildUIDToPrimaryUidMap(); // Use window scope
                        updateUI();
                        closeDialog();
                    } else {
                        throw new Error(result?.message || 'Failed to add entry');
                    }
                }
            } else {
                // Non-global admins submit a registration request
                const result = await callWebApp('submitRegistration', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Request Submitted', `Registration request for ${name} has been sent.`);
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Submission failed');
                }
            }
        } catch (error) {
            showNotification('error', 'Submission Failed', error.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = 'Add Student'; // Reset button text
        }
    });
}

/**
 * Update the database list in the UI.
 */
function updateDatabaseList() {
    const entries = Object.entries(databaseMap).filter(([dbKey, data]) => {
        if (!dbFilter) return true;
        const searchFilter = dbFilter.toLowerCase();
        return (data.name.toLowerCase().includes(searchFilter) ||
            (data.email && data.email.toLowerCase().includes(searchFilter)) ||
            data.uids.some(uid => uid.toLowerCase().includes(searchFilter)));
    });

    entries.sort((a, b) => {
        const [field, direction] = currentDbSort.split('-');
        const multiplier = direction === 'asc' ? 1 : -1;
        let valA, valB;

        if (field === 'name') {
            valA = a[1].name;
            valB = b[1].name;
        } else if (field === 'email') {
            valA = a[1].email || '';
            valB = b[1].email || '';
        } else {
            valA = a[1].uids[0] || ''; // Sort by first UID in the list
            valB = b[1].uids[0] || '';
        }
        return multiplier * String(valA).localeCompare(String(valB));
    });

    // --- PAGINATION LOGIC ---
    const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
    if (dbCurrentPage > totalPages) dbCurrentPage = Math.max(1, totalPages);

    const startIndex = (dbCurrentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedEntries = entries.slice(startIndex, endIndex);

    // Update count display
    const totalCount = Object.keys(databaseMap).length;
    if (entries.length > ITEMS_PER_PAGE) {
        dbEntryCount.textContent = `${startIndex + 1}-${Math.min(endIndex, entries.length)} of ${entries.length}`;
    } else {
        dbEntryCount.textContent = totalCount;
    }

    // Render pagination controls
    renderDbPagination(dbCurrentPage, totalPages);

    emptyDatabase.style.display = totalCount > 0 ? 'none' : 'block';
    databaseTbody.innerHTML = '';

    paginatedEntries.forEach(([dbKey, data]) => {
        const row = document.createElement('tr');
        // Use the new .uid-badge class here
        const uidBadges = data.uids.map(uid => `<span class="uid-badge">${escapeHtml(uid)}</span>`).join(' ');

        row.innerHTML = `
            <td class="name-cell">${escapeHtml(data.name)}</td>
            <td class="uid-cell">${uidBadges}</td>
            <td class="email-cell">${escapeHtml(data.email || '')}</td>
            <td class="actions-cell admin-only">
                <div class="actions-cell-content">
                    <button class="btn-blue btn-icon edit-db-btn" data-key="${escapeHtml(dbKey)}" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn-red btn-icon delete-db-btn" data-key="${escapeHtml(dbKey)}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
        `;
        row.querySelector('.edit-db-btn').addEventListener('click', () => editDatabaseEntry(dbKey));
        row.querySelector('.delete-db-btn').addEventListener('click', () => deleteDatabaseEntry(dbKey));
        databaseTbody.appendChild(row);
    });
}

/**
* Renders the course grid within the Global Settings dialog.
* Handles styling, admin counts, and search filtering.
* @param {Object} courseInfo - The dictionary of course metadata.
* @param {string} [filterText=''] - Optional text to filter the list.
*/
function renderCoursesInSettings(courseInfo, filterText = '') {
    const gridContainer = document.getElementById('settings-course-grid');
    if (!gridContainer) return;

    gridContainer.innerHTML = '';

    // 1. Prepare Search Terms
    const lowerFilter = filterText.toLowerCase().trim();
    const strippedFilter = lowerFilter.replace(/\s+/g, ''); // e.g., "ce 202" -> "ce202"

    // 2. Filter and Sort Data
    const filteredCourses = Object.entries(courseInfo)
        .filter(([name, data]) => {
            if (!lowerFilter) return true; // Show all if no filter

            const nameLow = name.toLowerCase();
            const nameAsText = nameLow.replace(/_/g, ' ');   // "ce_202" -> "ce 202"
            const nameStripped = nameLow.replace(/_/g, '');  // "ce_202" -> "ce202"
            const eisId = String(data.eisId || '');

            return nameLow.includes(lowerFilter) ||
                nameAsText.includes(lowerFilter) ||
                nameStripped.includes(strippedFilter) ||
                eisId.includes(lowerFilter);
        })
        .sort((a, b) => a[0].localeCompare(b[0])); // Sort Alphabetically (A-Z)

    // 3. Handle Empty State
    if (filteredCourses.length === 0) {
        gridContainer.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:30px; opacity:0.6; font-style:italic;">No courses found matching "${escapeHtml(filterText)}".</div>`;
        return;
    }

    // 4. Render Cards
    filteredCourses.forEach(([courseName, data]) => {
        // Determine Color Strip based on Category
        const category = (data.defaultCategory || 'theory').toLowerCase();
        let stripClass = 'strip-default';
        if (category.includes('theory')) stripClass = 'strip-theory';
        else if (category.includes('lab')) stripClass = 'strip-lab';
        else if (category.includes('practice')) stripClass = 'strip-practice';

        // Calculate Admin Count
        const rawAdmins = data.adminEmails || '';
        const adminCount = rawAdmins.toString().split(',').map(e => e.trim()).filter(Boolean).length;

        // Build HTML
        const card = document.createElement('div');
        card.className = 'modern-course-card';
        card.innerHTML = `
            <div class="card-color-strip ${stripClass}"></div>
            <div class="card-body">
                <div class="card-title-row">
                    <div class="card-course-name">${escapeHtml(courseName.replace(/_/g, ' '))}</div>
                    ${data.eisId ? `<span class="card-eis-badge">#${escapeHtml(data.eisId)}</span>` : ''}
                </div>
                <div class="card-meta-row">
                    <div class="card-meta-item"><i class="fa-regular fa-clock"></i> ${escapeHtml(data.defaultHours || 0)}h</div>
                    <div class="card-meta-item" style="text-transform:capitalize;"><i class="fa-solid fa-tag"></i> ${escapeHtml(category)}</div>
                </div>
            </div>
            <div class="card-footer">
                <span class="admin-pill"><i class="fa-solid fa-user-shield"></i> ${adminCount} Admin${adminCount !== 1 ? 's' : ''}</span>
                <i class="fa-solid fa-pen-to-square"></i>
            </div>`;

        // Attach Click Listener -> Opens Editor
        card.onclick = () => {
            // We do NOT close the settings dialog here, so the user can edit 
            // and return to the list smoothly. The editor opens on top.
            showCourseEditorDialog(courseName, data);
        };

        gridContainer.appendChild(card);
    });
}

/**
 * Update database status indicator.
 */
function updateDatabaseStatus() {
    const count = Object.keys(databaseMap).length;
    databaseStatus.textContent = count > 0 ? `${count} registered students` : 'Not loaded';
}

function updatePageTitle() {
    let titlePrefix = '';

    // Only show count for admins if there are pending items
    if (isAdmin && globalNotificationCount > 0) {
        titlePrefix = `(${globalNotificationCount}) `;
    }

    if (currentCourse && currentCourse !== 'Default') {
        const titleName = currentCourse.replace(/_/g, ' ');
        document.title = `${titlePrefix}${titleName} Attendance`;
    } else {
        document.title = `${titlePrefix}Smart Attendance`;
    }
}

/**
 Update the entire UI.
 */
async function updateUI() {
    await databaseLoadPromise;
    updateLogsList();
    updateDatabaseList();
    updateDatabaseStatus();
    updatePageTitle();


    // This logic ensures the course buttons are correctly hidden when on the database tab.
    const activeTabId = document.querySelector('.tab.active')?.dataset.tab;
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (courseButtonsContainer) {
        if (activeTabId === 'database-tab') {
            courseButtonsContainer.style.display = 'none';
        } else {
            courseButtonsContainer.style.display = 'flex';
        }
    }

    const logsForCurrentCourse = getLogsForCurrentUser();

    // Update total scans and last scan info
    totalScans.textContent = logsForCurrentCourse.length;

    if (logsForCurrentCourse.length > 0) {
        const latestLog = logsForCurrentCourse[0]; // Assumes logs are sorted newest first
        const lastTimestamp = new Date(latestLog.timestamp);
        const pad = (n) => n.toString().padStart(2, '0');
        const time = `${pad(lastTimestamp.getHours())}:${pad(lastTimestamp.getMinutes())}`;
        const date = `${pad(lastTimestamp.getDate())}-${pad(lastTimestamp.getMonth() + 1)}-${lastTimestamp.getFullYear()}`;
        lastScan.textContent = `${time} ${date}`;
    } else {
        lastScan.textContent = 'Never';
    }

    // Enable/disable buttons
    exportBtn.disabled = logsForCurrentCourse.length === 0;
    clearBtn.disabled = logsForCurrentCourse.length === 0;

    if (isAdminForCourse(currentCourse)) {
        // Admin-specific UI updates
        clearDbBtn.disabled = Object.keys(databaseMap).length === 0;
        exportExcelBtn.disabled = Object.keys(databaseMap).length === 0;
    }

    updateScanButtons();
    populateCourseButtons();

    if (currentCourse) {
        renderSessionControls(currentCourse);
    }

    const hasLogs = logsForCurrentCourse.length > 0;
    filterInput.disabled = !hasLogs;
    sortSelect.disabled = !hasLogs;
}

/**
 * Start NFC scanning.
 */
async function startScanning() {
    if (!nfcSupported) return;

    try {
        if (!nfcReader) {
            nfcAbortController = new AbortController();
            nfcReader = new NDEFReader();
            await nfcReader.scan({ signal: nfcAbortController.signal });

            nfcReader.addEventListener("reading", handleNfcReading);
            nfcReader.addEventListener("error", handleNfcError);
        }

        isScanning = true;

        // UI Update
        const scanBtn = document.getElementById('scan-button');
        scanBtn.classList.add('is-scanning');

        // FORCE CLOCK START
        updateScanClock();
        if (scanClockInterval) clearInterval(scanClockInterval);
        scanClockInterval = setInterval(updateScanClock, 1000);

    } catch (error) {
        handleScanningError(error);
    }
}

function handleScanningError(error) {
    // Handle permission denied and other errors
    let errorMessage = error.message;
    let errorTitle = 'Scanner error';

    if (error.name === 'NotAllowedError' || errorMessage.includes('permission')) {
        errorTitle = 'Permission denied';
        errorMessage = 'You need to grant permission to use NFC. Please try again.';
    } else if (error.name === 'NotSupportedError') {
        errorTitle = 'NFC not supported';
        errorMessage = 'Your device doesn\'t support NFC or it\'s turned off.';
    }

    showNotification('error', errorTitle, errorMessage);
    stopScanning();
}

function updateScanButtons() {
    const scanBtn = document.getElementById('scan-button');
    const scanButtonsContainer = document.querySelector('.scan-buttons');

    if (!scanBtn || !scanButtonsContainer) return;

    // Show button if supported
    scanBtn.style.display = nfcSupported ? 'flex' : 'none';
    scanButtonsContainer.style.display = nfcSupported ? 'flex' : 'none';

    if (isScanning) {
        scanBtn.classList.add('is-scanning');
        // updateScanClock() handles the text/time display.
    } else {
        scanBtn.classList.remove('is-scanning');

        // --- UNIFIED IDLE STATE ---
        // Always show "START SCANNING" regardless of login status
        scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i><b>&nbsp;&nbsp; START SCANNING</b>';
    }
}

/**
* Handle NFC reading.
* SCENARIO A: If logged out, checks if the card belongs to an Admin to log them in.
* SCENARIO B: If logged in, records attendance for the current course.
*/
async function handleNfcReading({ serialNumber }) {
    playSound(true);

    // ============================================================
    // SCENARIO A: LOGIN CHECK / GUEST MODE
    // Run this ONLY if we are NOT signed in
    // ============================================================
    if (!isSignedIn) {
        const notSignedInMsg = document.getElementById('not-signed-in-message');
        if (notSignedInMsg) notSignedInMsg.innerHTML = `<div style="text-align:center;">Checking...</div>`;

        try {
            const myDeviceId = getDeviceFingerprint();
            // Call Backend to check if this UID belongs to a staff member
            const response = await fetch(BRAIN_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'loginWithNfc',
                    uid: serialNumber,
                    deviceId: myDeviceId,
                    logsSpreadsheetId: LOGS_SPREADSHEET_ID
                })
            });

            const data = await response.json();

            if (data.result === 'success') {
                // === ADMIN LOGIN SUCCESS ===
                const fakeGapiToken = { access_token: data.token };
                localStorage.setItem('gapi_token', JSON.stringify(fakeGapiToken));
                gapi.client.setToken(fakeGapiToken);
                currentUser = data.user;
                showNotification('success', 'Session Active', `Welcome, ${currentUser.name}`);
                onSuccessfulAuth(false);
            } else {
                // === STUDENT CARD (GUEST MODE) ===
                // Just show the UID
                lastScannedUID = serialNumber;
                updateAuthUI();
            }

        } catch (err) {
            // Network error implies we are offline, show UID
            lastScannedUID = serialNumber;
            updateAuthUI();
        }
        return; // Stop here
    }

    // ============================================================
    // SCENARIO B: ATTENDANCE RECORDING
    // Runs if Signed In OR in Lecturer Mode
    // ============================================================

    const primaryUid = uidToPrimaryUidMap[serialNumber];
    const finalUid = primaryUid || serialNumber;
    lastScannedUID = serialNumber;

    // Security Check: Only block if we are signed in but NOT an admin
    // (If isLecturerMode is true, we bypass this because auth is offline)
    if (isSignedIn && !isAdmin) {
        showNotification('error', 'Action Not Allowed', 'Only administrators can record attendance.');
        return;
    }

    // Cooldown
    if (cooldownUIDs.has(finalUid)) return;
    cooldownUIDs.add(finalUid);
    setTimeout(() => { cooldownUIDs.delete(finalUid) }, 2000);

    if (!currentCourse) {
        showNotification('warning', 'No Course Selected', 'Please select a course before scanning');
        return;
    }

    const timestamp = new Date();

    let sessionStr = '';
    if (activeSessionCategory) {
        sessionStr = activeSessionCategory;
        if (activeSessionGroup) {
            sessionStr += ' ' + activeSessionGroup;
        }
    }

    let newLog = {
        uid: serialNumber,
        timestamp: timestamp.getTime(),
        id: Date.now() + Math.random().toString(36).substring(2, 11),
        manual: false,
        session: getCurrentActiveSession()
    };

    // In LecturerMode, currentUser might be null, which is fine
    newLog = touchLogForEdit(newLog, currentUser?.email || 'Offline Lecturer');

    if (!courseData[currentCourse]) {
        courseData[currentCourse] = { logs: [], tombstones: new Set() };
    }
    courseData[currentCourse].logs.unshift(newLog);

    saveAndMarkChanges(currentCourse);
    updateUI();

    // Trigger the Welcome Overlay logic (Same as before)
    const name = primaryUid ? databaseMap[primaryUid]?.name : 'Unknown';
    const isMobile = window.innerWidth <= 700;

    if (isMobile) {
        const overlay = document.getElementById('scan-announcement-overlay');
        const nameEl = document.getElementById('scan-announcement-name');
        if (overlay && nameEl) {
            nameEl.textContent = name;
            // Don't use openDialogMode/closeDialogMode - the overlay should NOT block scrolling
            overlay.style.display = 'flex';
            void overlay.offsetWidth;
            overlay.classList.add('visible');
            if (window.overlayTimeout) clearTimeout(window.overlayTimeout);
            if (window.overlayHideTimeout) clearTimeout(window.overlayHideTimeout);
            const hideOverlay = () => {
                if (window.overlayTimeout) clearTimeout(window.overlayTimeout);
                overlay.classList.remove('visible');
                window.overlayHideTimeout = setTimeout(() => {
                    overlay.style.display = 'none';
                }, 150);
            };
            window.overlayTimeout = setTimeout(hideOverlay, 2500);
            overlay.onclick = hideOverlay;
        }
    }
}



/**
 * Handle NFC error.
 * @param {Object} error - The NFC error.
 */
function handleNfcError(error) {
    // Play error sound
    playSound(false);

    showNotification('error', 'Scanner error', error.message);
    stopScanning();
}

/**
 * Stop NFC scanning.
 */
function stopScanning() {
    if (nfcAbortController) {
        nfcAbortController.abort();
        nfcAbortController = null;
    }

    // --- STOP CLOCK ---
    isScanning = false;
    if (scanClockInterval) {
        clearInterval(scanClockInterval);
        scanClockInterval = null;
    }

    // Reset button UI
    const scanBtn = document.getElementById('scan-button');
    if (scanBtn) {
        scanBtn.classList.remove('is-scanning');
        scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i><b>&nbsp;&nbsp; START SCANNING</b>';
    }

    if (nfcReader) nfcReader = null;
}

/**
 * Play sound effect (success or error).
 * @param {boolean} success - Whether to play success or error sound.
 */
function playSound(success) {
    if (!soundEnabled) return;

    const sound = success ? successSound : errorSound;

    // Reset to start (0) only if the audio metadata is loaded
    if (sound.readyState >= 1) {
        sound.currentTime = 0;
    }

    const playPromise = sound.play();

    if (playPromise !== undefined) {
        playPromise.catch(error => {
            // This catches the "DOMException: The play() request was interrupted"
            // or "Autoplay is not allowed" errors so they don't stop the app.
            console.warn("Audio playback blocked (User needs to tap screen once):", error);
        });
    }
}

/**
 * Update current year in footer.
 */
function updateYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

function removeNotifications(type) {
    const notificationArea = document.getElementById('in-page-notification-area');
    const notificationsToRemove = notificationArea.querySelectorAll(`[data-notification-type="${type}"]`);

    notificationsToRemove.forEach(notification => {
        notification.classList.add('removing');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
}

function showNotification(type, title, message, duration = 5000) {
    const notificationArea = document.getElementById('in-page-notification-area');
    if (!notificationArea) return;

    // Deduplicate notifications - skip if same notification shown recently
    const notificationKey = `${type}-${title}-${message}`;
    if (lastNotificationKey === notificationKey &&
        (Date.now() - lastNotificationTime) < 3000) {
        return;
    }
    lastNotificationKey = notificationKey;
    lastNotificationTime = Date.now();

    // Skip redundant notifications
    if (title === 'Courses Warning' && message === 'Using default course list') {
        return;
    }

    // Skip Auth Errors during initialization
    if (isInitializing && title === 'Auth Error') {
        return;
    }

    // Skip User Info errors that often resolve themselves
    if (title === 'User Info Error' || message.includes('user info')) {
        return;
    }

    // During initialization, only show critical notifications immediately
    if (isInitializing || criticalErrorsOnly) {
        const isCritical = type === 'error' &&
            (title.includes('Critical') ||
                message.includes('Permission denied'));

        if (!isCritical) {
            // Store non-critical notifications for later
            pendingNotifications.push({ type, title, message, duration });
            return;
        }
    }

    // Safely remove notifications
    const safeRemove = (element) => {
        try {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        } catch (e) {
        }
    };

    // Clear existing notifications of the same type
    const existingNotifications = notificationArea.querySelectorAll(`.in-page-notification-${type}`);
    existingNotifications.forEach(notification => {
        notification.classList.add('removing');
        setTimeout(() => safeRemove(notification), 300);
    });

    // Limit total notifications to 2
    const allNotifications = notificationArea.querySelectorAll('.in-page-notification');
    if (allNotifications.length >= 2) {
        const oldest = allNotifications[0];
        oldest.classList.add('removing');
        setTimeout(() => safeRemove(oldest), 300);
    }

    // Create the new notification
    const notification = document.createElement('div');
    notification.className = `in-page-notification in-page-notification-${type}`;
    notification.dataset.notificationType = type;

    let icon;
    switch (type) {
        case 'success': icon = 'check-circle'; break;
        case 'error': icon = 'times-circle'; break;
        case 'warning': icon = 'exclamation-circle'; break;
        default: icon = 'info-circle';
    }

    notification.innerHTML = `
        <i class="fa-solid fa-${icon}"></i>
        <div style="flex-grow:1;">
            <strong>${title}</strong><br>
            ${message}
        </div>
        <button class="notification-close" title="Close" aria-label="Close notification">&times;</button>
    `;

    notificationArea.appendChild(notification);

    // Add click handler to close button
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            notification.classList.add('removing');
            setTimeout(() => safeRemove(notification), 300);
        });
    }

    // Auto-remove non-error notifications
    if (type !== 'error') {
        setTimeout(() => {
            notification.classList.add('removing');
            setTimeout(() => safeRemove(notification), 300);
        }, duration || 5000);
    }
}

// --- PAGINATION HELPER FUNCTIONS ---

/**
 * Renders pagination controls for the logs table.
 */
function renderLogsPagination(currentPage, totalPages) {
    const container = document.getElementById('logs-pagination');
    const pageNumbers = document.getElementById('logs-page-numbers');
    const prevBtn = document.getElementById('logs-prev-page');
    const nextBtn = document.getElementById('logs-next-page');

    if (!container || totalPages <= 1) {
        if (container) container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    pageNumbers.innerHTML = '';

    // Generate page buttons
    const pages = generatePageNumbers(currentPage, totalPages);
    pages.forEach(page => {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (page === currentPage ? ' active' : '') + (page === '...' ? ' ellipsis' : '');
        btn.textContent = page;
        if (page !== '...') {
            btn.onclick = () => {
                logsCurrentPage = parseInt(page);
                updateLogsList();
            };
        }
        pageNumbers.appendChild(btn);
    });

    // Update prev/next button states
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.onclick = () => { logsCurrentPage--; updateLogsList(); };
    nextBtn.onclick = () => { logsCurrentPage++; updateLogsList(); };
}

/**
 * Renders pagination controls for the database table.
 */
function renderDbPagination(currentPage, totalPages) {
    const container = document.getElementById('db-pagination');
    const pageNumbers = document.getElementById('db-page-numbers');
    const prevBtn = document.getElementById('db-prev-page');
    const nextBtn = document.getElementById('db-next-page');

    if (!container || totalPages <= 1) {
        if (container) container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    pageNumbers.innerHTML = '';

    // Generate page buttons
    const pages = generatePageNumbers(currentPage, totalPages);
    pages.forEach(page => {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (page === currentPage ? ' active' : '') + (page === '...' ? ' ellipsis' : '');
        btn.textContent = page;
        if (page !== '...') {
            btn.onclick = () => {
                dbCurrentPage = parseInt(page);
                updateDatabaseList();
            };
        }
        pageNumbers.appendChild(btn);
    });

    // Update prev/next button states
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.onclick = () => { dbCurrentPage--; updateDatabaseList(); };
    nextBtn.onclick = () => { dbCurrentPage++; updateDatabaseList(); };
}

/**
 * Generates an array of page numbers to display, with ellipsis for long ranges.
 * e.g., [1, 2, 3, '...', 10] or [1, '...', 5, 6, 7, '...', 20]
 */
function generatePageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    pages.push(1);

    if (current > 3) {
        pages.push('...');
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
    }

    if (current < total - 2) {
        pages.push('...');
    }

    if (!pages.includes(total)) pages.push(total);

    return pages;
}

function populateCourseButtons() {
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (!courseButtonsContainer) return;

    if (!isSignedIn) {
        courseButtonsContainer.style.display = 'none';
        return;
    } else {
        courseButtonsContainer.style.display = 'flex';
    }

    courseButtonsContainer.innerHTML = '';

    let coursesToDisplay = availableCourses;

    // For global admins, add the guest course if they're visiting one
    if (isGlobalAdmin && guestCourse && !coursesToDisplay.includes(guestCourse)) {
        coursesToDisplay = [...coursesToDisplay, guestCourse];
    }

    coursesToDisplay.forEach(course => {
        const button = document.createElement('div');
        button.className = 'course-button' + (currentCourse === course ? ' active' : '');

        // Mark guest courses visually
        if (course === guestCourse) {
            button.classList.add('btn-orange');
        }

        // Removed the badge count logic here
        button.innerHTML = `<i class="fa-solid fa-table-list"></i>&nbsp; ${escapeHtml(course.replace(/_/g, ' '))}`;
        button.addEventListener('click', () => selectCourseButton(course));
        courseButtonsContainer.appendChild(button);
    });

    if (!currentCourse && coursesToDisplay.length > 0) {
        selectCourseButton(coursesToDisplay[0]);
    }
}

function selectCourseButton(course) {
    // Give instant visual feedback by updating classes immediately
    document.querySelectorAll('.course-button').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('selecting');
        // Check inner text to find the correct button to activate
        if (btn.innerText.trim().replace(/\s+/g, '_') === course) {
            btn.classList.add('selecting'); // Add selecting feedback
            btn.classList.add('active');
            // Remove selecting class after a short delay
            setTimeout(() => btn.classList.remove('selecting'), 150);
        }
    });

    renderSessionControls(course);

    // Do nothing more if the course is already selected
    if (currentCourse === course && window.location.hash === `#${course}`) {
        return;
    }
    // Now, proceed with the hash change which will trigger the data load
    window.location.hash = course;
}

/**
 * Initializes the Cat Companion with optimized logic.
 * Features: Accessibility, No-Flicker text swapping, uniqueness check.
 */
function setupCatCompanion() {
    const cat = document.getElementById('cat-companion');
    const bubble = document.getElementById('cat-speech-bubble');
    if (!cat || !bubble || cat.dataset.initialized === "true") return;

    // Accessibility: Make it interactive for keyboard users
    cat.setAttribute('role', 'button');
    cat.setAttribute('tabindex', '0');
    cat.setAttribute('aria-label', 'Cat Companion: Click for a message');

    let bubbleTimeout;
    let animationTimeout;
    let lastIndex = -1;

    // Add your custom messages here
    const messages = [
        // --- 🐱 Generic & Lazy (The Personality) ---
        "I see you have a deadline. I, too, have a deadline... for my next nap. 😴",
        "Have you tried turning it off and on again? Or just walking away? 💻",
        "I am not lazy, I am on energy-saving mode.",
        "Stop clicking me. I am not a mouse. 🐭",
        "My code compiles. Your attendance... remains to be seen.",
        "I’m just here for the digital warmth of your CPU.",
        "System Status: Purring. Attendance Status: Pending.",
        "If I fits, I sits. If you scans, you stands.",
        "Don't mind me, just debugging your life choices.",
        "I accept payment in tuna or verified attendance. 🐟",

        // --- 🏫 Attendance & Scanning (The Core Function) ---
        "Did you scan your ID? Or are we pretending to be present today?",
        "8:40 AM classes are a crime against nature. But you still have to go.",
        "I calculate a 99% probability that you'd rather be sleeping.",
        "Tap the card. Hear the beep. Go to sleep. Repeat. 🔁",
        "Your attendance percentage is looking... interesting.",
        "Attendance is mandatory. My approval is optional.",
        "I am watching the database. Always watching. 👁️",
        "You are here. But are you *mentally* here?",
        "Missing one lecture is a slippery slope to missing the semester.",
        "Scanning in for a friend? I saw nothing... or did I? 🕵️",

        // --- 📝 Absences & Excuses (The "Excuse" Page Logic) ---
        "Calling in sick? I hope you have a doctor's note, or at least a good story.",
        "The 'Car broke down' excuse again? A classic.",
        "I see you're requesting permission. I grant you permission to pet me.",
        "Justifying an absence requires art. And a PDF attachment.",
        "Was it really a 'medical emergency' or just a 'Netflix marathon'?",
        "I don't judge your absences. The algorithm does that for me.",
        "Submitting a request... fingers crossed the professor is in a good mood.",
        "If you miss the Lab, you miss the fun. And the grades.",

        // --- 🎓 University Life (Coffee & Exams) ---
        "Po vjen koha e kafes. ☕",
        "Is it time for Macchiato yet?",
        "That's a lot of reading material. Have you considered absorbing it via osmosis?",
        "Exams are coming. Panic is optional.",
        "Grades, attendance, sleep. Pick two.",
        "I suggest we pause this 'studying' for a quick snack break.",
        "The library is for sleeping, right?",
        "Engineering is hard. Napping is easy.",
        "Calculus? I prefer Cat-culus.",
        "Stressing about the GPA won't help. Scanning your ID might.",

        // --- 🇦🇱 Local Flavour ---
        "What did Bereqet cook today?",
        "Trafiku i Tiranës... say no more.",
        "Gati për mësim?",
    ];

    const triggerCatInteraction = () => {
        // --- Easter Egg Logic (1 in 100 chance) ---
        const chance = 10000;
        const randomNumber = Math.floor(Math.random() * chance);

        if (randomNumber === 0) {
            window.open('https://youtu.be/dQw4w9WgXcQ', '_blank');
            return;
        }

        // 2. Get Unique Message
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * messages.length);
        } while (randomIndex === lastIndex && messages.length > 1);
        lastIndex = randomIndex;

        const text = messages[randomIndex];

        // 3. Smart Duration Calculation
        // Base time (3s) + 50ms per character. 
        // Example: "Hello" = 3.2s. "Long sentence..." = 6-8s. Max cap 12s.
        const readTime = Math.min(Math.max(3000, text.length * 60), 12000);

        // 4. Clear ANY pending hide timers immediately
        clearTimeout(bubbleTimeout);
        clearTimeout(animationTimeout);

        // 5. Update Bubble
        if (bubble.classList.contains('visible')) {
            // Instant swap if already open
            bubble.textContent = text;
            startHideTimer(readTime);
        } else {
            // Pop-in animation if closed
            animationTimeout = setTimeout(() => {
                bubble.textContent = text;
                bubble.classList.add('visible');
            }, 50);
            startHideTimer(readTime);
        }
    };

    const startHideTimer = (duration) => {
        bubbleTimeout = setTimeout(() => {
            bubble.classList.remove('visible');
        }, duration);
    };

    // Click Handler
    cat.addEventListener('click', (event) => {
        event.stopPropagation();
        triggerCatInteraction();
    });

    // Keyboard Handler
    cat.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            triggerCatInteraction();
        }
    });

    // Close on Outside Click
    document.addEventListener('click', (event) => {
        if (bubble.classList.contains('visible') && !cat.contains(event.target)) {
            clearTimeout(bubbleTimeout); // Stop the timer so it doesn't fire later
            bubble.classList.remove('visible');
        }
    });
}

// Initialize the application when window loads
window.addEventListener('load', function () {

    // Initialize the app UI first
    init();

    // Reduced initial delay - Google APIs usually load fast
    setTimeout(() => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
            initGoogleApi();
        } else {
            console.warn('Google API objects not available yet, waiting...');

            // Fallback with longer timeout
            setTimeout(() => {
                if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
                    initGoogleApi();
                } else {
                    console.error('Google API objects still not available');
                    showNotification('error', 'API Error',
                        'Google API libraries not loaded. Please refresh the page.');
                    availableCourses = [];
                    populateCourseDropdown();
                    updateAuthUI();
                }
            }, 2000);
        }
    }, 1000); // Reduced from 2000ms to 1000ms
});
