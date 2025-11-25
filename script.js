let imagesData = {};
let traitsData = {};
let kamiStatsData = {};
let selectedIDs = new Set();
let allNFTIds = [];
let filteredNFTIds = [];
let currentLoadIndex = 0;
let traitCounts = {};
let nftRarityScores = {};
let currentSortOrder = 'latest';
let isFiltering = false;
let nftObserver = null;
const INITIAL_LOAD_COUNT = 50;
const LAZY_LOAD_COUNT = 30;
let isLoading = false;
let metadataInfo = {};
let isRefreshing = false;

// Cache-busting timestamp generator
function getCacheBuster() {
    return new Date().getTime();
}

// Smooth loader display
function showLoader() {
    const loader = document.querySelector('.loader');
    loader.style.display = 'block';
    loader.style.opacity = '1';
}

function hideLoader() {
    const loader = document.querySelector('.loader');
    loader.style.opacity = '0';
    setTimeout(() => {
        loader.style.display = 'none';
    }, 300);
}

function showContainer() {
    const container = document.querySelector('.container');
    container.style.display = 'block';
    setTimeout(() => {
        container.style.opacity = '1';
    }, 50);
}

// Helper function to get trait name from data (handles both old and new format)
function getTraitName(traitData) {
    return typeof traitData === 'string' ? traitData : traitData.name;
}

// --- NEW URL Management Functions ---

/**
 * Reads the current state (filters, sort, selected IDs) and updates the URL using history.pushState().
 */
function updateURL() {
    const params = new URLSearchParams();

    // 1. Get selected traits (Filters)
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;

        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });

    Object.entries(selectedTraits).forEach(([type, values]) => {
        // Encode filters: 'type=value1|value2'
        params.set(type, values.join('|'));
    });

    // 2. Get Sort Order
    if (currentSortOrder !== 'latest') {
        params.set('sort', currentSortOrder);
    }

    // 3. Get Selected IDs (Search/Comparison)
    if (selectedIDs.size > 0) {
        params.set('select', Array.from(selectedIDs).join(','));
    }

    // FIX: Only append '?' if there are parameters
    const queryString = params.toString();
    let newUrl = window.location.pathname;

    if (queryString.length > 0) {
        newUrl += `?${queryString}`;
    }

    history.pushState({}, '', newUrl);
}

/**
 * Reads the URL parameters and applies the state (filters, sort, selected IDs) on page load.
 */
function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);

    // --- 1. Load Selected IDs (Comparison) ---
    const selectParam = params.get('select');
    if (selectParam) {
        selectParam.split(',').forEach(id => {
            // Only add if data exists, to prevent errors on invalid IDs
            if (id && traitsData[id]) { 
                selectedIDs.add(id);
            }
        });
        // Display is updated in loadData after controls are created
    }

    // --- 2. Load Sort Order ---
    const sortParam = params.get('sort');
    if (sortParam) {
        const sortButton = document.querySelector(`.sort-btn[data-sort="${sortParam}"]`);
        if (sortButton) {
            currentSortOrder = sortParam;
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            sortButton.classList.add('active');
        }
    }

    // --- 3. Load Traits (Filters) ---
    let filtersApplied = false;
    params.forEach((value, key) => {
        // If the key is not 'sort' or 'select', assume it's a trait category
        if (key !== 'sort' && key !== 'select') {
            const traitType = key;
            const traitValues = value.split('|');

            traitValues.forEach(traitValue => {
                const checkbox = document.querySelector(
                    // Ensure the trait value is properly selected, often lowercased or exact
                    `.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`
                );
                if (checkbox) {
                    checkbox.checked = true;
                    filtersApplied = true;
                }
            });
        }
    });

    // If filters were applied, trigger the filtering logic, skipping URL update
    if (filtersApplied) {
        // Re-sorting is implicitly handled by getSortedNFTIds called within filterByTraits
        filterByTraits(true); 
        return true; // Indicate filters were loaded
    }
    return false; // Indicate no filters were loaded
}

// Listener for back/forward navigation
window.addEventListener('popstate', () => {
    // Clear current state first
    document.querySelectorAll('.trait-checkbox:checked').forEach(cb => cb.checked = false);
    selectedIDs.clear();
    
    // Re-load state from the new URL
    const filtersLoaded = loadStateFromURL();
    updateSelectedIDsDisplay(); 

    // Re-apply sorting/loading if no filters were present in the URL
    if (!filtersLoaded) {
        const params = new URLSearchParams(window.location.search);
        const sortParam = params.get('sort') || 'latest';
        
        // Reset sort button state
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        const sortButton = document.querySelector(`.sort-btn[data-sort="${sortParam}"]`);
        if (sortButton) {
            sortButton.classList.add('active');
        }
        
        currentSortOrder = sortParam;
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
    }
});


// Calculate trait occurrence counts
function calculateTraitCounts() {
    const counts = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            
            if (!counts[category]) {
                counts[category] = {};
            }
            if (!counts[category][traitName]) {
                counts[category][traitName] = 0;
            }
            counts[category][traitName]++;
        });
    });
    
    return counts;
}

