let imagesData = {};
let traitsData = {};
let kamiStatsData = {}; // NEW: Stats data
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

// Calculate rarity score for each NFT using statistical rarity
function calculateRarityScores() {
    const totalNFTs = Object.keys(traitsData).length;
    const scores = {};
    
    Object.entries(traitsData).forEach(([id, traits]) => {
        let rarityScore = 0;
        
        Object.entries(traits).forEach(([category, traitData]) => {
            const traitName = getTraitName(traitData);
            const traitCount = traitCounts[category][traitName];
            const traitRarity = 1 / (traitCount / totalNFTs);
            rarityScore += traitRarity;
        });
        
        scores[id] = rarityScore;
    });
    
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

// UPDATED: Get sorted NFT IDs based on current sort order (with stats support)
function getSortedNFTIds(idsToSort) {
    const ids = idsToSort || Object.keys(traitsData);
    
    switch(currentSortOrder) {
        case 'latest':
            return ids.sort((a, b) => Number(b) - Number(a));
        case 'oldest':
            return ids.sort((a, b) => Number(a) - Number(b));
        case 'rarity':
            return ids.sort((a, b) => {
                return nftRarityScores[a].rank - nftRarityScores[b].rank;
            });
        // NEW: Stat-based sorting
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
    
    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const newSort = e.target.dataset.sort;
            if (newSort === currentSortOrder) return;
            
            currentSortOrder = newSort;
            
            sortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            if (isFiltering) {
                filterByTraits();
            } else {
                allNFTIds = getSortedNFTIds();
                loadInitialNFTs();
            }
        });
    });
}

// UPDATED: Load JSON files (including stats)
async function loadData() {
    try {
        const imagesResponse = await fetch('kamiImage.json');
        if (!imagesResponse.ok) {
            throw new Error(`Failed to load kamiImage.json: ${imagesResponse.status}`);
        }
        
        const traitsResponse = await fetch('kamiTraits.json');
        if (!traitsResponse.ok) {
            throw new Error(`Failed to load kamiTraits.json: ${traitsResponse.status}`);
        }
        
        // NEW: Load stats data
        try {
            const statsResponse = await fetch('kamiStats.json');
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
            const metadataResponse = await fetch('kamiMetadata.json');
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
        
        traitCounts = calculateTraitCounts();
        nftRarityScores = calculateRarityScores();
        allNFTIds = getSortedNFTIds();
        
        setupSortButtons();
        createFilterControls();
        loadInitialNFTs();
        
    } catch (error) {
        console.error('Detailed error:', error);
        document.getElementById('results').innerHTML = 
            `<div class="no-results">
                <strong>Error loading NFT data</strong><br><br>
                ${error.message}<br><br>
                <strong>Troubleshooting:</strong><br>
                1. Make sure you're running a local server (not opening HTML directly)<br>
                2. Check that kamiImage.json and kamiTraits.json are in the same folder<br>
                3. Check the browser console (F12) for more details
            </div>`;
    } finally {
        hideLoader();
        showContainer();
    }
}

function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';
    
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    
    const title = isFiltering ? 'Found matching Kamigotchi' : 'Showing all Kamigotchi';
    const countDiv = createCountHeader(idsToDisplay.length, title);
    resultsDiv.appendChild(countDiv);
    
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
        const cards = document.querySelectorAll('.nft-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            nftObserver.observe(lastCard);
        }
    };
    
    setTimeout(observeLastCard, 100);
    
    const originalLoadMore = loadMoreNFTs;
    loadMoreNFTs = function() {
        originalLoadMore();
        setTimeout(observeLastCard, 100);
    };
}

function createCountHeader(count, title) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
        <div class="note">** dear mobile user, long press to show og stats **<div>
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
        updateSelectedTraitsDisplay();
    }
}

