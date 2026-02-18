/*!
* Emby Link Logos Integration (mit Radarr/Sonarr + Rotten Tomatoes)
* Replaces text links (IMDb, TheMovieDb, Trakt, TheTVDB) with logo icons in Emby detail pages
* Adds Rotten Tomatoes link via Wikidata SPARQL lookup
* Adds Radarr/Sonarr links directly to the links section
*/
(function () {
'use strict';

// ==================== CONFIGURATION ====================
const CONFIG = {
    RADARR_URL: '',
    RADARR_API_KEY: '',
    SONARR_URL: '',
    SONARR_API_KEY: '',
    ENABLE_ROTTEN_TOMATOES: true,
};
// ==================== CONFIGURATION END ====================

const LOG = 'Emby Link Logos:';
const CDN = 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo';
const PROCESSED = 'data-logo-processed';
const CUSTOM_LINK = 'data-custom-link';       // Marker auf jedem eingefügten Custom-Link
const CUSTOM_DONE = 'data-custom-done';       // Marker auf dem Container nach Erfolg

const LINK_LOGOS = {
    'imdb.com':       { logo: `${CDN}/IMDb_noframe.png`, label: 'IMDb',    height: '20px' },
    'themoviedb.org': { logo: `${CDN}/TMDB.png`,         label: 'TMDB',    height: '25px' },
    'trakt.tv':       { logo: `${CDN}/Trakt.png`,        label: 'Trakt',   height: '25px' },
    'thetvdb.com':    { logo: `${CDN}/tvdb.png`,         label: 'TheTVDB', height: '25px' },
};

let debounceTimer = null, retryTimer = null, currentItemId = null, isProcessing = false;
const cache = { radarr: new Map(), sonarr: new Map(), rt: new Map() };

// ==================== HELPERS ====================
function getItemIdFromUrl() {
    const match = window.location.href.match(/[?&]id=(\d+)/);
    return match ? match[1] : null;
}

function getApiClient() {
    return (typeof ApiClient !== 'undefined' && ApiClient) || window.ApiClient || null;
}

async function getEmbyItem(itemId) {
    const api = getApiClient();
    if (!api) return null;
    try { return await api.getItem(api.getCurrentUserId(), itemId); }
    catch (e) { console.error(`${LOG} Item-Abruf fehlgeschlagen:`, e); return null; }
}

function getProviderId(item, key) {
    return item?.ProviderIds?.[key] || item?.ProviderIds?.[key.toLowerCase()] || null;
}

function getVisibleDetailView() {
    return document.querySelector('.view-item-item:not(.hide)') || null;
}

// FIX: Eigener Helper zum frischen Abfragen des Link-Containers
function freshLinkContainer() {
    return getVisibleDetailView()?.querySelector('.linksSection .itemLinks') || null;
}

// ==================== LOGO-IMG ERSTELLEN ====================
function createLogoImg(src, label, height = '22px') {
    const img = document.createElement('img');
    Object.assign(img, { src, alt: label, title: label, draggable: false });
    img.style.cssText = `height:${height};width:auto;object-fit:contain;vertical-align:middle;opacity:0.85;transition:opacity .2s`;
    img.addEventListener('mouseenter', () => img.style.opacity = '1');
    img.addEventListener('mouseleave', () => img.style.opacity = '0.85');
    return img;
}

function styleLinkElement(el) {
    el.style.cssText += 'display:inline-flex;align-items:center;padding:2px 0';
}

// ==================== ROTTEN TOMATOES ====================
async function getRTSlug(imdbId) {
    if (!imdbId) return null;
    if (cache.rt.has(imdbId)) return cache.rt.get(imdbId);
    try {
        const sparql = `SELECT ?rtId WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtId . } LIMIT 1`;
        const resp = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql));
        if (!resp.ok) { cache.rt.set(imdbId, null); return null; }
        const bindings = (await resp.json()).results.bindings;
        const slug = bindings[0]?.rtId?.value || null;
        cache.rt.set(imdbId, slug);
        return slug;
    } catch (e) { console.error(`${LOG} RT-Lookup:`, e); cache.rt.set(imdbId, null); return null; }
}

// ==================== RADARR/SONARR ====================
async function fetchJson(url, apiKey) {
    const resp = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
    return resp.ok ? resp.json() : null;
}