// OpenRarity implementation
function calculateRarityScores() {
    const totalNFTs = Object.keys(traitsData).length;
    const scores = {};
    
    // Step 1: Calculate Information Content (IC) for each trait
    // IC = -log(probability) where probability = trait_count / total_nfts
    const traitIC = {};
    Object.entries(traitCounts).forEach(([category, traits]) => {
        traitIC[category] = {};
        Object.entries(traits).forEach(([traitName, count]) => {
            const probability = count / totalNFTs;
            // Information Content: higher IC = rarer trait
            traitIC[category][traitName] = -Math.log(probability);
        });
    });
    
    // Step 2: Calculate max IC per trait category for normalization
    const maxICPerCategory = {};
    Object.entries(traitIC).forEach(([category, traits]) => {
        maxICPerCategory[category] = Math.max(...Object.values(traits));
    });
    
    // Step 3: Calculate normalized rarity score for each NFT
    Object.entries(traitsData).forEach(([id, traits]) => {
        let normalizedScore = 0;
        
        Object.entries(traits).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            const ic = traitIC[category][traitName];
            const maxIC = maxICPerCategory[category];
            
            // Normalize IC by dividing by max IC in category
            // This ensures each trait category contributes equally
            const normalizedIC = ic / maxIC;
            normalizedScore += normalizedIC;
        });
        
        // Average across all trait categories for final score
        const numTraitCategories = Object.keys(traits).length;
        scores[id] = normalizedScore / numTraitCategories;
    });
    
    // Step 4: Rank NFTs by score (higher score = rarer)
    const sortedByScore = Object.entries(scores)
        .sort((a, b) => b[1] - a[1]);
    
    const rankedScores = {};
    sortedByScore.forEach(([id, score], index) => {
        rankedScores[id] = {
            score: score,
            rank: index + 1
        };
    });
    
    return rankedScores;
}

// Get sorted NFT IDs based on current sort order (with stats support)
function getSortedNFTIds(idsToSort) {
    const ids = idsToSort || Object.keys(traitsData);
    
    switch(currentSortOrder) {
        case 'latest':
            return ids.sort((a, b) => Number(b) - Number(a));
        case 'oldest':
            return ids.sort((a, b) => Number(a) - Number(b));
        case 'rarity':
            // Rarity rank is 1-indexed (lower rank = rarer)
            return ids.sort((a, b) => {
                return (nftRarityScores[a]?.rank || Infinity) - (nftRarityScores[b]?.rank || Infinity);
            });
        case 'harmony':
            return ids.sort((a, b) => {
                const statA = kamiStatsData[a]?.stats.harmony || 0;
                const statB = kamiStatsData[b]?.stats.harmony || 0;
                return statB - statA;
            });
        case 'health':
            return ids.sort((a, b) => {
                const statA = kamiStatsData[a]?.stats.health || 0;
                const statB = kamiStatsData[b]?.stats.health || 0;
                return statB - statA;
            });
        case 'power':
            return ids.sort((a, b) => {
                const statA = kamiStatsData[a]?.stats.power || 0;
                const statB = kamiStatsData[b]?.stats.power || 0;
                return statB - statA;
            });
        case 'violence':
            return ids.sort((a, b) => {
                const statA = kamiStatsData[a]?.stats.violence || 0;
                const statB = kamiStatsData[b]?.stats.violence || 0;
                return statB - statA;
            });
        default:
            return ids.sort((a, b) => Number(b) - Number(a));
    }
}

// Setup sort button event listeners
function setupSortButtons() {
    const sortButtons = document.querySelectorAll('.sort-btn');
    
    // Ensure the currentSortOrder is visually active on initial setup (may be set by URL load)
    sortButtons.forEach(b => {
        if (b.dataset.sort === currentSortOrder) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newSort = e.target.dataset.sort;
            if (newSort === currentSortOrder) return;
            
            currentSortOrder = newSort;
            
            sortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // --- MODIFIED: Update URL after sorting ---
            updateURL(); 
            // ------------------------------------------

            if (isFiltering) {
                filterByTraits();
            } else {
                allNFTIds = getSortedNFTIds();
                loadInitialNFTs();
            }
        });
    });
}

// Enhanced fetch function with cache-busting and proper headers
async function fetchWithCacheBusting(url, options = {}) {
    const cacheBuster = getCacheBuster();
    const urlWithCacheBuster = `${url}?v=${cacheBuster}`;
    
    const fetchOptions = {
        ...options,
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            ...options.headers
        },
        cache: 'no-store'
    };
    
    return fetch(urlWithCacheBuster, fetchOptions);
}

