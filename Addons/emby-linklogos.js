/*!
* Emby Link Logos Integration (mit Radarr/Sonarr + Rotten Tomatoes)
* Replaces text links (IMDb, TheMovieDb, Trakt, TheTVDB) with logo icons
* Adds Rotten Tomatoes link via Wikidata SPARQL lookup
* Adds Radarr/Sonarr links directly to the links section
*
* Architecture: Data fetching is fully decoupled from DOM insertion.
* A watchdog timer ensures links survive re-renders by other scripts.
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
const CUSTOM_LINK = 'data-custom-link';

const LINK_LOGOS = {
    'imdb.com':       { logo: `${CDN}/IMDb_noframe.png`, label: 'IMDb',    height: '20px' },
    'themoviedb.org': { logo: `${CDN}/TMDB.png`,         label: 'TMDB',    height: '25px' },
    'trakt.tv':       { logo: `${CDN}/Trakt.png`,        label: 'Trakt',   height: '25px' },
    'thetvdb.com':    { logo: `${CDN}/tvdb.png`,         label: 'TheTVDB', height: '25px' },
};

// ==================== STATE ====================
const apiCache   = { radarr: new Map(), sonarr: new Map(), rt: new Map() };
const linksData  = new Map();   // itemId → [{label,url,icon}] (successfully fetched)
const pending    = new Map();   // itemId → Promise (in-flight fetch)
let debounceTimer  = null;
let watchdogTimer  = null;
let isProcessing   = false;

// ==================== HELPERS ====================
function getItemId() {
    const m = location.href.match(/[?&]id=(\d+)/);
    return m ? m[1] : null;
}

function getApi() {
    return (typeof ApiClient !== 'undefined' && ApiClient) || window.ApiClient || null;
}

async function getItem(itemId) {
    const api = getApi();
    if (!api) return null;
    try { return await api.getItem(api.getCurrentUserId(), itemId); }
    catch { return null; }
}

function pid(item, key) {
    return item?.ProviderIds?.[key] || item?.ProviderIds?.[key.toLowerCase()] || null;
}

// Always query DOM fresh — never hold stale references across async boundaries
function getContainer() {
    const view = document.querySelector('.view-item-item:not(.hide)');
    return view?.querySelector('.linksSection .itemLinks') || null;
}

// ==================== UI HELPERS ====================
function mkImg(src, label, h = '22px') {
    const img = document.createElement('img');
    Object.assign(img, { src, alt: label, title: label, draggable: false });
    img.style.cssText = `height:${h};width:auto;object-fit:contain;vertical-align:middle;opacity:.85;transition:opacity .2s`;
    img.onmouseenter = () => (img.style.opacity = '1');
    img.onmouseleave = () => (img.style.opacity = '.85');
    return img;
}

function styleLink(el) {
    el.style.cssText += 'display:inline-flex;align-items:center;padding:2px 0';
}

function replaceWithLogo(el, cfg) {
    el.textContent = '';
    el.appendChild(mkImg(cfg.logo, cfg.label, cfg.height));
    styleLink(el);
    el.setAttribute(PROCESSED, '1');
}

function mkCustomLink(label, url, icon) {
    const a = document.createElement('a');
    a.setAttribute('is', 'emby-linkbutton');
    a.className = 'button-link button-link-color-inherit button-link-fontweight-inherit emby-button button-hoverable';
    Object.assign(a, { href: url, target: '_blank', rel: 'noopener noreferrer', title: label });
    a.setAttribute(PROCESSED, '1');
    a.setAttribute(CUSTOM_LINK, label);
    a.appendChild(mkImg(icon, label));
    styleLink(a);
    return a;
}

function tidyContainer(c) {
    [...c.childNodes].forEach(n => {
        if (n.nodeType === 3 && /^[,\s]*$/.test(n.textContent)) n.textContent = ' ';
    });
    c.style.cssText += 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
}

// ==================== API: Rotten Tomatoes ====================
async function getRTSlug(imdbId) {
    if (!imdbId) return null;
    if (apiCache.rt.has(imdbId)) return apiCache.rt.get(imdbId);
    try {
        const q = `SELECT ?rtId WHERE { ?i wdt:P345 "${imdbId}". ?i wdt:P1258 ?rtId. } LIMIT 1`;
        const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
        if (!r.ok) { apiCache.rt.set(imdbId, null); return null; }
        const slug = (await r.json()).results.bindings[0]?.rtId?.value || null;
        apiCache.rt.set(imdbId, slug);
        return slug;
    } catch { apiCache.rt.set(imdbId, null); return null; }
}

// ==================== API: Radarr / Sonarr ====================
async function fetchJson(url, key) {
    const r = await fetch(url, { headers: { 'X-Api-Key': key } });
    return r.ok ? r.json() : null;
}

async function lookupRadarr(tmdbId) {
    if (apiCache.radarr.has(tmdbId)) return apiCache.radarr.get(tmdbId);
    try {
        const m = await fetchJson(`${CONFIG.RADARR_URL}/api/v3/movie?tmdbId=${tmdbId}`, CONFIG.RADARR_API_KEY);
        if (m?.length) { const r = { found: true, slug: m[0].titleSlug, tmdbId }; apiCache.radarr.set(tmdbId, r); return r; }
        const l = await fetchJson(`${CONFIG.RADARR_URL}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`, CONFIG.RADARR_API_KEY);
        const r = { found: false, slug: l?.titleSlug || null, tmdbId };
        apiCache.radarr.set(tmdbId, r); return r;
    } catch { return { found: false, slug: null, tmdbId }; }
}

async function lookupSonarr(tvdbId, name) {
    const key = tvdbId || name;
    if (apiCache.sonarr.has(key)) return apiCache.sonarr.get(key);
    try {
        if (tvdbId) {
            const s = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series?tvdbId=${tvdbId}`, CONFIG.SONARR_API_KEY);
            if (s?.length) { const r = { found: true, slug: s[0].titleSlug }; apiCache.sonarr.set(key, r); return r; }
            const l = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=tvdb:${tvdbId}`, CONFIG.SONARR_API_KEY);
            if (l?.length) { const r = { found: false, slug: l[0].titleSlug }; apiCache.sonarr.set(key, r); return r; }
        }
        if (name) {
            const l = await fetchJson(`${CONFIG.SONARR_URL}/api/v3/series/lookup?term=${encodeURIComponent(name)}`, CONFIG.SONARR_API_KEY);
            if (l?.length) {
                const e = l.find(s => s.id > 0);
                const r = e ? { found: true, slug: e.titleSlug } : { found: false, slug: l[0].titleSlug };
                apiCache.sonarr.set(key, r); return r;
            }
        }
        const r = { found: false, slug: null }; apiCache.sonarr.set(key, r); return r;
    } catch { return { found: false, slug: null }; }
}

function arrUrl(base, r, prefix, tmdbId) {
    if (r.found && r.slug) return `${base}/${prefix}/${r.slug}`;
    if (r.slug) return `${base}/add/new?term=${r.slug}`;
    return tmdbId ? `${base}/add/new?term=tmdb:${tmdbId}` : base;
}

// ==================================================================
// DATA LAYER — fully decoupled from DOM
// Fetches once, caches forever, deduplicates concurrent requests
// ==================================================================
async function fetchItemLinks(itemId) {
    const item = await getItem(itemId);
    if (!item) return null;                         // null = retry later

    const tmdb = pid(item, 'Tmdb'), imdb = pid(item, 'Imdb');
    const out = [];

    if (CONFIG.ENABLE_ROTTEN_TOMATOES && imdb) {
        const s = await getRTSlug(imdb);
        if (s) out.push({ label: 'Rotten Tomatoes', url: `https://www.rottentomatoes.com/${s}`, icon: `${CDN}/rt.png` });
    }
    if (item.Type === 'Movie' && CONFIG.RADARR_API_KEY && tmdb) {
        const r = await lookupRadarr(tmdb);
        out.push({ label: 'Radarr', url: arrUrl(CONFIG.RADARR_URL, r, 'movie', tmdb), icon: `${CDN}/radarr.png` });
    }
    if (item.Type === 'Series' && CONFIG.SONARR_API_KEY) {
        const r = await lookupSonarr(pid(item, 'Tvdb'), item.Name);
        out.push({ label: 'Sonarr', url: arrUrl(CONFIG.SONARR_URL, r, 'series'), icon: `${CDN}/sonarr.png` });
    }
    return out;                                     // [] = valid, no links needed
}

// Returns cached data, waits for in-flight fetch, or starts new fetch
async function getItemLinks(itemId) {
    if (linksData.has(itemId)) return linksData.get(itemId);
    if (pending.has(itemId))   return pending.get(itemId);

    const p = fetchItemLinks(itemId).then(data => {
        pending.delete(itemId);
        if (data !== null) linksData.set(itemId, data);  // only cache success
        return data;
    }).catch(e => {
        pending.delete(itemId);
        console.error(LOG, e);
        return null;
    });
    pending.set(itemId, p);
    return p;
}

// Fire-and-forget: start fetching in background as early as possible
function prefetch(itemId) {
    if (itemId && !linksData.has(itemId) && !pending.has(itemId))
        getItemLinks(itemId);
}

// ==================================================================
// DOM PROCESSING — fast, idempotent, safe to call repeatedly
// ==================================================================
async function processPage() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const itemId = getItemId();
        if (!itemId) return;

        // ── Step 1: Replace native link text with logo images ──
        const c1 = getContainer();
        if (!c1) return;

        const raw = [...c1.querySelectorAll(
            `a[is="emby-linkbutton"]:not([${PROCESSED}]):not([${CUSTOM_LINK}])`
        )];
        if (raw.length) {
            // Abort if any native link isn't fully rendered yet (Emby still populating)
            if (raw.some(l => !l.href || !l.textContent.trim())) return;

            let n = 0;
            raw.forEach(link => {
                for (const [dom, cfg] of Object.entries(LINK_LOGOS))
                    if ((link.href || '').includes(dom)) { replaceWithLogo(link, cfg); n++; break; }
            });
            if (n) { tidyContainer(c1); console.log(`${LOG} ${n} logo(s) replaced`); }
        }

        // ── Step 2: Insert custom links (RT, Radarr, Sonarr) ──
        // Already present in DOM? → done
        if (c1.querySelector(`[${CUSTOM_LINK}]`)) return;

        // Get data (instant from cache after first load)
        const data = await getItemLinks(itemId);

        // Guard: user navigated away during async fetch?
        if (getItemId() !== itemId) return;

        // CRITICAL: get a FRESH container reference — the old one may be detached
        const c2 = getContainer();
        if (!c2) return;

        // Double-check: another call may have inserted while we awaited
        if (c2.querySelector(`[${CUSTOM_LINK}]`)) return;

        if (data?.length) {
            data.forEach(d => {
                c2.appendChild(document.createTextNode(' '));
                c2.appendChild(mkCustomLink(d.label, d.url, d.icon));
            });
            tidyContainer(c2);
            console.log(`${LOG} ${data.length} custom link(s) added`);
        }
    } finally {
        isProcessing = false;
    }
}

// ==================================================================
// WATCHDOG — periodic check that our links survive re-renders
// Runs for up to 30 s after navigation, stops early when stable
// ==================================================================
function startWatchdog() {
    stopWatchdog();
    let ticks = 0, stableTicks = 0;

    watchdogTimer = setInterval(async () => {
        ticks++;
        const id = getItemId();
        if (!id) { stopWatchdog(); return; }

        const c = getContainer();

        // Determine if work is needed
        const needsLogos = !!c?.querySelector(
            `a[is="emby-linkbutton"]:not([${PROCESSED}]):not([${CUSTOM_LINK}])`
        );
        const hasCustom = !!c?.querySelector(`[${CUSTOM_LINK}]`);
        const cached    = linksData.get(id);
        // Custom links are "done" if present OR if cache says none are needed
        const customOk  = hasCustom || (Array.isArray(cached) && cached.length === 0);

        if (needsLogos || (c && !customOk)) {
            stableTicks = 0;
            await processPage();
        } else if (c) {
            stableTicks++;
        }

        // Stop when stable for 5 s (10 ticks) AND data is cached, OR hard timeout
        if ((stableTicks >= 10 && linksData.has(id)) || ticks >= 60) {
            stopWatchdog();
        }
    }, 500);
}

function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

// ==================================================================
// TRIGGER — debounced entry point, starts prefetch + processing + watchdog
// ==================================================================
function trigger() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        const id = getItemId();
        if (id) prefetch(id);          // start data fetch immediately
        await processPage();
        startWatchdog();               // ensure persistence
    }, 150);
}

// ==================================================================
// EVENT LISTENERS — multiple redundant triggers for maximum reliability
// ==================================================================

// 1) MutationObserver — catches DOM changes by Emby and other scripts
new MutationObserver(mutations => {
    for (const m of mutations) {
        if (m.type === 'childList') {
            // Ignore mutations caused purely by our own custom-link insertions
            const onlyOurs = [...m.addedNodes].every(n =>
                n.nodeType !== 1 || n.hasAttribute?.(CUSTOM_LINK)
            );
            if (onlyOurs && m.removedNodes.length === 0) continue;

            // Relevant: new view / section appeared, or itemLinks content changed
            const relevant =
                m.target.matches?.('.itemLinks') ||
                [...m.addedNodes].some(n => n.nodeType === 1 && (
                    n.matches?.('.linksSection,.itemLinks,.view-item-item') ||
                    n.querySelector?.('.linksSection,.itemLinks,.view-item-item')
                ));
            if (relevant) { trigger(); return; }
        }
        if (m.type === 'attributes'
            && m.target.classList?.contains('view-item-item')
            && !m.target.classList.contains('hide')) {
            trigger(); return;
        }
    }
}).observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['class']
});

// 2) Emby's own view lifecycle event (most reliable for SPA navigation)
document.addEventListener('viewshow', e => {
    if (getItemId()) trigger();
});

// 3) URL change detection (popstate + polling as fallback)
let lastUrl = location.href;
function checkUrl() {
    if (location.href !== lastUrl) { lastUrl = location.href; trigger(); }
}
window.addEventListener('popstate', checkUrl);
setInterval(checkUrl, 300);

// 4) Initial run
trigger();
console.log(`${LOG} Initialized`);

})();