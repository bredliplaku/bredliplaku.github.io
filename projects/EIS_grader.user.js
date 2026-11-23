// ==UserScript==
// @name         EIS Grade Autofiller
// @namespace    https://bredliplaku.com/
// @version      2.4
// @description  Matches names/IDs (with fuzzy matching), fills grades from Excel, CSV, drag & drop or clipboard into EIS, with a preview that flags problems, protects existing grades and remembers your settings
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

    var SETTINGS_KEY = 'eisGradeAutofiller.settings';
    var HELP_COLLAPSED_KEY = 'eisGradeAutofiller.helpCollapsed';
    var POINTS_INPUT = 'input[type="text"][name$="[points]"]';
    var FILE_EXT_RE = /\.(xlsx|xlsm|xls|csv|tsv|ods)$/i;

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
        if ($('#eis-paste-grades-btn').length > 0) return; // already initialised

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

        injectStyles($);
        injectHelpBanner($);

        // Buttons
        var $pasteBtn = $('<button type="button" id="eis-paste-grades-btn" class="btn btn-info" title="Paste grades from clipboard or text table"><i class="fa fa-clipboard"></i> Paste Grades</button>');
        var $importBtn = $('<button type="button" id="eis-import-excel-btn" class="btn btn-success" title="Import an Excel/CSV file (you can also drag it onto the page)"><i class="fa fa-file-excel-o"></i> Import from Excel</button>');
        var $fileInput = $('<input type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.ods" style="display:none;" />');
        $('body').append($fileInput);

        $editBtn.before($pasteBtn, $importBtn);

        // Paste handler
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

        // Excel import handler
        $importBtn.click(function () {
            $fileInput.click();
        });

        $fileInput.change(function (e) {
            var file = e.target.files[0];
            if (file) readGradeFile($, file);
            $(this).val('');
        });

        setupDragAndDrop($);
    }

    // ---------------------------------------------------------------------
    // Page decorations: styles, help banner, drag & drop
    // ---------------------------------------------------------------------

    function injectStyles($) {
        if ($('#eis-autofill-styles').length > 0) return;
        $('head').append(`
            <style id="eis-autofill-styles">
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
                    vertical-align: middle !important;
                }
                .eis-row-empty-group {
                    display: inline-flex;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    overflow: hidden;
                    vertical-align: middle;
                }
                .eis-row-empty-group .btn {
                    line-height: 1.3 !important;
                    padding: 2px 8px !important;
                    font-size: 11px !important;
                    border: none !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                    transition: all 0.1s ease-in-out;
                }
                .eis-row-empty-group .btn + .btn {
                    border-left: 1px solid #ccc !important;
                }
                .eis-row-empty-group .btn.active {
                    font-weight: bold;
                }
                .eis-trunc {
                    display: inline-block;
                    max-width: 230px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    vertical-align: middle;
                    font-size: 11px;
                }
                .eis-preview-table tr.eis-row-dup td {
                    opacity: 0.55;
                }
                .eis-preview-table tr.eis-row-page td {
                    background-color: #fffcf0;
                }
                .eis-reject-btn, .eis-unreject-btn {
                    padding: 0 4px !important;
                    vertical-align: middle;
                }
                .eis-reject-btn {
                    color: #a94442 !important;
                }
                #eis-grade-modal details > summary {
                    cursor: pointer;
                    outline: none;
                }
                #eis-grade-modal .btn[disabled] {
                    cursor: not-allowed;
                }
                #eis-drop-overlay {
                    display: none;
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 1000000;
                    background: rgba(49, 112, 143, 0.88);
                    color: #fff;
                    align-items: center;
                    justify-content: center;
                    flex-direction: column;
                    font-size: 22px;
                    font-weight: bold;
                    border: 4px dashed #fff;
                    box-sizing: border-box;
                }
                #eis-drop-overlay * {
                    pointer-events: none;
                }
            </style>
        `);
    }

    function injectHelpBanner($) {
        $('#eis-autofill-help').remove();
        var html = `
            <div id="eis-autofill-help" class="alert alert-info" style="margin-bottom: 20px; padding: 10px 20px; border-radius: 6px; font-size: 14px; line-height: 1.5; border-left: 5px solid #31708f;">
                <div id="eis-help-toggle" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;" title="Show or hide the instructions">
                    <strong><i class="fa fa-info-circle"></i> Grade Autofiller</strong>
                    <span style="font-size: 12px; color: #31708f;"><span id="eis-help-label"></span> <i id="eis-help-icon" class="fa"></i></span>
                </div>
                <div id="eis-help-body" style="margin-top: 8px;">
                    Make sure your Excel file or copied table has a header row. Label the student column as <b>Name</b>, <b>Exam ID</b>, <b>Exam Code</b>, <b>Student ID</b> or <b>ID</b>, and grade columns as <b>Quiz</b> (Quiz 1, Quiz 2, etc.), <b>Total</b>, <b>Grade</b>, <b>Score</b>, <b>Midterm</b> or <b>Final</b>.<br>
                    Use <b>Paste Grades</b>, <b>Import from Excel</b>, or just <b>drag an Excel/CSV file onto this page</b>.<br>
                    <span style="color: #31708f;"><em>Header matching is case-insensitive. You always get a preview, with problems flagged, before anything is filled.</em></span>
                </div>
            </div>
        `;
        $('#student_list_table').before(html);
        applyHelpState($, storageGet(HELP_COLLAPSED_KEY) === '1');

        $('#eis-help-toggle').on('click', function () {
            var collapse = $('#eis-help-body').is(':visible');
            applyHelpState($, collapse);
            storageSet(HELP_COLLAPSED_KEY, collapse ? '1' : '0');
        });
    }

    function applyHelpState($, collapsed) {
        $('#eis-help-body').toggle(!collapsed);
        $('#eis-help-label').text(collapsed ? 'Show help' : 'Hide help');
        $('#eis-help-icon').attr('class', 'fa ' + (collapsed ? 'fa-chevron-down' : 'fa-chevron-up'));
    }

    function setupDragAndDrop($) {
        if ($('#eis-drop-overlay').length > 0) return;

        var $overlay = $('<div id="eis-drop-overlay"><i class="fa fa-file-excel-o" style="font-size: 56px; margin-bottom: 14px;"></i><div>Drop your Excel / CSV file to import grades</div></div>');
        $('body').append($overlay);

        function isFileDrag(e) {
            var dt = e.originalEvent && e.originalEvent.dataTransfer;
            return !!(dt && dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1);
        }

        $(window).off('.eisDrop');
        $(window).on('dragenter.eisDrop', function (e) {
            if (isFileDrag(e)) $overlay.css('display', 'flex');
        });
        $(window).on('dragover.eisDrop', function (e) {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.originalEvent.dataTransfer.dropEffect = 'copy';
        });
        $(window).on('drop.eisDrop', function (e) {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            $overlay.hide();
            var files = e.originalEvent.dataTransfer.files;
            if (files && files.length > 0) readGradeFile($, files[0]);
        });
        $(window).on('dragend.eisDrop', function () {
            $overlay.hide();
        });
        $overlay.on('dragleave', function (e) {
            if (e.target === this) $overlay.hide();
        });
        $overlay.on('click', function () {
            $overlay.hide();
        });
    }

    // ---------------------------------------------------------------------
    // Storage helpers (remembered settings)
    // ---------------------------------------------------------------------

    function storageGet(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, val) {
        try { window.localStorage.setItem(key, val); } catch (e) { /* storage unavailable */ }
    }

    function loadSettings() {
        try { return JSON.parse(storageGet(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
    }

    function saveSettings(patch) {
        var s = loadSettings();
        for (var k in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
        }
        storageSet(SETTINGS_KEY, JSON.stringify(s));
    }

    // ---------------------------------------------------------------------
    // Modal container management (standalone, no $.fn.modal dependency)
    // ---------------------------------------------------------------------

    function ensureModalContainer($) {
        // Thoroughly purge any previous modal or lingering dark overlay
        $('#eis-grade-modal, .modal-backdrop, .blockUI, .blockOverlay').remove();
        $('body').removeClass('modal-open').css('overflow', '');

        var $modal = $(`
            <div id="eis-grade-modal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.5); z-index: 999999; display: flex; justify-content: center; align-items: center; padding: 15px; box-sizing: border-box;">
                <div id="eis-grade-modal-dialog" style="background: #fff; width: 960px; max-width: 96vw; max-height: 92vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; overflow: hidden; position: relative;">
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
        // Reuse the open modal when re-rendering (no flicker, keeps scroll restorable)
        var $modal = $('#eis-grade-modal');
        if ($modal.length === 0) $modal = ensureModalContainer($);

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

    // ---------------------------------------------------------------------
    // Text, name, ID and grade helpers
    // ---------------------------------------------------------------------

    function cleanName(name) {
        if (name === null || name === undefined) return "";
        name = String(name).trim();
        return name.replace(/\s+(R|EX|R\s+EX)$/i, '').trim();
    }

    function normalizeText(text) {
        if (text === null || text === undefined || text === '') return "";
        return String(text)
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
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

    // Name split into normalized words (accents, case, punctuation ignored)
    function nameTokens(text) {
        return normalizeText(cleanName(text))
            .replace(/[,.;:\-_'"`()[\]\/]/g, ' ')
            .split(' ')
            .filter(Boolean);
    }

    function sortedKey(tokens) {
        return tokens.slice().sort().join(' ');
    }

    // Normalized ID: case/space/dash-insensitive, and "00123" == "123" (Excel drops leading zeros)
    function idKey(text) {
        if (text === null || text === undefined) return '';
        var k = normalizeText(String(text)).replace(/[\s\-_.\/]/g, '');
        if (/^\d+$/.test(k)) k = k.replace(/^0+(?=\d)/, '');
        return k;
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        var prev = [], cur = [], i, j;
        for (j = 0; j <= b.length; j++) prev[j] = j;
        for (i = 1; i <= a.length; i++) {
            cur[0] = i;
            for (j = 1; j <= b.length; j++) {
                var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            }
            var tmp = prev; prev = cur; cur = tmp;
        }
        return prev[b.length];
    }

    // Classify a sheet cell as valid number / empty / invalid; converts "7,5" -> "7.5"
    function parseGrade(raw) {
        if (raw === null || raw === undefined) return { kind: 'empty', raw: '' };
        if (typeof raw === 'number') {
            if (!isFinite(raw) || raw < 0) return { kind: 'invalid', raw: String(raw) };
            return { kind: 'valid', value: String(parseFloat(raw.toFixed(6))), raw: String(raw) };
        }
        var s = String(raw).trim();
        if (s === '') return { kind: 'empty', raw: '' };
        var t = s.replace(/\s+/g, '');
        if (/^\d*,\d+$/.test(t)) t = t.replace(',', '.');
        if (/^(\d+(\.\d*)?|\.\d+)$/.test(t)) {
            return { kind: 'valid', value: String(parseFloat(t)), raw: s, converted: s.indexOf(',') !== -1 };
        }
        return { kind: 'invalid', raw: s };
    }

    function sameGrade(a, b) {
        var pa = parseGrade(a), pb = parseGrade(b);
        if (pa.kind === 'valid' && pb.kind === 'valid') return pa.value === pb.value;
        return String(a === null || a === undefined ? '' : a).trim() === String(b === null || b === undefined ? '' : b).trim();
    }

    // Canonical form of a column/page label for comparing "Quiz 1", "Q1", "quiz01", ...
    function canonicalLabel(text) {
        var h = normalizeText(text).replace(/[#:_\-–—()[\]\/.,|]/g, ' ');
        h = h.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
        h = h.replace(/\bq (\d+)\b/g, 'quiz $1')
            .replace(/\bhw\b/g, 'homework')
            .replace(/\bmid term\b/g, 'midterm')
            .replace(/\b0+(\d)/g, '$1');
        return h.replace(/\s+/g, ' ').trim();
    }

    // Whole-word phrase containment, so "quiz 1" is NOT found inside "quiz 10"
    function containsPhrase(haystack, needle) {
        if (!needle || !haystack) return false;
        return (' ' + haystack + ' ').indexOf(' ' + needle + ' ') !== -1;
    }

    // ---------------------------------------------------------------------
    // Input parsing (paste / files / sheets)
    // ---------------------------------------------------------------------

    // Robust Text / Delimiter Parsing (Handles \r\n, \t, CSV commas, semicolons)
    function parseTextData(text) {
        if (!text || !text.trim()) return [];

        // Check if XLSX can read it directly (great for CSV / TSV / HTML).
        // raw: keep cells as text so "8,5" is not read as 85 and "00124" keeps its zeros.
        try {
            var wb = XLSX.read(text, { type: 'string', raw: true });
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

    function readGradeFile($, file) {
        if (!FILE_EXT_RE.test(file.name)) {
            alert('"' + file.name + '" is not a supported file.\nPlease use an Excel (.xlsx, .xls), OpenDocument (.ods) or CSV file.');
            return;
        }

        var reader = new FileReader();
        reader.onload = function (ev) {
            var workbook;
            try {
                // raw only affects CSV/TSV text files: keeps "8,5" from being read as 85
                workbook = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', raw: true });
            } catch (err) {
                console.error('EIS Grade Autofiller: could not parse file', err);
                alert('Could not read "' + file.name + '". Is it a valid Excel/CSV file?');
                return;
            }
            handleWorkbook($, workbook, file.name);
        };
        reader.onerror = function () {
            alert('Could not read "' + file.name + '".');
        };
        reader.readAsArrayBuffer(file);
    }

    function handleWorkbook($, workbook, fileName) {
        var sheetNames = workbook.SheetNames;
        if (!sheetNames || sheetNames.length === 0) {
            alert("No sheets found in the Excel file.");
            return;
        }

        if (sheetNames.length === 1) {
            processSheet($, workbook, sheetNames[0], fileName);
        } else {
            showSheetSelector($, workbook, fileName);
        }
    }

    function showSheetSelector($, workbook, fileName) {
        var sheetButtons = workbook.SheetNames.map(function (name) {
            return '<button type="button" class="btn btn-default btn-block sheet-select-btn" data-sheet="' + escapeHtml(name) + '" style="text-align: left; margin-bottom: 8px; font-size: 14px; padding: 10px 15px;"><i class="fa fa-table text-success"></i> <b>' + escapeHtml(name) + '</b></button>';
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
            processSheet($, workbook, $(this).attr('data-sheet'), fileName);
        });
    }

    function processSheet($, workbook, sheetName, fileName) {
        var sheet = workbook.Sheets[sheetName];
        var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        var cleanRows = (jsonData || []).filter(row => row && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ""));
        processParsedRows($, cleanRows, (fileName ? fileName + ' / ' : 'Sheet: ') + sheetName);
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
                <div class="text-muted" style="font-size: 12px; margin-top: 4px;">
                    <i class="fa fa-lightbulb-o"></i> Tip: press <b>Ctrl+Enter</b> to continue, or drag an Excel/CSV file straight onto the page.
                </div>
            </div>
            <div class="modal-footer" style="padding: 12px 20px;">
                <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
                <button type="button" id="eis-paste-next-btn" class="btn btn-primary" style="font-weight: bold;"><i class="fa fa-arrow-right"></i> Next: Preview & Choose Column</button>
            </div>
        `;

        showModalContent($, modalHtml);
        setTimeout(() => $('#eis-paste-area').focus(), 150);

        $('#eis-paste-area').on('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                $('#eis-paste-next-btn').click();
            }
        });

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

    // ---------------------------------------------------------------------
    // Column identification
    // ---------------------------------------------------------------------

    function isIdHeader(header) {
        var h = normalizeText(header);
        return (
            h.includes('exam id') ||
            h.includes('exam code') ||
            h.includes('student id') ||
            h.includes('student code') ||
            h === 'id' ||
            h === 'code'
        );
    }

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

        for (var r = 0; r < scanLimit; r++) {
            var row = rows[r];
            if (!row || row.length === 0) continue;

            var studentCount = 0;
            var gradeCount = 0;

            for (var c = 0; c < row.length; c++) {
                var cell = row[c];
                if (cell === null || cell === undefined || String(cell).trim() === "") continue;
                if (isStudentCol(cell)) {
                    studentCount++;
                } else if (isGradeCol(cell)) {
                    gradeCount++;
                }
            }

            var score = (studentCount > 0 ? 10 : 0) + (gradeCount * 3);
            if (score > maxScore && studentCount > 0) {
                maxScore = score;
                bestHeaderRowIdx = r;
            }
        }

        if (bestHeaderRowIdx === -1) bestHeaderRowIdx = 0;

        var headerRow = rows[bestHeaderRowIdx] || [];

        // All student candidates in header row
        var studentCandidates = [];
        for (var c2 = 0; c2 < headerRow.length; c2++) {
            var cellVal = String(headerRow[c2] || '').trim();
            if (isStudentCol(cellVal)) {
                studentCandidates.push({ index: c2, name: cellVal });
            }
        }
        if (studentCandidates.length === 0) {
            studentCandidates.push({ index: 0, name: String(headerRow[0] || 'Column 1').trim() });
        }

        // All grade candidates
        var gradeCandidates = [];
        for (var c3 = 0; c3 < headerRow.length; c3++) {
            var gVal = String(headerRow[c3] || ('Column ' + (c3 + 1))).trim();
            // Don't auto-classify the primary student col as grade unless it also looks like one
            var isStudent = studentCandidates.some(s => s.index === c3);
            var isSuggested = isGradeCol(gVal);
            if (!isStudent || isSuggested) {
                gradeCandidates.push({
                    index: c3,
                    name: gVal,
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

    // Pick the grade column matching the page title (e.g. page "QUIZ 10" -> column "Quiz 10", never "Quiz 1")
    function pickGradeColumnForPage(candidates, pageHeaderText) {
        var page = canonicalLabel(pageHeaderText);
        if (!page) return -1;

        var best = -1, bestScore = 0;
        candidates.forEach(function (c) {
            var name = canonicalLabel(c.name);
            if (!name) return;
            var score = 0;
            if (name === page) score = 1000;
            else if (containsPhrase(page, name)) score = 500 + name.length;
            else if (containsPhrase(name, page)) score = 300 + page.length;
            if (score > bestScore) {
                bestScore = score;
                best = c.index;
            }
        });
        return best;
    }

    // ---------------------------------------------------------------------
    // EIS page inspection
    // ---------------------------------------------------------------------

    function inspectPageStudents($) {
        var $headers = $('#student_list_table thead tr th');
        var nameColIndex = -1;
        var examIdColIndex = -1;

        $headers.each(function (i) {
            var text = $(this).text().trim().toLowerCase();
            if (isIdHeader(text)) {
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
            var $tds = $tr.find('td');
            var $nameTd = $tds.eq(nameColIndex);
            var rawName = $nameTd.length > 0 ? $nameTd.text().trim() : '';

            var examId = '';
            if (examIdColIndex !== -1) {
                var $idTd = $tds.eq(examIdColIndex);
                if ($idTd.length > 0) examId = $idTd.text().trim();
            }

            var $input = $tr.find(POINTS_INPUT);
            if (!rawName && !examId && $input.length === 0) return; // placeholder row like "No data"

            var clean = cleanName(rawName);
            var tokens = nameTokens(rawName);

            pageStudents.push({
                index: pageStudents.length,
                $tr: $tr,
                rawName: rawName,
                cleanName: clean,
                normalizedName: normalizeText(clean),
                nameTokens: tokens,
                sortedNameKey: sortedKey(tokens),
                examId: examId,
                idKey: idKey(examId),
                $input: $input,
                $attendance: $tr.find('.attendance-checkbox')
            });
        });

        return {
            students: pageStudents,
            nameColIndex: nameColIndex,
            examIdColIndex: examIdColIndex
        };
    }

    // Re-find the input if EIS re-rendered it (e.g. after entering edit mode)
    function getInput(student) {
        if (!student.$input || student.$input.length === 0 || !document.body.contains(student.$input[0])) {
            student.$input = student.$tr.find(POINTS_INPUT);
        }
        return student.$input;
    }

    function currentValue(student) {
        var $input = getInput(student);
        return $input.length > 0 ? String($input.val() || '').trim() : '';
    }

    function isChecked($chk) {
        return $chk.length > 0 && !!($chk.prop('checked') || $chk.parent().hasClass('checked'));
    }

    function displayName(s) {
        return s.cleanName || s.rawName || s.examId || '(no name)';
    }

    function studentLabel(s) {
        var n = s.cleanName || s.rawName || '(no name)';
        return s.examId ? n + ' [' + s.examId + ']' : n;
    }

    // ---------------------------------------------------------------------
    // Matching: exact (name in any order / ID) first, then cautious fuzzy
    // ---------------------------------------------------------------------

    function findExactStudent(query, pageStudents, preferExamId) {
        var q = normalizeText(cleanName(query));
        if (!q) return null;
        var qId = idKey(query);
        var i;

        function byId() {
            if (!qId) return null;
            for (var k = 0; k < pageStudents.length; k++) {
                if (pageStudents[k].idKey && pageStudents[k].idKey === qId) return pageStudents[k];
            }
            return null;
        }

        // 1. Exam ID first when the sheet column is an ID column
        if (preferExamId) {
            var byIdFirst = byId();
            if (byIdFirst) return byIdFirst;
        }

        // 2. Direct name match
        for (i = 0; i < pageStudents.length; i++) {
            if (pageStudents[i].normalizedName && pageStudents[i].normalizedName === q) return pageStudents[i];
        }

        // 3. Same words in any order ("Lastname, Firstname" vs "Firstname Lastname")
        var qSorted = sortedKey(nameTokens(query));
        if (qSorted) {
            for (i = 0; i < pageStudents.length; i++) {
                if (pageStudents[i].sortedNameKey === qSorted) return pageStudents[i];
            }
        }

        // 4. Exam ID fallback even if not preferred
        return byId();
    }

    function isTokenSubset(a, b) {
        if (a.length === b.length) return false;
        var sm = a.length < b.length ? a : b;
        var lg = a.length < b.length ? b : a;
        if (sm.length < 2) return false;
        return sm.every(function (t) { return lg.indexOf(t) !== -1; });
    }

    function findFuzzyStudent(query, pool) {
        var qTokens = nameTokens(query);
        if (qTokens.length < 2 || /\d/.test(qTokens.join(''))) return null; // never fuzzy-match IDs

        // a. Extra or missing middle name
        var subset = pool.filter(function (s) { return isTokenSubset(qTokens, s.nameTokens); });
        if (subset.length === 1) return { student: subset[0], reason: 'Partial name match (a middle/extra name differs)' };
        if (subset.length > 1) return null; // ambiguous

        // b. Small spelling differences
        var qSorted = sortedKey(qTokens), qPlain = qTokens.join(' ');
        var maxDist = qPlain.length >= 12 ? 2 : (qPlain.length >= 6 ? 1 : 0);
        if (maxDist === 0) return null;

        var best = null, bestD = Infinity, tie = false;
        pool.forEach(function (s) {
            if (!s.sortedNameKey) return;
            var d = Math.min(levenshtein(qSorted, s.sortedNameKey), levenshtein(qPlain, s.nameTokens.join(' ')));
            if (d < bestD) { best = s; bestD = d; tie = false; }
            else if (d === bestD) tie = true;
        });
        if (best && bestD <= maxDist && !tie) {
            return { student: best, reason: 'Similar spelling (' + bestD + ' letter' + (bestD > 1 ? 's' : '') + ' different)' };
        }
        return null;
    }

    function computeMatches(entries, pageStudents, preferExamId) {
        var result = entries.map(function () { return null; });
        var claimedBy = {};

        // Pass 1: exact matches. If a student appears twice, the later row wins and the earlier is flagged.
        entries.forEach(function (e, i) {
            var s = findExactStudent(e.key, pageStudents, preferExamId);
            if (!s) return;
            if (claimedBy[s.index] !== undefined) result[claimedBy[s.index]].overridden = true;
            result[i] = { student: s, quality: 'exact' };
            claimedBy[s.index] = i;
        });

        // Pass 2: fuzzy matches against students nobody claimed; only accept unambiguous ones
        var pool = pageStudents.filter(function (s) { return claimedBy[s.index] === undefined; });
        var fuzzy = {}, targetCount = {};
        entries.forEach(function (e, i) {
            if (result[i]) return;
            var f = findFuzzyStudent(e.key, pool);
            if (!f) return;
            fuzzy[i] = f;
            targetCount[f.student.index] = (targetCount[f.student.index] || 0) + 1;
        });
        Object.keys(fuzzy).forEach(function (i) {
            var f = fuzzy[i];
            if (targetCount[f.student.index] === 1) {
                result[i] = { student: f.student, quality: 'fuzzy', reason: f.reason };
            }
        });

        return result;
    }

    // ---------------------------------------------------------------------
    // Decision model: shared by the preview and the fill step
    // ---------------------------------------------------------------------

    function globalAction(globalEmptyVal) {
        if (globalEmptyVal === 'skip') return 'empty';
        if (globalEmptyVal === 'attendance') return 'absent';
        return '0';
    }

    function effectiveEmptyAction(state, key) {
        return Object.prototype.hasOwnProperty.call(state.emptyOverrides, key)
            ? state.emptyOverrides[key]
            : globalAction(state.globalEmptyVal);
    }

    // What will happen to one page student: set / absent / skip / keep / none
    function decide(student, entry, state, current) {
        var d;
        if (getInput(student).length === 0) {
            d = { type: 'none', cause: 'noInput' };
        } else if (entry) {
            if (entry.grade.kind === 'valid') {
                d = { type: 'set', value: entry.grade.value, cause: 'sheet' };
            } else {
                var act = effectiveEmptyAction(state, entry.key);
                if (act === '0') d = { type: 'set', value: '0', cause: 'empty0' };
                else if (act === 'absent' && student.$attendance.length > 0) d = { type: 'absent', cause: 'absent' };
                else d = { type: 'skip', cause: 'emptySkip' };
            }
        } else {
            var mv = parseGrade(state.missingVal);
            if (state.missingOpt === 'grade' && mv.kind === 'valid') d = { type: 'set', value: mv.value, cause: 'missingFill' };
            else d = { type: 'skip', cause: 'missingSkip' };
        }

        if (state.noOverwrite && current !== '' && (d.type === 'set' || d.type === 'absent')) {
            d = { type: 'keep', cause: 'existing' };
        }

        d.current = current;
        if (d.type === 'set') d.changes = !sameGrade(current, d.value);
        else if (d.type === 'absent') d.changes = isChecked(student.$attendance);
        else d.changes = false;
        return d;
    }

    function buildModel(state) {
        var rows = state.rows;
        var headerRow = rows[state.headerRowIndex] || [];
        var pageStudents = state.pageInfo.students;
        var sc = state.selectedStudentColIdx;
        var gc = state.selectedGradeColIdx;
        var preferExamId = isIdHeader(headerRow[sc] || '');

        var entries = [];
        for (var r = state.headerRowIndex + 1; r < rows.length; r++) {
            var row = rows[r];
            if (!row || row.length <= sc) continue;
            var rawStudent = row[sc];
            if (rawStudent === null || rawStudent === undefined || String(rawStudent).trim() === '') continue;
            entries.push({
                order: entries.length,
                key: String(rawStudent).trim(),
                grade: parseGrade(gc >= 0 && row.length > gc ? row[gc] : '')
            });
        }

        // Matching only depends on the student column, so cache it across re-renders
        if (!state._matchCache || state._matchCache.col !== sc) {
            state._matchCache = { col: sc, matches: computeMatches(entries, pageStudents, preferExamId) };
        }
        var matches = state._matchCache.matches;

        var assignments = {}; // page student index -> sheet entry
        entries.forEach(function (e, i) {
            var m = matches[i] || null;
            e.match = m;
            e.rejected = !!(m && m.quality === 'fuzzy' && state.rejected[e.key]);
            e.applied = !!(m && !m.overridden && !e.rejected);
            if (e.applied) assignments[m.student.index] = e;
        });

        var decisions = pageStudents.map(function (s) {
            return decide(s, assignments[s.index], state, currentValue(s));
        });

        var stats = { matched: 0, fuzzy: 0, notFound: 0, notInSheet: 0, emptyOrInvalid: 0, invalid: 0, duplicates: 0, overwrite: 0, changes: 0, kept: 0 };
        var display = [];

        // Severity: lower = shown first. 9 = fine.
        entries.forEach(function (e) {
            var sev;
            if (!e.match || e.rejected) { sev = 0; stats.notFound++; }
            else if (e.match.overridden) { sev = 1; stats.duplicates++; }
            else if (e.grade.kind === 'invalid') sev = 2;
            else if (e.match.quality === 'fuzzy') sev = 3;
            else if (e.grade.kind === 'empty') sev = 5;
            else sev = 9;

            if (e.applied) {
                stats.matched++;
                if (e.match.quality === 'fuzzy') stats.fuzzy++;
                if (e.grade.kind !== 'valid') stats.emptyOrInvalid++;
                if (e.grade.kind === 'invalid') stats.invalid++;
            }

            display.push({ kind: 'sheet', entry: e, decision: e.applied ? decisions[e.match.student.index] : null, sev: sev, order: e.order });
        });

        pageStudents.forEach(function (s) {
            if (assignments[s.index]) return;
            stats.notInSheet++;
            display.push({ kind: 'page', student: s, decision: decisions[s.index], sev: 4, order: s.index });
        });

        decisions.forEach(function (d) {
            if (d.changes) stats.changes++;
            if (d.type === 'set' && d.current !== '' && !sameGrade(d.current, d.value)) stats.overwrite++;
            if (d.type === 'keep') stats.kept++;
        });

        display.sort(function (a, b) {
            if (a.sev !== b.sev) return a.sev - b.sev;
            if (a.kind !== b.kind) return a.kind === 'sheet' ? -1 : 1;
            return a.order - b.order;
        });

        return {
            entries: entries,
            display: display,
            decisions: decisions,
            stats: stats,
            problemCount: display.filter(function (d) { return d.sev < 9; }).length
        };
    }

    // ---------------------------------------------------------------------
    // Preview rendering
    // ---------------------------------------------------------------------

    function processParsedRows($, rows, sourceLabel) {
        if (!rows || rows.length < 2) {
            alert("No sufficient data rows found.");
            return;
        }

        var colInfo = detectColumns(rows);
        var pageInfo = inspectPageStudents($);
        if (pageInfo.students.length === 0) {
            alert("No students were found in the table on this page.");
            return;
        }

        // Default student column: prefer an ID column when the page has exam IDs
        var defaultStudentColIdx = colInfo.studentCandidates[0].index;
        if (pageInfo.examIdColIndex !== -1) {
            for (var i = 0; i < colInfo.studentCandidates.length; i++) {
                if (isIdHeader(colInfo.studentCandidates[i].name)) {
                    defaultStudentColIdx = colInfo.studentCandidates[i].index;
                    break;
                }
            }
        }

        // Default grade column: the one matching the page title, else first suggested
        var pageHeader = $('.form-header-title').text();
        var defaultGradeColIdx = pickGradeColumnForPage(colInfo.gradeCandidates, pageHeader);
        if (defaultGradeColIdx === -1) {
            var firstSuggested = colInfo.gradeCandidates.find(c => c.isSuggested);
            if (firstSuggested) {
                defaultGradeColIdx = firstSuggested.index;
            } else if (colInfo.gradeCandidates.length > 0) {
                defaultGradeColIdx = colInfo.gradeCandidates[0].index;
            } else {
                defaultGradeColIdx = (rows[colInfo.headerRowIndex] || []).length - 1;
            }
        }

        var headerText = pageHeader.toUpperCase();
        var hasAbsentOpt = (headerText.includes('MIDTERM') || headerText.includes('FINAL')) && $('.attendance-checkbox').length > 0;

        var saved = loadSettings();
        var globalEmptyVal = ['zero', 'skip', 'attendance'].indexOf(saved.globalEmptyVal) !== -1 ? saved.globalEmptyVal : 'zero';
        if (globalEmptyVal === 'attendance' && !hasAbsentOpt) globalEmptyVal = 'zero';

        renderPreview($, {
            rows: rows,
            headerRowIndex: colInfo.headerRowIndex,
            studentCandidates: colInfo.studentCandidates,
            gradeCandidates: colInfo.gradeCandidates,
            selectedStudentColIdx: defaultStudentColIdx,
            selectedGradeColIdx: defaultGradeColIdx,
            sourceLabel: sourceLabel,
            pageInfo: pageInfo,
            hasAbsentOpt: hasAbsentOpt,
            globalEmptyVal: globalEmptyVal,
            missingOpt: saved.missingOpt === 'grade' ? 'grade' : 'skip',
            missingVal: (saved.missingVal !== undefined && saved.missingVal !== null) ? String(saved.missingVal) : '0',
            noOverwrite: !!saved.noOverwrite,
            problemsOnly: !!saved.problemsOnly,
            emptyOverrides: {},
            rejected: {}
        }, false);
    }

    function truncLabel(cls, icon, text, title) {
        return '<span class="label ' + cls + ' eis-trunc" title="' + escapeHtml(title || text) + '">' +
            (icon ? '<i class="fa ' + icon + '"></i> ' : '') + escapeHtml(text) + '</span>';
    }

    function gradeBadge(value, color) {
        return '<span class="badge" style="background-color: ' + (color || '#337ab7') + '; font-size: 13px; padding: 4px 10px;">' + escapeHtml(value) + '</span>';
    }

    function oldValuePrefix(current, newValue) {
        if (current === '' || sameGrade(current, newValue)) return '';
        return '<span class="text-muted" style="text-decoration: line-through;" title="Current grade on the page">' + escapeHtml(current) + '</span> ' +
            '<i class="fa fa-long-arrow-right text-muted"></i> ';
    }

    function keptLabel(current) {
        return '<span class="label label-default" title="Already has a grade on the page, so it is not overwritten"><i class="fa fa-lock"></i> kept ' + escapeHtml(current) + '</span>';
    }

    function renderActionToggle(key, act, hasAbsent) {
        function btn(action, label, activeCls, title) {
            var cls = act === action ? activeCls + ' active' : 'btn-default';
            return '<button type="button" class="btn btn-xs eis-row-act ' + cls + '" data-action="' + action + '" title="' + title + '">' + label + '</button>';
        }
        return '<div class="eis-row-empty-group" data-student-key="' + escapeHtml(key) + '">' +
            btn('empty', 'Empty', 'btn-warning', 'Leave the grade empty') +
            btn('0', '0', 'btn-primary', 'Fill with 0') +
            (hasAbsent ? btn('absent', 'Absent', 'btn-danger', 'Uncheck attendance (mark absent)') : '') +
            '</div>';
    }

    function sheetGradeCell(item, state) {
        var e = item.entry, d = item.decision;

        if (!e.applied) {
            var shown = e.grade.kind === 'empty' ? '&mdash;' : escapeHtml(e.grade.raw);
            return '<span class="text-muted" title="Not applied">' + shown + '</span>';
        }
        if (d.type === 'none') return '<span class="text-muted">no grade field</span>';
        if (d.type === 'keep') return keptLabel(d.current);

        if (e.grade.kind === 'valid') {
            var unchanged = d.current !== '' && sameGrade(d.current, d.value);
            return oldValuePrefix(d.current, d.value) + gradeBadge(d.value) +
                (e.grade.converted ? ' <i class="fa fa-exchange text-muted" title="Converted from ' + escapeHtml(e.grade.raw) + '"></i>' : '') +
                (unchanged ? ' <small class="text-muted">(no change)</small>' : '');
        }

        // Empty or not-a-number: per-student choice
        var act = effectiveEmptyAction(state, e.key);
        var html = '';
        if (e.grade.kind === 'invalid') {
            html += '<span class="label label-danger" style="margin-right: 4px;" title="Not a number. Choose what to do with it.">' + escapeHtml(e.grade.raw) + '</span>';
        }
        if (act === '0') html += oldValuePrefix(d.current, '0');
        return html + renderActionToggle(e.key, act, state.hasAbsentOpt);
    }

    function sheetMatchCell(item) {
        var e = item.entry, m = e.match;
        var keyAttr = ' data-student-key="' + escapeHtml(e.key) + '"';

        if (!m) return truncLabel('label-warning', 'fa-times', 'Not found on page');
        if (e.rejected) {
            return truncLabel('label-warning', 'fa-ban', 'Rejected: ' + displayName(m.student), studentLabel(m.student)) +
                ' <button type="button" class="btn btn-link btn-xs eis-unreject-btn"' + keyAttr + ' title="Use this match after all">undo</button>';
        }
        if (m.overridden) {
            return truncLabel('label-default', 'fa-clone', 'Duplicate: ' + displayName(m.student), 'This student appears again later in the sheet. The later row is used.');
        }
        if (m.quality === 'fuzzy') {
            return truncLabel('label-info', 'fa-question-circle', '≈ ' + displayName(m.student), studentLabel(m.student) + ' — ' + m.reason + '. Please double-check.') +
                ' <button type="button" class="btn btn-link btn-xs eis-reject-btn"' + keyAttr + ' title="Wrong student: do not use this match"><i class="fa fa-times"></i></button>';
        }
        return truncLabel('label-success', 'fa-check', displayName(m.student), studentLabel(m.student));
    }

    function pageGradeCell(d) {
        if (d.type === 'none') return '<span class="text-muted">no grade field</span>';
        if (d.type === 'keep') return keptLabel(d.current);
        if (d.type === 'set') return oldValuePrefix(d.current, d.value) + gradeBadge(d.value, '#8a6d3b');
        return '<span class="text-muted">left as is' + (d.current !== '' ? ' (' + escapeHtml(d.current) + ')' : '') + '</span>';
    }

    function previewRowHtml(item, state) {
        if (item.kind === 'sheet') {
            var trClass = { 0: 'warning', 1: 'eis-row-dup', 2: 'danger', 3: 'info' }[item.sev] || '';
            return '<tr class="' + trClass + '">' +
                '<td class="text-muted text-center" style="width: 40px;">' + (item.entry.order + 1) + '</td>' +
                '<td><b>' + escapeHtml(item.entry.key) + '</b></td>' +
                '<td class="text-center" style="width: 230px;">' + sheetGradeCell(item, state) + '</td>' +
                '<td style="width: 270px;">' + sheetMatchCell(item) + '</td>' +
                '</tr>';
        }
        var s = item.student;
        return '<tr class="eis-row-page">' +
            '<td class="text-muted text-center" style="width: 40px;">&ndash;</td>' +
            '<td><span class="text-muted"><em>Not in sheet</em></span></td>' +
            '<td class="text-center" style="width: 230px;">' + pageGradeCell(item.decision) + '</td>' +
            '<td style="width: 270px;">' + truncLabel('label-warning', 'fa-user-times', displayName(s), studentLabel(s)) + '</td>' +
            '</tr>';
    }

    function renderPreview($, state, keepScroll, focusTarget) {
        var model = buildModel(state);
        var st = model.stats;

        // Grade column quick pills
        var suggestedCols = state.gradeCandidates.filter(c => c.isSuggested);
        if (suggestedCols.length === 0) suggestedCols = state.gradeCandidates.slice(0, 6);
        var pillsHtml = suggestedCols.map(function (c) {
            var activeClass = (c.index === state.selectedGradeColIdx) ? 'btn-primary active' : 'btn-default';
            return '<button type="button" class="btn btn-sm eis-pill-btn ' + activeClass + '" data-col-idx="' + c.index + '"><i class="fa fa-tag"></i> ' + escapeHtml(c.name) + '</button>';
        }).join('');

        var gradeSelectOptions = state.gradeCandidates.map(function (c) {
            var sel = (c.index === state.selectedGradeColIdx) ? 'selected' : '';
            return '<option value="' + c.index + '" ' + sel + '>' + escapeHtml(c.name) + (c.isSuggested ? ' ★' : '') + '</option>';
        }).join('');

        var studentSelectOptions = state.studentCandidates.map(function (s) {
            var sel = (s.index === state.selectedStudentColIdx) ? 'selected' : '';
            return '<option value="' + s.index + '" ' + sel + '>' + escapeHtml(s.name) + '</option>';
        }).join('');

        // Stats badges
        function statBadge(cls, icon, n, text, title) {
            return '<span class="label ' + cls + '" style="font-size: 12px; padding: 5px 9px; margin: 0 4px 4px 0; display: inline-block;"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '><i class="fa ' + icon + '"></i> <b>' + n + '</b> ' + text + '</span>';
        }
        var mvParsed = parseGrade(state.missingVal);
        var missingFills = state.missingOpt === 'grade' && mvParsed.kind === 'valid';
        var statsHtml =
            statBadge('label-success', 'fa-check-circle', st.matched, 'Matched') +
            (st.fuzzy ? statBadge('label-info', 'fa-question-circle', st.fuzzy, 'Fuzzy (please check)', 'Matched by similar name. Use the x button to reject a wrong one.') : '') +
            (st.notFound ? statBadge('label-warning', 'fa-times-circle', st.notFound, 'Not found on page', 'Sheet rows that match no student on this page') : '') +
            statBadge('label-warning', 'fa-user-times', st.notInSheet, missingFills ? 'Not in sheet (will get ' + escapeHtml(mvParsed.value) + ')' : 'Not in sheet', 'Students on this page that are not in the sheet') +
            statBadge('label-default', 'fa-minus-circle', st.emptyOrInvalid, st.invalid ? 'Empty / not a number' : 'Empty grade') +
            (st.duplicates ? statBadge('label-default', 'fa-clone', st.duplicates, 'Duplicate rows', 'Same student appears more than once; the last row is used') : '') +
            (st.overwrite ? statBadge('label-danger', 'fa-refresh', st.overwrite, 'Will overwrite', 'Students who already have a different grade on the page') : '') +
            (st.kept ? statBadge('label-default', 'fa-lock', st.kept, 'Kept existing') : '');

        // Table rows
        var visible = state.problemsOnly ? model.display.filter(function (d) { return d.sev < 9; }) : model.display;
        var rowsHtml = visible.length
            ? visible.map(function (item) { return previewRowHtml(item, state); }).join('')
            : '<tr><td colspan="4" class="text-center ' + (state.problemsOnly ? 'text-success' : 'text-muted') + '" style="padding: 18px !important;">' +
              (state.problemsOnly ? '<i class="fa fa-check-circle"></i> Nothing needs attention: every row matched a student with a valid grade.' : 'No student rows found in the selected column.') +
              '</td></tr>';

        var attendanceOptionHtml = state.hasAbsentOpt ? `
                <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                    <input type="radio" name="eis_empty_opt" value="attendance" ${state.globalEmptyVal === 'attendance' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                    <span>Mark absent (uncheck attendance)</span>
                </label>` : '';

        var mvInvalid = state.missingOpt === 'grade' && !missingFills;

        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 14px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="font-size: 22px;">&times;</button>
                <h4 class="modal-title" style="font-weight: bold; color: #333;">
                    <i class="fa fa-check-square-o text-primary"></i> Grade Autofiller: Preview & Column Selection
                    <small class="text-muted" style="font-size: 12px; margin-left: 10px;">(${escapeHtml(state.sourceLabel)})</small>
                </h4>
            </div>
            <div class="modal-body" style="padding: 18px 20px 10px 20px;">
                <!-- Column Chooser Section -->
                <div style="background-color: #fcfcfc; border: 1px solid #e3e3e3; border-radius: 6px; padding: 12px 15px; margin-bottom: 12px;">
                    <div class="row">
                        <div class="col-md-7">
                            <label style="margin-bottom: 6px; font-size: 13px; color: #333;">
                                <i class="fa fa-list-ol text-primary"></i> <b>Grade Column to Fill:</b>
                            </label>
                            <div id="eis-pills-container" style="margin-bottom: 6px;">
                                ${pillsHtml}
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
                                <i class="fa fa-info-circle"></i> Matches by Exam ID, or by name in any order (accents ignored). Near-matches are flagged for you to check.
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Match Statistics -->
                <div style="margin-bottom: 4px;">
                    ${statsHtml}
                </div>

                <!-- View controls -->
                <div style="display: flex; gap: 18px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; font-size: 12px;">
                    <label style="margin: 0; font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="checkbox" id="eis-problems-only" ${state.problemsOnly ? 'checked' : ''} style="margin: 0;">
                        <span>Show only rows that need attention (<b>${model.problemCount}</b>)</span>
                    </label>
                    <label style="margin: 0; font-weight: normal; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                        <input type="checkbox" id="eis-no-overwrite" ${state.noOverwrite ? 'checked' : ''} style="margin: 0;">
                        <span>Don't overwrite grades already on the page</span>
                    </label>
                    <span class="text-muted" style="margin-left: auto;">
                        Sheet rows: <b>${model.entries.length}</b> &middot; Page students: <b>${state.pageInfo.students.length}</b>
                    </span>
                </div>

                <!-- Live Preview Table (problems first) -->
                <div id="eis-preview-scroll" style="max-height: 42vh; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 12px; background: white;">
                    <table class="table table-condensed table-striped table-hover eis-preview-table" style="margin-bottom: 0;">
                        <thead style="background: #f5f5f5; position: sticky; top: 0; z-index: 1;">
                            <tr>
                                <th style="width: 40px; text-align: center;">#</th>
                                <th>Sheet Student</th>
                                <th class="text-center" style="width: 230px;">Grade (current &rarr; new)</th>
                                <th style="width: 270px;">Page Student</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Fill Options -->
                <div style="display: flex; gap: 16px; flex-wrap: wrap; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px 16px;">
                    <div style="flex: 1; min-width: 260px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333; font-size: 13px;">
                            <i class="fa fa-user-times text-warning"></i> Students on the page but not in the sheet:
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_missing_opt" value="skip" ${state.missingOpt !== 'grade' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                <span>Leave as is (do not modify)</span>
                            </label>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                    <input type="radio" name="eis_missing_opt" value="grade" ${state.missingOpt === 'grade' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                    <span>Fill with grade:</span>
                                </label>
                                <input type="text" id="eis-missing-val" value="${escapeHtml(state.missingVal)}" style="width: 55px; height: 24px; padding: 2px 6px; border: 1px solid ${mvInvalid ? '#a94442' : '#ccc'}; border-radius: 4px; font-size: 12px;">
                                ${mvInvalid ? '<span class="text-danger" style="font-size: 11px;">Enter a number</span>' : ''}
                            </div>
                        </div>
                    </div>

                    <div style="flex: 1; min-width: 260px; border-left: 1px solid #eee; padding-left: 16px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333; font-size: 13px;">
                            <i class="fa fa-minus-circle text-info"></i> Empty or non-numeric grade in the sheet (default):
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px;">
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_empty_opt" value="zero" ${state.globalEmptyVal === 'zero' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                <span><b>Fill as zero (0)</b></span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; font-weight: normal; color: #333;">
                                <input type="radio" name="eis_empty_opt" value="skip" ${state.globalEmptyVal === 'skip' ? 'checked' : ''} style="margin: 0; cursor: pointer;">
                                <span>Leave empty (skip)</span>
                            </label>
                            ${attendanceOptionHtml}
                            <div style="color: #666; font-size: 11px; margin-top: 4px; font-style: italic;">
                                <i class="fa fa-info-circle"></i> Use the buttons in the table to change individual students.
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
                <button type="button" id="eis-execute-fill-btn" class="btn btn-success" style="font-weight: bold; min-width: 140px;" title="Number of students whose grade or attendance will change" ${st.changes ? '' : 'disabled'}>
                    <i class="fa fa-check"></i> Fill Grades (${st.changes})
                </button>
            </div>
        `;

        var prevTableScroll = $('#eis-preview-scroll').scrollTop() || 0;
        var prevContentScroll = $('#eis-grade-modal-content').scrollTop() || 0;

        showModalContent($, modalHtml);

        if (keepScroll) {
            $('#eis-preview-scroll').scrollTop(prevTableScroll);
            $('#eis-grade-modal-content').scrollTop(prevContentScroll);
        }
        if (focusTarget === 'missing-val') {
            var $mv = $('#eis-missing-val');
            var len = String($mv.val() || '').length;
            $mv.focus();
            if ($mv[0] && $mv[0].setSelectionRange) $mv[0].setSelectionRange(len, len);
        }

        function rerender(keep) {
            renderPreview($, state, keep);
        }

        // Column selection
        function setGradeCol(idx) {
            state.selectedGradeColIdx = idx;
            state.emptyOverrides = {};
            rerender(false);
        }
        $('.eis-pill-btn').on('click', function () {
            setGradeCol(parseInt($(this).attr('data-col-idx'), 10));
        });
        $('#eis-grade-col-select').on('change', function () {
            setGradeCol(parseInt($(this).val(), 10));
        });
        $('#eis-student-col-select').on('change', function () {
            state.selectedStudentColIdx = parseInt($(this).val(), 10);
            state.emptyOverrides = {};
            state.rejected = {};
            rerender(false);
        });

        // Per-student choice for empty / non-numeric grades
        $('.eis-row-act').on('click', function (e) {
            e.preventDefault();
            var key = $(this).closest('.eis-row-empty-group').attr('data-student-key');
            state.emptyOverrides[key] = $(this).attr('data-action');
            rerender(true);
        });

        // Reject / restore fuzzy matches
        $('.eis-reject-btn').on('click', function () {
            state.rejected[$(this).attr('data-student-key')] = true;
            rerender(true);
        });
        $('.eis-unreject-btn').on('click', function () {
            delete state.rejected[$(this).attr('data-student-key')];
            rerender(true);
        });

        // View options (remembered)
        $('#eis-problems-only').on('change', function () {
            state.problemsOnly = this.checked;
            saveSettings({ problemsOnly: state.problemsOnly });
            rerender(false);
        });
        $('#eis-no-overwrite').on('change', function () {
            state.noOverwrite = this.checked;
            saveSettings({ noOverwrite: state.noOverwrite });
            rerender(true);
        });

        // Missing-in-sheet options (remembered)
        $('input[name="eis_missing_opt"]').on('change', function () {
            state.missingOpt = $(this).val();
            saveSettings({ missingOpt: state.missingOpt });
            rerender(true);
        });
        $('#eis-missing-val').on('input', function () {
            state.missingVal = $(this).val();
            state.missingOpt = 'grade';
            saveSettings({ missingVal: state.missingVal, missingOpt: 'grade' });
            clearTimeout(state._missingTimer);
            state._missingTimer = setTimeout(function () {
                if ($('#eis-missing-val').length === 0) return; // modal closed or changed meanwhile
                renderPreview($, state, true, 'missing-val');
            }, 450);
        });

        // Empty-in-sheet default (remembered); resets individual choices
        $('input[name="eis_empty_opt"]').on('change', function () {
            state.globalEmptyVal = $(this).val();
            state.emptyOverrides = {};
            saveSettings({ globalEmptyVal: state.globalEmptyVal });
            rerender(true);
        });

        $('#eis-change-data-btn').on('click', function () {
            showPasteModal($);
        });

        $('#eis-execute-fill-btn').on('click', function () {
            if (st.overwrite > 0 && !confirm(st.overwrite + ' student(s) already have a different grade on the page, and it will be overwritten.\n\nContinue?')) return;
            clearTimeout(state._missingTimer);
            hideModal($);
            fillGrades($, state);
        });
    }

    // ---------------------------------------------------------------------
    // Filling
    // ---------------------------------------------------------------------

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

    function fillGrades($, state) {
        var $editBtn = $('#edit-grades-btn');
        if ($editBtn.is(':visible')) {
            $editBtn.click();
        }

        // Rebuild with current page values (after entering edit mode); same decisions as the preview
        var model = buildModel(state);
        var pageStudents = state.pageInfo.students;

        var report = {
            total: pageStudents.length,
            fromSheet: [],
            emptyZero: [],
            absent: [],
            emptySkipped: [],
            missingFilled: [],
            missingSkipped: [],
            kept: [],
            noInput: [],
            notFound: model.entries.filter(function (e) { return !e.match || e.rejected; }).map(function (e) { return e.key; }),
            duplicates: model.entries.filter(function (e) { return e.match && e.match.overridden; }).map(function (e) { return e.key; })
        };

        // Track changes for Undo functionality
        var previousStates = [];

        pageStudents.forEach(function (s) {
            var d = model.decisions[s.index];
            var label = studentLabel(s);

            if (d.type === 'none') {
                report.noInput.push(label);
                return;
            }

            var $tr = s.$tr;
            var $input = getInput(s);
            var $chk = s.$attendance;

            previousStates.push({
                $tr: $tr,
                $input: $input,
                $chk: $chk,
                val: $input.val(),
                bg: $tr.css('background-color'),
                border: $input.css('border'),
                checked: isChecked($chk)
            });

            if (d.type === 'set') {
                updateInput($input, d.value);
                if (d.cause === 'missingFill') {
                    $tr.css('background-color', '#fcf8e3');
                    $input.css('border', '2px solid #8a6d3b');
                    report.missingFilled.push(label);
                } else {
                    visualSuccess($tr, $input);
                    (d.cause === 'empty0' ? report.emptyZero : report.fromSheet).push(label);
                }
            } else if (d.type === 'absent') {
                if (isChecked($chk)) $chk.click();
                $tr.css('background-color', '#f2dede');
                report.absent.push(label);
            } else if (d.type === 'keep') {
                report.kept.push(label);
            } else if (d.cause === 'missingSkip') {
                report.missingSkipped.push(label);
            } else {
                report.emptySkipped.push(label);
            }
        });

        showReportModal($, report, previousStates);
    }

    // Completion Report Modal with Undo Functionality
    function showReportModal($, r, previousStates) {
        function row(label, list, opts) {
            opts = opts || {};
            if (list.length === 0 && !opts.always) return '';
            var names = (list.length > 0 && opts.names !== false)
                ? '<details style="margin-top: 6px;"><summary style="font-size: 12px; color: #666;">Show names</summary>' +
                  '<div style="font-size: 12px; margin-top: 4px; line-height: 1.7; max-height: 160px; overflow-y: auto;">' + list.map(escapeHtml).join('<br>') + '</div></details>'
                : '';
            return '<li class="list-group-item ' + (opts.cls || '') + '">' +
                '<div style="display: flex; justify-content: space-between; align-items: center;"><span>' + label + '</span>' +
                '<span class="badge" style="font-size: 13px;' + (opts.color ? ' background-color: ' + opts.color + ';' : '') + '">' + list.length + '</span></div>' +
                names + '</li>';
        }

        function section(title, rowsHtml) {
            if (!rowsHtml) return '';
            return '<h5 style="font-weight: bold; margin-top: 15px; color: #555;">' + title + '</h5>' +
                '<ul class="list-group" style="margin-bottom: 10px; font-size: 13px;">' + rowsHtml + '</ul>';
        }

        var bodyHtml =
            '<ul class="list-group" style="margin-bottom: 10px;">' +
                '<li class="list-group-item" style="display: flex; justify-content: space-between; align-items: center;"><strong>Total Students on Page:</strong><span class="badge" style="font-size: 13px;">' + r.total + '</span></li>' +
                row('<strong>Filled from sheet</strong>', r.fromSheet, { always: true, names: false, cls: 'list-group-item-success', color: '#5cb85c' }) +
            '</ul>' +
            section('Empty or non-numeric in sheet:',
                row('Filled with 0', r.emptyZero) +
                row('Marked absent (attendance unchecked)', r.absent) +
                row('Left empty', r.emptySkipped)) +
            section('On the page but not in the sheet:',
                row('Filled with default grade', r.missingFilled) +
                row('Left as is', r.missingSkipped)) +
            section('Other:',
                row('Kept existing grade (not overwritten)', r.kept) +
                row('Sheet rows not found on the page', r.notFound, { cls: 'list-group-item-warning' }) +
                row('Duplicate sheet rows ignored (later row used)', r.duplicates) +
                row('Students without a grade field', r.noInput));

        var modalHtml = `
            <div class="modal-header" style="background-color: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 15px 20px;">
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                <h4 class="modal-title text-center" style="font-weight: bold; color: #333;">
                    <i class="fa fa-check-circle text-success"></i> Processing Complete
                </h4>
            </div>
            <div class="modal-body" style="padding: 20px;">
                ${bodyHtml}
                <div class="text-muted" style="font-size: 12px; margin-top: 8px;">
                    <i class="fa fa-info-circle"></i> Review the highlighted rows, then save the grades in EIS as usual.
                </div>
            </div>
            <div class="modal-footer" style="padding: 12px 20px;">
                <button type="button" class="btn btn-warning pull-left" id="eis-undo-btn" style="font-weight: bold;">
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

                if (prev.$chk.length > 0 && isChecked(prev.$chk) !== prev.checked) {
                    prev.$chk.click();
                }
            }

            hideModal($);
            alert("All autofilled grades have been reverted.");
        });
    }

})();