// Load JSON files with cache-busting
async function loadData() {
    try {
        console.log('📄 Loading data with cache-busting...');
        showLoader(); // Ensure loader is visible during async operations
        
        const imagesResponse = await fetchWithCacheBusting('kamiImage.json');
        if (!imagesResponse.ok) {
            throw new Error(`Failed to load kamiImage.json: ${imagesResponse.status}`);
        }
        
        const traitsResponse = await fetchWithCacheBusting('kamiTraits.json');
        if (!traitsResponse.ok) {
            throw new Error(`Failed to load kamiTraits.json: ${traitsResponse.status}`);
        }
        
        try {
            const statsResponse = await fetchWithCacheBusting('kamiStats.json');
            if (statsResponse.ok) {
                kamiStatsData = await statsResponse.json();
                console.log(`✅ Loaded stats data for ${Object.keys(kamiStatsData).length} Kamigotchi`);
            } else {
                console.log('ℹ️  Stats file not found - stat sorting disabled');
                kamiStatsData = {};
            }
        } catch (statsError) {
            console.log('ℹ️  Could not load stats:', statsError.message);
            kamiStatsData = {};
        }
        
        try {
            const metadataResponse = await fetchWithCacheBusting('kamiMetadata.json');
            if (metadataResponse.ok) {
                metadataInfo = await metadataResponse.json();
                console.log(`✨ Found ${metadataInfo.newKamiIds?.length || 0} new Kamigotchi!`);
                if (metadataInfo.newKamiIds?.length > 0) {
                    console.log(`   New IDs: ${metadataInfo.newKamiIds.join(', ')}`);
                }
            } else {
                console.log('ℹ️  No metadata file found, NEW badges disabled');
                metadataInfo = { newKamiIds: [] };
            }
        } catch (metaError) {
            console.log('ℹ️  Could not load metadata:', metaError.message);
            metadataInfo = { newKamiIds: [] };
        }
        
        imagesData = await imagesResponse.json();
        traitsData = await traitsResponse.json();
        
        console.log(`✅ Loaded ${Object.keys(imagesData).length} images`);
        console.log(`✅ Loaded ${Object.keys(traitsData).length} trait sets`);
        
        traitCounts = calculateTraitCounts();
        console.log('🔢 Calculating OpenRarity scores...');
        nftRarityScores = calculateRarityScores();
        console.log('✅ OpenRarity calculation complete!');
        
        // Setup controls before loading state
        setupSortButtons();
        createFilterControls();
        
        // --- MODIFIED: Load state from URL after controls are built ---
        const filtersLoaded = loadStateFromURL();
        updateSelectedIDsDisplay(); // Always update comparison display
        
        // If filters were loaded, loadInitialNFTs is called within loadStateFromURL -> filterByTraits
        // If no filters were loaded, we use the sort order set by the URL (or default 'latest')
        if (!filtersLoaded) {
            allNFTIds = getSortedNFTIds();
            loadInitialNFTs();
        }
        // -------------------------------------------------------------
        
    } catch (error) {
        console.error('Detailed error:', error);
        document.getElementById('results').innerHTML = 
            `<div class="no-results">
                <strong>Error loading NFT data</strong><br><br>
                ${error.message}<br><br>
                <strong>Troubleshooting:</strong><br>
                1. Make sure you're running a local server (not opening HTML directly)<br>
                2. Check that kamiImage.json and kamiTraits.json are in the same folder<br>
                3. Check the browser console (F12) for more details<br>
                4. Try clicking the refresh button
            </div>`;
    } finally {
        hideLoader();
        showContainer();
    }
}

