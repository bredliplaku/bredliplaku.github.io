// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      1.1
// @description  Automatically enhance EIS, expand the login form, and auto-click the green login button on /login (after expansion). Also, auto-select the Google account when coming from EIS.
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @match        https://eis.epoka.edu.al/*
// @match        https://accounts.google.com/*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ************************************************************************
    // Font Awesome Stylesheet Injection
    // ************************************************************************
    const fontAwesomeURL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.1/css/all.min.css";
    if (!document.querySelector(`link[href="${fontAwesomeURL}"]`)) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = fontAwesomeURL;
        document.head.appendChild(faLink);
    }

    // ************************************************************************
    // Google Fonts: Roboto Injection
    // ************************************************************************
    const fontFamilyURL = "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap";
    if (!document.querySelector(`link[href="${fontFamilyURL}"]`)) {
        const fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href = fontFamilyURL;
        document.head.appendChild(fontLink);
    }

    // ************************************************************************
    // Custom CSS Injection
    // ************************************************************************
    const style = document.createElement('style');
    style.textContent = `
        :root {
            --primary-color: #00458c;
            --secondary-color: #fdb813;
            --background-color: #f4f4f4;
            --card-background: #ffffff;
            --text-color: #333333;
            --border-radius: 10px;
            --box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
            --font-family: 'Roboto', sans-serif;
        }

        /* Apply font family to body */
        body {
            font-family: var(--font-family) !important;
        }

        .table-scrollable, .table {
            border-radius: 15px !important;
        }

         .dashboard-stat, .page-breadcrumb, .table-scrollable, .table, .more {
            border-radius: 20px !important;
            box-shadow: var(--box-shadow) !important;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .btn, button, .toggler, .sidebar-toggler {
            border-radius: var(--border-radius) !important;
            transition: background-color 0.3s, transform 0.3s;
            margin-left: 0.5px;
            margin-right: 0.5px;
        }

        .btn:hover, button:hover, .toggler:hover, .sidebar-toggler:hover, .more:hover {
            transform: scale(1.03);
        }

        .btn-group .dropdown-menu {
            border-radius: 10px !important;
            box-shadow: var(--box-shadow) !important;
        }
    `;
    document.head.appendChild(style);

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
        replaceEpokaText(document.body);
    }
    scanAndReplace();

    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                replaceEpokaText(node);
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

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
                }, 300);
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
