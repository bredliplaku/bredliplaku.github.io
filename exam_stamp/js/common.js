/* ==========================================================================
   common.js — page chrome for /exam_stamp/.

   The same small set of helpers /timetable/ and /teaching/ each keep locally:
   theme toggle, row-aware button rounding, footer branding and the toast
   notifications. Deliberately duplicated rather than hoisted to a site-wide
   file, so this folder can be handed to a colleague on its own — its only
   outside dependency is /css/main.css.

   Plain (non-module) script: everything below is a window global. Loaded
   before this page's scripts.js.

   Reads window.TEACHING_CONFIG (from teaching/js/config.js) for branding and
   palette, but degrades to no-ops if it isn't present.
   ========================================================================== */


/* === THEME TOGGLE ========================================================
   Three states cycling auto → (light|dark) → auto, where the manual step is
   whichever is the *opposite* of the current system theme — so one click
   always visibly changes something. The pre-paint inline script in the
   page's <head> has already set data-theme; this only handles the toggle and
   keeps the icon, label and browser-chrome colour in sync.
   ======================================================================== */
function setupThemeToggle() {
    const KEY = 'theme-preference';
    const BTN = document.getElementById('theme-toggle');
    const icons = {
        auto: 'fa-solid fa-adjust',
        light: 'fa-regular fa-sun',
        dark: 'fa-regular fa-moon',
    };

    const getSaved = () => localStorage.getItem(KEY) || 'auto';

    const currentIsDark = () => {
        const forced = document.documentElement.getAttribute('data-theme');
        if (forced) return forced === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    // Keep the address-bar / status-bar colour in step with the page. Only
    // the unconditional <meta name="theme-color"> is touched; the
    // prefers-color-scheme-scoped ones stay as the auto-mode fallback.
    const updateThemeColorMeta = () => {
        const meta = document.querySelector('meta[name="theme-color"]:not([media])');
        if (meta) meta.setAttribute('content', currentIsDark() ? '#121212' : '#f4f4f4');
    };

    // The icon is replaced rather than reclassed: Font Awesome's SVG mode
    // swaps each <i> for an <svg>, so setting className on the original
    // element would have no effect once the kit has run.
    const updateUI = (pref) => {
        const old = document.getElementById('theme-toggle-icon');
        if (old) {
            const i = document.createElement('i');
            i.id = 'theme-toggle-icon';
            i.className = icons[pref] || icons.auto;
            i.setAttribute('aria-hidden', 'true');
            old.replaceWith(i);
        }
        if (BTN) {
            const label = pref.charAt(0).toUpperCase() + pref.slice(1);
            BTN.setAttribute('aria-label', `Theme: ${label}`);
            BTN.title = `Theme: ${label}`;
        }
        // The preview canvases are painted, not styled — they have to be told
        // to repaint when the theme changes underneath them.
        document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: currentIsDark() } }));
    };

    const applyTheme = (pref) => {
        const html = document.documentElement;
        if (pref === 'auto') html.removeAttribute('data-theme');
        else html.setAttribute('data-theme', pref);
        localStorage.setItem(KEY, pref);
        updateUI(pref);
        updateThemeColorMeta();
    };

    if (BTN) {
        BTN.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = getSaved();
            const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            applyTheme(current === 'auto' ? (isSystemDark ? 'light' : 'dark') : 'auto');
        });
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (getSaved() === 'auto') applyTheme('auto');
    });

    applyTheme(getSaved());
}


/* === ROW-AWARE BUTTON ROUNDING ===========================================
   A wrapped button group should look like one pill per visual row, not one
   pill overall — so the corner radii depend on where each button actually
   landed after wrapping, which only the layout knows. Buttons are bucketed
   by offsetTop (5px tolerance for sub-pixel rounding) and the first/last of
   each row get the outer edges.
   ======================================================================== */