async function lookupRadarr(tmdbId) {
    if (cache.radarr.has(tmdbId)) return cache.radarr.get(tmdbId);
    try {
        const movies = await fetchJson(`${CONFIG.RADARR_URL}/api/v3/movie?tmdbId=${tmdbId}`, CONFIG.RADARR_API_KEY);
        if (movies?.length) {
            const r = { found: true, titleSlug: movies[0].titleSlug, tmdbId };
            cache.radarr.set(tmdbId, r); return r;
        }
        const lookup = await fetchJson(`${CONFIG.RADARR_URL}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`, CONFIG.RADARR_API_KEY);
        const r = { found: false, titleSlug: lookup?.titleSlug || null, tmdbId };
        cache.radarr.set(tmdbId, r); return r;
    } catch (e) { console.error(`${LOG} Radarr:`, e); return { found: false, titleSlug: null, tmdbId }; }
}

async function lookupSonarr(tvdbId, name) {
    const key = tvdbId || name;
    if (cache.sonarr.has(key)) return cache.sonarr.get(key);
    try {
        if (tvdbId) {
            const series = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series?tvdbId=${tvdbId}`, CONFIG.SONARR_API_KEY);
            if (series?.length) { const r = { found: true, titleSlug: series[0].titleSlug }; cache.sonarr.set(key, r); return r; }
            const lookup = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=tvdb:${tvdbId}`, CONFIG.SONARR_API_KEY);
            if (lookup?.length) { const r = { found: false, titleSlug: lookup[0].titleSlug }; cache.sonarr.set(key, r); return r; }
        }
        if (name) {
            const lookup = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=${encodeURIComponent(name)}`, CONFIG.SONARR_API_KEY);
            if (lookup?.length) {
                const existing = lookup.find(s => s.id > 0);
                const r = existing ? { found: true, titleSlug: existing.titleSlug } : { found: false, titleSlug: lookup[0].titleSlug };
                cache.sonarr.set(key, r); return r;
            }
        }
        const r = { found: false, titleSlug: null }; cache.sonarr.set(key, r); return r;
    } catch (e) { console.error(`${LOG} Sonarr:`, e); return { found: false, titleSlug: null }; }
}

function buildArrUrl(base, result, pathPrefix, tmdbId) {
    if (result.found && result.titleSlug) return `${base}/${pathPrefix}/${result.titleSlug}`;
    if (result.titleSlug) return `${base}/add/new?term=${result.titleSlug}`;
    return tmdbId ? `${base}/add/new?term=tmdb:${tmdbId}` : base;
}

// ==================== LINK ERSTELLEN / ERSETZEN ====================
function createCustomLink(label, url, iconUrl) {
    const link = document.createElement('a');
    link.setAttribute('is', 'emby-linkbutton');
    link.className = 'button-link button-link-color-inherit button-link-fontweight-inherit emby-button button-hoverable';
    Object.assign(link, { href: url, target: '_blank', rel: 'noopener noreferrer', title: label });
    link.setAttribute(PROCESSED, 'true');
    link.setAttribute(CUSTOM_LINK, label);        // ← FIX: Marker für Erkennung
    link.appendChild(createLogoImg(iconUrl, label));
    styleLinkElement(link);
    return link;
}

function replaceWithLogo(el, config) {
    if (el.hasAttribute(PROCESSED)) return;
    el.textContent = '';
    el.appendChild(createLogoImg(config.logo, config.label, config.height));
    styleLinkElement(el);
    el.setAttribute(PROCESSED, 'true');
}

// ==================== CUSTOM LINKS (RT + ARR) ====================
// FIX: Komplett überarbeitet — keine vorzeitige Markierung, frische DOM-Abfragen
async function addCustomLinks(itemId) {
    if (isProcessing && currentItemId === itemId) return false;
    currentItemId = itemId;
    isProcessing = true;

    try {
        const item = await getEmbyItem(itemId);
        if (!item) return false;                   // ← FIX: kein Marker → Retry möglich

        const tmdbId = getProviderId(item, 'Tmdb');
        const imdbId = getProviderId(item, 'Imdb');
        const newLinks = [];

        if (CONFIG.ENABLE_ROTTEN_TOMATOES && imdbId) {
            const slug = await getRTSlug(imdbId);
            if (slug) newLinks.push(createCustomLink('Rotten Tomatoes',
                `https://www.rottentomatoes.com/${slug}`, `${CDN}/rt.png`));
        }

        if (item.Type === 'Movie' && CONFIG.RADARR_API_KEY && tmdbId) {
            const r = await lookupRadarr(tmdbId);
            newLinks.push(createCustomLink('Radarr',
                buildArrUrl(CONFIG.RADARR_URL, r, 'movie', tmdbId), `${CDN}/radarr.png`));
        }

        if (item.Type === 'Series' && CONFIG.SONARR_API_KEY) {
            const r = await lookupSonarr(getProviderId(item, 'Tvdb'), item.Name);
            newLinks.push(createCustomLink('Sonarr',
                buildArrUrl(CONFIG.SONARR_URL, r, 'series'), `${CDN}/sonarr.png`));
        }

        // FIX 1: Prüfen ob User inzwischen navigiert hat
        if (getItemIdFromUrl() !== itemId) return false;

        // FIX 2: Container FRISCH abfragen — alte Referenz kann stale sein
        const container = freshLinkContainer();
        if (!container) return false;

        // FIX 3: Prüfen ob Custom Links bereits vorhanden (paralleler Call)
        if (container.querySelector(`[${CUSTOM_LINK}]`)) return true;

        // Links einfügen
        newLinks.forEach(l => {
            container.appendChild(document.createTextNode(' '));
            container.appendChild(l);
        });

        // FIX 4: Marker ERST NACH erfolgreichem Einfügen setzen
        container.setAttribute(CUSTOM_DONE, itemId);

        if (newLinks.length) console.log(`${LOG} ${newLinks.length} Custom-Link(s) hinzugefügt.`);
        return true;
    } catch (e) {
        console.error(`${LOG} Custom-Links:`, e);
        return false;                              // ← FIX: false → Retry wird ausgelöst
    } finally {
        isProcessing = false;
    }
}

