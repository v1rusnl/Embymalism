/*!
 * Emby Ratings Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/Druidblack/jellyfin_ratings
 * Shows IMDb, Rotten Tomatoes, Metacritic, Trakt, Letterboxd, AniList, RogerEbert, Kinopoisk, Allociné, Oscars + Emmy Wins
 * JSON first; missing awards and ratings load concurrently.
 *
 * Configuration is at the beginning of this file.
 * - Paste your API keys -  min. MDBList key is mandatory to get most ratings (except Allociné); if no key is used, leave the value field empty
 * - Enable the Rating providers you'd like to see
 * - For Rotten Tomatoes Badge "Verified Hot" to work automatically and Ratings for old titles with MDBList null API response + Allociné Ratings, you need a reliant CORS proxy, e.g. https://github.com/obeone/simple-cors-proxy and you need to set its base URL
 * - Set Ratings cache duration to minimize API calls and instant Rating load time when revisiting items -> default=168h (1 Week)
 *
 * Paste your modified emby.ratings.js into /system/dashboard-ui/ 
 * Add <script src="emby-ratings.js" defer></script> in index.html before </body>
 *
 */
 
(function(){
    const CONFIG = {
        enableAwards: true,
        enableCustomRatings: true,
		// ══════════════════════════════════════════════════════════════════
		// API KEYS
		// ══════════════════════════════════════════════════════════════════
		MDBLIST_API_KEY: '', // API Key from https://mdblist.com/
        TMDB_API_KEY: '', // API Key from https://www.themoviedb.org/
        KINOPOISK_API_KEY: '', // API key from https://kinopoiskapiunofficial.tech/
		OMDB_API_KEY: '', // Own key for standalone use; plugin key stays on the server.
		
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

/* Shared runtime, embedded into each distributable script. No extra script tag needed. */
(function (w) {
 'use strict';
 if (w.EmbyRatingsRuntime?.version === '20260930.3') return;
 const pending = new Map(), memory = new Map(), queues = new Map(), next = new Map(), cooldown = new Map();
 let configValue = null, configUntil = 0, jsonValue = null, jsonUntil = 0;
 const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
 async function timeout(promise, ms) { let timer; try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Request timeout')),ms);})]); } finally { clearTimeout(timer); } }
 let resolvedApi = null, lastScope = null;
 const api = () => w.ApiClient || resolvedApi;
 async function resolveApi() {
  if(api())return api();
  if(typeof w.require==='function')try{resolvedApi=await timeout(new Promise(resolve=>w.require(['connectionManager'],cm=>resolve((cm?.default||cm)?.currentApiClient?.()||null),()=>resolve(null))),2500);}catch{}
  return api();
 }
 const scope = () => (api()?.serverAddress?.() || location.origin) + ':' + (api()?.getCurrentUserId?.() || 'anonymous');
 const hash = s => { let h = 2166136261,j=5381; for (const c of s) {h = Math.imul(h ^ c.charCodeAt(0), 16777619);j=Math.imul(j,33)^c.charCodeAt(0);} return (h >>> 0).toString(16)+'_'+(j>>>0).toString(16)+'_'+s.length; };
 const storageKey = key => 'emby_ratings_v2_' + hash(scope()) + '_' + hash(key);
 function read(key) { try { return memory.get(storageKey(key)) || JSON.parse(localStorage.getItem(storageKey(key)) || 'null'); } catch { return null; } }
 function write(key, value, ttl) { const record = {value, until: Date.now() + ttl}; memory.set(storageKey(key), record);if(memory.size>1024)memory.delete(memory.keys().next().value); try { localStorage.setItem(storageKey(key), JSON.stringify(record)); } catch {} }
 async function single(key, action) {
  key = scope() + ':' + key;
  if (pending.has(key)) return pending.get(key);
  const task = Promise.resolve().then(action); pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
 }
 async function limited(key, action) {
  const old = queues.get(key) || Promise.resolve();
  const task = old.catch(() => {}).then(async () => {
   if ((cooldown.get(key) || 0) > Date.now()) throw new Error('Provider cooldown');
   await sleep(Math.max(0, (next.get(key) || 0) - Date.now()));
   try { return await action(); } finally { next.set(key, Date.now() + (key.includes('wikidata') ? 2000 : 500)); }
  });
  queues.set(key, task); try { return await task; } finally { if (queues.get(key) === task) queues.delete(key); }
 }
 async function text(url, options = {}, ttl = 3600000) {
  const key = 'http:' + url + ':' + (options.body || '') + ':' + JSON.stringify(options.headers || {});
  const cached = read(key); if (cached?.until > Date.now()) return cached.value;
  return single(key, () => limited(new URL(url, location.href).host, async () => {
   const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
   try {
    const response = await fetch(url, {...options, signal: controller.signal});
    if (!response.ok) {
     if ([402, 429, 503].includes(response.status)) {
      const retry = response.headers.get('Retry-After');
      const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      cooldown.set(new URL(url, location.href).host, Date.now() + (response.status === 402 ? 86400000 : (delay > 0 ? delay : 60000)));
     }
     throw new Error('Provider HTTP ' + response.status);
    }
    const value = await response.text();
    if (ttl > 0 && value) write(key, value, ttl);
    return value;
   } catch (e) { if (cached?.value) return cached.value; throw e; }
   finally { clearTimeout(timer); }
  }));
 }
 async function config() {
  await resolveApi();
  if(lastScope!==scope()){lastScope=scope();configValue=null;configUntil=0;jsonValue=null;jsonUntil=0;}
  if (Date.now() < configUntil) return configValue;
  if (!api()?.getUrl || !api()?.getJSON) return null;
  return single('config', async () => {
   try {
    configValue = await timeout(api().getJSON(api().getUrl('NativeSpotlight/Config')),4000);
    configUntil = Date.now() + 60000;
   } catch { configValue = null; configUntil = Date.now() + 3000; }
   return configValue;
  });
 }
 function field(c, key, fallback) { return c?.[key] ?? c?.[key[0].toLowerCase() + key.slice(1)] ?? fallback; }
 async function endpoint(provider, args) {
  const c = await config(); if (!c) return undefined;
  const key = 'plugin-v26:' + provider + ':' + JSON.stringify(Object.fromEntries(Object.entries(args).sort(([a],[b])=>a.localeCompare(b))));
  const flag = {MdbList:'EnableCustomRatings', Awards:'EnableAwards', Allocine:'EnableAllocine', AniList:'EnableAniList', Kinopoisk:'EnableKinopoisk', RottenTomatoes:'EnableRottenTomatoes'}[provider];
  if (!field(c, flag, true) || (provider !== 'Awards' && !field(c, 'EnableCustomRatings', true))) return null;
  const recent=read(key);if(recent?.until>Date.now())return recent.value;
  return single(key, async () => {
   try { const result=await timeout(api().getJSON(api().getUrl('NativeSpotlight/' + provider, args)),90000);write(key,result,60000);return result; }
   catch { return undefined; }
  });
 }
 function jsonUrl() {
  // Preserve reverse-proxy prefixes and ignore the hash-based Emby route.
  const scripts = [...document.scripts];
  const own = scripts.find(s => /\/(?:emby-ratings|native-spotlight-custom)\.js(?:\?|$)/.test(s.src));
  return new URL('ratings-data.json', own?.src || new URL('web/', (api()?.serverAddress?.() || location.origin).replace(/\/$/, '') + '/')).href;
 }
 async function serverRatings() {
  if (Date.now() < jsonUntil) return jsonValue;
  return single('optional-json', async () => {
   const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2500);
   try {
    const response = await fetch(jsonUrl(), {cache:'no-cache', signal:controller.signal});
    if (!response.ok) throw new Error('Optional JSON absent');
    const data = await response.json();
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid optional JSON');
    jsonValue = data; jsonUntil = Date.now() + 300000;
   } catch { jsonUntil = Date.now() + 60000; }
   finally { clearTimeout(timer); }
   return jsonValue;
  });
 }
 function parseAwards(value) {
  if (typeof value !== 'string') return null;
  const wins = name => { const match=value.match(new RegExp('\\bWon\\s+([\\d,]+)\\s+'+name+'\\b','i'));return match?Number(match[1].replace(/,/g,'')):null; };
  return {source:'omdb',schema:1,text:value,oscars:{wins:wins('Oscars?')},emmys:{wins:wins('(?:(?:Primetime|Daytime|International)\\s+)?Emm(?:y|ys)')}};
 }
 function validAwards(value) { return value?.source==='omdb' && value.schema===1 && typeof value.text==='string'; }
 async function awards(imdb, apiKey='') {
  if (!/^tt\d+$/.test(imdb||'')) return null;
  const key='omdb-awards-v1:'+imdb, cached=read(key);
  if(validAwards(cached?.value)&&cached.until>Date.now())return cached.value;
  return single(key,async()=>{
   try {
    const server=await endpoint('Awards',{ImdbId:imdb});
    if(validAwards(server)){write(key,server,604800000);return server;}
    if(!apiKey.trim())return validAwards(cached?.value)?cached.value:null;
    const bucket='omdb:'+hash(apiKey.trim());
    if(read(bucket)?.until>Date.now())return validAwards(cached?.value)?cached.value:null;
    const response=JSON.parse(await text('https://www.omdbapi.com/?i='+encodeURIComponent(imdb)+'&apikey='+encodeURIComponent(apiKey.trim()),{},0));
    if(response.Response!=='True'){
     if(/limit|key/i.test(response.Error||''))write(bucket,true,86400000);
     return validAwards(cached?.value)?cached.value:null;
    }
    const result=parseAwards(response.Awards);
    if(result)write(key,result,604800000);
    return result;
   }catch{return validAwards(cached?.value)?cached.value:null;}
  });
 }
 function renderAwards(row, data) {
  row.replaceChildren();
  if(!validAwards(data))return;
  for(const [name,label,logo] of [['oscars','Oscars','Oscars_Win.png'],['emmys','Emmys','Emmy_Win.png']]){
   const wins=Number(data[name]?.wins);
   if(!Number.isSafeInteger(wins)||wins<=0)continue;
   const group=document.createElement('span');group.className='omdb-award-section '+name+'-section';
   group.title=label+': '+wins+' wins. '+data.text;
   group.setAttribute('aria-label',group.title);
   group.style.cssText='display:inline-flex;align-items:center;gap:1px;margin-right:12px;flex-wrap:wrap;pointer-events:auto';
   const heading=document.createElement('img');
   heading.src='https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/'+(name==='oscars'?'academyaw.png':'emmy.png');
   heading.className='omdb-award-heading';heading.alt=label;heading.title=group.title;
   heading.style.cssText='height:1.5em;width:auto;max-width:none;object-fit:contain;margin-right:8px';
   group.appendChild(heading);
   for(let i=0;i<wins;i++){
    const img=document.createElement('img');img.src='https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/'+logo;
    img.className=name==='oscars'?'oscars_win':'emmy_win';img.alt=label+' win';img.title=group.title;
    img.style.cssText='height:1.5em;width:auto;max-width:none;object-fit:contain';group.appendChild(img);
   }
   row.appendChild(group);
  }
 }
 w.EmbyRatingsRuntime = {version:'20260930.3', config, field, endpoint, text, serverRatings, awards, parseAwards, validAwards, renderAwards, single, read, write, setApi:value=>{resolvedApi=value;}};
})(window);

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
    const Shared=window.EmbyRatingsRuntime;
    let pluginAvailable=false;
    const GM_xmlhttpRequest = options => {
        (async()=>{
            let data;
            const url=new URL(options.url);
            if(url.host==='api.mdblist.com'){
                const m=url.pathname.match(/\/tmdb\/(movie|show)\/(\d+)/);
                if(m)data=await Shared.endpoint('MdbList',{Type:m[1],TmdbId:m[2]});
                if(data===undefined&&!MDBLIST_API_KEY)throw new Error('MDBList not configured');
            }else if(url.host==='kinopoiskapiunofficial.tech'){
                data=await Shared.endpoint('Kinopoisk',{Type:options.ratingType||'movie',Title:url.searchParams.get('keyword'),Year:Number(url.searchParams.get('yearFrom'))});
            }
            const responseText=data!==undefined?JSON.stringify(data||{}):await Shared.text(options.url,{method:options.method||'GET',headers:options.headers,body:options.data});
            options.onload?.({status:200,responseText});
        })().catch(error=>{if(options.onerror)options.onerror(error);else options.onload?.({status:503,responseText:'{}'});});
    };

    async function ratingsFetch(url, timeout = 20000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try { return await fetch(url, {signal: controller.signal}); }
        finally { clearTimeout(timer); }
    }

    function validRating(value) { return typeof value !== 'object' && value != null && String(value).trim() !== '' && String(value) !== '--'; }
    function ratingGroup(key) {
        if (key.startsWith('tomatoes')) return 'tomatoes';
        if (key.startsWith('audience') || key === 'rotten_ver') return 'audience';
        if (key === 'metacriticms') return 'metacritic';
        return key;
    }
    function hasRating(container, key) {
        return [...container.querySelectorAll('img[data-source]')].some(img => ratingGroup(img.dataset.source) === ratingGroup(key));
    }
    function supplementRatings(type, tmdbId, container, entry = {}) {
        const imdb = entry.mdblist?.imdbid || container.dataset.imdbId || findImdbIdFromPage(container);
        if (imdb) container.dataset.imdbId = imdb;
        if (imdb && (!hasRating(container, 'allocine_critics') || !hasRating(container, 'allocine_audience'))) fetchAllocineRatings(imdb, type, container);
        if (imdb && !hasRating(container, 'anilist')) fetchAniListRating(imdb, container);
        if (imdb && (!hasRating(container, 'tomatoes') || !hasRating(container, 'audience'))) fetchRottenTomatoesDirectly(imdb, type, container);
        const title = entry.mdblist?.original_title || entry.mdblist?.title || container.dataset.originalTitle;
        const year = parseInt(entry.mdblist?.year || container.dataset.year, 10);
        if (title && year && !hasRating(container, 'kinopoisk')) fetchKinopoiskRating(title, year, type, container);
        const mdbKeys = ['imdb', 'tmdb', 'tomatoes', 'audience', 'metacritic', 'metacriticus', 'trakt', 'letterboxd', 'rogerebert', 'myanimelist'];
        if (mdbKeys.some(key => isRatingProviderEnabled(key) && !hasRating(container, key))) fetchMDBListInternal(type, tmdbId, container, true);
    }

    function parseAllocineRatings(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const result = {};
        for (const title of doc.querySelectorAll('.rating-title')) {
            const label = title.textContent.trim().toLowerCase();
            const key = label === 'presse' ? 'pressScore' : label === 'spectateurs' ? 'audienceScore' : null;
            if (!key) continue;
            const section = title.closest('.rating-item');
            const value = parseFloat(section?.querySelector('.stareval-note')?.textContent.replace(',', '.'));
            if (value > 0 && value <= 5) result[key] = value.toFixed(1);
        }
        if (!result.audienceScore) {
            const visit = data => {
                if (!data || typeof data !== 'object') return;
                if (Array.isArray(data)) { data.forEach(visit); return; }
                const types = [].concat(data['@type'] || []);
                if (types.some(type => ['Movie', 'TVSeries', 'TVSeason'].includes(type))) {
                    const value = parseFloat(String(data.aggregateRating?.ratingValue ?? '').replace(',', '.'));
                    if (value > 0 && value <= 5) result.audienceScore = value.toFixed(1);
                }
                if (data['@graph']) visit(data['@graph']);
            };
            for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
                try { visit(JSON.parse(script.textContent)); } catch {}
            }
        }
        return result;
    }

    const MDBLIST_API_KEY = CONFIG.MDBLIST_API_KEY;
    const TMDB_API_KEY = CONFIG.TMDB_API_KEY;
    const KINOPOISK_API_KEY = CONFIG.KINOPOISK_API_KEY;
    const CACHE_TTL_HOURS = CONFIG.CACHE_TTL_HOURS;
    const CORS_PROXY_URL = CONFIG.CORS_PROXY_URL;

    let CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
    const CACHE_PREFIX = 'emby_ratings_v2_details_';

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
        if(!CONFIG.enableCustomRatings)return false;
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
	let CERTIFIED_FRESH_OVERRIDES = [
	    // '550',      // Fight Club
	];
	  
	let VERIFIED_HOT_OVERRIDES = [
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
		imdb: 'https://cdn.jsdelivr.net/gh/v1rusnl/EmbySpotlight@main/logo/IMDb_legacy.png',
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

	  // ══════════════════════════════════════════════════════════════════
	  // SERVER RATINGS – Load pre-computed data from Docker container
	  // ══════════════════════════════════════════════════════════════════

	  let SERVER_RATINGS = null;

      async function refreshSettings(){const c=await Shared.config();
        pluginAvailable=!!c;if(!c)return;
        const ids=v=>String(v||'').split(/[,;\s]+/).filter(x=>/^\d+$/.test(x));
        CERTIFIED_FRESH_OVERRIDES=ids(Shared.field(c,'CertifiedFreshOverrides',CERTIFIED_FRESH_OVERRIDES.join(',')));
        VERIFIED_HOT_OVERRIDES=ids(Shared.field(c,'VerifiedHotOverrides',VERIFIED_HOT_OVERRIDES.join(',')));
        CACHE_TTL_MS=Math.max(1,Number(Shared.field(c,'CacheTtlHours',168)))*3600000;
        for(const key of Object.keys(CONFIG)) if(key.startsWith('enable')&&key!=='enableAwards') CONFIG[key]=Shared.field(c,key[0].toUpperCase()+key.slice(1),CONFIG[key]);
      }
      const SERVER_RATINGS_READY=Shared.serverRatings().then(data=>{SERVER_RATINGS=data;});

	let currentImdbId = null;
	let currentTmdbData = null;

	setInterval(scanLinks, 1000);
	scanLinks();

	function findImdbIdFromPage(container) {
        const view=container?.closest('.view-item-item,.page') || document.querySelector('.view-item-item:not(.hide),.page:not(.hide)') || document;
		const imdbLink = view.querySelector(
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

		if (mediaInfoBar) setBuiltInStarsHidden(mediaInfoBar, false);

		const ratingRow = document.createElement('div');
		ratingRow.className = 'mdblist-rating-row verticalFieldItem detail-lineItem';
		ratingRow.style.cssText = 'display:flex; align-items:center; flex-wrap:wrap; gap:2px;';

		const container = document.createElement('div');
		container.className = 'mdblist-rating-container';
        container.dataset.tmdbId=tmdbId;container.dataset.type=type;
        const localImdb=pageView.querySelector('a[href*="imdb.com/title/tt"]')?.href.match(/tt\d+/)?.[0];
        if(localImdb)container.dataset.imdbId=localImdb;
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
		  setBuiltInStarsHidden(bar, !!pageView.querySelector('.mdblist-rating-container img[data-source]'));
		});
		hideSecondaryRatingContainers(pageView);
	}

	function appendRatingBadge(container, logoKey, altText, title, value) {
        if(!container.isConnected)return;
        if (!validRating(value) || !isRatingProviderEnabled(logoKey) || hasRating(container, logoKey)) return;
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
        const view=container.closest('.view-item-item,.page');
        view?.querySelectorAll('.mediaInfo.detail-mediaInfoPrimary').forEach(bar=>setBuiltInStarsHidden(bar,true));
	}

	function renderCachedRatings(cachedData, container) {
		if (!cachedData || !Array.isArray(cachedData.badges)) return;
		cachedData.badges.forEach(badge => {
		  appendRatingBadge(container, badge.logoKey, badge.alt, badge.title, badge.value);
		});
	}
	
	function getRTSlug(imdbId) {
		return new Promise((resolve) => {
			if (!imdbId) { resolve(null); return; }
			const cacheKey = `rt_slug_${imdbId}`;
			const cached = RatingsCache.get(cacheKey);
			if (cached?.slug) { resolve(cached.slug); return; }

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

	async function fetchRTCertifiedStatus(imdbId, type) {
        const server=await Shared.endpoint('RottenTomatoes',{ImdbId:imdbId,Type:type});
        if(server!==undefined)return {criticsCertified:server?.criticsCertified??null,audienceCertified:server?.audienceCertified??null};
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

	async function fetchRottenTomatoesDirectly(imdbId, type, container) {
        await refreshSettings();
        if(!CONFIG.enableRottenTomatoes)return;
        const server=await Shared.endpoint('RottenTomatoes',{ImdbId:imdbId,Type:type});
        if(server!==undefined){
            if(server?.criticsScore!=null)appendRatingBadge(container,server.criticsScore<60?'tomatoes_rotten':server.criticsCertified?'tomatoes_certified':'tomatoes','Rotten Tomatoes','Rotten Tomatoes',server.criticsScore);
            if(server?.audienceScore!=null)appendRatingBadge(container,server.audienceScore<60?'audience_rotten':server.audienceCertified?'rotten_ver':'audience','RT Audience','RT Audience',server.audienceScore);
            return;
        }
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

    const awardsStarted=new WeakMap();
    function fetchAndRenderAllAwards(imdbId,container){
        if(!CONFIG.enableAwards||!container.isConnected)return;
        const imported=SERVER_RATINGS?.[`${container.dataset.type}_${container.dataset.tmdbId}`]?.awards;
        if(!imdbId&&!Shared.validAwards(imported))return;
        if(awardsStarted.get(container)===(imdbId||'import'))return;
        awardsStarted.set(container,imdbId||'import');
        const task=Shared.validAwards(imported)?Promise.resolve(imported):Shared.awards(imdbId,CONFIG.OMDB_API_KEY);
        task.then(data=>{
            if(!container.isConnected||!Shared.validAwards(data))return;
            const ratingRow=container.closest('.mdblist-rating-row');if(!ratingRow)return;
            let row=ratingRow.parentNode.querySelector('.awards-combined-row');
            if(!row){row=document.createElement('div');row.className='awards-combined-row';row.style.cssText='display:flex;align-items:center;flex-wrap:wrap;margin-bottom:13px';ratingRow.before(row);}
            Shared.renderAwards(row,data);if(!row.childNodes.length)row.remove();
        }).catch(()=>{});
    }

    // ══════════════════════════════════════════════════════════════════
    // MDBList Main Fetch
    // ══════════════════════════════════════════════════════════════════
    async function fetchMDBList(type, tmdbId, container) {
        await Promise.all([refreshSettings(),Shared.serverRatings().then(data=>{SERVER_RATINGS=data;})]);
        if (container.isConnected === false) return;
        container.dataset.type=type;container.dataset.tmdbId=tmdbId;
        const entry=SERVER_RATINGS?.[`${type}_${tmdbId}`];
        const imdb=entry?.mdblist?.imdbid||container.dataset.imdbId||findImdbIdFromPage(container);
        if(imdb)container.dataset.imdbId=imdb;
        fetchAndRenderAllAwards(imdb,container);
        fetchMDBListInternal(type, tmdbId, container);
        // Emby can make its API client available after this script's first run.
        if(!pluginAvailable&&!MDBLIST_API_KEY&&(Number(container.dataset.pluginRetries)||0)<3){
            container.dataset.pluginRetries=String((Number(container.dataset.pluginRetries)||0)+1);
            setTimeout(()=>{if(container.isConnected)fetchMDBList(type,tmdbId,container);},4000);
        }
    }
    function fetchMDBListInternal(type, tmdbId, container, liveOnly = false) {
        container.dataset.tmdbId = tmdbId;
        container.dataset.type = type;
        const cacheKey = `mdblist_${type}_${tmdbId}`;

        // ┌─────────────────────────────────────────────────────────────┐
        // │ 1) localStorage Cache                                       │
        // └─────────────────────────────────────────────────────────────┘
        const serverFirst = SERVER_RATINGS?.[`${type}_${tmdbId}`];
        const cached = liveOnly || serverFirst?.badges?.some(b => validRating(b.value)) ? null : RatingsCache.get(cacheKey);
        if (cached?.badges?.some(b => validRating(b.value))) {
            // ★ Prüfe ob Server-Daten neuer sind als der Cache
            const serverKey = `${type}_${tmdbId}`;
            const serverEntry = liveOnly ? null : SERVER_RATINGS?.[serverKey];
            if (serverEntry?.ts && cached.serverTs && serverEntry.ts > cached.serverTs) {
                console.log(`[Ratings] Cache veraltet für ${serverKey}, nutze Server-Daten`);
                localStorage.removeItem(CACHE_PREFIX + cacheKey);
                // Nicht return → fällt durch zu Schritt 2 (Server-Daten)
            } else {
                container.dataset.originalTitle = cached.originalTitle || '';
                container.dataset.year = cached.year || '';
                renderCachedRatings(cached, container);

                supplementRatings(type, tmdbId, container, {mdblist: {imdbid: cached.imdbId}});
                return;
            }
        }

        // ┌─────────────────────────────────────────────────────────────┐
        // │ 2) SERVER RATINGS – Pre-computed by Docker container         │
        // └─────────────────────────────────────────────────────────────┘
        const serverKey = `${type}_${tmdbId}`;
        const serverEntry = liveOnly ? null : SERVER_RATINGS?.[serverKey];
        if (serverEntry?.badges?.some(b => validRating(b.value))) {
            console.log(`[Ratings] Server-Daten für ${serverKey}`);
            const mdb = serverEntry.mdblist || {};
            container.dataset.originalTitle = mdb.original_title || mdb.title || '';
            container.dataset.year = mdb.year || '';

            serverEntry.badges.forEach(badge => {
                if (isRatingProviderEnabled(badge.logoKey)) {
                    appendRatingBadge(container, badge.logoKey, badge.alt, badge.title, badge.value);
                }
            });

            // ★ Cache mit Server-Timestamp
            RatingsCache.set(cacheKey, {
                originalTitle: container.dataset.originalTitle,
                year: container.dataset.year,
                badges: serverEntry.badges,
                awards: serverEntry.awards || null,
                serverComplete: true,
                serverTs: serverEntry.ts
            });
            supplementRatings(type, tmdbId, container, serverEntry);
            return;
        }

        // ┌─────────────────────────────────────────────────────────────┐
        // │ 3) LIVE-API FALLBACK (Original-Verhalten)                   │
        // └─────────────────────────────────────────────────────────────┘
        const allocineImdb = container.dataset.imdbId || findImdbIdFromPage(container);
        if (allocineImdb) { fetchAndRenderAllAwards(allocineImdb,container); fetchAllocineRatings(allocineImdb, type, container); }
        if (allocineImdb) { fetchAndRenderAllAwards(allocineImdb,container); fetchAniListRating(allocineImdb,container); fetchRottenTomatoesDirectly(allocineImdb,type,container); }

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.mdblist.com/tmdb/${type}/${tmdbId}?apikey=${MDBLIST_API_KEY}`,
            onload(res) {
                if (res.status !== 200) return;
                let data;
                try { data = JSON.parse(res.responseText); } catch { return; }
                if (data.imdbid) container.dataset.imdbId = data.imdbid;
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
                    data.ratings.forEach(r => {
                        if (r.value == null) return;
                        const key = r.source.toLowerCase();
                        if (key === 'metacritic') { metacriticScore = r.value; metacriticVotes = r.votes; }
                        else if (key === 'tomatoes') { tomatoesScore = r.value; tomatoesVotes = r.votes; hasRTFromMDBList = true; }
                        else if (key.includes('popcorn') || key.includes('audience')) { audienceScore = r.value; audienceVotes = r.votes; hasRTFromMDBList = true; }
                    });
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
                        if (hasRating(container, key)) return;
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
                const imdbId = container.dataset.imdbId || findImdbIdFromPage(container);
                if (!hasRTFromMDBList && imdbId && CONFIG.enableRottenTomatoes) {
                    fetchRottenTomatoesDirectly(imdbId, type, container);
                }
                else if (hasRTFromMDBList && imdbId && CONFIG.enableRottenTomatoes) {
                    const needsRTScrape = (criticsBadgeImg && tomatoesScore >= 60) || (audienceBadgeImg && audienceScore >= 60);
                    if (needsRTScrape) {
                        fetchRTCertifiedStatus(imdbId, type).then(rtStatus => {
                            if (criticsBadgeImg && tomatoesScore >= 60 && rtStatus.criticsCertified !== null) {
                                if (rtStatus.criticsCertified === true && criticsBadgeImg.dataset.source !== 'tomatoes_certified') {
                                    criticsBadgeImg.src = LOGO.tomatoes_certified; criticsBadgeImg.dataset.source = 'tomatoes_certified';
                                    if (criticsBadgeCacheIndex >= 0) badgesToCache[criticsBadgeCacheIndex].logoKey = 'tomatoes_certified';
                                } else if (rtStatus.criticsCertified === false && !isCertifiedFreshOverride && criticsBadgeImg.dataset.source === 'tomatoes_certified') {
                                    criticsBadgeImg.src = LOGO.tomatoes; criticsBadgeImg.dataset.source = 'tomatoes';
                                    if (criticsBadgeCacheIndex >= 0) badgesToCache[criticsBadgeCacheIndex].logoKey = 'tomatoes';
                                }
                            }
                            if (audienceBadgeImg && audienceScore >= 60 && rtStatus.audienceCertified !== null) {
                                if (rtStatus.audienceCertified === true && audienceBadgeImg.dataset.source !== 'rotten_ver') {
                                    audienceBadgeImg.src = LOGO.rotten_ver; audienceBadgeImg.dataset.source = 'rotten_ver';
                                    if (audienceBadgeCacheIndex >= 0) badgesToCache[audienceBadgeCacheIndex].logoKey = 'rotten_ver';
                                } else if (rtStatus.audienceCertified === false && !isVerifiedHotOverride && audienceBadgeImg.dataset.source === 'rotten_ver') {
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
                if (imdbId) {
                    fetchAniListRating(imdbId, container);
                    fetchAndRenderAllAwards(imdbId, container);
                }
                const title = container.dataset.originalTitle;
                const year = parseInt(container.dataset.year, 10);
                if (title && year) fetchKinopoiskRating(title, year, type, container);
                const imdbIdForAllocine = container.dataset.imdbId || findImdbIdFromPage(container);
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
		if (cached?.id) { cb(cached.id); return; }

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

	async function fetchAniListRating(imdbId, container) {
        await refreshSettings();
        if(!CONFIG.enableAniList)return;
        const server=await Shared.endpoint('AniList',{ImdbId:imdbId});
        if(server!==undefined){if(server?.score>0)appendRatingBadge(container,'anilist','AniList',`AniList: ${server.score}`,server.score);return;}
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
		if (!CONFIG.enableKinopoisk || (!pluginAvailable && (!KINOPOISK_API_KEY || KINOPOISK_API_KEY === 'DEIN_KEY_HIER'))) return;

		const cacheKey = `kinopoisk_${type}_${title}_${year}`;
		const cached = RatingsCache.get(cacheKey);
		if (cached?.rating != null) {
		  if (cached.rating != null)
			appendRatingBadge(container, 'kinopoisk', 'Kinopoisk', `Kinopoisk: ${cached.rating}`, cached.rating);
		  return;
		}

		GM_xmlhttpRequest({
		  method: 'GET',
		  ratingType:type,
          url: `https://kinopoiskapiunofficial.tech/api/v2.2/films?keyword=${encodeURIComponent(title)}&yearFrom=${year}&yearTo=${year}`,
		  headers: { 'X-API-KEY': KINOPOISK_API_KEY, 'Content-Type': 'application/json' },
		  onload(res) {
			if (res.status !== 200) return;
			let data;
			try { data = JSON.parse(res.responseText); } catch { return; }
			const list = data.items || data.films || [];
			if (!list.length) { RatingsCache.set(cacheKey, { rating: null }); return; }
			const desired = type === 'show' ? 'TV_SERIES' : 'FILM';
			const item = list.find(i => i.type === desired && Number(i.year)===Number(year) && [i.nameOriginal,i.nameEn].some(n=>n?.toLowerCase()===title.toLowerCase()));
			if (item?.ratingKinopoisk == null) { RatingsCache.set(cacheKey, { rating: null }); return; }

			RatingsCache.set(cacheKey, { rating: item.ratingKinopoisk });
			appendRatingBadge(container, 'kinopoisk', 'Kinopoisk', `Kinopoisk: ${item.ratingKinopoisk}`, item.ratingKinopoisk);
		  }
		});
	}

	// ══════════════════════════════════════════════════════════════════
	// Allociné
	// ══════════════════════════════════════════════════════════════════

    async function getWikidataMapping(imdb) {
        if(!/^tt[0-9]+$/.test(imdb||''))return null;
        const key='wikidata_mapping_'+imdb,cached=RatingsCache.get(key);
        if(cached)return cached;
        return Shared.single('details:'+key,async()=>{
            try{
                const q=`SELECT ?item ?film ?show WHERE { ?item wdt:P345 "${imdb}" . OPTIONAL { ?item wdt:P1265 ?film . } OPTIONAL { ?item wdt:P1267 ?show . } } LIMIT 1`;
                const data=JSON.parse(await Shared.text('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q),{headers:{Accept:'application/sparql-results+json'}}));
                const row=data.results?.bindings?.[0];if(!row)return null;
                const result={item:row.item?.value?.split('/').pop(),film:row.film?.value,show:row.show?.value};
                if(!/^Q[0-9]+$/.test(result.item||''))return null;
                RatingsCache.set(key,result);return result;
            }catch{return null;}
        });
    }
    async function getAllocineId(imdbId,type) {
        const key=`allocine_id_${type}_${imdbId}`,cached=RatingsCache.get(key);
        if(cached?.id)return cached.id;
        const mapping=await getWikidataMapping(imdbId);
        const id=type==='show'?mapping?.show:mapping?.film;
        if(id)RatingsCache.set(key,{id});return id;
    }

    async function fetchAllocineRatings(imdbId, type, container) {
        if(!CONFIG.enableCustomRatings||!CONFIG.enableAllocine||!imdbId||!container.isConnected)return;
        const complete=()=>hasRating(container,'allocine_critics')&&hasRating(container,'allocine_audience');
        const render=data=>{
            if(!container.isConnected)return;
            if(data?.pressScore)appendRatingBadge(container,'allocine_critics','Allociné Presse','Allociné Presse',data.pressScore);
            if(data?.audienceScore)appendRatingBadge(container,'allocine_audience','Allociné Spectateurs','Allociné Spectateurs',data.audienceScore);
        };
        if(complete())return;
        const key=`allocine_ratings_${type}_${imdbId}`;
        const cached=RatingsCache.get(key);render(cached);
        if(complete())return;
        if(cached?.checkedAt&&Date.now()-cached.checkedAt<3600000)return;
        const result=await Shared.single('detail:'+key,async()=>{
            const server=await Shared.endpoint('Allocine',{ImdbId:imdbId,Type:type});
            let result={...cached};
            const press=Number(server?.Press??server?.press),audience=Number(server?.Audience??server?.audience);
            if(press>0&&press<=5)result.pressScore=press.toFixed(1);
            if(audience>0&&audience<=5)result.audienceScore=audience.toFixed(1);
            // A usable plugin result needs no duplicate browser scrape.
            if(press||audience){result.checkedAt=Date.now();RatingsCache.set(key,result);return result;}
            if(!CORS_PROXY_URL?.trim())return result;
            const id=await getAllocineId(imdbId,type);
            if(!id||!/^\d+$/.test(id))return result;
            const path=type==='show'?`series/ficheserie_gen_cserie=${id}`:`film/fichefilm_gen_cfilm=${id}`;
            try{
                const html=await Shared.text(CORS_PROXY_URL.trim().replace(/\/?$/, '/')+'https://www.allocine.fr/'+path+'.html');
                result={...result,...parseAllocineRatings(html),checkedAt:Date.now()};
                if(result.pressScore||result.audienceScore)RatingsCache.set(key,result);
            }catch(error){console.warn('[Ratings] Allocine '+imdbId+': '+error.message);}
            return result;
        });
        render(result);
    }

})();

})();
