// ==UserScript==
// @name         EIS Attendance Auto-Import
// @namespace    https://bredliplaku.com/
// @version      1.0
// @description  Automatically import attendance data from clipboard on EIS page load
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.js
// @downloadURL  https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/injector.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration options (default values)
    let CONFIG = {
        // Set this to true if checkbox checked means ABSENT (inverts the logic)
        // Set this to false if checkbox checked means PRESENT
        checkedMeansAbsent: true,

        // Set this to true to mark students without UIDs as absent
        markMissingAsAbsent: true,

        // Auto-read clipboard on page load (without user interaction)
        autoReadClipboard: true,

        // Auto-save after processing (use with caution)
        autoSave: false
    };

    // Color palette to match testing.html
    const COLORS = {
        primary: '#3949ab',
        primaryDark: '#1a237e',
        secondary: '#ffa726',
        success: '#43a047',
        warning: '#fb8c00',
        info: '#2196F3',
        danger: '#f44336',
        white: '#ffffff',
        light: '#f4f4f4',
        dark: '#333333'
    };

    // First, load Font Awesome from CDN
    function loadFontAwesome() {
        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
            link.onload = resolve; // Resolve when loaded
            document.head.appendChild(link);

            // Set a timeout in case the load event doesn't fire
            setTimeout(resolve, 2000);
        });
    }

function applyGlobalStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Loading overlay - highly rounded corners */
        .eis-loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            transition: opacity 0.5s ease;
        }

        .eis-loading-content {
            background-color: ${COLORS.white};
            border-radius: 30px;  /* Highly rounded corners */
            padding: 35px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            text-align: center;
            max-width: 80%;
            animation: fadeIn 0.3s ease;
        }

        /* Custom buttons - highly rounded corners */
        .eis-btn {
            display: inline-block;
            background-color: ${COLORS.primary};
            color: ${COLORS.white};
            padding: 10px 20px;
            border-radius: 20px;  /* Highly rounded corners */
            text-decoration: none;
            font-size: 0.9em;
            transition: all 0.3s ease;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            border: 0;
            cursor: pointer;
            margin: 5px;
            font-family: 'Roboto', Arial, sans-serif;
            font-weight: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .eis-btn:hover {
            background-color: ${COLORS.primaryDark};
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            transform: scale(1.05);
        }

        .eis-btn-success { background-color: ${COLORS.success}; }
        .eis-btn-success:hover { background-color: #2e7d32; }

        .eis-btn-info { background-color: ${COLORS.info}; }
        .eis-btn-info:hover { background-color: #1976D2; }

        .eis-btn-warning { background-color: ${COLORS.warning}; }
        .eis-btn-warning:hover { background-color: #ef6c00; }

        .eis-btn-danger { background-color: ${COLORS.danger}; }
        .eis-btn-danger:hover { background-color: #d32f2f; }

        .eis-btn-lg {
            padding: 15px 30px;
            font-size: 1.1em;
            border-radius: 30px;  /* Extra rounded corners for large buttons */
        }

        /* Paste button - very rounded corners */
        .eis-paste-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            padding: 15px 25px;
            border-radius: 30px;  /* Very rounded corners */
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
        }

        /* Notifications - moderately rounded corners */
        .eis-notifications {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            width: 350px;
            max-width: 80%;
            pointer-events: none;
        }

        .eis-notification {
            background-color: ${COLORS.white};
            border-radius: 16px;  /* Moderately rounded corners */
            padding: 15px;
            margin-bottom: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out forwards;
            overflow: hidden;
            display: flex;
            align-items: center;
            opacity: 1;
            transition: transform 0.3s ease-in, opacity 0.3s ease-in;
            pointer-events: auto;
        }

        .eis-notification.removing {
            opacity: 0;
            transform: translateX(100%);
        }

        .eis-notification i {
            margin-right: 10px;
            font-size: 1.2em;
        }

        .eis-notification-content {
            flex-grow: 1;
        }

        .eis-notification-title {
            font-weight: bold;
            margin-bottom: 5px;
        }

        .eis-notification-info {
            background-color: #e3f2fd;
            color: #0d47a1;
        }

        .eis-notification-warning {
            background-color: #fff3e0;
            color: #e65100;
        }

        .eis-notification-error {
            background-color: #ffebee;
            color: #b71c1c;
        }

        .eis-notification-success {
            background-color: #e8f5e9;
            color: #1b5e20;
        }

        .eis-notification-close {
            background: none;
            border: none;
            font-size: 18px;
            color: inherit;
            opacity: 0.7;
            cursor: pointer;
            padding: 0;
            margin-left: 8px;
            transition: opacity 0.3s;
            align-self: flex-start;
        }

        .eis-notification-close:hover {
            opacity: 1;
        }

        /* Mobile adjustments */
        @media (max-width: 700px) {
            .eis-notifications {
                bottom: 10px;
                left: 50%;
                right: auto;
                transform: translateX(-50%);
                width: 90%;
                max-width: 90%;
            }

            .eis-notification.removing {
                opacity: 0;
                transform: translateY(100%);
            }

            @keyframes slideIn {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        }

        /* Highlighted rows */
        .eis-highlighted-row {
            animation: highlight-flash 1.5s ease-in-out;
        }

        @keyframes highlight-flash {
            0%, 100% { background-color: transparent; }
            50% { background-color: rgba(57, 73, 171, 0.2); }
        }

        .eis-no-uid-row {
            background-color: #ffebee !important;
        }

        /* Style for the import button in the EIS UI */
        #eis-import-btn {
            border-radius: 20px !important;
            margin-right: 10px;
            transition: all 0.3s ease !important;
        }

        #eis-import-btn:hover {
            transform: scale(1.05) !important;
        }

        /* Dialog textarea and other form elements */
        .eis-loading-content textarea,
        .eis-loading-content input,
        .eis-loading-content select {
            border-radius: 12px !important;
            padding: 10px !important;
            border: 1px solid #ddd !important;
        }
    `;
    document.head.appendChild(style);
}

    // Run when the page is fully loaded
    window.addEventListener('load', async function() {
        console.log("EIS Attendance Auto-Import starting...");

        // First check if we're on the right page
        if (!window.location.href.includes('courseattendance') || !window.location.href.includes('newcl')) {
            console.log("Not on the EIS attendance page, script will not run");
            return;
        }

        // Initial loading indicator (before Font Awesome loads)
        const tempLoading = document.createElement('div');
        tempLoading.style.position = 'fixed';
        tempLoading.style.top = '0';
        tempLoading.style.left = '0';
        tempLoading.style.width = '100%';
        tempLoading.style.height = '100%';
        tempLoading.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        tempLoading.style.zIndex = '10000';
        tempLoading.innerHTML = '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 10px;"><div>Loading Attendance Import...</div></div>';
        document.body.appendChild(tempLoading);

        // Load Font Awesome first
        console.log("Loading Font Awesome...");
        await loadFontAwesome();
        console.log("Font Awesome loaded successfully");

        // Remove temporary loading indicator
        document.body.removeChild(tempLoading);

        // Apply styles after Font Awesome is loaded
        applyGlobalStyles();

        // Show proper loading indicator
        showLoadingIndicator("Initializing attendance import...");

        // Add a slight delay to ensure the page is fully rendered
        setTimeout(() => {
            if (CONFIG.autoReadClipboard) {
                // Automatically try to read and process clipboard
                tryProcessClipboard();
            } else {
                // Just add the paste button
                hideLoadingIndicator();
                addPasteButton();
            }
        }, 1000);
    });

function showLoadingIndicator(message = "Loading attendance data...") {
    // Remove any existing loading indicator
    hideLoadingIndicator();

    const overlay = document.createElement('div');
    overlay.id = 'eis-loading-overlay';
    overlay.className = 'eis-loading-overlay';

    const content = document.createElement('div');
    content.className = 'eis-loading-content';

    content.innerHTML = `
        <img src="https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/loading.gif"
             alt="Loading Cat" style="width: 150px; height: 150px; margin-bottom: 10px;">
        <div style="margin-bottom: 15px; font-size: 18px; font-weight: 500; color: ${COLORS.primary};">
            ${message}
        </div>
        <div style="color: #666; font-size: 14px; margin-top: 5px;">
            Calculating excuses per minute...
        </div>
    `;

    overlay.appendChild(content);
    document.body.appendChild(overlay);
}

    function hideLoadingIndicator() {
        const overlay = document.getElementById('eis-loading-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 500);
        }
    }

    async function tryProcessClipboard() {
        try {
            // Try to get clipboard content
            console.log("Attempting to read clipboard...");
            const text = await readClipboard();

            if (!text) {
                console.log("No text found in clipboard");
                showImprovedNotification('warning', 'No Data Found', 'No attendance data found in clipboard. Click the Paste button to try again.');
                hideLoadingIndicator();
                addPasteButton();
                return;
            }

            try {
                // Parse JSON data
                const data = JSON.parse(text);
                console.log("Parsed clipboard data:", data);

                // Check if we have the right format
                if (!data.parameters || !data.attendance || !data.nameMap) {
                    throw new Error("Missing required data in clipboard content");
                }

                // Update CONFIG with any options from the data
                if (data.options) {
                    console.log("Updating config with options from data:", data.options);
                    CONFIG = { ...CONFIG, ...data.options };
                }

                // Process the data
                processAttendanceData(data);

            } catch (parseError) {
                console.error("Error parsing clipboard data:", parseError);
                showImprovedNotification('error', 'Invalid Data', 'The clipboard does not contain valid attendance data. Try copying it again.');
                hideLoadingIndicator();
                addPasteButton();
            }
        } catch (clipboardError) {
            console.error("Clipboard access error:", clipboardError);
            showImprovedNotification('error', 'Clipboard Access Denied', 'Could not access clipboard automatically. Please click the Paste button.');
            hideLoadingIndicator();
            addPasteButton();
        }
    }

    function processAttendanceData(data) {
        updateLoadingMessage("Setting form parameters...");

        // Set form parameters
        setFormValue("didcourseattendance_week", data.parameters.week);
        setFormValue("didcourseattendance_topicen", data.parameters.topic);
        setFormValue("didcourseattendance_categoryen", data.parameters.category);
        setFormValue("didcourseattendance_date", data.parameters.date);

        // Update CONFIG with any options from the data
        if (data.options) {
            console.log("Applying options from data:", data.options);
            Object.assign(CONFIG, data.options);
        }

        updateLoadingMessage("Setting hours and generating checkboxes...");

        // Set hours last - this triggers checkbox generation
        setFormValue("didcourseattendance_nrhours", data.parameters.hours);

        // Wait for form to update and generate checkboxes
        setTimeout(() => {
            updateLoadingMessage("Processing attendance data...");
            processAttendance(data.attendance, data.nameMap, data.parameters.hours);
            hideLoadingIndicator();

            // If auto-save is enabled, find and click the save button
            if (CONFIG.autoSave) {
                setTimeout(() => {
                    const saveBtn = document.querySelector('button[name="submit"]');
                    if (saveBtn) {
                        if (confirm("Auto-save is enabled. Do you want to save changes now?")) {
                            saveBtn.click();
                        }
                    }
                }, 1000);
            }
        }, 2000);
    }

function updateLoadingMessage(message) {
    const overlay = document.getElementById('eis-loading-overlay');
    if (overlay) {
        const messageElement = overlay.querySelector('.eis-loading-content div:nth-child(2)');
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
}

    function addPasteButton() {
        // Remove any existing paste button
        const existingBtn = document.getElementById('eis-paste-btn');
        if (existingBtn) {
            existingBtn.remove();
        }

        // Create a floating button in the bottom right
        const pasteBtn = document.createElement('button');
        pasteBtn.id = 'eis-paste-btn';
        pasteBtn.className = 'eis-btn eis-btn-lg eis-paste-btn';
        pasteBtn.innerHTML = '<i class="fas fa-paste"></i> Paste Attendance Data';

        // Add click handler for clipboard paste
        pasteBtn.onclick = function() {
            pasteAttendanceData();
        };

        document.body.appendChild(pasteBtn);

        // Also add an import button in the action bar
        addImportButton();

        // Make it pulse briefly to draw attention
        setTimeout(() => {
            pasteBtn.style.transform = 'scale(1.1)';
            setTimeout(() => {
                pasteBtn.style.transform = 'scale(1)';
            }, 300);
        }, 500);
    }

    async function pasteAttendanceData() {
        showLoadingIndicator("Reading attendance data from clipboard...");

        try {
            // Get text from clipboard
            const text = await readClipboard();

            if (!text) {
                hideLoadingIndicator();
                showImprovedNotification('warning', 'Empty Clipboard', 'Clipboard is empty. Please copy attendance data first.');
                return;
            }

            try {
                // Parse JSON data
                const data = JSON.parse(text);
                console.log("Parsed clipboard data:", data);

                // Check if we have the right format
                if (!data.parameters || !data.attendance || !data.nameMap) {
                    throw new Error("Missing required data in clipboard content");
                }

                processAttendanceData(data);

            } catch (error) {
                console.error("Paste error:", error);
                hideLoadingIndicator();
                showImprovedNotification('error', 'Invalid Data', 'Error processing clipboard data: ' + error.message);
            }
        } catch (clipboardError) {
            console.error("Clipboard access error:", clipboardError);
            hideLoadingIndicator();
            showImprovedNotification('error', 'Clipboard Error', 'Could not access clipboard. Try using file import instead.');

            // Fallback to file import
            importAttendance();
        }
    }

    function readClipboard() {
        // Use modern Clipboard API if available
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText();
        } else {
            // For older browsers with no clipboard API, show a modal paste dialog
            return showPasteDialog();
        }
    }

    function showPasteDialog() {
        return new Promise((resolve) => {
            // Create modal backdrop
            const overlay = document.createElement('div');
            overlay.className = 'eis-loading-overlay';
            overlay.style.justifyContent = 'center';
            overlay.style.alignItems = 'center';

            // Create dialog
            const dialog = document.createElement('div');
            dialog.className = 'eis-loading-content';
            dialog.style.width = '80%';
            dialog.style.maxWidth = '600px';

            dialog.innerHTML = `
                <h3 style="margin-top: 0; color: ${COLORS.primary};">Paste Attendance Data</h3>
                <p>Please paste the attendance data in the field below:</p>
                <textarea style="width: 100%; height: 150px; padding: 10px; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 20px; font-family: monospace;"></textarea>
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="eis-btn eis-btn-danger" id="eis-cancel-paste">Cancel</button>
                    <button class="eis-btn eis-btn-success" id="eis-confirm-paste">Import Data</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Focus the textarea
            const textarea = dialog.querySelector('textarea');
            textarea.focus();

            // Set up event handlers
            document.getElementById('eis-confirm-paste').addEventListener('click', () => {
                const text = textarea.value.trim();
                document.body.removeChild(overlay);
                resolve(text.length > 0 ? text : null);
            });

            document.getElementById('eis-cancel-paste').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
        });
    }

    function setFormValue(id, value) {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element not found: ${id}`);
            return false;
        }

        element.value = value;

        // Trigger appropriate event
        let eventType = "change";
        if (element.tagName === "INPUT" && element.type === "text") {
            eventType = "input";
        }

        const event = new Event(eventType, { bubbles: true });
        element.dispatchEvent(event);
        console.log(`Set ${id} to "${value}"`);
        return true;
    }

    function processAttendance(attendance, nameMap, numHours) {
        // We'll work with the existing form structure rather than resetting everything
        console.log("Starting attendance processing with CONFIG:", CONFIG);

        // Now process each student row
        const rows = document.querySelectorAll("#student_list_table tbody tr");
        console.log(`Processing ${rows.length} student rows with ${numHours} hours`);

        let processed = 0;
        let skipped = 0;
        let noUidMarkedAbsent = 0;

        // Process each student row
        rows.forEach((row) => {
            // Get student name
            const nameCell = row.querySelector("td:nth-child(3)");
            if (!nameCell) return;

            // Get name without R/EX markers
            let fullName = nameCell.textContent.trim();
            let cleanName = fullName.replace(/\s+R\s+EX|\s+EX|\s+R|\s+\(R\)|\s+\(EX\)/g, "").trim();

            // Check if exempted
            const isExempted = row.querySelector("td[data-exempted='EX']");
            if (isExempted) {
                console.log(`Skipping exempted student: ${cleanName}`);
                skipped++;
                return;
            }

            // Find UID for student
            let foundUid = null;
            for (const [uid, name] of Object.entries(nameMap)) {
                const mappedName = String(name).replace(/\s+R\s+EX|\s+EX|\s+R|\s+\(R\)|\s+\(EX\)/g, "").trim();
                if (mappedName.toLowerCase() === cleanName.toLowerCase()) {
                    foundUid = uid;
                    break;
                }
            }

            if (!foundUid) {
                console.log(`No UID found for: ${cleanName}`);

                // If markMissingAsAbsent is true, mark student as absent for all hours
                if (CONFIG.markMissingAsAbsent) {
                    console.log(`Marking ${cleanName} as absent for all hours (CONFIG.markMissingAsAbsent is ${CONFIG.markMissingAsAbsent})`);

                    // Get hour checkboxes
                    const allRowCheckboxes = Array.from(row.querySelectorAll("input[type='checkbox']"));
                    const checkboxes = allRowCheckboxes.slice(1, 1 + parseInt(numHours));

                    if (checkboxes.length === 0) {
                        console.log(`No hour checkboxes found for ${cleanName}`);
                        return;
                    }

                    // Process each hour checkbox - mark all as absent
                    for (let i = 0; i < checkboxes.length && i < numHours; i++) {
                        const checkbox = checkboxes[i];

                        // For absent, checkbox should be checked if checkedMeansAbsent=true
                        // or unchecked if checkedMeansAbsent=false
                        const shouldBeChecked = CONFIG.checkedMeansAbsent ? true : false;

                        // Force the checkbox to the correct state
                        checkbox.checked = shouldBeChecked;

                        // Create and dispatch events
                        const clickEvent = new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        });
                        checkbox.dispatchEvent(clickEvent);

                        const changeEvent = new Event('change', { bubbles: true });
                        checkbox.dispatchEvent(changeEvent);
                    }

                    // Set all hours as absent in the hidden fields
                    updateHiddenFieldsForAbsent(row, numHours, cleanName);

                    // Mark row as updated
                    row.classList.add('active', 'eis-highlighted-row', 'eis-no-uid-row');
                    noUidMarkedAbsent++;
                } else {
                    console.log(`Not marking ${cleanName} as absent because CONFIG.markMissingAsAbsent is ${CONFIG.markMissingAsAbsent}`);
                }

                return;
            }

            // Get attendance count
            const attendCount = attendance[foundUid] || 0;
            console.log(`${cleanName} (${foundUid}) attended ${attendCount} hours of ${numHours} total hours`);

            // Get hour checkboxes more reliably - the form structure shows they're in separate cells
            // First identify all checkboxes in the row
            const allRowCheckboxes = Array.from(row.querySelectorAll("input[type='checkbox']"));

            // The first checkbox is typically the "SELECT ALL" for this row, skip it
            // We only want the hour checkboxes which start from index 1
            const checkboxes = allRowCheckboxes.slice(1, 1 + parseInt(numHours));

            console.log(`Found ${checkboxes.length} hour checkboxes for ${cleanName} (need ${numHours})`);

            // If we don't have enough checkboxes, something is wrong
            if (checkboxes.length < numHours) {
                console.warn(`Expected ${numHours} hour checkboxes for ${cleanName}, but found ${checkboxes.length}`);
            }

            if (checkboxes.length === 0) {
                console.log(`No hour checkboxes found for ${cleanName}`);
                return;
            }

            // Process each hour checkbox
            for (let i = 0; i < checkboxes.length && i < numHours; i++) {
                const checkbox = checkboxes[i];
                const hourNumber = i + 1; // Hour numbers are 1-based
                // Determine if the hour should be marked as attended
                const isHourAttended = hourNumber <= attendCount;

                // Apply the configuration to determine checkbox state
                // If checkedMeansAbsent is true: checkbox should be checked when student is ABSENT
                // If checkedMeansAbsent is false: checkbox should be checked when student is PRESENT
                const shouldBeChecked = CONFIG.checkedMeansAbsent ? !isHourAttended : isHourAttended;

                // Force the checkbox to the correct state
                checkbox.checked = shouldBeChecked;

                // Create and dispatch a proper MouseEvent instead of just a change event
                // This better simulates an actual user click
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                checkbox.dispatchEvent(clickEvent);

                // Also dispatch the change event for good measure
                const changeEvent = new Event('change', { bubbles: true });
                checkbox.dispatchEvent(changeEvent);

                console.log(`Set ${cleanName} hour ${hourNumber} to ${isHourAttended ? 'Present' : 'Absent'} (checkbox is ${shouldBeChecked ? 'checked' : 'unchecked'})`);
            }

            // Set the hidden values
            updateHiddenFields(row, numHours, attendCount, cleanName);

            // Mark row as updated
            row.classList.add('active', 'eis-highlighted-row');
            processed++;
        });

        const statusMessage = `
Attendance processed:
- ${processed} students marked with proper attendance
- ${noUidMarkedAbsent} students without UIDs marked as absent
- ${skipped} exempted students skipped

Please review and click Save Changes.`;

        console.log(statusMessage);
        showImprovedNotification('success', 'Processing Complete', statusMessage);
    }

    // Special function for students with no UID - mark all hours as absent
    function updateHiddenFieldsForAbsent(row, numHours, studentName) {
        // Set the hidden values for the form submission
        const checkboxCell = row.querySelector(".checkboxes_row_td");
        if (!checkboxCell) {
            console.log(`No checkbox cell found for ${studentName}`);
            return;
        }

        const rowIndex = checkboxCell.getAttribute("data-row");
        if (!rowIndex) {
            console.log(`No row index found for ${studentName}`);
            return;
        }

        // Find and set hidden fields
        const hourField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);

        if (!hourField || !checkedField || !updateField) {
            console.log(`Missing hidden fields for ${studentName}`);
            return;
        }

        // For students with no UID, mark all hours as absent
        const absentHours = parseInt(numHours);

        // Build list of all hours (all absent)
        const absentList = [];
        for (let i = 1; i <= numHours; i++) {
            absentList.push(i);
        }

        // Set values
        hourField.value = absentHours;
        checkedField.value = absentList.join(',');
        updateField.value = "1";

        console.log(`Updated hidden fields for ${studentName} (no UID): absent=${absentHours}, list=${absentList.join(',')}`);
    }

    function updateHiddenFields(row, numHours, attendCount, studentName) {
        // Set the hidden values for the form submission
        const checkboxCell = row.querySelector(".checkboxes_row_td");
        if (!checkboxCell) {
            console.log(`No checkbox cell found for ${studentName}`);
            return;
        }

        const rowIndex = checkboxCell.getAttribute("data-row");
        if (!rowIndex) {
            console.log(`No row index found for ${studentName}`);
            return;
        }

        // Find and set hidden fields
        const hourField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);

        if (!hourField || !checkedField || !updateField) {
            console.log(`Missing hidden fields for ${studentName}`);
            return;
        }

        // Calculate hours absent
        const absentHours = Math.max(0, parseInt(numHours) - attendCount);

        // Build list of absent hours
        const absentList = [];
        for (let i = attendCount + 1; i <= numHours; i++) {
            absentList.push(i);
        }

        // Set values
        hourField.value = absentHours;
        checkedField.value = absentList.join(',');
        updateField.value = "1";

        console.log(`Updated hidden fields for ${studentName}: absent=${absentHours}, list=${absentList.join(',')}`);
    }

    function addImportButton() {
        // Remove any existing import button first
        const existingBtn = document.getElementById('eis-import-btn');
        if (existingBtn) {
            existingBtn.remove();
        }

        const actionBar = document.querySelector('.record_actions');
        if (!actionBar) return;

        const button = document.createElement('button');
        button.id = 'eis-import-btn';
        button.className = 'btn btn-info';
        button.style.backgroundColor = COLORS.info;
        button.style.color = COLORS.white;
        button.style.marginRight = '10px';
        button.style.border = 'none';
        button.style.borderRadius = '5px';
        button.style.padding = '6px 12px';
        button.innerHTML = '<i class="fas fa-file-import"></i> Import Attendance';
        button.onclick = importAttendance;

        actionBar.insertBefore(button, actionBar.firstChild);
    }

    function importAttendance() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.onchange = function(event) {
            const file = event.target.files[0];
            if (!file) {
                document.body.removeChild(fileInput);
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    showLoadingIndicator("Processing imported attendance data...");

                    const data = JSON.parse(e.target.result);
                    console.log("Parsed data:", data);

                    if (!data.parameters || !data.attendance || !data.nameMap) {
                        throw new Error("Missing required data in import file");
                    }

                    // Update CONFIG with any options from the data
                    if (data.options) {
                        console.log("Updating config with options from import:", data.options);
                        Object.assign(CONFIG, data.options);
                    }

                    processAttendanceData(data);

                } catch (error) {
                    console.error("Import error:", error);
                    hideLoadingIndicator();
                    showImprovedNotification('error', 'Import Error', "Error importing: " + error.message);
                }
                document.body.removeChild(fileInput);
            };

            reader.readAsText(file);
        };

        fileInput.click();
    }

    function showImprovedNotification(type, title, message, duration = 8000) {
        // Create notification container if it doesn't exist
        let container = document.getElementById('eis-notifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'eis-notifications';
            container.className = 'eis-notifications';
            document.body.appendChild(container);
        }

        // Create notification
        const notification = document.createElement('div');
        notification.className = `eis-notification eis-notification-${type}`;

        // Set appropriate icon
        let icon;
        switch(type) {
            case 'success': icon = 'fas fa-check-circle'; break;
            case 'warning': icon = 'fas fa-exclamation-triangle'; break;
            case 'error': icon = 'fas fa-times-circle'; break;
            default: icon = 'fas fa-info-circle';
        }

        // Build notification content
        const content = document.createElement('div');
        content.className = 'eis-notification-content';

        const titleElement = document.createElement('div');
        titleElement.className = 'eis-notification-title';
        titleElement.textContent = title;
        content.appendChild(titleElement);

        // Message with line breaks
        const messageElement = document.createElement('div');
        messageElement.innerHTML = message.replace(/\n/g, '<br>');
        content.appendChild(messageElement);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'eis-notification-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            notification.classList.add('removing');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        };

        // Assemble notification
        notification.innerHTML = `<i class="${icon}"></i>`;
        notification.appendChild(content);
        notification.appendChild(closeBtn);

        // Add to container
        container.appendChild(notification);

        // Automatically remove after specified duration (unless it's an error)
        if (type !== 'error' && duration > 0) {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.classList.add('removing');
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                }
            }, duration);
        }
    }
})();