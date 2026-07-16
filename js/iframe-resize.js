/* ==========================================================================
   iframe-resize.js — vertical drag-resize for .iframe-container blocks.

   Usage:
     IframeResize.attach(container)
         Creates a drag handle right after the container (once). The handle is
         only visible while the container has the .visible class (CSS in
         main.css). Works with mouse and touch via Pointer Events; the handle
         sets touch-action:none so dragging it never scrolls the page.

     IframeResize.apply(container, storageKey, adminDefaultPx)
         Sets the height for the current context and remembers storageKey so a
         later drag saves under it. Priority:
           user-saved height (localStorage[storageKey])
           > adminDefaultPx (backend-configured)
           > CSS default (var(--iframe-h) fallback).

   Storage: one localStorage entry per storageKey. Callers must namespace keys
   with the page AND the specific timetable/course/button identity so a saved
   height can never leak onto a different timetable.
   ========================================================================== */
(function () {
    'use strict';

    var MIN_H = 160;

    function maxH() {
        return Math.max(300, Math.round(window.innerHeight * 0.92));
    }

    function clamp(h) {
        return Math.min(Math.max(Math.round(h), MIN_H), maxH());
    }

    function readSaved(key) {
        if (!key) return null;
        var v;
        try {
            v = parseInt(localStorage.getItem(key), 10);
        } catch (e) {
            return null;
        }
        // reject junk so a corrupted entry can never produce a broken layout
        return (Number.isFinite(v) && v >= MIN_H && v <= 4000) ? clamp(v) : null;
    }

    window.IframeResize = {
        apply: function (container, storageKey, adminDefaultPx) {
            if (!container) return;
            container.dataset.resizeKey = storageKey || '';
            var saved = readSaved(storageKey);
            var admin = parseInt(adminDefaultPx, 10);
            if (saved) {
                container.style.setProperty('--iframe-h', saved + 'px');
            } else if (Number.isFinite(admin) && admin > 0) {
                container.style.setProperty('--iframe-h', clamp(admin) + 'px');
            } else {
                container.style.removeProperty('--iframe-h');
            }
        },

        attach: function (container) {
            if (!container || container._iframeResizeAttached) return;
            container._iframeResizeAttached = true;

            var handle = document.createElement('div');
            handle.className = 'iframe-resize-handle';
            handle.title = 'Drag to resize';
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-label', 'Resize height');
            container.insertAdjacentElement('afterend', handle);

            var active = false, startY = 0, startH = 0;

            handle.addEventListener('pointerdown', function (e) {
                if (!container.classList.contains('visible')) return;
                active = true;
                startY = e.clientY;
                startH = container.getBoundingClientRect().height;
                container.classList.add('resizing');
                handle.classList.add('dragging');
                handle.setPointerCapture(e.pointerId);
                e.preventDefault();
            });

            handle.addEventListener('pointermove', function (e) {
                if (!active) return;
                container.style.setProperty('--iframe-h', clamp(startH + (e.clientY - startY)) + 'px');
            });

            function end() {
                if (!active) return;
                active = false;
                container.classList.remove('resizing');
                handle.classList.remove('dragging');
                var key = container.dataset.resizeKey;
                if (key) {
                    try {
                        localStorage.setItem(key, String(clamp(container.getBoundingClientRect().height)));
                    } catch (e) { /* storage full/blocked — resize still works for the session */ }
                }
            }

            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        }
    };
})();
