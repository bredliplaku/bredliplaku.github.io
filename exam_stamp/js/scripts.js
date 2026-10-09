/* ==========================================================================
   scripts.js — Exam Stamp.

   Takes one or more exam papers plus a class list and writes one personalised
   copy per student: their name on the cover page, optionally the same name
   repeated very faintly across every page so a photograph of any sheet can be
   traced back to the copy it came from. Upload several papers and they become
   groups, dealt out at random or set by hand.

   Nothing is uploaded. The PDFs are read with FileReader, rewritten with
   pdf-lib and zipped with JSZip, all inside this tab — which is the whole
   point, since the input is an unreleased exam paper.

   Three coordinate systems are in play, and keeping them straight is most of
   the work here:
     · PDF user space  — origin bottom-left, y grows upwards. What pdf-lib
                         draws in, and what a page's /Rotate is applied on
                         top of.
     · viewport space  — CSS pixels of a rendered preview, origin top-left,
                         page rotation and scale already baked in by pdf.js.
                         What the user actually points at.
     · canvas space    — viewport space times devicePixelRatio.
   pdf.js's viewport.convertToPdfPoint / convertToViewportPoint are the only
   bridge between the first two; everything else derives from them.

   The stamp position is stored as a fraction of the *displayed* page rather
   than as a coordinate. That is what lets one position apply to every group's
   paper, whatever size or rotation each one happens to be.
   ========================================================================== */

