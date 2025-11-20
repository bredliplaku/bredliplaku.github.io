// ==UserScript==
// @name         EIS Grade Autofiller
// @namespace    https://bredliplaku.com/
// @version      1.1
// @description  Matches names and fills grades from Excel to EIS
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_grader.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_grader.user.js
// @match        https://eis.epoka.edu.al/courseminorgrades/*/minorgrades*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Wait for jQuery to be loaded
    var checkReady = setInterval(function () {
        if (window.jQuery) {
            clearInterval(checkReady);
            init();
        }
    }, 100);

    function init() {
        var $ = window.jQuery;

        // Target specifically the button group inside the Student List container
        var $targetContainer = $('#edit-grades-btn').parent();

        if ($targetContainer.length === 0) return;

        // Create the button container
        var $btnGroup = $('<div style="display:inline-block; margin-right: 5px;"></div>');

        // Create Buttons
        var $pasteBtn = $('<button type="button" class="btn btn-info" style="margin-right: 5px;" title="Try to paste from clipboard automatically"><i class="fa fa-clipboard"></i> Paste Grades</button>');
        var $importBtn = $('<button type="button" class="btn btn-success"><i class="fa fa-file-excel-o"></i> Import from Excel</button>');
        var $fileInput = $('<input type="file" accept=".xlsx, .xls" style="display:none;" />');

        // Append elements
        $btnGroup.append($pasteBtn).append($importBtn).append($fileInput);
        $targetContainer.prepend($btnGroup);

        // 1. PASTE HANDLER
        $pasteBtn.click(async function () {
            try {
                // Attempt to read text from clipboard API
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    // Parse text manually (fallback to basic parsing for clipboard)
                    // Convert text to a simple array of arrays to reuse logic
                    var rows = text.trim().split('\n').map(row => row.split('\t'));
                    prepareData($, rows);
                } else {
                    // Clipboard empty or not text
                    showPasteModal($);
                }
            } catch (err) {
                console.warn("Clipboard API access failed or denied. Falling back to manual paste.", err);
                showPasteModal($);
            }
        });

        // 2. IMPORT HANDLER
        $importBtn.click(function () {
            $fileInput.click();
        });

        $fileInput.change(function (e) {
            var file = e.target.files[0];
            if (!file) return;

            var reader = new FileReader();
            reader.onload = function (e) {
                var data = new Uint8Array(e.target.result);
                var workbook = XLSX.read(data, { type: 'array' });
                handleWorkbook($, workbook);
            };
            reader.readAsArrayBuffer(file);

            // Reset input to allow selecting the same file again if needed
            $(this).val('');
        });
    }

    function handleWorkbook($, workbook) {
        var sheetNames = workbook.SheetNames;

        if (sheetNames.length === 0) {
            alert("No sheets found in the Excel file.");
            return;
        }

        if (sheetNames.length === 1) {
            // Only one sheet? Process it immediately.
            processSheet($, workbook, sheetNames[0]);
        } else {
            // Multiple sheets? Ask the user.
            showSheetSelector($, workbook);
        }
    }

    function processSheet($, workbook, sheetName) {
        var sheet = workbook.Sheets[sheetName];
        // Use sheet_to_json with header: 1 to get a robust array of arrays
        // This handles ranges, hidden rows, and data types better than plain text conversion
        var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        prepareData($, jsonData);
    }

    function showSheetSelector($, workbook) {
        $('#eis-grade-modal').remove();

        var sheetButtons = workbook.SheetNames.map(function (name) {
            return `<button class="btn btn-default sheet-select-btn" data-sheet="${name}" style="margin: 5px; width: 100%; text-align: left; border-radius: 6px;">
                        <i class="fa fa-table"></i> ${name}
                    </button>`;
        }).join('');

        var modalHtml = `
            <div id="eis-grade-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; justify-content:center; align-items:center;">
                <div style="background:white; padding:20px; width:400px; max-width:90%; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
                    <h4 style="margin-top:0; color:#333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Select Worksheet</h4>
                    <p style="color:#666; font-size:13px;">This file has multiple sheets. Which one contains the grades?</p>
                    <div style="max-height: 300px; overflow-y: auto; margin-bottom: 15px;">
                        ${sheetButtons}
                    </div>
                    <div style="text-align:right;">
                        <button id="eis-close-btn" class="btn btn-default btn-sm" style="border-radius: 4px;">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        $('.sheet-select-btn').click(function () {
            var sheetName = $(this).data('sheet');
            $('#eis-grade-modal').remove();
            processSheet($, workbook, sheetName);
        });

        $('#eis-close-btn').click(function () {
            $('#eis-grade-modal').remove();
        });
    }

    function showPasteModal($) {
        $('#eis-grade-modal').remove();

        var modalHtml = `
            <div id="eis-grade-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; justify-content:center; align-items:center;">
                <div style="background:white; padding:20px; width:600px; max-width:90%; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);">
                    <h3 style="margin-top:0; color:#333;">Paste Grades</h3>
                    <p style="color:#666; font-size:13px;">
                        <b>Automatic paste failed.</b><br>
                        Please manually copy your Excel table (including headers) and paste it below.<br>
                        <em style="color:#888;">(Ensure "Name" and "Total" columns exist)</em>
                    </p>
                    <textarea id="eis-paste-area" style="width:100%; height:200px; padding:10px; border:1px solid #ccc; border-radius:6px; font-family:monospace; white-space:pre; overflow:auto;" placeholder="Paste here..."></textarea>
                    <div style="margin-top:15px; text-align:right;">
                        <span id="eis-status-msg" style="float:left; color:#d9534f; font-weight:bold; margin-top:7px;"></span>
                        <button id="eis-close-btn" class="btn btn-default" style="border-radius: 4px;">Cancel</button>
                        <button id="eis-process-btn" class="btn btn-primary" style="border-radius: 4px;">Next</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);
        $('#eis-paste-area').focus();

        $('#eis-close-btn').click(function () {
            $('#eis-grade-modal').remove();
        });

        $('#eis-process-btn').click(function () {
            var text = $('#eis-paste-area').val();
            if (!text.trim()) {
                $('#eis-status-msg').text("Please paste data first.");
                return;
            }
            var rows = text.trim().split('\n').map(row => row.split('\t'));
            prepareData($, rows);
        });
    }

    function cleanName(name) {
        if (name === null || name === undefined) return "";
        // Ensure name is string (handles numeric IDs from excel)
        name = String(name).trim();
        return name.replace(/\s+(R|EX|R\s+EX)$/i, '').trim();
    }

    // 1. Parse data logic
    function prepareData($, rows) {
        if (!rows || rows.length === 0) {
            alert("No data found.");
            return;
        }

        // SMART HEADER SEARCH
        // Scan the first 20 rows to find the header row.
        var headerRowIndex = -1;
        var nameIndex = -1;
        var totalIndex = -1;

        var scanLimit = Math.min(rows.length, 20);

        for (var r = 0; r < scanLimit; r++) {
            var row = rows[r];
            var tempNameIdx = -1;
            var tempTotalIdx = -1;

            for (var c = 0; c < row.length; c++) {
                var cell = row[c];
                if (!cell) continue;
                var h = String(cell).toLowerCase().trim();

                if (h.includes('name') || h.includes('student') || h.includes('exam code') || h.includes('exam id') || h === 'id' || h === 'code') tempNameIdx = c;
                if (h === 'total' || h.includes('total') || h.includes('grade') || h.includes('points') || h.includes('score')) tempTotalIdx = c;
            }

            // If we found both potential columns in one row, we assume this is the header
            if (tempNameIdx !== -1 && tempTotalIdx !== -1) {
                headerRowIndex = r;
                nameIndex = tempNameIdx;
                totalIndex = tempTotalIdx;
                break;
            }
        }

        // Fallback: If no header row found, assume row 0 is header and try to guess or use defaults
        if (headerRowIndex === -1) {
            headerRowIndex = 0;
            // If headers are missing, usually first column is ID/Name and last is Grade
            if (rows[0].length >= 2) {
                nameIndex = 0;
                totalIndex = rows[0].length - 1;
            }
            console.warn("EIS Script: Could not confidently find headers. Guessing indices.");
        }

        console.log(`EIS Script: Header Row: ${headerRowIndex}, Name Col: ${nameIndex}, Grade Col: ${totalIndex}`);

        if (nameIndex === -1 || totalIndex === -1) {
            alert("Could not identify 'Name' and 'Total' columns. Please check your file headers.");
            return;
        }

        // Build Map
        var gradeMap = {};
        for (var r = headerRowIndex + 1; r < rows.length; r++) {
            var cols = rows[r];
            // Skip empty rows or short rows
            if (!cols || cols.length <= nameIndex) continue;

            var rawName = cols[nameIndex];
            var rawGrade = (cols.length > totalIndex) ? cols[totalIndex] : "";

            if (rawName !== undefined && rawName !== null && String(rawName).trim() !== "") {
                var clean = cleanName(rawName).toLowerCase();
                // Ensure 0 is treated as "0" and not false/empty
                var gradeVal = (rawGrade !== undefined && rawGrade !== null && String(rawGrade).trim() !== "") ? String(rawGrade).trim() : "";
                gradeMap[clean] = gradeVal;
            }
        }

        // Show Config Modal before filling
        showConfigModal($, gradeMap);
    }

    // 2. Configuration Modal
    function showConfigModal($, gradeMap) {
        $('#eis-grade-modal').remove();

        // Detect if it is a Midterm or Final Exam to show/hide Attendance option
        var headerText = $('.form-header-title').text().toUpperCase();
        var isExam = headerText.includes('MIDTERM') || headerText.includes('FINAL');
        var hasCheckboxes = $('.attendance-checkbox').length > 0;

        var showAttendanceOption = isExam && hasCheckboxes;

        var attendanceOptionHtml = '';
        if (showAttendanceOption) {
            attendanceOptionHtml = `<label style="display:block; font-weight:normal;"><input type="radio" name="empty_opt" value="attendance"> Uncheck Attendance</label>`;
        }

        var modalHtml = `
            <div id="eis-grade-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; justify-content:center; align-items:center;">
                <div style="background:white; padding:25px; width:550px; max-width:90%; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); font-family: sans-serif;">
                    <h3 style="margin-top:0; color:#333; border-bottom:1px solid #eee; padding-bottom:10px;">Import Configuration</h3>

                    <div style="margin-bottom: 15px; margin-top: 15px;">
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">1. Students missing in Excel:</label>
                        <div style="margin-left: 10px;">
                            <label style="display:block; font-weight:normal;"><input type="radio" name="missing_opt" value="skip" checked> Leave empty</label>
                            <label style="display:block; font-weight:normal;"><input type="radio" name="missing_opt" value="grade"> Grade as <input type="number" id="missing_val" value="0" style="width:60px; padding:2px; border:1px solid #ccc; border-radius:4px;"></label>
                        </div>
                    </div>

                    <div style="margin-bottom: 15px;">
                        <label style="font-weight:bold; display:block; margin-bottom:5px;">2. Students with empty grade in Excel:</label>
                        <div style="margin-left: 10px;">
                            <label style="display:block; font-weight:normal;"><input type="radio" name="empty_opt" value="skip" checked> Leave empty</label>
                            <label style="display:block; font-weight:normal;"><input type="radio" name="empty_opt" value="grade"> Grade as <input type="number" id="empty_val" value="0" style="width:60px; padding:2px; border:1px solid #ccc; border-radius:4px;"></label>
                            ${attendanceOptionHtml}
                        </div>
                    </div>

                    <div style="text-align:right; border-top:1px solid #eee; padding-top:15px;">
                        <button id="eis-close-btn" class="btn btn-default" style="border-radius:4px;">Cancel</button>
                        <button id="eis-final-process-btn" class="btn btn-primary" style="border-radius:4px;">Process Grades</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        $('#eis-close-btn').click(function () {
            $('#eis-grade-modal').remove();
        });

        $('#eis-final-process-btn').click(function () {
            var config = {
                missingOpt: $('input[name="missing_opt"]:checked').val(),
                missingVal: $('#missing_val').val(),
                emptyOpt: $('input[name="empty_opt"]:checked').val(),
                emptyVal: $('#empty_val').val()
            };
            $('#eis-grade-modal').remove();
            fillGrades($, gradeMap, config);
        });
    }

    // Helper to find the correct column index
    function getStudentNameIndex($) {
        var $headers = $('#student_list_table thead tr th');
        var index = -1;

        $headers.each(function (i) {
            var text = $(this).text().trim().toLowerCase();
            if (text.includes('name') || text.includes('student') || text.includes('exam code')) {
                index = i;
                return false; // break
            }
        });

        // Fallback to 2 (standard student list) if detection fails
        return index !== -1 ? index : 2;
    }

    // 3. Fill Logic
    function fillGrades($, gradeMap, config) {
        // Ensure Edit Mode
        var $editBtn = $('#edit-grades-btn');
        if ($editBtn.is(':visible')) {
            $editBtn.click();
        }

        var $tableRows = $('#student_list_table tbody tr');
        var nameColIndex = getStudentNameIndex($); // Dynamically get index

        console.log("EIS Script: Page Name/ID column detected at index: " + nameColIndex);

        // Statistics Counters
        var stats = {
            matchedFilled: 0,      // Found in Excel, had a grade, filled it
            emptyFilled: 0,        // Found in Excel, empty grade, filled with default
            emptyAttendance: 0,    // Found in Excel, empty grade, unchecked attendance
            emptySkipped: 0,       // Found in Excel, empty grade, skipped
            missingFilled: 0,      // Not in Excel, filled with default
            missingSkipped: 0,     // Not in Excel, skipped
            totalStudents: 0
        };

        $tableRows.each(function () {
            var $tr = $(this);
            var $nameTd = $tr.find('td').eq(nameColIndex);
            // Safety check for header rows or malformed rows
            if ($nameTd.length === 0) return;

            var htmlNameRaw = $nameTd.text();
            var htmlNameClean = cleanName(htmlNameRaw).toLowerCase();

            var $input = $tr.find('input[type="text"][name$="[points]"]');
            if ($input.length === 0) return; // Skip if input not found

            stats.totalStudents++;

            // Logic Flow
            if (gradeMap.hasOwnProperty(htmlNameClean)) {
                // Student exists in Excel
                var gradeValue = gradeMap[htmlNameClean];

                if (gradeValue !== "") {
                    // Has a grade -> Fill it
                    updateInput($input, gradeValue);
                    visualSuccess($tr, $input);
                    stats.matchedFilled++;
                } else {
                    // Empty grade in Excel -> Check Config
                    if (config.emptyOpt === 'grade') {
                        updateInput($input, config.emptyVal);
                        visualSuccess($tr, $input);
                        stats.emptyFilled++;
                    } else if (config.emptyOpt === 'attendance') {
                        // Handle Attendance Uncheck
                        var $chk = $tr.find('.attendance-checkbox');
                        if ($chk.length > 0) {
                            // If it is checked, click it to uncheck (triggering handlers)
                            // Use .prop for standard checkbox, or look for the Uniform plugin wrapper class 'checked'
                            var isChecked = $chk.prop('checked') || $chk.parent().hasClass('checked');
                            if (isChecked) {
                                $chk.click(); // Click triggers the EIS events
                                $tr.css('background-color', '#f2dede'); // Light red/pink for NA
                                stats.emptyAttendance++;
                            } else {
                                // Already unchecked but matches criteria
                                stats.emptyAttendance++;
                            }
                        } else {
                            stats.emptySkipped++; // No checkbox available
                        }
                    } else {
                        // skip
                        stats.emptySkipped++;
                    }
                }

            } else {
                // Student Missing in Excel -> Check Config
                if (config.missingOpt === 'grade') {
                    updateInput($input, config.missingVal);
                    $tr.css('background-color', '#fcf8e3'); // Light yellow for filled missing
                    $input.css('border', '2px solid #8a6d3b');
                    stats.missingFilled++;
                } else {
                    stats.missingSkipped++;
                }
            }
        });

        showReportModal($, stats);
    }

    function showReportModal($, stats) {
        var modalHtml = `
            <div id="eis-grade-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; justify-content:center; align-items:center;">
                <div style="background:white; padding:25px; width:450px; max-width:90%; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); font-family: sans-serif;">
                    <h3 style="margin-top:0; color:#333; border-bottom:1px solid #eee; padding-bottom:10px; text-align:center;">Processing Complete</h3>

                    <div style="padding: 10px 0; font-size: 14px; line-height: 1.6;">
                        <div style="display:flex; justify-content:space-between; border-bottom: 1px solid #eee; padding:5px 0;">
                            <strong>Total Students (on page):</strong> <span>${stats.totalStudents}</span>
                        </div>

                        <div style="display:flex; justify-content:space-between; color:#2e7d32; padding:5px 0;">
                            <strong>Matched & Filled:</strong> <span>${stats.matchedFilled}</span>
                        </div>

                        <div style="margin-top:10px; font-weight:bold; color:#555;">Empty in Excel:</div>
                        <div style="padding-left:15px; color:#666;">
                            <div style="display:flex; justify-content:space-between;">- Filled with default: <span>${stats.emptyFilled}</span></div>
                            <div style="display:flex; justify-content:space-between;">- Attendance Unchecked: <span>${stats.emptyAttendance}</span></div>
                            <div style="display:flex; justify-content:space-between;">- Skipped: <span>${stats.emptySkipped}</span></div>
                        </div>

                        <div style="margin-top:10px; font-weight:bold; color:#555;">Missing in Excel:</div>
                        <div style="padding-left:15px; color:#666;">
                            <div style="display:flex; justify-content:space-between;">- Filled with default: <span>${stats.missingFilled}</span></div>
                            <div style="display:flex; justify-content:space-between;">- Skipped: <span>${stats.missingSkipped}</span></div>
                        </div>
                    </div>

                    <div style="text-align:center; border-top:1px solid #eee; padding-top:15px; margin-top:10px;">
                        <button id="eis-close-report-btn" class="btn btn-primary" style="min-width: 100px; border-radius: 4px;">OK</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        $('#eis-close-report-btn').click(function () {
            $('#eis-grade-modal').remove();
        });
    }

    function updateInput($input, val) {
        $input.val(val);
        $input.trigger('change');
        $input.trigger('input');
        $input.trigger('blur');
    }

    function visualSuccess($tr, $input) {
        $tr.css('background-color', '#dff0d8'); // Light green
        $input.css('border', '2px solid #3c763d');
    }

})();