// ==================== HAUPTVERARBEITUNG ====================
async function processLinks() {
    const view = getVisibleDetailView();
    const container = view?.querySelector('.linksSection .itemLinks');
    const links = container?.querySelectorAll('a[is="emby-linkbutton"]');
    if (!links?.length) return false;

    // Prüfen ob unverarbeitete Links bereit sind
    const unprocessed = [...links].filter(l => !l.hasAttribute(PROCESSED));
    if (unprocessed.length && unprocessed.some(l => !l.href || !l.textContent.trim())) return false;

    let count = 0;
    links.forEach(link => {
        if (link.hasAttribute(PROCESSED)) return;
        const href = link.href || '';
        for (const [domain, config] of Object.entries(LINK_LOGOS)) {
            if (href.includes(domain)) { replaceWithLogo(link, config); count++; break; }
        }
    });

    // Komma-Textknoten bereinigen
    [...container.childNodes].forEach(n => {
        if (n.nodeType === Node.TEXT_NODE && /^[,\s]*$/.test(n.textContent)) n.textContent = ' ';
    });
    container.style.cssText += 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    if (count) console.log(`${LOG} ${count} Link(s) ersetzt.`);

    // FIX: Custom Links über tatsächlichen DOM-Zustand prüfen statt View-Attribut
    const itemId = getItemIdFromUrl();
    const hasCustomLinks = container.querySelector(`[${CUSTOM_LINK}]`);
    const alreadyDone = container.getAttribute(CUSTOM_DONE) === itemId;

    if (itemId && !hasCustomLinks && !alreadyDone) {
        const success = await addCustomLinks(itemId);
        if (!success) return false;                // ← FIX: Retry auslösen bei Fehler
    }

    return true;
}

// ==================== RETRY + DEBOUNCE ====================
async function processWithRetry(attempt = 0, max = 25) {
    clearTimeout(retryTimer);
    if (!await processLinks() && attempt < max)
        retryTimer = setTimeout(() => processWithRetry(attempt + 1, max),
            Math.min(150 + attempt * 100, 1500));
}

function debouncedProcess() {
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    debounceTimer = setTimeout(() => processWithRetry(), 150);
}

// ==================== OBSERVER + URL-CHANGE ====================
new MutationObserver(mutations => {
    for (const m of mutations) {
        if (m.type === 'childList') {
            // FIX: Eigene Custom-Link-Einfügungen ignorieren
            const relevant = [...m.addedNodes].some(n =>
                n.nodeType === 1 && !n.hasAttribute?.(CUSTOM_LINK) && (
                    n.matches?.('.linksSection,.itemLinks,.view-item-item') ||
                    n.querySelector?.('.linksSection,.itemLinks,.view-item-item')
                )
            );
            if (relevant) { debouncedProcess(); return; }
        }
        if (m.type === 'attributes'
            && m.target.classList?.contains('view-item-item')
            && !m.target.classList.contains('hide')) {
            debouncedProcess(); return;
        }
    }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

// FIX: Schnellere URL-Erkennung via popstate + kürzeres Polling
let lastUrl = location.href;
function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    currentItemId = null;
    debouncedProcess();
}
window.addEventListener('popstate', onUrlChange);
setInterval(onUrlChange, 300);

debouncedProcess();
console.log(`${LOG} Initialisiert.`);
})();