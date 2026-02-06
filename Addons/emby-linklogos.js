/*!
 * Emby Link Logos Integration
 * Replaces text links (IMDb, TheMovieDb, Trakt, TheTVDB) with logo icons in Emby detail pages
 * Copy script inside /system/dashboard-ui/ and add <script src="emby-linklogos.js"></script> in index.html before </body>
 */

(function () {
    'use strict';

    const LOG_PREFIX = '🔗 Emby Link Logos:';

    // Logo configuration for each supported service
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

    /**
     * Finds the currently visible item detail view.
     * Emby keeps multiple view-item-item divs in the DOM;
     * only the one without 'hide' class is currently displayed.
     */
    function getVisibleDetailView() {
        const allViews = document.querySelectorAll('.view-item-item');
        for (const view of allViews) {
            if (!view.classList.contains('hide')) {
                return view;
            }
        }
        return null;
    }

    /**
     * Replaces a text link element with a logo image.
     * Preserves href, target, and all other link attributes.
     */
    function replaceWithLogo(linkElement, config) {
        if (linkElement.hasAttribute(PROCESSED_ATTR)) return;

        // Clear existing text content (including trailing comma)
        linkElement.textContent = '';

        // Create logo image
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

        // Hover effect
        img.addEventListener('mouseenter', () => { img.style.opacity = '1'; });
        img.addEventListener('mouseleave', () => { img.style.opacity = '0.85'; });

        linkElement.appendChild(img);

        // Update link styling for icon display
        linkElement.style.cssText += `
            display: inline-flex;
            align-items: center;
            padding: 2px 0px;
        `;

        // Mark as processed to avoid duplicate replacements
        linkElement.setAttribute(PROCESSED_ATTR, 'true');
    }

    /**
     * Processes all links within the linksSection of the visible detail view.
     * Works for both Movies (IMDb, TMDB, Trakt) and Series (IMDb, TMDB, TheTVDB, Trakt).
     * Removes comma separators and replaces text labels with logo icons.
     */
    function processLinks() {
        const visibleView = getVisibleDetailView();
        if (!visibleView) return;

        const linksSection = visibleView.querySelector('.linksSection');
        if (!linksSection) return;

        const linkContainer = linksSection.querySelector('.itemLinks');
        if (!linkContainer) return;

        // Skip if already fully processed
        if (linkContainer.hasAttribute(PROCESSED_ATTR)) return;

        const links = linkContainer.querySelectorAll('a[is="emby-linkbutton"]');
        if (links.length === 0) return;

        let anyProcessed = false;

        links.forEach(link => {
            if (link.hasAttribute(PROCESSED_ATTR)) return;

            const href = link.href || '';

            // Find matching logo config
            for (const key in LINK_LOGOS) {
                const config = LINK_LOGOS[key];
                if (config.match(href)) {
                    replaceWithLogo(link, config);
                    anyProcessed = true;
                    break;
                }
            }
        });

        if (anyProcessed) {
            // Remove comma/separator text nodes between links
            const childNodes = Array.from(linkContainer.childNodes);
            childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const trimmed = node.textContent.trim();
                    if (trimmed === ',' || trimmed === ', ' || trimmed === '') {
                        node.textContent = ' ';
                    }
                }
            });

            // Apply flex layout with spacing between logo links
            linkContainer.style.cssText += 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

            // Mark container as processed
            linkContainer.setAttribute(PROCESSED_ATTR, 'true');

            console.log(`${LOG_PREFIX} Replaced ${links.length} link(s) with logos.`);
        }
    }

    /**
     * Debounced processing to avoid excessive DOM operations
     * during rapid mutations.
     */
    function debouncedProcess() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processLinks();
        }, 300);
    }

    // ── Initialization ──

    // Watch for DOM changes to detect when detail pages are rendered
    const observer = new MutationObserver(() => {
        const visibleView = getVisibleDetailView();
        if (visibleView) {
            debouncedProcess();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // Poll for URL changes (Emby SPA navigation)
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            debouncedProcess();
        }
    }, 500);

    // Initial processing
    debouncedProcess();

    console.log(`${LOG_PREFIX} Initialization complete.`);
})();