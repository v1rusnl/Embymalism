/*!
 * Emby Ratings Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/Druidblack/jellyfin_ratings
 * Shows IMDb, Rotten Tomatoes, Metacritic, Trakt, Letterboxd, AniList, RogerEbert, Kinopoisk, Allociné, Oscars + Emmy + Golden Globes + BAFTA + Razzies (Wins/Nominees), Palme d'Or + Berlinale + Venice Wins
 * PERFORMANCE OPTIMIZED: Combined SPARQL query for all awards
 *
 * Fill out Confguration (line 50-90)
 * - Paste your API keys -  min. MDBList key is mandatory to get most ratings (except Allociné); if no key is used, leave the value field empty
 * - Enable the Rating providers you'd like to see
 * - For Rotten Tomatoes Badge "Verified Hot" to work automatically and Ratings for old titles with MDBList null API response + Allociné Ratings, you need a reliant CORS proxy, e.g. https://github.com/obeone/simple-cors-proxy and you need to set its base URL
 * - Set Ratings cache duration to minimize API calls and instant Rating load time when revisiting items -> default=168h (1 Week)
 *
 * Paste your modified emby.ratings.js into /system/dashboard-ui/ 
 * Add <script src="emby-ratings.js" defer></script> in index.html before </body>
 *
 * Manually delete ratings cache in Browsers DevConsole (F12):
 * Object.keys(localStorage)
 * .filter(k => k.startsWith('emby_ratings_'))
 * .forEach(k => localStorage.removeItem(k));
 * console.log('Ratings-Cache gelöscht');
 *
 * Manually delete ratings cache in Browsers DevConsole (F12) for one TMDb-ID (e.g. 1399 = Game of Thrones):
 * Object.keys(localStorage)
 * .filter(k => k.startsWith('emby_ratings_') && k.includes('1399'))
 * .forEach(k => { console.log('Lösche:', k); localStorage.removeItem(k); });
 */

if (typeof GM_xmlhttpRequest === 'undefined') {
  window.GM_xmlhttpRequest = function({ method = 'GET', url, headers = {}, data, onload, onerror }) {
    fetch(url, {
      method,
      headers,
      body: data,
      cache: 'no-store'
    })
    .then(response =>
      response.text().then(text =>
        onload({ status: response.status, responseText: text })
      )
    )
    .catch(err => {
      if (typeof onerror === 'function') onerror(err);
    });
  };
}
	
