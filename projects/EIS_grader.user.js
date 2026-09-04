// ==UserScript==
// @name         EIS Grade Autofiller
// @namespace    https://bredliplaku.com/
// @version      2.2
// @description  Matches names/IDs, fills grades from Excel or Clipboard to EIS with multi-column support, flexible empty grade handling (zero/empty per student or for all), and clean preview
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
        if (window.jQuery && window.jQuery('#edit-grades-btn').length > 0) {
            init();
            return;
        }

        var observer = new MutationObserver(function (mutations, me) {
            if (window.jQuery && window.jQuery('#edit-grades-btn').length > 0) {
                me.disconnect();
                init();
            }
        });

        observer.observe(document, {
            childList: true,
            subtree: true
        });
    }

    waitForTarget();

    function init() {
        var $ = window.jQuery;
        var $editBtn = $('#edit-grades-btn');
        if ($editBtn.length === 0) return;

        // Clean up any stale overlays or backdrops from previous runs or page refreshes
        $('#eis-grade-modal, .modal-backdrop, .blockUI, .blockOverlay').remove();
        $('body').removeClass('modal-open').css('overflow', '');

        // Global delegated handlers to guarantee modal closes under all circumstances
        $(document).off('click.eisModalClose').on('click.eisModalClose', '#eis-grade-modal [data-dismiss="modal"], #eis-grade-modal .close, #eis-grade-modal .eis-close-btn, #eis-report-done-btn, #eis-cancel-btn', function (e) {
            e.preventDefault();
            hideModal(window.jQuery);
        });

        $(document).off('click.eisBackdrop').on('click.eisBackdrop', '#eis-grade-modal', function (e) {
            if (e.target === this) {
                e.preventDefault();
                hideModal(window.jQuery);
            }
        });

        $(document).off('keydown.eisModal').on('keydown.eisModal', function (e) {
            if (e.key === 'Escape' && $('#eis-grade-modal').length > 0) {
                hideModal(window.jQuery);
            }
        });

        // 1. Inject instructions banner with support for Name, Exam ID, Quiz columns, etc.
        var infoHtml = `
            <div class="alert alert-info" style="margin-bottom: 20px; padding: 15px 20px; border-radius: 6px; font-size: 14px; line-height: 1.5; border-left: 5px solid #31708f;">
                <strong><i class="fa fa-info-circle"></i> Grade Autofiller Instructions:</strong><br>
                Ensure your Excel file or copied table has a header row. Label the student column as <b>Name</b>, <b>Exam ID</b>, <b>Exam Code</b>, or <b>ID</b>, and grade columns as <b>Quiz</b> (Quiz 1, Quiz 2, etc.), <b>Total</b>, <b>Grade</b>, or <b>Score</b>.<br>
                <span style="color: #31708f;"><em>Header matching is case-insensitive. When multiple grade columns are detected, you can choose which one to fill with an interactive preview before applying.</em></span>
            </div>
        `;
        $('#student_list_table').before(infoHtml);

        // 2. Button styling fix
        if ($('#eis-btn-fix').length === 0) {
            $('head').append(`
                <style id="eis-btn-fix">
                    #clear-grades-btn[style*="none"] + #eis-paste-grades-btn,
                    #clear-grades-btn[style*="none"] + .btn {
                        border-top-left-radius: 4px !important;
                        border-bottom-left-radius: 4px !important;
                    }
                    .eis-pill-btn {
                        margin-right: 5px;
                        margin-bottom: 6px;
                        border-radius: 15px !important;
                        font-size: 12px;
                        padding: 4px 12px;
                        transition: all 0.15s ease;
                    }
                    .eis-pill-btn.active {
                        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                        font-weight: bold;
                    }
                    .eis-preview-table th, .eis-preview-table td {
                        padding: 6px 10px !important;
                        font-size: 13px;
                    }
                    .eis-row-empty-group .btn {
                        line-height: 1.3 !important;
                        transition: all 0.1s ease-in-out;
                    }
                </style>
            `);
        }

        // 3. Create buttons
        var $pasteBtn = $('<button type="button" id="eis-paste-grades-btn" class="btn btn-info" title="Paste grades from clipboard or text table"><i class="fa fa-clipboard"></i> Paste Grades</button>');
        var $importBtn = $('<button type="button" id="eis-import-excel-btn" class="btn btn-success"><i class="fa fa-file-excel-o"></i> Import from Excel</button>');
        var $fileInput = $('<input type="file" accept=".xlsx, .xls, .csv" style="display:none;" />');
        $('body').append($fileInput);

        $editBtn.before($pasteBtn, $importBtn);

        // 4. Paste handler
        $pasteBtn.click(async function () {
            let clipboardText = '';
            try {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    clipboardText = await navigator.clipboard.readText();
                }
            } catch (err) {
                console.warn("Clipboard read failed or permission denied:", err);
            }

            if (clipboardText && clipboardText.trim() && (clipboardText.includes('\t') || clipboardText.includes('\n') || clipboardText.includes(','))) {
                var parsedRows = parseTextData(clipboardText);
                if (parsedRows.length >= 2) {
                    processParsedRows($, parsedRows, 'Clipboard');
                    return;
                }
            }

            // If clipboard was empty, not tabular, or read failed, open paste modal cleanly
            showPasteModal($);
        });

        // 5. Excel import handler
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
            $(this).val('');
        });
    }

    // Modal Container Management (Standalone zero-dependency modal to avoid missing $.fn.modal errors and black overlay leaks)
    function ensureModalContainer($) {
        // Thoroughly purge any previous modal or lingering dark overlay
        $('#eis-grade-modal, .modal-backdrop, .blockUI, .blockOverlay').remove();
        $('body').removeClass('modal-open').css('overflow', '');

        var $modal = $(`
            <div id="eis-grade-modal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.5); z-index: 999999; display: flex; justify-content: center; align-items: center; padding: 15px; box-sizing: border-box;">
                <div id="eis-grade-modal-dialog" style="background: #fff; width: 920px; max-width: 96vw; max-height: 92vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; overflow: hidden; position: relative;">
                    <div id="eis-grade-modal-content" style="display: flex; flex-direction: column; max-height: 92vh; overflow-y: auto;">
                    </div>
                </div>
            </div>
        `);
        $('body').append($modal);
        $('body').css('overflow', 'hidden');

        return $modal;
    }

    function showModalContent($, contentHtml) {
        var $modal = ensureModalContainer($);
        $('#eis-grade-modal-content').html(contentHtml);
        $modal.css('display', 'flex');
        $('body').css('overflow', 'hidden');

        // Explicitly bind close and cancel buttons directly within this modal instance
        $modal.find('[data-dismiss="modal"], .close, .eis-close-btn, #eis-cancel-btn, #eis-sheet-cancel-btn, #eis-paste-cancel-btn, #eis-report-done-btn').off('click.eisClose').on('click.eisClose', function (e) {
            e.preventDefault();
            hideModal($);
        });
    }

    function hideModal($) {
        $('#eis-grade-modal').remove();
        $('.modal-backdrop').remove();
        $('.blockUI, .blockOverlay').remove();
        $('body').removeClass('modal-open').css('overflow', '');
    }

    // Name & Text Normalization Helpers
    function cleanName(name) {
        if (name === null || name === undefined) return "";
        name = String(name).trim();
        return name.replace(/\s+(R|EX|R\s+EX)$/i, '').trim();
    }

    function normalizeText(text) {
        if (!text) return "";
        return String(text)
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ");
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Robust Text / Delimiter Parsing (Handles \r\n, \t, CSV commas, semicolons)
    function parseTextData(text) {
        if (!text || !text.trim()) return [];

        // Check if XLSX can read it directly (great for CSV / TSV / HTML)
        try {
            var wb = XLSX.read(text, { type: 'string' });
            if (wb && wb.SheetNames && wb.SheetNames.length > 0) {
                var sheet = wb.Sheets[wb.SheetNames[0]];
                var json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                if (json && json.length >= 2) {
                    return json.filter(row => row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""));
                }
            }
        } catch (e) {
            // Fallback to manual split
        }

        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        var lines = text.split('\n');
        if (lines.length === 0) return [];

        var firstLine = lines[0];
        var delimiter = '\t';
        if (!firstLine.includes('\t')) {
            if (firstLine.includes(';') && (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) {
                delimiter = ';';
            } else if (firstLine.includes(',')) {
                delimiter = ',';
            }
        }

        var rows = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.trim()) continue;
            var cols = line.split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, ''));
            rows.push(cols);
        }
        return rows;
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

    function showSheetSelector($, workbook) {
        var sheetButtons = workbook.SheetNames.map(function (name) {
            return '<button type="button" class="btn btn-default btn-block sheet-select-btn" data-sheet="' + name + '" style="text-align: left; margin-bottom: 8px; font-size: 14px; padding: 10px 15px;"><i class="fa fa-table text-success"></i> <b>' + name + '</b></button>';
        }).join('');

        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 15px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                <h4 class="modal-title" style="font-weight: bold;"><i class="fa fa-file-excel-o text-success"></i> Select Worksheet</h4>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <p class="text-muted" style="font-size: 14px; margin-bottom: 15px;">This file contains multiple sheets. Please choose the one with grades:</p>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${sheetButtons}
                </div>
            </div>
            <div class="modal-footer" style="padding: 12px 20px;">
                <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
            </div>
        `;

        showModalContent($, modalHtml);

        $('.sheet-select-btn').click(function () {
            var sheetName = $(this).data('sheet');
            processSheet($, workbook, sheetName);
        });
    }

    function processSheet($, workbook, sheetName) {
        var sheet = workbook.Sheets[sheetName];
        var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        var cleanRows = (jsonData || []).filter(row => row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""));
        processParsedRows($, cleanRows, 'Sheet: ' + sheetName);
    }

    function showPasteModal($) {
        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 15px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                <h4 class="modal-title" style="font-weight: bold;"><i class="fa fa-clipboard text-info"></i> Paste Grades</h4>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <p class="text-muted" style="font-size: 14px; margin-bottom: 10px;">
                    Copy your table from Excel or Google Sheets (including headers) and paste it below:
                </p>
                <textarea id="eis-paste-area" class="form-control" style="height: 180px; font-family: Consolas, Monaco, monospace; font-size: 13px; white-space: pre; resize: vertical;" placeholder="Click here and press Ctrl+V to paste table..."></textarea>
                <span id="eis-paste-msg" class="text-danger" style="font-weight: bold; display: block; margin-top: 8px;"></span>
            </div>
            <div class="modal-footer" style="padding: 12px 20px;">
                <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                <button type="button" id="eis-paste-next-btn" class="btn btn-primary" style="font-weight: bold;"><i class="fa fa-arrow-right"></i> Next: Preview & Choose Column</button>
            </div>
        `;

        showModalContent($, modalHtml);
        setTimeout(() => $('#eis-paste-area').focus(), 150);

        $('#eis-paste-next-btn').click(function () {
            var text = $('#eis-paste-area').val();
            if (!text.trim()) {
                $('#eis-paste-msg').text("Please paste data into the box first.");
                return;
            }
            var rows = parseTextData(text);
            if (rows.length < 2) {
                $('#eis-paste-msg').text("Could not detect multiple rows. Make sure headers and student rows are included.");
                return;
            }
            processParsedRows($, rows, 'Pasted Data');
        });
    }

    // Column Identification Rules
    function isStudentCol(header) {
        var h = normalizeText(header);
        return (
            h.includes('exam id') ||
            h.includes('exam code') ||
            h.includes('student id') ||
            h.includes('student code') ||
            h.includes('name') ||
            h.includes('student') ||
            h.includes('emri') ||
            h === 'id' ||
            h === 'code'
        );
    }

    function isGradeCol(header) {
        var h = normalizeText(header);
        return (
            /\bquiz\b/i.test(h) ||
            /\bquiz\s*\d+\b/i.test(h) ||
            /\bq\d+\b/i.test(h) ||
            h.includes('total') ||
            h.includes('grade') ||
            h.includes('points') ||
            h.includes('score') ||
            h.includes('mark') ||
            h.includes('midterm') ||
            h.includes('final') ||
            h.includes('assignment') ||
            h.includes('hw') ||
            h.includes('homework') ||
            h.includes('project') ||
            h.includes('lab')
        );
    }

    function detectColumns(rows) {
        var scanLimit = Math.min(rows.length, 20);
        var bestHeaderRowIdx = -1;
        var maxScore = -1;
        var detectedStudentCols = [];
        var detectedGradeCols = [];

        for (var r = 0; r < scanLimit; r++) {
            var row = rows[r];
            if (!row || row.length === 0) continue;

            var studentCols = [];
            var gradeCols = [];

            for (var c = 0; c < row.length; c++) {
                var cell = row[c];
                if (cell === null || cell === undefined || String(cell).trim() === "") continue;
                if (isStudentCol(cell)) {
                    studentCols.push({ index: c, name: String(cell).trim() });
                } else if (isGradeCol(cell)) {
                    gradeCols.push({ index: c, name: String(cell).trim() });
                }
            }

            var score = (studentCols.length > 0 ? 10 : 0) + (gradeCols.length * 3);
            if (score > maxScore && studentCols.length > 0) {
                maxScore = score;
                bestHeaderRowIdx = r;
                detectedStudentCols = studentCols;
                detectedGradeCols = gradeCols;
            }
        }

        if (bestHeaderRowIdx === -1) {
            bestHeaderRowIdx = 0;
            detectedStudentCols = [{ index: 0, name: rows[0] && rows[0][0] ? String(rows[0][0]).trim() : "Column 1" }];
        }

        var headerRow = rows[bestHeaderRowIdx] || [];

        // All student candidates in header row
        var studentCandidates = [];
        for (var c = 0; c < headerRow.length; c++) {
            var cellVal = String(headerRow[c] || '').trim();
            if (isStudentCol(cellVal)) {
                studentCandidates.push({ index: c, name: cellVal });
            }
        }
        if (studentCandidates.length === 0 && headerRow.length > 0) {
            studentCandidates.push({ index: 0, name: String(headerRow[0] || 'Column 1').trim() });
        }

        // All grade candidates
        var gradeCandidates = [];
        for (var c = 0; c < headerRow.length; c++) {
            var cellVal = String(headerRow[c] || ('Column ' + (c + 1))).trim();
            // Don't auto-classify the primary student col as grade unless user forces it
            var isStudent = studentCandidates.some(s => s.index === c);
            var isSuggested = isGradeCol(cellVal);
            if (!isStudent || isSuggested) {
                gradeCandidates.push({
                    index: c,
                    name: cellVal,
                    isSuggested: isSuggested
                });
            }
        }

        return {
            headerRowIndex: bestHeaderRowIdx,
            studentCandidates: studentCandidates,
            gradeCandidates: gradeCandidates
        };
    }

    // Inspect EIS page table for students, Exam IDs, and points inputs
    function inspectPageStudents($) {
        var $headers = $('#student_list_table thead tr th');
        var nameColIndex = -1;
        var examIdColIndex = -1;

        $headers.each(function (i) {
            var text = $(this).text().trim().toLowerCase();
            if (text.includes('exam id') || text.includes('exam code') || text === 'id' || text === 'code' || text.includes('student id')) {
                if (examIdColIndex === -1) examIdColIndex = i;
            }
            if (text.includes('name') || text.includes('student') || text.includes('emri')) {
                if (nameColIndex === -1) nameColIndex = i;
            }
        });

        if (nameColIndex === -1) nameColIndex = 2; // Default fallback in EIS

        var pageStudents = [];
        $('#student_list_table tbody tr').each(function () {
            var $tr = $(this);
            var $nameTd = $tr.find('td').eq(nameColIndex);
            var rawName = $nameTd.length > 0 ? $nameTd.text().trim() : '';

            var examId = '';
            if (examIdColIndex !== -1) {
                var $idTd = $tr.find('td').eq(examIdColIndex);
                if ($idTd.length > 0) examId = $idTd.text().trim();
            }

            var clean = cleanName(rawName);
            var $input = $tr.find('input[type="text"][name$="[points]"]');
            var $attendance = $tr.find('.attendance-checkbox');

            pageStudents.push({
                $tr: $tr,
                rawName: rawName,
                cleanName: clean,
                normalizedName: normalizeText(clean),
                examId: examId,
                normalizedExamId: normalizeText(examId),
                $input: $input,
                $attendance: $attendance
            });
        });

        return {
            students: pageStudents,
            nameColIndex: nameColIndex,
            examIdColIndex: examIdColIndex
        };
    }

    // Student Matcher supporting Exact, Inverted Names, and Exam IDs
    function findPageStudent(query, pageStudents, preferExamId) {
        if (!query) return null;
        var qNorm = normalizeText(cleanName(query));
        if (!qNorm) return null;

        // 1. If preferExamId, check normalized exam ID first
        if (preferExamId) {
            for (var i = 0; i < pageStudents.length; i++) {
                if (pageStudents[i].normalizedExamId && pageStudents[i].normalizedExamId === qNorm) {
                    return pageStudents[i];
                }
            }
        }

        // 2. Direct name match
        for (var i = 0; i < pageStudents.length; i++) {
            if (pageStudents[i].normalizedName === qNorm) {
                return pageStudents[i];
            }
        }

        // 3. Inverted name match (Lastname, Firstname vs Firstname Lastname)
        var parts = qNorm.replace(/,/g, '').split(' ').filter(Boolean);
        if (parts.length === 2) {
            var inverted = parts[1] + ' ' + parts[0];
            for (var i = 0; i < pageStudents.length; i++) {
                if (pageStudents[i].normalizedName === inverted) {
                    return pageStudents[i];
                }
            }
        }

        // 4. Fallback check on Exam ID even if not preferred
        for (var i = 0; i < pageStudents.length; i++) {
            if (pageStudents[i].normalizedExamId && pageStudents[i].normalizedExamId === qNorm) {
                return pageStudents[i];
            }
        }

        return null;
    }

    // Main Processor for Parsed Rows: Detects Columns & Renders Interactive Preview
    function processParsedRows($, rows, sourceLabel) {
        if (!rows || rows.length < 2) {
            alert("No sufficient data rows found.");
            return;
        }

        var colInfo = detectColumns(rows);
        var pageInfo = inspectPageStudents($);

        // Determine default student column
        var defaultStudentColIdx = colInfo.studentCandidates[0].index;
        // If page has exam ID and one of the student candidates is exam ID, pick it
        for (var i = 0; i < colInfo.studentCandidates.length; i++) {
            var sName = normalizeText(colInfo.studentCandidates[i].name);
            if (pageInfo.examIdColIndex !== -1 && (sName.includes('exam id') || sName.includes('exam code') || sName === 'id' || sName === 'code')) {
                defaultStudentColIdx = colInfo.studentCandidates[i].index;
                break;
            }
        }

        // Determine default grade column
        var pageHeader = $('.form-header-title').text().toUpperCase();
        var defaultGradeColIdx = -1;

        // Try to match page header keywords (e.g. QUIZ 1, QUIZ 2, MIDTERM, TOTAL)
        for (var i = 0; i < colInfo.gradeCandidates.length; i++) {
            var candName = colInfo.gradeCandidates[i].name.toUpperCase();
            if (pageHeader.includes(candName) || candName.includes(pageHeader)) {
                defaultGradeColIdx = colInfo.gradeCandidates[i].index;
                break;
            }
        }

        // If no direct page header match, prefer first suggested grade column
        if (defaultGradeColIdx === -1) {
            var firstSuggested = colInfo.gradeCandidates.find(c => c.isSuggested);
            if (firstSuggested) {
                defaultGradeColIdx = firstSuggested.index;
            } else if (colInfo.gradeCandidates.length > 0) {
                defaultGradeColIdx = colInfo.gradeCandidates[0].index;
            } else {
                defaultGradeColIdx = rows[colInfo.headerRowIndex].length - 1;
            }
        }

        showColumnPickerAndPreview($, {
            rows: rows,
            headerRowIndex: colInfo.headerRowIndex,
            studentCandidates: colInfo.studentCandidates,
            gradeCandidates: colInfo.gradeCandidates,
            selectedStudentColIdx: defaultStudentColIdx,
            selectedGradeColIdx: defaultGradeColIdx,
            sourceLabel: sourceLabel,
            pageInfo: pageInfo,
            globalEmptyVal: 'zero',
            emptyOverrides: {}
        });
    }

    // Interactive Preview & Column Selection Modal
    function showColumnPickerAndPreview($, state) {
        state.globalEmptyVal = state.globalEmptyVal || 'zero';
        state.emptyOverrides = state.emptyOverrides || {};

        var rows = state.rows;
        var headerRow = rows[state.headerRowIndex];
        var pageStudents = state.pageInfo.students;

        // Determine if selected student column is Exam ID
        var currentStudentColName = normalizeText(headerRow[state.selectedStudentColIdx] || '');
        var preferExamId = currentStudentColName.includes('exam id') || currentStudentColName.includes('exam code') || currentStudentColName === 'id' || currentStudentColName === 'code';

        // Build data map for currently selected grade column
        var studentGradeMap = {};
        var sheetStudentEntries = [];

        for (var r = state.headerRowIndex + 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || row.length <= state.selectedStudentColIdx) continue;

            var rawStudent = row[state.selectedStudentColIdx];
            if (rawStudent === null || rawStudent === undefined || String(rawStudent).trim() === '') continue;

            var studentKey = String(rawStudent).trim();
            var rawGrade = (row.length > state.selectedGradeColIdx) ? row[state.selectedGradeColIdx] : '';
            var gradeVal = (rawGrade !== null && rawGrade !== undefined) ? String(rawGrade).trim() : '';

            studentGradeMap[studentKey] = gradeVal;
            sheetStudentEntries.push({
                sheetName: studentKey,
                gradeVal: gradeVal
            });
        }

        // Calculate match statistics with current page students
        var matchedCount = 0;
        var emptyGradeCount = 0;
        var previewList = [];

        for (var i = 0; i < sheetStudentEntries.length; i++) {
            var entry = sheetStudentEntries[i];
            var matchedPageStudent = findPageStudent(entry.sheetName, pageStudents, preferExamId);

            if (matchedPageStudent) {
                matchedCount++;
                if (entry.gradeVal === "") emptyGradeCount++;
            }

            // Include all sheet rows up to 100 for comprehensive preview
            if (previewList.length < 100) {
                previewList.push({
                    sheetName: entry.sheetName,
                    matchedName: matchedPageStudent ? matchedPageStudent.cleanName : null,
                    gradeVal: entry.gradeVal,
                    isMatched: !!matchedPageStudent
                });
            }
        }

        var missingInSheetCount = Math.max(0, pageStudents.length - matchedCount);

        // Grade column quick pills (up to 8 suggested columns)
        var suggestedPillsHtml = '';
        var suggestedCols = state.gradeCandidates.filter(c => c.isSuggested);
        if (suggestedCols.length === 0) suggestedCols = state.gradeCandidates.slice(0, 6);

        if (suggestedCols.length > 0) {
            suggestedPillsHtml = suggestedCols.map(function (c) {
                var activeClass = (c.index === state.selectedGradeColIdx) ? 'btn-primary active' : 'btn-default';
                return `<button type="button" class="btn btn-sm eis-pill-btn ${activeClass}" data-col-idx="${c.index}"><i class="fa fa-tag"></i> ${escapeHtml(c.name)}</button>`;
            }).join('');
        }

        // Grade column select dropdown options
        var gradeSelectOptions = state.gradeCandidates.map(function (c) {
            var sel = (c.index === state.selectedGradeColIdx) ? 'selected' : '';
            var badge = c.isSuggested ? ' ★' : '';
            return `<option value="${c.index}" ${sel}>${escapeHtml(c.name)}${badge}</option>`;
        }).join('');

        // Student column select dropdown options
        var studentSelectOptions = state.studentCandidates.map(function (s) {
            var sel = (s.index === state.selectedStudentColIdx) ? 'selected' : '';
            return `<option value="${s.index}" ${sel}>${escapeHtml(s.name)}</option>`;
        }).join('');

        // Build preview rows HTML
        // Reordered columns: # -> Sheet Student -> Grade to Fill -> Matched Page Student
        var previewRowsHtml = previewList.map(function (item, idx) {
            var statusBadge = item.isMatched
                ? `<span class="label label-success" style="display: inline-block; max-width: 215px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; font-size: 11px;" title="${escapeHtml(item.matchedName)}"><i class="fa fa-check"></i> ${escapeHtml(item.matchedName)}</span>`
                : `<span class="label label-warning" style="display: inline-block; max-width: 215px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; font-size: 11px;"><i class="fa fa-times"></i> Not found on page</span>`;

            var gradeDisplay = '';
            if (item.gradeVal !== "") {
                gradeDisplay = `<span class="badge" style="background-color: #337ab7; font-size: 13px; padding: 4px 10px;">${escapeHtml(item.gradeVal)}</span>`;
            } else {
                // Empty in sheet: interactive inline toggle [Empty | 0]
                var override = state.emptyOverrides[item.sheetName];
                var currentAction = override !== undefined ? override : (state.globalEmptyVal === 'skip' ? 'empty' : '0');
                var isZero = currentAction === '0';
                var isEmpty = currentAction === 'empty';

                gradeDisplay = `
                    <div class="eis-row-empty-group" data-student-key="${escapeHtml(item.sheetName)}" style="display: inline-flex; border: 1px solid #ccc; border-radius: 4px; overflow: hidden; vertical-align: middle;">
                        <button type="button" class="btn btn-xs eis-row-empty-btn ${isEmpty ? 'btn-warning active' : 'btn-default'}" style="padding: 2px 8px; font-size: 11px; border: none; border-radius: 0; box-shadow: none;">Empty</button>
                        <button type="button" class="btn btn-xs eis-row-zero-btn ${isZero ? 'btn-primary active' : 'btn-default'}" style="padding: 2px 10px; font-size: 11px; font-weight: bold; border: none; border-left: 1px solid #ccc; border-radius: 0; box-shadow: none;">0</button>
                    </div>
                `;
            }

            return `
                <tr>
                    <td class="text-muted text-center" style="width: 35px; vertical-align: middle;">${idx + 1}</td>
                    <td style="vertical-align: middle;"><b>${escapeHtml(item.sheetName)}</b></td>
                    <td class="text-center" style="width: 150px; vertical-align: middle;">${gradeDisplay}</td>
                    <td style="width: 230px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle;">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        // Form settings for attendance & missing students
        var headerText = $('.form-header-title').text().toUpperCase();
        var isExam = headerText.includes('MIDTERM') || headerText.includes('FINAL');
        var hasCheckboxes = $('.attendance-checkbox').length > 0;
        var attendanceOptionHtml = '';
        if (isExam && hasCheckboxes) {
            attendanceOptionHtml = `
                <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                    <input type="radio" name="eis_empty_opt" value="attendance" ${state.globalEmptyVal === 'attendance' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                    <span>Uncheck Attendance (mark absent)</span>
                </label>
            `;
        }

        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 14px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="font-size: 22px;">&times;</button>
                <h4 class="modal-title" style="font-weight: bold; color: #333;">
                    <i class="fa fa-check-square-o text-primary"></i> Grade Autofiller — Preview & Column Selection
                    <small class="text-muted" style="font-size: 12px; margin-left: 10px;">(${state.sourceLabel})</small>
                </h4>
            </div>
            <div class="modal-body" style="padding: 18px 20px 10px 20px;">
                <!-- Column Chooser Section -->
                <div style="background-color: #fcfcfc; border: 1px solid #e3e3e3; border-radius: 6px; padding: 12px 15px; margin-bottom: 15px;">
                    <div class="row">
                        <div class="col-md-7">
                            <label style="margin-bottom: 6px; font-size: 13px; color: #333;">
                                <i class="fa fa-list-ol text-primary"></i> <b>Grade Column to Fill:</b>
                            </label>
                            <div id="eis-pills-container" style="margin-bottom: 6px;">
                                ${suggestedPillsHtml}
                            </div>
                            <div class="form-inline" style="margin-top: 4px;">
                                <span class="text-muted" style="font-size: 12px;">All columns: </span>
                                <select id="eis-grade-col-select" class="form-control input-sm" style="max-width: 200px; display: inline-block;">
                                    ${gradeSelectOptions}
                                </select>
                            </div>
                        </div>
                        <div class="col-md-5" style="border-left: 1px solid #eee;">
                            <label style="margin-bottom: 6px; font-size: 13px; color: #333;">
                                <i class="fa fa-user text-info"></i> <b>Student Identifier Column:</b>
                            </label>
                            <div>
                                <select id="eis-student-col-select" class="form-control input-sm" style="width: 100%;">
                                    ${studentSelectOptions}
                                </select>
                            </div>
                            <div class="text-muted" style="font-size: 11px; margin-top: 6px;">
                                <i class="fa fa-info-circle"></i> Matches by Name, Exam ID, or Code.
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Match Statistics Badges -->
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <span class="label label-success" style="font-size: 12px; padding: 5px 9px;">
                            <i class="fa fa-check-circle"></i> <b id="eis-stat-matched">${matchedCount}</b> Matched
                        </span>
                        <span class="label label-warning" style="font-size: 12px; padding: 5px 9px; margin-left: 4px;">
                            <i class="fa fa-exclamation-triangle"></i> <b id="eis-stat-missing">${missingInSheetCount}</b> Missing in Sheet
                        </span>
                        <span class="label label-default" style="font-size: 12px; padding: 5px 9px; margin-left: 4px;">
                            <i class="fa fa-minus-circle"></i> <b id="eis-stat-empty">${emptyGradeCount}</b> Empty Grade in Sheet
                        </span>
                    </div>
                    <div class="text-muted" style="font-size: 12px;">
                        Page Students: <b>${pageStudents.length}</b> | Showing ${previewList.length} rows
                    </div>
                </div>

                <!-- Live Preview Table (Column order: #, Sheet Student, Grade to Fill, Matched Page Student) -->
                <div style="max-height: 240px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 15px; background: white;">
                    <table class="table table-condensed table-striped table-hover eis-preview-table" style="margin-bottom: 0;">
                        <thead style="background: #f5f5f5; position: sticky; top: 0; z-index: 1;">
                            <tr>
                                <th style="width: 35px; text-align: center;">#</th>
                                <th>Sheet Student</th>
                                <th class="text-center" style="width: 150px;">Grade to Fill</th>
                                <th style="width: 230px; max-width: 250px;">Matched Page Student</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${previewRowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Unscrambled Fill Options Card (Clean isolated flexbox, immune to theme CSS interference) -->
                <div style="display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px 16px;">
                    <!-- Missing in Sheet Column -->
                    <div style="flex: 1; min-width: 260px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333; font-size: 13px;">
                            <i class="fa fa-user-times text-warning"></i> Missing in Sheet (on page, not in sheet):
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_missing_opt" value="skip" checked style="margin: 0; cursor: pointer;">
                                <span>Leave empty (do not modify)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_missing_opt" value="grade" style="margin: 0; cursor: pointer;">
                                <span>Fill with grade:</span>
                                <input type="text" id="eis_missing_val" value="0" style="width: 50px; height: 24px; padding: 2px 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; margin-left: 4px;">
                            </label>
                        </div>
                    </div>

                    <!-- Empty Grade in Sheet Column -->
                    <div style="flex: 1; min-width: 260px; border-left: 1px solid #eee; padding-left: 16px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333; font-size: 13px;">
                            <i class="fa fa-minus-circle text-info"></i> Empty Grade in Sheet (default for all):
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_empty_opt" value="zero" ${state.globalEmptyVal === 'zero' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                <span><b>Fill as zero (0) for all</b></span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_empty_opt" value="skip" ${state.globalEmptyVal === 'skip' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                <span>Leave empty for all (skip)</span>
                            </label>
                            ${attendanceOptionHtml}
                            <div style="color: #666; font-size: 11px; margin-top: 4px; font-style: italic;">
                                <i class="fa fa-info-circle"></i> Click <b>[Empty]</b> or <b>[0]</b> in the table above to toggle individual students.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="padding: 12px 20px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
                <button type="button" class="btn btn-default pull-left" id="eis-change-data-btn">
                    <i class="fa fa-paste"></i> Re-paste / Change
                </button>
                <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                <button type="button" id="eis-execute-fill-btn" class="btn btn-success" style="font-weight: bold; min-width: 140px;">
                    <i class="fa fa-check"></i> Fill Grades (${matchedCount})
                </button>
            </div>
        `;

        showModalContent($, modalHtml);

        // Column selection pill click handler
        $('.eis-pill-btn').click(function () {
            var colIdx = parseInt($(this).data('col-idx'), 10);
            state.selectedGradeColIdx = colIdx;
            showColumnPickerAndPreview($, state);
        });

        // Column dropdown change handler
        $('#eis-grade-col-select').change(function () {
            state.selectedGradeColIdx = parseInt($(this).val(), 10);
            showColumnPickerAndPreview($, state);
        });

        // Student column dropdown change handler
        $('#eis-student-col-select').change(function () {
            state.selectedStudentColIdx = parseInt($(this).val(), 10);
            showColumnPickerAndPreview($, state);
        });

        // Individual row toggle: Empty button click
        $('.eis-row-empty-btn').click(function (e) {
            e.preventDefault();
            var $group = $(this).closest('.eis-row-empty-group');
            var studentKey = $group.data('student-key');
            state.emptyOverrides[studentKey] = 'empty';
            $group.find('.eis-row-empty-btn').removeClass('btn-default').addClass('btn-warning active');
            $group.find('.eis-row-zero-btn').removeClass('btn-primary active').addClass('btn-default');
        });

        // Individual row toggle: 0 button click
        $('.eis-row-zero-btn').click(function (e) {
            e.preventDefault();
            var $group = $(this).closest('.eis-row-empty-group');
            var studentKey = $group.data('student-key');
            state.emptyOverrides[studentKey] = '0';
            $group.find('.eis-row-zero-btn').removeClass('btn-default').addClass('btn-primary active');
            $group.find('.eis-row-empty-btn').removeClass('btn-warning active').addClass('btn-default');
        });

        // Global empty radio change handler
        $('input[name="eis_empty_opt"]').change(function () {
            var val = $(this).val();
            state.globalEmptyVal = val;
            state.emptyOverrides = {}; // Reset individual overrides to follow new global choice
            if (val === 'zero') {
                $('.eis-row-empty-group').each(function () {
                    $(this).find('.eis-row-zero-btn').removeClass('btn-default').addClass('btn-primary active');
                    $(this).find('.eis-row-empty-btn').removeClass('btn-warning active').addClass('btn-default');
                });
            } else if (val === 'skip') {
                $('.eis-row-empty-group').each(function () {
                    $(this).find('.eis-row-empty-btn').removeClass('btn-default').addClass('btn-warning active');
                    $(this).find('.eis-row-zero-btn').removeClass('btn-primary active').addClass('btn-default');
                });
            }
        });

        // Change data button (allows going back to manual paste)
        $('#eis-change-data-btn').click(function () {
            showPasteModal($);
        });

        // Final Confirm & Fill button
        $('#eis-execute-fill-btn').click(function () {
            var config = {
                missingOpt: $('input[name="eis_missing_opt"]:checked').val(),
                missingVal: $('#eis_missing_val').val(),
                emptyOpt: state.globalEmptyVal || $('input[name="eis_empty_opt"]:checked').val(),
                emptyVal: '0',
                emptyOverrides: state.emptyOverrides || {},
                preferExamId: preferExamId
            };

            hideModal($);
            fillGrades($, studentGradeMap, state.pageInfo, config);
        });
    }

    // Input and Style Update Helpers
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

    // Fill Grades into EIS Table
    function fillGrades($, gradeMap, pageInfo, config) {
        var $editBtn = $('#edit-grades-btn');
        if ($editBtn.is(':visible')) {
            $editBtn.click();
        }

        var pageStudents = pageInfo.students;
        var stats = {
            matchedFilled: 0,
            emptyFilled: 0,
            emptyAttendance: 0,
            emptySkipped: 0,
            missingFilled: 0,
            missingSkipped: 0,
            totalStudents: pageStudents.length
        };

        // Track changes for Undo functionality
        var previousStates = [];

        for (var i = 0; i < pageStudents.length; i++) {
            var student = pageStudents[i];
            var $tr = student.$tr;
            var $input = student.$input;
            var $chk = student.$attendance;

            if ($input.length === 0) continue;

            // Save previous state for undo
            var prevVal = $input.val();
            var prevBg = $tr.css('background-color');
            var prevBorder = $input.css('border');
            var prevChecked = $chk.length > 0 ? ($chk.prop('checked') || $chk.parent().hasClass('checked')) : false;

            previousStates.push({
                $tr: $tr,
                $input: $input,
                $chk: $chk,
                val: prevVal,
                bg: prevBg,
                border: prevBorder,
                checked: prevChecked
            });

            // Check if this student is in gradeMap
            // Check direct match, normalized name, or exam ID
            var matchedGrade = undefined;

            if (gradeMap.hasOwnProperty(student.rawName)) {
                matchedGrade = gradeMap[student.rawName];
            } else if (gradeMap.hasOwnProperty(student.cleanName)) {
                matchedGrade = gradeMap[student.cleanName];
            } else if (config.preferExamId && student.examId && gradeMap.hasOwnProperty(student.examId)) {
                matchedGrade = gradeMap[student.examId];
            } else {
                // Search normalized keys in gradeMap
                var keys = Object.keys(gradeMap);
                for (var k = 0; k < keys.length; k++) {
                    var keyNorm = normalizeText(cleanName(keys[k]));
                    if (keyNorm === student.normalizedName || (config.preferExamId && student.normalizedExamId && keyNorm === student.normalizedExamId)) {
                        matchedGrade = gradeMap[keys[k]];
                        break;
                    }
                    // Inverted match
                    var kParts = keyNorm.replace(/,/g, '').split(' ').filter(Boolean);
                    if (kParts.length === 2 && (kParts[1] + ' ' + kParts[0]) === student.normalizedName) {
                        matchedGrade = gradeMap[keys[k]];
                        break;
                    }
                }
            }

            if (matchedGrade !== undefined) {
                if (matchedGrade !== "") {
                    updateInput($input, matchedGrade);
                    visualSuccess($tr, $input);
                    stats.matchedFilled++;
                } else {
                    // Empty grade in sheet: check individual override first, then fallback to global option
                    var override = config.emptyOverrides ? (config.emptyOverrides[student.rawName] || config.emptyOverrides[student.cleanName]) : null;
                    if (!override && config.emptyOverrides) {
                        var ovKeys = Object.keys(config.emptyOverrides);
                        for (var ok = 0; ok < ovKeys.length; ok++) {
                            if (normalizeText(cleanName(ovKeys[ok])) === student.normalizedName) {
                                override = config.emptyOverrides[ovKeys[ok]];
                                break;
                            }
                        }
                    }

                    var action = override || config.emptyOpt;

                    if (action === '0' || action === 'zero') {
                        updateInput($input, '0');
                        visualSuccess($tr, $input);
                        stats.emptyFilled++;
                    } else if (action === 'attendance') {
                        if ($chk.length > 0) {
                            var isChecked = $chk.prop('checked') || $chk.parent().hasClass('checked');
                            if (isChecked) {
                                $chk.click();
                                $tr.css('background-color', '#f2dede');
                            }
                            stats.emptyAttendance++;
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
        }

        showReportModal($, stats, previousStates);
    }

    // Completion Report Modal with Undo Functionality
    function showReportModal($, stats, previousStates) {
        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 15px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                <h4 class="modal-title text-center" style="font-weight: bold; color: #333;">
                    <i class="fa fa-check-circle text-success"></i> Processing Complete
                </h4>
            </div>
            <div class="modal-body" style="padding: 20px;">
                <ul class="list-group" style="margin-bottom: 15px;">
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>Total Students on Page:</strong>
                        <span class="badge" style="font-size: 13px;">${stats.totalStudents}</span>
                    </li>
                    <li class="list-group-item list-group-item-success" style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>Matched & Filled:</strong>
                        <span class="badge" style="background-color: #5cb85c; font-size: 13px;">${stats.matchedFilled}</span>
                    </li>
                </ul>

                <h5 style="font-weight: bold; margin-top: 15px; color: #555;">Empty in Sheet:</h5>
                <ul class="list-group" style="margin-bottom: 15px; font-size: 13px;">
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">Filled with 0 or value: <span class="badge">${stats.emptyFilled}</span></li>
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">Attendance Unchecked: <span class="badge">${stats.emptyAttendance}</span></li>
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">Skipped (left empty): <span class="badge">${stats.emptySkipped}</span></li>
                </ul>

                <h5 style="font-weight: bold; margin-top: 15px; color: #555;">Missing in Sheet:</h5>
                <ul class="list-group" style="font-size: 13px;">
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">Filled with default: <span class="badge">${stats.missingFilled}</span></li>
                    <li class="list-group-item" style="display:flex; justify-content:space-between; align-items:center;">Skipped: <span class="badge">${stats.missingSkipped}</span></li>
                </ul>
            </div>
            <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; padding: 12px 20px;">
                <button type="button" class="btn btn-warning" id="eis-undo-btn" style="font-weight: bold;">
                    <i class="fa fa-undo"></i> Undo Changes
                </button>
                <button type="button" class="btn btn-primary eis-close-btn" id="eis-report-done-btn" data-dismiss="modal" style="min-width: 100px; font-weight: bold;">
                    Done
                </button>
            </div>
        `;

        showModalContent($, modalHtml);

        $('#eis-report-done-btn').click(function (e) {
            e.preventDefault();
            hideModal($);
        });

        $('#eis-undo-btn').click(function () {
            if (!confirm("Are you sure you want to revert all changes made by the autofiller?")) return;

            for (var i = 0; i < previousStates.length; i++) {
                var prev = previousStates[i];
                updateInput(prev.$input, prev.val);
                prev.$tr.css('background-color', prev.bg);
                prev.$input.css('border', prev.border);

                if (prev.$chk.length > 0) {
                    var currentChecked = prev.$chk.prop('checked') || prev.$chk.parent().hasClass('checked');
                    if (currentChecked !== prev.checked) {
                        prev.$chk.click();
                    }
                }
            }

            hideModal($);
            alert("All autofilled grades have been reverted.");
        });
    }

})();
