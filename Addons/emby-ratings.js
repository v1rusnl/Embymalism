/*!
 * Emby Ratings Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/Druidblack/jellyfin_ratings
 * Shows IMDb, Rotten Tomatoes, Metacritic, Trakt, Letterboxd, AniList
 *
 * Paste your API keys into line 39-41, min. one key is mandatory
 * For Allociné to work, you need a reliant CORS proxy, e.g. https://github.com/obeone/simple-cors-proxy and you need to set its base URL in line 997
 * Set Ratings cache duration to minimize API calls in line 42 -> default=24h
 * Manual Overrides for RT can be set in line 169 ff.
 * Paste your modified emby.ratings.js into /system/dashboard-ui/ 
 * Add <script src="emby-ratings.js"></script> in index.html before </body>
 *
 * Manually delete ratings cache in Browsers DevConsole (F12):
 * Object.keys(localStorage)
 * .filter(k => k.startsWith('emby_ratings_'))
 * .forEach(k => localStorage.removeItem(k));
 * console.log('Ratings-Cache gelöscht');
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
	  
	const MDBLIST_API_KEY = 'YOUR-API-KEY';
	const TMDB_API_KEY    = 'YOUR-API-KEY';
	const KINOPOISK_API_KEY = 'YOUR-API-KEY';
	const CACHE_TTL_HOURS = 24; // Cache duration in Hours
	  
	// ══════════════════════════════════════════════════════════════════
	// CACHE KONFIGURATION
	// ══════════════════════════════════════════════════════════════════

	const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
	const CACHE_PREFIX = 'emby_ratings_';

	const RatingsCache = {
		/**
		 * Holt einen gecachten Wert. Gibt null zurück wenn nicht vorhanden oder abgelaufen.
		 * @param {string} key - Cache-Schlüssel (ohne Prefix)
		 * @returns {*|null} - Die gecachten Daten oder null
		 */
		get(key) {
		  try {
			const raw = localStorage.getItem(CACHE_PREFIX + key);
			if (!raw) return null;

			const entry = JSON.parse(raw);
			if (!entry || !entry.timestamp || !entry.data) return null;

			// Prüfe ob der Eintrag abgelaufen ist
			if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
			  localStorage.removeItem(CACHE_PREFIX + key);
			  return null;
			}

			return entry.data;
		  } catch (e) {
			console.warn('[Emby Ratings Cache] Fehler beim Lesen:', key, e);
			return null;
		  }
		},

		/**
		 * Speichert einen Wert im Cache mit aktuellem Zeitstempel.
		 * @param {string} key - Cache-Schlüssel (ohne Prefix)
		 * @param {*} data - Die zu cachenden Daten
		 */
		set(key, data) {
		  try {
			const entry = {
			  timestamp: Date.now(),
			  data: data
			};
			localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
		  } catch (e) {
			console.warn('[Emby Ratings Cache] Fehler beim Schreiben:', key, e);
			// Bei QuotaExceededError: alte Einträge bereinigen und nochmal versuchen
			if (e.name === 'QuotaExceededError') {
			  this.cleanup(true);
			  try {
				localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
				  timestamp: Date.now(),
				  data: data
				}));
			  } catch (e2) {
				console.error('[Emby Ratings Cache] Cache voll, konnte nicht schreiben:', key);
			  }
			}
		  }
		},

		/**
		 * Bereinigt abgelaufene Cache-Einträge.
		 * @param {boolean} force - Wenn true, lösche die älteste Hälfte aller Einträge
		 */
		cleanup(force = false) {
		  const keysToCheck = [];
		  for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith(CACHE_PREFIX)) {
			  keysToCheck.push(k);
			}
		  }

		  if (force) {
			// Bei Speicherplatzmangel: sortiere nach Alter, lösche älteste Hälfte
			const entries = keysToCheck.map(k => {
			  try {
				const raw = localStorage.getItem(k);
				const parsed = JSON.parse(raw);
				return { key: k, timestamp: parsed?.timestamp || 0 };
			  } catch {
				return { key: k, timestamp: 0 };
			  }
			}).sort((a, b) => a.timestamp - b.timestamp);

			const deleteCount = Math.max(1, Math.floor(entries.length / 2));
			for (let i = 0; i < deleteCount; i++) {
			  localStorage.removeItem(entries[i].key);
			}
			console.log(`[Emby Ratings Cache] Force-Cleanup: ${deleteCount} Einträge gelöscht`);
			return;
		  }

		  // Normaler Cleanup: nur abgelaufene Einträge löschen
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
			} catch {
			  localStorage.removeItem(k);
			  removed++;
			}
		  });

		  if (removed > 0) {
			console.log(`[Emby Ratings Cache] Cleanup: ${removed} abgelaufene Einträge gelöscht`);
		  }
		}
	};

	// Beim Start abgelaufene Einträge bereinigen
	RatingsCache.cleanup();
	  
	// ══════════════════════════════════════════════════════════════════
	// MANUELLE OVERRIDES: TMDb-IDs für erzwungene Badges
	// ══════════════════════════════════════════════════════════════════
	const CERTIFIED_FRESH_OVERRIDES = [
		// '550',      // Fight Club
		// '680',      // Pulp Fiction
		// '13',       // Forrest Gump
	];
	  
	const VERIFIED_HOT_OVERRIDES = [
		// Movies with a score <90, but RT verified hot nonetheless
		'812583', // Wake Up Dead Man A Knives Out Mystery
		'1272837', // 28 Years Later: The Bone Temple
		'1054867', // One Battle After Another
		'1088166', // Relay
		'1007734', // Nobody 2
		'1078605', // Weapons
		'1100988', // 28 Years Later
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
	// ══════════════════════════════════════════════════════════════════

	const LOGO = {
			imdb: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/IMDb.png',
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
			allocine_audience: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/allocine_user.png'
	};

	let currentImdbId = null;
	let currentTmdbData = null;

	setInterval(scanLinks, 1000);
	scanLinks();

	function findImdbIdFromPage() {
		if (currentImdbId) return currentImdbId;

		const imdbLink = document.querySelector(
		  'a[href*="imdb.com/title/tt"], ' +
		  'a.button-link[href*="imdb.com/title/tt"], ' +
		  'a.emby-button[href*="imdb.com/title/tt"]'
		);

		if (imdbLink) {
		  const m = imdbLink.href.match(/imdb\.com\/title\/(tt\d+)/);
		  if (m) {
			currentImdbId = m[1];
			return m[1];
		  }
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
			if (!('origStyle' in el.dataset)) {
			  el.dataset.origStyle = el.getAttribute('style') || '';
			}
			el.style.display = 'none';
		  } else {
			if ('origStyle' in el.dataset) {
			  el.setAttribute('style', el.dataset.origStyle);
			  delete el.dataset.origStyle;
			} else {
			  el.style.display = '';
			}
		  }
		});
	}

	function isInEpisodeListView(element) {
		return !!(
		  element.closest('.listItem') ||
		  element.closest('.listItemBody') ||
		  element.closest('[data-type="Episode"]') ||
		  element.closest('.episodeContainer') ||
		  element.closest('.verticalSection-content')
		);
	}

	function findDetailAnchors(pageView) {
		if (!pageView) return null;

		const nameContainer = pageView.querySelector('.detailNameContainer');
		if (!nameContainer) return null;

		const detailText = nameContainer.closest('.detailTextContainer') ||
						   nameContainer.closest('.verticalFieldItems');
		if (!detailText) return null;

		const mediaInfoBar = detailText.querySelector(
		  '.mediaInfo.detail-mediaInfoPrimary'
		);

		return { nameContainer, mediaInfoBar, detailText };
	}

	function insertRatingRow(pageView, type, tmdbId, episodeInfo) {
		if (!pageView) return;

		const existing = pageView.querySelector('.mdblist-rating-row');
		if (existing) {
		  existing.remove();
		}

		const anchors = findDetailAnchors(pageView);
		if (!anchors) return;

		const { nameContainer, mediaInfoBar } = anchors;

		if (mediaInfoBar) {
		  setBuiltInStarsHidden(mediaInfoBar, true);
		}

		const ratingRow = document.createElement('div');
		ratingRow.className = 'mdblist-rating-row verticalFieldItem detail-lineItem';
		ratingRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:2px;';

		const container = document.createElement('div');
		container.className = 'mdblist-rating-container';
		container.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap;';
		ratingRow.appendChild(container);

		if (mediaInfoBar && mediaInfoBar.parentNode === nameContainer.parentNode) {
		  nameContainer.parentNode.insertBefore(ratingRow, mediaInfoBar);
		} else {
		  nameContainer.insertAdjacentElement('afterend', ratingRow);
		}

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

		  if (newImdbId && newImdbId !== currentImdbId) {
			currentImdbId = newImdbId;
		  }
		});

		const tmdbLinks = Array.from(document.querySelectorAll('a[href*="themoviedb.org/"], a.button-link[href*="themoviedb.org/"], a.emby-button[href*="themoviedb.org/"]'))
		  .filter(a => {
			if (a.dataset.mdblistProcessed) return false;
			if (isInEpisodeListView(a)) return false;
			return true;
		  })
		  .sort((a, b) => {
			const s = h => /\/episode\//.test(h) ? 2 : (/\/season\//.test(h) ? 1 : 0);
			return s(a.href) - s(b.href);
		  });

		tmdbLinks.forEach(a => {
		  a.dataset.mdblistProcessed = 'true';
		  processLink(a);
		});
	}

	function processLink(link) {
		const ep = link.href.match(/themoviedb\.org\/tv\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
		const sn = !ep && link.href.match(/themoviedb\.org\/tv\/(\d+)\/season\/(\d+)(?!\/episode)/);
		const m = link.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);

		if (!m) return;

		const type   = m[1] === 'tv' ? 'show' : 'movie';
		const tmdbId = m[2];

		const episodeInfo = ep ? {
		  isEpisode: true,
		  tvId: ep[1],
		  season: parseInt(ep[2], 10),
		  episode: parseInt(ep[3], 10)
		} : (sn ? {
		  isSeason: true,
		  tvId: sn[1],
		  season: parseInt(sn[2], 10)
		} : null);

		currentTmdbData = { type, tmdbId, episodeInfo };

		const pageView = link.closest('.view-item-item:not(.hide)') ||
						 link.closest('[is="emby-scroller"].view-item-item:not(.hide)') ||
						 link.closest('.page:not(.hide)');

		if (!pageView) return;

		const existingRow = pageView.querySelector('.mdblist-rating-row');
		if (existingRow) {
		  const existingContainer = existingRow.querySelector('.mdblist-rating-container');
		  if (existingContainer &&
			  existingContainer.dataset.tmdbId === tmdbId &&
			  existingContainer.dataset.type === type) {
			return;
		  }
		}

		insertRatingRow(pageView, type, tmdbId, episodeInfo);

		pageView.querySelectorAll('.mediaInfo.detail-mediaInfoPrimary').forEach(bar => {
		  if (isInEpisodeListView(bar)) return;
		  setBuiltInStarsHidden(bar, true);
		});

		hideSecondaryRatingContainers(pageView);
	}

	// ══════════════════════════════════════════════════════════════════
	// Helper: Render rating badge (logo + score) into a container
	// ══════════════════════════════════════════════════════════════════

	function appendRatingBadge(container, logoKey, altText, title, value) {
		const logoUrl = LOGO[logoKey];
		if (!logoUrl) return;

		const img = document.createElement('img');
		img.src = logoUrl;
		img.alt = altText;
		img.title = title;
		img.dataset.source = logoKey;
		img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
		container.appendChild(img);

		const span = document.createElement('span');
		span.textContent = value;
		span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
		container.appendChild(span);
	}

	// ══════════════════════════════════════════════════════════════════
	// Helper: Render all cached ratings into a container
	// ══════════════════════════════════════════════════════════════════

	function renderCachedRatings(cachedData, container) {
		if (!cachedData || !Array.isArray(cachedData.badges)) return;
		cachedData.badges.forEach(badge => {
		  appendRatingBadge(container, badge.logoKey, badge.alt, badge.title, badge.value);
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Data Fetching Functions (with Caching)
	// ══════════════════════════════════════════════════════════════════

	function fetchTmdbEpisodeRating(tvId, season, episode, container) {
		if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') {
		  console.warn('[Emby Ratings] TMDb API key not set');
		  return;
		}

		const cacheKey = `tmdb_episode_${tvId}_s${season}_e${episode}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  renderCachedRatings(cached, container);
		  return;
		}

		const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;

		GM_xmlhttpRequest({
		  method: 'GET',
		  url,
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); }
			catch (e) { return; }

			const avg  = Number(data.vote_average);
			const cnt  = Number(data.vote_count);

			if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(cnt) || cnt <= 0) return;

			const valueText = avg.toFixed(1);
			const titleText = `TMDb (Episode): ${valueText} - ${cnt} votes`;

			// Cache the result
			RatingsCache.set(cacheKey, {
			  badges: [{ logoKey: 'tmdb', alt: 'TMDb', title: titleText, value: valueText }]
			});

			appendRatingBadge(container, 'tmdb', 'TMDb', titleText, valueText);
		  }
		});
	}

	function fetchTmdbSeasonRating(tvId, season, container) {
		if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') {
		  console.warn('[Emby Ratings] TMDb API key not set');
		  return;
		}

		const cacheKey = `tmdb_season_${tvId}_s${season}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  renderCachedRatings(cached, container);
		  return;
		}

		const url = `https://api.themoviedb.org/3/tv/${tvId}/season/${season}?api_key=${TMDB_API_KEY}`;

		GM_xmlhttpRequest({
		  method: 'GET',
		  url,
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); }
			catch (e) { return; }

			const avg = Number(data.vote_average);
			const cnt = Number(data.vote_count);

			if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(cnt) || cnt <= 0) return;

			const valueText = avg.toFixed(1);
			const titleText = `TMDb (Season): ${valueText} - ${cnt} votes`;

			RatingsCache.set(cacheKey, {
			  badges: [{ logoKey: 'tmdb', alt: 'TMDb', title: titleText, value: valueText }]
			});

			appendRatingBadge(container, 'tmdb', 'TMDb', titleText, valueText);
		  }
		});
	}

	function fetchMDBList(type, tmdbId, container) {
		container.dataset.tmdbId = tmdbId;
		container.dataset.type = type;

		const cacheKey = `mdblist_${type}_${tmdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  // Restore dataset values from cache
		  container.dataset.originalTitle = cached.originalTitle || '';
		  container.dataset.year = cached.year || '';

		  // Render MDBList badges
		  renderCachedRatings(cached, container);

		  // Still need to fetch supplementary ratings (AniList, Kinopoisk, Allociné)
		  // These have their own caches
		  const imdbId = findImdbIdFromPage();
		  if (imdbId) {
			fetchAniListRating(imdbId, container);
		  }

		  const title = container.dataset.originalTitle;
		  const year  = parseInt(container.dataset.year, 10);
		  if (title && year) {
			fetchKinopoiskRating(title, year, type, container);
		  }

		  const imdbIdForAllocine = findImdbIdFromPage();
		  if (imdbIdForAllocine) {
			fetchAllocineRatings(imdbIdForAllocine, type, container);
		  }

		  return;
		}

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
		  onload(res) {
			if (res.status !== 200) return console.warn('[Emby Ratings] MDBList status:', res.status);
			let data;
			try { data = JSON.parse(res.responseText); }
			catch (e) { return console.error('[Emby Ratings] MDBList JSON error:', e); }

			container.dataset.originalTitle = data.original_title || data.title || '';
			container.dataset.year          = data.year || '';

			const isCertifiedFreshOverride = CERTIFIED_FRESH_OVERRIDES.includes(String(tmdbId));
			const isVerifiedHotOverride    = VERIFIED_HOT_OVERRIDES.includes(String(tmdbId));

			// Collect scores for special logo decisions
			let metacriticScore = null;
			let metacriticVotes = null;
			let tomatoesScore   = null;
			let tomatoesVotes   = null;
			let audienceScore   = null;
			let audienceVotes   = null;

			const badgesToCache = [];

			if (Array.isArray(data.ratings)) {
			  data.ratings.forEach(r => {
				if (r.value == null) return;
				const key = r.source.toLowerCase();

				if (key === 'metacritic') {
				  metacriticScore = r.value;
				  metacriticVotes = r.votes;
				}
				else if (key === 'tomatoes') {
				  tomatoesScore = r.value;
				  tomatoesVotes = r.votes;
				}
				else if (key.includes('popcorn') || key.includes('audience')) {
				  audienceScore = r.value;
				  audienceVotes = r.votes;
				}
			  });

			  data.ratings.forEach(r => {
				if (r.value == null) return;

				let key = r.source.toLowerCase().replace(/\s+/g, '_');

				if (key === 'tomatoes') {
				  if (r.value < 60) {
					key = 'tomatoes_rotten';
				  } else if (isCertifiedFreshOverride || (tomatoesScore >= 75 && tomatoesVotes >= 80)) {
					key = 'tomatoes_certified';
				  } else {
					key = 'tomatoes';
				  }
				}
				else if (key.includes('popcorn') || key.includes('audience')) {
				  if (r.value < 60) {
					key = 'audience_rotten';
				  } else if (isVerifiedHotOverride || (audienceScore >= 90 && audienceVotes >= 500)) {
					key = 'rotten_ver';
				  } else {
					key = 'audience';
				  }
				}
				else if (key === 'metacritic') {
				  const isMustSee = metacriticScore > 81 && metacriticVotes > 14;
				  key = isMustSee ? 'metacriticms' : 'metacritic';
				}
				else if (key.includes('metacritic') && key.includes('user')) key = 'metacriticus';
				else if (key.includes('trakt')) key = 'trakt';
				else if (key.includes('letterboxd')) key = 'letterboxd';
				else if (key.includes('roger') || key.includes('ebert')) key = 'rogerebert';
				else if (key.includes('myanimelist')) key = 'myanimelist';

				const logoUrl = LOGO[key];
				if (!logoUrl) return;

				const titleText = `${r.source}: ${r.value}${r.votes ? ` (${r.votes} votes)` : ''}`;

				badgesToCache.push({
				  logoKey: key,
				  alt: r.source,
				  title: titleText,
				  value: String(r.value)
				});

				appendRatingBadge(container, key, r.source, titleText, r.value);
			  });
			}

			// Cache the MDBList results
			RatingsCache.set(cacheKey, {
			  originalTitle: data.original_title || data.title || '',
			  year: data.year || '',
			  badges: badgesToCache
			});

			// Supplementary ratings (each with their own cache)
			const imdbId = findImdbIdFromPage();
			if (imdbId) {
			  fetchAniListRating(imdbId, container);
			}

			const title = container.dataset.originalTitle;
			const year  = parseInt(container.dataset.year, 10);
			if (title && year) {
			  fetchKinopoiskRating(title, year, type, container);
			}

			const imdbIdForAllocine = findImdbIdFromPage();
			if (imdbIdForAllocine) {
			  fetchAllocineRatings(imdbIdForAllocine, type, container);
			}
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// AniList (with Caching)
	// ══════════════════════════════════════════════════════════════════

	function getAnilistId(imdbId, cb) {
		const cacheKey = `anilist_id_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached !== null) {
		  cb(cached.id); // cached.id can be null (meaning "no AniList ID found")
		  return;
		}

		const sparql = `
		  SELECT ?anilist WHERE {
			?item wdt:P345 "${imdbId}" .
			?item wdt:P8729 ?anilist .
		  } LIMIT 1`;

		GM_xmlhttpRequest({
		  method: 'GET',
		  url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
		  onload(res) {
			if (res.status !== 200) return cb(null);
			let json;
			try { json = JSON.parse(res.responseText); }
			catch { return cb(null); }
			const b = json.results.bindings;
			const id = b.length && b[0].anilist?.value ? b[0].anilist.value : null;

			// Cache the Wikidata lookup result (even if null, to avoid repeated lookups)
			RatingsCache.set(cacheKey, { id: id });
			cb(id);
		  },
		  onerror: () => cb(null)
		});
	}

	function fetchAniListRating(imdbId, container) {
		const cacheKey = `anilist_rating_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.score > 0) {
			appendAniList(container, cached.mediaId, cached.score);
		  }
		  return;
		}

		getAnilistId(imdbId, id => {
		  if (id) {
			queryAniListById(id, container, imdbId);
		  } else {
			const title = container.dataset.originalTitle;
			const year  = parseInt(container.dataset.year, 10);
			if (title && year) queryAniListBySearch(title, year, container, imdbId);
		  }
		});
	}

	function queryAniListById(id, container, imdbId) {
		const query = `
		  query($id:Int){
			Media(id:$id,type:ANIME){
			  id meanScore
			}
		  }`;

		GM_xmlhttpRequest({
		  method: 'POST',
		  url: 'https://graphql.anilist.co',
		  headers: {'Content-Type':'application/json'},
		  data: JSON.stringify({ query, variables: { id: parseInt(id, 10) } }),
		  onload(res) {
			if (res.status !== 200) return;
			let json;
			try { json = JSON.parse(res.responseText); }
			catch { return; }
			const m = json.data?.Media;
			if (m?.meanScore > 0) {
			  // Cache AniList rating
			  if (imdbId) {
				RatingsCache.set(`anilist_rating_${imdbId}`, {
				  mediaId: m.id,
				  score: m.meanScore
				});
			  }
			  appendAniList(container, m.id, m.meanScore);
			} else if (imdbId) {
			  // Cache negative result
			  RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: null, score: 0 });
			}
		  }
		});
	}

	function queryAniListBySearch(title, year, container, imdbId) {
		const query = `
		  query($search:String,$startDate:FuzzyDateInt,$endDate:FuzzyDateInt){
			Media(
			  search:$search,
			  type:ANIME,
			  startDate_greater:$startDate,
			  startDate_lesser:$endDate
			){
			  id meanScore title { romaji english native } startDate { year }
			}
		  }`;

		const vars = {
		  search:    title,
		  startDate: parseInt(`${year}0101`, 10),
		  endDate:   parseInt(`${year+1}0101`, 10)
		};

		GM_xmlhttpRequest({
		  method: 'POST',
		  url: 'https://graphql.anilist.co',
		  headers: {'Content-Type':'application/json'},
		  data: JSON.stringify({ query, variables: vars }),
		  onload(res) {
			if (res.status !== 200) return;
			let json;
			try { json = JSON.parse(res.responseText); }
			catch { return; }
			const m = json.data?.Media;
			if (m?.meanScore > 0 && m.startDate?.year === year) {
			  const norm = s => s.toLowerCase().trim();
			  const t0 = norm(title);
			  const titles = [m.title.romaji, m.title.english, m.title.native]
				.filter(Boolean).map(norm);
			  if (titles.includes(t0)) {
				if (imdbId) {
				  RatingsCache.set(`anilist_rating_${imdbId}`, {
					mediaId: m.id,
					score: m.meanScore
				  });
				}
				appendAniList(container, m.id, m.meanScore);
				return;
			  }
			}
			// Cache negative result
			if (imdbId) {
			  RatingsCache.set(`anilist_rating_${imdbId}`, { mediaId: null, score: 0 });
			}
		  }
		});
	}

	function appendAniList(container, mediaId, score) {
		appendRatingBadge(container, 'anilist', 'AniList', `AniList: ${score}`, score);
	}

	// ══════════════════════════════════════════════════════════════════
	// Kinopoisk (with Caching)
	// ══════════════════════════════════════════════════════════════════

	function fetchKinopoiskRating(title, year, type, container) {
		if (!KINOPOISK_API_KEY || KINOPOISK_API_KEY === 'DEIN_KEY_HIER') {
		  console.warn('[Emby Ratings] Kinopoisk API key not set');
		  return;
		}

		const cacheKey = `kinopoisk_${type}_${title}_${year}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.rating != null) {
			appendRatingBadge(container, 'kinopoisk', 'Kinopoisk',
			  `Kinopoisk: ${cached.rating}`, cached.rating);
		  }
		  return;
		}

		const url = `https://kinopoiskapiunofficial.tech/api/v2.2/films?keyword=${encodeURIComponent(title)}&yearFrom=${year}&yearTo=${year}`;

		GM_xmlhttpRequest({
		  method: 'GET',
		  url,
		  headers: {
			'X-API-KEY': KINOPOISK_API_KEY,
			'Content-Type': 'application/json'
		  },
		  onload(res) {
			if (res.status !== 200) return console.warn('[Emby Ratings] KP status:', res.status);
			let data;
			try { data = JSON.parse(res.responseText); }
			catch (e) { return console.error('[Emby Ratings] KP JSON parse error:', e); }

			const list = data.items || data.films || [];
			if (!list.length) {
			  RatingsCache.set(cacheKey, { rating: null });
			  return console.warn('[Emby Ratings] KP no items for', title);
			}

			const desired = type === 'show' ? 'TV_SERIES' : 'FILM';
			const item = list.find(i => i.type === desired) || list[0];
			if (item.ratingKinopoisk == null) {
			  RatingsCache.set(cacheKey, { rating: null });
			  return;
			}

			RatingsCache.set(cacheKey, { rating: item.ratingKinopoisk });

			const img = document.createElement('img');
			img.src = LOGO.kinopoisk;
			img.alt = 'Kinopoisk';
			img.title = `Kinopoisk: ${item.ratingKinopoisk}`;
			img.dataset.source = 'kinopoisk';
			img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
			container.appendChild(img);

			const span = document.createElement('span');
			span.textContent = item.ratingKinopoisk;
			span.style.cssText = 'margin-right:9px; font-size:1em; vertical-align:middle;';
			container.appendChild(span);
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Allociné (with Caching)
	// ══════════════════════════════════════════════════════════════════

	function getAllocineId(imdbId, type) {
		return new Promise((resolve) => {
		  if (!imdbId) { resolve(null); return; }

		  const cacheKey = `allocine_id_${type}_${imdbId}`;
		  const cached = RatingsCache.get(cacheKey);
		  if (cached !== null) {
			resolve(cached.id);
			return;
		  }

		  const prop = type === 'show' ? 'P1267' : 'P1265';
		  const sparql = `
			SELECT ?allocine WHERE {
			  ?item wdt:P345 "${imdbId}" .
			  ?item wdt:${prop} ?allocine .
			} LIMIT 1`;

		  GM_xmlhttpRequest({
			method: 'GET',
			url: 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql),
			onload(res) {
			  if (res.status !== 200) { resolve(null); return; }
			  let json;
			  try { json = JSON.parse(res.responseText); }
			  catch { resolve(null); return; }
			  const b = json.results.bindings;
			  const id = b.length && b[0].allocine?.value ? b[0].allocine.value : null;

			  RatingsCache.set(cacheKey, { id: id });
			  resolve(id);
			},
			onerror: () => resolve(null)
		  });
		});
	}

	function fetchAllocineRatings(imdbId, type, container) {
		if (!imdbId) return;

		const cacheKey = `allocine_ratings_${type}_${imdbId}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached) {
		  if (cached.pressScore) {
			appendRatingBadge(container, 'allocine_critics', 'Allociné Presse',
			  `Allociné Presse: ${cached.pressScore} / 5`, cached.pressScore);
		  }
		  if (cached.audienceScore) {
			appendRatingBadge(container, 'allocine_audience', 'Allociné Spectateurs',
			  `Allociné Spectateurs: ${cached.audienceScore} / 5`, cached.audienceScore);
		  }
		  return;
		}

		getAllocineId(imdbId, type).then(allocineId => {
		  if (!allocineId) {
			RatingsCache.set(cacheKey, { pressScore: null, audienceScore: null });
			return;
		  }

		  const pathSegment = type === 'show' ? 'series' : 'film';
		  const url = `https://YOUR-CORS-PROXY-BASE-URL/https://www.allocine.fr/${pathSegment}/fichefilm_gen_cfilm=${allocineId}.html`;

		  GM_xmlhttpRequest({
			method: 'GET',
			url,
			onload(res) {
			  if (res.status !== 200) return;

			  const html = res.responseText;
			  const foundRatings = [];

			  const ratingPattern = /class="stareval-note"[^>]*>\s*([\d][,.][\d])\s*<\/span>/g;
			  let match;
			  while ((match = ratingPattern.exec(html)) !== null) {
				const val = parseFloat(match[1].replace(',', '.'));
				if (val > 0 && val <= 5) {
				  foundRatings.push(val);
				}
			  }

			  if (foundRatings.length === 0) {
				const ratingItemPattern = /rating-item[\s\S]*?stareval-note[^>]*>\s*([\d][,.][\d])\s*</g;
				let itemMatch;
				while ((itemMatch = ratingItemPattern.exec(html)) !== null) {
				  const val = parseFloat(itemMatch[1].replace(',', '.'));
				  if (val > 0 && val <= 5) {
					foundRatings.push(val);
				  }
				}
			  }

			  if (foundRatings.length === 0) {
				const notePattern = /<span[^>]*class="[^"]*stareval-note[^"]*"[^>]*>\s*([\d][,.][\d])\s*<\/span>/g;
				let noteMatch;
				while ((noteMatch = notePattern.exec(html)) !== null) {
				  const val = parseFloat(noteMatch[1].replace(',', '.'));
				  if (val > 0 && val <= 5) {
					foundRatings.push(val);
				  }
				}
			  }

			  if (foundRatings.length === 0) {
				const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
				if (jsonLdMatch) {
				  for (const block of jsonLdMatch) {
					try {
					  const jsonStr = block.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
					  const jsonData = JSON.parse(jsonStr);
					  if (jsonData.aggregateRating) {
						const ratingValue = parseFloat(jsonData.aggregateRating.ratingValue);
						if (ratingValue > 0 && ratingValue <= 5) {
						  foundRatings.push(ratingValue);
						}
					  }
					} catch (e) { /* ignore parse errors */ }
				  }
				}
			  }

			  if (foundRatings.length === 0) {
				console.warn('[Emby Ratings] Allociné: no ratings found for', allocineId);
				RatingsCache.set(cacheKey, { pressScore: null, audienceScore: null });
				return;
			  }

			  const pressScore    = foundRatings[0] ? foundRatings[0].toFixed(1) : null;
			  const audienceScore = foundRatings[1] ? foundRatings[1].toFixed(1) : null;

			  // Cache the Allociné results
			  RatingsCache.set(cacheKey, {
				pressScore: pressScore,
				audienceScore: audienceScore
			  });

			  if (pressScore) {
				const img = document.createElement('img');
				img.src = LOGO.allocine_critics;
				img.alt = 'Allociné Presse';
				img.title = `Allociné Presse: ${pressScore} / 5`;
				img.dataset.source = 'allocine_critics';
				img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
				container.appendChild(img);

				const span = document.createElement('span');
				span.textContent = pressScore;
				span.style.cssText = 'margin-right:9px; font-size:1em; vertical-align:middle;';
				container.appendChild(span);
			  }

			  if (audienceScore) {
				const img = document.createElement('img');
				img.src = LOGO.allocine_audience;
				img.alt = 'Allociné Spectateurs';
				img.title = `Allociné Spectateurs: ${audienceScore} / 5`;
				img.dataset.source = 'allocine_audience';
				img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
				container.appendChild(img);

				const span = document.createElement('span');
				span.textContent = audienceScore;
				span.style.cssText = 'margin-right:9px; font-size:1em; vertical-align:middle;';
				container.appendChild(span);
			  }
			}
		  });
		});
	}

})();