// Refresh data without reloading entire page
async function refreshData() {
    if (isRefreshing) return;
    
    isRefreshing = true;
    const refreshBtn = document.getElementById('refreshDataBtn');
    const originalText = refreshBtn.innerHTML;
    
    refreshBtn.disabled = true;
    
    try {
        console.log('🔄 Refreshing data...');
        
        // Save current state for restoration after refresh
        const currentFilters = [];
        document.querySelectorAll('.trait-checkbox:checked').forEach(cb => {
            currentFilters.push({
                type: cb.dataset.traitType,
                value: cb.dataset.traitValue
            });
        });
        const currentSelectedIDs = Array.from(selectedIDs);
        
        // Reload all data
        const imagesResponse = await fetchWithCacheBusting('kamiImage.json');
        const traitsResponse = await fetchWithCacheBusting('kamiTraits.json');
        
        if (!imagesResponse.ok || !traitsResponse.ok) {
            throw new Error('Failed to fetch updated data');
        }
        
        imagesData = await imagesResponse.json();
        traitsData = await traitsResponse.json();
        
        // Reload optional files
        try {
            const statsResponse = await fetchWithCacheBusting('kamiStats.json');
            if (statsResponse.ok) {
                kamiStatsData = await statsResponse.json();
            }
        } catch (e) {
            console.log('Stats not updated');
        }
        
        try {
            const metadataResponse = await fetchWithCacheBusting('kamiMetadata.json');
            if (metadataResponse.ok) {
                metadataInfo = await metadataResponse.json();
            }
        } catch (e) {
            console.log('Metadata not updated');
        }
        
        // Recalculate everything with OpenRarity
        traitCounts = calculateTraitCounts();
        console.log('🔢 Recalculating OpenRarity scores...');
        nftRarityScores = calculateRarityScores();
        console.log('✅ OpenRarity recalculation complete!');
        // Do not update allNFTIds here, let filter/loadInitial handle it based on current sort
        
        // Rebuild filter controls with updated data
        const filterControls = document.getElementById('filterControls');
        filterControls.innerHTML = '';
        createFilterControls();
        
        // Restore filters 
        currentFilters.forEach(filter => {
            const checkbox = document.querySelector(
                // Use traitValue.toLowerCase() if filterTraitOptions uses lowercase, but here we assume original case from dataset is needed for comparison
                `.trait-checkbox[data-trait-type="${filter.type}"][data-trait-value="${filter.value}"]`
            );
            if (checkbox) {
                checkbox.checked = true;
            }
        });
        
        // Restore comparison IDs
        selectedIDs.clear();
        currentSelectedIDs.forEach(id => {
            if (traitsData[id]) selectedIDs.add(id);
        });
        updateSelectedIDsDisplay();
        
        // Reload display
        if (currentFilters.length > 0) {
            filterByTraits(); // This internally calls getSortedNFTIds and loads
        } else {
            isFiltering = false;
            allNFTIds = getSortedNFTIds(Object.keys(traitsData)); // Ensure allNFTIds is sorted correctly
            loadInitialNFTs();
        }
        
        // --- ADDED: Update URL to reflect clean state after refresh (including sort) ---
        updateURL();
        // -------------------------------------------------------------------------------
        
        console.log('✅ Data refreshed successfully!');
        
        // Show success feedback
        refreshBtn.innerHTML = `<svg id="refreshComplete" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><mask id="SVGkzXYXbbR"><g fill="none" stroke="#fff" stroke-dasharray="24" stroke-dashoffset="24" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.4s" values="24;0"/></path><path stroke="#000" stroke-width="6" d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path><path d="M7.5 13.5l4 4l10.75 -10.75"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.4s" dur="0.4s" values="24;0"/></path></g></mask><rect width="24" height="24" fill="currentColor" mask="url(#SVGkzXYXbbR)"/></svg>`;
        setTimeout(() => {
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            refreshBtn.style.opacity = '1';
            isRefreshing = false;
        }, 2000);
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        alert('Failed to refresh data. Please try again.');
        refreshBtn.innerHTML = originalText;
        refreshBtn.disabled = false;
        refreshBtn.style.opacity = '1';
        isRefreshing = false;
    }
}

function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    // Clear only the cards, keep the header if it exists
    const existingHeader = resultsDiv.querySelector('.count-header');
    if (existingHeader) {
        // Remove everything but the header if it exists
        while (resultsDiv.children.length > 1) {
            resultsDiv.removeChild(resultsDiv.lastChild);
        }
    } else {
        resultsDiv.textContent = '';
    }
    
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    
    const title = isFiltering ? 'Found matching Kamigotchi' : 'Showing all Kamigotchi';
    const countDiv = createCountHeader(idsToDisplay.length, title);
    
    if (!existingHeader) {
        resultsDiv.appendChild(countDiv);
    } else {
        // Update existing header count
        const countSpan = existingHeader.querySelector('div:first-child');
        if (countSpan) countSpan.textContent = `${title}: ${idsToDisplay.length}`;
        
        // ⚠️ FIX: Explicitly remove the filter summary container when no filters are active (isFiltering is false)
        const summaryContainer = existingHeader.querySelector('.filter-summary-buttons-container');
        if (summaryContainer) {
            summaryContainer.remove();
        }
    }
    
    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function loadMoreNFTs() {
    if (isLoading) return;
    
    isLoading = true;
    const resultsDiv = document.getElementById('results');
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    const endIndex = Math.min(currentLoadIndex + LAZY_LOAD_COUNT, idsToDisplay.length);
    
    requestAnimationFrame(() => {
        const fragment = document.createDocumentFragment();
        
        for (let i = currentLoadIndex; i < endIndex; i++) {
            const card = displayNFT(idsToDisplay[i], false);
            if (card) fragment.appendChild(card);
        }
        
        resultsDiv.appendChild(fragment);
        currentLoadIndex = endIndex;
        isLoading = false;
        updateLoadingIndicator();
    });
}

function createLoadingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'loadingIndicator';
    indicator.className = 'loading-indicator';
    indicator.innerHTML = 'Loading more Kamigotchi...';
    indicator.style.display = 'none';
    return indicator;
}

function updateLoadingIndicator() {
    let indicator = document.getElementById('loadingIndicator');
    
    if (!indicator) {
        indicator = createLoadingIndicator();
        document.getElementById('results').appendChild(indicator);
    }
    
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    if (currentLoadIndex >= idsToDisplay.length) {
        indicator.style.display = 'none';
    } else {
        indicator.style.display = 'block';
    }
}

