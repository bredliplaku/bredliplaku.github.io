// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      4.1
// @description  Automatically enhance EIS, log in with Google.
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer(alt).user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer(alt).user.js
// @match        https://eis.epoka.edu.al/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

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
    // Custom CSS Injection
    // ************************************************************************
    const style = document.createElement('style');
    style.textContent = `
    /* --- Google Sans Text (For Body Content) --- */
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

        /* --- Google Sans (For Headings) --- */
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

        /* Apply the new fonts */
        body, p, .btn, button, .dropdown-menu, .table > tbody > tr > td {
            font-family: 'Google Sans Text', sans-serif !important;
        }
        h1, h2, h3, h4, h5, h6, .page-title, .portlet-title .caption {
            font-family: 'Google Sans', sans-serif !important;
        }
        
        /* Ensure font overrides don't break icon encodings */
        .fa {
            font-family: 'FontAwesome' !important;
        }

        /* --------------------------------------------------------------------
           Small Rounded Corners & Shadows
           -------------------------------------------------------------------- */
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

        /* Custom Label Colours */
        .label-success { background-color: #E0F2F1 !important; color: #004D40 !important; }
        .label-warning { background-color: #FFF8E1 !important; color: #E65100 !important; }
        .label-danger { background-color: #FFEBEE !important; color: #B71C1C !important; }
        .label-info { background-color: #E3F2FD !important; color: #0D47A1 !important; }

        /* --------------------------------------------------------------------
           Header Fixes: Profile Reordering, Circular Photo & Vertical Centering
           -------------------------------------------------------------------- */
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

        /* --------------------------------------------------------------------
           Sidebar Fixes: Touch Friendly Padding & Larger Icons
           -------------------------------------------------------------------- */
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

        /* --------------------------------------------------------------------
           Restored Slim Buttons (No bulky padding or height overrides)
           -------------------------------------------------------------------- */
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

        /* --------------------------------------------------------------------
           Portlet Title Vertical Alignment Fix
           -------------------------------------------------------------------- */
        .portlet-title .caption {
            display: inline-flex !important;
            align-items: center !important;
            height: 100% !important;
        }
        
        .portlet-title .caption i {
            margin-top: 0 !important; 
            margin-right: 8px !important; 
        }

        /* --------------------------------------------------------------------
           RESTORED Dashboard Stats (Grid Boxes)
           -------------------------------------------------------------------- */
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

        /* Pin 'View More' to the absolute bottom of the card with proper padding */
        .dashboard-stat .more {
            position: absolute !important;
            bottom: 0 !important;
            left: 0 !important;
            width: 100% !important;
            box-sizing: border-box !important;
            border-radius: 0 0 var(--grid-radius) var(--grid-radius) !important; 
            padding: 6px 20px !important; /* Pushes text and arrow inwards from the edges */
        }
        
        /* Giant watermark icon tucked securely on the left with added margin */
        .dashboard-stat .visual {
            opacity: 0.15 !important; 
            position: absolute !important;
            left: 20px !important; /* Pushed inward to match text padding */
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
    // Force Font Awesome 4 Icons to be Solid (Excluding Buttons & Header)
    // ************************************************************************
    function solidifyIcons() {
        document.querySelectorAll('i.fa:not(.btn i.fa):not(.header .navbar-nav i.fa)').forEach(icon => {
            Array.from(icon.classList).forEach(cls => {
                if (cls.endsWith('-o')) {
                    icon.classList.remove(cls);
                    icon.classList.add(cls.slice(0, -2));
                }
            });
        });

        document.querySelectorAll('.header .navbar-nav i.fa-bell').forEach(icon => {
            icon.classList.remove('fa-bell');
            icon.classList.add('fa-bell-o');
        });
    }

    // ************************************************************************
    // Update Page Title
    // ************************************************************************
    function updatePageTitle() {
        document.title = document.title.replace(/\bEpoka\b/g, "EPOKA");
    }

    // ************************************************************************
    // Text Replacement: Change "Epoka" to "EPOKA"
    // ************************************************************************
    function replaceEpokaText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = node.textContent.replace(/\bEpoka\b/g, "EPOKA");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            node.childNodes.forEach(child => replaceEpokaText(child));
        }
    }

    function scanAndReplace() {
        updatePageTitle();
        replaceEpokaText(document.body);
        solidifyIcons();
    }
    scanAndReplace();

    // Observe changes for dynamic content loading (e.g. notifications, menus)
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        mutations.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    replaceEpokaText(node);
                });
                shouldProcess = true;
            }
        });
        if (shouldProcess) {
            solidifyIcons();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const headObserver = new MutationObserver(() => {
        updatePageTitle();
    });
    const titleElement = document.querySelector('head > title');
    if (titleElement) {
        headObserver.observe(titleElement, { childList: true });
    }

    // ************************************************************************
    // DOM Ready Behaviours (Collapsers)
    // ************************************************************************
    document.addEventListener('DOMContentLoaded', () => {
        if (window.location.pathname.startsWith('/lectcourses')) {
            const courses = document.querySelectorAll('.portlet.course');
            courses.forEach(course => {
                const caption = course.querySelector('.portlet-title .caption');

                if (caption && (caption.textContent.includes('CE 366') || caption.textContent.includes('CE 388'))) {
                    const toggleBtn = course.querySelector('.portlet-title .tools a.collapse');
                    const body = course.querySelector('.portlet-body');

                    if (toggleBtn && body) {
                        toggleBtn.classList.remove('collapse');
                        toggleBtn.classList.add('expand');
                        body.style.display = 'none';
                    }
                }
            });
        }
    });

    // ************************************************************************
    // Automatic Clicks on Login Buttons for EIS
    // ************************************************************************

    if (window.location.pathname === '/login') {
        // First, click the expand link to reveal the hidden login form.
        const expandInterval = setInterval(() => {
            // The expand link is inside ".tools a.expand"
            const expandLink = document.querySelector('.tools a.expand');
            if (expandLink) {
                expandLink.click();
                clearInterval(expandInterval);
            }
        }, 100);

        // Then wait for the green login button to be visible and click it.
        const loginInterval = setInterval(() => {
            const greenButton = document.querySelector('button.btn.green.pull-right');
            if (greenButton && greenButton.offsetParent !== null) { // ensures element is visible
                greenButton.click();
                // Optionally, click one more time after a slight delay to ensure submission.
                setTimeout(() => {
                    greenButton.click();
                }, 1200);
                clearInterval(loginInterval);
            }
        }, 100);
    }

    // Auto-click login button on /switchrole page
    if (window.location.pathname === '/switchrole') {
        const roleInterval = setInterval(() => {
            const loginButton = document.querySelector('button.btn.green.pull-right');
            if (loginButton) {
                loginButton.click();
                clearInterval(roleInterval);
            }
        }, 100);
    }
})();