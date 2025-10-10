// ==UserScript==
// @name         EIS Attendance Auto-Import
// @namespace    https://bredliplaku.com/
// @version      1.3
// @description  Automatically import attendance data from clipboard on EIS page load, now with improved reliability.
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.user.js
// @downloadURL  https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // This checks the system's preferred color scheme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    // This function adds or removes a class from the body to toggle the theme
    function handleThemeChange(event) {
        document.body.classList.toggle('eis-dark-mode', event.matches);
    }

    // Listen for changes (e.g., if you change your OS theme while the page is open)
    prefersDark.addEventListener('change', handleThemeChange);

    // Apply the theme immediately on script load
    handleThemeChange(prefersDark);

    // --- Configuration ---
    let CONFIG = {
        checkedMeansAbsent: false,
        markMissingAsAbsent: true,
        autoReadClipboard: true,
        autoSave: false
    };
    const COLORS = { primary: '#3949ab', success: '#43a047', warning: '#fb8c00', info: '#2196F3', danger: '#f44336', white: '#ffffff' };

    // --- Main Entry Point ---
    console.log("EIS Script: Initializing...");
    waitForElement('#student_list_table', 15000) // Wait up to 15 seconds for the student table to appear
        .then(async () => {
            console.log("EIS Script: Target page confirmed, student table found. Starting main logic.");
            await loadFontAwesome();
            applyGlobalStyles();
            addImportAndPasteButtons(); // Add buttons immediately for manual use

            if (CONFIG.autoReadClipboard) {
                showLoadingIndicator("Reading clipboard...");
                await tryProcessClipboard();
            }
        })
        .catch(error => {
            console.error(error.message);
            showImprovedNotification('error', 'Script Error', 'Could not find the attendance table on this page. The script will not run.');
        });


    // --- Core Logic Functions ---

    /**
     * Waits for a specific element to appear in the DOM.
     * @param {string} selector - The CSS selector of the element to wait for.
     * @param {number} timeout - The maximum time to wait in milliseconds.
     * @returns {Promise<Element>} A promise that resolves with the element when found.
     */
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const intervalTime = 100;
            let elapsedTime = 0;
            const interval = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(interval);
                    resolve(element);
                } else {
                    elapsedTime += intervalTime;
                    if (elapsedTime >= timeout) {
                        clearInterval(interval);
                        reject(new Error(`EIS Script: Timed out waiting for element "${selector}"`));
                    }
                }
            }, intervalTime);
        });
    }

    async function tryProcessClipboard() {
        try {
            const text = await readClipboard();
            if (!text) throw new Error("Clipboard is empty or permission was denied.");

            const data = JSON.parse(text);
            if (!data.parameters || !data.attendance || !data.nameMap) {
                throw new Error("Clipboard does not contain valid attendance data.");
            }

            processAttendanceData(data);

        } catch (error) {
            console.error("EIS Script:", error.message);
            hideLoadingIndicator();
            showImprovedNotification('warning', 'Auto-Import Failed', `${error.message} You can import manually.`);
        }
    }

    function processAttendanceData(data) {
        console.log("EIS Script: Starting data processing...");
        updateLoadingMessage("Setting form parameters (Step 1/2)...");

        if (data.options) {
            Object.assign(CONFIG, data.options);
        }

        // --- STEP 1: SET ALL FORM VALUES FIRST ---
        setFormValue("didcourseattendance_section", data.parameters.section);
        setFormValue("didcourseattendance_week", data.parameters.week);
        setFormValue("didcourseattendance_topicen", data.parameters.topic);
        setFormValue("didcourseattendance_categoryen", data.parameters.category);
        setFormValue("didcourseattendance_date", data.parameters.date);
        setFormValue("didcourseattendance_nrhours", data.parameters.hours);

        // --- STEP 2: WAIT, THEN PROCESS ATTENDANCE ---
        console.log("EIS Script: Waiting for EIS page to filter student list based on section...");
        updateLoadingMessage("Waiting for student list to update (Step 2/2)...");

        setTimeout(() => {
            updateLoadingMessage("Processing attendance checkboxes...");
            processAttendance(data.attendance, data.nameMap, data.parameters.hours);
            hideLoadingIndicator();

            if (CONFIG.autoSave) {
                setTimeout(() => {
                    const saveBtn = document.querySelector('button[name="submit"]');
                    if (saveBtn && confirm("Auto-save is enabled. Save changes now?")) {
                        saveBtn.click();
                    }
                }, 1000);
            }
        }, 2500);
    }

    /**
     * Sets the value of a form element and dispatches the correct events.
     * @param {string} id - The ID of the form element.
     * @param {string} value - The value to set.
     */
    function setFormValue(id, value) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`EIS Script: Element not found: ${id}`);
            return false;
        }

        // For 'section', we need to match by text content as values are numeric
        if (id === 'didcourseattendance_section') {
            const options = Array.from(element.options);
            const targetOption = options.find(opt => opt.text.trim() === value);
            if (targetOption) {
                element.value = targetOption.value;
            } else {
                element.value = value; // Fallback
            }
        } else {
            element.value = value;
        }

        const event = new Event('change', { bubbles: true });
        element.dispatchEvent(event);

        if (window.jQuery) {
            try {
                window.jQuery(element).selectpicker('refresh');
            } catch (e) { /* Ignore if not a selectpicker */ }
        }

        console.log(`EIS Script: Set ${id} to "${element.value}"`);
        return true;
    }

    function processAttendance(attendance, nameMap, numHours) {
        console.log("EIS Script: Starting attendance checkbox processing with CONFIG:", CONFIG);
        const rows = document.querySelectorAll("#student_list_table tbody tr");
        let processed = 0, skipped = 0, noUidMarkedAbsent = 0;

        rows.forEach((row) => {
            const nameCell = row.querySelector("td:nth-child(3)");
            if (!nameCell) return;

            const rawName = nameCell.textContent.trim();

            // --- NEW EXEMPTION LOGIC ---
            // 1. Check if the student is truly exempted based on "R EX"
            const isExempted = /\sR\sEX/.test(rawName);

            // 2. If they are exempted AND the option to mark them as absent is checked, treat them like a missing student
            if (isExempted && CONFIG.markExemptedAsAbsent) {
                const allRowCheckboxes = Array.from(row.querySelectorAll("input[type='checkbox']"));
                const checkboxes = allRowCheckboxes.slice(1, 1 + parseInt(numHours));

                checkboxes.forEach(checkbox => {
                    const shouldBeChecked = CONFIG.checkedMeansAbsent; // This will be TRUE if checked=absent
                    if (checkbox.checked !== shouldBeChecked) checkbox.click();
                });

                updateHiddenFieldsForAbsent(row, numHours, rawName);
                row.classList.add('active', 'eis-highlighted-row', 'eis-no-uid-row');
                skipped++; // Count them as skipped/exempted
                return; // Move to the next student
            }

            // --- NEW NAME CLEANING LOGIC ---
            // This now correctly handles "Name R EX" and "Name R" to get a clean name
            const cleanName = rawName.replace(/\s+R\s+EX/g, "").replace(/\s+R/g, "").trim();

            let foundUid = null;
            for (const [uid, name] of Object.entries(nameMap)) {
                if (String(name).trim().toLowerCase() === cleanName.toLowerCase()) {
                    foundUid = uid;
                    break;
                }
            }

            const allRowCheckboxes = Array.from(row.querySelectorAll("input[type='checkbox']"));
            const checkboxes = allRowCheckboxes.slice(1, 1 + parseInt(numHours));

            if (!foundUid) {
                if (CONFIG.markMissingAsAbsent) {
                    checkboxes.forEach(checkbox => {
                        const shouldBeChecked = CONFIG.checkedMeansAbsent;
                        if (checkbox.checked !== shouldBeChecked) checkbox.click();
                    });
                    updateHiddenFieldsForAbsent(row, numHours, cleanName);
                    row.classList.add('active', 'eis-highlighted-row', 'eis-no-uid-row');
                    noUidMarkedAbsent++;
                }
                return;
            }

            const attendCount = attendance[foundUid] || 0;
            checkboxes.forEach((checkbox, i) => {
                const hourNumber = i + 1;
                const isHourAttended = hourNumber <= attendCount;
                // This logic is now correct based on the CONFIG value you set
                const shouldBeChecked = CONFIG.checkedMeansAbsent ? !isHourAttended : isHourAttended;
                if (checkbox.checked !== shouldBeChecked) {
                    checkbox.click();
                }
            });
            updateHiddenFields(row, numHours, attendCount, cleanName);
            row.classList.add('active', 'eis-highlighted-row');
            processed++;
        });

        const statusMessage = `Processed: ${processed}\nMarked Absent (No UID): ${noUidMarkedAbsent}\nSkipped (Exempted): ${skipped}`;
        showImprovedNotification('success', 'Processing Complete', statusMessage);
    }

    // --- UI and Helper Functions ---

    function addImportAndPasteButtons() {
        const actionBar = document.querySelector('.record_actions');
        if (!actionBar || document.getElementById('eis-paste-btn')) return;

        const pasteButton = document.createElement('button');
        pasteButton.id = 'eis-paste-btn';
        pasteButton.className = 'btn btn-success';
        pasteButton.innerHTML = '<i class="fas fa-paste"></i> Paste Data';
        pasteButton.onclick = async () => {
            showLoadingIndicator("Reading clipboard...");
            await tryProcessClipboard();
        };

        const importButton = document.createElement('button');
        importButton.id = 'eis-import-btn';
        importButton.className = 'btn btn-info';
        importButton.style.marginRight = '10px';
        importButton.innerHTML = '<i class="fas fa-file-import"></i> Import from File';
        importButton.onclick = importAttendance;

        actionBar.insertBefore(pasteButton, actionBar.firstChild);
        actionBar.insertBefore(importButton, pasteButton);
    }

    function loadFontAwesome() {
        return new Promise(resolve => {
            if (document.querySelector('link[href*="fontawesome"]')) return resolve();
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            link.onload = resolve;
            document.head.appendChild(link);
        });
    }

    function applyGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .eis-paste-btn, #eis-import-btn { border-radius: 20px !important; transition: all 0.3s ease !important; }
            .eis-paste-btn:hover, #eis-import-btn:hover { transform: scale(1.05) !important; }
            .eis-highlighted-row { animation: highlight-flash 1.5s ease-in-out; }
            @keyframes highlight-flash { 0%, 100% { background-color: transparent; } 50% { background-color: rgba(57, 73, 171, 0.2); } }
            .eis-no-uid-row { background-color: #ffebee !important; }
            .eis-loading-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000; transition: opacity 0.3s; }
            .eis-loading-content { background: white; padding: 25px; border-radius: 16px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); transition: background-color 0.3s, color 0.3s; }
            .eis-notifications { position: fixed; bottom: 20px; right: 20px; z-index: 10001; width: 350px; max-width: 90%; }
            .eis-notification { background: #fff; color: #333; padding: 15px; border-radius: 8px; box-shadow: 0 3px 10px rgba(0,0,0,0.2); margin-top: 10px; display: flex; align-items: center; animation: slideIn 0.3s ease; }
            .eis-notification.removing { opacity: 0; transform: translateX(100%); }
            @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
            .eis-notification i { margin-right: 10px; font-size: 1.2em; }
            .eis-notification-success { background: #e8f5e9; color: #1b5e20; }
            .eis-notification-warning { background: #fff3e0; color: #e65100; }
            .eis-notification-error { background: #ffebee; color: #b71c1c; }
            .eis-notification-title { font-weight: bold; }
            .eis-notification-close { background: none; border: none; font-size: 1.5em; opacity: 0.5; cursor: pointer; margin-left: auto; padding: 0 5px; }
            .eis-notification-close:hover { opacity: 1; }

            /* --- NEW DARK MODE STYLES --- */
            body.eis-dark-mode .eis-loading-content {
                background-color: #2d2d2d;
                color: #e0e0e0;
            }
            body.eis-dark-mode .eis-loading-content h3,
            body.eis-dark-mode .eis-loading-content small {
                color: #e0e0e0;
            }
            body.eis-dark-mode .eis-loading-content textarea {
                background-color: #1c1c1e;
                color: #e0e0e0;
                border: 1px solid #555;
            }
            body.eis-dark-mode .eis-notification {
                background-color: #3a3a3c;
                color: #e0e0e0;
            }
        `;
        document.head.appendChild(style);
    }

    function showLoadingIndicator(message = "Processing...") {
        hideLoadingIndicator();
        const overlay = document.createElement('div');
        overlay.id = 'eis-loading-overlay';
        overlay.className = 'eis-loading-overlay';
        overlay.innerHTML = `<div class="eis-loading-content"><div style="font-weight:bold; margin-bottom:5px;">${message}</div><small>EIS Attendance Injector</small></div>`;
        document.body.appendChild(overlay);
    }

    function hideLoadingIndicator() {
        const overlay = document.getElementById('eis-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        }
    }

    function updateLoadingMessage(message) {
        const msgDiv = document.querySelector('#eis-loading-overlay .eis-loading-content > div');
        if (msgDiv) msgDiv.textContent = message;
    }

    function readClipboard() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText();
        } else {
            return showPasteDialog();
        }
    }

    function showPasteDialog() {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.id = 'eis-loading-overlay';
            overlay.className = 'eis-loading-overlay';
            overlay.innerHTML = `
                <div class="eis-loading-content" style="width: 500px; max-width: 90%;">
                    <h3 style="margin-top:0;">Paste Data</h3>
                    <p>Your browser does not support automatic clipboard access. Please paste the data below.</p>
                    <textarea style="width: 100%; height: 100px; margin-bottom: 10px;"></textarea>
                    <div style="text-align:right;">
                        <button id="paste-cancel" class="btn btn-danger">Cancel</button>
                        <button id="paste-confirm" class="btn btn-success" style="margin-left:5px;">Confirm</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const textarea = overlay.querySelector('textarea');
            textarea.focus();
            overlay.querySelector('#paste-confirm').onclick = () => { resolve(textarea.value); overlay.remove(); };
            overlay.querySelector('#paste-cancel').onclick = () => { resolve(null); overlay.remove(); };
        });
    }

    function updateHiddenFieldsForAbsent(row, numHours, studentName) {
        const checkboxCell = row.querySelector(".checkboxes_row_td");
        if (!checkboxCell) return;
        const rowIndex = checkboxCell.getAttribute("data-row");
        if (!rowIndex) return;
        const hourField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);
        if (!hourField || !checkedField || !updateField) return;
        const absentList = Array.from({ length: numHours }, (_, i) => i + 1);
        hourField.value = numHours;
        checkedField.value = absentList.join(',');
        updateField.value = "1";
    }

    function updateHiddenFields(row, numHours, attendCount, studentName) {
        const checkboxCell = row.querySelector(".checkboxes_row_td");
        if (!checkboxCell) return;
        const rowIndex = checkboxCell.getAttribute("data-row");
        if (!rowIndex) return;
        const hourField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);
        if (!hourField || !checkedField || !updateField) return;
        const absentHours = Math.max(0, parseInt(numHours) - attendCount);
        const absentList = [];
        for (let i = attendCount + 1; i <= numHours; i++) {
            absentList.push(i);
        }
        hourField.value = absentHours;
        checkedField.value = absentList.join(',');
        updateField.value = "1";
    }

    function importAttendance() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    showLoadingIndicator("Processing imported file...");
                    const data = JSON.parse(e.target.result);
                    if (!data.parameters || !data.attendance || !data.nameMap) throw new Error("Invalid file format.");
                    processAttendanceData(data);
                } catch (error) {
                    hideLoadingIndicator();
                    showImprovedNotification('error', 'Import Error', error.message);
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    }

    function showImprovedNotification(type, title, message, duration = 8000) {
        let container = document.getElementById('eis-notifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'eis-notifications';
            container.className = 'eis-notifications';
            document.body.appendChild(container);
        }
        const notification = document.createElement('div');
        notification.className = `eis-notification eis-notification-${type}`;
        let icon;
        switch (type) {
            case 'success': icon = 'fas fa-check-circle'; break;
            case 'warning': icon = 'fas fa-exclamation-triangle'; break;
            case 'error': icon = 'fas fa-times-circle'; break;
            default: icon = 'fas fa-info-circle';
        }
        notification.innerHTML = `
            <i class="${icon}"></i>
            <div style="flex-grow:1;">
                <div class="eis-notification-title">${title}</div>
                <div>${message.replace(/\n/g, '<br>')}</div>
            </div>
            <button class="eis-notification-close">&times;</button>`;
        container.appendChild(notification);
        const closeBtn = notification.querySelector('.eis-notification-close');
        const removeNotif = () => {
            notification.classList.add('removing');
            setTimeout(() => notification.remove(), 300);
        };
        closeBtn.onclick = removeNotif;
        if (type !== 'error') {
            setTimeout(removeNotif, duration);
        }
    }
})();