function setupInfiniteScroll() {
    if (nftObserver) {
        nftObserver.disconnect();
    }
    
    nftObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
            if (entry.isIntersecting && currentLoadIndex < idsToDisplay.length && !isLoading) {
                loadMoreNFTs();
            }
        });
    }, {
        rootMargin: '200px'
    });
    
    const observeLastCard = () => {
        // Find the last actual NFT card, excluding headers/indicators
        const cards = document.querySelectorAll('.nft-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            // Disconnect and reconnect to the new last card
            nftObserver.disconnect();
            nftObserver.observe(lastCard);
        }
    };
    
    // Original implementation for loadMoreNFTs, modified to ensure the observer is updated
    const originalLoadMore = loadMoreNFTs;
    loadMoreNFTs = function() {
        // Disconnect observer before adding new elements
        if (nftObserver) nftObserver.disconnect();

        originalLoadMore.call(this); // Execute the original loading logic
        
        // Re-observe the new last card after the DOM update
        requestAnimationFrame(() => {
            setTimeout(observeLastCard, 50); // Small delay to ensure all DOM elements are rendered
        });
    };

    // Call initially to observe the first set
    observeLastCard();
}

function createCountHeader(count, title) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
        <div class="note">** dear mobile user, click card to show og stats **<div>
    `;
    return countDiv;
}

function removeSelectedTrait(event) {
    const btn = event.currentTarget;
    const traitType = btn.dataset.traitType;
    const traitValue = btn.dataset.traitValue;
    
    const checkbox = document.querySelector(
        `.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`
    );
    
    if (checkbox) {
        checkbox.checked = false;
        // Trigger the filtering process to update display and URL
        updateSelectedTraitsDisplay(true); 
    }
}

function updateSelectedTraitsDisplay(forceUpdate = false) {
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (selectedTraitsDiv) {
        // This element seems unused in the filter summary display but kept for original code compatibility
        selectedTraitsDiv.style.display = 'none';
    }
    
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    // --- MODIFIED: Always update URL when traits change ---
    updateURL();
    // ----------------------------------------------------
    
    if (checkboxes.length === 0 && (isFiltering || forceUpdate)) {
        isFiltering = false;
        filteredNFTIds = [];
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
        return;
    }
    
    filterByTraits();
}

function createFilterControls() {
    const filterControls = document.getElementById('filterControls');
    const allTraits = {};
    const traitDetails = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([traitType, traitData]) => {
            if (!allTraits[traitType]) {
                allTraits[traitType] = new Set();
                traitDetails[traitType] = {};
            }
            
            const traitName = getTraitName(traitData);
            allTraits[traitType].add(traitName);
            
            if (typeof traitData === 'object' && traitData.name) {
                if (!traitDetails[traitType][traitName]) {
                    traitDetails[traitType][traitName] = {
                        affinity: traitData.affinity || null,
                        stats: traitData.stats || {}
                    };
                }
            }
        });
    });
    
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = 'dropdown-wrapper';
    
    const dropdownLabel = document.createElement('label');
    dropdownLabel.textContent = 'Select Trait Category:';
    dropdownLabel.className = 'dropdown-label';
    
    const dropdown = document.createElement('select');
    dropdown.id = 'traitCategoryDropdown';
    dropdown.className = 'trait-dropdown';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Choose a category --';
    dropdown.appendChild(defaultOption);
    
    Object.keys(allTraits).sort().forEach(traitType => {
        const option = document.createElement('option');
        option.value = traitType;
        option.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        dropdown.appendChild(option);
    });
    
    dropdownWrapper.appendChild(dropdownLabel);
    dropdownWrapper.appendChild(dropdown);
    filterControls.appendChild(dropdownWrapper);
    
    const filterGroupsContainer = document.createElement('div');
    filterGroupsContainer.id = 'filterGroupsContainer';
    filterControls.appendChild(filterGroupsContainer);
    
    Object.keys(allTraits).sort().forEach(traitType => {
        const filterGroup = document.createElement('div');
        filterGroup.className = 'filter-group';
        filterGroup.dataset.traitType = traitType;
        filterGroup.style.display = 'none';
        
        const header = document.createElement('div');
        header.className = 'filter-header';
        header.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        filterGroup.appendChild(header);
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'trait-search';
        searchInput.placeholder = `Search ${traitType}...`;
        searchInput.autocomplete = 'off';
        searchInput.dataset.traitType = traitType;
        filterGroup.appendChild(searchInput);
        
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'checkbox-container';
        checkboxContainer.dataset.traitType = traitType;
        
        const sortedValues = [...allTraits[traitType]].sort((a, b) => {
            const countA = traitCounts[traitType][a] || 0;
            const countB = traitCounts[traitType][b] || 0;
            return countA - countB;
        });
        
        sortedValues.forEach(value => {
            const count = traitCounts[traitType][value] || 0;
            const totalNFTs = Object.keys(traitsData).length;
            const percentage = ((count / totalNFTs) * 100).toFixed(1);
            
            const checkboxWrapper = document.createElement('label');
            checkboxWrapper.className = 'checkbox-label';
            // Use the original case for searching/filtering in the dataset value
            checkboxWrapper.dataset.traitValue = value; 
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'trait-checkbox';
            checkbox.dataset.traitType = traitType;
            checkbox.dataset.traitValue = value; // Keep original case for URL/comparison
            checkbox.addEventListener('change', () => updateSelectedTraitsDisplay(false));
            
            const details = traitDetails[traitType][value] || {};
            
            let affinityHTML = '';
            if (details.affinity && (traitType === 'body' || traitType === 'hand')) {
                affinityHTML = `<span class="trait-affinity ${details.affinity}" title="Affinity">${details.affinity}</span>`;
            }
            
            let statsHTML = '';
            if (details.stats && Object.keys(details.stats).length > 0) {
                const statBadges = Object.entries(details.stats)
                    .map(([statName, value]) => {
                        const sign = value > 0 ? '+' : '';
                        return `<span class="trait-stat ${statName}" title="${statName.charAt(0).toUpperCase() + statName.slice(1)}">${statName.slice(0, 3).toUpperCase()} ${sign}${value}</span>`;
                    })
                    .join('');
                statsHTML = `<span class="trait-stats">${statBadges}</span>`;
            }
            
            const span = document.createElement('span');
            span.className = 'trait-label-text';
            span.innerHTML = `
                <span class="trait-name-row">
                    <span class="trait-name">${value}</span>
                    ${affinityHTML}
                </span>
                <span class="trait-info-row">
                    <span class="trait-count">${count} (${percentage}%)</span>
                    ${statsHTML}
                </span>
            `;
            
            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(span);
            checkboxContainer.appendChild(checkboxWrapper);
        });
        
        filterGroup.appendChild(checkboxContainer);
        filterGroupsContainer.appendChild(filterGroup);
        
        searchInput.addEventListener('input', (e) => {
            filterTraitOptions(traitType, e.target.value);
        });
    });
    
    dropdown.addEventListener('change', (e) => {
        const selectedCategory = e.target.value;
        const allFilterGroups = document.querySelectorAll('.filter-group');
        allFilterGroups.forEach(group => group.style.display = 'none');
        
        if (selectedCategory) {
            const selectedGroup = document.querySelector(`.filter-group[data-trait-type="${selectedCategory}"]`);
            if (selectedGroup) selectedGroup.style.display = 'block';
        }
    });
}

function filterTraitOptions(traitType, searchTerm) {
    const container = document.querySelector(`.checkbox-container[data-trait-type="${traitType}"]`);
    const checkboxLabels = container.querySelectorAll('.checkbox-label');
    const searchLower = searchTerm.toLowerCase().trim();
    
    let visibleCount = 0;
    
    checkboxLabels.forEach(label => {
        const traitValue = label.dataset.traitValue.toLowerCase(); // select search to lowercased trait value
        if (searchLower === '' || traitValue.includes(searchLower)) {
            label.style.display = 'flex';
            visibleCount++;
        } else {
            label.style.display = 'none';
        }
    });
    
    let noResultsMsg = container.querySelector('.no-trait-results');
    if (visibleCount === 0) {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.className = 'no-trait-results';
            noResultsMsg.textContent = 'No matching traits found';
            container.appendChild(noResultsMsg);
        }
    } else {
        if (noResultsMsg) noResultsMsg.remove();
    }
}

// Helper function to get stat color class based on current sort
function getStatColorClass() {
    const statSorts = ['harmony', 'health', 'power', 'violence'];
    return statSorts.includes(currentSortOrder) ? currentSortOrder : '';
}

// Display NFT with stats and OpenRarity rank
function displayNFT(id, showCloseButton = false) {
    const imageUrl = imagesData[id];
    const traits = traitsData[id];
    const stats = kamiStatsData[id];
    
    if (!imageUrl || !traits) {
        console.warn(`NFT #${id} not found in data`);
        return null;
    }
    
    const rarityData = nftRarityScores[id];
    const rank = rarityData ? rarityData.rank : '?';
    const score = rarityData ? rarityData.score.toFixed(4) : '?';
    
    const isNew = metadataInfo.newKamiIds && metadataInfo.newKamiIds.includes(Number(id));
    
    const card = document.createElement('div');
    card.className = 'nft-card hover_wrapper';
    card.dataset.nftId = id;
    
    let rankClass = 'rank-common';
    const totalNFTs = Object.keys(traitsData).length;
    const rankPercentile = (rank / totalNFTs) * 100;
    
    if (rankPercentile <= 1) rankClass = 'rank-legendary';
    else if (rankPercentile <= 5) rankClass = 'rank-epic';
    else if (rankPercentile <= 15) rankClass = 'rank-rare';
    else if (rankPercentile <= 40) rankClass = 'rank-uncommon';
    
    // Get stat color class
    const statColorClass = getStatColorClass();
    
    // Get the stat value for the current sort
    const statValue = stats?.stats[currentSortOrder] || '';

    // Build stat color indicator HTML (only show if sorting by a stat)
    const statColorHTML = statColorClass ? 
        `<div class="stat-color-box ${statColorClass}" title="${statColorClass.charAt(0).toUpperCase() + statColorClass.slice(1)} Sort">${statValue}</div>` : '';
    
    let statsHTML = '';
    if (stats) {
        statsHTML = `
            <div class="kami-stats">
                <div class="stat-row one">
                    <div class="stat-item health">
                        
                        <div class="stat-value">${stats.stats.health}</div>
                    </div>
                    <div class="stat-item power">
                        
                        <div class="stat-value">${stats.stats.power}</div>
                    </div>
                </div>
                <div class="stat-row">
                    <div class="stat-item violence">
                        
                        <div class="stat-value">${stats.stats.violence}</div>
                    </div>
                    <div class="stat-item harmony">
                        
                        <div class="stat-value">${stats.stats.harmony}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    const traitsHTML = Object.entries(traits)
        .map(([key, traitData]) => {
            const traitName = getTraitName(traitData);
            return `
                <div class="trait">
                    <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${traitName}</p>
                </div>
            `;
        }).join('');
    
    const closeButtonHTML = showCloseButton ? 
        `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    
    const newBadgeHTML = isNew ? 
        `<div class="new-badge" title="Recently Added!">NEW</div>` : '';
    
    // Check if mobile view
const isMobile = window.innerWidth <= 390;

// Build the card HTML based on screen size
if (isMobile) {
    card.innerHTML = `
    ${closeButtonHTML}
    ${newBadgeHTML}
    <div class="rank-stat-container">
        <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
            ${rank}
        </div>
        ${statColorHTML}
    </div>
    <div class="nft-card-content">
        <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
        <div class="nft-details hover_wrapper">
            <div class="nft-id">Kamigotchi ${id}</div>
            ${traitsHTML}
            ${statsHTML}
        </div>
    </div>
    `;
} else {
    card.innerHTML = `
    ${closeButtonHTML}
    ${newBadgeHTML}
    <div class="rank-stat-container">
        <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
            ${rank}
        </div>
        ${statColorHTML}
    </div>
    ${statsHTML}
    <div class="nft-card-content">
        <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
        <div class="nft-details hover_wrapper">
            <div class="nft-id">Kamigotchi ${id}</div>
            ${traitsHTML}
        </div>
    </div>
    `;
}
    
    card.addEventListener('click', (event) => {
        event.stopPropagation();
        const statsElement = card.querySelector('.kami-stats');
        if (statsElement) {
            statsElement.classList.toggle('is-active');
        }
    });

    // Global listener for closing stats panel (less efficient, but matches original logic)
    document.addEventListener('click', (event) => {
        const statsElement = card.querySelector('.kami-stats');
        if (statsElement && statsElement.classList.contains('is-active')) {
            const isClickInsideContainer = card.contains(event.target);
            if (!isClickInsideContainer) {
                statsElement.classList.remove('is-active');
            }
        }
    });

    return card;
}

