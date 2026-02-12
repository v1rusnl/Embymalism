/*!
 * Emby Link Logos Integration
 * Replaces text links (IMDb, TheMovieDb, Trakt, TheTVDB) with logo icons in Emby detail pages
 * Copy script inside /system/dashboard-ui/ and add <script src="emby-linklogos.js" defer></script> in index.html before </body>
 */

(function () {
    'use strict';

    const LOG_PREFIX = '🔗 Emby Link Logos:';

    const LINK_LOGOS = {
        'imdb': {
            match: (href) => href.includes('imdb.com'),
            logo: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/IMDb.png',
            label: 'IMDb',
            height: '20px'
        },
        'tmdb': {
            match: (href) => href.includes('themoviedb.org'),
            logo: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/TMDB.png',
            label: 'TMDB',
            height: '25px'
        },
        'trakt': {
            match: (href) => href.includes('trakt.tv'),
            logo: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Trakt.png',
            label: 'Trakt',
            height: '25px'
        },
        'tvdb': {
            match: (href) => href.includes('thetvdb.com'),
            logo: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/tvdb.png',
            label: 'TheTVDB',
            height: '25px'
        }
    };

    const PROCESSED_ATTR = 'data-logo-processed';

    let debounceTimer = null;
    let retryTimer = null;

    function getVisibleDetailView() {
        const allViews = document.querySelectorAll('.view-item-item');
        for (const view of allViews) {
            if (!view.classList.contains('hide')) {
                return view;
            }
        }
        return null;
    }

    function replaceWithLogo(linkElement, config) {
        if (linkElement.hasAttribute(PROCESSED_ATTR)) return;

        linkElement.textContent = '';

        const img = document.createElement('img');
        img.src = config.logo;
        img.alt = config.label;
        img.title = config.label;
        img.draggable = false;
        img.style.cssText = `
            height: ${config.height};
            width: auto;
            object-fit: contain;
            vertical-align: middle;
            opacity: 0.85;
            transition: opacity 0.2s ease;
        `;

        img.addEventListener('mouseenter', () => { img.style.opacity = '1'; });
        img.addEventListener('mouseleave', () => { img.style.opacity = '0.85'; });

        linkElement.appendChild(img);

        linkElement.style.cssText += `
            display: inline-flex;
            align-items: center;
            padding: 2px 0px;
        `;

        linkElement.setAttribute(PROCESSED_ATTR, 'true');
    }

    /**
     * Prüft ob die Links tatsächlich vollständig gerendert sind.
     * Ein Link gilt als "bereit", wenn er ein href-Attribut hat
     * und sichtbaren Text oder Inhalt enthält.
     */
    function areLinksReady(links) {
        if (links.length === 0) return false;

        for (const link of links) {
            // Bereits verarbeitete Links überspringen
            if (link.hasAttribute(PROCESSED_ATTR)) continue;

            const href = link.href || '';
            const text = link.textContent.trim();

            // Link muss href UND sichtbaren Text haben
            if (!href || !text) return false;
        }
        return true;
    }

    function processLinks() {
        const visibleView = getVisibleDetailView();
        if (!visibleView) return false;

        const linksSection = visibleView.querySelector('.linksSection');
        if (!linksSection) return false;

        const linkContainer = linksSection.querySelector('.itemLinks');
        if (!linkContainer) return false;

        const links = linkContainer.querySelectorAll('a[is="emby-linkbutton"]');
        if (links.length === 0) return false;

        // ── Kernfix: Prüfen ob Links wirklich fertig gerendert sind ──
        const unprocessedLinks = Array.from(links).filter(
            l => !l.hasAttribute(PROCESSED_ATTR)
        );

        // Wenn alle schon verarbeitet sind → fertig
        if (unprocessedLinks.length === 0) return true;

        // Wenn Links noch nicht bereit sind → Retry signalisieren
        if (!areLinksReady(links)) {
            console.log(`${LOG_PREFIX} Links not ready yet, will retry...`);
            return false;
        }

        let processedCount = 0;

        links.forEach(link => {
            if (link.hasAttribute(PROCESSED_ATTR)) return;

            const href = link.href || '';

            for (const key in LINK_LOGOS) {
                const config = LINK_LOGOS[key];
                if (config.match(href)) {
                    replaceWithLogo(link, config);
                    processedCount++;
                    break;
                }
            }
        });

        if (processedCount > 0) {
            // Komma-Textknoten bereinigen
            const childNodes = Array.from(linkContainer.childNodes);
            childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const trimmed = node.textContent.trim();
                    if (trimmed === ',' || trimmed === ', ' || trimmed === '') {
                        node.textContent = ' ';
                    }
                }
            });

            linkContainer.style.cssText += `
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            `;

            console.log(`${LOG_PREFIX} Replaced ${processedCount} link(s) with logos.`);
        }

        return true; // Erfolgreich verarbeitet
    }

    /**
     * Versucht die Verarbeitung mit Retry-Logik.
     * Probiert es mehrfach mit steigenden Intervallen,
     * falls die Links noch nicht im DOM sind.
     */
    function processWithRetry(attempt = 0, maxAttempts = 15) {
        if (retryTimer) clearTimeout(retryTimer);

        const success = processLinks();

        if (!success && attempt < maxAttempts) {
            // Exponentielles Backoff: 200, 300, 400, 500, ... max 1500ms
            const delay = Math.min(200 + (attempt * 100), 1500);
            retryTimer = setTimeout(() => {
                processWithRetry(attempt + 1, maxAttempts);
            }, delay);
        } else if (!success) {
            console.log(`${LOG_PREFIX} Gave up after ${maxAttempts} attempts.`);
        }
    }

    /**
     * Debounced Entry-Point – startet die Retry-Kette neu.
     */
    function debouncedProcess() {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (retryTimer) clearTimeout(retryTimer);

        debounceTimer = setTimeout(() => {
            processWithRetry(0);
        }, 200);
    }

    // ── MutationObserver: Gezielter auf relevante Änderungen reagieren ──
    const observer = new MutationObserver((mutations) => {
        let shouldProcess = false;

        for (const mutation of mutations) {
            // Fall 1: Neue Knoten wurden eingefügt
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // Direkt eine linksSection oder itemLinks eingefügt?
                    if (
                        node.classList?.contains('linksSection') ||
                        node.classList?.contains('itemLinks') ||
                        node.querySelector?.('.linksSection') ||
                        node.querySelector?.('.itemLinks')
                    ) {
                        shouldProcess = true;
                        break;
                    }

                    // Oder eine view-item-item (Seitenwechsel)?
                    if (
                        node.classList?.contains('view-item-item') ||
                        node.querySelector?.('.view-item-item')
                    ) {
                        shouldProcess = true;
                        break;
                    }
                }
            }

            // Fall 2: Klasse 'hide' wurde geändert (View wird sichtbar)
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (
                    target.classList?.contains('view-item-item') &&
                    !target.classList.contains('hide')
                ) {
                    shouldProcess = true;
                }
            }

            if (shouldProcess) break;
        }

        if (shouldProcess) {
            debouncedProcess();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // ── URL-Polling für SPA-Navigation ──
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            console.log(`${LOG_PREFIX} URL changed, reprocessing...`);
            debouncedProcess();
        }
    }, 500);

    // ── Initialer Aufruf ──
    debouncedProcess();

    console.log(`${LOG_PREFIX} Initialization complete.`);
})();