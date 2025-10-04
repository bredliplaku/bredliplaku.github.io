// ==UserScript==
// @name         EIS Enhancer
// @namespace    https://bredliplaku.com/
// @version      2.0
// @description  Automatically enhance EIS and log in with Google Account.
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
    // Font Awesome Stylesheet Injection
    // ************************************************************************
    const fontAwesomeURL = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css";
    if (!document.querySelector(`link[href="${fontAwesomeURL}"]`)) {
        const faLink = document.createElement("link");
        faLink.rel = "stylesheet";
        faLink.href = fontAwesomeURL;
        document.head.appendChild(faLink);
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
    // Custom CSS Injection
    // ************************************************************************
    const style = document.createElement('style');
    style.textContent = `
    /* --- Google Sans Text (For Body Content) --- */
        /* Regular - 400 */
        @font-face {
            font-family: 'Google Sans Text';
            font-style: normal;
            font-weight: 400;
            font-display: swap;
            src: url(https://fonts.gstatic.com/s/googlesanstext/v24/5aUu9-KzpRiLCAt4Unrc-xIKmCU5qEp2i0VBuxM.woff2) format('woff2');
            unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
        }
        /* Medium - 500 */
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
            --border-radius: 10px;
            --box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        }

        /* Apply the new fonts */
        body, p, .btn, button, .dropdown-menu, .table > tbody > tr > td {
            font-family: 'Google Sans Text', sans-serif !important;
        }
        h1, h2, h3, h4, h5, h6, .page-title, .portlet-title .caption, .dashboard-stat .details .number {
            font-family: 'Google Sans', sans-serif !important;
        }


         .dashboard-stat, .page-breadcrumb, .table-scrollable, .table, .more, .alert, .notifications-container, .dropdown-menu {
            border-radius: 20px !important;
            box-shadow: var(--box-shadow) !important;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }


.portlet.box {
    box-shadow: var(--box-shadow) !important; /* Keep the shadow */
    border-radius: 20px !important; /* Keep the overall rounding */
}

.portlet.box > .portlet-title {
    border-radius: 19px 19px 0 0 !important;
}

.portlet.box > .portlet-body {
    position: static; /* This is often needed to help with dropdown positioning */
        border-radius: 0 0 19px 19px !important;
}


.page-content .row > div[class*="col-"]:has(> .dashboard-thumb) {
    width: 15% !important;
    padding: 10px !important; /* Ensures consistent spacing */
}

.dashboard-stat .details .number {
    font-size: 2em !important;
    font-weight: 500 !important;
    white-space: normal !important; /* Allows text to wrap */
    word-break: break-word !important; /* Breaks long words */
    line-height: 1.2 !important;
}

.dashboard-stat .details {
    margin-left: 60px !important; /* This is the key fix: creates a safe space on the right */
        margin-top: 5% !important; /* This is the key fix: creates a safe space on the right */

}

.dashboard-stat .visual {
    height: 100% !important;
}
.dashboard-stat .visual > .fa {
    font-size: 36px !important; /* A fixed size is better than a relative 'em' unit here */
    top: 50% !important;
}

        .label {
            font-family: 'JetBrains Mono', monospace !important;
            border-radius: 12px !important; /* Creates the rounded "pill" shape */
            padding: 4px 10px !important;
            text-shadow: none !important;

        }

        /* 2. New, less saturated color scheme for each label type */

        /* Success Label (Green) */
        .label-success {
            background-color: #E0F2F1 !important; /* Soft, light teal background */
            color: #004D40 !important;             /* Dark teal text for high contrast */
        }

        /* Warning Label (Yellow/Orange) */
        .label-warning {
            background-color: #FFF8E1 !important; /* Soft, light yellow background */
            color: #E65100 !important;             /* Dark orange text for high contrast */
        }

        /* Danger Label (Red) */
        .label-danger {
            background-color: #FFEBEE !important; /* Soft, light pink background */
            color: #B71C1C !important;             /* Dark red text for high contrast */
        }

        /* Info Label (Blue) */
        .label-info {
            background-color: #E3F2FD !important; /* Soft, light blue background */
            color: #0D47A1 !important;             /* Dark blue text for high contrast */
        }


.btn, button, .toggler, .sidebar-toggler, .more {
    border-radius: 20px !important;
    transition: transform 0.3s ease, box-shadow 0.3s ease !important;
    margin-right: 2px;
}

.btn-group > .btn.dropdown-toggle {
    border-radius: 12px !important;
}

.btn.green-stripe {
    border-left: none !important;
    box-shadow: inset 5px 0 0 0 #35aa47, var(--box-shadow) !important;
}

.btn:hover, button:hover, .toggler:hover, .sidebar-toggler:hover, .more:hover {
    transform: scale(1.03); /* Reduced the pop effect slightly */
}

.btn-primary:hover, .btn.blue:hover {
    box-shadow: 0 0 12px 2px rgba(0, 69, 140, 0.45) !important;
}
.btn-success:hover, .btn.green:hover {
    box-shadow: 0 0 12px 2px rgba(76, 175, 80, 0.5) !important;
}
.btn.yellow:hover {
    box-shadow: 0 0 12px 2px rgba(253, 184, 19, 0.5) !important;
}
.btn.default:hover {
    box-shadow: 0 0 12px 2px rgba(150, 150, 150, 0.35) !important;
}

.btn.dropdown-toggle:hover {
    transform: none !important; /* Disables the pop effect */
    box-shadow: var(--box-shadow) !important; /* Resets to the default non-hover shadow, removing the glow */
}

    @media (max-width: 768px) {
        .page-content .row > div[class*="col-"]:has(> .dashboard-thumb) {
            flex: 1 0 21%; /* Aim for 4 icons per row */
        }

        .dashboard-stat {
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            aspect-ratio: 1 / 1; /* Make the buttons square */
            height: auto !important;
        }

        .dashboard-stat .details {
            display: none !important; /* Hide the text label */
        }

        .dashboard-stat .visual {
            position: static !important; /* Reset position to allow centering */
            height: auto !important;
            opacity: 0.9 !important; /* Make icon more prominent */
        }

        .dashboard-stat .visual > .fa {
            font-size: 28px !important; /* Adjust icon size for the smaller button */
            top: auto !important;
            margin: 0 !important;
        }
    }
    `;
    document.head.appendChild(style);

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

    const headObserver = new MutationObserver(() => {
        updatePageTitle();
    });
    const titleElement = document.querySelector('head > title');
    if (titleElement) {
        headObserver.observe(titleElement, { childList: true });
    }

    // ************************************************************************
    // Automatic Clicks on Login Buttons for EIS
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
})();