function updateSelectedTraitsDisplay() {
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (selectedTraitsDiv) {
        selectedTraitsDiv.style.display = 'none';
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
            checkboxWrapper.dataset.traitValue = value.toLowerCase();
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'trait-checkbox';
            checkbox.dataset.traitType = traitType;
            checkbox.dataset.traitValue = value;
            checkbox.addEventListener('change', updateSelectedTraitsDisplay);
            
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
        const traitValue = label.dataset.traitValue;
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

// UPDATED: Display NFT with stats
function displayNFT(id, showCloseButton = false) {
    const imageUrl = imagesData[id];
    const traits = traitsData[id];
    const stats = kamiStatsData[id]; // NEW: Get stats
    
    if (!imageUrl || !traits) {
        console.warn(`NFT #${id} not found in data`);
        return null;
    }
    
    const rarityData = nftRarityScores[id];
    const rank = rarityData ? rarityData.rank : '?';
    const score = rarityData ? rarityData.score.toFixed(2) : '?';
    
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
    
    // NEW: Create stats display if available
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
    
    card.innerHTML = `
    ${closeButtonHTML}
    ${newBadgeHTML}
    <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
        ${rank}
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
    
   card.addEventListener('click', (event) => {
    // 1. Stop the event from "bubbling up" to the document listener below
    event.stopPropagation();
    
    // 2. Toggle the visibility class
    statsHTML.classList.toggle('is-active');
});

    // B. Listen for clicks on the entire document (page)
    document.addEventListener('click', (event) => {
    // Check if the tapContent is currently visible
    if (statsHTML.classList.contains('is-active')) {
        
        // The .contains() method checks if the clicked element (event.target) 
        // is inside the tapTarget container (or is the tapTarget itself).
        // If it returns FALSE, the click was OUTSIDE the container.
        const isClickInsideContainer = card.contains(event.target);
        
        if (!isClickInsideContainer) {
            // If the click was outside AND the content is active, hide it.
            statsHTML.classList.remove('is-active');
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

    selectedIDs.forEach(id => {
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
}

function removeSelectedID(id) {
    selectedIDs.delete(id);
    updateSelectedIDsDisplay();
}

window.removeSelectedID = removeSelectedID;

function clearAllSelectedIDs() {
    selectedIDs.clear();
    updateSelectedIDsDisplay();
    document.getElementById('searchInput').value = '';
}

function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.textContent = '';

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0) {
        isFiltering = false;
        loadInitialNFTs();
        return;
    }
    
    const filteringMessage = document.createElement('div');
    filteringMessage.className = 'no-results';
    filteringMessage.textContent = 'Filtering...';
    resultsDiv.appendChild(filteringMessage);

    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    let matchingNFTs = Object.keys(traitsData)
        .filter(id => {
            const nftTraits = traitsData[id];
            return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
                const nftTraitName = getTraitName(nftTraits[traitType]);
                return selectedValues.includes(nftTraitName);
            });
        });
    
    filteredNFTIds = getSortedNFTIds(matchingNFTs);
    isFiltering = true;
    
    resultsDiv.textContent = '';
    
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
        <div id="count-summary" style="font-size: 14px; margin-bottom: 15px;">Found matching Kamigotchi: ${filteredNFTIds.length}</div>
        <div id="filter-summary-buttons" class="filter-summary-buttons-container" style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;">
            ${summaryButtonsHTML}
        </div>
    `;

    resultsDiv.appendChild(countDiv);
    
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
    
    updateSelectedTraitsDisplay();
    
    isFiltering = false;
    filteredNFTIds = [];
    loadInitialNFTs();
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

document.addEventListener('DOMContentLoaded', setupScrollToTop);

// NEW: Inject enhanced styles for stats display
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

.stat-row {
    display: flex;
    gap: 8px;
}

.stat-row.one {
    margin-bottom: 10px;
}

.stat-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 0px;
    border-radius: 15px;
    font-size: 11px;
    margin: 0px 10px;
    height: 25px;
    border: 2px solid #999;
}
    
.stat-value {
    margin: auto;
    width: 0
    color: #333;
}
`;

if (!document.getElementById('enhanced-trait-styles')) {
    const styleTag = document.createElement('style');
    styleTag.id = 'enhanced-trait-styles';
    styleTag.textContent = enhancedStyles;
    document.head.appendChild(styleTag);
}

loadData();