// ==UserScript==
// @name         EIS Attendance Sheet Generator
// @namespace    https://bredliplaku.com/
// @version      1.5
// @description  Generates attendance sheet that perfectly matches the original template with customizable fields
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/editcl
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/attendance/extensions/form_generator.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/attendance/extensions/form_generator.user.js
// @grant        GM_addStyle
// ==/UserScript==

(function () {
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

        #attendance-sheet-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(15, 23, 42, 0.6); /* Modern dark overlay with blur backdrop if supported */
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
        }

        #attendance-sheet-container * {
            font-family: Verdana, Geneva, sans-serif !important;
        }

        /* Protect FontAwesome Icons from the aggressive Arial override */
        #attendance-sheet-container .fa, 
        #attendance-sheet-container .fas,
        #attendance-sheet-container .fab,
        #attendance-sheet-container .far {
            font-family: "Font Awesome 5 Free", "Font Awesome 5 Brands", "FontAwesome" !important;
            font-weight: 900;
        }

        #attendance-sheet-content {
            background-color: #ffffff;
            padding: 24px;
            border-radius: 24px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 95%;
            max-height: 90vh;
            overflow: auto;
            position: relative;
            width: 800px;
            font-family: Verdana, Geneva, sans-serif !important; /* Force explicit vector sans-serif over EIS defaults */
            font-size: 13px;
        }

        #sheet-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        }

        .attendance-btn {
            border: none;
            border-radius: 12px; /* Rounded buttons */
            padding: 8px 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            color: white;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        #print-sheet-btn, #save-sheet-btn {
            background-color: #428bca; /* Modern Blue */
        }
        
        #print-sheet-btn:hover, #save-sheet-btn:hover {
            background-color: #00458c;
            transform: translateY(-1px);
            box-shadow: 0 4px 6px rgba(0, 69, 140, 0.2);
        }

        #config-panel {
            background-color: #f8fafc; /* Lighter, modern slate gray background */
            padding: 12px;
            border-radius: 12px; /* Rounded panel */
            border: 1px solid #e2e8f0;
            margin-bottom: 12px;
            box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.02);
        }

        .config-row {
            display: flex;
            gap: 10px;
            margin-bottom: 8px;
            align-items: center;
        }

        .config-row label {
            width: 140px;
            font-weight: 700;
            color: #334155; /* Slate 700 text */
            font-size: 13px;
        }

        .config-row input, .config-row select {
            flex: 1;
            padding: 4px 8px;
            border-radius: 6px; /* Slightly rounded inputs */
            border: 1px solid #cbd5e1; /* Slate 300 border */
            background-color: #ffffff;
            color: #0f172a;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            font-size: 13px;
            font-family: inherit;
        }

        .config-row input:focus, .config-row select:focus {
            outline: none;
            border-color: #428bca;
            box-shadow: 0 0 0 3px rgba(66, 139, 202, 0.1);
        }

        .signature-item {
            display: flex;
            gap: 10px;
            margin-bottom: 8px;
            align-items: center;
        }

        .signature-item input, .signature-item select {
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background-color: #ffffff;
            color: #0f172a;
            transition: all 0.15s;
            font-size: 13px;
            font-family: inherit;
        }

        .signature-item input:focus, .signature-item select:focus {
             outline: none;
             border-color: #428bca;
             box-shadow: 0 0 0 3px rgba(66, 139, 202, 0.1);
        }

        .signature-item button {
            background-color: #ef4444; /* Modern red */
            color: white;
            border: none;
            border-radius: 6px;
            padding: 4px 10px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s ease;
            box-shadow: 0 1px 2px rgba(239, 68, 68, 0.2);
        }
        
        .signature-item button:hover {
            background-color: #dc2626;
            transform: translateY(-1px);
        }

        #add-signature-btn {
            background-color: #10b981; /* Modern Emerald */
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: 500;
            margin-top: 8px;
            transition: all 0.2s ease;
            box-shadow: 0 1px 2px rgba(16, 185, 129, 0.2);
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        
        #add-signature-btn:hover {
             background-color: #059669;
             transform: translateY(-1px);
        }

        #close-sheet-btn {
            background-color: #f1f5f9; /* Slate 100 base */
            color: #475569; /* Slate 600 text */
            border: 1px solid #e2e8f0;
            box-shadow: none;
        }

        #close-sheet-btn:hover {
            background-color: #e2e8f0;
            color: #0f172a;
            transform: translateY(0);
        }

        /* Styling to match the screenshots exactly with BOLD text */
        .sheet-header {
            margin-bottom: 8px;  /* Closer to the table */
        }

        .sheet-header h1 {
            font-size: 16px;
            margin: 0;
            font-weight: 700 !important;
            color: #000;
            text-align: left;
        }

        .sheet-header h2 {
            font-size: 16px;
            margin: 5px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: left;
        }

        .sheet-header h3 {
            font-size: 18px;
            margin: 25px 0 15px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: center;
            text-transform: uppercase;
        }

        #printed-date-display {
            font-size: 11px !important;
        }

        .sheet-header h4 {
            font-size: 12px;
            margin: 5px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: left;
        }

        .header-flex {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0px; /* Reduced from 5px to be closer to table */
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
            margin-top: 4px;  /* Reduced from 8px to be closer to "Printed on" */
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
            font-weight: bold; /* Revert to standard bold instead of 800 */
            background-color: #fff;
        }

        .attendance-table th:nth-child(1) {
            width: 30px; /* Nr. column */
        }

        .attendance-table td:nth-child(1) {
            text-align: right;
            padding-right: 5px;
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
        .font-homemade-apple { font-family: 'Homemade Apple', cursive !important; }
        .font-dancing-script { font-family: 'Dancing Script', cursive !important; }
        .font-caveat { font-family: 'Caveat', cursive !important; }
        .font-pacifico { font-family: 'Pacifico', cursive !important; }
        .font-satisfy { font-family: 'Satisfy', cursive !important; }
        .font-indie-flower { font-family: 'Indie Flower', cursive !important; }
        .font-kalam { font-family: 'Kalam', cursive !important; }
        .font-shadows-into-light { font-family: 'Shadows Into Light', cursive !important; }
        .font-marck-script { font-family: 'Marck Script', cursive !important; }
        .font-just-me { font-family: 'Just Me Again Down Here', cursive !important; }
        .font-great-vibes { font-family: 'Great Vibes', cursive !important; }
        .font-tangerine { font-family: 'Tangerine', cursive !important; }
        .font-cedarville { font-family: 'Cedarville Cursive', cursive !important; }
        .font-sacramento { font-family: 'Sacramento', cursive !important; }
        /* Ensure FontAwesome icons are displayed correctly within the container */
        #attendance-sheet-container .fa, #attendance-sheet-container .fas {
            font-family: "Font Awesome 5 Free", "Font Awesome 5 Brands", "FontAwesome" !important;
        }
        /* Protect FontAwesome inside the table if any exist */
        #attendance-sheet-content .fa,
        #attendance-sheet-content .fas {
            font-family: "Font Awesome 5 Free", "Font Awesome 5 Brands", "FontAwesome" !important;
            font-weight: 900;
        }
        .font-petit-formal { font-family: 'Petit Formal Script', cursive !important; }
        .font-bilbo { font-family: 'Bilbo', cursive !important; }
        .font-lovers-quarrel { font-family: 'Lovers Quarrel', cursive !important; }
        .font-herr-von-muellerhoff { font-family: 'Herr Von Muellerhoff', cursive !important; }
        .font-mrs-saint-delafield { font-family: 'Mrs Saint Delafield', cursive !important; }
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
                margin: 12mm 8mm 8mm 8mm; /* top right bottom left */
            }

            *, *::before, *::after {
                box-sizing: border-box !important;
            }

            html, body {
                width: 794px !important; /* Exact A4 width at standard DPI */
                min-width: 794px !important;
                max-width: 794px !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background-color: white !important;
            }

            /* Hide everything in the body by default */
            body > * {
                display: none !important;
            }

            /* Only show the attendance container */
            body > #attendance-sheet-container {
                display: block !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 794px !important;
                min-width: 794px !important;
                max-width: 794px !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background-color: transparent !important;
            }

            #attendance-sheet-content {
                display: block !important;
                position: relative !important;
                left: 0 !important;
                top: 0 !important;
                transform: none !important;
                width: 750px !important; /* Widen table to squeeze default side margins safely */
                min-width: 750px !important;
                max-width: 750px !important;
                height: auto !important;
                max-height: none !important; /* Critical to unlock the 90vh limit */
                background-color: white !important;
                box-shadow: none !important;
                padding: 15px 0 !important; /* Squeeze vertical padding slightly */
                margin: 0 auto !important; /* Forces centering inside the 794px canvas */
                border: none !important;
                border-radius: 0 !important;
                overflow: visible !important;
            }

            /* Hide controls */
            #sheet-controls, #config-panel {
                display: none !important;
            }

            /* Ensure table fits horizontally and paginates vertically */
            .attendance-table {
                width: 100% !important;
                max-width: 100% !important;
                table-layout: fixed !important;
                border-collapse: collapse !important;
                margin: 0 !important;
            }

            .attendance-table tr {
                page-break-inside: avoid !important;
            }

            .attendance-table thead {
                display: table-header-group !important;
            }

            .attendance-table tbody {
                display: table-row-group !important;
            }

            .sheet-header, .footer-note, .signature-line {
                width: 100% !important;
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
        button.className = 'btn btn-info';
        button.innerHTML = '<i class="fa fa-table"></i> Generate Attendance Sheet';
        button.onclick = generateAttendanceSheet;

        actionBar.insertBefore(button, actionBar.firstChild);
    }

    // Enhanced function to extract attendance data handling both editable and locked cases
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
            data.username = usernameElement.textContent.trim().replace('Assistant Lecturer M.Sc.', 'Assistant Lecturer');
        }

        // Get course details for code, name, and category
        const courseHeadingElem = document.querySelector('.course h4');
        let courseName = courseHeadingElem ? courseHeadingElem.textContent.trim() : 'Attendance Sheet';

        const captionElem = document.querySelector('.course .caption');
        let courseCode = '';
        if (captionElem) {
            courseCode = captionElem.textContent.replace(/\s+/g, ' ').trim();

            // Clean up redundant course codes at the start of the course name
            // E.g. If code is "SWE / MTH 102" and name is "MTH 102 CALCULUS II", we want just "CALCULUS II"
            if (courseCode && courseName !== 'Attendance Sheet') {
                const codeParts = courseCode.split('/').map(p => p.trim()).sort((a, b) => b.length - a.length);
                for (const part of codeParts) {
                    if (part && courseName.startsWith(part)) {
                        courseName = courseName.substring(part.length).trim();
                        // Additional safety clean up if there's a dangling dash
                        if (courseName.startsWith('-')) {
                            courseName = courseName.substring(1).trim();
                        }
                        break;
                    }
                }
            }
        }

        // Get category and group from list items
        const ulItems = document.querySelectorAll('.attendance-details ul.list-unstyled li');
        let category = '';
        let group = '';

        ulItems.forEach(li => {
            const label = li.querySelector('.label-cont')?.textContent?.trim();
            const text = li.querySelector('.text-cont')?.textContent?.trim();
            if (label === 'Category' && text && text.toUpperCase() !== 'ALL') {
                category = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
            }
            if (label === 'Group' && text && text.toUpperCase() !== 'ALL') {
                group = text.trim();
            }
        });

        let formattedCategory = '';
        if (category) {
            formattedCategory = ' - ' + category;
            if (group) {
                formattedCategory += ' ' + group;
            }
        }

        if (courseCode) {
            data.courseTitle = courseCode + ' - ' + courseName + formattedCategory;
            data.storageKey = (courseCode + '_' + courseName).replace(/[^a-z0-9]/gi, '_');
        } else {
            data.courseTitle = courseName + formattedCategory;
            data.storageKey = courseName.replace(/[^a-z0-9]/gi, '_');
        }

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

            // --- FIX START: More robust name cleaning ---
            // This ensures we only remove the suffixes from the very end of the name,
            // preventing accidental changes to names like "Alexander".
            const cleanName = studentName
                .replace(/\s+R\s+EX$/, '')   // Remove ' R EX' from the end
                .replace(/\s+\(EX\)$/, '')   // Remove ' (EX)' from the end
                .replace(/\s+EX$/, '')      // Remove ' EX' from the end
                .replace(/\s+R$/, '')        // Remove ' R' from the end
                .replace(/\s+\(R\)$/, '')    // Remove ' (R)' from the end
                .trim();
            // --- FIX END ---

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

                // Get attendance checks - using the original working implementation, plus handle locked icons
                const checkElements = row.querySelectorAll('.checkboxes_row_td input[type="checkbox"], .checkboxes.pull-left, input.checkboxes, .checkboxes_row_td i.fa-check-square, .checkboxes_row_td i.fa-square, .checkboxes_row_td i.fa-check-square-o, .checkboxes_row_td i.fa-square-o');

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
                                checkElements[checkIndex].classList.contains('fa-check-square-o') ||
                                checkElements[checkIndex].classList.contains('fa-check-square') ||
                                checkElements[checkIndex].classList.contains('fa-check'))) {
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
            if (column.hasAttribute('data-index')) {
                if (dateString) {
                    const parts = dateString.split('-');
                    if (parts.length === 3) {
                        column.textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    }
                } else {
                    column.textContent = '__/__/2025';
                }
            } else {
                column.textContent = '';
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
                    <i class="fas fa-print"></i> Print PDF
                </button>
            </div>
            <button id="close-sheet-btn" class="attendance-btn">
                <i class="fas fa-times"></i> Close
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
            { name: 'Aguafina Script', value: 'font-aguafina' },
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
            { name: 'Meddon', value: 'font-meddon' }
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
                    <label>Date for column ${i + 1}:</label>
                    <input type="date" id="date-column-${i}" value="${data.isoDate || ''}" class="single-date-input">
                </div>
            `;
        }

        // Generate config panel HTML with signature font dropdown and use checkmarks option
        let cachedSigs = null;
        if (data.storageKey) {
            try {
                const stored = localStorage.getItem(`EIS_attendance_sigs_${data.storageKey}`);
                if (stored) { cachedSigs = JSON.parse(stored); }
            } catch (e) { }
        }

        let signaturesConfigHtml = '';
        if (cachedSigs && cachedSigs.length > 0) {
            cachedSigs.forEach((sig, index) => {
                const i = index + 1;
                signaturesConfigHtml += `
                    <div class="signature-item" id="signature-item-${i}">
                        <select id="signature-title-${i}">
                            <option value="Lecturer Prof. Dr." ${sig.title === 'Lecturer Prof. Dr.' ? 'selected' : ''}>Lecturer Prof. Dr.</option>
                            <option value="Lecturer Assoc. Prof. Dr." ${sig.title === 'Lecturer Assoc. Prof. Dr.' ? 'selected' : ''}>Lecturer Assoc. Prof. Dr.</option>
                            <option value="Lecturer Dr." ${sig.title === 'Lecturer Dr.' ? 'selected' : ''}>Lecturer Dr.</option>
                            <option value="Assistant Lecturer" ${sig.title === 'Assistant Lecturer' ? 'selected' : ''}>Assistant Lecturer</option>
                        </select>
                        <input type="text" id="signature-name-${i}" value="${sig.name}" style="flex: 1;">
                        <button class="remove-signature-btn" data-id="${i}" ${i === 1 ? 'style="visibility: hidden;"' : ''}>Remove</button>
                    </div>
                `;
            });
        } else {
            signaturesConfigHtml = `
                <div class="signature-item" id="signature-item-1">
                    <select id="signature-title-1">
                        <option value="Lecturer Prof. Dr.">Lecturer Prof. Dr.</option>
                        <option value="Lecturer Assoc. Prof. Dr.">Lecturer Assoc. Prof. Dr.</option>
                        <option value="Lecturer Dr.">Lecturer Dr.</option>
                        <option value="Assistant Lecturer" selected>Assistant Lecturer</option>
                    </select>
                    <input type="text" id="signature-name-1" value="${data.username}" style="flex: 1;">
                    <button class="remove-signature-btn" data-id="1" style="visibility: hidden;">Remove</button>
                </div>
            `;
        }

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
                ${signaturesConfigHtml}
            </div>
            <button id="add-signature-btn">Add Another Signature</button>
        `;

        // Create header - exactly matching the template with subject and date on same row
        const header = document.createElement('div');
        header.className = 'sheet-header';

        // Institution details
        header.innerHTML = `
            <h2>Epoka University</h2>
            <h2>Faculty of Architecture and Engineering</h2>
            <h3>ATTENDANCE LIST</h3>
            <div class="header-flex">
                <h4>${data.courseTitle}</h4>
                <p id="printed-date-display"><i>Printed on:</i> ${formatDate(new Date())}</p>
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
            <th>No.</th>
            <th>R</th>
            <th>Student ID</th>
            <th>Name Surname</th>
        `;

        // Add date columns based on totalHours
        for (let i = 0; i < 5; i++) {
            if (i < data.totalHours) {
                headerCells += `<th class="date-column" data-index="${i}">__/__/2025</th>`;
            } else {
                headerCells += `<th class="date-column"></th>`;
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

                // --- FIX START: Removed the "!student.exempt" condition ---
                // This will now draw a mark if the student was present,
                // regardless of their exemption status.
                if (i < studentAttendance.length && studentAttendance[i]) {
                    // --- FIX END ---
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
                    dateCell.innerHTML += `<input type="hidden" name="stdabsences[${i}][checked]" value="${i + 1}">`;
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
            <p style="margin-bottom: 10px;"><strong>NOTE:</strong></p>
            <p style="margin-bottom: 10px;">Students that are not listed in the attendance list will not be considered as enrolled in the course!</p>
            <p>All attendance sheets should be delivered to department coordinators by the end of the week after recording</p>
            <p style="margin-bottom: 10px;">the entries electronically through EIS system.</p>
            <p style="margin-bottom: 10px;"><strong>R</strong> - Repeated Course, <strong>Ex</strong> - Exempted from attendances.</p>
        `;

        const signature = document.createElement('div');
        signature.className = 'signature-line';
        signature.id = 'signature-area';

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
        document.getElementById('signature-display-select').addEventListener('change', function () {
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

        document.getElementById('signature-font-select').addEventListener('change', function () {
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
        document.getElementById('printed-date-input').addEventListener('change', function () {
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

        document.getElementById('close-sheet-btn').addEventListener('click', () => {
            document.body.removeChild(container);
        });

        // Add event listener for the "Set all dates at once" input
        document.getElementById('all-dates-input').addEventListener('change', function () {
            const dateValue = this.value;

            // Update all individual date inputs
            document.querySelectorAll('.single-date-input').forEach(input => {
                input.value = dateValue;
            });

            // Update all date columns in the table
            updateAllDates(dateValue);
        });

        // Add event listener for adding signatures
        let signatureCounter = cachedSigs && cachedSigs.length > 0 ? cachedSigs.length : 1;
        document.getElementById('add-signature-btn').addEventListener('click', () => {
            signatureCounter++;

            const signaturesContainer = document.getElementById('signatures-container');

            const signatureItem = document.createElement('div');
            signatureItem.className = 'signature-item';
            signatureItem.id = `signature-item-${signatureCounter}`;

            signatureItem.innerHTML = `
                <select id="signature-title-${signatureCounter}">
                    <option value="Lecturer Prof. Dr.">Lecturer Prof. Dr.</option>
                    <option value="Lecturer Assoc. Prof. Dr.">Lecturer Assoc. Prof. Dr.</option>
                    <option value="Lecturer Dr." selected>Lecturer Dr.</option>
                    <option value="Assistant Lecturer">Assistant Lecturer</option>
                </select>
                <input type="text" id="signature-name-${signatureCounter}" value="" style="flex: 1;">
                <button class="remove-signature-btn" data-id="${signatureCounter}">Remove</button>
            `;

            signaturesContainer.appendChild(signatureItem);

            // Make remove button visible for first signature
            document.querySelector('#signature-item-1 .remove-signature-btn').style.visibility = 'visible';

            // Add event listener for remove button
            signatureItem.querySelector('.remove-signature-btn').addEventListener('click', function () {
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
            button.addEventListener('click', function () {
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
            input.addEventListener('change', function () {
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

        // Add listeners for cached remove buttons
        document.querySelectorAll('.remove-signature-btn').forEach(btn => {
            if (btn.getAttribute('data-id') !== '1') {
                btn.addEventListener('click', function () {
                    this.closest('.signature-item').remove();
                    updateSignatures();
                });
            }
        });

        // Set initial dates
        if (data.isoDate) {
            updateAllDates(data.isoDate);
        }

        // Set the initial signature text dynamically
        updateSignatures();

        // Function to update signatures in the sheet
        function updateSignatures() {
            const signatureItems = document.querySelectorAll('.signature-item');
            const signatureArea = document.getElementById('signature-area');

            let signaturesHtml = '';
            let savedSigs = [];
            signatureItems.forEach(item => {
                const parts = item.id.split('-');
                if (parts.length >= 3) {
                    const id = parts[2];
                    const titleEl = document.getElementById(`signature-title-${id}`);
                    const nameEl = document.getElementById(`signature-name-${id}`);

                    if (titleEl && nameEl) {
                        signaturesHtml += `
                            <div style="margin-bottom: 30px;">
                                <p style="font-weight: bold; font-size: 14px; margin-bottom: 2px;">${titleEl.value} ${nameEl.value}</p>
                                <p style="font-size: 11px; font-style: italic; margin-top: 0;">(Signature)</p>
                            </div>
                        `;
                        savedSigs.push({ title: titleEl.value, name: nameEl.value });
                    }
                }
            });

            if (signatureArea) {
                signatureArea.innerHTML = signaturesHtml;
            }

            // Save to localStorage whenever signatures are updated
            if (data.storageKey) {
                localStorage.setItem(`EIS_attendance_sigs_${data.storageKey}`, JSON.stringify(savedSigs));
            }
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