(() => {
    'use strict';

    const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const MAX_PREVIEW_WIDTH = 760;   // CSS px; a preview wider than this helps nobody
    const MAX_WM_ROWS = 220;         // hard stop on a pathological spacing/size combo
    const FAUX_ITALIC_DEG = 12;      // slant used when a family has no italic cut
    const PREF_KEY = 'exam-stamp-prefs';
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';


    /* === FONTS ===========================================================
       The three built-ins cost nothing: every PDF reader already has them and
       they add no bytes to the output. Everything else is a real TTF fetched
       once and subsetted into each copy, which is the only way to put a serif
       or a handwriting face into a PDF.

       The files come from the @expo-google-fonts packages because those ship
       plain .ttf under a predictable name; Google's own CDN serves woff2,
       which fontkit cannot embed. `has` lists which cuts exist — r, b, i, bi.
       ==================================================================== */

    const FONT_BASE = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts';
    const FONT_VER = '0.2.3';

    const FONTS = {
        helvetica: {
            label: 'Helvetica', group: 'Built into every PDF reader',
            std: { r: 'Helvetica', b: 'HelveticaBold', i: 'HelveticaOblique', bi: 'HelveticaBoldOblique' },
            css: 'Helvetica, Arial, sans-serif',
            note: 'Substituted with Arial by most readers. Adds nothing to the file size.',
        },
        times: {
            label: 'Times Roman', group: 'Built into every PDF reader',
            std: { r: 'TimesRoman', b: 'TimesRomanBold', i: 'TimesRomanItalic', bi: 'TimesRomanBoldItalic' },
            css: '"Times New Roman", Times, serif',
            note: 'The built-in serif. Metrically identical to Times New Roman, and shown as Times New Roman by most readers.',
        },
        courier: {
            label: 'Courier', group: 'Built into every PDF reader',
            std: { r: 'Courier', b: 'CourierBold', i: 'CourierOblique', bi: 'CourierBoldOblique' },
            css: '"Courier New", Courier, monospace',
            note: 'The built-in monospace. Substituted with Courier New by most readers.',
        },

        merriweather: { label: 'Merriweather', group: 'Serif', pkg: 'merriweather', family: 'Merriweather', has: 'r b i bi' },
        'eb-garamond': { label: 'EB Garamond', group: 'Serif', pkg: 'eb-garamond', family: 'EBGaramond', has: 'r b i bi' },
        lora: { label: 'Lora', group: 'Serif', pkg: 'lora', family: 'Lora', has: 'r b i bi' },
        'pt-serif': { label: 'PT Serif', group: 'Serif', pkg: 'pt-serif', family: 'PTSerif', has: 'r b i bi' },
        playfair: { label: 'Playfair Display', group: 'Serif', pkg: 'playfair-display', family: 'PlayfairDisplay', has: 'r b i bi' },

        'roboto-mono': { label: 'Roboto Mono', group: 'Monospace', pkg: 'roboto-mono', family: 'RobotoMono', has: 'r b i bi' },
        'jetbrains-mono': { label: 'JetBrains Mono', group: 'Monospace', pkg: 'jetbrains-mono', family: 'JetBrainsMono', has: 'r b i bi' },
        'courier-prime': { label: 'Courier Prime', group: 'Monospace', pkg: 'courier-prime', family: 'CourierPrime', has: 'r b i bi' },
        'space-mono': { label: 'Space Mono', group: 'Monospace', pkg: 'space-mono', family: 'SpaceMono', has: 'r b i bi' },

        caveat: { label: 'Caveat', group: 'Handwritten', pkg: 'caveat', family: 'Caveat', has: 'r b' },
        'dancing-script': { label: 'Dancing Script', group: 'Handwritten', pkg: 'dancing-script', family: 'DancingScript', has: 'r b' },
        'patrick-hand': { label: 'Patrick Hand', group: 'Handwritten', pkg: 'patrick-hand', family: 'PatrickHand', has: 'r' },
        'indie-flower': { label: 'Indie Flower', group: 'Handwritten', pkg: 'indie-flower', family: 'IndieFlower', has: 'r' },
        kalam: { label: 'Kalam', group: 'Handwritten', pkg: 'kalam', family: 'Kalam', has: 'r b' },
    };

    const FONT_GROUP_ORDER = ['Built into every PDF reader', 'Serif', 'Monospace', 'Handwritten'];

    const fontHas = (key, cut) => {
        const def = FONTS[key];
        if (!def) return false;
        return def.std ? Boolean(def.std[cut]) : def.has.split(' ').includes(cut);
    };

    const fontUrl = (key, cut) => {
        const def = FONTS[key];
        const weight = cut.includes('b') ? '700Bold' : '400Regular';
        const italic = cut.includes('i') ? '_Italic' : '';
        return `${FONT_BASE}/${def.pkg}@${FONT_VER}/${def.family}_${weight}${italic}.ttf`;
    };

    // Colours worth one click on an exam paper: the site's own blues, plain
    // black, a few greys for the tracer, and the usual marking colours.
    const SWATCHES = ['#1a237e', '#3949ab', '#2196f3', '#000000', '#444444', '#808080',
        '#b0b0b0', '#c62828', '#ef6c00', '#2e7d32', '#6a1b9a'];


    /* === STATE =========================================================== */

    const state = {
        names: [],
        approx: new Set(),      // names a built-in font can't reproduce exactly

        // One entry per uploaded paper. With more than one, they are groups.
        variants: [],           // { letter, fileName, base, bytes, pdf, pageCount, size }
        active: 0,              // which paper the main preview is showing
        assign: {},             // student name -> variant index
        // How the current split came about. A deal the app made is redone
        // whenever the number of papers changes; once a student has been
        // moved by hand the split is the teacher's, and is only topped up.
        dealt: 'shuffle',       // 'shuffle' | 'alternate' | 'manual'

        currentPage: 1,
        viewport: null,         // pdf.js viewport of the page on screen (CSS px)
        pageBox: null,          // that page's crop box in PDF user space
        renderTask: null,

        wmPage: 2,              // the tracer preview starts past the cover
        wmViewport: null,
        wmPageBox: null,
        wmRenderTask: null,

        // Fractions of the displayed page. Resolution-independent, and shared
        // across every group's paper.
        stamp: { page: 1, u: 0.5, v: 0.28 },
        style: { bold: true, italic: false, line: false, align: 'center' },
        stampBox: null,         // the stamp's handle on screen, in viewport px
        zipAuto: true,          // ZIP name still follows the first paper's name

        scratch: null,          // throwaway PDF that owns the measuring fonts
        font: null,             // resolved bundle for the stamp
        wmFont: null,           // resolved bundle for the tracer
        running: false,
        cancelled: false,
    };


    /* === DOM ============================================================= */

    const $ = (id) => document.getElementById(id);
    const dom = {
        chipNames: $('chip-names'), chipPdf: $('chip-pdf'), chipStatus: $('chip-status'),
        progressBar: $('progress-bar'), progress: $('progress'),

        namesInput: $('names-input'), namesFile: $('names-file'), nameChips: $('name-chips'),
        namesSummary: $('names-summary'), linesOnly: $('lines-only'),
        btnUploadNames: $('btn-upload-names'), btnSortNames: $('btn-sort-names'),
        btnClearNames: $('btn-clear-names'),

        pdfDrop: $('pdf-drop'), pdfDropTitle: $('pdf-drop-title'), pdfFile: $('pdf-file'),
        paperList: $('paper-list'), paperHint: $('paper-hint'),
        previewWrap: $('preview-wrap'), pdfCanvas: $('pdf-canvas'), overlay: $('overlay-canvas'),
        pagePrev: $('page-prev'), pageNext: $('page-next'), pageLabel: $('page-label'),
        stampNote: $('stamp-note'), stampWarn: $('stamp-warn'),

        stampTemplate: $('stamp-template'), previewNameSel: $('preview-name'),
        stampFont: $('stamp-font'), stampFontState: $('stamp-font-state'),
        stampFontNote: $('stamp-font-note'),
        stampSize: $('stamp-size'), stampSizeVal: $('stamp-size-val'),
        stampStyle: $('stamp-style'), stampAlign: $('stamp-align'),
        stampBold: $('stamp-bold'), stampItalic: $('stamp-italic'), stampLine: $('stamp-line'),
        stampColor: $('stamp-color'),

        groupsSingle: $('groups-single'), groupsPanel: $('groups-panel'),
        btnShuffle: $('btn-shuffle'), btnAlternate: $('btn-alternate'),
        groupStats: $('group-stats'), groupSearch: $('group-search'),
        groupFilter: $('group-filter'), groupBulk: $('group-bulk'),
        btnAssignShown: $('btn-assign-shown'), groupList: $('group-list'),
        groupCount: $('group-count'),

        wmEnabled: $('wm-enabled'), wmBody: $('wm-body'), wmControls: $('wm-controls'),
        wmPreviewWrap: $('wm-preview-wrap'), wmNoPdf: $('wm-no-pdf'),
        wmCanvas: $('wm-canvas'), wmOverlay: $('wm-overlay'),
        wmPagePrev: $('wm-page-prev'), wmPageNext: $('wm-page-next'),
        wmPageLabel: $('wm-page-label'), wmPreviewNote: $('wm-preview-note'),
        wmTemplate: $('wm-template'), wmFont: $('wm-font'), wmFontState: $('wm-font-state'),
        wmOpacity: $('wm-opacity'), wmOpacityVal: $('wm-opacity-val'),
        wmSize: $('wm-size'), wmSizeVal: $('wm-size-val'),
        wmAngle: $('wm-angle'), wmAngleVal: $('wm-angle-val'),
        wmGap: $('wm-gap'), wmGapVal: $('wm-gap-val'),
        wmColor: $('wm-color'), wmCover: $('wm-cover'),

        filePattern: $('file-pattern'), zipName: $('zip-name'), outputExample: $('output-example'),
        btnResetPrefs: $('btn-reset-prefs'),
        btnTest: $('btn-test'), btnGenerate: $('btn-generate'), btnCancel: $('btn-cancel'),
        dropOverlay: $('drop-overlay'),
    };


    /* === TEXT SAFETY =====================================================
       The built-in fonts are encoded with WinAnsi, which covers Latin-1 — so
       Albanian ë and ç, and every accent in a European name, are fine.
       Anything outside it (Cyrillic, Greek, CJK) would make pdf-lib throw
       mid-batch, so it is folded down to its unaccented form and dropped only
       if even that fails. An embedded TTF has no such limit, so this applies
       only while a built-in font is selected.
       ==================================================================== */

    const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

    function winAnsiOk(ch) {
        const c = ch.codePointAt(0);
        if (c >= 0x20 && c <= 0x7e) return true;
        if (c >= 0xa0 && c <= 0xff) return true;
        return WIN_ANSI_EXTRAS.includes(ch);
    }

    function toStampable(text) {
        let out = '';
        let changed = false;
        for (const ch of String(text)) {
            if (winAnsiOk(ch)) { out += ch; continue; }
            const bare = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            changed = true;
            for (const b of bare) if (winAnsiOk(b)) out += b;
        }
        return { text: out.trim() || '?', changed };
    }

    // What actually gets drawn, given a particular font bundle.
    function prepText(text, bundle) {
        const clean = String(text).replace(/[\u0000-\u001f]/g, '').trim();
        if (bundle && !bundle.standardName) return { text: clean, changed: false };
        return toStampable(clean);
    }

    // Function replacers throughout: a string replacement would read "$&"
    // or "$'" inside a name as a pattern, and names are user data.
    const fillTemplate = (tpl, name, variant) => String(tpl || '')
        .replace(/\{name\}/gi, () => name)
        .replace(/\{group\}/gi, () => (variant ? variant.letter : ''))
        .replace(/\{date\}/gi, () => new Date().toLocaleDateString('en-GB'));

    // Excel's "CSV UTF-8" export starts with a byte-order mark, and names
    // copied out of a web page can carry zero-width spaces. Both are
    // invisible, both defeat header detection, and either would be stamped
    // as a stray "?".
    const INVISIBLE = /[​-‍⁠﻿]/g;


    /* === FONT LOADING ====================================================
       A bundle is everything both halves of the app need for one choice of
       face: pdf-lib metrics for the layout maths, the raw TTF for embedding,
       and a CSS family the preview canvas can paint with. Bundles are cached,
       so switching back and forth costs one fetch in total.
       ==================================================================== */

    const fontCache = new Map();

    // Falls back through the cuts a family actually has, and reports whether
    // the italic has to be faked by shearing.
    function resolveCut(key, bold, italic) {
        const want = (bold ? 'b' : '') + (italic ? 'i' : '') || 'r';
        if (fontHas(key, want)) return { cut: want, faux: false };
        if (want === 'bi') {
            if (fontHas(key, 'b')) return { cut: 'b', faux: true };
            if (fontHas(key, 'i')) return { cut: 'i', faux: false };
            return { cut: 'r', faux: true };
        }
        // Italic can be faked by shearing; bold cannot, so it just falls away.
        return { cut: 'r', faux: want === 'i' };
    }

    function ensureFont(key, bold, italic) {
        const safeKey = FONTS[key] ? key : 'helvetica';
        const { cut, faux } = resolveCut(safeKey, bold, italic);
        const id = `${safeKey}:${cut}`;
        if (!fontCache.has(id)) {
            fontCache.set(id, loadFont(safeKey, cut).catch(err => {
                fontCache.delete(id);   // a failed fetch must not be cached forever
                throw err;
            }));
        }
        return fontCache.get(id).then(bundle => ({ ...bundle, faux }));
    }

    async function loadFont(key, cut) {
        const def = FONTS[key];
        if (def.std) {
            const name = PDFLib.StandardFonts[def.std[cut]];
            return {
                key, cut, standardName: name, css: def.css,
                // All four built-in cuts share one CSS stack, so the preview
                // has to ask for the weight and slant explicitly.
                bold: cut.includes('b'), italic: cut.includes('i'),
                metrics: await state.scratch.embedFont(name),
            };
        }
        const res = await fetch(fontUrl(key, cut));
        if (!res.ok) throw new Error(`${def.label} could not be downloaded (${res.status})`);
        const bytes = new Uint8Array(await res.arrayBuffer());

        // The same bytes paint the preview, so the canvas and the PDF agree.
        const family = `ES-${key}-${cut}`;
        if (window.FontFace) {
            const face = new FontFace(family, bytes);
            await face.load();
            document.fonts.add(face);
        }
        return {
            // A downloaded cut is its own family and is asked for plain:
            // requesting bold on top would make the browser embolden it twice.
            key, cut, bytes, css: `"${family}", sans-serif`, bold: false, italic: false,
            metrics: await state.scratch.embedFont(bytes, { subset: false }),
        };
    }

    // The canvas font shorthand for a bundle at a given pixel size. A faux
    // italic is the browser's synthesised slant — the same trick the PDF
    // side plays with a shear.
    const canvasFont = (bundle, px) =>
        `${bundle.italic || bundle.faux ? 'italic ' : ''}${bundle.bold ? 'bold ' : ''}${px}px ${bundle.css}`;

    function buildFontSelect(select, selected) {
        select.textContent = '';
        FONT_GROUP_ORDER.forEach(groupName => {
            const group = document.createElement('optgroup');
            group.label = groupName;
            Object.entries(FONTS).forEach(([key, def]) => {
                if (def.group !== groupName) return;
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = def.label;
                group.appendChild(opt);
            });
            if (group.children.length) select.appendChild(group);
        });
        if (FONTS[selected]) select.value = selected;
    }

    // Each choice takes a ticket. A download is slow and a built-in face is
    // instant, so picking Merriweather and then straight back to Helvetica
    // would otherwise let the late Merriweather overwrite the newer choice —
    // the preview showing one font while the copies get the other.
    let stampFontTicket = 0;
    let wmFontTicket = 0;

    async function applyStampFont() {
        const ticket = ++stampFontTicket;
        const key = dom.stampFont.value;
        // Bold has to come from a real cut — unlike italic, it cannot be faked
        // convincingly — so the button is simply unavailable without one.
        const canBold = fontHas(key, 'b') || fontHas(key, 'bi');
        dom.stampBold.disabled = !canBold;
        if (!canBold) state.style.bold = false;
        syncStyleButtons();

        dom.stampFontState.textContent = FONTS[key].std ? '' : 'loading…';
        dom.stampFontNote.textContent = FONTS[key].note ||
            'Downloaded once, then embedded (subsetted) into every copy.';
        try {
            const bundle = await ensureFont(key, state.style.bold, state.style.italic);
            if (ticket !== stampFontTicket) return;   // overtaken by a later choice
            state.font = bundle;
            dom.stampFontState.textContent = '';
        } catch (err) {
            if (ticket !== stampFontTicket) return;
            dom.stampFontState.textContent = 'failed';
            showNotification('error', "Couldn't load that font", err.message || String(err));
            dom.stampFont.value = 'helvetica';
            state.font = await ensureFont('helvetica', state.style.bold, state.style.italic);
        }
        refreshNames();   // the "loses accents" flags depend on the font
        drawOverlay();
    }

    async function applyWatermarkFont() {
        const ticket = ++wmFontTicket;
        const key = dom.wmFont.value;
        dom.wmFontState.textContent = FONTS[key].std ? '' : 'loading…';
        try {
            const bundle = await ensureFont(key, false, false);
            if (ticket !== wmFontTicket) return;
            state.wmFont = bundle;
            dom.wmFontState.textContent = '';
        } catch (err) {
            if (ticket !== wmFontTicket) return;
            dom.wmFontState.textContent = 'failed';
            showNotification('error', "Couldn't load that font", err.message || String(err));
            dom.wmFont.value = 'courier';
            state.wmFont = await ensureFont('courier', false, false);
        }
        drawOverlay();
        drawWatermarkOverlay();
    }


    /* === SETTINGS READERS ================================================ */

    function hexToRgb(hex) {
        const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
        if (!m) return { r: 0, g: 0, b: 0 };
        return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    }

    const pdfColor = (hex) => {
        const c = hexToRgb(hex);
        return PDFLib.rgb(c.r / 255, c.g / 255, c.b / 255);
    };

    const stampCfg = () => ({
        template: dom.stampTemplate.value,
        size: +dom.stampSize.value,
        align: state.style.align,
        hex: dom.stampColor.value,
        line: state.style.line,
    });

    const watermarkCfg = () => ({
        enabled: dom.wmEnabled.checked,
        template: dom.wmTemplate.value,
        opacity: +dom.wmOpacity.value / 100,
        size: +dom.wmSize.value,
        angle: +dom.wmAngle.value,
        gap: +dom.wmGap.value,
        hex: dom.wmColor.value,
        cover: dom.wmCover.checked,
    });

    const sampleName = () => dom.previewNameSel.value || state.names[0] || 'Student Name';
    const activeVariant = () => state.variants[state.active] || null;

    // The page that carries the name on one particular paper. A paper shorter
    // than the chosen page gets it on its last page — the preview, the note
    // and the copies all have to agree on that, so they all ask here.
    const stampPageOf = (variant) => (variant ? Math.min(state.stamp.page, variant.pageCount) : state.stamp.page);
    const onStampPage = () => state.currentPage === stampPageOf(activeVariant());


    /* === LAYOUT MATHS ====================================================
       Both the tracer pattern and the cover stamp are laid out once, in PDF
       user space, and then drawn twice: onto a preview canvas, and into every
       generated file. Sharing the maths is what makes the previews
       trustworthy — the numbers below are the numbers pdf-lib gets.
       ==================================================================== */

    /* The pattern is a grid in a frame rotated by `angle`, not a rotated grid
       in the page frame: the page's four corners are projected onto the
       rotated axes, which gives the exact strip each row has to cover. Rows
       are drawn as one long string of repeats padded with spaces, so a page
       costs one drawText per row instead of one per mark — a tenth of the
       operators, and a tenth of the transparency states in the output file. */
    function watermarkLayout(box, cfg, font) {
        const text = cfg.text;
        const textW = font.widthOfTextAtSize(text, cfg.size);
        const spaceW = font.widthOfTextAtSize(' ', cfg.size) || cfg.size * 0.28;
        const nSpaces = Math.max(1, Math.round((cfg.gap * 1.6) / spaceW));
        const stepX = textW + nSpaces * spaceW;
        const stepY = cfg.size + cfg.gap;

        const rad = cfg.angle * Math.PI / 180;
        const e1 = [Math.cos(rad), Math.sin(rad)];          // along the text
        const e2 = [-Math.sin(rad), Math.cos(rad)];         // row to row
        const corners = [
            [box.x, box.y], [box.x + box.width, box.y],
            [box.x, box.y + box.height], [box.x + box.width, box.y + box.height],
        ];
        const us = corners.map(c => c[0] * e1[0] + c[1] * e1[1]);
        const vs = corners.map(c => c[0] * e2[0] + c[1] * e2[1]);
        const u0 = Math.min(...us), u1 = Math.max(...us);
        const v0 = Math.min(...vs), v1 = Math.max(...vs);

        const repeats = Math.max(1, Math.ceil((u1 - u0) / stepX) + 1);
        const rows = [];
        let i = 0;
        for (let v = v0 - stepY; v <= v1 + stepY && rows.length < MAX_WM_ROWS; v += stepY, i++) {
            // Every other row is offset half a step, so the pattern reads as a
            // texture rather than as a grid of columns.
            const u = u0 - (i % 2 ? stepX / 2 : 0);
            rows.push({ x: u * e1[0] + v * e2[0], y: u * e1[1] + v * e2[1] });
        }
        return { rows, repeats, stepX, e1, line: (text + ' '.repeat(nSpaces)).repeat(repeats) };
    }

    /* The stamp must read horizontally in the *displayed* page, so on a page
       carrying a /Rotate it has to be pre-rotated by the same amount. That
       also fixes the direction the text runs in, which is what alignment and
       the underline are measured along. */
    function stampGeometry(rotationDeg, anchor, textWidth, align) {
        const rad = rotationDeg * Math.PI / 180;
        const dir = [Math.cos(rad), Math.sin(rad)];         // display "right"
        const down = [Math.sin(rad), -Math.cos(rad)];       // display "down"
        const f = { left: 0, center: 0.5, right: 1 }[align] || 0;
        return {
            dir, down, rotationDeg,
            x: anchor.x - dir[0] * textWidth * f,
            y: anchor.y - dir[1] * textWidth * f,
        };
    }

    // The stamp point, in one particular paper's own coordinates. Every group
    // shares the fractions; each resolves them against its own page.
    async function anchorFor(variant) {
        const pageNo = stampPageOf(variant);
        const page = await variant.pdf.getPage(pageNo);
        const vp = page.getViewport({ scale: 1 });
        const [x, y] = vp.convertToPdfPoint(state.stamp.u * vp.width, state.stamp.v * vp.height);
        return { pageNo, x, y };
    }


    /* === PREVIEW RENDERING ===============================================
       Two independent stages share this: the big one in step 2 where the name
       is positioned, and the small one in step 4 that shows the tracer on an
       inside page. Both go through renderInto() so a page is rasterised the
       same way in both.
       ==================================================================== */

    const dpr = () => window.devicePixelRatio || 1;

    async function renderInto(opts) {
        const { variant, pageNo, canvas, overlay, maxWidth, taskKey } = opts;
        const page = await variant.pdf.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const available = Math.max(220, opts.measure.clientWidth || 600);
        const viewport = page.getViewport({ scale: Math.min(available, maxWidth) / base.width });
        const ratio = dpr();

        // Only the width is set; the stylesheet's height:auto follows the
        // bitmap's aspect ratio. A fixed pixel height would let max-width
        // squash the page sideways whenever it was measured wider than it
        // ended up — mid-way through a panel opening, say.
        for (const c of [canvas, overlay]) {
            c.width = Math.round(viewport.width * ratio);
            c.height = Math.round(viewport.height * ratio);
            c.style.width = `${viewport.width}px`;
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // pdf.js refuses to run two renders against one canvas, and paging
        // quickly is the normal way to hit that — so the previous one is
        // cancelled rather than left to collide.
        if (state[taskKey]) {
            try { state[taskKey].cancel(); } catch { /* already finished */ }
        }
        const task = page.render({
            canvasContext: ctx, viewport,
            transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
        });
        state[taskKey] = task;
        try {
            await task.promise;
        } catch (err) {
            if (err && err.name === 'RenderingCancelledException') return null;
            throw err;
        } finally {
            if (state[taskKey] === task) state[taskKey] = null;
        }

        const [x0, y0, x1, y1] = page.view;   // the crop box, in PDF user space
        return { viewport, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
    }

    async function renderPage(n) {
        const variant = activeVariant();
        if (!variant) return;
        state.currentPage = Math.min(Math.max(1, n), variant.pageCount);

        const result = await renderInto({
            variant, pageNo: state.currentPage, canvas: dom.pdfCanvas, overlay: dom.overlay,
            maxWidth: MAX_PREVIEW_WIDTH, measure: dom.previewWrap, taskKey: 'renderTask',
        });
        if (!result) return;

        state.viewport = result.viewport;
        state.pageBox = result.box;
        dom.pageLabel.textContent = `Page ${state.currentPage} of ${variant.pageCount}`;
        dom.pagePrev.disabled = state.currentPage <= 1;
        dom.pageNext.disabled = state.currentPage >= variant.pageCount;
        drawOverlay();
        updateStampNote();
    }

    // The tracer preview deliberately opens on page 2: the cover is excluded
    // from the pattern by default, so page 2 is the first page that shows it.
    async function renderWatermarkPage(n) {
        const variant = activeVariant();
        if (!variant) {
            dom.wmPreviewWrap.classList.add('hidden');
            dom.wmNoPdf.classList.remove('hidden');
            return;
        }
        dom.wmPreviewWrap.classList.remove('hidden');
        dom.wmNoPdf.classList.add('hidden');

        const first = variant.pageCount > 1 ? 2 : 1;
        state.wmPage = Math.min(Math.max(n ?? first, 1), variant.pageCount);

        const result = await renderInto({
            variant, pageNo: state.wmPage, canvas: dom.wmCanvas, overlay: dom.wmOverlay,
            maxWidth: 420, measure: dom.wmPreviewWrap, taskKey: 'wmRenderTask',
        });
        if (!result) return;

        state.wmViewport = result.viewport;
        state.wmPageBox = result.box;
        dom.wmPageLabel.textContent = `Page ${state.wmPage} of ${variant.pageCount}`;
        dom.wmPagePrev.disabled = state.wmPage <= 1;
        dom.wmPageNext.disabled = state.wmPage >= variant.pageCount;
        dom.wmPreviewNote.textContent = state.wmPage === stampPageOf(variant) && !dom.wmCover.checked
            ? 'This is the cover page, which is currently excluded from the pattern.'
            : `Shown at true size and faintness${variant.letter && state.variants.length > 1 ? `, on paper ${variant.letter}` : ''}.`;
        drawWatermarkOverlay();
    }

    /* Paints the tracer onto a canvas, using the very same layout the PDF
       will get — the marks land on the same spots, at the same angle, in the
       same colour and opacity. */
    function paintWatermark(ctx, viewport, box, name, variant) {
        const wm = watermarkCfg();
        if (!wm.enabled || !box || !state.wmFont) return;
        const text = prepText(fillTemplate(wm.template, name, variant), state.wmFont).text;
        if (!text) return;

        const layout = watermarkLayout(box, { ...wm, text }, state.wmFont.metrics);
        // A direction in PDF space, pushed through the viewport matrix, gives
        // the angle the same text runs at on the canvas — which stays correct
        // for a page with a /Rotate.
        const t = viewport.transform;
        const angle = Math.atan2(
            t[1] * layout.e1[0] + t[3] * layout.e1[1],
            t[0] * layout.e1[0] + t[2] * layout.e1[1]);

        ctx.save();
        ctx.globalAlpha = wm.opacity;
        ctx.fillStyle = wm.hex;
        ctx.font = canvasFont(state.wmFont, wm.size * viewport.scale);
        ctx.textBaseline = 'alphabetic';
        for (const row of layout.rows) {
            for (let k = 0; k < layout.repeats; k++) {
                const px = row.x + k * layout.stepX * layout.e1[0];
                const py = row.y + k * layout.stepX * layout.e1[1];
                const [cx, cy] = viewport.convertToViewportPoint(px, py);
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(angle);
                ctx.fillText(text, 0, 0);
                ctx.restore();
            }
        }
        ctx.restore();
    }

    function clearCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const ratio = dpr();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return ctx;
    }

    function drawWatermarkOverlay() {
        if (!state.wmViewport) return;
        const ctx = clearCanvas(dom.wmOverlay);
        const onCover = state.wmPage === stampPageOf(activeVariant());
        if (onCover && !dom.wmCover.checked) return;
        paintWatermark(ctx, state.wmViewport, state.wmPageBox, sampleName(), activeVariant());
    }

    function drawOverlay() {
        const vp = state.viewport;
        if (!vp || !state.font) return;
        const ctx = clearCanvas(dom.overlay);
        const name = sampleName();
        const variant = activeVariant();
        const wm = watermarkCfg();
        state.stampBox = null;

        if (wm.cover || !onStampPage()) {
            paintWatermark(ctx, vp, state.pageBox, name, variant);
        }

        if (!onStampPage()) return;

        // Drawn horizontally here because that is exactly how it will appear
        // once the page's own rotation has been compensated for.
        const cfg = stampCfg();
        const text = prepText(fillTemplate(cfg.template, name, variant), state.font).text;
        const w = state.font.metrics.widthOfTextAtSize(text, cfg.size) * vp.scale;
        const size = cfg.size * vp.scale;
        const f = { left: 0, center: 0.5, right: 1 }[cfg.align] || 0;
        const ax = state.stamp.u * vp.width;
        const ay = state.stamp.v * vp.height;
        const x = ax - w * f;

        ctx.save();
        ctx.font = canvasFont(state.font, size);
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = cfg.hex;
        ctx.fillText(text, x, ay);

        if (cfg.line) {
            const pad = Math.max(6 * vp.scale, w * 0.08);
            ctx.strokeStyle = cfg.hex;
            ctx.lineWidth = Math.max(0.6, cfg.size * 0.05) * vp.scale;
            ctx.beginPath();
            ctx.moveTo(x - pad, ay + size * 0.3);
            ctx.lineTo(x + w + pad, ay + size * 0.3);
            ctx.stroke();
        }

        // Handle: a dashed box round the text plus a tick on the anchor, so
        // it's obvious both that this is draggable and which point moves.
        const box = { x: x - 6, y: ay - size - 4, w: w + 12, h: size * 1.45 + 8 };
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(57, 73, 171, 0.9)';
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(57, 73, 171, 0.9)';
        ctx.beginPath();
        ctx.arc(ax, ay, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        state.stampBox = { ...box, ax, ay };
        updateStampFit();
    }

    function updateStampNote() {
        const v = activeVariant();
        if (!v) { dom.stampNote.textContent = ''; return; }
        const page = stampPageOf(v);
        const many = state.variants.length > 1;
        const short = state.variants.filter(x => x.pageCount < state.stamp.page);
        let note = state.currentPage === page
            ? `The name is stamped here, on page ${page}${many && !short.length ? " of every group's paper" : ''}.`
            : `The name is stamped on page ${page}. Click this page to move it here.`;
        if (many && short.length) {
            const letters = short.map(x => x.letter).join(', ');
            note += short.length === 1
                ? ` Paper ${letters} is shorter, so it gets the name on its last page.`
                : ` Papers ${letters} are shorter, so they get the name on their last page.`;
        }
        dom.stampNote.textContent = note;
    }

    /* The preview shows one name, but the class has a longest one — and that
       is the name that runs off the page or into the header. Its width is
       measured once per (names, font, template), which is the expensive
       part; checking it against the current position is just arithmetic, so
       it can run on every frame of a drag. */
    let longestCache = null;

    function longestStamp() {
        const tpl = dom.stampTemplate.value;
        const variant = activeVariant();
        const c = longestCache;
        if (c && c.names === state.names && c.font === state.font && c.tpl === tpl && c.variant === variant) return c;
        let best = { name: '', em: 0 };
        for (const n of state.names) {
            const text = prepText(fillTemplate(tpl, n, variant), state.font).text;
            // Width is linear in size, so measure once at 1000 and scale.
            const em = state.font.metrics.widthOfTextAtSize(text, 1000) / 1000;
            if (em > best.em) best = { name: n, em };
        }
        longestCache = { names: state.names, font: state.font, tpl, variant, ...best };
        return longestCache;
    }

    function updateStampFit() {
        const vp = state.viewport;
        const warn = dom.stampWarn;
        if (!vp || !state.font || state.names.length < 2 || !onStampPage()) {
            warn.classList.add('hidden');
            warn._key = '';
            return;
        }
        const longest = longestStamp();
        const cfg = stampCfg();
        const f = { left: 0, center: 0.5, right: 1 }[cfg.align] || 0;
        const pageW = vp.width / vp.scale;              // the displayed page, in pt
        const left = state.stamp.u * pageW - longest.em * cfg.size * f;
        const right = left + longest.em * cfg.size;
        const side = left < 0 ? 'left' : right > pageW ? 'right' : '';
        warn.classList.toggle('hidden', !side);
        if (!side) return;
        // This runs on every frame of a drag; rebuild only when it changes.
        const offerPreview = dom.previewNameSel.value !== longest.name;
        const key = `${side}|${longest.name}|${offerPreview}`;
        if (warn._key === key) return;
        warn._key = key;
        warn.textContent = '';
        const msg = document.createElement('span');
        msg.textContent = `The longest name, ${longest.name}, runs off the ${side} edge of the page at this size.`;
        warn.appendChild(msg);
        if (offerPreview) {
            const show = document.createElement('button');
            show.type = 'button';
            show.textContent = 'Preview it';
            show.addEventListener('click', () => {
                dom.previewNameSel.value = longest.name;
                drawOverlay();
                drawWatermarkOverlay();
            });
            warn.appendChild(show);
        }
    }

    const clamp01 = (n) => Math.min(Math.max(n, 0), 1);

    // A pointer position in the viewport's CSS px. The canvas may be drawn
    // narrower than its viewport (max-width on a small screen), so this goes
    // through the on-screen rect rather than assuming the two are equal.
    function pointerToViewport(ev) {
        const rect = dom.overlay.getBoundingClientRect();
        const vp = state.viewport;
        return {
            x: (ev.clientX - rect.left) * (vp.width / rect.width),
            y: (ev.clientY - rect.top) * (vp.height / rect.height),
        };
    }

    const onStampHandle = (p) => {
        const b = state.stampBox;
        return Boolean(b) && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    };

    // `grab` is where inside the handle the pointer took hold, relative to
    // the anchor — so dragging the name by its middle doesn't first make it
    // jump to put its anchor under the pointer.
    function setStampFromEvent(ev, grab) {
        const p = pointerToViewport(ev);
        state.stamp.page = state.currentPage;
        state.stamp.u = clamp01((p.x - grab.x) / state.viewport.width);
        state.stamp.v = clamp01((p.y - grab.y) / state.viewport.height);
        drawOverlay();
        updateStampNote();
        savePrefsSoon();
    }

    function wirePreviewInteraction() {
        let grab = null;
        dom.overlay.addEventListener('pointerdown', (e) => {
            if (!state.viewport) return;
            const p = pointerToViewport(e);
            const b = state.stampBox;
            grab = onStampHandle(p) ? { x: p.x - b.ax, y: p.y - b.ay } : { x: 0, y: 0 };
            dom.overlay.setPointerCapture(e.pointerId);
            dom.overlay.focus({ preventScroll: true });
            dom.overlay.classList.add('is-dragging');
            setStampFromEvent(e, grab);
            e.preventDefault();
        });
        dom.overlay.addEventListener('pointermove', (e) => {
            if (grab) { setStampFromEvent(e, grab); return; }
            // Hovering: a move cursor over the name, a crosshair elsewhere,
            // so it's clear which one a click will do.
            if (state.viewport) dom.overlay.classList.toggle('over-stamp', onStampHandle(pointerToViewport(e)));
        });
        const stop = (e) => {
            if (!grab) return;
            grab = null;
            dom.overlay.classList.remove('is-dragging');
            try { dom.overlay.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
        };
        dom.overlay.addEventListener('pointerup', stop);
        dom.overlay.addEventListener('pointercancel', stop);
        dom.overlay.addEventListener('pointerleave', () => dom.overlay.classList.remove('over-stamp'));

        dom.overlay.addEventListener('keydown', (e) => {
            const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (!nudge || !state.viewport || !onStampPage()) return;
            e.preventDefault();
            const step = (e.shiftKey ? 10 : 1) / state.viewport.width;
            state.stamp.u = Math.min(Math.max(state.stamp.u + nudge[0] * step, 0), 1);
            state.stamp.v = Math.min(Math.max(
                state.stamp.v + nudge[1] * step * (state.viewport.width / state.viewport.height), 0), 1);
            drawOverlay();
            savePrefsSoon();
        });
    }


    /* === NAMES =========================================================== */

    function parseNames(raw, linesOnly) {
        const parts = [];
        String(raw).replace(INVISIBLE, '').split(/\r?\n/).forEach(line => {
            if (linesOnly) parts.push(line);
            else line.split(/[,;\t]/).forEach(p => parts.push(p));
        });

        const seen = new Set();
        const out = [];
        parts
            // Pasted class lists are usually numbered — "12. Ana Hoxha".
            .map(s => s.replace(/^\s*\d{1,3}\s*[.)\-]\s+/, '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .forEach(s => {
                const key = s.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push(s);
            });
        return { names: out, dropped: parts.filter(s => s.trim()).length - out.length };
    }

    function refreshNames() {
        const { names, dropped } = parseNames(dom.namesInput.value, dom.linesOnly.checked);
        state.names = names;
        state.approx = new Set(
            state.font && !state.font.standardName ? [] : names.filter(n => toStampable(n).changed));

        dom.nameChips.textContent = '';
        const frag = document.createDocumentFragment();
        names.forEach((name, i) => {
            const chip = document.createElement('span');
            chip.className = 'es-chip' + (state.approx.has(name) ? ' is-approx' : '');
            if (state.approx.has(name)) {
                chip.title = `Stamped as "${toStampable(name).text}" — a built-in font can't reproduce every character. Pick one of the downloaded fonts to keep them.`;
            }
            const label = document.createElement('span');
            label.textContent = name;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.innerHTML = '&times;';
            remove.setAttribute('aria-label', `Remove ${name}`);
            // The list is rewritten one per line. That needs no change to
            // "don't split on commas": with it off, no parsed name can
            // contain a comma, so the rewrite reads back identically.
            remove.onclick = () => {
                dom.namesInput.value = state.names.filter((_, j) => j !== i).join('\n');
                refreshNames();
            };
            chip.append(label, remove);
            frag.appendChild(chip);
        });
        dom.nameChips.appendChild(frag);

        const bits = [`${names.length} ${names.length === 1 ? 'name' : 'names'}`];
        if (dropped > 0) bits.push(`${dropped} duplicate${dropped === 1 ? '' : 's'} ignored`);
        if (state.approx.size) bits.push(`${state.approx.size} will lose accents when stamped`);
        dom.namesSummary.textContent = names.length ? bits.join(' · ') : 'No names yet.';

        // "Preview with" keeps its selection if that name is still in the list.
        const previous = dom.previewNameSel.value;
        dom.previewNameSel.textContent = '';
        (names.length ? names : ['Student Name']).forEach(n => {
            const opt = document.createElement('option');
            opt.value = names.length ? n : '';
            opt.textContent = n;
            dom.previewNameSel.appendChild(opt);
        });
        dom.previewNameSel.value = names.includes(previous) ? previous : (names[0] || '');

        setChip(dom.chipNames, 'fa-users', `${names.length} ${names.length === 1 ? 'name' : 'names'}`);
        // "Alternate in list order" means the list order, so it is redealt
        // when the list changes; a shuffle is left alone and only topped up.
        if (state.dealt === 'alternate' && state.variants.length > 1) alternateGroups();
        ensureAssignments();
        renderGroups();
        updateOutputExample();
        drawOverlay();
        drawWatermarkOverlay();
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Could not load ${src}`));
            document.head.appendChild(s);
        });
    }

    // Header cells, in English and Albanian. A pair of first-name and surname
    // columns is joined; any other name-ish header is just dropped.
    const NAME_HEADER = /^(full ?names?|names?|students?|student ?names?|surnames?|emri|emër|emrat|mbiemri|studenti|studentët)\b/i;
    const FIRST_HEADER = /^((first|given)[ _-]?)?names?$|^emri$|^emër$/i;
    const LAST_HEADER = /^(last|family|sur)[ _-]?names?$|^mbiemri$|^mbiemër$/i;
    const WHOLE_NAME = /[A-Za-zÀ-ÿ]{2,}[ '\-][A-Za-zÀ-ÿ]{2,}/;
    const ONE_WORD = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž'’-]+$/;

    // Picks the column that looks most like a list of people. Whatever it
    // guesses lands in the textarea, where it is plainly visible and editable
    // — so a wrong guess costs a glance, not a broken batch.
    function namesFromRows(rows) {
        const cell = (r, c) => String((r && r[c]) ?? '').trim();
        const filled = rows.filter(r => r.some((_, c) => cell(r, c)));
        if (!filled.length) return [];
        // One line of a .txt, "Ana Hoxha, Besa Krasniqi, …": the cells are
        // the names, not columns to choose between.
        if (filled.length === 1) return filled[0].map((_, c) => cell(filled[0], c)).filter(Boolean);

        const join = (from, a, b) => filled.slice(from)
            .map(r => `${cell(r, a)} ${cell(r, b)}`.trim()).filter(Boolean);

        // A header with a first-name column and a surname column — the usual
        // shape of a registry export. Looked for in the first few rows, since
        // a title line often sits above the header.
        for (let h = 0; h < Math.min(filled.length, 5); h++) {
            const head = filled[h].map((_, c) => cell(filled[h], c));
            const last = head.findIndex(t => LAST_HEADER.test(t));
            const first = head.findIndex((t, c) => c !== last && FIRST_HEADER.test(t));
            if (first >= 0 && last >= 0) return join(h + 1, first, last);
        }

        const width = filled.reduce((m, r) => Math.max(m, r.length), 0);
        let best = { score: -1, col: 0, whole: 0 };
        const oneWordCols = [];
        for (let c = 0; c < width; c++) {
            const cells = filled.map(r => cell(r, c)).filter(Boolean);
            const whole = cells.filter(v => WHOLE_NAME.test(v)).length;
            const score = whole * 10 + cells.length;
            if (score > best.score) best = { score, col: c, whole };
            if (cells.length && cells.filter(v => ONE_WORD.test(v)).length >= cells.length * 0.6) oneWordCols.push(c);
        }

        // No column holds whole names, but two hold single words: first names
        // and surnames side by side with no header — a two-column paste out
        // of a spreadsheet, typically. Joined in the order they appear.
        if (!best.whole && oneWordCols.length >= 2) return join(0, oneWordCols[0], oneWordCols[1]);

        const cells = filled.map(r => cell(r, best.col)).filter(Boolean);
        if (cells.length > 1 && NAME_HEADER.test(cells[0])) cells.shift();
        return cells;
    }

    // One line of a CSV/TSV export, split on , ; or tab. Quoted fields stay
    // whole and lose their quotes, so "Hoxha, Ana" is one name, not two, and
    // an exporter that quotes every cell doesn't put quote marks on the paper.
    function splitRow(line) {
        const cells = [];
        let cell = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"' && !cell.trim()) {
                quoted = true;
                cell = '';
            } else if (ch === ',' || ch === ';' || ch === '\t') {
                cells.push(cell);
                cell = '';
            } else {
                cell += ch;
            }
        }
        cells.push(cell);
        return cells;
    }

    async function importNamesFile(file) {
        try {
            let names;
            if (/\.(xlsx|xls)$/i.test(file.name)) {
                if (!window.XLSX) await loadScript(XLSX_CDN);
                const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                names = namesFromRows(window.XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }));
            } else {
                const rows = (await file.text()).replace(INVISIBLE, '').split(/\r?\n/).map(splitRow);
                names = namesFromRows(rows);
            }
            const clean = parseNames(names.join('\n'), true).names;
            if (!clean.length) {
                showNotification('warning', 'Nothing to import', `No names found in ${file.name}.`);
                return;
            }
            const before = { text: dom.namesInput.value, linesOnly: dom.linesOnly.checked };
            dom.namesInput.value = clean.join('\n');
            // "Hoxha, Ana" from a quoted cell is one name, and must stay one.
            if (clean.some(n => /[,;\t]/.test(n))) dom.linesOnly.checked = true;
            refreshNames();
            savePrefsSoon();
            showNotification('success', 'List imported',
                `${clean.length} name${clean.length === 1 ? '' : 's'} from ${file.name}.`, 8000,
                before.text.trim() ? { label: 'Undo', onClick: () => restoreNames(before) } : null);
        } catch (err) {
            console.error(err);
            showNotification('error', "Couldn't read that list", err.message || String(err));
        }
    }

    function restoreNames(before) {
        dom.namesInput.value = before.text;
        dom.linesOnly.checked = before.linesOnly;
        refreshNames();
        savePrefsSoon();
    }

    /* A block copied out of Excel or Sheets arrives as tab-separated rows,
       usually with a number column and an ID column either side of the
       names. Split on tabs, every ID would become a "student" — so a
       multi-row, multi-column paste goes through the same column picker as
       an uploaded spreadsheet. insertText keeps it on the textarea's own undo
       stack, so Ctrl+Z still takes it back out. */
    function onNamesPaste(e) {
        const text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (!text || !text.includes('\t')) return;
        const rows = text.replace(INVISIBLE, '').split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t'));
        if (rows.length < 2 || !rows.some(r => r.length > 1)) return;
        const names = namesFromRows(rows);
        if (!names.length) return;
        e.preventDefault();

        const el = dom.namesInput;
        const before = el.value.slice(0, el.selectionStart);
        const after = el.value.slice(el.selectionEnd);
        // Keep the pasted names on lines of their own.
        const insert = (before && !before.endsWith('\n') ? '\n' : '') + names.join('\n') +
            (after && !after.startsWith('\n') ? '\n' : '');
        if (names.some(n => /[,;\t]/.test(n))) dom.linesOnly.checked = true;
        if (!document.execCommand('insertText', false, insert)) {
            el.setRangeText(insert, el.selectionStart, el.selectionEnd, 'end');
            refreshNames();
        }
    }


    /* === EXAM PAPERS (one per group) ===================================== */

    async function addPdfFiles(files) {
        let added = 0;
        for (const file of files) {
            if (state.variants.length >= LETTERS.length) {
                showNotification('warning', `${LETTERS.length} papers is the limit`,
                    `One per letter of the alphabet. ${file.name} and anything after it were left out.`);
                break;
            }
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());

                // pdf-lib writes the copies, and it is stricter than pdf.js —
                // so a file it can't take is turned away now, not half-way
                // through the class. That includes "restricted" PDFs: no
                // password to open, but an owner password against editing.
                // pdf.js shows them happily, yet every copy written from one
                // comes out unopenable.
                const check = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
                if (check.isEncrypted) {
                    showNotification('error', `${file.name} has editing restrictions`,
                        "Its copies wouldn't open. Open it in a PDF viewer, print it to a new PDF (Microsoft Print to PDF, or Save as PDF), and add that file instead.");
                    continue;
                }

                // pdf.js transfers whatever buffer it is given to its worker,
                // which detaches it — so it gets a copy and pdf-lib keeps the
                // original.
                const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
                state.variants.push({
                    letter: LETTERS[state.variants.length],
                    fileName: file.name,
                    base: sanitizeFileName(file.name.replace(/\.pdf$/i, '')) || 'exam',
                    bytes, pdf, pageCount: pdf.numPages, size: file.size,
                });
                added++;
            } catch (err) {
                console.error(err);
                const locked = err && err.name === 'PasswordException';
                showNotification('error',
                    locked ? `${file.name} is password-protected` : `Couldn't open ${file.name}`,
                    locked ? 'Remove the password first, then try again.' : (err.message || String(err)));
            }
        }
        if (!added) return;

        relabel();
        state.active = state.variants.length - added;   // show the first new one
        dom.previewWrap.classList.remove('hidden');
        dom.pdfDrop.classList.add('has-file');

        // Going from one paper to two used to leave the whole class on A:
        // everyone already had a valid group (the only one), so nothing was
        // ever dealt onto B. Now any change in the number of papers redeals —
        // unless the split was made by hand, which is never thrown away.
        if (state.variants.length > 1) {
            if (state.dealt !== 'manual') redeal();
            else {
                showNotification('info', 'Your groups were kept',
                    'You set some students by hand, so the new paper starts with nobody on it. Shuffle in step 3 to deal everyone again.', 8000);
            }
        }
        ensureAssignments();
        renderPapers();
        renderGroups();
        updatePdfChip();
        if (state.zipAuto) dom.zipName.value = autoZipName();

        openModule('mod-pdf');
        await renderPage(1);
        await renderWatermarkPage();
        updateOutputExample();
    }

    const relabel = () => state.variants.forEach((v, i) => { v.letter = LETTERS[i]; });

    // Reordering changes which paper is A, so the students on each paper move
    // with it rather than staying on a letter.
    function movePaper(from, to) {
        if (to < 0 || to >= state.variants.length) return;
        const [moved] = state.variants.splice(from, 1);
        state.variants.splice(to, 0, moved);
        relabel();

        Object.keys(state.assign).forEach(name => {
            const old = state.assign[name];
            // Work out where the paper that student was on has ended up.
            let target = old;
            if (old === from) target = to;
            else if (from < to && old > from && old <= to) target = old - 1;
            else if (from > to && old >= to && old < from) target = old + 1;
            state.assign[name] = target;
        });

        if (state.active === from) state.active = to;
        else if (from < to && state.active > from && state.active <= to) state.active--;
        else if (from > to && state.active >= to && state.active < from) state.active++;

        renderPapers();
        renderGroups();
        updateOutputExample();
        renderPage(state.currentPage);
        renderWatermarkPage(state.wmPage);
    }

    function removePaper(index) {
        const v = state.variants[index];
        if (!v) return;
        try { v.pdf.destroy(); } catch { /* already gone */ }
        state.variants.splice(index, 1);
        relabel();

        // Anyone sitting the removed paper is redealt; everyone above it
        // shifts down a place.
        Object.keys(state.assign).forEach(name => {
            const g = state.assign[name];
            if (g === index) delete state.assign[name];
            else if (g > index) state.assign[name] = g - 1;
        });
        // Down to one paper there is no split left to protect, so the next
        // paper added gets a fresh deal rather than an empty group.
        if (state.variants.length <= 1) state.dealt = 'shuffle';
        else if (state.dealt !== 'manual') redeal();

        state.active = Math.max(0, Math.min(state.active, state.variants.length - 1));
        ensureAssignments();
        renderPapers();
        renderGroups();
        updatePdfChip();
        updateOutputExample();

        if (!state.variants.length) {
            dom.previewWrap.classList.add('hidden');
            dom.pdfDrop.classList.remove('has-file');
            dom.pdfDropTitle.textContent = 'Drop the exam PDF here';
            state.viewport = null;
            state.stampBox = null;
            dom.stampWarn.classList.add('hidden');
            renderWatermarkPage();
        } else {
            if (state.zipAuto) dom.zipName.value = autoZipName();
            renderPage(1);
            renderWatermarkPage();
        }
    }

    const autoZipName = () => `${state.variants.length ? state.variants[0].base : 'exam'}-stamped.zip`;

    function updatePdfChip() {
        const n = state.variants.length;
        if (!n) { setChip(dom.chipPdf, 'fa-file-pdf', 'No PDF'); return; }
        const pages = state.variants.reduce((m, v) => Math.max(m, v.pageCount), 0);
        setChip(dom.chipPdf, 'fa-file-pdf',
            n === 1 ? `${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(state.variants[0].size)}`
                : `${n} groups · up to ${pages} pages`);
        dom.pdfDropTitle.textContent = n === 1
            ? state.variants[0].fileName
            : `${n} papers, one per group — drop another to add one`;
    }

    function renderPapers() {
        const many = state.variants.length > 1;
        dom.paperList.textContent = '';
        dom.paperList.classList.toggle('hidden', !state.variants.length);
        dom.paperHint.classList.toggle('hidden', !many);

        state.variants.forEach((v, i) => {
            const row = document.createElement('div');
            row.className = 'es-paper' + (i === state.active ? ' active' : '');
            row.title = 'Show this paper in the preview';

            const badge = document.createElement('div');
            badge.className = 'es-paper-badge' + (many ? '' : ' single');
            if (many) badge.textContent = v.letter;
            else badge.innerHTML = '<i class="fa-solid fa-file-pdf"></i>';

            const info = document.createElement('div');
            info.className = 'es-paper-info';
            const name = document.createElement('span');
            name.className = 'es-paper-name';
            name.textContent = v.fileName;
            const meta = document.createElement('span');
            meta.className = 'es-paper-meta';
            meta.textContent = many
                ? `Group ${v.letter} · ${v.pageCount} page${v.pageCount === 1 ? '' : 's'} · ${formatBytes(v.size)}`
                : `${v.pageCount} page${v.pageCount === 1 ? '' : 's'} · ${formatBytes(v.size)}`;
            info.append(name, meta);

            const tools = document.createElement('div');
            tools.className = 'es-paper-tools';
            if (many) {
                tools.append(
                    toolButton('fa-arrow-up', 'Move up (becomes an earlier letter)', i === 0,
                        () => movePaper(i, i - 1)),
                    toolButton('fa-arrow-down', 'Move down (becomes a later letter)',
                        i === state.variants.length - 1, () => movePaper(i, i + 1)));
            }
            tools.appendChild(toolButton('fa-trash', 'Remove this paper', false,
                () => removePaper(i), true));

            row.append(badge, info, tools);
            const show = () => {
                state.active = i;
                renderPapers();
                renderPage(Math.min(state.currentPage, v.pageCount));
                renderWatermarkPage(Math.min(state.wmPage, v.pageCount));
                dom.paperList.children[i]?.focus({ preventScroll: true });
            };
            row.tabIndex = 0;
            row.setAttribute('role', 'button');
            row.setAttribute('aria-pressed', String(i === state.active));
            row.addEventListener('click', show);
            row.addEventListener('keydown', (e) => {
                if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                show();
            });
            dom.paperList.appendChild(row);
        });
    }

    function toolButton(icon, title, disabled, onClick, danger) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = danger ? 'danger' : '';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        if (disabled) b.disabled = true;
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    }


    /* === GROUPS ==========================================================
       With more than one paper on the table, every student needs one of them.
       The default deal is a cryptographically shuffled round-robin: uniformly
       random, and even to within one student per group. Anything set by hand
       afterwards is kept.
       ==================================================================== */

    // Rejection-sampled so the modulo doesn't skew the low values — the whole
    // point of "truly random" is that nobody can predict a group from a name.
    function randomInt(max) {
        if (max <= 1) return 0;
        const limit = Math.floor(0x100000000 / max) * max;
        const buf = new Uint32Array(1);
        let x;
        do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
        return x % max;
    }

    function cryptoShuffle(list) {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function shuffleGroups() {
        const k = Math.max(1, state.variants.length);
        state.assign = {};
        state.dealt = 'shuffle';
        cryptoShuffle(state.names).forEach((n, i) => { state.assign[n] = i % k; });
    }

    function alternateGroups() {
        const k = Math.max(1, state.variants.length);
        state.assign = {};
        state.dealt = 'alternate';
        state.names.forEach((n, i) => { state.assign[n] = i % k; });
    }

    const redeal = () => (state.dealt === 'alternate' ? alternateGroups() : shuffleGroups());

    // Everyone always has a valid group: new names join the smallest one, and
    // assignments to a paper that has gone away are redealt.
    function ensureAssignments() {
        const k = state.variants.length;
        const live = new Set(state.names);
        Object.keys(state.assign).forEach(n => { if (!live.has(n)) delete state.assign[n]; });
        if (k === 0) return;

        const counts = new Array(k).fill(0);
        const missing = [];
        for (const n of state.names) {
            const g = state.assign[n];
            if (Number.isInteger(g) && g >= 0 && g < k) counts[g]++;
            else missing.push(n);
        }
        for (const n of cryptoShuffle(missing)) {
            let min = 0;
            for (let i = 1; i < k; i++) if (counts[i] < counts[min]) min = i;
            state.assign[n] = min;
            counts[min]++;
        }
    }

    function groupCounts() {
        const counts = new Array(state.variants.length).fill(0);
        state.names.forEach(n => {
            const g = state.assign[n];
            if (Number.isInteger(g) && g < counts.length) counts[g]++;
        });
        return counts;
    }

    function renderGroups() {
        const many = state.variants.length > 1;
        dom.groupsSingle.classList.toggle('hidden', many);
        dom.groupsPanel.classList.toggle('hidden', !many);
        dom.groupCount.textContent = many
            ? `${state.variants.length} groups · ${state.names.length} students`
            : '';
        if (!many) return;

        // The selects first: a filter left pointing at a paper that has just
        // been removed falls back to "all" here, before the chips read it.
        fillGroupSelect(dom.groupFilter, true);
        fillGroupSelect(dom.groupBulk, false);

        const counts = groupCounts();
        dom.groupStats.textContent = '';
        state.variants.forEach((v, i) => {
            const chip = document.createElement('button');
            chip.className = 'es-group-stat' + (dom.groupFilter.value === String(i) ? ' active' : '');
            chip.type = 'button';
            chip.innerHTML = `<strong>${v.letter}</strong> ${counts[i]}`;
            chip.title = `${v.fileName} — ${counts[i]} student${counts[i] === 1 ? '' : 's'}`;
            chip.onclick = () => {
                dom.groupFilter.value = dom.groupFilter.value === String(i) ? 'all' : String(i);
                renderGroups();
            };
            dom.groupStats.appendChild(chip);
        });

        renderGroupList();
    }

    function fillGroupSelect(select, withAll) {
        const previous = select.value;
        select.textContent = '';
        if (withAll) {
            const opt = document.createElement('option');
            opt.value = 'all';
            opt.textContent = 'All groups';
            select.appendChild(opt);
        }
        state.variants.forEach((v, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = `Group ${v.letter}`;
            select.appendChild(opt);
        });
        select.value = [...select.options].some(o => o.value === previous)
            ? previous : (withAll ? 'all' : '0');
    }

    // Hundreds of rows are fine as plain DOM as long as they are built in one
    // fragment and the browser is told it may skip painting the off-screen
    // ones (content-visibility, in the stylesheet).
    function renderGroupList() {
        const query = dom.groupSearch.value.trim().toLowerCase();
        const filter = dom.groupFilter.value;
        const frag = document.createDocumentFragment();
        let shown = 0;

        state.names.forEach((name, index) => {
            const g = state.assign[name] ?? 0;
            if (filter !== 'all' && String(g) !== filter) return;
            if (query && !name.toLowerCase().includes(query)) return;
            shown++;

            const row = document.createElement('div');
            row.className = 'es-group-row';
            row.dataset.name = name;

            const num = document.createElement('span');
            num.className = 'es-group-index';
            num.textContent = index + 1;

            const label = document.createElement('span');
            label.className = 'es-group-name';
            label.textContent = name;

            const pick = document.createElement('div');
            pick.className = 'es-group-pick';
            if (state.variants.length <= 6) {
                state.variants.forEach((v, i) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'es-group-btn' + (i === g ? ' active' : '');
                    b.textContent = v.letter;
                    b.dataset.group = String(i);
                    b.title = v.fileName;
                    pick.appendChild(b);
                });
            } else {
                const sel = document.createElement('select');
                sel.className = 'form-control es-group-select';
                state.variants.forEach((v, i) => {
                    const opt = document.createElement('option');
                    opt.value = String(i);
                    opt.textContent = v.letter;
                    sel.appendChild(opt);
                });
                sel.value = String(g);
                pick.appendChild(sel);
            }

            row.append(num, label, pick);
            frag.appendChild(row);
        });

        dom.groupList.textContent = '';
        if (!shown) {
            const empty = document.createElement('div');
            empty.className = 'es-hint';
            empty.style.padding = '14px';
            empty.textContent = state.names.length
                ? 'No students match that search.' : 'Add the class list in step 1.';
            dom.groupList.appendChild(empty);
        } else {
            dom.groupList.appendChild(frag);
        }

        // The bulk button acts on the rows on screen, so with a search or a
        // filter in force it says so rather than claiming "all".
        const narrowed = Boolean(query) || filter !== 'all';
        dom.btnAssignShown.textContent = narrowed ? `Apply to ${shown} shown` : 'Apply to all';
        dom.btnAssignShown.disabled = !shown;
    }

    function setGroup(name, groupIndex) {
        state.assign[name] = groupIndex;
        state.dealt = 'manual';
        // Only the row that changed is touched — redrawing hundreds of rows on
        // every click would make the list feel broken.
        const row = dom.groupList.querySelector(`.es-group-row[data-name="${cssEscape(name)}"]`);
        if (row) {
            row.querySelectorAll('.es-group-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.group === String(groupIndex));
            });
            const sel = row.querySelector('.es-group-select');
            if (sel) sel.value = String(groupIndex);
        }
        updateGroupStats();
        updateOutputExample();
    }

    function updateGroupStats() {
        const counts = groupCounts();
        dom.groupStats.querySelectorAll('.es-group-stat').forEach((chip, i) => {
            chip.innerHTML = `<strong>${state.variants[i].letter}</strong> ${counts[i]}`;
        });
    }

    const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

    // Every one of the bulk actions replaces the whole split, hand-made
    // choices included, so each offers its way back.
    function groupsUndo() {
        const saved = { assign: { ...state.assign }, dealt: state.dealt };
        return {
            label: 'Undo',
            onClick: () => {
                state.assign = saved.assign;
                state.dealt = saved.dealt;
                ensureAssignments();
                renderGroups();
                updateOutputExample();
            },
        };
    }

    function wireGroups() {
        dom.btnShuffle.addEventListener('click', () => {
            const undo = groupsUndo();
            shuffleGroups();
            renderGroups();
            updateOutputExample();
            showNotification('success', 'Groups shuffled',
                `${state.names.length} students dealt at random across ${state.variants.length} papers.`, 8000, undo);
        });
        dom.btnAlternate.addEventListener('click', () => {
            const undo = groupsUndo();
            alternateGroups();
            renderGroups();
            updateOutputExample();
            showNotification('info', 'Groups set in list order',
                'Useful when the class list is already in seating order. Reordering the list redeals it.', 8000, undo);
        });
        dom.groupSearch.addEventListener('input', renderGroupList);
        dom.groupFilter.addEventListener('change', renderGroups);
        dom.btnAssignShown.addEventListener('click', () => {
            const target = +dom.groupBulk.value || 0;
            const rows = [...dom.groupList.querySelectorAll('.es-group-row')];
            if (!rows.length) return;
            const undo = groupsUndo();
            rows.forEach(r => { state.assign[r.dataset.name] = target; });
            state.dealt = 'manual';
            renderGroups();
            updateOutputExample();
            showNotification('info', 'Group set',
                `${rows.length} student${rows.length === 1 ? '' : 's'} moved to group ${state.variants[target].letter}.`, 8000, undo);
        });

        // One listener for every row, however many there are.
        dom.groupList.addEventListener('click', (e) => {
            const btn = e.target.closest('.es-group-btn');
            if (!btn) return;
            setGroup(btn.closest('.es-group-row').dataset.name, +btn.dataset.group);
        });
        dom.groupList.addEventListener('change', (e) => {
            if (!e.target.classList.contains('es-group-select')) return;
            setGroup(e.target.closest('.es-group-row').dataset.name, +e.target.value);
        });
    }


    /* === GENERATION ======================================================
       Each copy is built by re-parsing the original bytes rather than by
       copying pages into a fresh document: it is a little slower, but it keeps
       everything the original had — form fields, annotations, outlines,
       embedded fonts — byte for byte, which matters when the thing being
       reproduced is the exam itself.
       ==================================================================== */

    async function embed(doc, bundle) {
        if (bundle.standardName) return doc.embedFont(bundle.standardName);
        doc.registerFontkit(window.fontkit);
        return doc.embedFont(bundle.bytes, { subset: true });
    }

    async function buildCopy(job, name, variant, anchor) {
        const { PDFDocument, degrees } = PDFLib;
        const { cfg, wm, fonts } = job;

        const doc = await PDFDocument.load(variant.bytes.slice(), { ignoreEncryption: true });
        const stampFont = await embed(doc, fonts.stamp);
        // Reuse the one embedded font when both halves want the same face,
        // rather than subsetting the same TTF into the file twice.
        const wmFont = wm.enabled
            ? (sameFace(fonts.stamp, fonts.wm) ? stampFont : await embed(doc, fonts.wm))
            : null;
        const pages = doc.getPages();

        // --- the name on the cover ---
        const target = pages[anchor.pageNo - 1];
        const stampText = prepText(fillTemplate(cfg.template, name, variant), fonts.stamp).text;
        const rotation = (target.getRotation().angle % 360 + 360) % 360;
        const textW = stampFont.widthOfTextAtSize(stampText, cfg.size);
        const g = stampGeometry(rotation, anchor, textW, cfg.align);
        const color = pdfColor(cfg.hex);

        target.drawText(stampText, {
            x: g.x, y: g.y, size: cfg.size, font: stampFont, color,
            rotate: degrees(rotation),
            // Shearing the text matrix is what an oblique cut does anyway, so
            // this is a faithful stand-in for a family with no italic file.
            // It has to be ySkew: despite the name, that is the one pdf-lib
            // puts in the matrix's "c" slot — displacing x by y, i.e. a lean.
            // xSkew tilts the baseline instead, which reads as rotation.
            ySkew: degrees(fonts.stamp.faux ? FAUX_ITALIC_DEG : 0),
        });

        if (cfg.line) {
            const pad = Math.max(6, textW * 0.08);
            const drop = cfg.size * 0.3;
            const sx = g.x - g.dir[0] * pad + g.down[0] * drop;
            const sy = g.y - g.dir[1] * pad + g.down[1] * drop;
            const len = textW + pad * 2;
            target.drawLine({
                start: { x: sx, y: sy },
                end: { x: sx + g.dir[0] * len, y: sy + g.dir[1] * len },
                thickness: Math.max(0.6, cfg.size * 0.05),
                color,
            });
        }

        // --- the faint tracer, everywhere ---
        if (wm.enabled) {
            const text = prepText(fillTemplate(wm.template, name, variant), fonts.wm).text;
            const wmColor = pdfColor(wm.hex);
            if (text) {
                pages.forEach((page, i) => {
                    if (!wm.cover && i === anchor.pageNo - 1) return;
                    // The crop box is what the preview was measured against; on
                    // the rare page that has none, the media box is it.
                    const box = typeof page.getCropBox === 'function'
                        ? page.getCropBox()
                        : { x: 0, y: 0, ...page.getSize() };
                    const layout = watermarkLayout(box, { ...wm, text }, wmFont);
                    for (const row of layout.rows) {
                        page.drawText(layout.line, {
                            x: row.x, y: row.y, size: wm.size, font: wmFont,
                            color: wmColor, opacity: wm.opacity, rotate: degrees(wm.angle),
                        });
                    }
                });
            }
        }

        // Belt and braces: if someone crops the pattern out of a photo, the
        // file itself still says whose copy it was, and which paper.
        const who = prepText(name, fonts.stamp).text;
        doc.setSubject(job.many
            ? `Personal copy — ${who} — group ${variant.letter}`
            : `Personal copy — ${who}`);

        return doc.save({ useObjectStreams: true });
    }

    /* Everything a batch reads, captured once when it starts. The page stays
       live while copies are written — and before this, editing the class
       list mid-batch stamped "undefined" onto every copy after the edit,
       while a tweak to the size or colour changed only the later copies. */
    async function snapshotJob() {
        ensureAssignments();
        const job = {
            fonts: {
                stamp: await ensureFont(dom.stampFont.value, state.style.bold, state.style.italic),
                wm: await ensureFont(dom.wmFont.value, false, false),
            },
            cfg: stampCfg(),
            wm: watermarkCfg(),
            names: state.names.slice(),
            assign: { ...state.assign },
            variants: state.variants.slice(),
            pattern: dom.filePattern.value,
            many: state.variants.length > 1,
        };
        // One anchor per paper, worked out once rather than per student.
        job.anchors = await Promise.all(job.variants.map(anchorFor));
        return job;
    }

    const sameFace = (a, b) => a && b && a.key === b.key && a.cut === b.cut;

    function sanitizeFileName(s) {
        return String(s)
            .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/^[.\s]+|[.\s]+$/g, '')
            .slice(0, 120) || 'file';
    }

    // A pattern may contain "/" to build folders inside the ZIP; every segment
    // is cleaned separately so no name can climb out of one.
    function sanitizePath(s) {
        return String(s).split('/').map(sanitizeFileName).filter(Boolean).join('/') || 'file';
    }

    function fileNameFor(name, index, variant, used, pattern = dom.filePattern.value) {
        let out = (pattern.trim() || '{file}_{name}.pdf')
            .replace(/\{file\}/gi, () => (variant ? variant.base : 'exam'))
            .replace(/\{group\}/gi, () => (variant ? variant.letter : ''))
            .replace(/\{name\}/gi, () => name)
            .replace(/\{index\}/gi, () => String(index + 1))
            .replace(/\{n\}/gi, () => String(index + 1).padStart(2, '0'));
        out = sanitizePath(out);
        if (!/\.pdf$/i.test(out)) out += '.pdf';

        // Two students really can share a name; neither should overwrite the other.
        let candidate = out;
        let n = 2;
        while (used && used.has(candidate.toLowerCase())) {
            candidate = out.replace(/\.pdf$/i, ` (${n++}).pdf`);
        }
        if (used) used.add(candidate.toLowerCase());
        return candidate;
    }

    function download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    const yieldToUI = () => new Promise(r => setTimeout(r, 0));

    function setProgress(fraction, label) {
        dom.progressBar.classList.add('active');
        dom.progress.style.width = `${Math.round(fraction * 100)}%`;
        if (label) setChip(dom.chipStatus, 'fa-gear fa-spin', label);
    }

    function endProgress() {
        dom.progressBar.classList.remove('active');
        dom.progress.style.width = '0%';
        setChip(dom.chipStatus, 'fa-lock', 'Runs offline in your browser');
    }

    function readyCheck() {
        if (!state.variants.length) {
            showNotification('warning', 'No exam PDF yet', 'Add the paper in step 2 first.');
            openModule('mod-pdf');
            return false;
        }
        if (!state.names.length) {
            showNotification('warning', 'No names yet', 'Add the class list in step 1 first.');
            openModule('mod-names');
            return false;
        }
        return true;
    }

    async function generateTest() {
        if (state.running || !readyCheck()) return;
        state.running = true;
        setBusy(true);
        try {
            setProgress(0.5, 'Building test copy…');
            const job = await snapshotJob();
            const name = sampleName() || job.names[0];
            const gi = job.variants[job.assign[name]] ? job.assign[name] : state.active;
            const variant = job.variants[gi] || job.variants[0];
            const bytes = await buildCopy(job, name, variant, job.anchors[job.variants.indexOf(variant)]);
            // Named exactly as it will be in the ZIP, {index} and {n} included.
            const file = fileNameFor(name, Math.max(0, job.names.indexOf(name)), variant, null, job.pattern);
            download(new Blob([bytes], { type: 'application/pdf' }), file);
            showNotification('success', 'Test copy downloaded',
                `${file}${job.many ? `, on paper ${variant.letter}` : ''}. Open it and check the name before running the whole class.`);
        } catch (err) {
            console.error(err);
            showNotification('error', "Couldn't build that copy", err.message || String(err));
        } finally {
            state.running = false;
            setBusy(false);
            endProgress();
        }
    }

    async function generateZip() {
        if (state.running || !readyCheck()) return;

        const avg = state.variants.reduce((s, v) => s + v.size, 0) / state.variants.length;
        if (avg * state.names.length > 400 * 1024 * 1024) {
            showNotification('warning', 'That is a very large batch',
                `Roughly ${formatBytes(avg * state.names.length)} has to be held in memory. If the tab runs out, split the class in two.`,
                9000);
        }

        state.running = true;
        state.cancelled = false;
        setBusy(true);

        try {
            const job = await snapshotJob();
            const zip = new JSZip();
            const used = new Set();
            const total = job.names.length;
            const counts = new Array(job.variants.length).fill(0);

            for (let i = 0; i < total; i++) {
                if (state.cancelled) break;
                const name = job.names[i];
                const gi = job.variants[job.assign[name]] ? job.assign[name] : 0;
                const variant = job.variants[gi];
                counts[gi]++;
                setProgress(i / total, `Stamping ${i + 1} of ${total}…`);
                const bytes = await buildCopy(job, name, variant, job.anchors[gi]);
                zip.file(fileNameFor(name, i, variant, used, job.pattern), bytes);
                await yieldToUI();   // keep the tab responsive, and cancel live
            }

            if (state.cancelled) {
                showNotification('info', 'Cancelled', 'Nothing was downloaded.');
                return;
            }

            setProgress(1, 'Packing the ZIP…');
            const blob = await zip.generateAsync(
                { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
                (meta) => {
                    if (!state.cancelled) setProgress(meta.percent / 100, `Packing the ZIP… ${Math.round(meta.percent)}%`);
                });
            // Cancel stays on screen while the ZIP packs, so it has to work
            // there too — it used to be ignored and the download went ahead.
            if (state.cancelled) {
                showNotification('info', 'Cancelled', 'Nothing was downloaded.');
                return;
            }

            const typed = dom.zipName.value.replace(/\.zip$/i, '').trim();
            const zipName = sanitizeFileName(typed || autoZipName().replace(/\.zip$/i, '')) + '.zip';
            download(blob, zipName);

            const spread = job.many
                ? ` · ${counts.map((c, i) => `${job.variants[i].letter}:${c}`).join(' ')}`
                : '';
            showNotification('success', 'Done',
                `${total} copies · ${formatBytes(blob.size)}${spread}`, 8000);
        } catch (err) {
            console.error(err);
            showNotification('error', 'Generation failed', err.message || String(err));
        } finally {
            state.running = false;
            state.cancelled = false;
            setBusy(false);
            endProgress();
        }
    }

    function setBusy(busy) {
        dom.btnGenerate.disabled = busy;
        dom.btnTest.disabled = busy;
        dom.btnCancel.classList.toggle('hidden', !busy);
        trackButtonRows(dom.btnGenerate.parentElement);
    }


    /* === STYLE TOOLBAR AND COLOUR CONTROLS =============================== */

    function syncStyleButtons() {
        dom.stampBold.setAttribute('aria-pressed', String(state.style.bold));
        dom.stampItalic.setAttribute('aria-pressed', String(state.style.italic));
        dom.stampLine.setAttribute('aria-pressed', String(state.style.line));
        dom.stampAlign.querySelectorAll('[data-align]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.align === state.style.align));
        });
    }

    function wireStyleToolbar() {
        dom.stampStyle.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-style]');
            if (!btn || btn.disabled) return;
            const which = btn.dataset.style;
            state.style[which] = !state.style[which];
            syncStyleButtons();
            savePrefsSoon();
            // Bold and italic change which font file is needed; the rule
            // underneath is drawn by hand and needs no reload.
            if (which === 'line') drawOverlay();
            else await applyStampFont();
        });

        dom.stampAlign.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-align]');
            if (!btn) return;
            state.style.align = btn.dataset.align;
            syncStyleButtons();
            drawOverlay();
            savePrefsSoon();
        });
    }

    // Wraps each <input type="color"> with a hex field and a row of swatches,
    // and keeps all three in step.
    function wireColourControls(onChange) {
        document.querySelectorAll('.es-colour').forEach(wrap => {
            const well = wrap.querySelector('.es-colour-well');
            const hex = wrap.querySelector('.es-colour-hex');
            const swatches = wrap.querySelector('.es-swatches');

            SWATCHES.forEach(colour => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'es-swatch';
                b.style.background = colour;
                b.title = colour;
                b.setAttribute('aria-label', `Use ${colour}`);
                b.addEventListener('click', () => set(colour));
                swatches.appendChild(b);
            });

            function paintState() {
                hex.value = well.value.toLowerCase();
                swatches.querySelectorAll('.es-swatch').forEach((s, i) => {
                    s.classList.toggle('active', SWATCHES[i].toLowerCase() === well.value.toLowerCase());
                });
            }

            function set(colour) {
                well.value = colour;
                paintState();
                onChange();
            }

            well.addEventListener('input', () => { paintState(); onChange(); });
            hex.addEventListener('input', () => {
                const v = hex.value.trim();
                // Only push a value through once it is a complete colour, so
                // typing "#1a2" doesn't repaint with something half-entered.
                if (/^#[\da-f]{6}$/i.test(v)) {
                    well.value = v;
                    swatches.querySelectorAll('.es-swatch').forEach((s, i) => {
                        s.classList.toggle('active', SWATCHES[i].toLowerCase() === v.toLowerCase());
                    });
                    onChange();
                }
            });
            hex.addEventListener('blur', paintState);

            wrap._paint = paintState;
            paintState();
        });
    }


    /* === PREFERENCES =====================================================
       Every control on the page, plus where the name sits, kept in
       localStorage so the next exam starts where the last one left off. The
       class list and the papers are deliberately not saved.
       ==================================================================== */

    const PREFS = [
        ['linesOnly', 'checked'], ['stampTemplate', 'value'], ['stampFont', 'value'],
        ['stampSize', 'value'], ['stampColor', 'value'],
        ['wmEnabled', 'checked'], ['wmTemplate', 'value'], ['wmFont', 'value'],
        ['wmOpacity', 'value'], ['wmSize', 'value'], ['wmAngle', 'value'], ['wmGap', 'value'],
        ['wmColor', 'value'], ['wmCover', 'checked'], ['filePattern', 'value'],
    ];

    // What every control says in the markup, captured before any saved
    // preferences are applied — Reset puts these back.
    const DEFAULTS = {};
    function captureDefaults() {
        PREFS.forEach(([key, prop]) => { DEFAULTS[key] = dom[key][prop]; });
        DEFAULTS.stamp = { ...state.stamp };
        DEFAULTS.style = { ...state.style };
    }

    // In place, not by reloading: a reload also threw away the class list
    // and the papers, which are exactly what nobody wants to re-enter.
    async function resetPrefs() {
        clearTimeout(prefsTimer);
        try { localStorage.removeItem(PREF_KEY); } catch { /* private mode */ }
        PREFS.forEach(([key, prop]) => { dom[key][prop] = DEFAULTS[key]; });
        state.stamp = { ...DEFAULTS.stamp };
        state.style = { ...DEFAULTS.style };
        document.querySelectorAll('.es-colour').forEach(w => w._paint && w._paint());
        syncReadouts();
        syncStyleButtons();
        await applyStampFont();       // redraws, and re-reads the list
        await applyWatermarkFont();
        if (state.variants.length) {
            renderPage(stampPageOf(activeVariant()));
            renderWatermarkPage();
        }
        updateOutputExample();
        showNotification('success', 'Settings reset', 'Back to the defaults. The class list and the papers were kept.');
    }

    function savePrefs() {
        const data = { stamp: { ...state.stamp }, style: { ...state.style } };
        PREFS.forEach(([key, prop]) => { if (dom[key]) data[key] = dom[key][prop]; });
        try { localStorage.setItem(PREF_KEY, JSON.stringify(data)); } catch { /* private mode */ }
    }

    let prefsTimer;
    function savePrefsSoon() {
        clearTimeout(prefsTimer);
        prefsTimer = setTimeout(savePrefs, 400);
    }

    function loadPrefs() {
        let data = null;
        try { data = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch { /* corrupt */ }
        if (!data) return;
        PREFS.forEach(([key, prop]) => {
            if (dom[key] && data[key] !== undefined && data[key] !== null) dom[key][prop] = data[key];
        });
        // A font that has since left the menu would leave its select blank,
        // and everything downstream expects a real key.
        if (!FONTS[dom.stampFont.value]) dom.stampFont.value = DEFAULTS.stampFont;
        if (!FONTS[dom.wmFont.value]) dom.wmFont.value = DEFAULTS.wmFont;
        if (data.style) {
            state.style = {
                bold: Boolean(data.style.bold),
                italic: Boolean(data.style.italic),
                line: Boolean(data.style.line),
                align: ['left', 'center', 'right'].includes(data.style.align) ? data.style.align : 'center',
            };
        }
        if (data.stamp && Number.isFinite(data.stamp.u) && Number.isFinite(data.stamp.v)) {
            state.stamp = {
                page: Math.max(1, data.stamp.page || 1),
                u: Math.min(Math.max(data.stamp.u, 0), 1),
                v: Math.min(Math.max(data.stamp.v, 0), 1),
            };
        }
    }


    /* === SMALL UI PLUMBING =============================================== */

    function setChip(chip, icon, text) {
        // Guarded because the ZIP progress callback fires many times a second,
        // and each unguarded call would replace a DOM node.
        if (!chip || (chip._icon === icon && chip._text === text)) return;
        chip._icon = icon;
        chip._text = text;
        const span = chip.querySelector('span');
        if (span) span.textContent = text;
        const old = chip.querySelector('i, svg');
        if (old) {
            const i = document.createElement('i');
            i.className = `fa-solid ${icon}`;
            old.replaceWith(i);
        }
    }

    function formatBytes(n) {
        if (!n) return '0 KB';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
        return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function updateOutputExample() {
        if (!state.names.length || !state.variants.length) {
            dom.outputExample.textContent = 'Add names and a PDF to see an example.';
            return;
        }
        const name = state.names[0];
        const variant = state.variants[state.assign[name] ?? 0];
        const first = fileNameFor(name, 0, variant, null);
        const avg = state.variants.reduce((s, v) => s + v.size, 0) / state.variants.length;
        dom.outputExample.textContent =
            `${state.names.length} files, starting with "${first}" — roughly ${formatBytes(avg * state.names.length)} in total. Each copy also records the student's name in the PDF's document properties.`;
    }

    // Every open/close goes through here so the header's aria-expanded never
    // disagrees with what is on screen. A closed panel is only squashed to
    // zero height, so it is also made inert — otherwise Tab would wander
    // into controls nobody can see.
    function setModuleOpen(mod, open) {
        mod.classList.toggle('active', open);
        const header = mod.querySelector('.module-header');
        if (header) header.setAttribute('aria-expanded', String(open));
        const content = mod.querySelector('.module-content');
        if (content) content.inert = !open;
    }

    function openModule(id) {
        const mod = document.getElementById(id);
        if (mod) setModuleOpen(mod, true);
    }

    /* The steps are an accordion because the page is a linear form, not a
       browse list: one panel open at a time keeps the whole flow on one screen
       instead of a wall of controls. Finishing a step and pressing "Next"
       closes it and opens the following one; the headers still work as
       ordinary toggles for going back — from the keyboard too. */
    function wireModules() {
        document.querySelectorAll('.module .module-header').forEach(header => {
            const mod = header.closest('.module');
            header.setAttribute('role', 'button');
            header.tabIndex = 0;
            header.querySelectorAll('.module-background-number').forEach(n => n.setAttribute('aria-hidden', 'true'));
            setModuleOpen(mod, mod.classList.contains('active'));

            const toggle = () => {
                setModuleOpen(mod, !mod.classList.contains('active'));
                // A canvas is sized to whatever width it had when it was
                // drawn, so reopening a panel means redrawing it.
                if (!mod.classList.contains('active') || !state.variants.length) return;
                if (mod.id === 'mod-pdf') setTimeout(() => renderPage(state.currentPage), 360);
                if (mod.id === 'mod-watermark') setTimeout(() => renderWatermarkPage(state.wmPage), 360);
            };
            header.addEventListener('click', toggle);
            header.addEventListener('keydown', (e) => {
                if (e.target !== header || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                toggle();
            });
        });

        document.querySelectorAll('.es-next').forEach(btn => {
            btn.addEventListener('click', () => {
                const current = btn.closest('.module');
                const next = document.getElementById(btn.dataset.next);
                if (!next) return;
                setModuleOpen(current, false);
                setModuleOpen(next, true);
                next.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (next.id === 'mod-watermark' && state.variants.length) {
                    setTimeout(() => renderWatermarkPage(state.wmPage), 360);
                }
            });
        });
    }

    // Anything dragged onto the window is routed by type: PDFs are papers,
    // everything else is treated as a class list.
    function wireGlobalDrop() {
        let depth = 0;
        const show = (on) => dom.dropOverlay.classList.toggle('visible', on);

        window.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            depth++;
            show(true);
        });
        // Every drop is claimed, so a stray link or file can't navigate the
        // tab away and lose the list and papers — except text dragged into a
        // text field, which is left to do its ordinary thing.
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
        window.addEventListener('drop', (e) => {
            const hasFiles = e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
            if (!hasFiles && e.target.closest && e.target.closest('textarea, input[type="text"], input[type="search"], input:not([type])')) return;
            e.preventDefault();
            depth = 0;
            show(false);
            const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
            const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
            const list = files.find(f => /\.(txt|csv|tsv|xlsx|xls)$/i.test(f.name));
            if (pdfs.length) addPdfFiles(pdfs);
            if (list) importNamesFile(list);
            if (!pdfs.length && !list && files.length) {
                showNotification('warning', 'Unsupported file',
                    'Drop a PDF for the exam, or a TXT, CSV or XLSX file for the class list.');
            }
        });

        ['dragenter', 'dragover'].forEach(ev => dom.pdfDrop.addEventListener(ev, (e) => {
            e.preventDefault();
            dom.pdfDrop.classList.add('is-over');
        }));
        ['dragleave', 'drop'].forEach(ev => dom.pdfDrop.addEventListener(ev, () => {
            dom.pdfDrop.classList.remove('is-over');
        }));
    }

    function wireControls() {
        // --- names ---
        dom.namesInput.addEventListener('input', refreshNames);
        dom.namesInput.addEventListener('paste', onNamesPaste);
        dom.linesOnly.addEventListener('change', () => { refreshNames(); savePrefsSoon(); });
        dom.btnUploadNames.addEventListener('click', () => dom.namesFile.click());
        dom.namesFile.addEventListener('change', () => {
            if (dom.namesFile.files[0]) importNamesFile(dom.namesFile.files[0]);
            dom.namesFile.value = '';
        });
        dom.btnSortNames.addEventListener('click', () => {
            if (!state.names.length) return;
            dom.namesInput.value = [...state.names]
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).join('\n');
            refreshNames();
        });
        dom.btnClearNames.addEventListener('click', () => {
            if (!dom.namesInput.value.trim()) return;
            const before = { text: dom.namesInput.value, linesOnly: dom.linesOnly.checked };
            const count = state.names.length;
            dom.namesInput.value = '';
            refreshNames();
            dom.namesInput.focus();
            showNotification('info', 'List cleared',
                `${count} name${count === 1 ? '' : 's'} removed.`, 8000,
                { label: 'Undo', onClick: () => restoreNames(before) });
        });

        // --- papers ---
        dom.pdfDrop.addEventListener('click', () => dom.pdfFile.click());
        dom.pdfDrop.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            dom.pdfFile.click();
        });
        dom.pdfFile.addEventListener('change', () => {
            if (dom.pdfFile.files.length) addPdfFiles(Array.from(dom.pdfFile.files));
            dom.pdfFile.value = '';
        });
        dom.pagePrev.addEventListener('click', () => renderPage(state.currentPage - 1));
        dom.pageNext.addEventListener('click', () => renderPage(state.currentPage + 1));
        dom.wmPagePrev.addEventListener('click', () => renderWatermarkPage(state.wmPage - 1));
        dom.wmPageNext.addEventListener('click', () => renderWatermarkPage(state.wmPage + 1));

        // --- fonts ---
        dom.stampFont.addEventListener('change', () => { applyStampFont(); savePrefsSoon(); });
        dom.wmFont.addEventListener('change', () => { applyWatermarkFont(); savePrefsSoon(); });

        // --- anything that changes how a preview looks ---
        [
            dom.stampTemplate, dom.previewNameSel, dom.stampSize,
            dom.wmEnabled, dom.wmTemplate, dom.wmOpacity, dom.wmSize,
            dom.wmAngle, dom.wmGap, dom.wmCover,
        ].forEach(el => el.addEventListener('input', () => {
            syncReadouts();
            drawOverlay();
            drawWatermarkOverlay();
            savePrefsSoon();
        }));

        // Switching the tracer on for the first time needs its preview page.
        dom.wmEnabled.addEventListener('change', () => {
            if (dom.wmEnabled.checked && state.variants.length && !state.wmViewport) {
                renderWatermarkPage();
            }
        });
        dom.wmCover.addEventListener('change', () => renderWatermarkPage(state.wmPage));

        dom.filePattern.addEventListener('input', () => {
            updateOutputExample();
            savePrefsSoon();
        });
        // Once the ZIP has been named by hand, adding or removing a paper no
        // longer renames it. Emptying the field hands it back.
        dom.zipName.addEventListener('input', () => {
            state.zipAuto = !dom.zipName.value.trim();
        });

        dom.btnResetPrefs.addEventListener('click', resetPrefs);

        // --- generate ---
        const cancel = () => {
            if (!state.running) return;
            state.cancelled = true;
            setChip(dom.chipStatus, 'fa-hourglass-half', 'Stopping…');
        };
        dom.btnTest.addEventListener('click', generateTest);
        dom.btnGenerate.addEventListener('click', generateZip);
        dom.btnCancel.addEventListener('click', cancel);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
        // A batch lives only in this tab; closing it half-way loses the lot.
        window.addEventListener('beforeunload', (e) => {
            if (!state.running) return;
            e.preventDefault();
            e.returnValue = '';
        });

        // --- redraw on resize; the canvases are bitmaps, not layout ---
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!state.variants.length) return;
                renderPage(state.currentPage);
                if (state.wmViewport) renderWatermarkPage(state.wmPage);
            }, 180);
        });
        document.addEventListener('themechange', () => {
            drawOverlay();
            drawWatermarkOverlay();
        });
    }

    function syncReadouts() {
        dom.stampSizeVal.textContent = `${dom.stampSize.value} pt`;
        dom.wmOpacityVal.textContent = `${dom.wmOpacity.value}%`;
        dom.wmSizeVal.textContent = `${dom.wmSize.value} pt`;
        dom.wmAngleVal.textContent = `${dom.wmAngle.value}°`;
        dom.wmGapVal.textContent = `${dom.wmGap.value} pt`;
        // Faded and unclickable isn't enough on its own: Tab would still walk
        // through every control of a switched-off tracer.
        dom.wmBody.classList.toggle('disabled', !dom.wmEnabled.checked);
        dom.wmBody.inert = !dom.wmEnabled.checked;
    }


    /* === BOOT ============================================================ */

    async function init() {
        updateYear();
        setupThemeToggle();
        trackButtonRows(document.getElementById('names-actions'));
        trackButtonRows(document.getElementById('group-actions'));
        trackButtonRows(document.getElementById('main-actions'));

        if (!window.PDFLib || !window.pdfjsLib || !window.JSZip) {
            showNotification('error', 'Something failed to load',
                'The PDF libraries could not be fetched. Check the connection and reload.');
            dom.btnGenerate.disabled = true;
            dom.btnTest.disabled = true;
            return;
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

        // A throwaway document that owns the measuring fonts, so the previews
        // lay text out with exactly the metrics the real files are written
        // with.
        state.scratch = await PDFLib.PDFDocument.create();
        if (window.fontkit) state.scratch.registerFontkit(window.fontkit);

        buildFontSelect(dom.stampFont, 'helvetica');
        buildFontSelect(dom.wmFont, 'courier');
        captureDefaults();
        loadPrefs();
        syncStyleButtons();

        wireModules();
        wireControls();
        wireStyleToolbar();
        wireGroups();
        wireGlobalDrop();
        wirePreviewInteraction();
        wireColourControls(() => {
            drawOverlay();
            drawWatermarkOverlay();
            savePrefsSoon();
        });
        syncReadouts();

        await applyStampFont();      // also does the first refreshNames()
        await applyWatermarkFont();
        renderPapers();
        renderGroups();
        renderWatermarkPage();
        updateOutputExample();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