function updateSelectedIDsDisplay() {
    const selectedIDsDiv = document.getElementById('selectedIDs');
    
    if (selectedIDs.size === 0) {
        selectedIDsDiv.style.display = 'none';
        return;
    }
    
    selectedIDsDiv.style.display = 'block';
    selectedIDsDiv.innerHTML = '';
    
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'selected-cards-grid';

    // Sort selected IDs for consistent display (e.g., numerically)
    const sortedSelectedIDs = Array.from(selectedIDs).sort((a, b) => Number(a) - Number(b));

    sortedSelectedIDs.forEach(id => {
        const card = displayNFT(id, true);
        if (card) cardsContainer.appendChild(card);
    });
    
    selectedIDsDiv.appendChild(cardsContainer);
}

function searchByID() {
    const searchInput = document.getElementById('searchInput');
    const id = searchInput.value.trim();
    
    if (!id) {
        alert('Please enter an NFT ID');
        return;
    }
    
    if (!imagesData[id] || !traitsData[id]) {
        alert(`Kamigotchi #${id} not found. Please check the ID and try again.`);
        return;
    }
    
    if (selectedIDs.has(id)) {
        alert(`Kamigotchi #${id} is already added!`);
        return;
    }
    
    selectedIDs.add(id);
    updateSelectedIDsDisplay();
    searchInput.value = '';
    
    // --- MODIFIED: Update URL after adding ID ---
    updateURL();
    // -------------------------------------------
}

