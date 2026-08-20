// ==UserScript==
// @name         EIS Grade Autofiller
// @namespace    https://bredliplaku.com/
// @version      1.5
// @description  Matches names and fills grades from Excel to EIS
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_grader.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_grader.user.js
// @icon         https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/miscellaneous/EPOKA_icon.png
// @match        https://eis.epoka.edu.al/courseminorgrades/*/minorgrades*
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Use a MutationObserver to inject buttons instantly without a laggy timer
    function waitForTarget() {
        // If jQuery and the button are already on the page, run immediately
        if (window.jQuery && window.jQuery('#edit-grades-btn').length > 0) {
            init();
            return;
        }

        // Otherwise, watch the page build process
        var observer = new MutationObserver(function (mutations, me) {
            if (window.jQuery && window.jQuery('#edit-grades-btn').length > 0) {
                me.disconnect(); // Stop observing once found
                init();
            }
        });

        // Start observing the whole document for changes
        observer.observe(document, {
            childList: true,
            subtree: true
        });
    }

    // Start looking immediately
    waitForTarget();

    function init() {
        var $ = window.jQuery;

        // Target the Edit button directly
        var $editBtn = $('#edit-grades-btn');

        // We know it exists because of the observer, but keep this safety check
        if ($editBtn.length === 0) return;

        // 1. Inject the helpful instructions with padding and case-insensitive note
        var infoHtml = `
            <div class="alert alert-info" style="margin-bottom: 20px; padding: 20px; border-radius: 6px; font-size: 14px; line-height: 1.5;">
                <strong><i class="fa fa-info-circle"></i> Grade Autofiller Instructions:</strong><br>
                Ensure your Excel file has a header row. Label the student column as <b>Name</b>, <b>ID</b>, or <b>Code</b>, and the grade column as <b>Total</b>, <b>Grade</b>, or <b>Score</b>.<br>
                <span style="color: #31708f;"><em>Note: Header matching is <strong>not case-sensitive</strong> (e.g., "NAME" and "name" both work). If no recognised headers are found, the script will automatically use the first column for the student and the last column for the grade.</em></span>
            </div>
        `;
        // Insert the instructions right above the student list table
        $('#student_list_table').before(infoHtml);

        // 2. Fix Bootstrap's border-radius issue when 'Clear all' is hidden
        if ($('#eis-btn-fix').length === 0) {
            $('head').append(`
                <style id="eis-btn-fix">
                    /* When 'Clear all' is hidden, force 'Paste Grades' to have rounded left corners */
                    #clear-grades-btn[style*="none"] + .btn {
                        border-top-left-radius: 4px !important;
                        border-bottom-left-radius: 4px !important;
                    }
                </style>
            `);
        }

        // 3. Create the buttons
        var $pasteBtn = $('<button type="button" class="btn btn-info" title="Try to paste from clipboard automatically"><i class="fa fa-clipboard"></i> Paste Grades</button>');
        var $importBtn = $('<button type="button" class="btn btn-success"><i class="fa fa-file-excel-o"></i> Import from Excel</button>');

        // Append file input to the body so it doesn't break the .btn-group :last-child CSS for the Edit button
        var $fileInput = $('<input type="file" accept=".xlsx, .xls" style="display:none;" />');
        $('body').append($fileInput);

        // 4. Insert them directly before the edit button
        // Resulting order: Clear All -> Paste -> Import -> Edit
        $editBtn.before($pasteBtn, $importBtn);

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
            processSheet($, workbook, sheetNames[0]);
        } else {
            showSheetSelector($, workbook);
        }
    }

    function processSheet($, workbook, sheetName) {
        var sheet = workbook.Sheets[sheetName];
        var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        prepareData($, jsonData);
    }

    // Modal Helper to handle Bootstrap instantiation safely
    function showBootstrapModal(modalHtml) {
        var $ = window.jQuery;
        $('#eis-grade-modal').remove();
        $('.modal-backdrop').remove();
        $('body').append(modalHtml);
        $('#eis-grade-modal').modal({ backdrop: 'static', keyboard: false });
        $('#eis-grade-modal').modal('show');

        $('#eis-grade-modal').on('hidden.bs.modal', function () {
            $(this).remove();
        });
    }

    function showSheetSelector($, workbook) {
        var sheetButtons = workbook.SheetNames.map(function (name) {
            return '<button class="btn btn-default btn-block sheet-select-btn" data-sheet="' + name + '" style="text-align: left; margin-bottom: 5px;"><i class="fa fa-table"></i> ' + name + '</button>';
        }).join('');

        var modalHtml = `
            <div class="modal fade" id="eis-grade-modal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                            <h4 class="modal-title">Select Worksheet</h4>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted">This file has multiple sheets. Which one contains the grades?</p>
                            <div style="max-height: 300px; overflow-y: auto; margin-bottom: 15px;">
                                ${sheetButtons}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        showBootstrapModal(modalHtml);

        $('.sheet-select-btn').click(function () {
            var sheetName = $(this).data('sheet');
            $('#eis-grade-modal').modal('hide');
            processSheet($, workbook, sheetName);
        });
    }

    function showPasteModal($) {
        var modalHtml = `
            <div class="modal fade" id="eis-grade-modal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                            <h4 class="modal-title">Paste Grades</h4>
                        </div>
                        <div class="modal-body">
                            <p class="text-muted">
                                <strong>Automatic paste failed.</strong><br>
                                Please manually copy your Excel table (including headers) and paste it below.<br>
                            </p>
                            <textarea id="eis-paste-area" class="form-control" style="height:200px; font-family:monospace; white-space:pre;"></textarea>
                            <span id="eis-status-msg" class="text-danger" style="font-weight:bold; display:block; margin-top:10px;"></span>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                            <button type="button" id="eis-process-btn" class="btn btn-primary">Next</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        showBootstrapModal(modalHtml);

        $('#eis-paste-area').focus();
        $('#eis-process-btn').click(function () {
            var text = $('#eis-paste-area').val();
            if (!text.trim()) {
                $('#eis-status-msg').text("Please paste data first.");
                return;
            }
            $('#eis-grade-modal').modal('hide');
            var rows = text.trim().split('\n').map(row => row.split('\t'));
            prepareData($, rows);
        });
    }

    function cleanName(name) {
        if (name === null || name === undefined) return "";
        name = String(name).trim();
        return name.replace(/\s+(R|EX|R\s+EX)$/i, '').trim();
    }

    function prepareData($, rows) {
        if (!rows || rows.length === 0) {
            alert("No data found.");
            return;
        }

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

            if (tempNameIdx !== -1 && tempTotalIdx !== -1) {
                headerRowIndex = r;
                nameIndex = tempNameIdx;
                totalIndex = tempTotalIdx;
                break;
            }
        }

        if (headerRowIndex === -1) {
            headerRowIndex = 0;
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

        var gradeMap = {};
        for (var i = headerRowIndex + 1; i < rows.length; i++) {
            var cols = rows[i];
            if (!cols || cols.length <= nameIndex) continue;

            var rawName = cols[nameIndex];
            var rawGrade = (cols.length > totalIndex) ? cols[totalIndex] : "";

            if (rawName !== undefined && rawName !== null && String(rawName).trim() !== "") {
                var clean = cleanName(rawName).toLowerCase();
                var gradeVal = (rawGrade !== undefined && rawGrade !== null && String(rawGrade).trim() !== "") ? String(rawGrade).trim() : "";
                gradeMap[clean] = gradeVal;
            }
        }

        showConfigModal($, gradeMap);
    }

    function showConfigModal($, gradeMap) {
        var headerText = $('.form-header-title').text().toUpperCase();
        var isExam = headerText.includes('MIDTERM') || headerText.includes('FINAL');
        var hasCheckboxes = $('.attendance-checkbox').length > 0;
        var showAttendanceOption = isExam && hasCheckboxes;

        var attendanceOptionHtml = '';
        if (showAttendanceOption) {
            attendanceOptionHtml = `<div class="radio"><label><input type="radio" name="empty_opt" value="attendance"> Uncheck Attendance</label></div>`;
        }

        var modalHtml = `
            <div class="modal fade" id="eis-grade-modal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                            <h4 class="modal-title">Import Configuration</h4>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label>1. Students missing in Excel:</label>
                                <div class="radio"><label><input type="radio" name="missing_opt" value="skip" checked> Leave empty</label></div>
                                <div class="radio form-inline">
                                    <label><input type="radio" name="missing_opt" value="grade"> Grade as </label>
                                    <input type="number" id="missing_val" class="form-control input-sm" value="0" style="width:70px; margin-left:5px;">
                                </div>
                            </div>
                            <hr>
                            <div class="form-group">
                                <label>2. Students with empty grade in Excel:</label>
                                <div class="radio"><label><input type="radio" name="empty_opt" value="skip" checked> Leave empty</label></div>
                                <div class="radio form-inline">
                                    <label><input type="radio" name="empty_opt" value="grade"> Grade as </label>
                                    <input type="number" id="empty_val" class="form-control input-sm" value="0" style="width:70px; margin-left:5px;">
                                </div>
                                ${attendanceOptionHtml}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                            <button type="button" id="eis-final-process-btn" class="btn btn-primary">Process Grades</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        showBootstrapModal(modalHtml);

        $('#eis-final-process-btn').click(function () {
            var config = {
                missingOpt: $('input[name="missing_opt"]:checked').val(),
                missingVal: $('#missing_val').val(),
                emptyOpt: $('input[name="empty_opt"]:checked').val(),
                emptyVal: $('#empty_val').val()
            };
            $('#eis-grade-modal').modal('hide');
            fillGrades($, gradeMap, config);
        });
    }

    function getStudentNameIndex($) {
        var $headers = $('#student_list_table thead tr th');
        var index = -1;

        $headers.each(function (i) {
            var text = $(this).text().trim().toLowerCase();
            if (text.includes('name') || text.includes('student') || text.includes('exam code')) {
                index = i;
                return false;
            }
        });

        return index !== -1 ? index : 2;
    }

    function fillGrades($, gradeMap, config) {
        var $editBtn = $('#edit-grades-btn');
        if ($editBtn.is(':visible')) {
            $editBtn.click();
        }

        var $tableRows = $('#student_list_table tbody tr');
        var nameColIndex = getStudentNameIndex($);

        console.log("EIS Script: Page Name/ID column detected at index: " + nameColIndex);

        var stats = {
            matchedFilled: 0,
            emptyFilled: 0,
            emptyAttendance: 0,
            emptySkipped: 0,
            missingFilled: 0,
            missingSkipped: 0,
            totalStudents: 0
        };

        $tableRows.each(function () {
            var $tr = $(this);
            var $nameTd = $tr.find('td').eq(nameColIndex);

            if ($nameTd.length === 0) return;

            var htmlNameRaw = $nameTd.text();
            var htmlNameClean = cleanName(htmlNameRaw).toLowerCase();

            var $input = $tr.find('input[type="text"][name$="[points]"]');
            if ($input.length === 0) return;

            stats.totalStudents++;

            if (gradeMap.hasOwnProperty(htmlNameClean)) {
                var gradeValue = gradeMap[htmlNameClean];

                if (gradeValue !== "") {
                    updateInput($input, gradeValue);
                    visualSuccess($tr, $input);
                    stats.matchedFilled++;
                } else {
                    if (config.emptyOpt === 'grade') {
                        updateInput($input, config.emptyVal);
                        visualSuccess($tr, $input);
                        stats.emptyFilled++;
                    } else if (config.emptyOpt === 'attendance') {
                        var $chk = $tr.find('.attendance-checkbox');
                        if ($chk.length > 0) {
                            var isChecked = $chk.prop('checked') || $chk.parent().hasClass('checked');
                            if (isChecked) {
                                $chk.click();
                                $tr.css('background-color', '#f2dede');
                                stats.emptyAttendance++;
                            } else {
                                stats.emptyAttendance++;
                            }
                        } else {
                            stats.emptySkipped++;
                        }
                    } else {
                        stats.emptySkipped++;
                    }
                }

            } else {
                if (config.missingOpt === 'grade') {
                    updateInput($input, config.missingVal);
                    $tr.css('background-color', '#fcf8e3');
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
            <div class="modal fade" id="eis-grade-modal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                            <h4 class="modal-title text-center">Processing Complete</h4>
                        </div>
                        <div class="modal-body">
                            <ul class="list-group">
                                <li class="list-group-item">
                                    <strong>Total Students (on page):</strong>
                                    <span class="badge pull-right">${stats.totalStudents}</span>
                                </li>
                                <li class="list-group-item list-group-item-success">
                                    <strong>Matched & Filled:</strong>
                                    <span class="badge pull-right">${stats.matchedFilled}</span>
                                </li>
                            </ul>

                            <h5 style="font-weight: bold; margin-top: 15px;">Empty in Excel:</h5>
                            <ul class="list-group">
                                <li class="list-group-item">Filled with default <span class="badge pull-right">${stats.emptyFilled}</span></li>
                                <li class="list-group-item">Attendance Unchecked <span class="badge pull-right">${stats.emptyAttendance}</span></li>
                                <li class="list-group-item">Skipped <span class="badge pull-right">${stats.emptySkipped}</span></li>
                            </ul>

                            <h5 style="font-weight: bold; margin-top: 15px;">Missing in Excel:</h5>
                            <ul class="list-group">
                                <li class="list-group-item">Filled with default <span class="badge pull-right">${stats.missingFilled}</span></li>
                                <li class="list-group-item">Skipped <span class="badge pull-right">${stats.missingSkipped}</span></li>
                            </ul>
                        </div>
                        <div class="modal-footer" style="text-align: center;">
                            <button type="button" class="btn btn-primary" data-dismiss="modal" style="min-width: 100px;">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        showBootstrapModal(modalHtml);
    }

    function updateInput($input, val) {
        $input.val(val);
        $input.trigger('change');
        $input.trigger('input');
        $input.trigger('blur');
    }

    function visualSuccess($tr, $input) {
        $tr.css('background-color', '#dff0d8');
        $input.css('border', '2px solid #3c763d');
    }

})();