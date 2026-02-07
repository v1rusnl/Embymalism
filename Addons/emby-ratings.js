/*!
 * Emby Ratings Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/Druidblack/jellyfin_ratings
 * Shows IMDb, Rotten Tomatoes, Metacritic, Trakt, Letterboxd, AniList
 * Paste your API keys into line 32-34, min. one key is mandatory
 * Manual Overrides for RT can be set in line 41 ff.
 * Add <script src="emby-ratings.js"></script> in index.html before </body>
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
  
  const MDBLIST_API_KEY = 'YOUR_API_KEY';
  const TMDB_API_KEY    = 'YOUR_API_KEY';
  const KINOPOISK_API_KEY = 'YOUR_API_KEY';
  
  // ══════════════════════════════════════════════════════════════════
  // MANUELLE OVERRIDES: TMDb-IDs für erzwungene Badges
  // Füge hier TMDb-IDs hinzu, die das jeweilige Badge erhalten sollen,
  // auch wenn die Score/Votes-Schwellenwerte nicht erreicht werden.
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
		rogerebert: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/Roger_Ebert.png'
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

  /**
   * Hides the built-in star rating and critic rating elements inside a mediaInfo bar.
   */
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

  /**
   * Find the detailNameContainer and mediaInfo bar within the same detailTextContainer.
   * Returns { nameContainer, mediaInfoBar } or null.
   */
  function findDetailAnchors(pageView) {
    if (!pageView) return null;

    // The detailNameContainer
    const nameContainer = pageView.querySelector('.detailNameContainer');
    if (!nameContainer) return null;

    // The mediaInfo primary bar (sibling of detailNameContainer inside detailTextContainer)
    const detailText = nameContainer.closest('.detailTextContainer') ||
                       nameContainer.closest('.verticalFieldItems');
    if (!detailText) return null;

    const mediaInfoBar = detailText.querySelector(
      '.mediaInfo.detail-mediaInfoPrimary'
    );

    return { nameContainer, mediaInfoBar, detailText };
  }

  /**
   * Insert the rating container as its own row between detailNameContainer and mediaInfo bar.
   */
  function insertRatingRow(pageView, type, tmdbId, episodeInfo) {
    if (!pageView) return;

    // Remove any existing rating row in this page view
    const existing = pageView.querySelector('.mdblist-rating-row');
    if (existing) {
      existing.remove();
    }

    const anchors = findDetailAnchors(pageView);
    if (!anchors) return;

    const { nameContainer, mediaInfoBar } = anchors;

    // Hide built-in stars in the mediaInfo bar
    if (mediaInfoBar) {
      setBuiltInStarsHidden(mediaInfoBar, true);
    }

    // Create the rating row container
    const ratingRow = document.createElement('div');
    ratingRow.className = 'mdblist-rating-row verticalFieldItem detail-lineItem';
    ratingRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:2px;';

    // The inner container for rating badges
    const container = document.createElement('div');
    container.className = 'mdblist-rating-container';
    container.style.cssText = 'display:inline-flex; align-items:center; flex-wrap:wrap;';
    ratingRow.appendChild(container);

    // Insert after detailNameContainer, before mediaInfo bar
    if (mediaInfoBar && mediaInfoBar.parentNode === nameContainer.parentNode) {
      nameContainer.parentNode.insertBefore(ratingRow, mediaInfoBar);
    } else {
      // Fallback: insert right after nameContainer
      nameContainer.insertAdjacentElement('afterend', ratingRow);
    }

    // Fetch and populate ratings
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

  /**
   * Also handle inline mediaInfo bars outside the main detail area (e.g. in mediaSources).
   * These get hidden ratings so they don't show duplicates.
   */
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

    // Find the visible item detail page view that contains this link
    const pageView = link.closest('.view-item-item:not(.hide)') ||
                     link.closest('[is="emby-scroller"].view-item-item:not(.hide)') ||
                     link.closest('.page:not(.hide)');

    if (!pageView) return;

    // Check if we already have a rating row for this tmdbId in this view
    const existingRow = pageView.querySelector('.mdblist-rating-row');
    if (existingRow) {
      const existingContainer = existingRow.querySelector('.mdblist-rating-container');
      if (existingContainer &&
          existingContainer.dataset.tmdbId === tmdbId &&
          existingContainer.dataset.type === type) {
        return; // Already present for same item
      }
    }

    // Insert the rating row in the proper position
    insertRatingRow(pageView, type, tmdbId, episodeInfo);

    // Also hide built-in stars in all mediaInfo bars within the page view
    pageView.querySelectorAll('.mediaInfo.detail-mediaInfoPrimary').forEach(bar => {
      if (isInEpisodeListView(bar)) return;
      setBuiltInStarsHidden(bar, true);
    });

    // Hide any old inline rating containers in mediaSources etc.
    hideSecondaryRatingContainers(pageView);
  }

  // ══════════════════════════════════════════════════════════════════
  // Data Fetching Functions
  // ══════════════════════════════════════════════════════════════════

  function fetchTmdbEpisodeRating(tvId, season, episode, container) {
    if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') {
      console.warn('[Emby Ratings] TMDb API key not set');
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

        const img = document.createElement('img');
        img.src = LOGO.tmdb;
        img.alt = 'TMDb';
        img.dataset.source = 'tmdb';
        img.title = `TMDb (Episode): ${valueText} - ${cnt} votes`;
        img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
        container.appendChild(img);

        const span = document.createElement('span');
        span.textContent = valueText;
        span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
        container.appendChild(span);
      }
    });
  }

  function fetchTmdbSeasonRating(tvId, season, container) {
    if (!TMDB_API_KEY || TMDB_API_KEY === 'api_key') {
      console.warn('[Emby Ratings] TMDb API key not set');
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

        const img = document.createElement('img');
        img.src = LOGO.tmdb;
        img.alt = 'TMDb';
        img.dataset.source = 'tmdb';
        img.title = `TMDb (Season): ${valueText} - ${cnt} votes`;
        img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
        container.appendChild(img);

        const span = document.createElement('span');
        span.textContent = valueText;
        span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
        container.appendChild(span);
      }
    });
  }

  function fetchMDBList(type, tmdbId, container) {
    // Tag the container so we can detect duplicates
    container.dataset.tmdbId = tmdbId;
    container.dataset.type = type;

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

        // ── First pass: collect scores for special logo decisions ──
        let metacriticScore = null;
        let metacriticVotes = null;
        let tomatoesScore   = null;
        let tomatoesVotes   = null;
        let audienceScore   = null;
        let audienceVotes   = null;

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

          // ── Second pass: render all ratings ──
          data.ratings.forEach(r => {
            if (r.value == null) return;

            let key = r.source.toLowerCase().replace(/\s+/g, '_');

            // ── Rotten Tomatoes Critics ──
            if (key === 'tomatoes') {
              if (r.value < 60) {
                key = 'tomatoes_rotten';
              } else if (isCertifiedFreshOverride || (tomatoesScore >= 75 && tomatoesVotes >= 80)) {
                key = 'tomatoes_certified';
              } else {
                key = 'tomatoes';
              }
            }
            // ── Rotten Tomatoes Audience ──
            else if (key.includes('popcorn') || key.includes('audience')) {
              if (r.value < 60) {
                key = 'audience_rotten';
              } else if (isVerifiedHotOverride || (audienceScore >= 90 && audienceVotes >= 500)) {
                key = 'rotten_ver';
              } else {
                key = 'audience';
              }
            }
            // ── Metacritic ──
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

            const img = document.createElement('img');
            img.src = logoUrl;
            img.alt = r.source;
            img.title = `${r.source}: ${r.value}${r.votes ? ` (${r.votes} votes)` : ''}`;
            img.dataset.source = key;
            img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
            container.appendChild(img);

            const span = document.createElement('span');
            span.textContent = r.value;
            span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
            container.appendChild(span);
          });
        }

        // ── AniList ──
        const imdbId = findImdbIdFromPage();
        if (imdbId) {
          fetchAniListRating(imdbId, container);
        }

        // ── Kinopoisk ──
        const title = container.dataset.originalTitle;
        const year  = parseInt(container.dataset.year, 10);
        if (title && year) {
          fetchKinopoiskRating(title, year, type, container);
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // AniList
  // ══════════════════════════════════════════════════════════════════

  function getAnilistId(imdbId, cb) {
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
        cb(b.length && b[0].anilist?.value ? b[0].anilist.value : null);
      },
      onerror: () => cb(null)
    });
  }

  function fetchAniListRating(imdbId, container) {
    getAnilistId(imdbId, id => {
      if (id) {
        queryAniListById(id, container);
      } else {
        const title = container.dataset.originalTitle;
        const year  = parseInt(container.dataset.year, 10);
        if (title && year) queryAniListBySearch(title, year, container);
      }
    });
  }

  function queryAniListById(id, container) {
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
        if (m?.meanScore > 0) appendAniList(container, m.id, m.meanScore);
      }
    });
  }

  function queryAniListBySearch(title, year, container) {
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
          if (titles.includes(t0)) appendAniList(container, m.id, m.meanScore);
        }
      }
    });
  }

  function appendAniList(container, mediaId, score) {
    const img = document.createElement('img');
    img.src = LOGO.anilist;
    img.alt = 'AniList';
    img.title = `AniList: ${score}`;
    img.dataset.source = 'anilist';
    img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
    container.appendChild(img);

    const span = document.createElement('span');
    span.textContent = score;
    span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
    container.appendChild(span);
  }

  // ══════════════════════════════════════════════════════════════════
  // Kinopoisk
  // ══════════════════════════════════════════════════════════════════

  function fetchKinopoiskRating(title, year, type, container) {
    if (!KINOPOISK_API_KEY || KINOPOISK_API_KEY === 'DEIN_KEY_HIER') {
      console.warn('[Emby Ratings] Kinopoisk API key not set');
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
        if (!list.length) return console.warn('[Emby Ratings] KP no items for', title);

        const desired = type === 'show' ? 'TV_SERIES' : 'FILM';
        const item = list.find(i => i.type === desired) || list[0];
        if (item.ratingKinopoisk == null) return;

        const img = document.createElement('img');
        img.src = LOGO.kinopoisk;
        img.alt = 'Kinopoisk';
        img.title = `Kinopoisk: ${item.ratingKinopoisk}`;
        img.dataset.source = 'kinopoisk';
        img.style.cssText = 'height:1.0em; margin-right:2px; vertical-align:middle;';
        container.appendChild(img);

        const span = document.createElement('span');
        span.textContent = item.ratingKinopoisk;
        span.style.cssText = 'margin-right:8px; font-size:1em; vertical-align:middle;';
        container.appendChild(span);
      }
    });
  }

})();