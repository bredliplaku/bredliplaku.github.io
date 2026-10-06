/* ==========================================================================
   scripts.js — Figura's page logic.

   Engine (engine.js): loadWorkbook, renderChart, toSVG, toCanvas, toPDF,
   pdfFaces, parseTTF, chartKind, pngSetDpi, jpegSetDpi, encodeTIFF, cssFont,
   NUMLOC, r2.
   Chrome (common.js): setupThemeToggle, trackButtonRows, showNotification,
   updateYear.
   ========================================================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    /* ----- Settings, kept in localStorage ----- */
    const KEY = 'figura-settings';
    // First visit: numbers follow the browser's language (1,5 in Albanian, 1.5 in English).
    const localeComma = (1.5).toLocaleString().includes(',');
    const DEF = { mode: 'excel', width: 140, keep: true, height: 90, dpi: 300, fmt: 'png', bg: 'white', text: 'keep', dec: localeComma ? 'comma' : 'point' };
    let S = Object.assign({}, DEF), returning = false;
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved) { S = Object.assign(S, saved); returning = true; }
    } catch (e) { }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };
    // Once someone has saved a chart, their settings are stored and next time
    // Figura skips the settings step.
    const remember = () => { if (!returning) persist(); };

    const TYPES = ['Column', 'Bar', 'Line', 'Area', 'Scatter', 'Bubble', 'Pie', 'Doughnut', 'Pie of pie', 'Bar of pie',
        'Radar', 'Stock', 'Combination', 'Waterfall', 'Funnel', 'Histogram', 'Pareto', 'Box and whisker', 'Treemap', 'Sunburst'];

    const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let WB = null, FILE_BASE = 'charts', busy = false, sheet = '', previewAt = -1;
    const cards = new Map();

    /* ----- Text measurement, in the same fonts the charts are drawn in ----- */
    const mctx = document.createElement('canvas').getContext('2d');
    const mcache = new Map();
    function measure(text, f, size) {
        const key = (f.bold ? 'b' : '') + (f.italic ? 'i' : '') + f.family + '\u0000' + text;
        let w = mcache.get(key);
        if (w === undefined) { mctx.font = cssFont(f, 100); w = mctx.measureText(text).width / 100; mcache.set(key, w); }
        return w * size;
    }
    const fontsReady = (async () => {
        try {
            if (document.fonts && document.fonts.load) {
                await Promise.race([
                    Promise.all(['100px Carlito', 'bold 100px Carlito', 'italic 100px Carlito', 'italic bold 100px Carlito'].map(f => document.fonts.load(f))),
                    new Promise(r => setTimeout(r, 4000))
                ]);
            }
        } catch (e) { }
        mcache.clear();
    })();

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const safe = s => String(s).trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'chart';
    const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
    const fmtLabel = () => ({ png: 'PNG', jpg: 'JPEG', tif: 'TIFF', svg: 'SVG', pdf: 'PDF' }[S.fmt]);
    const isVector = () => S.fmt === 'svg' || S.fmt === 'pdf';
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    /* ----- Settings UI ----- */
    // What "Resize with chart" does, worked out on the first chart (or a typical one).
    function textHint() {
        if (S.text === 'keep') return 'Text keeps its Excel size.';
        const ch = supported()[0];
        const w0 = ch ? ch.sizeEmu.cx / 36000 : 152.4, h0 = ch ? ch.sizeEmu.cy / 36000 : 95.3;
        const h = S.keep ? h0 * S.width / w0 : S.height;
        const k = Math.min(S.width / w0, h / h0);
        if (Math.abs(k - 1) < 0.02) return 'Text changes size with the chart.';
        return `Text ${k < 1 ? 'shrinks' : 'grows'} with the chart: 10 pt becomes ${f1(10 * k)} pt.`;
    }
    function syncControls() {
        $$('.seg[data-key]').forEach(seg => {
            const key = seg.dataset.key;
            seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === String(S[key]))));
        });
        $('width').value = S.width; $('height').value = S.height; $('dpi').value = S.dpi;
        $('size-fields').classList.toggle('hidden', S.mode !== 'width');
        $('height-box').classList.toggle('hidden', S.keep);
        $$('.opt-chip[data-w]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.w === +S.width)));
        $$('.opt-chip[data-dpi]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.dpi === +S.dpi)));
        const vector = isVector();
        $('res-fields').classList.toggle('is-off', vector);
        $('res-vector').classList.toggle('is-off', !vector);
        $('res-vector-text').textContent = `Not needed for ${fmtLabel()}`;
        const clearBtn = document.querySelector('.seg[data-key="bg"] button[data-val="transparent"]');
        clearBtn.disabled = S.fmt === 'jpg';
        $('bg-hint').textContent = S.fmt === 'jpg' ? "JPEG can't be transparent." : '';
        $('fmt-hint').textContent = {
            png: 'Sharp and lossless. Best for Word and PowerPoint.',
            jpg: 'Smaller files, a bit softer.',
            tif: 'Lossless, with the DPI saved inside. For journals that ask for TIFF.',
            svg: 'Vector, for the web or for editing in Inkscape or Illustrator.',
            pdf: 'Vector with the fonts embedded. Best for LaTeX and journals.'
        }[S.fmt];
        $('text-hint').textContent = textHint();
        // The collapsed header still says what you'll get.
        const parts = [S.mode === 'width' ? `${f1(S.width)} mm wide` : 'Excel size', fmtLabel()];
        if (!vector) parts.push(`${S.dpi} DPI`);
        if (S.bg === 'transparent' && S.fmt !== 'jpg') parts.push('Transparent');
        $('settings-summary').innerHTML = parts.map(p => `<span>${esc(p)}</span>`).join('');
        const n = shown().length;
        $('btn-save-all').innerHTML = `<i class="fa-solid fa-file-zipper"></i> Save ${n > 1 ? `all ${n}` : 'all'} as ZIP`;
        $('btn-save-all').disabled = busy || !n;
    }
    function setS(patch) { Object.assign(S, patch); persist(); syncControls(); schedule(); }

    function wireSettings() {
        $$('.seg[data-key]').forEach(seg => seg.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-val]');
            if (!b || b.disabled) return;
            const key = seg.dataset.key;
            const patch = { [key]: key === 'keep' ? b.dataset.val === 'true' : b.dataset.val };
            if (patch.fmt === 'jpg' && S.bg === 'transparent') patch.bg = 'white';
            setS(patch);
        }));
        const numIn = (id, key, lo, hi) => {
            const el = $(id);
            el.addEventListener('input', () => {
                const v = parseFloat(String(el.value).replace(',', '.'));
                if (isFinite(v) && v >= lo && v <= hi) {
                    S[key] = v; persist(); schedule();
                    $$('.opt-chip[data-w]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.w === +S.width)));
                    $$('.opt-chip[data-dpi]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.dpi === +S.dpi)));
                    $('text-hint').textContent = textHint();
                }
            });
            el.addEventListener('change', () => {
                let v = parseFloat(String(el.value).replace(',', '.'));
                if (!isFinite(v)) v = DEF[key];
                v = Math.min(hi, Math.max(lo, v));
                if (key === 'dpi') v = Math.round(v);
                setS({ [key]: v });
            });
        };
        numIn('width', 'width', 10, 2000); numIn('height', 'height', 10, 2000); numIn('dpi', 'dpi', 50, 2400);
        $$('.opt-chip[data-w]').forEach(b => b.addEventListener('click', () => setS({ width: +b.dataset.w })));
        $$('.opt-chip[data-dpi]').forEach(b => b.addEventListener('click', () => setS({ dpi: +b.dataset.dpi })));
        $('btn-reset').addEventListener('click', () => {
            setS(Object.assign({}, DEF));
            showNotification('info', 'Settings reset', 'Back to the defaults.');
        });
    }

    /* ----- Sizes and rendering ----- */
    function outSize(ch) {
        const w0 = ch.sizeEmu.cx / 36000, h0 = ch.sizeEmu.cy / 36000;
        let w = w0, h = h0;
        if (S.mode === 'width') { w = S.width; h = S.keep ? h0 * w / w0 : S.height; }
        const k = S.mode === 'width' && S.text === 'scale' ? Math.min(w / w0, h / h0) : 1;
        return { w, h, k };
    }
    function draw(ch, sz, transparent) {
        NUMLOC.decimal = S.dec === 'comma' ? ',' : '.';
        NUMLOC.group = S.dec === 'comma' ? ' ' : ',';
        const W = sz.w / 25.4 * 72, H = sz.h / 25.4 * 72;
        return { items: renderChart(ch.model, W, H, { measure, k: sz.k, transparent }), W, H };
    }
    const pxOf = sz => [Math.max(1, Math.round(sz.w / 25.4 * S.dpi)), Math.max(1, Math.round(sz.h / 25.4 * S.dpi))];
    const supported = () => WB ? WB.charts.filter(c => c.model && !c.error) : [];
    const shown = () => supported().filter(c => !sheet || c.sheet === sheet);
    const clearBg = () => S.bg === 'transparent' && S.fmt !== 'jpg';
    function titleOf(ch) {
        const m = ch.model;
        if (m && m.title && m.title.lines && m.title.lines.length) { const t = m.title.lines.map(l => l.map(r => r.text).join('')).join(' ').trim(); if (t) return t; }
        if (m && !m.ex) { const all = m.groups.reduce((a, g) => a.concat(g.series), []); if (all.length === 1 && !m.autoTitleDeleted && all[0].name) return all[0].name; }
        return ch.name;
    }
    function previewSVG(ch) {
        const sz = outSize(ch);
        try { const r = draw(ch, sz, clearBg()); return toSVG(r.items, r.W, r.H, `role="img" aria-label="${esc('Preview of ' + titleOf(ch))}"`); }
        catch (e) { console.error(e); return '<div class="fg-na" style="padding:16px"><i class="fa-solid fa-triangle-exclamation"></i><span>This chart couldn\'t be drawn.</span></div>'; }
    }
    const pxText = sz => { const [px, py] = pxOf(sz); return isVector() ? 'Vector, any size' : `${px} × ${py} px at ${S.dpi} DPI`; };

    /* ----- Chart cards ----- */
    const dimHTML = cls => `<div class="fg-dim ${cls}" aria-hidden="true"><span class="ext"></span><span class="ln"></span><span class="v"></span></div>`;
    function buildCards() {
        const grid = $('chart-grid');
        grid.innerHTML = ''; cards.clear();
        WB.charts.forEach(ch => {
            const el = document.createElement('article');
            el.className = 'fg-card';
            el.dataset.sheet = ch.sheet;
            const where = `${esc(ch.sheet)} · ${esc(ch.name)}`;
            if (!ch.model || ch.error) {
                el.classList.add('is-unsupported');
                const msg = ch.error === 'unsupported'
                    ? `${esc(ch.typeLabel || 'This')} charts aren't supported yet. In Excel, right-click it and use <strong>Save as Picture</strong>.`
                    : "This chart couldn't be read.";
                el.innerHTML = `<div class="fg-stage"><div class="fg-na"><i class="fa-solid fa-circle-exclamation"></i><span>${msg}</span></div></div>
                    <div class="fg-body"><div class="fg-title">${esc(ch.name)}</div><div class="fg-meta"><span>${where}</span></div></div>`;
                grid.appendChild(el);
                return;
            }
            const kind = chartKind(ch.model);
            el.innerHTML = `
                <div class="fg-stage"><div class="fg-dwg">${dimHTML('fg-dim-w')}<button type="button" class="fg-frame" title="Enlarge" aria-label="Enlarge ${esc(titleOf(ch))}"></button>${dimHTML('fg-dim-h')}</div></div>
                <div class="fg-body">
                    <div class="fg-title">${esc(titleOf(ch))}</div>
                    <div class="fg-meta">${kind ? `<span class="fg-badge">${esc(kind)}</span>` : ''}<span>${where}</span></div>
                    <div class="fg-px"></div>
                    ${ch.model.is3D ? '<div class="fg-note">3D is drawn flat.</div>' : ''}
                </div>
                <div class="fg-actions">
                    <button type="button" class="btn-blue btn-sm fg-save"></button>
                    <button type="button" class="btn-grey btn-sm icon-only-btn fg-zoom" title="Enlarge" aria-label="Enlarge"><i class="fa-solid fa-expand"></i></button>
                </div>`;
            el.querySelector('.fg-save').addEventListener('click', () => saveOne(ch));
            el.querySelector('.fg-frame').addEventListener('click', () => openPreview(ch));
            el.querySelector('.fg-zoom').addEventListener('click', () => openPreview(ch));
            grid.appendChild(el);
            cards.set(ch, el);
        });
        applyFilter();
    }
    function updateCards() {
        for (const [ch, el] of cards) {
            const sz = outSize(ch);
            const fr = el.querySelector('.fg-frame');
            fr.innerHTML = previewSVG(ch);
            fr.classList.toggle('clear', clearBg());
            el.querySelector('.fg-dim-w .v').textContent = `${f1(sz.w)} mm`;
            el.querySelector('.fg-dim-h .v').textContent = `${f1(sz.h)} mm`;
            el.querySelector('.fg-px').textContent = pxText(sz);
            el.querySelector('.fg-save').innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Save ${fmtLabel()}`;
        }
        if (previewAt >= 0) renderPreview();
        warmFonts();
    }
    let timer = 0;
    function schedule() { clearTimeout(timer); if (WB) timer = setTimeout(updateCards, 120); }

    function applyFilter() {
        for (const el of $$('.fg-card', $('chart-grid'))) el.classList.toggle('hidden', !!sheet && el.dataset.sheet !== sheet);
    }
    function fillSheetFilter() {
        const sel = $('sheet-filter');
        const sheets = [...new Set(WB.charts.map(c => c.sheet))];
        sel.classList.toggle('hidden', sheets.length < 2);
        sel.innerHTML = `<option value="">All sheets (${WB.charts.length})</option>` +
            sheets.map(s => `<option value="${esc(s)}">${esc(s)} (${WB.charts.filter(c => c.sheet === s).length})</option>`).join('');
        sheet = ''; sel.value = '';
    }

    /* ----- Preview dialog ----- */
    function openPreview(ch) {
        previewAt = shown().indexOf(ch);
        if (previewAt < 0) return;
        renderPreview();
        const dlg = $('preview-dialog');
        if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    }
    function renderPreview() {
        const list = shown(), ch = list[previewAt];
        if (!ch) return closePreview();
        const sz = outSize(ch);
        $('preview-title').textContent = titleOf(ch);
        $('preview-sub').textContent = `${chartKind(ch.model)} · ${ch.sheet} · ${f1(sz.w)} × ${f1(sz.h)} mm`;
        const fr = $('preview-frame');
        fr.innerHTML = previewSVG(ch);
        fr.classList.toggle('clear', clearBg());
        $('preview-px').textContent = `${previewAt + 1} of ${list.length} · ${pxText(sz)}`;
        $('preview-save').innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Save ${fmtLabel()}`;
        $('preview-prev').disabled = previewAt <= 0;
        $('preview-next').disabled = previewAt >= list.length - 1;
    }
    function closePreview() {
        previewAt = -1;
        const dlg = $('preview-dialog');
        if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
    }
    function wirePreview() {
        const dlg = $('preview-dialog');
        const step = d => { const n = previewAt + d; if (n >= 0 && n < shown().length) { previewAt = n; renderPreview(); } };
        $('preview-close').addEventListener('click', closePreview);
        $('preview-prev').addEventListener('click', () => step(-1));
        $('preview-next').addEventListener('click', () => step(1));
        $('preview-save').addEventListener('click', () => { const ch = shown()[previewAt]; if (ch) saveOne(ch); });
        dlg.addEventListener('close', () => { previewAt = -1; });
        // Clicking outside the box closes it.
        dlg.addEventListener('click', (e) => {
            if (e.target !== dlg) return;
            const r = dlg.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePreview();
        });
        dlg.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        });
        // Swipe left or right on a phone.
        let x0 = null;
        dlg.addEventListener('touchstart', e => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
        dlg.addEventListener('touchend', e => {
            if (x0 == null) return;
            const dx = e.changedTouches[0].clientX - x0; x0 = null;
            if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
        });
    }

    /* ----- PDF fonts: downloaded the first time a PDF needs them, then kept ----- */
    class NoFonts extends Error { }
    const ttf = new Map();
    function loadFace(fc) {
        let p = ttf.get(fc.key);
        if (!p) {
            p = fetch(fc.url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(parseTTF);
            p.catch(() => ttf.delete(fc.key));
            ttf.set(fc.key, p);
        }
        return p;
    }
    async function pdfFonts(items) {
        try { return new Map(await Promise.all(pdfFaces(items).map(async fc => [fc.key, await loadFace(fc)]))); }
        catch (e) { throw new NoFonts(); }
    }
    // With PDF picked and a file open, fetch the fonts its charts use right
    // away, so the first Save doesn't wait on the download.
    const warmed = new WeakSet();
    function warmFonts() {
        if (S.fmt !== 'pdf' || !WB) return;
        for (const ch of supported()) {
            if (warmed.has(ch)) continue;
            warmed.add(ch);
            try { for (const fc of pdfFaces(draw(ch, outSize(ch), false).items)) loadFace(fc).catch(() => { }); }
            catch (e) { }
        }
    }

    /* ----- Files ----- */
    class TooBig extends Error { }
    async function makeFile(ch) {
        const sz = outSize(ch);
        const base = `${safe(ch.sheet)}_${safe(ch.name)}`;
        const clear = S.bg === 'transparent';
        if (S.fmt === 'svg') {
            const r = draw(ch, sz, clear);
            const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + toSVG(r.items, r.W, r.H, `width="${r2(sz.w)}mm" height="${r2(sz.h)}mm"`);
            return { name: base + '.svg', blob: new Blob([text], { type: 'image/svg+xml' }) };
        }
        if (S.fmt === 'pdf') {
            const r = draw(ch, sz, clear);
            const bytes = await toPDF(r.items, r.W, r.H, { fonts: await pdfFonts(r.items), title: titleOf(ch) });
            return { name: base + '.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) };
        }
        const [px, py] = pxOf(sz);
        if (px > 32767 || py > 32767 || px * py > 268e6 || (IOS && px * py > 16777216)) throw new TooBig();
        const tif = S.fmt === 'tif';
        const r = draw(ch, sz, S.fmt !== 'jpg' && clear);
        const cv = document.createElement('canvas'); cv.width = px; cv.height = py;
        const ctx = cv.getContext('2d', tif ? { willReadFrequently: true } : undefined);
        if (!ctx) throw new TooBig();
        // An opaque TIFF drops the alpha channel, so it needs the white underneath too.
        if (S.fmt === 'jpg' || (tif && !clear)) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, py); }
        toCanvas(ctx, r.items, px / r.W);
        if (tif) {
            const bytes = encodeTIFF(px, py, S.dpi, clear, (y, n) => ctx.getImageData(0, y, px, n).data);
            cv.width = 0; cv.height = 0;
            return { name: `${base}_${S.dpi}dpi.tif`, blob: new Blob([bytes], { type: 'image/tiff' }) };
        }
        const type = S.fmt === 'jpg' ? 'image/jpeg' : 'image/png';
        const blob = await new Promise(res => cv.toBlob(res, type, 0.95));
        cv.width = 0; cv.height = 0;
        if (!blob) throw new TooBig();
        const buf = await blob.arrayBuffer();
        // The DPI goes into the file, so Word and LaTeX place it at the right size.
        const bytes = S.fmt === 'jpg' ? jpegSetDpi(buf, S.dpi) : pngSetDpi(buf, S.dpi);
        return { name: `${base}_${S.dpi}dpi.${S.fmt}`, blob: new Blob([bytes], { type }) };
    }
    const TOO_BIG = 'Too big for this browser. Try a lower DPI or a smaller width.';
    const NO_FONTS = "The fonts for the PDF couldn't be downloaded. Check your connection and try again.";
    function deliver(name, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    function setBusy(b) {
        busy = b;
        $$('.fg-save, #btn-save-all, #btn-replace, #preview-save').forEach(x => { x.disabled = b; });
        $('file-drop').classList.toggle('is-busy', b);
    }
    function progress(f) {
        $('progress-bar').classList.toggle('active', f != null);
        $('progress').style.width = f == null ? '0%' : `${Math.round(f * 100)}%`;
    }
    async function saveOne(ch) {
        if (busy) return;
        setBusy(true);
        try {
            const f = await makeFile(ch);
            deliver(f.name, f.blob);
            remember();
            showNotification('success', 'Saved', f.name, 3000);
        } catch (e) {
            if (!(e instanceof TooBig || e instanceof NoFonts)) console.error(e);
            showNotification('error', 'Not saved', e instanceof TooBig ? TOO_BIG : e instanceof NoFonts ? NO_FONTS : "The file couldn't be made.");
        } finally { setBusy(false); syncControls(); }
    }
    async function saveAll() {
        const list = shown();
        if (!list.length || busy) return;
        if (typeof JSZip === 'undefined') { showNotification('error', 'ZIP not available', 'Save the charts one by one, or reload the page.'); return; }
        setBusy(true); progress(0);
        const zip = new JSZip(), used = new Set(); let skipped = 0;
        try {
            for (let i = 0; i < list.length; i++) {
                progress(i / (list.length + 1));
                await new Promise(r => setTimeout(r, 0));
                try {
                    const f = await makeFile(list[i]);
                    let name = f.name, n = 2;
                    while (used.has(name)) name = f.name.replace(/(\.\w+)$/, `_${n++}$1`);
                    used.add(name);
                    zip.file(name, f.blob, { compression: S.fmt === 'svg' ? 'DEFLATE' : 'STORE' });
                } catch (e) {
                    // Without the fonts no PDF can be made, so stop here.
                    if (e instanceof NoFonts) throw e;
                    if (!(e instanceof TooBig)) console.error(e);
                    skipped++;
                }
            }
            if (!used.size) { showNotification('error', 'Nothing saved', TOO_BIG); return; }
            const blob = await zip.generateAsync({ type: 'blob' }, m => progress((list.length + m.percent / 100) / (list.length + 1)));
            const name = `${safe(FILE_BASE)}${sheet ? '_' + safe(sheet) : ''}_charts.zip`;
            deliver(name, blob);
            remember();
            if (skipped) showNotification('warning', `${plural(used.size, 'chart')} saved`, `${skipped} left out for being too big. Lower the DPI to include ${skipped > 1 ? 'them' : 'it'}.`);
            else showNotification('success', `${plural(used.size, 'chart')} saved`, name, 4000);
        } catch (e) {
            if (e instanceof NoFonts) showNotification('error', 'Not saved', NO_FONTS);
            else showNotification('error', "ZIP didn't work", 'Try saving the charts one by one.');
        } finally { setBusy(false); progress(null); syncControls(); }
    }

    /* ----- Steps: Next only works once there is something to go on to ----- */
    const ready = () => !!WB && supported().length > 0;
    function syncSteps() {
        const ok = ready();
        $$('.fg-next').forEach(b => { b.disabled = !ok; });
        $$('.fg-next-hint').forEach(h => {
            h.classList.toggle('hidden', ok);
            h.textContent = WB && !ok ? 'No charts to export in this file.' : 'Open a file first.';
        });
        $('mod-charts').classList.toggle('is-locked', !ok);
        if (!ok) $('mod-charts').classList.remove('active');
    }
    // A click on a locked step points back at the drop zone.
    function nudge() {
        const mod = $('mod-file'), drop = $('file-drop');
        mod.classList.add('active');
        mod.scrollIntoView({ behavior: 'smooth', block: 'start' });
        drop.classList.remove('is-nudged');
        void drop.offsetWidth;
        drop.classList.add('is-nudged');
    }

    /* ----- Opening a file ----- */
    function setChip(id, text) { const el = $(id); el.lastElementChild.textContent = text; }
    async function openFile(file) {
        if (!file || busy) return;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (ext === 'xls') { showNotification('warning', 'Old Excel file', 'Save it as .xlsx in Excel, then open it here.'); return; }
        if (ext === 'xlsb') { showNotification('warning', "Can't read .xlsb", 'Save it as .xlsx in Excel, then open it here.'); return; }
        if (typeof JSZip === 'undefined') { showNotification('error', 'Not ready yet', 'Check your connection and reload the page.'); return; }
        setBusy(true); progress(0.3);
        let wb;
        try {
            await fontsReady;
            wb = await loadWorkbook(await file.arrayBuffer(), JSZip);
        } catch (e) {
            console.error(e);
            setBusy(false); progress(null);
            showNotification('error', "Couldn't open it", "This doesn't look like an Excel file. If it has a password, remove it first.");
            return;
        }
        WB = wb;
        setBusy(false); progress(null);
        FILE_BASE = file.name.replace(/\.[^.]+$/, '');
        const n = WB.charts.length, ok = supported().length;
        const meta = n === 0 ? 'No charts in this file' : (n === ok ? plural(n, 'chart') : `${plural(n, 'chart')}, ${ok} can be exported`);
        $('file-name').textContent = file.name;
        $('file-meta').textContent = meta;
        $('file-card').classList.remove('hidden');
        $('file-drop').classList.add('hidden');
        setChip('chip-file', file.name);
        setChip('chip-charts', plural(n, 'chart'));
        $('charts-empty').classList.toggle('hidden', n > 0);
        $('charts-panel').classList.toggle('hidden', n === 0);
        fillSheetFilter();
        buildCards(); syncControls(); updateCards();
        syncSteps();
        trackButtonRows($('chart-actions'));
        if (n === 0) {
            showNotification('warning', 'No charts found', 'Charts need to be on a sheet or on their own chart sheet.');
            return;
        }
        // Returning visitors already have their settings, so they go straight to
        // the charts. First-timers see the settings once on the way.
        $('mod-file').classList.remove('active');
        $('mod-charts').classList.add('active');
        const target = returning ? $('mod-charts') : $('mod-settings');
        if (!returning) $('mod-settings').classList.add('active');
        else $('mod-settings').classList.remove('active');
        // Wait for the fold animation, or the scroll lands short.
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    }
    function closeFile() {
        if (busy) return;
        WB = null; cards.clear(); closePreview();
        $('chart-grid').innerHTML = '';
        $('file-card').classList.add('hidden');
        $('file-drop').classList.remove('hidden');
        $('charts-panel').classList.add('hidden');
        $('charts-empty').classList.remove('hidden');
        setChip('chip-file', 'No file');
        setChip('chip-charts', '0 charts');
        $('mod-file').classList.add('active');
        syncControls(); syncSteps();
    }

    /* ----- Page wiring ----- */
    function wireModules() {
        $$('.module .module-header').forEach(h => h.addEventListener('click', () => {
            const mod = h.closest('.module');
            if (mod.classList.contains('is-locked')) return nudge();
            mod.classList.toggle('active');
        }));
        $$('.fg-next').forEach(btn => btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const cur = btn.closest('.module'), next = $(btn.dataset.next);
            if (!next) return;
            if (cur.id === 'mod-settings') persist();
            cur.classList.remove('active');
            next.classList.add('active');
            setTimeout(() => next.scrollIntoView({ behavior: 'smooth', block: 'start' }), 380);
        }));
    }
    function wireFiles() {
        const input = $('file-input'), drop = $('file-drop');
        const pick = () => { if (!busy) input.click(); };
        drop.addEventListener('click', pick);
        drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        $('file-replace').addEventListener('click', pick);
        $('btn-replace').addEventListener('click', pick);
        $('file-remove').addEventListener('click', closeFile);
        $('btn-save-all').addEventListener('click', saveAll);
        input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; openFile(f); });
        $('sheet-filter').addEventListener('change', e => { sheet = e.target.value; applyFilter(); syncControls(); });

        // Drag a file anywhere onto the page.
        let depth = 0;
        const overlay = $('drop-overlay');
        const show = on => { overlay.classList.toggle('visible', on); drop.classList.toggle('is-over', on); };
        const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; show(true); });
        window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
        window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
        window.addEventListener('drop', e => {
            if (!hasFiles(e)) return;
            e.preventDefault(); depth = 0; show(false);
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) openFile(f);
        });
    }
    function renderTypes() {
        $('type-list').innerHTML = TYPES.map(t => `<span class="fg-type">${esc(t)}</span>`).join('');
    }

    function init() {
        updateYear();
        setupThemeToggle();
        renderTypes();
        wireModules();
        wireSettings();
        wireFiles();
        wirePreview();
        syncControls();
        syncSteps();
        trackButtonRows($('chart-actions'));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
