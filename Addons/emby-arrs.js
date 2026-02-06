/*!
 * Emby Arr Link Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/n00bcodr/Jellyfin-Enhanced
 * Shows Radarr/Sonarr Links on Emby detail pages
 * Add your Radarr/Sonarr base URLs and API Keys in line 12-22
 * Copy script inside /system/dashboard-ui/ and add <script src="emby-arrs.js"></script> in index.html before </body>
 */

(function () {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        // Radarr Einstellungen
        RADARR_URL: 'https://radarr.mydomain.com',   // Base-URL Radarr (without trailing slash)
        RADARR_API_KEY: 'YOUR_API_KEY', // Radarr API Key

        // Sonarr Einstellungen
        SONARR_URL: 'https://sonarr.mydomain.com',    // Base-URL Sonarr (without trailing slash)
        SONARR_API_KEY: 'YOUR_API_KEY',  // Sonarr API Key
    };
    // ========================================================

    const LOG_PREFIX = '🎯 Emby Arr Links:';
    const SECTION_CLASS = 'verticalSection verticalSection-cards arrSection';
    const SECTION_SELECTOR = '.arrSection';

    let isProcessing = false;
    let debounceTimer = null;
    let currentItemId = null;

    // Cache für Arr-Lookups
    const radarrCache = new Map();
    const sonarrCache = new Map();

    console.log(`${LOG_PREFIX} Script geladen.`);

    // ── Hilfsfunktionen ──

    function getItemIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        let id = urlParams.get('id');
        if (!id) {
            const hashParts = window.location.hash.split('?');
            if (hashParts.length > 1) {
                const hashParams = new URLSearchParams(hashParts[1]);
                id = hashParams.get('id');
            }
        }
        if (!id) {
            const match = window.location.href.match(/[?&]id=(\d+)/);
            if (match) id = match[1];
        }
        return id;
    }

    function getApiClient() {
        if (typeof ApiClient !== 'undefined') return ApiClient;
        if (window.ApiClient) return window.ApiClient;
        return null;
    }

    async function getEmbyItem(itemId) {
        const apiClient = getApiClient();
        if (!apiClient) {
            console.error(`${LOG_PREFIX} ApiClient nicht verfügbar.`);
            return null;
        }
        try {
            const userId = apiClient.getCurrentUserId();
            const item = await apiClient.getItem(userId, itemId);
            return item;
        } catch (err) {
            console.error(`${LOG_PREFIX} Fehler beim Abrufen des Items:`, err);
            return null;
        }
    }

    /**
     * Findet den aktuell sichtbaren Item-Detail-View
     * Emby hat möglicherweise mehrere view-item-item Divs im DOM,
     * aber nur eines ist sichtbar (ohne 'hide' Klasse)
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

    async function lookupRadarr(tmdbId) {
        if (radarrCache.has(tmdbId)) return radarrCache.get(tmdbId);
        try {
            const response = await fetch(`${CONFIG.RADARR_URL}/api/v3/movie?tmdbId=${tmdbId}`, {
                headers: { 'X-Api-Key': CONFIG.RADARR_API_KEY }
            });
            if (!response.ok) {
                const lookupResp = await fetch(`${CONFIG.RADARR_URL}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`, {
                    headers: { 'X-Api-Key': CONFIG.RADARR_API_KEY }
                });
                if (lookupResp.ok) {
                    const data = await lookupResp.json();
                    const result = { found: false, titleSlug: data.titleSlug || null, tmdbId };
                    radarrCache.set(tmdbId, result);
                    return result;
                }
                radarrCache.set(tmdbId, { found: false, titleSlug: null, tmdbId });
                return { found: false, titleSlug: null, tmdbId };
            }
            const movies = await response.json();
            if (movies && movies.length > 0) {
                const movie = movies[0];
                const result = { found: true, id: movie.id, titleSlug: movie.titleSlug, tmdbId };
                radarrCache.set(tmdbId, result);
                return result;
            }
            radarrCache.set(tmdbId, { found: false, titleSlug: null, tmdbId });
            return { found: false, titleSlug: null, tmdbId };
        } catch (err) {
            console.error(`${LOG_PREFIX} Radarr Lookup Fehler:`, err);
            return { found: false, titleSlug: null, tmdbId, error: true };
        }
    }

    async function lookupSonarr(tvdbId, seriesName) {
        const cacheKey = tvdbId || seriesName;
        if (sonarrCache.has(cacheKey)) return sonarrCache.get(cacheKey);
        try {
            if (tvdbId) {
                const response = await fetch(`${CONFIG.SONARR_URL}/api/v3/series?tvdbId=${tvdbId}`, {
                    headers: { 'X-Api-Key': CONFIG.SONARR_API_KEY }
                });
                if (response.ok) {
                    const series = await response.json();
                    if (series && series.length > 0) {
                        const s = series[0];
                        const result = { found: true, id: s.id, titleSlug: s.titleSlug, tvdbId };
                        sonarrCache.set(cacheKey, result);
                        return result;
                    }
                }
                const lookupResp = await fetch(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=tvdb:${tvdbId}`, {
                    headers: { 'X-Api-Key': CONFIG.SONARR_API_KEY }
                });
                if (lookupResp.ok) {
                    const data = await lookupResp.json();
                    if (data && data.length > 0) {
                        const result = { found: false, titleSlug: data[0].titleSlug, tvdbId };
                        sonarrCache.set(cacheKey, result);
                        return result;
                    }
                }
            }
            if (seriesName) {
                const lookupResp = await fetch(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=${encodeURIComponent(seriesName)}`, {
                    headers: { 'X-Api-Key': CONFIG.SONARR_API_KEY }
                });
                if (lookupResp.ok) {
                    const data = await lookupResp.json();
                    if (data && data.length > 0) {
                        const existing = data.find(s => s.id && s.id > 0);
                        if (existing) {
                            const result = { found: true, id: existing.id, titleSlug: existing.titleSlug };
                            sonarrCache.set(cacheKey, result);
                            return result;
                        }
                        const result = { found: false, titleSlug: data[0].titleSlug };
                        sonarrCache.set(cacheKey, result);
                        return result;
                    }
                }
            }
            const result = { found: false, titleSlug: null };
            sonarrCache.set(cacheKey, result);
            return result;
        } catch (err) {
            console.error(`${LOG_PREFIX} Sonarr Lookup Fehler:`, err);
            return { found: false, titleSlug: null, error: true };
        }
    }

    function getTvdbId(item) {
        if (item?.ProviderIds?.Tvdb) return item.ProviderIds.Tvdb;
        if (item?.ProviderIds?.tvdb) return item.ProviderIds.tvdb;
        return null;
    }

    function getTmdbId(item) {
        if (item?.ProviderIds?.Tmdb) return item.ProviderIds.Tmdb;
        if (item?.ProviderIds?.tmdb) return item.ProviderIds.tmdb;
        return null;
    }

    function buildRadarrUrl(radarrResult) {
        if (radarrResult.found && radarrResult.titleSlug) {
            return `${CONFIG.RADARR_URL}/movie/${radarrResult.titleSlug}`;
        }
        return `${CONFIG.RADARR_URL}/add/new?term=tmdb:${radarrResult.tmdbId}`;
    }

    function buildSonarrUrl(sonarrResult) {
        if (sonarrResult.found && sonarrResult.titleSlug) {
            return `${CONFIG.SONARR_URL}/series/${sonarrResult.titleSlug}`;
        }
        if (sonarrResult.titleSlug) {
            return `${CONFIG.SONARR_URL}/add/new?term=${sonarrResult.titleSlug}`;
        }
        return `${CONFIG.SONARR_URL}`;
    }

    function createArrButton(label, url, iconUrl) {
        const link = document.createElement('a');
        link.setAttribute('is', 'emby-linkbutton');
        link.className = 'button-link button-link-color-inherit button-link-fontweight-inherit emby-button button-hoverable';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = label;
        link.style.cssText = 'display: inline-flex; align-items: center; gap: 5px;';

        if (iconUrl) {
            const icon = document.createElement('img');
            icon.src = iconUrl;
            icon.alt = label;
            icon.style.cssText = 'width: 25px; height: 25px; object-fit: contain; vertical-align: middle;';
            link.appendChild(icon);
        }
        link.appendChild(document.createTextNode(label));
        return link;
    }

    function removeExistingSection(scope) {
        const container = scope || document;
        const existing = container.querySelectorAll(SECTION_SELECTOR);
        existing.forEach(el => el.remove());
    }

    function createArrSection(buttons, visibleView) {
        if (!buttons || buttons.length === 0) return;

        // Suche die linksSection NUR innerhalb des sichtbaren Views
        const linksSection = visibleView.querySelector('.linksSection');
        if (!linksSection) {
            console.warn(`${LOG_PREFIX} linksSection nicht im sichtbaren View gefunden.`);
            return;
        }

        // Entferne bestehende arrSection nur im sichtbaren View
        removeExistingSection(visibleView);

        const section = document.createElement('div');
        section.className = SECTION_CLASS;

        const header = document.createElement('h4');
        header.className = 'sectionTitle sectionTitle-cards padded-left padded-left-page padded-right';
        header.style.marginBottom = '.1em';
        header.textContent = 'Arrs';
        section.appendChild(header);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'sectionTitle sectionTitle-cards padded-left padded-left-page padded-right focusable focuscontainer-x secondaryText textItems';
        buttonContainer.setAttribute('data-focusabletype', 'nearest');

        buttons.forEach((btn, index) => {
            buttonContainer.appendChild(btn);
            if (index < buttons.length - 1) {
                buttonContainer.appendChild(document.createTextNode(', '));
            }
        });

        section.appendChild(buttonContainer);
        linksSection.parentNode.insertBefore(section, linksSection.nextSibling);

        console.log(`${LOG_PREFIX} Arr-Section mit ${buttons.length} Button(s) eingefügt.`);
    }

    async function processItemPage() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const itemId = getItemIdFromUrl();
            if (!itemId) {
                return;
            }

            // Finde den SICHTBAREN Detail-View
            const visibleView = getVisibleDetailView();
            if (!visibleView) {
                return;
            }

            // Prüfe ob die linksSection im sichtbaren View existiert
            const linksSection = visibleView.querySelector('.linksSection');
            if (!linksSection) {
                return;
            }

            // Wenn bereits eine arrSection im sichtbaren View existiert und es das gleiche Item ist
            if (currentItemId === itemId && visibleView.querySelector(SECTION_SELECTOR)) {
                return;
            }

            currentItemId = itemId;

            // Entferne bestehende arrSection im sichtbaren View
            removeExistingSection(visibleView);

            const item = await getEmbyItem(itemId);
            if (!item) return;

            console.log(`${LOG_PREFIX} Item: "${item.Name}" (Type: ${item.Type}, ID: ${itemId})`);

            const buttons = [];
            const tmdbId = getTmdbId(item);

            if (item.Type === 'Movie') {
                if (CONFIG.RADARR_API_KEY && CONFIG.RADARR_API_KEY !== 'DEIN_RADARR_API_KEY' && tmdbId) {
                    const radarrResult = await lookupRadarr(tmdbId);
                    const radarrUrl = buildRadarrUrl(radarrResult);
                    const radarrIcon = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/radarr-light-hybrid-light.svg';
                    buttons.push(createArrButton('Radarr', radarrUrl, radarrIcon));
                    console.log(`${LOG_PREFIX} Radarr-Link: ${radarrUrl}`);
                }
            } else if (item.Type === 'Series') {
                if (CONFIG.SONARR_API_KEY && CONFIG.SONARR_API_KEY !== 'DEIN_SONARR_API_KEY') {
                    const tvdbId = getTvdbId(item);
                    console.log(`${LOG_PREFIX} Serie: TVDB=${tvdbId}, TMDB=${tmdbId}, Name="${item.Name}"`);
                    const sonarrResult = await lookupSonarr(tvdbId, item.Name);
                    const sonarrUrl = buildSonarrUrl(sonarrResult);
                    const sonarrIcon = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg';
                    buttons.push(createArrButton('Sonarr', sonarrUrl, sonarrIcon));
                    console.log(`${LOG_PREFIX} Sonarr-Link: ${sonarrUrl} (found: ${sonarrResult.found})`);
                }
            } else {
                console.log(`${LOG_PREFIX} Typ "${item.Type}" wird nicht unterstützt.`);
                return;
            }

            if (buttons.length > 0) {
                // Nochmal den sichtbaren View holen (falls sich inzwischen was geändert hat)
                const currentView = getVisibleDetailView();
                if (currentView) {
                    createArrSection(buttons, currentView);
                }
            }
        } catch (err) {
            console.error(`${LOG_PREFIX} Fehler beim Verarbeiten der Seite:`, err);
        } finally {
            isProcessing = false;
        }
    }

    function debouncedProcess() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            processItemPage();
        }, 300);
    }

    // ── Initialisierung ──

    if (CONFIG.RADARR_API_KEY === 'DEIN_RADARR_API_KEY' && CONFIG.SONARR_API_KEY === 'DEIN_SONARR_API_KEY') {
        console.warn(`${LOG_PREFIX} Bitte konfiguriere mindestens einen API-Key in der CONFIG-Sektion.`);
    }

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

    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            currentItemId = null;
            debouncedProcess();
        }
    }, 500);

    debouncedProcess();

    console.log(`${LOG_PREFIX} Initialisierung abgeschlossen.`);
})();
