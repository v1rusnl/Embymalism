/*!
* Emby Link Logos Integration (mit Radarr/Sonarr + Rotten Tomatoes)
* Replaces text links (IMDb, TheMovieDb, Trakt, TheTVDB) with logo icons in Emby detail pages
* Adds Rotten Tomatoes link via Wikidata SPARQL lookup
* Adds Radarr/Sonarr links directly to the links section -> Set up your API keys and URLs in the Config at the top of the script
* Copy script inside /system/dashboard-ui/ and add <script src="emby-linklogos.js" defer></script> in index.html before </body>
*/  
(function () {
'use strict';  

// ==================== KONFIGURATION ====================
const CONFIG = {
    // Radarr Einstellungen
    RADARR_URL: '',
    RADARR_API_KEY: '',
    
    // Sonarr Einstellungen
    SONARR_URL: '',
    SONARR_API_KEY: '',
    
    // Rotten Tomatoes aktivieren
    ENABLE_ROTTEN_TOMATOES: true,
};
// ========================================================

const LOG_PREFIX = '🔗 Emby Link Logos:';  

const LINK_LOGOS = {
    'imdb': {
        match: (href) => href.includes('imdb.com'),
        logo: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/IMDb_noframe.png',
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
const ARR_PROCESSED_ATTR = 'data-arr-processed';

let debounceTimer = null;
let retryTimer = null;
let currentItemId = null;

// Cache für Arr-Lookups und RT Slugs
const radarrCache = new Map();
const sonarrCache = new Map();
const rtSlugCache = new Map();

// ==================== HELPER FUNKTIONEN ====================

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

function getVisibleDetailView() {
    const allViews = document.querySelectorAll('.view-item-item');
    for (const view of allViews) {
        if (!view.classList.contains('hide')) {
            return view;
        }
    }
    return null;
}

function getTmdbId(item) {
    if (item?.ProviderIds?.Tmdb) return item.ProviderIds.Tmdb;
    if (item?.ProviderIds?.tmdb) return item.ProviderIds.tmdb;
    return null;
}

function getTvdbId(item) {
    if (item?.ProviderIds?.Tvdb) return item.ProviderIds.Tvdb;
    if (item?.ProviderIds?.tvdb) return item.ProviderIds.tvdb;
    return null;
}

function getImdbId(item) {
    if (item?.ProviderIds?.Imdb) return item.ProviderIds.Imdb;
    if (item?.ProviderIds?.imdb) return item.ProviderIds.imdb;
    return null;
}

// ==================== ROTTEN TOMATOES WIKIDATA LOOKUP ====================

async function getRTSlug(imdbId) {
    if (!imdbId) return null;
    if (rtSlugCache.has(imdbId)) return rtSlugCache.get(imdbId);
    
    try {
        const sparql = `SELECT ?rtId WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtId . } LIMIT 1`;
        const response = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql));
        
        if (!response.ok) {
            rtSlugCache.set(imdbId, null);
            return null;
        }
        
        const json = await response.json();
        const bindings = json.results.bindings;
        const slug = bindings.length && bindings[0].rtId?.value ? bindings[0].rtId.value : null;
        
        rtSlugCache.set(imdbId, slug);
        return slug;
    } catch (err) {
        console.error(`${LOG_PREFIX} Wikidata RT Lookup Fehler:`, err);
        rtSlugCache.set(imdbId, null);
        return null;
    }
}

// ==================== RADARR/SONARR LOOKUP ====================

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

// ==================== LINK LOGO REPLACEMENT ====================

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

function createCustomLink(label, url, iconUrl) {
    const link = document.createElement('a');
    link.setAttribute('is', 'emby-linkbutton');
    link.className = 'button-link button-link-color-inherit button-link-fontweight-inherit emby-button button-hoverable';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = label;
    link.setAttribute(PROCESSED_ATTR, 'true');
    
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = label;
    img.title = label;
    img.draggable = false;
    img.style.cssText = `
        height: 22px;
        width: auto;
        object-fit: contain;
        vertical-align: middle;
        opacity: 0.85;
        transition: opacity 0.2s ease;
    `;
    
    img.addEventListener('mouseenter', () => { img.style.opacity = '1'; });
    img.addEventListener('mouseleave', () => { img.style.opacity = '0.85'; });
    
    link.appendChild(img);
    
    link.style.cssText += `
        display: inline-flex;
        align-items: center;
        padding: 2px 0px;
    `;
    
    return link;
}

function areLinksReady(links) {
    if (links.length === 0) return false;  
    
    for (const link of links) {
        if (link.hasAttribute(PROCESSED_ATTR)) continue;  
        
        const href = link.href || '';
        const text = link.textContent.trim();  
        
        if (!href || !text) return false;
    }
    return true;
}

// ==================== RT + ARR LINKS HINZUFÜGEN ====================

async function addCustomLinks(linkContainer, visibleView) {
    // Prüfen ob bereits Custom-Links hinzugefügt wurden
    if (visibleView.hasAttribute(ARR_PROCESSED_ATTR)) {
        const processedItemId = visibleView.getAttribute(ARR_PROCESSED_ATTR);
        if (processedItemId === currentItemId) {
            return;
        }
    }
    
    const itemId = getItemIdFromUrl();
    if (!itemId) return;
    
    currentItemId = itemId;
    
    const item = await getEmbyItem(itemId);
    if (!item) return;
    
    console.log(`${LOG_PREFIX} Item: "${item.Name}" (Type: ${item.Type}, ID: ${itemId})`);
    
    const tmdbId = getTmdbId(item);
    const imdbId = getImdbId(item);
    const customLinks = [];
    
    // 1. Rotten Tomatoes Link (falls aktiviert und IMDb ID vorhanden)
    if (CONFIG.ENABLE_ROTTEN_TOMATOES && imdbId) {
        const rtSlug = await getRTSlug(imdbId);
        if (rtSlug) {
            const rtUrl = `https://www.rottentomatoes.com/${rtSlug}`;
            const rtIcon = 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/rt.png';
            customLinks.push(createCustomLink('Rotten Tomatoes', rtUrl, rtIcon));
            console.log(`${LOG_PREFIX} RT-Link hinzugefügt: ${rtUrl}`);
        } else {
            console.log(`${LOG_PREFIX} Kein RT Slug gefunden für IMDb: ${imdbId}`);
        }
    }
    
    // 2. Radarr Link (nur für Movies)
    if (item.Type === 'Movie' && CONFIG.RADARR_API_KEY && tmdbId) {
        const radarrResult = await lookupRadarr(tmdbId);
        const radarrUrl = buildRadarrUrl(radarrResult);
        const radarrIcon = 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/radarr.png';
        customLinks.push(createCustomLink('Radarr', radarrUrl, radarrIcon));
        console.log(`${LOG_PREFIX} Radarr-Link hinzugefügt: ${radarrUrl}`);
    }
    
    // 3. Sonarr Link (nur für Series)
    if (item.Type === 'Series' && CONFIG.SONARR_API_KEY) {
        const tvdbId = getTvdbId(item);
        const sonarrResult = await lookupSonarr(tvdbId, item.Name);
        const sonarrUrl = buildSonarrUrl(sonarrResult);
        const sonarrIcon = 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/sonarr.png';
        customLinks.push(createCustomLink('Sonarr', sonarrUrl, sonarrIcon));
        console.log(`${LOG_PREFIX} Sonarr-Link hinzugefügt: ${sonarrUrl} (found: ${sonarrResult.found})`);
    }
    
    // Custom-Links zum Container hinzufügen
    if (customLinks.length > 0) {
        customLinks.forEach(link => {
            linkContainer.appendChild(document.createTextNode(' '));
            linkContainer.appendChild(link);
        });
        
        visibleView.setAttribute(ARR_PROCESSED_ATTR, itemId);
        console.log(`${LOG_PREFIX} ${customLinks.length} Custom-Link(s) hinzugefügt.`);
    }
}

// ==================== HAUPTVERARBEITUNG ====================

async function processLinks() {
    const visibleView = getVisibleDetailView();
    if (!visibleView) return false;  
    
    const linksSection = visibleView.querySelector('.linksSection');
    if (!linksSection) return false;  
    
    const linkContainer = linksSection.querySelector('.itemLinks');
    if (!linkContainer) return false;  
    
    const links = linkContainer.querySelectorAll('a[is="emby-linkbutton"]');
    if (links.length === 0) return false;  
    
    const unprocessedLinks = Array.from(links).filter(
        l => !l.hasAttribute(PROCESSED_ATTR) || l.hasAttribute(ARR_PROCESSED_ATTR)
    );  
    
    if (!areLinksReady(links) && unprocessedLinks.length > 0) {
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
    
    if (processedCount > 0 || !visibleView.hasAttribute(ARR_PROCESSED_ATTR)) {
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
        
        if (processedCount > 0) {
            console.log(`${LOG_PREFIX} Replaced ${processedCount} link(s) with logos.`);
        }
        
        // Custom-Links hinzufügen (RT + Radarr/Sonarr)
        await addCustomLinks(linkContainer, visibleView);
    }  
    
    return true;
}

// ==================== RETRY LOGIK ====================

async function processWithRetry(attempt = 0, maxAttempts = 15) {
    if (retryTimer) clearTimeout(retryTimer);  
    
    const success = await processLinks();  
    
    if (!success && attempt < maxAttempts) {
        const delay = Math.min(200 + (attempt * 100), 1500);
        retryTimer = setTimeout(() => {
            processWithRetry(attempt + 1, maxAttempts);
        }, delay);
    } else if (!success) {
        console.log(`${LOG_PREFIX} Gave up after ${maxAttempts} attempts.`);
    }
}

function debouncedProcess() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);  
    
    debounceTimer = setTimeout(() => {
        processWithRetry(0);
    }, 200);
}

// ==================== MUTATION OBSERVER ====================

const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;  
    
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;  
                
                if (
                    node.classList?.contains('linksSection') ||
                    node.classList?.contains('itemLinks') ||
                    node.querySelector?.('.linksSection') ||
                    node.querySelector?.('.itemLinks')
                ) {
                    shouldProcess = true;
                    break;
                }  
                
                if (
                    node.classList?.contains('view-item-item') ||
                    node.querySelector?.('.view-item-item')
                ) {
                    shouldProcess = true;
                    break;
                }
            }
        }  
        
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

// ==================== URL-POLLING ====================

let lastUrl = window.location.href;
setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        currentItemId = null;
        console.log(`${LOG_PREFIX} URL changed, reprocessing...`);
        debouncedProcess();
    }
}, 500);

// ==================== INITIALISIERUNG ====================

debouncedProcess();  

console.log(`${LOG_PREFIX} Initialization complete (mit RT + Radarr/Sonarr Integration).`);

})();