function removeSelectedID(id) {
    selectedIDs.delete(id);
    updateSelectedIDsDisplay();
    
    // --- MODIFIED: Update URL after removing ID ---
    updateURL();
    // --------------------------------------------
}

window.removeSelectedID = removeSelectedID;

function clearAllSelectedIDs() {
    selectedIDs.clear();
    updateSelectedIDsDisplay();
    document.getElementById('searchInput').value = '';
    
    // --- MODIFIED: Update URL after clearing all IDs ---
    updateURL();
    // -------------------------------------------------
}

/**
 * Filters NFTs based on checked traits and displays results.
 * @param {boolean} skipURLUpdate - If true, skips updating the URL (used when loading state from URL).
 */
function filterByTraits(skipURLUpdate = false) {
    const resultsDiv = document.getElementById('results');
    
    // ⚠️ FIX: Clear everything upfront to ensure old summary buttons are removed
    resultsDiv.textContent = ''; 

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0) {
        isFiltering = false;
        allNFTIds = getSortedNFTIds(Object.keys(traitsData));
        loadInitialNFTs();
        
        // --- MODIFIED: If no filters, update URL to clear filter params ---
        if (!skipURLUpdate) updateURL(); 
        // ------------------------------------------------------------------
        return;
    }
    
    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    // Filter NFTs: Must have AT LEAST ONE of the selected values for EACH selected trait type.
    let matchingNFTs = Object.keys(traitsData)
        .filter(id => {
            const nftTraits = traitsData[id];
            
            // Check every selected trait type
            return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
                // Get the trait value for this NFT
                const nftTraitData = nftTraits[traitType];
                if (!nftTraitData) return false; // NFT must have this trait type
                
                const nftTraitName = getTraitName(nftTraitData);
                
                // Check if the NFT's trait name is one of the selected values
                return selectedValues.includes(nftTraitName);
            });
        });
    
    filteredNFTIds = getSortedNFTIds(matchingNFTs);
    isFiltering = true;
    
    // Rebuild summary header
    let summaryButtonsHTML = '';
    Object.entries(selectedTraits).forEach(([type, values]) => {
        values.forEach(value => {
            summaryButtonsHTML += `
                <button class="count-header-trait-btn" 
                        data-trait-type="${type}" 
                        data-trait-value="${value}"
                        title="Click to remove filter: ${type}: ${value}">
                    ${type}: ${value} ×
                </button>
            `;
        });
    });
    
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px;">Found matching Kamigotchi: ${filteredNFTIds.length}</div>
        <div class="note">** dear mobile user, click card to show og stats **<div>
        <div id="filter-summary-buttons" class="filter-summary-buttons-container" style="display: flex; flex-wrap: wrap; gap: 5px; margin: 10px;">
            ${summaryButtonsHTML}
        </div>
    `;

    resultsDiv.appendChild(countDiv);
    
    // Re-register event listeners for the newly created buttons
    countDiv.querySelectorAll('.count-header-trait-btn').forEach(btn => {
        btn.addEventListener('click', removeSelectedTrait);
    });

    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No Kamigotchi match your selected traits';
        resultsDiv.appendChild(noResultsDiv);
        isFiltering = false;
        
        return;
    }
    
    // --- ADDED: Only run updateURL if not skipped (i.e., not a page load from URL) ---
    if (!skipURLUpdate) updateURL();
    // ---------------------------------------------------------------------------------

    currentLoadIndex = 0;
    loadMoreNFTs();
    setupInfiniteScroll();
}

function clearFilters() {
    const checkboxes = document.querySelectorAll('.trait-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = false);
    
    const searchInputs = document.querySelectorAll('.trait-search');
    searchInputs.forEach(input => {
        input.value = '';
        const traitType = input.dataset.traitType;
        filterTraitOptions(traitType, '');
    });
    
    const dropdown = document.getElementById('traitCategoryDropdown');
    if (dropdown) dropdown.value = '';
    
    const allFilterGroups = document.querySelectorAll('.filter-group');
    allFilterGroups.forEach(group => group.style.display = 'none');
    
    isFiltering = false;
    filteredNFTIds = [];
    allNFTIds = getSortedNFTIds(Object.keys(traitsData));
    loadInitialNFTs();
    
    // --- MODIFIED: Update URL after clearing filters ---
    updateURL();
    // -------------------------------------------------
}

// Setup refresh button
function setupRefreshButton() {
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
    }
}

document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByID();
});
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

function setupScrollToTop() {
    const scrollBtn = document.getElementById('scrollToTop');
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 300) {
            if (currentScroll > lastScrollTop) {
                scrollBtn.classList.add('show');
            } else {
                scrollBtn.classList.remove('show');
            }
        } else {
            scrollBtn.classList.remove('show');
        }
        
        lastScrollTop = currentScroll;
    });
    
    scrollBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupScrollToTop();
    setupRefreshButton();
});

// Inject enhanced styles for stats display
const enhancedStyles = `
.trait-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
}

.trait-info-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.trait-affinity {
    display: inline-block;
    padding: 2px 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.trait-stats {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

.trait-stat {
    display: inline-block;
    padding: 2px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.3px;
}

.checkbox-label .trait-label-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.checkbox-label {
    padding: 8px 10px !important;
    min-height: 50px;
    align-items: flex-start !important;
}

.rank-stat-container {
    display: flex;
    align-items: center;
    gap: 1px;
    margin-bottom: 1px;
}

.stat-color-box {
    border-radius: 2px;
    border: 1px solid rgba(147, 125, 26, 0.3);
    flex-shrink: 0;
}

.stat-color-box.harmony {
    background: #9cbcd2;
}

.stat-color-box.health {
    background: #d7bce8;
}

.stat-color-box.power {
    background: #f9db6d;
}

.stat-color-box.violence {
    background: #df829b;
}
`;

if (!document.getElementById('enhanced-trait-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'enhanced-trait-styles';
    styleTag.textContent = enhancedStyles;
    document.head.appendChild(styleTag);
}

// Clear any cached service workers on load
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
            registration.unregister();
        }
    });
}

loadData();