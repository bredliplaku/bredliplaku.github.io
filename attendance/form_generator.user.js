// ==UserScript==
// @name         EIS Attendance Sheet Generator
// @namespace    https://bredliplaku.com/
// @version      1.3
// @description  Generates attendance sheet that perfectly matches the original template with customizable fields
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/editcl
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/form_generator.user.js
// @downloadURL  https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/form_generator.user.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // Import additional formal/official document signing fonts
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Homemade+Apple&family=Dancing+Script&family=Caveat&family=Pacifico&family=Satisfy&family=Indie+Flower&family=Kalam&family=Shadows+Into+Light&family=Marck+Script&family=Just+Me+Again+Down+Here&family=Great+Vibes&family=Tangerine:wght@400;700&family=Cedarville+Cursive&family=Sacramento&family=Mr+De+Haviland&family=Reenie+Beanie&family=La+Belle+Aurore&family=Yellowtail&family=Alex+Brush&family=Allura&family=Pinyon+Script&family=Petit+Formal+Script&family=Bilbo&family=Lovers+Quarrel&family=Herr+Von+Muellerhoff&family=Mrs+Saint+Delafield&family=Meie+Script&family=Monsieur+La+Doulaise&family=Miss+Fajardose&family=Italianno&family=Meddon&family=Aguafina+Script&family=Niconne&family=Felipa&family=Jim+Nightshade&family=Yesteryear&family=Berkshire+Swash&family=Rouge+Script&family=Ruthie&family=Sail&family=Sofia&family=Qwigley&family=Dynalight&family=Diplomata+SC&family=Carattere&family=Birthstone&family=Sarina&family=Inspiration&family=Moon+Dance&family=Courgette&family=Oleo+Script&family=Playball&display=swap';
    document.head.appendChild(fontLink);

    // Add necessary styles
    GM_addStyle(`
        /* Import signature fonts - expanded with more formal/official document signing fonts */
        @import url('https://fonts.googleapis.com/css2?family=Homemade+Apple&family=Dancing+Script&family=Caveat&family=Pacifico&family=Satisfy&family=Indie+Flower&family=Kalam&family=Shadows+Into+Light&family=Marck+Script&family=Just+Me+Again+Down+Here&family=Great+Vibes&family=Tangerine:wght@400;700&family=Cedarville+Cursive&family=Sacramento&family=Mr+De+Haviland&family=Reenie+Beanie&family=La+Belle+Aurore&family=Yellowtail&family=Alex+Brush&family=Allura&family=Pinyon+Script&family=Petit+Formal+Script&family=Bilbo&family=Lovers+Quarrel&family=Herr+Von+Muellerhoff&family=Mrs+Saint+Delafield&family=Meie+Script&family=Monsieur+La+Doulaise&family=Miss+Fajardose&family=Italianno&family=Meddon&family=Aguafina+Script&family=Niconne&family=Felipa&family=Jim+Nightshade&family=Yesteryear&family=Berkshire+Swash&family=Rouge+Script&family=Ruthie&family=Sail&family=Sofia&family=Qwigley&family=Dynalight&family=Diplomata+SC&family=Carattere&family=Birthstone&family=Sarina&family=Inspiration&family=Moon+Dance&family=Courgette&family=Oleo+Script&family=Playball&display=swap');

        #attendance-btn {
            background-color: #3949ab;
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            border: none;
            margin-right: 10px;
            cursor: pointer;
            font-weight: bold;
        }

        #attendance-btn:hover {
            background-color: #1a237e;
        }

        #attendance-sheet-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.8);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
        }

        #attendance-sheet-content {
            background-color: white;
            padding: 20px;
            border-radius: 30px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            max-width: 95%;
            max-height: 90vh;
            overflow: auto;
            position: relative;
            width: 800px;
            font-family: Arial, sans-serif;
            font-size: 12px;
        }

        #sheet-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        #config-panel {
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
        }

        .config-row {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            align-items: center;
        }

        .config-row label {
            width: 150px;
            font-weight: bold;
        }

        .config-row input, .config-row select {
            flex: 1;
            padding: 5px;
            border-radius: 4px;
            border: 1px solid #ccc;
        }

        .signature-item {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            align-items: center;
        }

        .signature-item input, .signature-item select {
            padding: 5px;
            border-radius: 4px;
            border: 1px solid #ccc;
        }

        .signature-item button {
            background-color: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
        }

        #add-signature-btn {
            background-color: #4caf50;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            margin-top: 5px;
        }

        .attendance-btn {
            background-color: #3949ab;
            color: white;
            padding: 8px 15px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-weight: bold;
            margin-right: 10px;
        }

        .attendance-btn:hover {
            background-color: #1a237e;
        }

        #close-sheet-btn {
            background-color: #f44336;
        }

        #close-sheet-btn:hover {
            background-color: #d32f2f;
        }

        /* Styling to match the screenshots exactly with BOLD text */
        .sheet-header {
            margin-bottom: 10px;  /* Reduced from 20px */
        }

        .sheet-header h1 {
            font-size: 16px;  /* Reduced from 14px */
            margin: 0;
            font-weight: 900 !important;
            color: #000;
            text-align: left;
            -webkit-text-stroke: 0.3px black; /* Add stroke for extra boldness */
        }

        .sheet-header h2 {
            font-size: 16px;  /* Reduced from 13px */
            margin: 5px 0;
            font-weight: 800 !important;
            color: #000;
            text-align: left;
            -webkit-text-stroke: 0.2px black; /* Add stroke for extra boldness */
        }

        .sheet-header h3 {
            font-size: 18px;  /* Reduced from 16px */
            margin: 15px 0 10px 0;
            font-weight: 900 !important;
            color: #000;
            text-align: center;
            text-transform: uppercase;
            -webkit-text-stroke: 0.5px black; /* Add stroke for extra boldness */
        }

        .sheet-header h4 {
            font-size: 12px;  /* Reduced from 13px */
            margin: 5px 0;
            font-weight: 900 !important;  /* Increased from 800 to 900 */
            color: #000;
            text-align: left;
            -webkit-text-stroke: 0.3px black; /* Add stroke for extra boldness */
        }

        .header-flex {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }

        .sheet-header p {
            font-size: 14px;  /* Reduced from 11px */
            margin: 0;
            text-align: right;
            color: #000;
        }

        .attendance-table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 8px;  /* Reduced from 15px */
            table-layout: fixed;
        }

        .attendance-table th, .attendance-table td {
            border: 1px solid #000;
            padding: 5px 2px;
            text-align: center;
            vertical-align: middle;
            height: 22px;  /* Increased for better readability */
            font-size: 11px;  /* Increased from 11px for better readability */
            overflow: hidden;
        }

        .attendance-table th {
            font-weight: 800;  /* Increased from 800 */
            background-color: #fff;
        }

        .attendance-table th:nth-child(1) {
            width: 30px; /* Nr. column */
        }

        .attendance-table th:nth-child(2) {
            width: 25px; /* R column */
        }

        .attendance-table th:nth-child(3) {
            width: 75px; /* Student ID column */
        }

        .attendance-table th:nth-child(4) {
            width: 140px; /* Name column */
        }

        /* Increase width of date columns to prevent overlap */
        .attendance-table th:nth-child(5),
        .attendance-table th:nth-child(6),
        .attendance-table th:nth-child(7),
        .attendance-table th:nth-child(8),
        .attendance-table th:nth-child(9) {
            width: 70px; /* Date columns - wider to prevent overlap */
        }

        .attendance-table th:nth-child(10) {
            width: 25px; /* Ex column */
        }

        .attendance-table td {
            background-color: #fff;
        }

        .attendance-table .name-cell {
            text-align: left;
            padding-left: 10px;
            font-weight: normal;
            font-size: 11px;  /* Added explicit size */
        }

        .attendance-table .id-cell {
            text-align: left;
            padding-left: 10px;
            font-weight: normal;
            font-size: 11px;  /* Added explicit size */
        }

        /* Student signature styling - darker blue, more signature-like */
        .student-signature {
            font-size: 14px; /* Increased from 9px */
            color: #00008B; /* Dark blue */
            font-weight: 400;
            white-space: nowrap;
            overflow: hidden;
        }

        /* Checkmark styling */
        .student-checkmark {
            font-size: 12px; /* Increased from 12px */
            color: #00008B; /* Dark blue */
            font-weight: bold;
        }

        /* Define all font classes - with formal document signing fonts added */
        .font-homemade-apple { font-family: 'Homemade Apple', cursive; }
        .font-dancing-script { font-family: 'Dancing Script', cursive; }
        .font-caveat { font-family: 'Caveat', cursive; }
        .font-pacifico { font-family: 'Pacifico', cursive; }
        .font-satisfy { font-family: 'Satisfy', cursive; }
        .font-indie-flower { font-family: 'Indie Flower', cursive; }
        .font-kalam { font-family: 'Kalam', cursive; }
        .font-shadows-into-light { font-family: 'Shadows Into Light', cursive; }
        .font-marck-script { font-family: 'Marck Script', cursive; }
        .font-just-me { font-family: 'Just Me Again Down Here', cursive; }
        .font-great-vibes { font-family: 'Great Vibes', cursive; }
        .font-tangerine { font-family: 'Tangerine', cursive; }
        .font-cedarville { font-family: 'Cedarville Cursive', cursive; }
        .font-sacramento { font-family: 'Sacramento', cursive; }
        .font-mr-dehaviland { font-family: 'Mr De Haviland', cursive; }
        .font-reenie-beanie { font-family: 'Reenie Beanie', cursive; }
        .font-belle-aurore { font-family: 'La Belle Aurore', cursive; }
        .font-yellowtail { font-family: 'Yellowtail', cursive; }
        .font-alex-brush { font-family: 'Alex Brush', cursive; }
        .font-allura { font-family: 'Allura', cursive; }
        .font-pinyon-script { font-family: 'Pinyon Script', cursive; }
        .font-petit-formal { font-family: 'Petit Formal Script', cursive; }
        .font-bilbo { font-family: 'Bilbo', cursive; }
        .font-lovers-quarrel { font-family: 'Lovers Quarrel', cursive; }
        .font-herr-von-muellerhoff { font-family: 'Herr Von Muellerhoff', cursive; }
        .font-mrs-saint-delafield { font-family: 'Mrs Saint Delafield', cursive; }
        .font-meie-script { font-family: 'Meie Script', cursive; }
        .font-monsieur-la-doulaise { font-family: 'Monsieur La Doulaise', cursive; }
        .font-miss-fajardose { font-family: 'Miss Fajardose', cursive; }
        .font-italianno { font-family: 'Italianno', cursive; }
        .font-meddon { font-family: 'Meddon', cursive; }
        .font-aguafina { font-family: 'Aguafina Script', cursive; }
        /* Official/Formal Document Signing Fonts */
        .font-niconne { font-family: 'Niconne', cursive; }
        .font-felipa { font-family: 'Felipa', cursive; }
        .font-jim-nightshade { font-family: 'Jim Nightshade', cursive; }
        .font-yesteryear { font-family: 'Yesteryear', cursive; }
        .font-berkshire-swash { font-family: 'Berkshire Swash', cursive; }
        .font-rouge-script { font-family: 'Rouge Script', cursive; }
        .font-ruthie { font-family: 'Ruthie', cursive; }
        .font-sail { font-family: 'Sail', cursive; }
        .font-sofia { font-family: 'Sofia', cursive; }
        .font-qwigley { font-family: 'Qwigley', cursive; }
        .font-dynalight { font-family: 'Dynalight', cursive; }
        .font-diplomata-sc { font-family: 'Diplomata SC', cursive; }
        .font-carattere { font-family: 'Carattere', cursive; }
        .font-birthstone { font-family: 'Birthstone', cursive; }
        .font-sarina { font-family: 'Sarina', cursive; }
        .font-inspiration { font-family: 'Inspiration', cursive; }
        .font-moon-dance { font-family: 'Moon Dance', cursive; }
        .font-courgette { font-family: 'Courgette', cursive; }
        .font-oleo-script { font-family: 'Oleo Script', cursive; }
        .font-playball { font-family: 'Playball', cursive; }

        .footer-note {
            margin-top: 12px;  /* Reduced from 15px */
            font-size: 10px;  /* Reduced from 11px */
            color: #000;
            text-align: left;
        }

        .footer-note p {
            margin: 2px 0;  /* Reduced from 3px */
        }

        .footer-note p:first-child {
            font-weight: 900;
        }

        .signature-line {
            margin-top: 15px;  /* Reduced from 20px */
            font-size: 14px;  /* Reduced from 13px */
            text-align: right;
            color: #000;
        }

        .signature-line p {
            margin: 2px 0;  /* Reduced from 3px */
            font-weight: normal;
        }

        .signature-line p:first-child {
            font-weight: 800;
            font-size: 13px;  /* Reduced from 14px */
        }

        .signature-line p:last-child {
            font-style: italic;
        }

        .page-number {
            text-align: center;
            font-size: 9px;  /* Reduced from 10px */
            margin-top: 15px;  /* Reduced from 20px */
            color: #666;
            font-style: italic;
        }

        /* Completely revised print styles to fix overlapping issues */
        /* Completely revised print styles with better margins and centering */
        @media print {
            @page {
                size: A4 portrait;
                margin: 0.8cm;  /* Reduced from 1cm */
            }

            html, body {
                width: 100%;
                height: 100%;
                margin: 0;
                padding: 0;
            }

            body * {
                visibility: hidden;
            }

            #attendance-sheet-container {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                margin: 0;
                padding: 0;
                overflow: visible;
                background-color: white;
            }

            #attendance-sheet-content {
                position: absolute;
                left: 50%;
                top: 0;
                transform: translateX(-50%); /* Center the content */
                width: calc(100% - 1.6cm); /* Account for margins */
                max-width: 190mm; /* Increased from 180mm */
                background-color: white;
                box-shadow: none;
                padding: 0;
                margin: 0 auto;
                border-radius: 0;
                overflow: visible;
                visibility: visible;
            }

            #attendance-sheet-content * {
                visibility: visible;
            }

            #sheet-controls, #config-panel {
                display: none !important;
            }

            .attendance-table {
                width: 100%;
                page-break-inside: auto;
                table-layout: fixed;
            }

            /* Ensure date columns don't overlap in print */
            .attendance-table th:nth-child(5),
            .attendance-table th:nth-child(6),
            .attendance-table th:nth-child(7),
            .attendance-table th:nth-child(8),
            .attendance-table th:nth-child(9) {
                width: 70px; /* Fixed width for date columns */
                overflow: hidden;
                white-space: nowrap;
            }

            .attendance-table tr {
                page-break-inside: avoid;
                page-break-after: auto;
            }

            .attendance-table thead {
                display: table-header-group;
            }

            .footer-note, .signature-line {
                page-break-inside: avoid;
            }

            /* Set explicit min-height to prevent extra page breaks */
            #attendance-sheet-content {
                min-height: auto;
                page-break-after: avoid;
            }

            .page-number {
                display: none; /* Remove page number */
            }
        }
    `);

    // Improved logic to detect students with R or Ex labels (with careful name handling)
    function hasRLabel(studentNameCell, row) {
        // Check for label element
        if (studentNameCell.querySelector('.label-warning') !== null) return true;

        // Check for data attribute
        if (row.querySelector('td[data-repeated="R"]') !== null) return true;

        // Check for specific R indicators in text without affecting names
        const text = studentNameCell.textContent.trim();
        return text.includes(' R ') || text.endsWith(' R') || text.includes('(R)');
    }

    function hasExLabel(studentNameCell, row) {
        // Check for label element
        if (studentNameCell.querySelector('.label-info') !== null) return true;

        // Check for data attribute
        if (row.querySelector('td[data-exempted="EX"]') !== null) return true;

        // Check for specific EX indicators in text
        const text = studentNameCell.textContent.trim();
        return text.includes(' EX ') || text.endsWith(' EX') || text.includes('(EX)');
    }

    // Add button to action bar
    function addAttendanceButton() {
        const actionBar = document.querySelector('.record_actions');
        if (!actionBar) return;

        const button = document.createElement('button');
        button.id = 'attendance-btn';
        button.innerHTML = '<i class="fa fa-table"></i> Generate Attendance Sheet';
        button.onclick = generateAttendanceSheet;

        actionBar.insertBefore(button, actionBar.firstChild);
    }

    // Enhanced function to extract attendance data handling both editable and locked cases
    function extractAttendanceData() {
        const data = {
            courseTitle: '',
            date: '',
            students: [],
            attendance: {},
            totalHours: 0,
            username: '',
            studentFonts: {} // Store random fonts per student
        };

        // Get username from page
        const usernameElement = document.querySelector('.username');
        if (usernameElement) {
            data.username = usernameElement.textContent.trim();
        }

        // Get course details
        data.courseTitle = document.querySelector('.course h4')?.textContent?.trim() || 'Attendance Sheet';

        // Get date from the form - specifically from the requested HTML element
        const dateElements = document.querySelectorAll('.attendance-details li');
        let dateFound = false;

        for (const li of dateElements) {
            const labelElem = li.querySelector('.label-cont');
            if (labelElem && labelElem.textContent.trim() === 'Date') {
                const dateSpan = li.querySelector('.text-cont');
                if (dateSpan) {
                    // Store the original date string
                    const dateText = dateSpan.textContent.trim();
                    data.date = dateText;
                    dateFound = true;

                    // Parse the date for formatting
                    try {
                        // Handle various date formats
                        let year, month, day;

                        // Try YYYY-MM-DD format
                        const ymdMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
                        if (ymdMatch) {
                            year = ymdMatch[1];
                            month = ymdMatch[2];
                            day = ymdMatch[3];
                        }
                        // Try DD.MM.YYYY format
                        else {
                            const dmyMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
                            if (dmyMatch) {
                                day = dmyMatch[1];
                                month = dmyMatch[2];
                                year = dmyMatch[3];
                            }
                        }

                        if (year && month && day) {
                            data.formattedDate = `${day}.${month}.${year}`;
                            data.isoDate = `${year}-${month}-${day}`;
                        } else {
                            // Default to the original text if not in expected format
                            data.formattedDate = dateText;
                            data.isoDate = dateText;
                        }
                    } catch (e) {
                        console.error("Date parsing error:", e);
                        data.formattedDate = dateText;
                        data.isoDate = new Date().toISOString().split('T')[0];
                    }
                    break;
                }
            }
        }

        if (!dateFound) {
            // Default to current date
            const now = new Date();
            const year = now.getFullYear();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');

            data.date = `${year}-${month}-${day}`;
            data.formattedDate = `${day}.${month}.${year}`;
            data.isoDate = `${year}-${month}-${day}`;
        }

        // Get total hours for the session
        const hoursElements = document.querySelectorAll('.attendance-details li');
        let hoursFound = false;

        for (const li of hoursElements) {
            const labelElem = li.querySelector('.label-cont');
            if (labelElem && (labelElem.textContent.trim() === 'Nr. of Hours' || labelElem.textContent.trim() === 'Num. of Hours')) {
                const hoursSpan = li.querySelector('.text-cont');
                if (hoursSpan) {
                    const hoursText = hoursSpan.textContent.trim();
                    const hoursMatch = parseInt(hoursText);
                    if (!isNaN(hoursMatch)) {
                        data.totalHours = hoursMatch;
                        hoursFound = true;
                    }
                }
            }
        }

        if (!hoursFound) {
            // Try the standard method as fallback
            const hoursElement = document.querySelector('.attendance-details li:nth-child(5) .text-cont');
            if (hoursElement) {
                const hoursText = hoursElement.textContent.trim();
                const hoursMatch = parseInt(hoursText);
                if (!isNaN(hoursMatch)) {
                    data.totalHours = hoursMatch;
                } else {
                    data.totalHours = 1; // Default to 1 if not found
                }
            } else {
                data.totalHours = 1; // Default to 1 if not found
            }
        }

        // Array of available font classes for random assignment
        const fontClasses = [
            'font-great-vibes',
            'font-tangerine',
            'font-mr-dehaviland',
            'font-pinyon-script',
            'font-alex-brush',
            'font-allura',
            'font-herr-von-muellerhoff',
            'font-mrs-saint-delafield',
            'font-monsieur-la-doulaise',
            'font-dancing-script',
            'font-pacifico',
            'font-satisfy',
            'font-sacramento',
            'font-yellowtail',
            'font-petit-formal',
            'font-lovers-quarrel',
            'font-miss-fajardose',
            'font-italianno',
            'font-aguafina',
            'font-homemade-apple',
            'font-caveat',
            'font-indie-flower',
            'font-kalam',
            'font-shadows-into-light',
            'font-marck-script',
            'font-just-me',
            'font-cedarville',
            'font-reenie-beanie',
            'font-belle-aurore',
            'font-bilbo',
            'font-meie-script',
            'font-meddon'
        ];

        // Extract student data and attendance with comprehensive handling for various cases
        const rows = document.querySelectorAll('#student_list_table tbody tr');
        rows.forEach((row, index) => {
            const studentId = row.querySelector('td:nth-child(2)')?.textContent?.trim();
            const studentNameCell = row.querySelector('td:nth-child(3)');

            if (!studentId || !studentNameCell) return;

            const studentName = studentNameCell.textContent.trim();

            // Filter out label indicators like R or EX from the name
            const cleanName = studentName.replace(/\s+R\s+EX|\s+EX|\s+R|\s+\(R\)|\s+\(EX\)/g, "").trim();

            // Check for actual R and Ex labels in the student name or specific cells
            const hasRLbl = hasRLabel(studentNameCell, row);
            const hasExLbl = hasExLabel(studentNameCell, row);

            if (cleanName) {
                // Assign a random font to this student
                data.studentFonts[studentId] = fontClasses[Math.floor(Math.random() * fontClasses.length)];

                // Add to students array
                data.students.push({
                    id: studentId,
                    name: cleanName,
                    repeated: hasRLbl,
                    exempt: hasExLbl,
                    index: index + 1, // 1-based index for display
                    fontClass: data.studentFonts[studentId] // Store the assigned font
                });

                // Initialize student hours attendance
                data.attendance[studentId] = Array(data.totalHours).fill(false);

                // Get attendance checks - using the original working implementation
                const checkElements = row.querySelectorAll('.checkboxes_row_td input[type="checkbox"], .checkboxes.pull-left, input.checkboxes');

                // If no checkboxes found, try to find hidden inputs that might contain check state
                if (checkElements.length === 0 || checkElements.length < data.totalHours) {
                    const hiddenCheckedInput = row.querySelector('input[name^="stdabsences"][name$="[checked]"]');
                    if (hiddenCheckedInput) {
                        const checkedValues = hiddenCheckedInput.value.split(',');
                        checkedValues.forEach(val => {
                            const hourIndex = parseInt(val) - 1;
                            if (!isNaN(hourIndex) && hourIndex >= 0 && hourIndex < data.totalHours) {
                                data.attendance[studentId][hourIndex] = true;
                            }
                        });
                    } else {
                        // If no hidden inputs found, check for Font Awesome icons (view mode)
                        const attendanceCells = Array.from(row.querySelectorAll('td')).slice(4);

                        for (let i = 0; i < data.totalHours && i < attendanceCells.length; i++) {
                            const cell = attendanceCells[i];

                            // Check for FA check icons
                            if (cell.querySelector('.fa-check-square-o') ||
                                cell.querySelector('.fa-check-square') ||
                                cell.querySelector('.fa-check')) {
                                data.attendance[studentId][i] = true;
                                continue;
                            }

                            // Check for text content that indicates attendance
                            const cellText = cell.textContent.trim();
                            if (cellText === '✓' || cellText === '✔' || cellText === 'P' ||
                                cellText === 'Present' || cellText !== '') {
                                data.attendance[studentId][i] = true;
                            }
                        }
                    }
                } else {
                    // Process each hour checkbox
                    // Determine if the first checkbox is a "select all" checkbox
                    const startIndex = checkElements.length > data.totalHours ? 1 : 0;

                    for (let i = 0; i < data.totalHours; i++) {
                        const checkIndex = startIndex + i;
                        if (checkElements[checkIndex] &&
                            (checkElements[checkIndex].checked ||
                             checkElements[checkIndex].classList.contains('fa-check-square-o'))) {
                            // Mark this hour as attended
                            data.attendance[studentId][i] = true;
                        }
                    }
                }
            }
        });

        return data;
    }

    // Update all date columns with a single value
    function updateAllDates(dateString) {
        // Update all date column headers
        const dateColumns = document.querySelectorAll('.date-column');
        dateColumns.forEach(column => {
            if (dateString) {
                const parts = dateString.split('-');
                if (parts.length === 3) {
                    column.textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
            } else {
                column.textContent = '__/__/2025';
            }
        });
    }

    // Generate and display the attendance sheet
    function generateAttendanceSheet() {
        // Extract data
        const data = extractAttendanceData();
        if (!data || data.students.length === 0) {
            alert('No attendance data found. Please ensure you are on an attendance page.');
            return;
        }

        // For debugging only
        console.log("Extracted attendance data:", data);

        // Create container
        const container = document.createElement('div');
        container.id = 'attendance-sheet-container';

        // Create content div
        const content = document.createElement('div');
        content.id = 'attendance-sheet-content';

        // Add controls
        const controls = document.createElement('div');
        controls.id = 'sheet-controls';
        controls.innerHTML = `
            <div>
                <button id="print-sheet-btn" class="attendance-btn">
                    <i class="fa fa-print"></i> Print
                </button>
                <button id="save-sheet-btn" class="attendance-btn">
                    <i class="fa fa-download"></i> Save as PDF
                </button>
            </div>
            <button id="close-sheet-btn" class="attendance-btn">
                <i class="fa fa-times"></i> Close
            </button>
        `;

        // Add configuration panel with font selection
        const configPanel = document.createElement('div');
        configPanel.id = 'config-panel';

        // Define available signature fonts with new formal document signing fonts
        const signatureFonts = [
            { name: 'Random (Per Student)', value: 'random' },
            // Formal Document Signing Fonts (Adobe-style)
            { name: 'Pinyon Script (Formal)', value: 'font-pinyon-script' },
            { name: 'Petit Formal Script', value: 'font-petit-formal' },
            { name: 'Diplomata SC (Formal)', value: 'font-diplomata-sc' },
            { name: 'Carattere (Formal)', value: 'font-carattere' },
            { name: 'Rouge Script (Formal)', value: 'font-rouge-script' },
            { name: 'Oleo Script (Formal)', value: 'font-oleo-script' },
            { name: 'Berkshire Swash (Formal)', value: 'font-berkshire-swash' },
            { name: 'Playball (Formal)', value: 'font-playball' },
            { name: 'Courgette (Formal)', value: 'font-courgette' },
            { name: 'Yesteryear (Formal)', value: 'font-yesteryear' },
            // Elegant/Curly Signature Fonts
            { name: 'Great Vibes', value: 'font-great-vibes' },
            { name: 'Tangerine', value: 'font-tangerine' },
            { name: 'Mr De Haviland', value: 'font-mr-dehaviland' },
            { name: 'Alex Brush', value: 'font-alex-brush' },
            { name: 'Allura', value: 'font-allura' },
            { name: 'Herr Von Muellerhoff', value: 'font-herr-von-muellerhoff' },
            { name: 'Mrs Saint Delafield', value: 'font-mrs-saint-delafield' },
            { name: 'Monsieur La Doulaise', value: 'font-monsieur-la-doulaise' },
            { name: 'Dancing Script', value: 'font-dancing-script' },
            { name: 'Pacifico', value: 'font-pacifico' },
            { name: 'Satisfy', value: 'font-satisfy' },
            { name: 'Sacramento', value: 'font-sacramento' },
            { name: 'Yellowtail', value: 'font-yellowtail' },
            { name: 'Lovers Quarrel', value: 'font-lovers-quarrel' },
            { name: 'Miss Fajardose', value: 'font-miss-fajardose' },
            { name: 'Italianno', value: 'font-italianno' },
            // More casual handwriting fonts
            { name: 'Homemade Apple', value: 'font-homemade-apple' },
            { name: 'Caveat', value: 'font-caveat' },
            { name: 'Indie Flower', value: 'font-indie-flower' },
            { name: 'Kalam', value: 'font-kalam' },
            { name: 'Shadows Into Light', value: 'font-shadows-into-light' },
            { name: 'Marck Script', value: 'font-marck-script' },
            { name: 'Just Me Again Down Here', value: 'font-just-me' },
            { name: 'Cedarville Cursive', value: 'font-cedarville' },
            { name: 'Reenie Beanie', value: 'font-reenie-beanie' },
            { name: 'La Belle Aurore', value: 'font-belle-aurore' },
            { name: 'Bilbo', value: 'font-bilbo' },
            { name: 'Meie Script', value: 'font-meie-script' },
            { name: 'Meddon', value: 'font-meddon' },
            { name: 'Aguafina Script', value: 'font-aguafina' }
        ];

        // Generate font options HTML
        let fontOptionsHtml = '';
        signatureFonts.forEach(font => {
            fontOptionsHtml += `<option value="${font.value}">${font.name}</option>`;
        });

        // Create date inputs for column headers
        let dateInputsHtml = '';

        // Add a single date input for all columns
        dateInputsHtml = `
            <div class="config-row">
                <label>Set all dates at once:</label>
                <input type="date" id="all-dates-input" value="${data.isoDate || ''}" class="date-input">
            </div>
        `;

        // Add individual date inputs
        for (let i = 0; i < data.totalHours; i++) {
            dateInputsHtml += `
                <div class="config-row">
                    <label>Date for column ${i+1}:</label>
                    <input type="date" id="date-column-${i}" value="${data.isoDate || ''}" class="single-date-input">
                </div>
            `;
        }

        // Generate config panel HTML with signature font dropdown and use checkmarks option
        configPanel.innerHTML = `
            <h3 style="margin-top: 0;">Configuration</h3>
            <div class="config-row">
                <label>Signature Display:</label>
                <select id="signature-display-select">
                    <option value="checkmarks" selected>Checkmarks (✓)</option>
                    <option value="names">Student Names</option>
                </select>
            </div>
            <div class="config-row">
                <label>Signature Font:</label>
                <select id="signature-font-select">
                    ${fontOptionsHtml}
                </select>
            </div>
            <div class="config-row">
                <label>Print Date:</label>
                <input type="date" id="printed-date-input" value="${formatDate(new Date(), 'iso')}" class="date-input">
            </div>
            ${dateInputsHtml}
            <div id="signatures-container">
                <h4 style="margin-top: 10px;">Signatures</h4>
                <div class="signature-item" id="signature-item-1">
                    <select id="signature-title-1">
                        <option value="Professor">Professor</option>
                        <option value="Assistant Professor">Assistant Professor</option>
                        <option value="Lecturer">Lecturer</option>
                        <option value="Assistant Lecturer" selected>Assistant Lecturer</option>
                    </select>
                    <input type="text" id="signature-name-1" value="${data.username}" style="flex: 1;">
                    <button class="remove-signature-btn" data-id="1" style="visibility: hidden;">Remove</button>
                </div>
            </div>
            <button id="add-signature-btn">Add Another Signature</button>
        `;

        // Create header - exactly matching the template with subject and date on same row
        const header = document.createElement('div');
        header.className = 'sheet-header';

        // Institution details
        header.innerHTML = `
            <h1>Epoka University</h1>
            <h2>Faculty of Architecture and Engineering</h2>
            <h3>ATTENDANCE LIST</h3>
            <div class="header-flex">
                <h4>${data.courseTitle}</h4>
                <p id="printed-date-display">Printed on: ${formatDate(new Date())}</p>
            </div>
        `;

        // Create table
        const table = document.createElement('table');
        table.className = 'attendance-table';

        // Create table header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        // Add header cells - EXACTLY matching the template
        let headerCells = `
            <th>Nr.</th>
            <th>R</th>
            <th>Student ID</th>
            <th>Name Surname</th>
        `;

        // Add date columns based on totalHours
        for (let i = 0; i < 5; i++) {
            if (i < data.totalHours) {
                headerCells += `<th class="date-column" data-index="${i}">__/__/2025</th>`;
            } else {
                headerCells += `<th class="date-column">__/__/2025</th>`;
            }
        }

        headerCells += `<th>Ex</th>`;
        headerRow.innerHTML = headerCells;

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create table body
        const tbody = document.createElement('tbody');

        // Add rows for each student
        data.students.forEach(student => {
            const row = document.createElement('tr');

            // Student number
            const numCell = document.createElement('td');
            numCell.textContent = student.index;
            row.appendChild(numCell);

            // Repeated indicator (R column)
            const repeatedCell = document.createElement('td');
            repeatedCell.textContent = student.repeated ? 'R' : '';
            row.appendChild(repeatedCell);

            // Student ID
            const idCell = document.createElement('td');
            idCell.className = 'id-cell';
            idCell.textContent = student.id;
            row.appendChild(idCell);

            // Student name
            const nameCell = document.createElement('td');
            nameCell.className = 'name-cell';
            nameCell.textContent = student.name;
            row.appendChild(nameCell);

            // Date columns (5 of them)
            // Distribute student signatures or checkmarks across columns - one column per hour
            const studentAttendance = data.attendance[student.id] || [];

            for (let i = 0; i < 5; i++) {
                const dateCell = document.createElement('td');

                // Check if we need to place a signature in this column
                // and only if the student is not exempt
                if (i < studentAttendance.length && !student.exempt && studentAttendance[i]) {
                    // Get the display mode (names or checkmarks)
                    const displayMode = document.querySelector('#signature-display-select')?.value || 'checkmarks';

                    if (displayMode === 'checkmarks') {
                        // Show checkmark
                        dateCell.innerHTML = `<span class="student-checkmark">✓</span>`;
                    } else {
                        // Extract first name for shorter signature
                        const firstName = student.name.split(' ')[0];

                        // Use the student's assigned font (for consistent random per student)
                        // or use the selected font if not random
                        const selectedFontClass = document.querySelector('#signature-font-select')?.value || 'random';
                        let fontClass = selectedFontClass;

                        // If random, use the student's assigned font
                        if (selectedFontClass === 'random') {
                            fontClass = student.fontClass || data.studentFonts[student.id] || 'font-dancing-script';
                        }

                        dateCell.innerHTML = `<span class="student-signature ${fontClass}">${firstName}</span>`;
                    }

                    // Add a hidden input to track attendance for EIS compatibility
                    dateCell.innerHTML += `<input type="hidden" name="stdabsences[${i}][checked]" value="${i+1}">`;
                }

                row.appendChild(dateCell);
            }

            // Exempted indicator (Ex column)
            const exemptCell = document.createElement('td');
            exemptCell.textContent = student.exempt ? 'Ex' : '';
            row.appendChild(exemptCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);

        // Add note at bottom - EXACTLY matching the template with BOLD text
        const note = document.createElement('div');
        note.className = 'footer-note';
        note.innerHTML = `
            <p><strong>NOTE:</strong></p>
            <p>Students that are not listed in the attendance list will not be considered as enrolled in the course!</p>
            <p>All attendance sheets should be delivered to department coordinators by the end of the week after recording</p>
            <p>the entries electronically through EIS system.</p>
            <p><strong>R</strong> - Repeated Course, <strong>Ex</strong> - Exempted from attendances.</p>
        `;

        // Add signature line at bottom - with bolder text and italic for "Signature"
        const signature = document.createElement('div');
        signature.className = 'signature-line';
        signature.id = 'signature-area';
        signature.innerHTML = `
            <p>Assistant Lecturer ${data.username}</p>
            <p><i>(Signature)</i></p>
        `;

        // Add page number with automatic page counting - REMOVED
        // const pageNumber = document.createElement('div');
        // pageNumber.className = 'page-number';
        // We leave this empty because the content will be added via CSS counter
        // This enables proper page numbering for multi-page documents

        // Assemble content
        content.appendChild(controls);
        content.appendChild(configPanel);
        content.appendChild(header);
        content.appendChild(table);
        content.appendChild(note);
        content.appendChild(signature);
        // Page number removed as requested
        container.appendChild(content);
        document.body.appendChild(container);

        // Add event listeners for signature display mode and font select
        document.getElementById('signature-display-select').addEventListener('change', function() {
            // Update all attendance markers based on display mode
            const displayMode = this.value;
            const signatures = document.querySelectorAll('.student-signature, .student-checkmark');

            // Remove all elements first
            signatures.forEach(sig => sig.remove());

            // Rebuild all attendance markers based on the new display mode
            if (displayMode === 'checkmarks') {
                // Replace all signatures with checkmarks
                document.querySelectorAll('td').forEach(cell => {
                    if (cell.querySelector('input[type="hidden"]')) {
                        // This cell has attendance, add checkmark at beginning
                        const checkmark = document.createElement('span');
                        checkmark.className = 'student-checkmark';
                        checkmark.textContent = '✓';
                        cell.insertBefore(checkmark, cell.firstChild);
                    }
                });
            } else {
                // Replace all checkmarks with signatures
                document.querySelectorAll('td').forEach(cell => {
                    if (cell.querySelector('input[type="hidden"]')) {
                        // This cell has attendance, add signature
                        const rowElement = cell.closest('tr');
                        const studentId = rowElement.querySelector('td:nth-child(3)')?.textContent?.trim();
                        const studentName = rowElement.querySelector('.name-cell')?.textContent?.trim() || '';

                        if (studentName) {
                            const firstName = studentName.split(' ')[0];

                            // Get the student's data to use consistent font
                            const studentData = data.students.find(s => s.id === studentId);

                            // Use selected font or student's assigned font if random
                            const selectedFontClass = document.querySelector('#signature-font-select')?.value || 'random';
                            let fontClass = selectedFontClass;

                            if (selectedFontClass === 'random' && studentData) {
                                fontClass = studentData.fontClass || data.studentFonts[studentId] || 'font-dancing-script';
                            }

                            const signature = document.createElement('span');
                            signature.className = `student-signature ${fontClass}`;
                            signature.textContent = firstName;
                            cell.insertBefore(signature, cell.firstChild);
                        }
                    }
                });
            }
        });

        document.getElementById('signature-font-select').addEventListener('change', function() {
            // Only update if in names mode
            if (document.getElementById('signature-display-select').value === 'names') {
                // Update all signatures with the new font
                const selectedFontClass = this.value;
                const signatures = document.querySelectorAll('.student-signature');

                signatures.forEach(sig => {
                    // Get the student ID to apply font consistently
                    const rowElement = sig.closest('tr');
                    const studentId = rowElement?.querySelector('td:nth-child(3)')?.textContent?.trim();

                    // Remove all existing font classes
                    sig.className = 'student-signature';

                    // If random, use student's assigned font
                    if (selectedFontClass === 'random') {
                        const studentData = data.students.find(s => s.id === studentId);
                        if (studentData && studentData.fontClass) {
                            sig.classList.add(studentData.fontClass);
                        } else if (data.studentFonts[studentId]) {
                            sig.classList.add(data.studentFonts[studentId]);
                        } else {
                            // Fallback if no font assigned
                            sig.classList.add('font-dancing-script');
                        }
                    } else {
                        // Otherwise apply the selected font to all
                        sig.classList.add(selectedFontClass);
                    }
                });
            }
        });

        // Update the printed date when changed
        document.getElementById('printed-date-input').addEventListener('change', function() {
            const dateValue = this.value; // YYYY-MM-DD
            if (dateValue) {
                const date = new Date(dateValue);
                if (!isNaN(date.getTime())) {
                    document.getElementById('printed-date-display').textContent = `Printed on: ${formatDate(date)}`;
                }
            }
        });

        // Set the signature font dropdown to random by default
        document.getElementById('signature-font-select').value = 'random';

        // Ensure INITIAL UI state matches settings
        setTimeout(() => {
            // Initialize display mode to checkmarks
            document.getElementById('signature-display-select').dispatchEvent(new Event('change'));

            // Make sure date headers are normal weight
            document.querySelectorAll('.date-column').forEach(col => {
                col.style.fontWeight = 'normal';
            });
        }, 100);

        // Add event listeners to buttons
        document.getElementById('print-sheet-btn').addEventListener('click', () => {
            window.print();
        });

        document.getElementById('save-sheet-btn').addEventListener('click', () => {
            window.print();
        });

        document.getElementById('close-sheet-btn').addEventListener('click', () => {
            document.body.removeChild(container);
        });

        // Add event listener for the "Set all dates at once" input
        document.getElementById('all-dates-input').addEventListener('change', function() {
            const dateValue = this.value;

            // Update all individual date inputs
            document.querySelectorAll('.single-date-input').forEach(input => {
                input.value = dateValue;
            });

            // Update all date columns in the table
            updateAllDates(dateValue);
        });

        // Add event listener for adding signatures
        let signatureCounter = 1;
        document.getElementById('add-signature-btn').addEventListener('click', () => {
            signatureCounter++;

            const signaturesContainer = document.getElementById('signatures-container');

            const signatureItem = document.createElement('div');
            signatureItem.className = 'signature-item';
            signatureItem.id = `signature-item-${signatureCounter}`;

            signatureItem.innerHTML = `
                <select id="signature-title-${signatureCounter}">
                    <option value="Professor">Professor</option>
                    <option value="Assistant Professor">Assistant Professor</option>
                    <option value="Lecturer">Lecturer</option>
                    <option value="Assistant Lecturer" selected>Assistant Lecturer</option>
                </select>
                <input type="text" id="signature-name-${signatureCounter}" value="" style="flex: 1;">
                <button class="remove-signature-btn" data-id="${signatureCounter}">Remove</button>
            `;

            signaturesContainer.appendChild(signatureItem);

            // Make remove button visible for first signature
            document.querySelector('#signature-item-1 .remove-signature-btn').style.visibility = 'visible';

            // Add event listener for remove button
            signatureItem.querySelector('.remove-signature-btn').addEventListener('click', function() {
                const id = this.getAttribute('data-id');
                const item = document.getElementById(`signature-item-${id}`);
                item.parentNode.removeChild(item);

                // If only one signature left, hide its remove button
                const signatures = document.querySelectorAll('.signature-item');
                if (signatures.length === 1) {
                    signatures[0].querySelector('.remove-signature-btn').style.visibility = 'hidden';
                }

                // Update signatures in sheet
                updateSignatures();
            });

            // Add event listeners for signature fields
            signatureItem.querySelector('select').addEventListener('change', updateSignatures);
            signatureItem.querySelector('input').addEventListener('change', updateSignatures);
            signatureItem.querySelector('input').addEventListener('input', updateSignatures);

            // Update signatures in sheet
            updateSignatures();
        });

        // Add event listeners for remove buttons
        document.querySelectorAll('.remove-signature-btn').forEach(button => {
            button.addEventListener('click', function() {
                const id = this.getAttribute('data-id');
                const item = document.getElementById(`signature-item-${id}`);
                item.parentNode.removeChild(item);

                // If only one signature left, hide its remove button
                const signatures = document.querySelectorAll('.signature-item');
                if (signatures.length === 1) {
                    signatures[0].querySelector('.remove-signature-btn').style.visibility = 'hidden';
                }

                // Update signatures in sheet
                updateSignatures();
            });
        });

        // Add event listeners for individual date inputs
        document.querySelectorAll('.single-date-input').forEach(input => {
            input.addEventListener('change', function() {
                const index = this.id.split('-')[2];
                const dateColumn = document.querySelector(`.date-column[data-index="${index}"]`);
                if (dateColumn) {
                    const dateValue = this.value; // YYYY-MM-DD
                    if (dateValue) {
                        const parts = dateValue.split('-');
                        if (parts.length === 3) {
                            dateColumn.textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                        }
                    } else {
                        dateColumn.textContent = '__/__/2025';
                    }
                }
            });
        });

        // Add event listeners for signature inputs
        document.querySelectorAll('#signatures-container select, #signatures-container input').forEach(input => {
            input.addEventListener('change', updateSignatures);
            input.addEventListener('input', updateSignatures); // Also listen for real-time input changes
        });

        // Set initial dates
        if (data.isoDate) {
            updateAllDates(data.isoDate);
        }

        // Function to update signatures in the sheet
        function updateSignatures() {
            const signatureItems = document.querySelectorAll('.signature-item');
            const signatureArea = document.getElementById('signature-area');

            let signaturesHtml = '';
            signatureItems.forEach(item => {
                const id = item.id.split('-')[2];
                const title = document.getElementById(`signature-title-${id}`).value;
                const name = document.getElementById(`signature-name-${id}`).value;

                signaturesHtml += `<p>${title} ${name}</p><p>(Signature)</p>`;
            });

            signatureArea.innerHTML = signaturesHtml;
        }
    }

    // Format date as DD.MM.YYYY or ISO format
    function formatDate(date, format = 'regular') {
        if (format === 'iso') {
            return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
        }
        return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
    }

    // Initialize the script
    function init() {
        // Add button to the page
        addAttendanceButton();
    }

    // Run the script
    init();
})();