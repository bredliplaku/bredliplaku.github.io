// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      1.0
// @description  Automatically enhance EIS.
// @author       Bredli Plaku
// @updateURL    https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @downloadURL  https://github.com/bredliplaku/bredliplaku.github.io/raw/refs/heads/main/projects/EIS_enhancer.user.js
// @match        https://eis.epoka.edu.al/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ************************************************************************
    // Font Awesome Stylesheet
    // ************************************************************************
    // The following uses Font Awesome version 6.7.2.
    // If some icons are missing (which might be due to Cloudflare hosting issues),
    // you may consider switching to an older version (e.g. 6.6.0).
    // To do so, simply change the URL to:
    // "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css"
    const fontAwesomeURL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.1/css/all.min.css";
    if (!document.querySelector(`link[href="${fontAwesomeURL}"]`)) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = fontAwesomeURL;
        document.head.appendChild(faLink);
    }

    const fontFamilyURL = "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap";
    if (!document.querySelector(`link[href="${fontFamilyURL}"]`)) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = fontFamilyURL;
        document.head.appendChild(faLink);
    }

    // ************************************************************************
    // Custom CSS for Selective Border Radii
    // ************************************************************************
    // This CSS applies a border-radius only to buttons, table elements and elements with the class "dashboard-stat".
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

        .table-scrollable, .table {
            border-radius: 15px !important;
        }

         .dashboard-stat, .page-breadcrumb, .table-scrollable, .table, .more {
            border-radius: 20px !important;
            box-shadow: var(--box-shadow); !important
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
            border-radius: 10px; !important
            box-shadow: var(--box-shadow); !important
        }

    `;
    document.head.appendChild(style);

    // ************************************************************************
    // Text Replacement: Updating "Epoka" to "EPOKA"
    // ************************************************************************
    // This function replaces whole-word occurrences of "Epoka" with "EPOKA" in text nodes.
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

    // Monitor for dynamic content changes.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                replaceEpokaText(node);
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // ************************************************************************
    // Automatic Clicks on Login Buttons
    // ************************************************************************

    // On the /login page: automatically click "Login with Epoka Mail" button.
    if (window.location.pathname === '/login') {
        const loginInterval = setInterval(() => {
            const loginLink = document.querySelector('a.btn.blue.btn-block[href="/connect/google"]');
            if (loginLink) {
                loginLink.click();
                clearInterval(loginInterval);
            }
        }, 100);
    }

    // On the /switchrole page: automatically click the login button.
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
