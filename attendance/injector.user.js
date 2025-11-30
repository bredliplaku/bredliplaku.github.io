// ==UserScript==
// @name         EIS Attendance Auto-Import
// @namespace    https://bredliplaku.com/
// @version      1.9
// @description  Automatically import attendance data from clipboard on EIS page load.
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.user.js
// @downloadURL  https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    function handleThemeChange(event) {
        document.body.classList.toggle('eis-dark-mode', event.matches);
    }
    prefersDark.addEventListener('change', handleThemeChange);
    handleThemeChange(prefersDark);

    let CONFIG = {
        checkedMeansAbsent: false,
        markMissingAsAbsent: true,
        markExemptedAsAbsent: false,
        manualHours: false,
        autoReadClipboard: true,
        autoSave: false
    };

    // --- UPDATED MAPPINGS BASED ON YOUR HTML ---
    const CATEGORY_MAP = {
        "theory": "Theory",
        "lab": "Lab",          // Fixed: HTML says "Lab", not "Laboratory"
        "practice": "Practice" // Fixed: HTML says "Practice", not "Problem Session"
    };

    console.log("EIS Script: Initializing...");
    waitForElement('#student_list_table', 15000)
        .then(async () => {
            console.log("EIS Script: Table found.");
            await loadFontAwesome();
            applyGlobalStyles();
            addImportAndPasteButtons();

            if (CONFIG.autoReadClipboard) {
                showLoadingIndicator("Reading clipboard...");
                await tryProcessClipboard();
            }
        })
        .catch(error => {
            console.error(error.message);
            showImprovedNotification('error', 'Script Error', 'Could not find the attendance table.');
        });

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
                        reject(new Error(`Timed out waiting for "${selector}"`));
                    }
                }
            }, intervalTime);
        });
    }

    async function tryProcessClipboard() {
        try {
            const text = await readClipboard();
            if (!text) throw new Error("Clipboard empty.");
            const data = JSON.parse(text);
            if (!data.parameters || !data.attendance) throw new Error("Invalid data format.");
            processAttendanceData(data);
        } catch (error) {
            hideLoadingIndicator();
            showImprovedNotification('warning', 'Auto-Import Failed', error.message);
        }
    }

    // --- CORE LOGIC ---
    function processAttendanceData(data) {
        console.log("EIS Script: Processing...", data);
        if (data.options) Object.assign(CONFIG, data.options);

        // 1. Set Static Fields
        setFormValue("didcourseattendance_week", data.parameters.week);
        setFormValue("didcourseattendance_topicen", data.parameters.topic);
        setFormValue("didcourseattendance_date", data.parameters.date);

        updateLoadingMessage("Setting Category...");

        // 2. Set CATEGORY
        setTimeout(() => {
            const rawCategory = data.parameters.category.toLowerCase();
            // Use the map to get "Lab" or "Practice" exactly as HTML expects
            const mappedCategory = CATEGORY_MAP[rawCategory] || data.parameters.category;

            // This sets #didcourseattendance_categoryen
            setFormValue("didcourseattendance_categoryen", mappedCategory);

            // 3. WAIT FOR AJAX (Category Change -> Loads Sections)
            updateLoadingMessage("Waiting for Section list...");

            setTimeout(() => {
                // 4. Set SECTION
                // Only set if not "ALL", otherwise leave default
                if (data.parameters.section !== "ALL") {
                    // Extract "A" from "Theory A" if needed, though exact match usually works
                    setFormValue("didcourseattendance_section", data.parameters.section);
                }

                // 5. WAIT FOR STUDENT LIST (Section Change -> Reloads Table)
                updateLoadingMessage("Loading Student List...");

                setTimeout(() => {

                    // 6. HANDLE HOURS (Manual Override vs Read from DOM)
                    let finalHours = data.parameters.hours;

                    if (CONFIG.manualHours) {
                        // FORCE value from App
                        setFormValue("didcourseattendance_nrhours", finalHours);
                    } else {
                        // READ value from EIS (Auto-filled by Section)
                        const hoursEl = document.getElementById("didcourseattendance_nrhours");
                        if (hoursEl) finalHours = hoursEl.value;
                    }

                    // 7. PROCESS CHECKBOXES
                    updateLoadingMessage("Processing Checkboxes...");
                    processAttendance(data.attendance, data.nameMap, finalHours);
                    hideLoadingIndicator();

                    if (CONFIG.autoSave) {
                        setTimeout(() => {
                            const saveBtn = document.querySelector('button[name="submit"]');
                            if (saveBtn && confirm("Save changes?")) saveBtn.click();
                        }, 500);
                    }
                }, 2500); // Wait for Table Reload

            }, 1500); // Wait for Section Dropdown

        }, 500);
    }

    function setFormValue(id, value) {
        const element = document.getElementById(id);
        if (!element) return false;

        const stringValue = String(value).trim().toLowerCase();

        if (element.tagName === 'SELECT') {
            const options = Array.from(element.options);
            let targetOption = null;

            // 1. Text Match (e.g. "Lab" == "Lab")
            targetOption = options.find(opt => opt.text.trim().toLowerCase() === stringValue);

            // 2. Value Match (e.g. "lab" == "lab")
            if (!targetOption) {
                targetOption = options.find(opt => opt.value.toLowerCase() === stringValue);
            }

            // 3. Partial Match
            if (!targetOption) {
                targetOption = options.find(opt => opt.text.trim().toLowerCase().includes(stringValue));
            }

            if (targetOption) {
                element.value = targetOption.value;
            } else {
                console.warn(`EIS Script: Could not find option for "${value}" in #${id}`);
            }
        } else {
            element.value = value;
        }

        // Trigger Events for EIS/jQuery
        element.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) {
            try {
                window.jQuery(element).val(element.value).trigger('change');
                window.jQuery(element).selectpicker('refresh');
            } catch (e) { }
        }
        return true;
    }

    function processAttendance(attendance, nameMap, numHours) {
        const rows = document.querySelectorAll("#student_list_table tbody tr");
        let processed = 0, skipped = 0, noUid = 0;

        rows.forEach((row) => {
            const nameCell = row.querySelector("td:nth-child(3)");
            if (!nameCell) return;

            const rawName = nameCell.textContent.trim();
            const isExempted = /\s+R\s+EX$/.test(rawName);

            if (isExempted && CONFIG.markExemptedAsAbsent) {
                toggleRow(row, numHours, true);
                updateHiddenFields(row, numHours, 0);
                row.classList.add('active', 'eis-highlighted-row', 'eis-no-uid-row');
                skipped++;
                return;
            }

            const cleanName = rawName.replace(/\s+R\s+EX$/, "").replace(/\s+R$/, "").trim();

            let foundUid = Object.keys(nameMap).find(uid =>
                String(nameMap[uid]).trim().toLowerCase() === cleanName.toLowerCase()
            );

            if (!foundUid) {
                if (CONFIG.markMissingAsAbsent) {
                    toggleRow(row, numHours, true);
                    updateHiddenFields(row, numHours, 0);
                    row.classList.add('active', 'eis-highlighted-row', 'eis-no-uid-row');
                    noUid++;
                }
                return;
            }

            const attendCount = attendance[foundUid] || 0;
            const checkboxes = Array.from(row.querySelectorAll("input[type='checkbox']")).slice(1, 1 + parseInt(numHours));

            checkboxes.forEach((checkbox, i) => {
                const shouldBePresent = (i + 1) <= attendCount;
                const targetState = CONFIG.checkedMeansAbsent ? !shouldBePresent : shouldBePresent;

                if (checkbox.checked !== targetState) checkbox.click();
            });

            updateHiddenFields(row, numHours, attendCount);
            row.classList.add('active', 'eis-highlighted-row');
            processed++;
        });

        showImprovedNotification('success', 'Done', `Processed: ${processed} | No UID: ${noUid} | Exempt: ${skipped}`);
    }

    function toggleRow(row, numHours, markAbsent) {
        const checkboxes = Array.from(row.querySelectorAll("input[type='checkbox']")).slice(1, 1 + parseInt(numHours));
        checkboxes.forEach(cb => {
            const targetState = CONFIG.checkedMeansAbsent ? markAbsent : !markAbsent;
            if (cb.checked !== targetState) cb.click();
        });
    }

    function updateHiddenFields(row, numHours, attendCount) {
        const rowIndex = row.querySelector(".checkboxes_row_td")?.getAttribute("data-row");
        if (!rowIndex) return;

        const hourField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);

        if (hourField && checkedField && updateField) {
            const absentHours = Math.max(0, parseInt(numHours) - attendCount);
            const absentList = [];
            for (let i = attendCount + 1; i <= numHours; i++) absentList.push(i);

            hourField.value = absentHours;
            checkedField.value = absentList.join(',');
            updateField.value = "1";
        }
    }

    function addImportAndPasteButtons() {
        const actionBar = document.querySelector('.record_actions');
        if (!actionBar || document.getElementById('eis-paste-btn')) return;

        const pasteButton = document.createElement('button');
        pasteButton.id = 'eis-paste-btn';
        pasteButton.className = 'btn btn-success';
        pasteButton.innerHTML = '<i class="fas fa-paste"></i> Paste';
        pasteButton.onclick = async () => { showLoadingIndicator("Reading..."); await tryProcessClipboard(); };

        const importButton = document.createElement('button');
        importButton.id = 'eis-import-btn';
        importButton.className = 'btn btn-info';
        importButton.style.marginRight = '10px';
        importButton.innerHTML = '<i class="fas fa-file-import"></i> Import';
        importButton.onclick = importAttendance;

        actionBar.insertBefore(pasteButton, actionBar.firstChild);
        actionBar.insertBefore(importButton, pasteButton);
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
                    showLoadingIndicator("Processing...");
                    processAttendanceData(JSON.parse(e.target.result));
                } catch (err) {
                    hideLoadingIndicator();
                    showImprovedNotification('error', 'Error', err.message);
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    }

    function loadFontAwesome() {
        if (!document.querySelector('link[href*="fontawesome"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            document.head.appendChild(link);
        }
    }

    function applyGlobalStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .eis-paste-btn, #eis-import-btn { border-radius: 20px !important; }
            .eis-highlighted-row { animation: highlight-flash 1.5s ease-in-out; }
            @keyframes highlight-flash { 0% { background-color: transparent; } 50% { background-color: rgba(57, 73, 171, 0.2); } 100% { background-color: transparent; } }
            .eis-no-uid-row { background-color: #ffebee !important; }
            .eis-loading-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; z-index: 10000; }
            .eis-loading-content { background: white; padding: 25px; border-radius: 16px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .eis-notifications { position: fixed; bottom: 20px; right: 20px; z-index: 10001; width: 350px; }
            .eis-notification { background: #fff; color: #333; padding: 15px; border-radius: 8px; box-shadow: 0 3px 10px rgba(0,0,0,0.2); margin-top: 10px; display: flex; align-items: center; }
            .eis-notification-success { background: #e8f5e9; color: #1b5e20; }
            .eis-notification-warning { background: #fff3e0; color: #e65100; }
            .eis-notification-error { background: #ffebee; color: #b71c1c; }
            body.eis-dark-mode .eis-loading-content { background-color: #2d2d2d; color: #e0e0e0; }
            body.eis-dark-mode .eis-notification { background-color: #3a3a3c; color: #e0e0e0; }
        `;
        document.head.appendChild(style);
    }

    function showLoadingIndicator(msg) {
        let overlay = document.getElementById('eis-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'eis-loading-overlay';
            overlay.className = 'eis-loading-overlay';
            overlay.innerHTML = `<div class="eis-loading-content"><div style="font-weight:bold; margin-bottom:5px;"></div><small>Please wait...</small></div>`;
            document.body.appendChild(overlay);
        }
        updateLoadingMessage(msg);
    }

    function hideLoadingIndicator() {
        const overlay = document.getElementById('eis-loading-overlay');
        if (overlay) overlay.remove();
    }

    function updateLoadingMessage(msg) {
        const div = document.querySelector('#eis-loading-overlay .eis-loading-content > div');
        if (div) div.textContent = msg;
    }

    function readClipboard() {
        if (navigator.clipboard && navigator.clipboard.readText) return navigator.clipboard.readText();
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'eis-loading-overlay';
            overlay.innerHTML = `<div class="eis-loading-content" style="width:400px;"><textarea style="width:100%;height:100px;"></textarea><br><button id="p-ok" class="btn btn-success">OK</button></div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('textarea').focus();
            overlay.querySelector('#p-ok').onclick = () => { resolve(overlay.querySelector('textarea').value); overlay.remove(); };
        });
    }

    function showImprovedNotification(type, title, message) {
        let container = document.getElementById('eis-notifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'eis-notifications';
            container.className = 'eis-notifications';
            document.body.appendChild(container);
        }
        const notif = document.createElement('div');
        notif.className = `eis-notification eis-notification-${type}`;
        notif.innerHTML = `<div style="flex-grow:1;"><b>${title}</b><br>${message}</div><button style="border:none;background:none;cursor:pointer;">&times;</button>`;
        notif.querySelector('button').onclick = () => notif.remove();
        container.appendChild(notif);
        setTimeout(() => notif.remove(), 8000);
    }
})();