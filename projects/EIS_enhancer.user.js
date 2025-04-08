// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      1.0
// @description  Automatically enhance EIS and auto-select the "@epoka.edu.al" Google account when coming from EIS.
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

    // Monitor for dynamically added nodes
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

    // Auto-click "Login with Epoka Mail" on /login page
    if (window.location.pathname === '/login') {
        const loginInterval = setInterval(() => {
            const loginLink = document.querySelector('a.btn.blue.btn-block[href="/connect/google"]');
            if (loginLink) {
                loginLink.click();
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

  // ************************************************************************
    // Auto-Select First Google Account When on accounts.google.com Coming from EIS
    // ************************************************************************
if (
  window.location.hostname.includes("accounts.google.com") &&
  document.referrer.includes("eis.epoka.edu.al")
) {
  const accountInterval = setInterval(() => {
    /*
     * Look for the first div that has both:
     *   - data-identifier (often used to store the account's email)
     *   - role="link" or role="option" (typical for clickable account items)
     *
     * Adjust this selector if Google changes the page markup.
     */
    const firstAccount = document.querySelector('div[data-identifier][role="link"], div[data-identifier][role="option"]');
    if (firstAccount) {
      firstAccount.click();
      clearInterval(accountInterval);
    }
  }, 100);
}

})();
