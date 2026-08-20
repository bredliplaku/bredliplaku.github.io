// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      5.4
// @description  Automatically enhance EIS and log in with your preferred method.
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @match        https://eis.epoka.edu.al/*
// @match        https://accounts.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ************************************************************************
    // Login Preferences (Tampermonkey Menu UI)
    // ************************************************************************

    const loginMethod = GM_getValue('eis_login_method', 'google');
    const targetEmail = GM_getValue('eis_google_email', '');

    GM_registerMenuCommand('🌐 Login with Google', () => {
        const currentEmail = GM_getValue('eis_google_email', '');
        const input = prompt('Enter the Google email address to auto-select:', currentEmail);

        if (input !== null) {
            GM_setValue('eis_google_email', input.trim().toLowerCase());
            GM_setValue('eis_login_method', 'google');

            if (window.location.hostname === 'eis.epoka.edu.al') {
                window.location.href = 'https://eis.epoka.edu.al/logout';
            }
        }
    });

    GM_registerMenuCommand('🔑 Login with username', () => {
        GM_setValue('eis_login_method', 'credentials');
        if (window.location.hostname === 'eis.epoka.edu.al') {
            window.location.href = 'https://eis.epoka.edu.al/logout';
        }
    });

    // ************************************************************************
    // Google Account Chooser Automation (accounts.google.com)
    // ************************************************************************
    if (window.location.hostname === 'accounts.google.com') {
        const savedEmail = targetEmail.trim().toLowerCase();
        if (!savedEmail) return;

        let hasSelected = false;

        const selectAccount = () => {
            if (hasSelected) return true;

            // 1. Check for standard identifier and email attributes
            const targetEl = document.querySelector(
                `[data-identifier="${savedEmail}"], [data-email="${savedEmail}"]`
            );

            if (targetEl) {
                const clickable = targetEl.closest('[role="link"], [role="button"], li, div[data-profile-identifier]') || targetEl;
                hasSelected = true;
                clickable.click();
                return true;
            }

            // 2. Fallback: Check inner text for the email string
            const elements = document.querySelectorAll('div, span, p');
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                if (el.children.length === 0 && el.textContent.trim().toLowerCase() === savedEmail) {
                    const clickable = el.closest('[role="link"], [role="button"], li') || el;
                    hasSelected = true;
                    clickable.click();
                    return true;
                }
            }

            return false;
        };

        const googleObserver = new MutationObserver((_, obs) => {
            if (selectAccount()) {
                obs.disconnect();
            }
        });

        googleObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // Safety timeout to avoid lingering observers
        setTimeout(() => googleObserver.disconnect(), 8000);
        return;
    }

    // ************************************************************************
    // Google Fonts: JetBrains Mono Injection (for labels)
    // ************************************************************************
    const jetbrainsMonoURL = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap";
    if (!document.querySelector(`link[href="${jetbrainsMonoURL}"]`)) {
        const fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href = jetbrainsMonoURL;
        document.head.appendChild(fontLink);
    }

    // ************************************************************************
    // Font Awesome 7.2.0 Injection
    // ************************************************************************
    const fontAwesomeURL = "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7/css/all.min.css";
    const faShimsURL = "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@7/css/v4-shims.min.css";

    if (!document.querySelector('link[href="' + fontAwesomeURL + '"]')) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = fontAwesomeURL;
        document.head.appendChild(faLink);
    }

    if (!document.querySelector('link[href="' + faShimsURL + '"]')) {
        const shimsLink = document.createElement("link");
        shimsLink.rel = "stylesheet";
        shimsLink.href = faShimsURL;
        document.head.appendChild(shimsLink);
    }

    // ************************************************************************
    // Custom CSS Injection
    // ************************************************************************
    const style = document.createElement('style');
    style.textContent = `
        @font-face {
            font-family: 'Google Sans Text';
            font-style: normal;
            font-weight: 400;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/googlesanstext/v24/5aUu9-KzpRiLCAt4Unrc-xIKmCU5qEp2i0VBuxM.woff2) format('woff2');
            unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
        @font-face {
            font-family: 'Google Sans Text';
            font-style: normal;
            font-weight: 500;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/googlesanstext/v24/5aUp9-KzpRiLCAt4Unrc-xIKmCU5oLlVnmhjtjm4DZw.woff2) format('woff2');
            unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
        @font-face {
            font-family: 'Google Sans';
            font-style: normal;
            font-weight: 400;
            font-display: block;
            src: url(https://fonts.gstatic.com/s/googlesans/v65/4UaRrENHsxJlGDuGo1OIlJfC6mGS6vhAK1YobMu2vgCIhM907w.woff2) format('woff2');
            unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }

        :root {
            --primary-color: #00458c;
            --secondary-color: #fdb813;
            --background-color: #f4f4f4;
            --card-background: #ffffff;
            --text-color: #333333;
            --box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
            --small-radius: 6px;
            --grid-radius: 12px;
        }

        body, p, .btn, button, .dropdown-menu, .table > tbody > tr > td {
            font-family: 'Google Sans Text', sans-serif !important;
        }
        h1, h2, h3, h4, h5, h6, .page-title, .portlet-title .caption {
            font-family: 'Google Sans', sans-serif !important;
        }

        .page-breadcrumb, .table-scrollable, .alert, .notifications-container, .dropdown-menu, .label {
            border-radius: var(--small-radius) !important;
            box-shadow: var(--box-shadow) !important;
        }

        .portlet.box {
            border-radius: var(--small-radius) !important;
            box-shadow: var(--box-shadow) !important;
        }
        .portlet.box > .portlet-title {
            border-radius: var(--small-radius) var(--small-radius) 0 0 !important;
        }
        .portlet.box > .portlet-body {
            border-radius: 0 0 var(--small-radius) var(--small-radius) !important;
        }

        .label {
            font-family: 'JetBrains Mono', monospace !important;
            padding: 4px 10px !important;
            text-shadow: none !important;
        }
        .label-success { background-color: #E0F2F1 !important; color: #004D40 !important; }
        .label-warning { background-color: #FFF8E1 !important; color: #E65100 !important; }
        .label-danger { background-color: #FFEBEE !important; color: #B71C1C !important; }
        .label-info { background-color: #E3F2FD !important; color: #0D47A1 !important; }

        .header .navbar-nav {
            display: flex !important;
            align-items: center !important;
            height: 46px !important;
            margin: 0 !important;
        }
        .header .navbar-nav > li {
            display: flex !important;
            align-items: center !important;
            height: 100% !important;
        }
        .header .navbar-nav > li > a {
            display: inline-flex !important;
            align-items: center !important;
            height: 100% !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
        }
        .header .navbar-nav > li.dropdown.user > .dropdown-toggle {
            background: transparent !important;
        }
        .header .navbar-nav > li.dropdown.user > .dropdown-toggle .username {
            order: 1;
            margin: 0 10px 0 0 !important;
            font-size: 14px !important;
        }
        .header .navbar-nav > li.dropdown.user > .dropdown-toggle img {
            order: 2;
            border-radius: 50% !important;
            height: 30px !important;
            width: 30px !important;
            object-fit: cover !important;
            float: none !important;
            margin: 0 !important;
        }
        .header .navbar-nav > li.dropdown.user > .dropdown-toggle i {
            order: 3;
            margin-left: 8px !important;
            margin-top: 0 !important;
        }
        .header .navbar-nav > li.notifications > a {
            position: relative !important;
        }
        .notification-badge {
            top: 6px !important;
            right: 2px !important;
        }

        .page-sidebar .page-sidebar-menu > li > a {
            padding: 15px 15px !important;
            display: flex !important;
            align-items: center !important;
        }
        .page-sidebar .page-sidebar-menu > li > a > i {
            font-size: 20px !important;
            margin-right: 12px !important;
        }
        .page-sidebar .page-sidebar-menu > li > a > .title {
            flex-grow: 1;
        }
        .page-sidebar .page-sidebar-menu > li > a > .arrow {
            margin-top: 0 !important;
        }
        .page-sidebar .page-sidebar-menu > li > ul.sub-menu > li > a {
            padding: 12px 15px 12px 30px !important;
            display: flex !important;
            align-items: center !important;
        }
        .page-sidebar .page-sidebar-menu > li > ul.sub-menu > li > a > i {
            font-size: 16px !important;
            margin-right: 10px !important;
        }

        .btn {
            border-radius: var(--small-radius) !important;
            box-shadow: var(--box-shadow) !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease !important;
        }
        .btn.green-stripe {
            border-left: 4px solid #35aa47 !important;
            box-shadow: var(--box-shadow) !important;
        }
        .btn-group > .btn:not(:first-child) {
            border-top-left-radius: 0 !important;
            border-bottom-left-radius: 0 !important;
        }
        .btn-group > .btn:has(+ .btn) {
            border-top-right-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
        }
        .btn:hover, .toggler:hover, .sidebar-toggler:hover, .more:hover {
            transform: translateY(-1px);
        }
        .btn-primary:hover, .btn.blue:hover { box-shadow: 0 4px 8px rgba(0, 69, 140, 0.25) !important; }
        .btn-success:hover, .btn.green:hover { box-shadow: 0 4px 8px rgba(76, 175, 80, 0.25) !important; }
        .btn.yellow:hover { box-shadow: 0 4px 8px rgba(253, 184, 19, 0.25) !important; }
        .btn.default:hover { box-shadow: 0 4px 8px rgba(150, 150, 150, 0.2) !important; }
        .btn.dropdown-toggle:hover {
            transform: none !important;
            box-shadow: var(--box-shadow) !important;
        }

        .portlet-title .caption {
            display: inline-flex !important;
            align-items: center !important;
            height: 100% !important;
        }
        .portlet-title .caption i {
            margin-top: 0 !important;
            margin-right: 8px !important;
        }

        .dashboard-stat {
            position: relative;
            overflow: hidden !important;
            min-height: 125px !important;
            padding-bottom: 28px !important;
            border-radius: var(--grid-radius) !important;
            box-shadow: var(--box-shadow) !important;
        }
        .dashboard-stat .details {
            position: relative;
            z-index: 2;
        }
        .dashboard-stat .details .number {
            font-size: 28px !important;
            line-height: 32px !important;
        }
        .dashboard-stat .more {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            width: 100% !important;
            box-sizing: border-box !important;
            border-radius: 0 0 var(--grid-radius) var(--grid-radius) !important;
            padding: 6px 20px !important;
        }
        .dashboard-stat .visual {
            opacity: 0.15 !important;
            position: absolute !important;
            left: 20px !important;
            right: auto !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            z-index: 1;
            padding: 0 !important;
        }
        .dashboard-stat .visual i {
            font-size: 85px !important;
            margin: 0 !important;
        }
    `;
    document.head.appendChild(style);

    // ************************************************************************
    // Force Font Awesome 7 Icons to be Solid
    // ************************************************************************
    function solidifyIcons() {
        document.querySelectorAll('i[class*="fa"]:not(.btn i):not(.header .navbar-nav i)').forEach(icon => {
            if (icon.classList.contains('far')) {
                icon.classList.remove('far');
                icon.classList.add('fas');
            }
            if (icon.classList.contains('fa-regular')) {
                icon.classList.remove('fa-regular');
                icon.classList.add('fa-solid');
            }
            Array.from(icon.classList).forEach(cls => {
                if (cls.endsWith('-o')) {
                    icon.classList.remove(cls);
                    icon.classList.add(cls.slice(0, -2));
                    icon.classList.add('fas');
                }
            });
        });

        document.querySelectorAll('.header .navbar-nav i.fa-bell, .header .navbar-nav i.fa-solid.fa-bell').forEach(icon => {
            icon.classList.remove('fas', 'fa-solid', 'fa-bell');
            icon.classList.add('fa-regular', 'fa-bell', 'fa-bell-o');
        });
    }

    // ************************************************************************
    // Update Page Title & Text
    // ************************************************************************
    function updatePageTitle() {
        // Look for form-header-title first, then fallback to page-title
        const headerElement = document.querySelector('h3.form-header-title') || document.querySelector('h3.page-title');

        // If the header isn't rendered yet, bail out completely
        // to prevent flashing the default title intermediate state.
        if (!headerElement) return;

        let extractedText = '';
        for (let i = 0; i < headerElement.childNodes.length; i++) {
            if (headerElement.childNodes[i].nodeType === Node.TEXT_NODE) {
                extractedText += headerElement.childNodes[i].textContent;
            }
        }

        extractedText = extractedText.trim().replace(/\s+/g, ' ');

        if (extractedText.length > 0) {
            let newTitle = extractedText.replace(/\bEpoka\b/gi, 'EPOKA');
            if (document.title !== newTitle) {
                document.title = newTitle;
            }
        }
    }

    function replaceEpokaText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = node.textContent.replace(/\bEpoka\b/g, "EPOKA");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            node.childNodes.forEach(child => replaceEpokaText(child));
        }
    }

    // Run body text replacement immediately
    if (document.body) {
        replaceEpokaText(document.body);
        solidifyIcons();
    }

    // Use a high-level observer on documentElement to catch headers as early as possible
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        replaceEpokaText(node);
                    }
                });
                shouldProcess = true;
            }
        });
        if (shouldProcess) {
            solidifyIcons();
            updatePageTitle(); // Tries to apply the dynamic title the exact millisecond the header drops
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // ************************************************************************
    // DOM Ready Behaviours (Theme Settings & Smart Cache Collapsers)
    // ************************************************************************
    document.addEventListener('DOMContentLoaded', () => {
        updatePageTitle();

        // 1. Force Sidebar Theme to 'Fixed'
        // Added a short timeout so the site's native JS is ready to catch the event
        setTimeout(() => {
            const sidebarOption = document.querySelector('.sidebar-option');
            if (sidebarOption && sidebarOption.value !== 'fixed') {
                sidebarOption.value = 'fixed';
                sidebarOption.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, 150);

        // 2. Course Collapsers
        if (window.location.pathname.startsWith('/lectcourses')) {
            const targetCourses = [
                'CE 366', 'CE 388', 'BAFAL 309', 'BAFAL 302', 'BAFAL 304', 'BUS 309',
                'BINF 304', 'BINF 302', 'BUS 302', 'BUS 304', 'ECO 309', 'ECO 302',
                'ECO 304', 'IML 302', 'IML 304', 'CEN 351', 'CEN 390', 'CEN 399',
                'ECE 351', 'ECE 390', 'ECE 399', 'CEN 348', 'ARCH 310', 'ARCH 409',
                'PIR 309', 'PIR 300', 'PIR 316', 'LAW 502'
            ];

            const courses = document.querySelectorAll('.portlet.course');
            courses.forEach(course => {
                const caption = course.querySelector('.portlet-title .caption');
                if (!caption) return;

                const captionText = caption.textContent.trim();
                // Create a unique key for local storage based on the course name
                const cacheKey = `eis_course_state_${captionText}`;

                const toggleBtn = course.querySelector('.portlet-title .tools a.collapse, .portlet-title .tools a.expand');
                const body = course.querySelector('.portlet-body');

                if (!toggleBtn || !body) return;

                // 1. Determine if it falls under the default auto-collapse list
                const isTargetCourse = targetCourses.some(code => captionText.includes(code));

                // 2. Read the user's manual preference from the cache
                const cachedState = localStorage.getItem(cacheKey);

                let shouldCollapse = false;
                if (cachedState === 'collapsed') {
                    shouldCollapse = true;
                } else if (cachedState === 'expanded') {
                    shouldCollapse = false;
                } else {
                    shouldCollapse = isTargetCourse; // Fallback to default if no cache exists
                }

                // 3. Apply the initial state
                if (shouldCollapse) {
                    toggleBtn.classList.remove('collapse');
                    toggleBtn.classList.add('expand');
                    body.style.display = 'none';
                } else {
                    toggleBtn.classList.remove('expand');
                    toggleBtn.classList.add('collapse');
                    body.style.display = '';
                }

                // 4. Listen for user clicks to save future preferences
                toggleBtn.addEventListener('click', () => {
                    // Small delay ensures we read the updated class after the site's own script fires
                    setTimeout(() => {
                        const isNowCollapsed = toggleBtn.classList.contains('expand');
                        localStorage.setItem(cacheKey, isNowCollapsed ? 'collapsed' : 'expanded');
                    }, 100);
                });
            });
        }
    });

    // ************************************************************************
    // Automatic Clicks on Login Buttons for EIS
    // ************************************************************************
    if (window.location.pathname === '/login') {
        if (loginMethod === 'google') {
            const loginInterval = setInterval(() => {
                const loginLink = document.querySelector('a.btn.blue.btn-block[href="/connect/google"]');
                if (loginLink) {
                    sessionStorage.setItem('eis_auto_login', 'true');
                    loginLink.click();
                    clearInterval(loginInterval);
                }
            }, 100);
        } else if (loginMethod === 'credentials') {
            const formObserver = new MutationObserver((_, obs) => {
                const expandLink = document.querySelector('.tools a.expand');
                if (expandLink) {
                    const portlet = expandLink.closest('.portlet');
                    if (portlet) {
                        const body = portlet.querySelector('.portlet-body');
                        if (body) {
                            body.style.setProperty('display', 'block', 'important');
                            expandLink.classList.remove('expand');
                            expandLink.classList.add('collapse');
                        }
                    }
                    obs.disconnect();
                }
            });

            formObserver.observe(document.documentElement, { childList: true, subtree: true });

            const loginInterval = setInterval(() => {
                const greenButton = document.querySelector('button.btn.green.pull-right');
                const usernameField = document.querySelector('input[name="username"], input[type="text"]');
                const passwordField = document.querySelector('input[name="password"], input[type="password"]');

                if (greenButton && greenButton.offsetParent !== null) {
                    const isUsernameFilled = usernameField && (usernameField.value.trim() !== '' || usernameField.matches(':-webkit-autofill'));
                    const isPasswordFilled = passwordField && (passwordField.value.trim() !== '' || passwordField.matches(':-webkit-autofill'));

                    if (isUsernameFilled && isPasswordFilled) {
                        sessionStorage.setItem('eis_auto_login', 'true');
                        greenButton.click();
                        clearInterval(loginInterval);
                    }
                }
            }, 100);
        }
    }

    // Auto-click login button on /switchrole page
    if (window.location.pathname === '/switchrole') {
        if (sessionStorage.getItem('eis_auto_login') === 'true') {
            const roleInterval = setInterval(() => {
                const loginButton = document.querySelector('button.btn.green.pull-right');
                if (loginButton) {
                    sessionStorage.removeItem('eis_auto_login');
                    loginButton.click();
                    clearInterval(roleInterval);
                }
            }, 100);
        }
    }
})();