function updateButtonRows(container) {
    const buttons = Array.from(container.children)
        .filter(b => b.tagName === 'BUTTON' && !b.classList.contains('hidden') && b.style.display !== 'none');
    if (!buttons.length) return;

    buttons.forEach(b => b.classList.remove(
        'first-in-row', 'last-in-row', 'only-in-row', 'grow-row', 'middle-in-row'));

    const rows = {};
    buttons.forEach(btn => {
        const top = btn.offsetTop;
        const key = Object.keys(rows).find(k => Math.abs(parseInt(k, 10) - top) < 5);
        if (key) rows[key].push(btn);
        else rows[top] = [btn];
    });

    Object.values(rows)
        .sort((a, b) => a[0].offsetTop - b[0].offsetTop)
        .forEach((rowButtons, index) => {
            if (rowButtons.length === 1) {
                // A lone button on the first row is a standalone pill; a lone
                // button on a later row is the tail of a wrap, so it keeps the
                // squared-off look of a group member.
                rowButtons[0].classList.add(index === 0 ? 'only-in-row' : 'middle-in-row');
            } else {
                rowButtons[0].classList.add('first-in-row');
                rowButtons[rowButtons.length - 1].classList.add('last-in-row');
            }
        });
}

// Keeps a container's row classes correct across re-renders and resizes.
// The observer is stored on the element so repeated calls don't stack up.
function trackButtonRows(container) {
    if (!container) return;
    updateButtonRows(container);
    if (!container._rowObserver) {
        container._rowObserver = new ResizeObserver(() => updateButtonRows(container));
        container._rowObserver.observe(container);
    }
}


/* === TOASTS ==============================================================
   Same markup and lifecycle as the teaching pages: at most two on screen,
   a new toast replaces any earlier one of its own type, and errors stay put
   until dismissed.
   ======================================================================== */
function showNotification(type, title, message, duration) {
    const area = document.getElementById('notification-area');
    if (!area) return;

    const safeRemove = (el) => { if (el && el.parentNode) el.parentNode.removeChild(el); };
    const dismiss = (el) => {
        el.classList.add('removing');
        setTimeout(() => safeRemove(el), 300);
    };

    area.querySelectorAll(`.in-page-notification-${type}`).forEach(dismiss);
    const existing = area.querySelectorAll('.in-page-notification');
    if (existing.length >= 2) dismiss(existing[0]);

    const icons = {
        success: 'check-circle', error: 'times-circle',
        warning: 'exclamation-circle', info: 'info-circle',
    };
    const notification = document.createElement('div');
    notification.className = `in-page-notification in-page-notification-${type}`;

    const icon = document.createElement('i');
    icon.className = `fa-solid fa-${icons[type] || icons.info}`;
    const body = document.createElement('div');
    body.className = 'notification-content';
    const strong = document.createElement('strong');
    strong.textContent = title;
    body.append(strong, document.createElement('br'), document.createTextNode(message || ''));
    const close = document.createElement('button');
    close.className = 'notification-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '&times;';
    close.onclick = () => dismiss(notification);

    notification.append(icon, body, close);
    area.appendChild(notification);

    if (type !== 'error') setTimeout(() => dismiss(notification), duration || 5000);
}


/* === FOOTER BRANDING ===================================================== */
function updateYear() {
    const el = document.getElementById('currentYear');
    if (el) el.textContent = new Date().getFullYear();
}

// Fills the footer links, owner name, copyright start year and favicon from
// config.js, so nothing personal is hard-coded into the markup.
function applyOwnerBranding() {
    const owner = (window.TEACHING_CONFIG && window.TEACHING_CONFIG.owner) || {};
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };

    if (owner.cvUrl) set('footer-cv', el => { el.href = owner.cvUrl; });
    if (owner.email) set('footer-email', el => { el.href = `mailto:${owner.email}`; });
    if (owner.name) set('footer-owner', el => { el.textContent = owner.name; });
    if (owner.startYear) set('footer-start-year', el => { el.textContent = owner.startYear; });
    if (owner.homeUrl) set('footer-home', el => { el.href = owner.homeUrl; });

    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon && owner.faviconUrl) favicon.href = owner.faviconUrl;

    updateYear();
}

// Applies the config.js palette as CSS custom properties on :root.
function applyThemeDefaults() {
    const t = (window.TEACHING_CONFIG && window.TEACHING_CONFIG.theme) || {};
    const root = document.documentElement.style;
    const map = {
        '--primary-color': t.primary,
        '--primary-dark': t.primaryDark,
        '--secondary-color': t.secondary,
        '--tertiary-color': t.tertiary,
        '--accent-color': t.accent,
        '--success-color': t.success,
    };
    Object.entries(map).forEach(([prop, val]) => { if (val) root.setProperty(prop, val); });
}
