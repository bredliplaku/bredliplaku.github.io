// Shared website addressing and public API helpers. No sign-in session is used here.
(function () {
    'use strict';

    function normalizeWebsite(value, includeWww = true) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        let url;
        try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw); }
        catch { throw new Error('Enter a valid website address.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) {
            throw new Error('Use a website address without a port, query or fragment.');
        }
        const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
        if (hostname.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
            throw new Error('Enter a public domain or subdomain.');
        }
        const base_path = normalizePath(url.pathname).replace(/\/*$/, '/');
        if (base_path.length > 500 || !/^\/([A-Za-z0-9._~-]+\/)*$/.test(base_path)) {
            throw new Error('Use a directory path with letters, numbers, hyphens or underscores.');
        }
        return { hostname, base_path, include_www: !!includeWww };
    }

    function normalizePath(path) {
        if (/%2f|%5c|\\/i.test(path)) throw new Error('Encoded path separators are not supported.');
        const decoded = decodeURIComponent(path);
        // URL resolves dot segments; the registry stores case-sensitive directory paths.
        const url = new URL('https://path.invalid');
        url.pathname = decoded.replace(/\/+/g, '/');
        return url.pathname;
    }

    const websiteUrl = site => site?.hostname && site?.base_path ? `https://${site.hostname}${site.base_path}` : '';

    function adminUrl(site) {
        const url = new URL(site.base_path, location.origin);
        url.search = '?admin';
        return url.href;
    }

    function currentDirectory() {
        const path = normalizePath(location.pathname);
        if (path.endsWith('/')) return path;
        if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
        // Some hosts serve directory indexes without redirecting to a trailing slash.
        return path + '/';
    }

    async function rpc(name, params) {
        const config = window.TEACHING_CONFIG;
        const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
            method: 'POST', credentials: 'omit', cache: 'no-store',
            headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`,
                'Content-Type': 'application/json' },
            body: JSON.stringify(params), signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error('The teaching service is unavailable.');
        return response.json();
    }

    async function rows(site, archive, sheet = null) {
        const result = [];
        for (let offset = 0; ; offset += 1000) {
            const page = await rpc('teaching_site_rows', {
                p_site_id: site.id, p_archive: archive, p_sheet_name: sheet, p_offset: offset
            });
            if (!Array.isArray(page)) throw new Error('Invalid course response.');
            result.push(...page);
            if (page.length < 1000) return result;
        }
    }

    function routeCourse(site) {
        const path = normalizePath(location.pathname);
        const suffix = path === site.base_path.slice(0, -1) ? '' : path.slice(site.base_path.length);
        if (!suffix || suffix === 'index.html') return '';
        const parts = suffix.split('/').filter(Boolean);
        if (parts.length === 2 && parts[0] === 'course') parts.shift();
        // A malformed nested route must never silently open a different course.
        return parts.length === 1 ? decodeURIComponent(parts[0]) : '\u0000';
    }

    function loaderScript(fallback = false, lecturerId = '') {
        if (lecturerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lecturerId)) {
            throw new Error('Invalid lecturer ID. Reload Settings and try again.');
        }
        const src = new URL('embed.js', window.TEACHING_CONFIG.appBaseUrl).href
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<script defer src="${src}"${lecturerId ? ` data-teaching-lecturer="${lecturerId}"` : ''}${fallback ? ' data-teaching-fallback' : ''}></script>`;
    }

    function loaderHtml(lecturerId) {
        if (!lecturerId) throw new Error('Save the lecturer account before downloading its website file.');
        return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Courses</title>
  ${loaderScript(false, lecturerId)}
</head>
<body>
  <p role="status">Loading courses…</p>
  <noscript>Enable JavaScript to view courses.</noscript>
</body>
</html>
`;
    }

    window.TeachingSites = { normalizeWebsite, normalizePath, websiteUrl, adminUrl, currentDirectory, rpc, rows, routeCourse, loaderHtml, loaderScript };
})();
