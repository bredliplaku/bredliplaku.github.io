// Permanent entry point for lecturer websites. The same index, styles and scripts
// served by the central teaching application are mounted at the caller's URL.
(function () {
    'use strict';
    if (window.__teachingLoaderStarted) return;
    window.__teachingLoaderStarted = true;
    const entry = document.currentScript;
    const appBase = new URL('./', entry.src);
    const fallback = entry.hasAttribute('data-teaching-fallback');
    const lecturerId = entry.getAttribute('data-teaching-lecturer');
    let mounted = false;

    function loadScript(src, attributes = {}) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
            script.async = false;
            const timeout = setTimeout(() => {
                script.remove(); reject(new Error('A teaching resource took too long to load.'));
            }, 20000);
            script.onload = () => { clearTimeout(timeout); resolve(); };
            script.onerror = () => { clearTimeout(timeout); reject(new Error('A teaching resource could not load.')); };
            script.src = src;
            document.head.appendChild(script);
        });
    }

    function showError(message) {
        if (fallback && !mounted) return; // Leave unrelated 404 pages untouched.
        document.body.className = '';
        const main = document.createElement('main');
        main.style.cssText = 'max-width:40rem;margin:12vh auto;padding:24px;font:16px/1.6 system-ui';
        const title = document.createElement('h1'); title.textContent = 'Courses unavailable';
        const detail = document.createElement('p'); detail.textContent = message;
        const retry = document.createElement('button'); retry.textContent = 'Try again';
        retry.onclick = () => location.reload();
        main.append(title, detail, retry);
        document.body.replaceChildren(main);
    }

    async function mount(site) {
        const response = await fetch(new URL('index.html', appBase), {
            credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error('The teaching page could not load.');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        const scripts = [...page.querySelectorAll('script[src]')].map(script => ({
            src: new URL(script.getAttribute('src'), appBase).href,
            crossorigin: script.getAttribute('crossorigin')
        })).filter(script => !['js/config.js', 'js/sites.js'].some(path => script.src === new URL(path, appBase).href));
        // Inline scripts in the central document normalise its own path/theme.
        // Do not run its redirect on a lecturer's nested URL.
        page.querySelectorAll('script, base').forEach(node => node.remove());
        page.querySelectorAll('link[href], img[src], source[src]').forEach(node => {
            const attr = node.hasAttribute('href') ? 'href' : 'src';
            node.setAttribute(attr, new URL(node.getAttribute(attr), appBase).href);
        });
        const theme = (() => { try { return localStorage.getItem('theme-preference'); } catch { return null; } })();
        if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
        document.documentElement.lang = page.documentElement.lang || 'en';

        const styles = [...page.querySelectorAll('link[rel="stylesheet"]')];
        const loadedStyles = styles.map(link => new Promise((resolve, reject) => {
            const required = new URL(link.href).origin === appBase.origin;
            const failed = () => required ? reject(new Error('The teaching styles could not load.')) : resolve();
            const timeout = setTimeout(failed, 20000);
            link.onload = () => { clearTimeout(timeout); resolve(); };
            link.onerror = () => { clearTimeout(timeout); failed(); };
        }));
        // This is a complete page, not a widget inside the personal site's layout.
        mounted = true;
        document.head.replaceChildren(...page.head.childNodes);
        await Promise.all(loadedStyles);
        document.body.className = page.body.className;
        document.body.replaceChildren(...page.body.childNodes);
        window.TEACHING_SITE = site;
        window.TEACHING_CONFIG.owner = {
            name: site.display_name, homeUrl: '/', email: '', cvUrl: '',
            faviconUrl: '/favicon.ico', startYear: new Date().getFullYear()
        };
        // Preserve dependency order. scripts.js starts immediately if DOMContentLoaded
        // has already fired, which is the normal case for this asynchronous loader.
        for (const script of scripts) {
            await loadScript(script.src, script.crossorigin ? { crossorigin: script.crossorigin } : {});
        }
    }

    async function start() {
        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }
        try {
            await loadScript(new URL('js/config.js', appBase).href);
            await loadScript(new URL('js/sites.js', appBase).href);
            let site;
            if (lecturerId) {
                if (!['https:', 'http:'].includes(location.protocol)) {
                    showError('Upload this file to a website to view its courses.'); return;
                }
                site = await window.TeachingSites.rpc('teaching_resolve_lecturer', { p_id: lecturerId });
                if (site) site.base_path = window.TeachingSites.currentDirectory();
            } else {
                // Older generic files and the optional 404 snippet use saved addresses.
                site = await window.TeachingSites.rpc('teaching_resolve_site', {
                    p_hostname: location.hostname, p_path: window.TeachingSites.normalizePath(location.pathname)
                });
            }
            if (!site) { showError('This lecturer’s courses are not available.'); return; }
            await mount(site);
        } catch (error) {
            console.error('Teaching loader:', error);
            showError('Please try again shortly.');
        }
    }
    start();
})();