(function() {
    'use strict';

    // ══════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ══════════════════════════════════════════════════════════════════
    
    const CONFIG = {
		// ══════════════════════════════════════════════════════════════════
		// API KEYS
		// ══════════════════════════════════════════════════════════════════
		MDBLIST_API_KEY: '', // API Key from https://mdblist.com/
        TMDB_API_KEY: '', // API Key from https://www.themoviedb.org/
        KINOPOISK_API_KEY: '', // API key from https://kinopoiskapiunofficial.tech/
		
		// ══════════════════════════════════════════════════════════════════
        // INDIVIDUAL RATING PROVIDERS (true = enabled, false = disabled)
        // ══════════════════════════════════════════════════════════════════
        enableIMDb: true,
        enableTMDb: true,
        enableRottenTomatoes: true,
        enableMetacritic: true,
        enableTrakt: true,
        enableLetterboxd: true,
        enableRogerEbert: true,
        enableAllocine: true,
        enableKinopoisk: true,
        enableMyAnimeList: true,
        enableAniList: true,
        
		// ══════════════════════════════════════════════════════════════════
		// RATINGS CACHE
		// ══════════════════════════════════════════════════════════════════
        CACHE_TTL_HOURS: 168, // in hours

		// ══════════════════════════════════════════════════════════════════
		// CORS PROXY - RT und Allociné Scraping (leave empty without proxy)
		// ══════════════════════════════════════════════════════════════════        
        CORS_PROXY_URL: '' // e.g. 'https://cors.yourdomain.com/proxy/'
    };

    // ══════════════════════════════════════════════════════════════════
    // END CONFIGURATION
    // ══════════════════════════════════════════════════════════════════

    const MDBLIST_API_KEY = CONFIG.MDBLIST_API_KEY;
    const TMDB_API_KEY = CONFIG.TMDB_API_KEY;
    const KINOPOISK_API_KEY = CONFIG.KINOPOISK_API_KEY;
    const CACHE_TTL_HOURS = CONFIG.CACHE_TTL_HOURS;
    const CORS_PROXY_URL = CONFIG.CORS_PROXY_URL;

    const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
    const CACHE_PREFIX = 'emby_ratings_';

	const RatingsCache = {
		get(key) {
		  try {
			const raw = localStorage.getItem(CACHE_PREFIX + key);
			if (!raw) return null;
			const entry = JSON.parse(raw);
			if (!entry || !entry.timestamp || !entry.data) return null;
			if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
			  localStorage.removeItem(CACHE_PREFIX + key);
			  return null;
			}
			return entry.data;
		  } catch (e) {
			return null;
		  }
		},
		set(key, data) {
		  try {
			localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
			  timestamp: Date.now(),
			  data: data
			}));
		  } catch (e) {
			if (e.name === 'QuotaExceededError') {
			  this.cleanup(true);
			  try {
				localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
				  timestamp: Date.now(),
				  data: data
				}));
			  } catch (e2) { }
			}
		  }
		},
		cleanup(force = false) {
		  const keysToCheck = [];
		  for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith(CACHE_PREFIX)) keysToCheck.push(k);
		  }
		  if (force) {
			const entries = keysToCheck.map(k => {
			  try {
				const raw = localStorage.getItem(k);
				const parsed = JSON.parse(raw);
				return { key: k, timestamp: parsed?.timestamp || 0 };
			  } catch { return { key: k, timestamp: 0 }; }
			}).sort((a, b) => a.timestamp - b.timestamp);
			const deleteCount = Math.max(1, Math.floor(entries.length / 2));
			for (let i = 0; i < deleteCount; i++) localStorage.removeItem(entries[i].key);
			return;
		  }
		  let removed = 0;
		  keysToCheck.forEach(k => {
			try {
			  const raw = localStorage.getItem(k);
			  if (!raw) return;
			  const entry = JSON.parse(raw);
			  if (!entry?.timestamp || (Date.now() - entry.timestamp > CACHE_TTL_MS)) {
				localStorage.removeItem(k);
				removed++;
			  }
			} catch { localStorage.removeItem(k); removed++; }
		  });
		}
	};

    function isRatingProviderEnabled(source) {
        const key = source.toLowerCase().replace(/\s+/g, '_');
        if (key === 'imdb') return CONFIG.enableIMDb;
        if (key === 'tmdb') return CONFIG.enableTMDb;
        if (key === 'tomatoes' || key === 'tomatoes_rotten' || key === 'tomatoes_certified' ||
            key === 'audience' || key === 'audience_rotten' || key === 'rotten_ver' ||
            key.includes('popcorn'))
            return CONFIG.enableRottenTomatoes;
        if (key === 'metacritic' || key === 'metacriticms' || key === 'metacriticus' ||
            key.includes('metacritic'))
            return CONFIG.enableMetacritic;
        if (key === 'trakt' || key.includes('trakt')) return CONFIG.enableTrakt;
        if (key === 'letterboxd' || key.includes('letterboxd')) return CONFIG.enableLetterboxd;
        if (key === 'rogerebert' || key.includes('roger') || key.includes('ebert')) return CONFIG.enableRogerEbert;
        if (key === 'allocine' || key === 'allocine_critics' || key === 'allocine_audience')
            return CONFIG.enableAllocine;
        if (key === 'kinopoisk' || key.includes('kinopoisk')) return CONFIG.enableKinopoisk;
        if (key === 'myanimelist' || key.includes('myanimelist')) return CONFIG.enableMyAnimeList;
        if (key === 'anilist' || key.includes('anilist')) return CONFIG.enableAniList;
        return true;
    }

	RatingsCache.cleanup();

    // ══════════════════════════════════════════════════════════════════
    // MANUAL OVERRIDES (Fallback if RT-Scrape fails)
    // ══════════════════════════════════════════════════════════════════ 	  
	const CERTIFIED_FRESH_OVERRIDES = [
	    // '550',      // Fight Club
	];
	  
	const VERIFIED_HOT_OVERRIDES = [
        // Movies with a score <90, but RT verified hot nonetheless
        '812583', // Wake Up Dead Man A Knives Out Mystery
        '1272837', // 28 Years Later: The Bone Temple
        '1054867', // One Battle After Another
        '1088166', // Relay
        '1007734', // Nobody 2
        '1078605', // Weapons
        '1022787', // Elio
        '575265', // Mission: Impossible - The Final Reckoning
        '574475', // Final Destination Bloodlines
        '1197306', // A Working Man
        '784524', // Magazine Dreams
        '1084199', // Companion
        '1280672', // One of Them Days
        '1082195', // The Order
        '845781', // Red One
        '1064213', // Anora
        '1034541', // Terrifier 3
        '1112426', // Stree 2
        '1079091', // It Ends with Us
        '956842', // Fly Me to the Moon
        '823464', // Godzilla x Kong: The New Empire
        '768362', // Missing
        '614939', // Bros
        '335787', // Uncharted
        '576845', // Last Night in Soho
        '568124', // Encanto
        '340558', // Fantasmas
        '1259102', // Eternity
	];

	const LOGO = {
		imdb: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/IMDb_noframe.png',
		tmdb: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/TMDB.png',
		tomatoes: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Rotten_Tomatoes.png',
		tomatoes_rotten: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Rotten_Tomatoes_rotten.png',
		tomatoes_certified: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/rotten-tomatoes-certified.png',
		audience: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Rotten_Tomatoes_positive_audience.png',
		audience_rotten: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Rotten_Tomatoes_negative_audience.png',
		rotten_ver: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Rotten_Tomatoes_ver.png',
		metacritic: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Metacritic.png',
		metacriticms: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/metacriticms.png',
		metacriticus: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/mus2.png',
		trakt: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Trakt.png',
		letterboxd: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/letterboxd.png',
		myanimelist: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/mal.png',
		anilist: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/anilist.png',
		kinopoisk: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/kinopoisk.png',
		rogerebert: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Roger_Ebert.png',
		allocine_critics: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/allocine_crit.png',
		allocine_audience: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/allocine_user.png',
		academy: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/academyaw.png',
		emmy: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/emmy.png',
		globes: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/globes.png',
		oscars_nom: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Oscars_Nom.png',
		oscars_win: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Oscars_Win.png',
		globes_nom: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Globe_Nom.png',
		globes_win: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Globe_Win.png',
		emmy_nom: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Emmy_Nom.png',
		emmy_win: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Emmy_Win.png',
		bafta: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/bafta.png',
		bafta_nom: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/bafta_Nom.png',
		bafta_win: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/bafta_Win.png',
		razzies: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/razzie.png',
		razzies_nom: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/razzie_Nom.png',
		razzies_win: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/razzie_Win.png',
		venezia_gold: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/venezia_gold.png',
		venezia_silver: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/venezia_silver.png',
		berlinale: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/berlinalebear.png',
		cannes: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/cannes.png'
	};

	let currentImdbId = null;
	let currentTmdbData = null;

	setInterval(scanLinks, 1000);
	scanLinks();

	function findImdbIdFromPage() {
		if (currentImdbId) return currentImdbId;
		const imdbLink = document.querySelector(
		  'a[href*="imdb.com/title/tt"], a.button-link[href*="imdb.com/title/tt"], a.emby-button[href*="imdb.com/title/tt"]'
		);
		if (imdbLink) {
		  const m = imdbLink.href.match(/imdb\.com\/title\/(tt\d+)/);
		  if (m) { currentImdbId = m[1]; return m[1]; }
		}
		return null;
	}

	function setBuiltInStarsHidden(mediaInfoBar, hide) {
		if (!mediaInfoBar) return;
		const stars  = mediaInfoBar.querySelector('.starRatingContainer.mediaInfoItem');
		const critic = mediaInfoBar.querySelector('.mediaInfoItem.mediaInfoCriticRating');
		[stars, critic].forEach(el => {
		  if (!el) return;
		  if (hide) {
			if (!('origStyle' in el.dataset)) el.dataset.origStyle = el.getAttribute('style') || '';
			el.style.display = 'none';
		  } else {
			if ('origStyle' in el.dataset) { el.setAttribute('style', el.dataset.origStyle); delete el.dataset.origStyle; }
			else el.style.display = '';
		  }
		});
	}

	function isInEpisodeListView(element) {
		return !!(
		  element.closest('.listItem') || element.closest('.listItemBody') ||
		  element.closest('[data-type="Episode"]') || element.closest('.episodeContainer') ||
		  element.closest('.verticalSection-content')
		);
	}

	function findDetailAnchors(pageView) {
		if (!pageView) return null;
		const nameContainer = pageView.querySelector('.detailNameContainer');
		if (!nameContainer) return null;
		const detailText = nameContainer.closest('.detailTextContainer') || nameContainer.closest('.verticalFieldItems');
		if (!detailText) return null;
		const mediaInfoBar = detailText.querySelector('.mediaInfo.detail-mediaInfoPrimary');
		return { nameContainer, mediaInfoBar, detailText };
	}

	function insertRatingRow(pageView, type, tmdbId, episodeInfo) {
		if (!pageView) return;

		const existing = pageView.querySelector('.mdblist-rating-row');
		if (existing) existing.remove();
		const existingAwards = pageView.querySelector('.awards-combined-row');
		if (existingAwards) existingAwards.remove();

		const anchors = findDetailAnchors(pageView);
		if (!anchors) return;
		const { nameContainer, mediaInfoBar } = anchors;

		if (mediaInfoBar) setBuiltInStarsHidden(mediaInfoBar, true);

		const ratingRow = document.createElement('div');
		ratingRow.className = 'mdblist-rating-row verticalFieldItem detail-lineItem';
		ratingRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:2px;';

		const container = document.createElement('div');
		container.className = 'mdblist-rating-container';
		container.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap;';
		ratingRow.appendChild(container);

		if (mediaInfoBar && mediaInfoBar.parentNode === nameContainer.parentNode)
		  nameContainer.parentNode.insertBefore(ratingRow, mediaInfoBar);
		else
		  nameContainer.insertAdjacentElement('afterend', ratingRow);

		if (episodeInfo?.isEpisode) {
		  fetchTmdbEpisodeRating(episodeInfo.tvId, episodeInfo.season, episodeInfo.episode, container);
		  return;
		}
		if (episodeInfo?.isSeason) {
		  fetchTmdbSeasonRating(episodeInfo.tvId, episodeInfo.season, container);
		  return;
		}

		fetchMDBList(type, tmdbId, container);
	}

	function hideSecondaryRatingContainers(pageView) {
		if (!pageView) return;
		pageView.querySelectorAll('.mediaSources .mdblist-rating-container').forEach(c => {
		  c.style.display = 'none';
		});
	}

	function scanLinks() {
		document.querySelectorAll('a[href*="imdb.com/title/"], a.button-link[href*="imdb.com/title/"], a.emby-button[href*="imdb.com/title/"]').forEach(a => {
		  if (a.dataset.imdbProcessed) return;
		  a.dataset.imdbProcessed = 'true';
		  const m = a.href.match(/imdb\.com\/title\/(tt\d+)/);
		  const newImdbId = m ? m[1] : null;
		  if (newImdbId && newImdbId !== currentImdbId) currentImdbId = newImdbId;
		});

		const tmdbLinks = Array.from(document.querySelectorAll('a[href*="themoviedb.org/"], a.button-link[href*="themoviedb.org/"], a.emby-button[href*="themoviedb.org/"]'))
		  .filter(a => !a.dataset.mdblistProcessed && !isInEpisodeListView(a))
		  .sort((a, b) => {
			const s = h => /\/episode\//.test(h) ? 2 : (/\/season\//.test(h) ? 1 : 0);
			return s(a.href) - s(b.href);
		  });

		tmdbLinks.forEach(a => { a.dataset.mdblistProcessed = 'true'; processLink(a); });
	}

	function processLink(link) {
		const ep = link.href.match(/themoviedb\.org\/tv\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
		const sn = !ep && link.href.match(/themoviedb\.org\/tv\/(\d+)\/season\/(\d+)(?!\/episode)/);
		const m = link.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
		if (!m) return;

		const type   = m[1] === 'tv' ? 'show' : 'movie';
		const tmdbId = m[2];
		const episodeInfo = ep ? { isEpisode: true, tvId: ep[1], season: parseInt(ep[2], 10), episode: parseInt(ep[3], 10) }
		  : (sn ? { isSeason: true, tvId: sn[1], season: parseInt(sn[2], 10) } : null);

		currentTmdbData = { type, tmdbId, episodeInfo };

		const pageView = link.closest('.view-item-item:not(.hide)') ||
						 link.closest('[is="emby-scroller"].view-item-item:not(.hide)') ||
						 link.closest('.page:not(.hide)');
		if (!pageView) return;

		const existingRow = pageView.querySelector('.mdblist-rating-row');
		if (existingRow) {
		  const existingContainer = existingRow.querySelector('.mdblist-rating-container');
		  if (existingContainer?.dataset.tmdbId === tmdbId && existingContainer?.dataset.type === type) return;
		}

		insertRatingRow(pageView, type, tmdbId, episodeInfo);
		pageView.querySelectorAll('.mediaInfo.detail-mediaInfoPrimary').forEach(bar => {
		  if (isInEpisodeListView(bar)) return;
		  setBuiltInStarsHidden(bar, true);
		});
		hideSecondaryRatingContainers(pageView);
	}

	function appendRatingBadge(container, logoKey, altText, title, value) {
		const logoUrl = LOGO[logoKey];
		if (!logoUrl) return;
		const img = document.createElement('img');
		img.src = logoUrl; img.alt = altText; img.title = title;
		img.dataset.source = logoKey;
		img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
		container.appendChild(img);
		const span = document.createElement('span');
		span.textContent = value;
		span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
		container.appendChild(span);
	}

	function renderCachedRatings(cachedData, container) {
		if (!cachedData || !Array.isArray(cachedData.badges)) return;
		cachedData.badges.forEach(badge => {
		  appendRatingBadge(container, badge.logoKey, badge.alt, badge.title, badge.value);
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Rotten Tomatoes: Get RT Slug from Wikidata
	// ══════════════════════════════════════════════════════════════════

	function getRTSlug(imdbId) {
		return new Promise((resolve) => {
			if (!imdbId) { resolve(null); return; }
			const cacheKey = `rt_slug_${imdbId}`;
			const cached = RatingsCache.get(cacheKey);
			if (cached !== null) { resolve(cached.slug); return; }

			const sparql = `SELECT ?rtId WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P1258 ?rtId . } LIMIT 1`;
			GM_xmlhttpRequest({
				method: 'GET',
				url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
				onload(res) {
					if (res.status !== 200) { resolve(null); return; }
					let json;
					try { json = JSON.parse(res.responseText); } catch { resolve(null); return; }
					const b = json.results.bindings;
					const slug = b.length && b[0].rtId?.value ? b[0].rtId.value : null;
					RatingsCache.set(cacheKey, { slug });
					resolve(slug);
				},
				onerror: () => resolve(null)
			});
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Rotten Tomatoes: Fetch Certified Status
	// ══════════════════════════════════════════════════════════════════

	function fetchRTCertifiedStatus(imdbId, type) {
		return new Promise((resolve) => {
			if (!CONFIG.enableRottenTomatoes || !imdbId || !CORS_PROXY_URL || CORS_PROXY_URL.trim() === '') {
				resolve({ criticsCertified: null, audienceCertified: null });
				return;
			}
			const cacheKey = `rt_certified_${type}_${imdbId}`;
			const cached = RatingsCache.get(cacheKey);
			if (cached !== null) { resolve(cached); return; }

			getRTSlug(imdbId).then(slug => {
				if (!slug) {
					const result = { criticsCertified: null, audienceCertified: null };
					RatingsCache.set(cacheKey, result); resolve(result); return;
				}
				GM_xmlhttpRequest({
					method: 'GET',
					url: `${CORS_PROXY_URL}https://www.rottentomatoes.com/${slug}`,
					onload(res) {
						if (res.status !== 200) {
							const result = { criticsCertified: null, audienceCertified: null };
							RatingsCache.set(cacheKey, result); resolve(result); return;
						}
						const html = res.responseText;
						let criticsCertified = null, audienceCertified = null;
						const jsonMatch = html.match(/<script[^>]*id="media-scorecard-json"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
						if (jsonMatch) {
							try {
								const scoreData = JSON.parse(jsonMatch[1]);
								if (scoreData.criticsScore && typeof scoreData.criticsScore.certified === 'boolean')
									criticsCertified = scoreData.criticsScore.certified;
								if (scoreData.audienceScore && typeof scoreData.audienceScore.certified === 'boolean')
									audienceCertified = scoreData.audienceScore.certified;
							} catch (e) { }
						}
						const result = { criticsCertified, audienceCertified };
						RatingsCache.set(cacheKey, result); resolve(result);
					},
					onerror() {
						const result = { criticsCertified: null, audienceCertified: null };
						RatingsCache.set(cacheKey, result); resolve(result);
					}
				});
			});
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Rotten Tomatoes: Direct Scraping
	// ══════════════════════════════════════════════════════════════════

	function fetchRottenTomatoesDirectly(imdbId, type, container) {
		if (!CONFIG.enableRottenTomatoes || !imdbId || !CORS_PROXY_URL || CORS_PROXY_URL.trim() === '') return;

		const cacheKey = `rt_direct_${type}_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
			if (cached.criticsScore !== null) {
				const criticsLogo = cached.criticsScore < 60 ? 'tomatoes_rotten' : 
								   (cached.criticsCertified ? 'tomatoes_certified' : 'tomatoes');
				appendRatingBadge(container, criticsLogo, 'Rotten Tomatoes', 
					`Rotten Tomatoes: ${cached.criticsScore}%`, `${cached.criticsScore}%`);
			}
			if (cached.audienceScore !== null) {
				const audienceLogo = cached.audienceScore < 60 ? 'audience_rotten' :
									(cached.audienceCertified ? 'rotten_ver' : 'audience');
				appendRatingBadge(container, audienceLogo, 'RT Audience',
					`RT Audience: ${cached.audienceScore}%`, `${cached.audienceScore}%`);
			}
			return;
		}

		getRTSlug(imdbId).then(slug => {
			if (!slug) {
				RatingsCache.set(cacheKey, { criticsScore: null, audienceScore: null, criticsCertified: false, audienceCertified: false });
				return;
			}
			GM_xmlhttpRequest({
				method: 'GET',
				url: `${CORS_PROXY_URL}https://www.rottentomatoes.com/${slug}`,
				onload(res) {
					if (res.status !== 200) {
						RatingsCache.set(cacheKey, { criticsScore: null, audienceScore: null, criticsCertified: false, audienceCertified: false });
						return;
					}
					const html = res.responseText;
					let criticsScore = null, criticsCertified = false, audienceScore = null, audienceCertified = false;
					const jsonMatch = html.match(/<script[^>]*id="media-scorecard-json"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
					if (jsonMatch) {
						try {
							const scoreData = JSON.parse(jsonMatch[1]);
							if (scoreData.criticsScore) {
								const total = (scoreData.criticsScore.likedCount || 0) + (scoreData.criticsScore.notLikedCount || 0);
								if (total > 0) criticsScore = Math.round((scoreData.criticsScore.likedCount / total) * 100);
								criticsCertified = scoreData.criticsScore.certified === true;
							}
							if (scoreData.audienceScore) {
								const total = (scoreData.audienceScore.likedCount || 0) + (scoreData.audienceScore.notLikedCount || 0);
								if (total > 0) audienceScore = Math.round((scoreData.audienceScore.likedCount / total) * 100);
								audienceCertified = scoreData.audienceScore.certifiedFresh === 'verified_hot' || scoreData.audienceScore.certified === true;
							}
						} catch (e) { }
					}
					RatingsCache.set(cacheKey, { criticsScore, criticsCertified, audienceScore, audienceCertified });
					if (criticsScore !== null) {
						const logo = criticsScore < 60 ? 'tomatoes_rotten' : (criticsCertified ? 'tomatoes_certified' : 'tomatoes');
						appendRatingBadge(container, logo, 'Rotten Tomatoes', `Rotten Tomatoes: ${criticsScore}%`, `${criticsScore}%`);
					}
					if (audienceScore !== null) {
						const logo = audienceScore < 60 ? 'audience_rotten' : (audienceCertified ? 'rotten_ver' : 'audience');
						appendRatingBadge(container, logo, 'RT Audience', `RT Audience: ${audienceScore}%`, `${audienceScore}%`);
					}
				},
				onerror() {
					RatingsCache.set(cacheKey, { criticsScore: null, audienceScore: null, criticsCertified: false, audienceCertified: false });
				}
			});
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// TMDb Episode/Season Ratings
	// ══════════════════════════════════════════════════════════════════

	function fetchTmdbEpisodeRating(tvId, season, episode, container) {
		if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') return;
		const cacheKey = `tmdb_episode_${tvId}_s${season}_e${episode}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) { renderCachedRatings(cached, container); return; }

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`,
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); } catch { return; }
			const avg = Number(data.vote_average), cnt = Number(data.vote_count);
			if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(cnt) || cnt <= 0) return;
			const valueText = avg.toFixed(1);
			const titleText = `TMDb (Episode): ${valueText} - ${cnt} votes`;
			RatingsCache.set(cacheKey, { badges: [{ logoKey: 'tmdb', alt: 'TMDb', title: titleText, value: valueText }] });
			appendRatingBadge(container, 'tmdb', 'TMDb', titleText, valueText);
		  }
		});
	}

	function fetchTmdbSeasonRating(tvId, season, container) {
		if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') return;
		const cacheKey = `tmdb_season_${tvId}_s${season}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) { renderCachedRatings(cached, container); return; }

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: `https://api.themoviedb.org/3/tv/${tvId}/season/${season}?api_key=${TMDB_API_KEY}`,
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); } catch { return; }
			const avg = Number(data.vote_average), cnt = Number(data.vote_count);
			if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(cnt) || cnt <= 0) return;
			const valueText = avg.toFixed(1);
			const titleText = `TMDb (Season): ${valueText} - ${cnt} votes`;
			RatingsCache.set(cacheKey, { badges: [{ logoKey: 'tmdb', alt: 'TMDb', title: titleText, value: valueText }] });
			appendRatingBadge(container, 'tmdb', 'TMDb', titleText, valueText);
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// COMBINED AWARDS ROW
	// ══════════════════════════════════════════════════════════════════

	function getOrCreateAwardsRow(container) {
		const ratingRow = container.closest('.mdblist-rating-row');
		if (!ratingRow) return null;
		let awardsRow = ratingRow.parentNode.querySelector('.awards-combined-row');
		if (awardsRow) return awardsRow;

		awardsRow = document.createElement('div');
		awardsRow.className = 'awards-combined-row';
		awardsRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:0px; margin-bottom:13px;';

		['oscar-section', 'globes-section', 'emmy-section', 'bafta-section', 'razzies-section', 'berlinale-section', 'cannes-section', 'venezia-section'].forEach(cls => {
			const section = document.createElement('div');
			section.className = cls;
			section.style.cssText = 'display:none; align-items:center; margin-right:15px;';
			awardsRow.appendChild(section);
		});

		ratingRow.parentNode.insertBefore(awardsRow, ratingRow);
		return awardsRow;
	}

	function renderAwardStatues(section, logoKey, winIconKey, nomIconKey, wins, nominations, awardName) {
		section.innerHTML = '';
		const nomOnly = Math.max(0, nominations - wins);

		let titleText = `${awardName}:`;
		if (wins > 0) titleText += ` ${wins} Won`;
		if (wins > 0 && nomOnly > 0) titleText += ',';
		if (nomOnly > 0) titleText += ` ${nomOnly} Nominated`;

		const logo = document.createElement('img');
		logo.src = LOGO[logoKey]; logo.alt = awardName; logo.title = titleText;
		logo.style.cssText = 'height:1.5em; vertical-align:middle; margin-right:8px;';
		section.appendChild(logo);

		for (let i = 0; i < wins; i++) {
			const statue = document.createElement('img');
			statue.src = LOGO[winIconKey]; statue.alt = `${awardName} Win`; statue.title = `${awardName} Win`;
			statue.style.cssText = 'height:1.5em; vertical-align:middle; margin-right:1px;';
			section.appendChild(statue);
		}
		if (wins > 0 && nomOnly > 0) {
			const gap = document.createElement('span');
			gap.style.cssText = 'display:inline-block; width:5px;';
			section.appendChild(gap);
		}
		for (let i = 0; i < nomOnly; i++) {
			const statue = document.createElement('img');
			statue.src = LOGO[nomIconKey]; statue.alt = `${awardName} Nomination`; statue.title = `${awardName} Nomination`;
			statue.style.cssText = 'height:1.5em; vertical-align:middle; margin-right:1px;';
			section.appendChild(statue);
		}
		section.style.display = 'flex';
	}

	function renderFestivalBadge(section, logoKey, alt, title) {
		section.innerHTML = '';
		const logo = document.createElement('img');
		logo.src = LOGO[logoKey]; logo.alt = alt; logo.title = title;
		logo.style.cssText = 'height:1.5em; vertical-align:middle;';
		section.appendChild(logo);
		section.style.display = 'flex';
	}

	// ══════════════════════════════════════════════════════════════════
	// COMBINED AWARDS QUERY — single SPARQL request for ALL awards
	// Replaces 8 separate functions with 1 request
	// ══════════════════════════════════════════════════════════════════

	function fetchAllAwardsCombined(imdbId) {
		return new Promise((resolve) => {
			if (!imdbId) { resolve(null); return; }

			const cacheKey = `all_awards_combined_${imdbId}`;
			const cached = RatingsCache.get(cacheKey);
			if (cached !== null) { resolve(cached); return; }

			const sparql = `
				SELECT 
					?awardLabel ?nomLabel
					?isCannes ?isBerlinale ?isVeniceGold ?isVeniceSilver
				WHERE {
					?item wdt:P345 "${imdbId}" .
					
					OPTIONAL {
						?item wdt:P166 ?award .
						?award rdfs:label ?awardLabel .
						FILTER(LANG(?awardLabel) = "en")
					}
					OPTIONAL {
						?item wdt:P1411 ?nom .
						?nom rdfs:label ?nomLabel .
						FILTER(LANG(?nomLabel) = "en")
					}
					
					BIND(EXISTS { ?item wdt:P166 wd:Q179808 } AS ?isCannes)
					BIND(EXISTS { ?item wdt:P166 wd:Q154590 } AS ?isBerlinale)
					BIND(EXISTS { ?item wdt:P166 wd:Q189038 } AS ?isVeniceGold)
					BIND(EXISTS { ?item wdt:P166 wd:Q830814 } AS ?isVeniceSilver)
				}`;

			GM_xmlhttpRequest({
				method: 'GET',
				url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
				headers: {
					'Accept': 'application/sparql-results+json',
					'User-Agent': 'EmbyRatingsScript/1.0'
				},
				onload(res) {
					if (res.status !== 200) {
						RatingsCache.set(cacheKey, null);
						resolve(null);
						return;
					}
					let json;
					try { json = JSON.parse(res.responseText); }
					catch { RatingsCache.set(cacheKey, null); resolve(null); return; }

					const bindings = json.results?.bindings || [];
					const winLabels = new Set();
					const nomLabels = new Set();
					let isCannes = false, isBerlinale = false, isVeniceGold = false, isVeniceSilver = false;

					bindings.forEach(row => {
						if (row.awardLabel?.value) winLabels.add(row.awardLabel.value);
						if (row.nomLabel?.value) nomLabels.add(row.nomLabel.value);
						if (row.isCannes?.value === 'true') isCannes = true;
						if (row.isBerlinale?.value === 'true') isBerlinale = true;
						if (row.isVeniceGold?.value === 'true') isVeniceGold = true;
						if (row.isVeniceSilver?.value === 'true') isVeniceSilver = true;
					});

					function countByKeyword(labels, keywords) {
						let count = 0;
						labels.forEach(label => {
							const lower = label.toLowerCase();
							if (keywords.some(kw => lower.includes(kw))) count++;
						});
						return count;
					}

					const result = {
						oscars: {
							wins: countByKeyword(winLabels, ['academy award', 'oscar']),
							nominations: countByKeyword(nomLabels, ['academy award', 'oscar'])
						},
						emmys: {
							wins: countByKeyword(winLabels, ['emmy']),
							nominations: countByKeyword(nomLabels, ['emmy'])
						},
						globes: {
							wins: countByKeyword(winLabels, ['golden globe']),
							nominations: countByKeyword(nomLabels, ['golden globe'])
						},
						bafta: {
							wins: countByKeyword(winLabels, ['bafta']),
							nominations: countByKeyword(nomLabels, ['bafta'])
						},
						razzies: {
							wins: countByKeyword(winLabels, ['razzie', 'golden raspberry']),
							nominations: countByKeyword(nomLabels, ['razzie', 'golden raspberry'])
						},
						cannes: isCannes,
						berlinale: isBerlinale,
						venice: { gold: isVeniceGold, silver: isVeniceSilver }
					};

					console.log(`[Emby Ratings] Combined awards for ${imdbId}:`, result);
					RatingsCache.set(cacheKey, result);
					resolve(result);
				},
				onerror() {
					RatingsCache.set(cacheKey, null);
					resolve(null);
				}
			});
		});
	}

	/**
	 * Fetch all awards with single query and render them into the awards row.
	 * Replaces: fetchAcademyAwards, fetchGoldenGlobeAwards, fetchEmmyAwards,
	 *           fetchBAFTAAwards, fetchRazzieAwards, fetchBerlinaleAward,
	 *           fetchCannesAward, fetchVeneziaAward
	 */
	function fetchAndRenderAllAwards(imdbId, container) {
		if (!imdbId) return;

		fetchAllAwardsCombined(imdbId).then(awards => {
			if (!awards) return;

			const awardsRow = getOrCreateAwardsRow(container);
			if (!awardsRow) return;

			// Oscars
			if (awards.oscars.wins > 0 || awards.oscars.nominations > 0) {
				const section = awardsRow.querySelector('.oscar-section');
				if (section && section.childNodes.length === 0)
					renderAwardStatues(section, 'academy', 'oscars_win', 'oscars_nom', awards.oscars.wins, awards.oscars.nominations, 'Academy Awards');
			}

			// Golden Globes
			if (awards.globes.wins > 0 || awards.globes.nominations > 0) {
				const section = awardsRow.querySelector('.globes-section');
				if (section && section.childNodes.length === 0)
					renderAwardStatues(section, 'globes', 'globes_win', 'globes_nom', awards.globes.wins, awards.globes.nominations, 'Golden Globe Awards');
			}

			// Emmys
			if (awards.emmys.wins > 0 || awards.emmys.nominations > 0) {
				const section = awardsRow.querySelector('.emmy-section');
				if (section && section.childNodes.length === 0)
					renderAwardStatues(section, 'emmy', 'emmy_win', 'emmy_nom', awards.emmys.wins, awards.emmys.nominations, 'Emmy Awards');
			}

			// BAFTA
			if (awards.bafta.wins > 0 || awards.bafta.nominations > 0) {
				const section = awardsRow.querySelector('.bafta-section');
				if (section && section.childNodes.length === 0)
					renderAwardStatues(section, 'bafta', 'bafta_win', 'bafta_nom', awards.bafta.wins, awards.bafta.nominations, 'BAFTA Awards');
			}

			// Razzies
			if (awards.razzies.wins > 0 || awards.razzies.nominations > 0) {
				const section = awardsRow.querySelector('.razzies-section');
				if (section && section.childNodes.length === 0)
					renderAwardStatues(section, 'razzies', 'razzies_win', 'razzies_nom', awards.razzies.wins, awards.razzies.nominations, 'Razzie Awards');
			}

			// Berlinale
			if (awards.berlinale) {
				const section = awardsRow.querySelector('.berlinale-section');
				if (section && section.childNodes.length === 0)
					renderFestivalBadge(section, 'berlinale', 'Goldener Bär (Berlinale)', 'Goldener Bär – Berlinale');
			}

			// Cannes
			if (awards.cannes) {
				const section = awardsRow.querySelector('.cannes-section');
				if (section && section.childNodes.length === 0)
					renderFestivalBadge(section, 'cannes', "Palme d'Or (Cannes)", "Palme d'Or – Festival de Cannes");
			}

			// Venice
			if (awards.venice.gold || awards.venice.silver) {
				const section = awardsRow.querySelector('.venezia-section');
				if (section && section.childNodes.length === 0) {
					const isGold = awards.venice.gold;
					renderFestivalBadge(section,
						isGold ? 'venezia_gold' : 'venezia_silver',
						isGold ? "Leone d'Oro (Venice)" : 'Gran Premio della Giuria (Venice)',
						isGold ? "Leone d'Oro – Venice Film Festival" : 'Gran Premio della Giuria – Venice Film Festival'
					);
				}
			}
		}).catch(err => {
			console.warn('[Emby Ratings] Combined awards fetch error:', err);
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// MDBList Main Fetch
	// ══════════════════════════════════════════════════════════════════

	function fetchMDBList(type, tmdbId, container) {
		container.dataset.tmdbId = tmdbId;
		container.dataset.type = type;

		const cacheKey = `mdblist_${type}_${tmdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  container.dataset.originalTitle = cached.originalTitle || '';
		  container.dataset.year = cached.year || '';
		  renderCachedRatings(cached, container);

		  const imdbId = findImdbIdFromPage();
		  
		  const hasRTCached = cached.badges && cached.badges.some(b => 
			b.logoKey.includes('tomatoes') || b.logoKey.includes('audience') || b.logoKey.includes('rotten')
		  );
		  if (!hasRTCached && imdbId) fetchRottenTomatoesDirectly(imdbId, type, container);

		  if (imdbId) {
			fetchAniListRating(imdbId, container);
			// OPTIMIZED: Single combined query instead of 8 separate ones
			fetchAndRenderAllAwards(imdbId, container);
		  }

		  const title = container.dataset.originalTitle;
		  const year  = parseInt(container.dataset.year, 10);
		  if (title && year) fetchKinopoiskRating(title, year, type, container);

		  const imdbIdForAllocine = findImdbIdFromPage();
		  if (imdbIdForAllocine) fetchAllocineRatings(imdbIdForAllocine, type, container);
		  return;
		}

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); } catch { return; }

			container.dataset.originalTitle = data.original_title || data.title || '';
			container.dataset.year = data.year || '';

			const isCertifiedFreshOverride = CERTIFIED_FRESH_OVERRIDES.includes(String(tmdbId));
			const isVerifiedHotOverride = VERIFIED_HOT_OVERRIDES.includes(String(tmdbId));

			let metacriticScore = null, metacriticVotes = null;
			let tomatoesScore = null, tomatoesVotes = null;
			let audienceScore = null, audienceVotes = null;
			let hasRTFromMDBList = false;
			const badgesToCache = [];
			let criticsBadgeImg = null, criticsBadgeCacheIndex = -1;
			let audienceBadgeImg = null, audienceBadgeCacheIndex = -1;

			if (Array.isArray(data.ratings)) {
			  // First pass: collect scores
			  data.ratings.forEach(r => {
				if (r.value == null) return;
				const key = r.source.toLowerCase();
				if (key === 'metacritic') { metacriticScore = r.value; metacriticVotes = r.votes; }
				else if (key === 'tomatoes') { tomatoesScore = r.value; tomatoesVotes = r.votes; hasRTFromMDBList = true; }
				else if (key.includes('popcorn') || key.includes('audience')) { audienceScore = r.value; audienceVotes = r.votes; hasRTFromMDBList = true; }
			  });

			  // Second pass: render badges
			  data.ratings.forEach(r => {
				if (r.value == null) return;
				let key = r.source.toLowerCase().replace(/\s+/g, '_');
				if (!isRatingProviderEnabled(key)) return;

				let isCriticsBadge = false, isAudienceBadge = false;

				if (key === 'tomatoes') {
				  isCriticsBadge = true;
				  key = r.value < 60 ? 'tomatoes_rotten' :
				        (isCertifiedFreshOverride || (tomatoesScore >= 75 && tomatoesVotes >= 80)) ? 'tomatoes_certified' : 'tomatoes';
				} else if (key.includes('popcorn') || key.includes('audience')) {
				  isAudienceBadge = true;
				  key = r.value < 60 ? 'audience_rotten' :
				        (isVerifiedHotOverride || (audienceScore >= 90 && audienceVotes >= 500)) ? 'rotten_ver' : 'audience';
				} else if (key === 'metacritic') {
				  key = (metacriticScore > 81 && metacriticVotes > 14) ? 'metacriticms' : 'metacritic';
				} else if (key.includes('metacritic') && key.includes('user')) key = 'metacriticus';
				else if (key.includes('trakt')) key = 'trakt';
				else if (key.includes('letterboxd')) key = 'letterboxd';
				else if (key.includes('roger') || key.includes('ebert')) key = 'rogerebert';
				else if (key.includes('myanimelist')) key = 'myanimelist';

				const logoUrl = LOGO[key];
				if (!logoUrl) return;
				const titleText = `${r.source}: ${r.value}${r.votes ? ` (${r.votes} votes)` : ''}`;

				badgesToCache.push({ logoKey: key, alt: r.source, title: titleText, value: String(r.value) });
				appendRatingBadge(container, key, r.source, titleText, r.value);

				const allImgs = container.querySelectorAll('img[data-source]');
				const lastImg = allImgs[allImgs.length - 1];
				if (isCriticsBadge && r.value >= 60) { criticsBadgeImg = lastImg; criticsBadgeCacheIndex = badgesToCache.length - 1; }
				if (isAudienceBadge && r.value >= 60) { audienceBadgeImg = lastImg; audienceBadgeCacheIndex = badgesToCache.length - 1; }
			  });
			}

			const imdbId = findImdbIdFromPage();

			// RT FALLBACK
			if (!hasRTFromMDBList && imdbId && CONFIG.enableRottenTomatoes) {
				fetchRottenTomatoesDirectly(imdbId, type, container);
			}
			// RT UPGRADE
			else if (hasRTFromMDBList && imdbId && CONFIG.enableRottenTomatoes) {
				const needsRTScrape = (criticsBadgeImg && tomatoesScore >= 60) || (audienceBadgeImg && audienceScore >= 60);
				if (needsRTScrape) {
				  fetchRTCertifiedStatus(imdbId, type).then(rtStatus => {
					if (criticsBadgeImg && tomatoesScore >= 60 && rtStatus.criticsCertified !== null) {
					  if (rtStatus.criticsCertified === true && criticsBadgeImg.dataset.source !== 'tomatoes_certified') {
						criticsBadgeImg.src = LOGO.tomatoes_certified; criticsBadgeImg.dataset.source = 'tomatoes_certified';
						if (criticsBadgeCacheIndex >= 0) badgesToCache[criticsBadgeCacheIndex].logoKey = 'tomatoes_certified';
					  } else if (rtStatus.criticsCertified === false && criticsBadgeImg.dataset.source === 'tomatoes_certified') {
						criticsBadgeImg.src = LOGO.tomatoes; criticsBadgeImg.dataset.source = 'tomatoes';
						if (criticsBadgeCacheIndex >= 0) badgesToCache[criticsBadgeCacheIndex].logoKey = 'tomatoes';
					  }
					}
					if (audienceBadgeImg && audienceScore >= 60 && rtStatus.audienceCertified !== null) {
					  if (rtStatus.audienceCertified === true && audienceBadgeImg.dataset.source !== 'rotten_ver') {
						audienceBadgeImg.src = LOGO.rotten_ver; audienceBadgeImg.dataset.source = 'rotten_ver';
						if (audienceBadgeCacheIndex >= 0) badgesToCache[audienceBadgeCacheIndex].logoKey = 'rotten_ver';
					  } else if (rtStatus.audienceCertified === false && audienceBadgeImg.dataset.source === 'rotten_ver') {
						audienceBadgeImg.src = LOGO.audience; audienceBadgeImg.dataset.source = 'audience';
						if (audienceBadgeCacheIndex >= 0) badgesToCache[audienceBadgeCacheIndex].logoKey = 'audience';
					  }
					}
					RatingsCache.set(cacheKey, { originalTitle: data.original_title || data.title || '', year: data.year || '', badges: badgesToCache });
				  });
				} else {
				  RatingsCache.set(cacheKey, { originalTitle: data.original_title || data.title || '', year: data.year || '', badges: badgesToCache });
				}
			} else {
			  RatingsCache.set(cacheKey, { originalTitle: data.original_title || data.title || '', year: data.year || '', badges: badgesToCache });
			}

			// Supplementary ratings
			if (imdbId) {
			  fetchAniListRating(imdbId, container);
			  // OPTIMIZED: Single combined query instead of 8 separate ones
			  fetchAndRenderAllAwards(imdbId, container);
			}

			const title = container.dataset.originalTitle;
			const year = parseInt(container.dataset.year, 10);
			if (title && year) fetchKinopoiskRating(title, year, type, container);

			const imdbIdForAllocine = findImdbIdFromPage();
			if (imdbIdForAllocine) fetchAllocineRatings(imdbIdForAllocine, type, container);
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// AniList
	// ══════════════════════════════════════════════════════════════════

	function getAnilistId(imdbId, cb) {
		const cacheKey = `anilist_id_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached !== null) { cb(cached.id); return; }

		const sparql = `SELECT ?anilist WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:P8729 ?anilist . } LIMIT 1`;
		GM_xmlhttpRequest({
		  method: 'GET',
		  url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
		  onload(res) {
			if (res.status !== 200) return cb(null);
			let json;
			try { json = JSON.parse(res.responseText); } catch { return cb(null); }
			const b = json.results.bindings;
			const id = b.length && b[0].anilist?.value ? b[0].anilist.value : null;
			RatingsCache.set(cacheKey, { id });
			cb(id);
		  },
		  onerror: () => cb(null)
		});
	}

	function fetchAniListRating(imdbId, container) {
		if (!CONFIG.enableAniList) return;
		const cacheKey = `anilist_rating_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.score > 0) appendRatingBadge(container, 'anilist', 'AniList', `AniList: ${cached.score}`, cached.score);
		  return;
		}
		getAnilistId(imdbId, id => {
		  if (id) queryAniListById(id, container, imdbId);
		  else {
			const title = container.dataset.originalTitle;
			const year = parseInt(container.dataset.year, 10);
			if (title && year) queryAniListBySearch(title, year, container, imdbId);
		  }
		});
	}

	function queryAniListById(id, container, imdbId) {
		GM_xmlhttpRequest({
		  method: 'POST', url: 'https://graphql.anilist.co',
		  headers: {'Content-Type':'application/json'},
		  data: JSON.stringify({ query: `query($id:Int){Media(id:$id,type:ANIME){id meanScore}}`, variables: { id: parseInt(id, 10) } }),
		  onload(res) {
			if (res.status !== 200) return;
			let json;
			try { json = JSON.parse(res.responseText); } catch { return; }
			const m = json.data?.Media;
			if (m?.meanScore > 0) {
			  if (imdbId) RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: m.id, score: m.meanScore });
			  appendRatingBadge(container, 'anilist', 'AniList', `AniList: ${m.meanScore}`, m.meanScore);
			} else if (imdbId) {
			  RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: null, score: 0 });
			}
		  }
		});
	}

	function queryAniListBySearch(title, year, container, imdbId) {
		GM_xmlhttpRequest({
		  method: 'POST', url: 'https://graphql.anilist.co',
		  headers: {'Content-Type':'application/json'},
		  data: JSON.stringify({
			query: `query($search:String,$startDate:FuzzyDateInt,$endDate:FuzzyDateInt){Media(search:$search,type:ANIME,startDate_greater:$startDate,startDate_lesser:$endDate){id meanScore title{romaji english native} startDate{year}}}`,
			variables: { search: title, startDate: parseInt(`${year}0101`, 10), endDate: parseInt(`${year+1}0101`, 10) }
		  }),
		  onload(res) {
			if (res.status !== 200) return;
			let json;
			try { json = JSON.parse(res.responseText); } catch { return; }
			const m = json.data?.Media;
			if (m?.meanScore > 0 && m.startDate?.year === year) {
			  const norm = s => s.toLowerCase().trim();
			  const titles = [m.title.romaji, m.title.english, m.title.native].filter(Boolean).map(norm);
			  if (titles.includes(norm(title))) {
				if (imdbId) RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: m.id, score: m.meanScore });
				appendRatingBadge(container, 'anilist', 'AniList', `AniList: ${m.meanScore}`, m.meanScore);
				return;
			  }
			}
			if (imdbId) RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: null, score: 0 });
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Kinopoisk
	// ══════════════════════════════════════════════════════════════════

	function fetchKinopoiskRating(title, year, type, container) {
		if (!CONFIG.enableKinopoisk || !KINOPOISK_API_KEY || KINOPOISK_API_KEY === 'DEIN_KEY_HIER') return;

		const cacheKey = `kinopoisk_${type}_${title}_${year}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.rating != null)
			appendRatingBadge(container, 'kinopoisk', 'Kinopoisk', `Kinopoisk: ${cached.rating}`, cached.rating);
		  return;
		}

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: `https://kinopoiskapiunofficial.tech/api/v2.2/films?keyword=${encodeURIComponent(title)}&yearFrom=${year}&yearTo=${year}`,
		  headers: { 'X-API-KEY': KINOPOISK_API_KEY, 'Content-Type': 'application/json' },
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); } catch { return; }
			const list = data.items || data.films || [];
			if (!list.length) { RatingsCache.set(cacheKey, { rating: null }); return; }
			const desired = type === 'show' ? 'TV_SERIES' : 'FILM';
			const item = list.find(i => i.type === desired) || list[0];
			if (item.ratingKinopoisk == null) { RatingsCache.set(cacheKey, { rating: null }); return; }

			RatingsCache.set(cacheKey, { rating: item.ratingKinopoisk });
			appendRatingBadge(container, 'kinopoisk', 'Kinopoisk', `Kinopoisk: ${item.ratingKinopoisk}`, item.ratingKinopoisk);
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Allociné
	// ══════════════════════════════════════════════════════════════════

	function getAllocineId(imdbId, type) {
		return new Promise((resolve) => {
		  if (!imdbId) { resolve(null); return; }
		  const cacheKey = `allocine_id_${type}_${imdbId}`;
		  const cached = RatingsCache.get(cacheKey);
		  if (cached !== null) { resolve(cached.id); return; }

		  const prop = type === 'show' ? 'P1267' : 'P1265';
		  const sparql = `SELECT ?allocine WHERE { ?item wdt:P345 "${imdbId}" . ?item wdt:${prop} ?allocine . } LIMIT 1`;
		  GM_xmlhttpRequest({
			method: 'GET',
			url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
			onload(res) {
			  if (res.status !== 200) { resolve(null); return; }
			  let json;
			  try { json = JSON.parse(res.responseText); } catch { resolve(null); return; }
			  const b = json.results.bindings;
			  const id = b.length && b[0].allocine?.value ? b[0].allocine.value : null;
			  RatingsCache.set(cacheKey, { id });
			  resolve(id);
			},
			onerror: () => resolve(null)
		  });
		});
	}

	function fetchAllocineRatings(imdbId, type, container) {
		if (!CONFIG.enableAllocine || !imdbId || !CORS_PROXY_URL || CORS_PROXY_URL.trim() === '') return;

		const cacheKey = `allocine_ratings_${type}_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.pressScore)
			appendRatingBadge(container, 'allocine_critics', 'Allociné Presse', `Allociné Presse: ${cached.pressScore} / 5`, cached.pressScore);
		  if (cached.audienceScore)
			appendRatingBadge(container, 'allocine_audience', 'Allociné Spectateurs', `Allociné Spectateurs: ${cached.audienceScore} / 5`, cached.audienceScore);
		  return;
		}

		getAllocineId(imdbId, type).then(allocineId => {
		  if (!allocineId) { RatingsCache.set(cacheKey, { pressScore: null, audienceScore: null }); return; }

		  const pathSegment = type === 'show' ? 'series' : 'film';
		  const fileSegment = type === 'show' ? `ficheserie_gen_cserie=${allocineId}` : `fichefilm_gen_cfilm=${allocineId}`;

		  GM_xmlhttpRequest({
			method: 'GET',
			url: `${CORS_PROXY_URL}https://www.allocine.fr/${pathSegment}/${fileSegment}.html`,
			onload(res) {
			  if (res.status !== 200) return;
			  const html = res.responseText;
			  const foundRatings = [];

			  const ratingPattern = /class="stareval-note"[^>]*>\s*([\d][,.][\d])\s*<\/span>/g;
			  let match;
			  while ((match = ratingPattern.exec(html)) !== null) {
				const val = parseFloat(match[1].replace(',', '.'));
				if (val > 0 && val <= 5) foundRatings.push(val);
			  }

			  if (foundRatings.length === 0) {
				const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
				if (jsonLdMatch) {
				  for (const block of jsonLdMatch) {
					try {
					  const jsonStr = block.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
					  const jsonData = JSON.parse(jsonStr);
					  if (jsonData.aggregateRating) {
						const rv = parseFloat(jsonData.aggregateRating.ratingValue);
						if (rv > 0 && rv <= 5) foundRatings.push(rv);
					  }
					} catch (e) { }
				  }
				}
			  }

			  if (foundRatings.length === 0) {
				RatingsCache.set(cacheKey, { pressScore: null, audienceScore: null });
				return;
			  }

			  const pressScore = foundRatings[0] ? foundRatings[0].toFixed(1) : null;
			  const audienceScoreVal = foundRatings[1] ? foundRatings[1].toFixed(1) : null;

			  RatingsCache.set(cacheKey, { pressScore, audienceScore: audienceScoreVal });

			  if (pressScore)
				appendRatingBadge(container, 'allocine_critics', 'Allociné Presse', `Allociné Presse: ${pressScore} / 5`, pressScore);
			  if (audienceScoreVal)
				appendRatingBadge(container, 'allocine_audience', 'Allociné Spectateurs', `Allociné Spectateurs: ${audienceScoreVal} / 5`, audienceScoreVal);
			}
		  });
		});
	}

})();