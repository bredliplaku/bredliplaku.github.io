        /* === SMART BUTTON GROUP ROW DETECTION === */
        function updateButtonGroupRadii() {
            document.querySelectorAll('.button-group').forEach(group => {
                const buttons = Array.from(group.querySelectorAll('.group-btn'));
                if (!buttons.length) return;

                // Clear previous classes
                buttons.forEach(btn => {
                    btn.classList.remove('first-in-row', 'last-in-row', 'only-in-row');
                });

                // Group buttons by visual row (same offsetTop)
                let rows = [];
                let currentRow = [buttons[0]];
                let currentTop = buttons[0].offsetTop;

                for (let i = 1; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if (Math.abs(btn.offsetTop - currentTop) < 4) {
                        // Same row (4px tolerance for sub-pixel differences)
                        currentRow.push(btn);
                    } else {
                        rows.push(currentRow);
                        currentRow = [btn];
                        currentTop = btn.offsetTop;
                    }
                }
                rows.push(currentRow);

                // Apply row-aware classes
                rows.forEach(row => {
                    if (row.length === 1) {
                        row[0].classList.add('only-in-row');
                    } else {
                        row[0].classList.add('first-in-row');
                        row[row.length - 1].classList.add('last-in-row');
                    }
                });
            });
        }

        /* === STORAGE ===
           localStorage throws when site data is blocked; the theme should still
           work for the visit, just without being remembered. */
        const storage = {
            get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
            set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* not persisted */ } },
        };

        /* === THEME ===
           The preference is shared by every page of the site, so this page
           can't assume it is the only place it changes. */
        const THEME_KEY = 'theme-preference';
        const THEME_ICONS = { auto: 'fa-solid fa-circle-half-stroke', light: 'fa-regular fa-sun', dark: 'fa-regular fa-moon' };
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
        const savedTheme = () => {
            const pref = storage.get(THEME_KEY);
            return pref === 'light' || pref === 'dark' ? pref : 'auto';
        };

        // Puts a preference on the page — the attribute the stylesheets key
        // off, the browser-chrome colour, and the toggle's icon and label.
        // Saving is separate, so following a change made elsewhere doesn't
        // write it straight back.
        function applyTheme(pref) {
            const html = document.documentElement;
            if (pref === 'auto') html.removeAttribute('data-theme');
            else html.setAttribute('data-theme', pref);

            const isDark = pref === 'dark' || (pref === 'auto' && systemDark.matches);
            document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
            const meta = document.createElement('meta');
            meta.name = 'theme-color';
            meta.content = isDark ? '#0c0e14' : '#ffffff';
            document.head.appendChild(meta);

            const btn = document.getElementById('theme-toggle');
            if (!btn) return;
            // Replaced rather than reclassed: the FontAwesome kit swaps each <i> for an <svg>
            const old = document.getElementById('theme-toggle-icon');
            if (old) {
                const i = document.createElement('i');
                i.id = 'theme-toggle-icon';
                i.className = THEME_ICONS[pref];
                i.setAttribute('aria-hidden', 'true');
                old.replaceWith(i);
            }
            const label = pref.charAt(0).toUpperCase() + pref.slice(1);
            btn.setAttribute('aria-label', `Theme: ${label}`);
            btn.title = `Theme: ${label}`;
        }

        function setupTheme() {
            const btn = document.getElementById('theme-toggle');
            if (btn) {
                // Auto → whichever theme the system *isn't* → auto, so every
                // click visibly changes something. A saved choice that has
                // since come to match the system counts as auto.
                btn.addEventListener('click', () => {
                    const sys = systemDark.matches ? 'dark' : 'light';
                    const pref = savedTheme();
                    const next = pref === 'auto' || pref === sys ? (sys === 'dark' ? 'light' : 'dark') : 'auto';
                    storage.set(THEME_KEY, next);
                    applyTheme(next);
                });
            }

            systemDark.addEventListener('change', () => {
                if (savedTheme() === 'auto') applyTheme('auto');
            });
            // Changed in another tab.
            window.addEventListener('storage', (e) => {
                if (e.key === THEME_KEY) applyTheme(savedTheme());
            });
            // Changed on another page, then Back: the browser restores this
            // page from its back-forward cache exactly as it was left, old
            // theme included, without running any of it again.
            window.addEventListener('pageshow', (e) => {
                if (e.persisted) applyTheme(savedTheme());
            });

            applyTheme(savedTheme());
        }

        /* === CAT COMPANION === */
        const catMessages = [
            "Psst. I helped build this site... mostly by sitting on the keyboard.",
            "I've knocked all the pens off the desk. My work here is done.",
            "I'm not sleeping, I'm compiling. It's a very complex process.",
            "The box this computer came in was far more interesting than the computer itself.",
            "Oh, were you using this piece of paper? It looked like it desperately needed to be on the floor.",
            "I've conducted extensive stress tests on that chair you're sitting in. It's... adequate.",
            "Some call it mischief, I call it 'unsolicited quality assurance testing'.",
            "That houseplant looked at me funny. It had to go.",
            "My human thinks they're in charge. It's quite adorable, isn't it?",
            "Just so we're clear, this is my flat. I just let the human pay the rent.",
            "I have a doctorate in Napping from the University of Sunbeams. What's your excuse?",
            "My schedule today: 10:00 nap, 11:00 pre-lunch nap, 12:00 lunch, 14:00 post-lunch nap...",
            "I'm not ignoring you, I'm simply in energy-saving mode.",
            "Of course, I understand thermodynamics. A lap is warm (ΔQ > 0), the floor is not.",
            "The human went to university; I mastered structural engineering by finding the single weakest point of a cardboard box.",
            "My food bowl is only 98% full. I consider this a catastrophic failure of service.",
            "I see you have a biscuit. I also like biscuits. We should have a chat. 🧐",
            "A sunbeam has appeared 2 metres to my left. I must relocate immediately. This is not a drill.",
            "The sound of a snack packet rustling from another room? I can get there in 2.7 seconds. Olympic-level.",
            // A function is worked out when it's said — a cat this precise
            // shouldn't be stuck at one time of day.
            () => `It is precisely ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Are you aware of the critically low biscuit levels?`,
            "I'm powered by a complex algorithm of treats and head scratches.",
            "Welcome! Don't mind me, I'm just supervising the human.",
            "If you scroll too fast, I'm going to try and catch your mouse cursor.",
            "Go on, try to click me again. I dare you.",
            "Are you still here? Impressive focus for a human.",
            "Don't tell anyone, but I'm the real reason this website is so purr-fect.",
            "I've reviewed your user session. My analysis indicates a severe lack of attention being paid to me.",
            "I've sent a few emails on your behalf. They mostly say 'sdfghjkl;'. You're welcome.",
            "Alright? Just having a little rest before my next big rest.",
            "Blimey, that's a lot of reading. My eyes are tired just looking at it.",
            "Was that a bird? Sorry, I lost my train of thought. What were we talking about?",
            "They say curiosity killed the cat, but satisfaction brought it back. That's why I get nine lives. 😉",
            "The human's typing is so loud. It's putting me off my afternoon slumber.",
            "Right, that's enough screen time for one day. Where's the telly remote?",
            "Kalofsh një ditë të bukur!"
        ];

        function setupCatCompanion() {
            const cat = document.getElementById('cat-companion');
            const bubble = document.getElementById('cat-speech-bubble');
            if (!cat || !bubble) return;

            cat.setAttribute('role', 'button');
            cat.setAttribute('tabindex', '0');
            cat.setAttribute('aria-label', 'Cat Companion: Click for a message');

            let hideTimer;
            let lastIndex = -1; // Track the last message to avoid repeats

            // Every show and hide goes through these two, so there is only
            // ever one timer. A bubble clicked away used to leave its timer
            // running, and it then cut the *next* message short.
            const hide = () => {
                clearTimeout(hideTimer);
                bubble.classList.remove('visible');
            };

            // Up long enough to read: about 60 ms a character, never under 5 s.
            const show = (text) => {
                clearTimeout(hideTimer);
                bubble.textContent = text;
                bubble.classList.add('visible');
                hideTimer = setTimeout(hide, Math.max(5000, 2000 + text.length * 60));
            };

            const triggerCatInteraction = () => {
                const chance = 10000;
                const randomNumber = Math.floor(Math.random() * chance);

                if (randomNumber === 0) {
                    window.open('https://youtu.be/dQw4w9WgXcQ', '_blank', 'noopener');
                    return;
                }

                let randomIndex;
                do {
                    randomIndex = Math.floor(Math.random() * catMessages.length);
                } while (randomIndex === lastIndex && catMessages.length > 1);
                lastIndex = randomIndex;

                const message = catMessages[randomIndex];
                show(typeof message === 'function' ? message() : message);
            };

            cat.addEventListener('click', (event) => {
                event.stopPropagation();
                triggerCatInteraction();
            });

            cat.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    triggerCatInteraction();
                }
            });

            document.addEventListener('click', (event) => {
                if (!cat.contains(event.target)) hide();
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') hide();
            });
        }

        /* === YEAR === */
        function updateYear() {
            const el = document.getElementById('currentYear');
            if (el) el.textContent = new Date().getFullYear();
        }

        /* === INIT === */
        document.addEventListener('DOMContentLoaded', function () {
            updateYear();
            setupTheme();
            setupCatCompanion();
            updateButtonGroupRadii();
            // Rows can change without the window changing: the icon kit and
            // the web font both arrive after this and widen the buttons.
            if (window.ResizeObserver) {
                const ro = new ResizeObserver(updateButtonGroupRadii);
                document.querySelectorAll('.button-group').forEach(g => ro.observe(g));
            } else {
                window.addEventListener('resize', updateButtonGroupRadii);
            }

            // main.css hides the cat by default until this class is added; this page has
            // no content to wait for, so show it straight away.
            const cat = document.getElementById('cat-companion');
            if (cat) cat.classList.add('visible');
        });
