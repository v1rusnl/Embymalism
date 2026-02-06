/*!
 * Emby Elsewhere Integration
 * Adapted Jellyfin JS snippet -> THX to https://github.com/n00bcodr/Jellyfin-Elsewhere
 * Shows available Streaming Providers for Library items
 * Add your TMDB API Key in line 15 and choose your settings
 * Copy script inside /system/dashboard-ui/ and add <script src="emby-elsewehre.js"></script> in index.html before </body>
 */

(function() {
    'use strict';

    /* -------------- Configuration - Edit these values -------------- */

    const TMDB_API_KEY = 'YOUR_API_KEY'; // Replace with your actual API key
    const DEFAULT_REGION = 'US'; // Default region to show results for; see list https://github.com/n00bcodr/Jellyfin-Elsewhere/blob/main/resources/regions.txt
    const DEFAULT_PROVIDERS = []; // Default providers to show (empty = show all); see list: https://github.com/n00bcodr/Jellyfin-Elsewhere/blob/main/resources/providers.txt
    const IGNORE_PROVIDERS = []; // Providers to ignore from default region (supports regex, e.g. '.*with Ads')
    
    // NEW: Include rent and buy options
    const INCLUDE_RENT = true;  // Set to false to hide rental options
    const INCLUDE_BUY = true;   // Set to false to hide purchase options

    /*---------------- End of configuration ----------------*/

    const isUserScript = typeof GM_xmlhttpRequest !== 'undefined';
    let userRegion = DEFAULT_REGION;
    let userRegions = [];
    let userServices = [];
    let availableRegions = {};
    let availableProviders = [];
    let lastProcessedId = null;

    console.log('🎬 Emby Elsewhere starting...');

    // HTTP request function that works in both environments
    function makeRequest(options) {
        if (isUserScript) {
            GM_xmlhttpRequest(options);
        } else {
            fetch(options.url, {
                method: options.method || 'GET',
                headers: options.headers || {}
            })
            .then(response => {
                if (response.ok) {
                    return response.text();
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            })
            .then(responseText => {
                if (options.onload) {
                    options.onload({
                        status: 200,
                        responseText: responseText
                    });
                }
            })
            .catch(error => {
                if (options.onerror) {
                    options.onerror(error);
                }
            });
        }
    }

    // Load regions and providers from GitHub repo
    function loadRegionsAndProviders() {
        // Load regions
        makeRequest({
            method: 'GET',
            url: 'https://raw.githubusercontent.com/n00bcodr/Jellyfin-Elsewhere/refs/heads/main/resources/regions.txt',
            onload: (response) => {
                if (response.status === 200) {
                    const lines = response.responseText.trim().split('\n');
                    lines.forEach(line => {
                        if (line.startsWith('#')) return;
                        const [code, name] = line.split('\t');
                        if (code && name) {
                            availableRegions[code] = name;
                        }
                    });
                } else {
                    setFallbackRegions();
                }
            },
            onerror: () => setFallbackRegions()
        });

        // Load providers
        makeRequest({
            method: 'GET',
            url: 'https://raw.githubusercontent.com/n00bcodr/Jellyfin-Elsewhere/refs/heads/main/resources/providers.txt',
            onload: (response) => {
                if (response.status === 200) {
                    availableProviders = response.responseText.trim().split('\n')
                        .filter(line => !line.startsWith('#') && line.trim() !== '');
                } else {
                    setFallbackProviders();
                }
            },
            onerror: () => setFallbackProviders()
        });
    }

    function setFallbackRegions() {
        availableRegions = {
            'US': 'United States',
            'GB': 'United Kingdom',
            'IN': 'India',
            'CA': 'Canada',
            'DE': 'Germany',
            'FR': 'France',
            'JP': 'Japan',
            'AU': 'Australia',
            'BR': 'Brazil',
            'MX': 'Mexico',
            'IE': 'Ireland',
            'IT': 'Italy',
            'ES': 'Spain',
            'NL': 'Netherlands',
            'SE': 'Sweden',
            'NO': 'Norway',
            'DK': 'Denmark',
            'FI': 'Finland',
            'AT': 'Austria',
            'CH': 'Switzerland'
        };
    }

    function setFallbackProviders() {
        availableProviders = [
            'Netflix', 'Amazon Prime Video', 'Disney Plus', 'HBO Max',
            'Hulu', 'Apple TV Plus', 'Paramount Plus', 'Peacock',
            'JioCinema', 'Disney+ Hotstar', 'ZEE5', 'SonyLIV'
        ];
    }

    // Create Material Icon element
    function createMaterialIcon(iconName, size = '18px') {
        const icon = document.createElement('span');
        icon.className = 'md-icon';
        icon.textContent = iconName;
        icon.style.fontSize = size;
        icon.style.lineHeight = '1';
        return icon;
    }

    // Create autocomplete input with improved keyboard navigation
    function createAutocompleteInput(placeholder, options, selectedValues, onSelect) {
        const container = document.createElement('div');
        container.style.cssText = 'position: relative; margin-bottom: 6px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.style.cssText = `
            width: 100%;
            padding: 10px;
            border: 1px solid #444;
            border-radius: 6px;
            box-sizing: border-box;
            background: #2a2a2a;
            color: #fff;
            font-size: 14px;
        `;

        const dropdown = document.createElement('div');
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: #1a1a1a;
            border: 1px solid #444;
            border-top: none;
            border-radius: 6px;
            max-height: 200px;
            overflow-y: auto;
            display: none;
            z-index: 1000;
        `;

        const selectedContainer = document.createElement('div');
        selectedContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 6px;
        `;

        let selectedIndex = -1;
        let filteredOptions = [];

        function updateSelected() {
            selectedContainer.innerHTML = '';
            selectedValues.forEach(value => {
                const tag = document.createElement('span');
                tag.className = 'selected-tag';
                tag.style.cssText = `
                    background: #0078d4;
                    color: white;
                    padding: 4px 10px;
                    border-radius: 16px;
                    font-size: 12px;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                `;
                tag.textContent = value;

                const remove = document.createElement('span');
                remove.textContent = '×';
                remove.style.cssText = 'cursor: pointer; font-weight: bold; font-size: 14px;';
                remove.onclick = () => {
                    const index = selectedValues.indexOf(value);
                    if (index > -1) {
                        selectedValues.splice(index, 1);
                        updateSelected();
                    }
                };
                tag.appendChild(remove);
                selectedContainer.appendChild(tag);
            });
        }

        function showDropdown(opts) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'block';
            filteredOptions = opts;
            selectedIndex = -1;

            opts.forEach((option, index) => {
                const item = document.createElement('div');
                item.textContent = option;
                item.style.cssText = `
                    padding: 10px;
                    cursor: pointer;
                    border-bottom: 1px solid #333;
                    color: #fff;
                    font-size: 14px;
                `;
                item.dataset.index = index;

                item.onmouseenter = () => {
                    clearSelection();
                    item.style.background = '#333';
                    selectedIndex = index;
                };

                item.onmouseleave = () => {
                    item.style.background = '#1a1a1a';
                };

                item.onclick = () => selectOption(option);
                dropdown.appendChild(item);
            });
        }

        function clearSelection() {
            dropdown.querySelectorAll('div').forEach(item => {
                item.style.background = '#1a1a1a';
            });
        }

        function updateSelection() {
            clearSelection();
            if (selectedIndex >= 0 && selectedIndex < filteredOptions.length) {
                const item = dropdown.querySelector(`[data-index="${selectedIndex}"]`);
                if (item) {
                    item.style.background = '#333';
                    item.scrollIntoView({ block: 'nearest' });
                }
            }
        }

        function selectOption(option) {
            if (!selectedValues.includes(option)) {
                selectedValues.push(option);
                updateSelected();
                onSelect(selectedValues);
            }
            input.value = '';
            dropdown.style.display = 'none';
            selectedIndex = -1;
        }

        input.oninput = () => {
            const value = input.value.toLowerCase();
            if (value.length === 0) {
                dropdown.style.display = 'none';
                return;
            }

            const filtered = options.filter(option =>
                option.toLowerCase().includes(value) && !selectedValues.includes(option)
            );
            showDropdown(filtered);
        };

        input.onkeydown = (e) => {
            if (dropdown.style.display === 'none') return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, filteredOptions.length - 1);
                    updateSelection();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, -1);
                    updateSelection();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (selectedIndex >= 0 && selectedIndex < filteredOptions.length) {
                        selectOption(filteredOptions[selectedIndex]);
                    }
                    break;
                case 'Escape':
                    dropdown.style.display = 'none';
                    selectedIndex = -1;
                    break;
            }
        };

        input.onblur = () => {
            setTimeout(() => {
                if (!dropdown.contains(document.activeElement)) {
                    dropdown.style.display = 'none';
                }
            }, 200);
        };

        container.appendChild(input);
        container.appendChild(dropdown);
        container.appendChild(selectedContainer);

        updateSelected();
        return container;
    }

    // Create settings modal with darker theme
    function createSettingsModal() {
        const existingModal = document.getElementById('streaming-settings-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'streaming-settings-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            display: none;
            z-index: 10000;
            align-items: center;
            justify-content: center;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: #181818;
            padding: 20px;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            color: #fff;
            border: 1px solid #333;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        `;

        content.innerHTML = `
            <h3 style="margin-top: 0; margin-bottom: 16px; color: #fff; font-size: 18px; font-weight: bolder;">Streaming-Einstellungen</h3>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #ccc;">Standard-Suchland</label>
                <select id="region-select" style="width: 100%; padding: 12px; border: 1px solid #444; border-radius: 6px; background: #2a2a2a; color: #fff; font-size: 14px;">
                    ${Object.entries(availableRegions).map(([code, name]) =>
                        `<option value="${code}" ${code === userRegion ? 'selected' : ''}>${name}</option>`
                    ).join('')}
                </select>
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 5px; font-weight: 600; color: #ccc;">Weitere Länder durchsuchen (leer = nur Standard)</label>
                <div id="regions-autocomplete"></div>
            </div>

           <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 6px; font-weight: 600; color: #ccc;">Anbieter (leer = alle anzeigen)</label>
                <div id="services-autocomplete"></div>
            </div>

            <div style="display: flex; gap: 12px; justify-content: flex-end;">
                <button id="cancel-settings" style="padding: 10px 18px; border: 1px solid #444; background: #2a2a2a; color: #fff; border-radius: 6px; cursor: pointer; font-size: 14px;">Abbrechen</button>
                <button id="save-settings" style="padding: 10px 18px; border: none; background: #0078d4; color: white; border-radius: 6px; cursor: pointer; font-size: 14px;">Speichern</button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Add autocomplete for regions
        const regionsContainer = content.querySelector('#regions-autocomplete');
        const regionOptions = Object.entries(availableRegions).map(([code, name]) => `${name} (${code})`);
        const regionsAutocomplete = createAutocompleteInput(
            'Land hinzufügen...',
            regionOptions,
            userRegions.map(code => `${availableRegions[code] || code} (${code})`),
            (selected) => {
                // Update temporary selection
            }
        );
        regionsContainer.appendChild(regionsAutocomplete);

        // Add autocomplete for services
        const servicesContainer = content.querySelector('#services-autocomplete');
        const servicesAutocomplete = createAutocompleteInput(
            'Anbieter hinzufügen...',
            availableProviders,
            userServices.slice(),
            (selected) => {
                // Update temporary selection
            }
        );
        servicesContainer.appendChild(servicesAutocomplete);

        // Event listeners
        document.getElementById('cancel-settings').onclick = () => {
            modal.style.display = 'none';
        };

        document.getElementById('save-settings').onclick = () => {
            userRegion = document.getElementById('region-select').value;

            // Get selected regions from autocomplete
            const selectedRegions = [];
            regionsContainer.querySelectorAll('.selected-tag').forEach(tag => {
                const text = tag.textContent.replace('×', '').trim();
                const match = text.match(/\(([A-Z]{2})\)$/);
                if (match) {
                    selectedRegions.push(match[1]);
                }
            });
            userRegions = selectedRegions;

            // Get selected services from autocomplete
            const selectedServices = [];
            servicesContainer.querySelectorAll('.selected-tag').forEach(tag => {
                selectedServices.push(tag.textContent.replace('×', '').trim());
            });
            userServices = selectedServices;

            modal.style.display = 'none';
            localStorage.setItem('streaming-settings', JSON.stringify({
                region: userRegion,
                regions: userRegions,
                services: userServices
            }));
        };

        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };
    }

    // Load saved settings
    function loadSettings() {
        const saved = localStorage.getItem('streaming-settings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                userRegion = settings.region || DEFAULT_REGION;
                userRegions = settings.regions || [];
                userServices = settings.services || [];
            } catch (e) {
                console.log('Error loading settings:', e);
            }
        }
    }

    // Get all providers from region data with combined category tags
    // Providers are collected once and tagged with ALL their available categories
    // Sorted: Flatrate/Free/Ads first, then Rent/Buy only providers
    function getAllProvidersFromRegion(regionData) {
        const providerMap = new Map(); // provider_id -> provider data with categories array

        // Category configuration with sort priority
        // Priority 1 = Streaming (shown first), Priority 2 = Transactional (shown after)
        const categoryConfig = [
            { key: 'flatrate', label: 'Stream', include: true, priority: 1 },
            { key: 'free', label: 'Kostenlos', include: true, priority: 1 },
            { key: 'ads', label: 'Mit Werbung', include: true, priority: 1 },
            { key: 'rent', label: 'Leihen', include: INCLUDE_RENT, priority: 2 },
            { key: 'buy', label: 'Kaufen', include: INCLUDE_BUY, priority: 2 }
        ];

        // Collect all providers and their categories
        categoryConfig.forEach(cat => {
            if (!cat.include) return;
            const categoryProviders = regionData[cat.key] || [];
            
            categoryProviders.forEach(provider => {
                if (providerMap.has(provider.provider_id)) {
                    // Provider already exists - add this category to its list
                    const existing = providerMap.get(provider.provider_id);
                    if (!existing.categories.includes(cat.key)) {
                        existing.categories.push(cat.key);
                    }
                    // Keep the lowest (best) priority
                    existing.sortPriority = Math.min(existing.sortPriority, cat.priority);
                } else {
                    // New provider - create entry with categories array
                    providerMap.set(provider.provider_id, {
                        ...provider,
                        categories: [cat.key],
                        sortPriority: cat.priority
                    });
                }
            });
        });

        // Convert to array
        const providers = Array.from(providerMap.values());
        
        // Sort: 
        // 1. By sortPriority (flatrate/free/ads = 1 first, rent/buy only = 2 second)
        // 2. Then by display_priority within each group
        providers.sort((a, b) => {
            if (a.sortPriority !== b.sortPriority) {
                return a.sortPriority - b.sortPriority;
            }
            return (a.display_priority || 999) - (b.display_priority || 999);
        });

        return providers;
    }

    // Check if region has any services based on config
    function hasAnyServices(regionData) {
        if (!regionData) return false;
        
        const hasFlatrate = regionData.flatrate && regionData.flatrate.length > 0;
        const hasFree = regionData.free && regionData.free.length > 0;
        const hasAds = regionData.ads && regionData.ads.length > 0;
        const hasRent = INCLUDE_RENT && regionData.rent && regionData.rent.length > 0;
        const hasBuy = INCLUDE_BUY && regionData.buy && regionData.buy.length > 0;
        
        return hasFlatrate || hasFree || hasAds || hasRent || hasBuy;
    }

    // Generate availability text based on what's available
    function getAvailabilityText(regionData, regionName) {
        if (!regionData) return `Nicht verfügbar in ${regionName}`;
        
        const hasFlatrate = regionData.flatrate && regionData.flatrate.length > 0;
        const hasFree = regionData.free && regionData.free.length > 0;
        const hasRent = INCLUDE_RENT && regionData.rent && regionData.rent.length > 0;
        const hasBuy = INCLUDE_BUY && regionData.buy && regionData.buy.length > 0;
        
        if (hasFlatrate || hasFree) {
            return `Auch verfügbar in ${regionName} auf:`;
        } else if (hasRent && hasBuy) {
            return `Zum Leihen/Kaufen in ${regionName} auf:`;
        } else if (hasRent) {
            return `Zum Leihen in ${regionName} auf:`;
        } else if (hasBuy) {
            return `Zum Kaufen in ${regionName} auf:`;
        }
        
        return `Nicht auf Streaming-Diensten in ${regionName} verfügbar`;
    }

    // Create service badge with combined category indicators (rent AND buy badges if both available)
    function createServiceBadge(service, tmdbId, mediaType) {
        const badge = document.createElement('div');
        badge.style.cssText = `
            display: inline-flex;
            align-items: center;
            padding: 6px 10px;
            margin: 3px 5px 3px 0;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            color: #fff;
            white-space: nowrap;
            transition: all 300ms ease;
            background: rgba(255, 255, 255, 0.1);
            border: 0px solid rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            position: relative;
        `;

        const logo = document.createElement('img');
        logo.src = `https://image.tmdb.org/t/p/w92${service.logo_path}`;
        logo.alt = service.provider_name;
        logo.style.cssText = `
            width: 20px;
            height: 20px;
            margin-right: 8px;
            object-fit: contain;
            border-radius: 4px;
        `;

        logo.onerror = () => logo.style.display = 'none';
        badge.appendChild(logo);

        const text = document.createElement('span');
        text.textContent = service.provider_name;
        badge.appendChild(text);

        // Check which transactional categories are available for this provider
        const categories = service.categories || [];
        const hasRent = categories.includes('rent');
        const hasBuy = categories.includes('buy');
        
        // Only show badges for rent/buy (not for flatrate/free/ads)
        if (hasRent || hasBuy) {
            const badgeContainer = document.createElement('span');
            badgeContainer.style.cssText = `
                display: inline-flex;
                gap: 3px;
                margin-left: 6px;
            `;
            
            // Add RENT badge (orange) if available
            if (hasRent) {
                const rentBadge = document.createElement('span');
                rentBadge.textContent = 'R';
                rentBadge.title = 'Zum Leihen';
                rentBadge.style.cssText = `
                    padding: 2px 5px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    background: #ff9800;
                    color: #000;
                `;
                badgeContainer.appendChild(rentBadge);
            }
            
            // Add BUY badge (green) if available
            if (hasBuy) {
                const buyBadge = document.createElement('span');
                buyBadge.textContent = 'B';
                buyBadge.title = 'Zum Kaufen';
                buyBadge.style.cssText = `
                    padding: 2px 5px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    background: #4caf50;
                    color: #fff;
                `;
                badgeContainer.appendChild(buyBadge);
            }
            
            badge.appendChild(badgeContainer);
        }

        // Hover effects
        badge.onmouseenter = () => {
            badge.style.transform = 'translateY(-2px)';
            badge.style.background = 'rgba(255, 255, 255, 0.2)';
            badge.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        };

        badge.onmouseleave = () => {
            badge.style.transform = 'translateY(0)';
            badge.style.background = 'rgba(255, 255, 255, 0.1)';
            badge.style.boxShadow = 'none';
        };

        return badge;
    }

    // Fetch streaming data
    function fetchStreamingData(tmdbId, mediaType, callback) {
        if (!TMDB_API_KEY || TMDB_API_KEY === 'YOUR_TMDB_API_KEY_HERE') {
            callback('Bitte TMDB API Key im Script eintragen');
            return;
        }

        const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`;

        makeRequest({
            method: 'GET',
            url: url,
            onload: (response) => {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        callback(null, data);
                    } catch (e) {
                        callback('Fehler beim Parsen der Antwort');
                    }
                } else {
                    callback(`API Fehler: ${response.status}`);
                }
            },
            onerror: () => callback('Netzwerkfehler')
        });
    }

    // Process streaming data for default region (auto-load)
    function processDefaultRegionData(data, tmdbId, mediaType) {
        const regionData = data.results[DEFAULT_REGION];
        const regionName = availableRegions[DEFAULT_REGION] || DEFAULT_REGION;

        const container = document.createElement('div');
        container.style.cssText = `
            margin: 1em 25px;
            padding: 12px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            border: 0px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            position: relative;
        `;

        // Create header with title and controls
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;

        // Create clickable title that links to JustWatch
        const title = document.createElement('a');

        // Check if services are available in default region
        const hasServices = hasAnyServices(regionData);

        // Update title text based on availability
        title.textContent = getAvailabilityText(regionData, regionName);

        title.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            text-decoration: none;
            cursor: pointer;
            color: #fff;
            flex: 1;
        `;

        // Add JustWatch link if available
        if (regionData && regionData.link) {
            title.href = regionData.link;
            title.target = '_blank';
            title.title = 'Auf JustWatch ansehen';
        }

        // Create controls container
        const controls = document.createElement('div');
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
        `;

        // Search button with Material Icon
        const searchButton = document.createElement('button');
        const searchIcon = createMaterialIcon('search', '16px');
        searchButton.appendChild(searchIcon);
        searchButton.appendChild(document.createTextNode(''));

        searchButton.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 0px solid rgba(255, 255, 255, 0.2);
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 300ms ease;
        `;

        searchButton.onmouseenter = () => {
            searchButton.style.background = 'rgba(255, 255, 255, 0.2)';
        };

        searchButton.onmouseleave = () => {
            searchButton.style.background = 'rgba(255, 255, 255, 0.1)';
        };

        // Settings button with Material Icon
        const settingsButton = document.createElement('button');
        const settingsIcon = createMaterialIcon('settings', '16px');
        settingsButton.appendChild(settingsIcon);

        settingsButton.title = 'Einstellungen';
        settingsButton.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 0px solid rgba(255, 255, 255, 0.2);
            padding: 6px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 300ms ease;
            width: 28px;
            height: 28px;
        `;

        settingsButton.onmouseenter = () => {
            settingsButton.style.background = 'rgba(255, 255, 255, 0.2)';
        };

        settingsButton.onmouseleave = () => {
            settingsButton.style.background = 'rgba(255, 255, 255, 0.1)';
        };

        settingsButton.onclick = () => {
            const modal = document.getElementById('streaming-settings-modal');
            if (modal) {
                modal.style.display = 'flex';
            }
        };

        controls.appendChild(searchButton);
        controls.appendChild(settingsButton);
        header.appendChild(title);
        header.appendChild(controls);
        container.appendChild(header);

        // Only show services if they exist
        if (hasServices) {
            // Get all providers with combined categories
            let services = getAllProvidersFromRegion(regionData);
            
            // Filter services based on DEFAULT_PROVIDERS
            if (DEFAULT_PROVIDERS.length > 0) {
                services = services.filter(service =>
                    DEFAULT_PROVIDERS.includes(service.provider_name)
                );
            }

            // Apply ignore list using regular expressions
            if (IGNORE_PROVIDERS.length > 0) {
                try {
                    const ignorePatterns = IGNORE_PROVIDERS.map(pattern => new RegExp(pattern, 'i'));
                    services = services.filter(service =>
                        !ignorePatterns.some(regex => regex.test(service.provider_name))
                    );
                } catch (e) {
                    console.error('Emby Elsewhere: Invalid regex in IGNORE_PROVIDERS.', e);
                }
            }

            if (services.length === 0) {
                const noServices = document.createElement('div');
                noServices.textContent = DEFAULT_PROVIDERS.length > 0
                    ? 'Keine konfigurierten Dienste verfügbar'
                    : 'Nicht auf Streaming-Diensten verfügbar';
                noServices.style.cssText = 'color: #999; font-size: 13px; margin-bottom: 12px;';
                container.appendChild(noServices);
            } else {
                const servicesContainer = document.createElement('div');
                servicesContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;';

                services.forEach(service => {
                    servicesContainer.appendChild(createServiceBadge(service, tmdbId, mediaType));
                });

                container.appendChild(servicesContainer);
            }
        }

        // Create manual result container for search results
        const resultContainer = document.createElement('div');
        resultContainer.id = 'streaming-result-container';
        container.appendChild(resultContainer);

        // Add spinning animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes emby-elsewhere-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        if (!document.querySelector('style[data-emby-elsewhere]')) {
            style.setAttribute('data-emby-elsewhere', 'true');
            document.head.appendChild(style);
        }

        // Add click handler for manual lookup (multiple regions)
        searchButton.onclick = () => {
            searchButton.disabled = true;
            searchButton.innerHTML = '';
            const loadingIcon = createMaterialIcon('refresh', '16px');
            loadingIcon.style.animation = 'emby-elsewhere-spin 1s linear infinite';
            searchButton.appendChild(loadingIcon);
            searchButton.appendChild(document.createTextNode(' Suche...'));
            searchButton.style.opacity = '0.7';
            resultContainer.innerHTML = '';

            fetchStreamingData(tmdbId, mediaType, (error, data) => {
                searchButton.disabled = false;
                searchButton.innerHTML = '';
                const searchIcon = createMaterialIcon('search', '16px');
                searchButton.appendChild(searchIcon);
                searchButton.appendChild(document.createTextNode(''));
                searchButton.style.opacity = '1';

                if (error) {
                    resultContainer.innerHTML = `<div style="color: #ff6b6b; font-size: 13px; margin-top: 8px;">Fehler: ${error}</div>`;
                    return;
                }

                // Show results for multiple regions
                const regionsToSearch = userRegions.length > 0 ? userRegions : [userRegion];

                let hasAnyResults = false;
                const unavailableRegions = [];

                regionsToSearch.forEach((region, index) => {
                    const regionData = data.results[region];
                    const regionHasServices = hasAnyServices(regionData);

                    if (regionHasServices) {
                        // Get all providers with combined categories
                        let services = getAllProvidersFromRegion(regionData);
                        
                        // Filter services based on user preferences
                        if (userServices.length > 0) {
                            services = services.filter(service =>
                                userServices.includes(service.provider_name)
                            );
                        }

                        if (services.length > 0) {
                            hasAnyResults = true;
                            const regionResult = processRegionData(data, tmdbId, mediaType, region, true);
                            if (regionResult) {
                                if (index > 0 || unavailableRegions.length > 0) {
                                    regionResult.style.marginTop = '6px';
                                }
                                resultContainer.appendChild(regionResult);
                            }
                        } else {
                            unavailableRegions.push(region);
                        }
                    } else {
                        unavailableRegions.push(region);
                    }
                });

                // Show unavailable regions first if there are any
                if (unavailableRegions.length > 0) {
                    const unavailableContainer = createUnavailableRegionsDisplay(unavailableRegions);
                    resultContainer.insertBefore(unavailableContainer, resultContainer.firstChild);
                }

                // If no results found anywhere, show a general message
                if (!hasAnyResults && unavailableRegions.length === 0) {
                    const noServices = document.createElement('div');
                    noServices.style.cssText = 'color: #6c757d; font-size: 13px; margin-top: 8px;';
                    noServices.textContent = 'Keine Streaming-Dienste in ausgewählten Regionen verfügbar';
                    resultContainer.appendChild(noServices);
                }
            });
        };

        return container;
    }

    // Create display for unavailable regions
    function createUnavailableRegionsDisplay(unavailableRegions) {
        const container = document.createElement('div');
        container.style.cssText = `
            margin: 0 0 6px 0;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid rgba(139, 19, 19, 0.6);
            background: rgba(139, 19, 19, 0.3);
            backdrop-filter: blur(10px);
            position: relative;
        `;

        // Create header with title and close button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0;
        `;

        const title = document.createElement('div');
        const regionNames = unavailableRegions.map(region => availableRegions[region] || region);
        const regionText = regionNames.length === 1 ? regionNames[0] :
                          regionNames.length === 2 ? regionNames.join(' und ') :
                          regionNames.slice(0, -1).join(', ') + ' und ' + regionNames[regionNames.length - 1];

        title.textContent = `Nicht auf Streaming-Diensten in ${regionText} verfügbar`;
        title.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            color: rgb(255, 80, 80);
            flex: 1;
        `;

        // Create close button
        const closeButton = document.createElement('button');
        const closeIcon = createMaterialIcon('close', '16px');
        closeButton.appendChild(closeIcon);
        closeButton.title = 'Schließen';
        closeButton.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 0px solid rgba(255, 255, 255, 0.2);
            padding: 6px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 300ms ease;
            width: 28px;
            height: 28px;
        `;

        closeButton.onmouseenter = () => {
            closeButton.style.background = 'rgba(255, 0, 0, 0.2)';
            closeButton.style.borderColor = 'rgba(255, 0, 0, 0.3)';
        };

        closeButton.onmouseleave = () => {
            closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
            closeButton.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        };

        closeButton.onclick = () => {
            container.remove();
        };

        header.appendChild(title);
        header.appendChild(closeButton);
        container.appendChild(header);

        return container;
    }

    // Process streaming data for a specific region
    function processRegionData(data, tmdbId, mediaType, region, showAvailable = false) {
        const regionData = data.results[region];
        if (!regionData || !hasAnyServices(regionData)) {
            return null;
        }

        // Get all providers with combined categories
        let services = getAllProvidersFromRegion(regionData);
        
        // Filter services based on user preferences
        services = services.filter(service =>
            userServices.length === 0 || userServices.includes(service.provider_name)
        );

        // Don't show container if no services match filters
        if (services.length === 0) {
            return null;
        }

        const container = document.createElement('div');
        container.style.cssText = `
            margin: 10px 0 0 0;
            padding: 12px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            border: 0px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            position: relative;
        `;

        // Create header with title and close button
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;

        // Create clickable title that links to JustWatch
        const title = document.createElement('a');
        const regionName = availableRegions[region] || region;
        
        // Determine title based on what's available
        const hasFlatrate = regionData.flatrate && regionData.flatrate.length > 0;
        const hasFree = regionData.free && regionData.free.length > 0;
        const hasRent = INCLUDE_RENT && regionData.rent && regionData.rent.length > 0;
        const hasBuy = INCLUDE_BUY && regionData.buy && regionData.buy.length > 0;
        
        if (hasFlatrate || hasFree) {
            title.textContent = `Verfügbar in ${regionName} auf:`;
        } else if (hasRent && hasBuy) {
            title.textContent = `Zum Leihen/Kaufen in ${regionName} auf:`;
        } else if (hasRent) {
            title.textContent = `Zum Leihen in ${regionName} auf:`;
        } else if (hasBuy) {
            title.textContent = `Zum Kaufen in ${regionName} auf:`;
        } else {
            title.textContent = `Verfügbar in ${regionName} auf:`;
        }
        
        title.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            text-decoration: none;
            cursor: pointer;
            color: #fff;
            flex: 1;
        `;

        // Add JustWatch link if available and enabled
        if (regionData.link) {
            title.href = regionData.link;
            title.target = '_blank';
            title.title = 'Auf JustWatch ansehen';
        }

        // Create close button
        const closeButton = document.createElement('button');
        const closeIcon = createMaterialIcon('close', '16px');
        closeButton.appendChild(closeIcon);
        closeButton.title = 'Schließen';
        closeButton.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            border: 0px solid rgba(255, 255, 255, 0.2);
            padding: 6px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 300ms ease;
            width: 28px;
            height: 28px;
        `;

        closeButton.onmouseenter = () => {
            closeButton.style.background = 'rgba(255, 0, 0, 0.2)';
            closeButton.style.borderColor = 'rgba(255, 0, 0, 0.3)';
        };

        closeButton.onmouseleave = () => {
            closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
            closeButton.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        };

        closeButton.onclick = () => {
            container.remove();
        };

        header.appendChild(title);
        header.appendChild(closeButton);
        container.appendChild(header);

        const servicesContainer = document.createElement('div');
        servicesContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 3px;';

        services.forEach(service => {
            servicesContainer.appendChild(createServiceBadge(service, tmdbId, mediaType));
        });

        container.appendChild(servicesContainer);

        return container;
    }

    // Get TMDB ID from Emby detail page
    function getTmdbInfoFromPage(detailPage) {
        // Method 1: Search in itemLinks section (most reliable based on HTML structure)
        const selectors = ['.itemLinks', '.linksSection', '.aboutSection'];
        for (const selector of selectors) {
            const section = detailPage.querySelector(selector);
            if (section) {
                const tmdbLink = section.querySelector('a[href*="themoviedb.org"]');
                if (tmdbLink) {
                    const match = tmdbLink.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
                    if (match) {
                        return { mediaType: match[1], tmdbId: match[2] };
                    }
                }
            }
        }

        // Method 2: Search anywhere in the detail page
        const allLinks = detailPage.querySelectorAll('a[href*="themoviedb.org"]');
        for (const link of allLinks) {
            const match = link.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
            if (match) {
                return { mediaType: match[1], tmdbId: match[2] };
            }
        }

        return null;
    }

    // Find the insertion point for Emby - after overview, before cast/people section
    function findInsertionPoint(detailPage) {
        // Priority 1: Insert before peopleSection (cast)
        const peopleSection = detailPage.querySelector('.peopleSection');
        if (peopleSection && peopleSection.parentNode) {
            return { element: peopleSection, position: 'before' };
        }

        // Priority 2: Insert after directors
        const directorsSection = detailPage.querySelector('.directors');
        if (directorsSection && directorsSection.parentNode) {
            return { element: directorsSection, position: 'after' };
        }

        // Priority 3: Insert after overview
        const overviewContainer = detailPage.querySelector('.overview-container');
        if (overviewContainer && overviewContainer.parentNode) {
            return { element: overviewContainer, position: 'after' };
        }

        // Fallback: Look for detailTextContainer
        const detailTextContainer = detailPage.querySelector('.detailTextContainer');
        if (detailTextContainer) {
            return { element: detailTextContainer, position: 'append' };
        }

        return null;
    }

    // Process a detail page
    function processDetailPage(detailPage) {
        // Skip if page is hidden
        if (!detailPage || detailPage.classList.contains('hide')) {
            return;
        }

        // Skip if already processed
        if (detailPage.querySelector('.streaming-lookup-container')) {
            return;
        }

        // Get TMDB info from the page
        const tmdbInfo = getTmdbInfoFromPage(detailPage);
        if (!tmdbInfo) {
            console.log('🎬 Emby Elsewhere: Kein TMDB-Link auf dieser Seite gefunden');
            return;
        }

        // Prevent duplicate processing for same content
        const pageId = `${tmdbInfo.mediaType}-${tmdbInfo.tmdbId}`;
        if (lastProcessedId === pageId && detailPage.querySelector('.streaming-lookup-container')) {
            return;
        }
        lastProcessedId = pageId;

        const { mediaType, tmdbId } = tmdbInfo;
        console.log(`🎬 Emby Elsewhere: Verarbeite TMDB ${mediaType}/${tmdbId}`);

        // Create container
        const container = document.createElement('div');
        container.className = 'streaming-lookup-container verticalFieldItem';
        container.style.cssText = 'margin: -1em 1.2em;';

        // Find insertion point
        const insertionPoint = findInsertionPoint(detailPage);

        if (insertionPoint) {
            const { element, position } = insertionPoint;

            switch (position) {
                case 'before':
                    element.parentNode.insertBefore(container, element);
                    break;
                case 'after':
                    if (element.nextSibling) {
                        element.parentNode.insertBefore(container, element.nextSibling);
                    } else {
                        element.parentNode.appendChild(container);
                    }
                    break;
                case 'append':
                default:
                    element.appendChild(container);
                    break;
            }
            console.log('🎬 Emby Elsewhere: Container eingefügt');
        } else {
            console.log('🎬 Emby Elsewhere: Kein Einfügepunkt gefunden');
            return;
        }

        // Auto-load streaming data for default region
        fetchStreamingData(tmdbId, mediaType, (error, data) => {
            if (error) {
                const errorDiv = document.createElement('div');
                errorDiv.style.cssText = `
                    font-size: 13px;
                    margin-top: 8px;
                    color: #ff6b6b;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 8px;
                `;
                errorDiv.textContent = `Fehler: ${error}`;
                container.appendChild(errorDiv);
                return;
            }

            // Show default region results automatically
            const defaultResult = processDefaultRegionData(data, tmdbId, mediaType);
            if (defaultResult) {
                container.appendChild(defaultResult);
            }
        });
    }

    // Check for visible detail page
    function checkForDetailPage() {
        // Find visible detail page (not hidden)
        const detailPages = document.querySelectorAll('.view-item-item');
        for (const page of detailPages) {
            if (!page.classList.contains('hide')) {
                processDetailPage(page);
                return;
            }
        }
    }

    // Setup observer for SPA navigation
    function setupObserver() {
        let debounceTimer = null;

        const debouncedCheck = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkForDetailPage, 300);
        };

        // Watch for DOM changes and class attribute changes
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check for class changes (hide being removed from detail page)
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.classList && target.classList.contains('view-item-item') && !target.classList.contains('hide')) {
                        // Detail page became visible
                        setTimeout(() => processDetailPage(target), 300);
                    }
                }

                // Check for new nodes being added
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;

                        // Check if it's a detail page
                        if (node.classList && node.classList.contains('view-item-item')) {
                            setTimeout(() => processDetailPage(node), 300);
                        }
                        // Check if it contains a detail page
                        else if (node.querySelector) {
                            const detailPage = node.querySelector('.view-item-item:not(.hide)');
                            if (detailPage) {
                                setTimeout(() => processDetailPage(detailPage), 300);
                            }
                        }

                        // Check for content updates (itemLinks being added)
                        if (node.classList && (
                            node.classList.contains('itemLinks') ||
                            node.classList.contains('linksSection') ||
                            node.classList.contains('peopleSection')
                        )) {
                            debouncedCheck();
                        }
                        else if (node.querySelector && node.querySelector('.itemLinks, .linksSection')) {
                            debouncedCheck();
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Watch for hash changes (Emby uses hash-based routing)
        window.addEventListener('hashchange', () => {
            lastProcessedId = null; // Reset to allow re-processing
            setTimeout(checkForDetailPage, 500);
        });

        // Watch for popstate (browser back/forward)
        window.addEventListener('popstate', () => {
            lastProcessedId = null;
            setTimeout(checkForDetailPage, 500);
        });

        // Try to hook into Emby's event system
        document.addEventListener('viewshow', () => {
            setTimeout(checkForDetailPage, 500);
        });

        document.addEventListener('pageshow', () => {
            setTimeout(checkForDetailPage, 500);
        });

        // Hook into Emby's require system if available
        if (window.require) {
            try {
                window.require(['events'], function(events) {
                    if (events && events.on) {
                        events.on(window.ApiClient || {}, 'viewshow', () => {
                            setTimeout(checkForDetailPage, 500);
                        });
                    }
                });
            } catch (e) {
                // Ignore errors
            }
        }
    }

    // Initialize
    loadRegionsAndProviders();
    loadSettings();

    // Wait for regions and providers to load before creating modal
    setTimeout(() => {
        createSettingsModal();
    }, 2000);

    // Setup observer for SPA navigation
    setupObserver();

    // Initial scan
    setTimeout(checkForDetailPage, 1000);

    // Periodic fallback check (less frequent)
    setInterval(checkForDetailPage, 5000);

    console.log('🎬 Emby Elsewhere geladen!');

    // Export for embedded mode
    if (!isUserScript) {
        window.EmbyElsewhere = {
            init: () => {
                loadRegionsAndProviders();
                loadSettings();
                setTimeout(createSettingsModal, 2000);
                setupObserver();
                setTimeout(checkForDetailPage, 1000);
            },
            refresh: checkForDetailPage
        };
    }
})();