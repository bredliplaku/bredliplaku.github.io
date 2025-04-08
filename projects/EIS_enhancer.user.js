// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      1.0
// @description  Automatically enhance EIS.
// @author       Bredli Plaku
// @updateURL    https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/EIS_enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/bredliplaku/bredliplaku.github.io/refs/heads/main/attendance/EIS_enhancer.user.js
// @match        https://eis.epoka.edu.al/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Insert Font Awesome stylesheet if not already present.
    if (!document.querySelector('link[href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css"]')) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css";
        document.head.appendChild(faLink);
    }

    // Apply a global style to provide rounded corners for all elements.
    const style = document.createElement('style');
    style.textContent = `* { border-radius: 8px !important; }`;
    document.head.appendChild(style);

    // Function to recursively replace text nodes containing "Epoka" with "EPOKA".
    function replaceEpokaText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            // Only replace full-word occurrences
            node.textContent = node.textContent.replace(/\bEpoka\b/g, "EPOKA");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            node.childNodes.forEach(child => replaceEpokaText(child));
        }
    }

    // Run the replacement function on the initial page load.
    function scanAndReplace() {
        replaceEpokaText(document.body);
    }
    scanAndReplace();

    // Set up a MutationObserver to handle dynamically added content.
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                replaceEpokaText(node);
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Automatically click the "Login with Epoka Mail" button on the /login page.
    if (window.location.pathname === '/login') {
        const loginInterval = setInterval(() => {
            // Locate the login button; note that we use the href as a unique selector.
            const loginLink = document.querySelector('a.btn.blue.btn-block[href="/connect/google"]');
            if (loginLink) {
                loginLink.click();
                clearInterval(loginInterval);
            }
        }, 100);
    }

    // Automatically click the login button on the /switchrole page.
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
