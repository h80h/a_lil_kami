let imagesData = {};
let traitsData = {};
let selectedIDs = new Set();
let allNFTIds = []; // Store all NFT IDs
let filteredNFTIds = []; // Store filtered NFT IDs
let currentLoadIndex = 0; // Track loading progress
let traitCounts = {}; // Store trait occurrence counts
let nftRarityScores = {}; // Store calculated rarity scores for each NFT
let currentSortOrder = 'latest'; // 'latest', 'oldest', 'rarity'
let isFiltering = false; // Track if filter is active
let nftObserver = null; // Global variable to manage the Intersection Observer
const INITIAL_LOAD_COUNT = 50; // Load first 50 NFTs
const LAZY_LOAD_COUNT = 30; // Load 30 more when scrolling
let isLoading = false; // Prevent multiple simultaneous loads
let metadataInfo = {}; // NEW: Store metadata for NEW badges

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

// Calculate trait occurrence counts
function calculateTraitCounts() {
    const counts = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.entries(nft).forEach(([category, traitName]) => {
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
        
        // Calculate rarity score: sum of (1 / trait_frequency) for each trait
        Object.entries(traits).forEach(([category, traitName]) => {
            const traitCount = traitCounts[category][traitName];
            const traitRarity = 1 / (traitCount / totalNFTs);
            rarityScore += traitRarity;
        });
        
        scores[id] = rarityScore;
    });
    
    // Normalize and rank
    const sortedByScore = Object.entries(scores)
        .sort((a, b) => b[1] - a[1]); // Highest score first
    
    const rankedScores = {};
    sortedByScore.forEach(([id, score], index) => {
        rankedScores[id] = {
            score: score,
            rank: index + 1
        };
    });
    
    return rankedScores;
}

// Get sorted NFT IDs based on current sort order
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
            
            // Update active button
            sortButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Re-sort and reload current view (filtered or all)
            if (isFiltering) {
                // Re-apply filter with new sort order
                filterByTraits();
            } else {
                // Reload all NFTs with new sort
                allNFTIds = getSortedNFTIds();
                loadInitialNFTs();
            }
        });
    });
}

// Load JSON files
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
        
        // NEW: Load metadata for NEW badges
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
        
        // Calculate trait counts for rarity sorting
        traitCounts = calculateTraitCounts();
        
        // Calculate rarity scores and ranks for all NFTs
        nftRarityScores = calculateRarityScores();
        
        // Get all IDs sorted in descending order (latest first) by default
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

// Lines 218-220
function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    
    // Optimization: Use textContent = '' for fast clearing
    resultsDiv.textContent = ''; 
    
    
    // Determine which IDs to display
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    
    // Add count header
    const title = isFiltering ? 'Found matching Kamigotchi' : 'Showing all Kamigotchi';
    const countDiv = createCountHeader(idsToDisplay.length, title);
    resultsDiv.appendChild(countDiv);
    
    // Load first batch
    currentLoadIndex = 0;
    loadMoreNFTs();
    
    // Setup infinite scroll
    setupInfiniteScroll();
}

// Load more NFTs
function loadMoreNFTs() {
    if (isLoading) return;
    
    isLoading = true;
    const resultsDiv = document.getElementById('results');
    
    // Use filtered IDs if filtering is active, otherwise use all IDs
    const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
    const endIndex = Math.min(currentLoadIndex + LAZY_LOAD_COUNT, idsToDisplay.length);
    
    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
        const fragment = document.createDocumentFragment();
        
        for (let i = currentLoadIndex; i < endIndex; i++) {
            const card = displayNFT(idsToDisplay[i], false);
            if (card) fragment.appendChild(card);
        }
        
        resultsDiv.appendChild(fragment);
        currentLoadIndex = endIndex;
        isLoading = false;
        
        // Update loading indicator
        updateLoadingIndicator();
    });
}

// Create loading indicator
function createLoadingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'loadingIndicator';
    indicator.className = 'loading-indicator';
    indicator.innerHTML = 'Loading more Kamigotchi...';
    indicator.style.display = 'none';
    return indicator;
}

// Update loading indicator
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

// Setup infinite scroll
function setupInfiniteScroll() {
    // Optimization: Disconnect the previous observer if it exists
    if (nftObserver) {
        nftObserver.disconnect();
    }
    
    // Use the global variable
    nftObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const idsToDisplay = isFiltering ? filteredNFTIds : allNFTIds;
            if (entry.isIntersecting && currentLoadIndex < idsToDisplay.length && !isLoading) {
                loadMoreNFTs();
            }
        });
    }, {
        rootMargin: '200px' // Start loading 200px before reaching the bottom
    });
    
    // Observe the last card
    const observeLastCard = () => {
        const cards = document.querySelectorAll('.nft-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            // Use the global variable to observe
            nftObserver.observe(lastCard); 
        }
    };
    
    // Initial observation
    setTimeout(observeLastCard, 100);
    
    // Re-observe after each load
    const originalLoadMore = loadMoreNFTs;
    loadMoreNFTs = function() {
        originalLoadMore();
        setTimeout(observeLastCard, 100);
    };
}

// Create count header helper (simplified without sort info) - Used for initial load
function createCountHeader(count, title) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px;">${title}: ${count}</div>
    `;
    return countDiv;
}

// ✨ MODIFIED: Remove a single selected trait (used by count-header buttons)
function removeSelectedTrait(event) {
    // We use currentTarget because the click handler is on the button, not the span inside it.
    const btn = event.currentTarget; 
    const traitType = btn.dataset.traitType;
    const traitValue = btn.dataset.traitValue;
    
    // 1. Find the corresponding checkbox and uncheck it
    const checkbox = document.querySelector(
        `.trait-checkbox[data-trait-type="${traitType}"][data-trait-value="${traitValue}"]`
    );
    
    if (checkbox) {
        checkbox.checked = false;
        
        // 2. Trigger the filter refresh cycle
        // updateSelectedTraitsDisplay() now handles calling filterByTraits
        updateSelectedTraitsDisplay(); 
        
        // The button will be automatically removed when filterByTraits redraws the count-header
    }
}

// ✨ MODIFIED: Update selected traits display (Now only a trigger)
function updateSelectedTraitsDisplay() {
    // 1. Hide the old display element as requested
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (selectedTraitsDiv) {
        selectedTraitsDiv.style.display = 'none'; 
    }
    
    // 2. Automatically trigger filtering (which now handles the new count-header display)
    filterByTraits();
}

// Create filter controls with dropdown and checkboxes (SORTED BY RARITY)
function createFilterControls() {
    const filterControls = document.getElementById('filterControls');
    const allTraits = {};
    
    Object.values(traitsData).forEach(nft => {
        Object.keys(nft).forEach(traitType => {
            if (!allTraits[traitType]) {
                allTraits[traitType] = new Set();
            }
            allTraits[traitType].add(nft[traitType]);
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
        
        // Sort by rarity (least common first = most rare)
        const sortedValues = [...allTraits[traitType]].sort((a, b) => {
            const countA = traitCounts[traitType][a] || 0;
            const countB = traitCounts[traitType][b] || 0;
            return countA - countB; // Ascending = rarest first
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
            
            // Set up change listener to update display AND filter
            // It now calls updateSelectedTraitsDisplay, which calls filterByTraits
            checkbox.addEventListener('change', updateSelectedTraitsDisplay);
            
            const span = document.createElement('span');
            span.className = 'trait-label-text';
            span.innerHTML = `
                <span class="trait-name">${value}</span>
                <span class="trait-count">${count} (${percentage}%)</span>
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

function displayNFT(id, showCloseButton = false) {
    const imageUrl = imagesData[id];
    const traits = traitsData[id];
    
    if (!imageUrl || !traits) {
        console.warn(`NFT #${id} not found in data`);
        return null;
    }
    
    const rarityData = nftRarityScores[id];
    const rank = rarityData ? rarityData.rank : '?';
    const score = rarityData ? rarityData.score.toFixed(2) : '?';
    
    // NEW: Check if this Kamigotchi is new
    const isNew = metadataInfo.newKamiIds && metadataInfo.newKamiIds.includes(Number(id));
    
    const card = document.createElement('div');
    card.className = 'nft-card';
    card.dataset.nftId = id;
    
    // Determine rank badge color based on rarity tier
    let rankClass = 'rank-common';
    const totalNFTs = Object.keys(traitsData).length;
    const rankPercentile = (rank / totalNFTs) * 100;
    
    if (rankPercentile <= 1) rankClass = 'rank-legendary';
    else if (rankPercentile <= 5) rankClass = 'rank-epic';
    else if (rankPercentile <= 15) rankClass = 'rank-rare';
    else if (rankPercentile <= 40) rankClass = 'rank-uncommon';
    
    const traitsHTML = Object.entries(traits)
        .map(([key, value]) => `
            <div class="trait">
                <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}</p>
            </div>
        `).join('');
    
    const closeButtonHTML = showCloseButton ? 
        `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    
    // NEW: Add NEW badge if applicable
    const newBadgeHTML = isNew ? 
        `<div class="new-badge" title="Recently Added!">NEW</div>` : '';
    
    card.innerHTML = `
    ${closeButtonHTML}
    ${newBadgeHTML}
    <div class="rank-badge ${rankClass}" title="Rarity Rank: #${rank} | Score: ${score}">
        ${rank}
    </div>
    <div class="nft-card-content">
        <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
        <div class="nft-details">
            <div class="nft-id">Kamigotchi ${id}</div>
            ${traitsHTML}
        </div>
    </div>
`;
    
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

// Lines 661-665
function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    
    // Optimization: Clear the content efficiently first
    resultsDiv.textContent = ''; 

    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0) {
        // ... (unchanged)
        isFiltering = false;
        loadInitialNFTs();
        return;
    }
    
    // Display a filtering message (must be added back after clearing textContent)
    const filteringMessage = document.createElement('div');
    filteringMessage.className = 'no-results';
    filteringMessage.textContent = 'Filtering...';
    resultsDiv.appendChild(filteringMessage);

    // ... (rest of the function is unchanged until line 700)

    // After filtering and before adding results:
    

    
    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    // Filter NFTs based on selected traits
    let matchingNFTs = Object.keys(traitsData)
        .filter(id => {
            const nftTraits = traitsData[id];
            return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
                // An NFT matches this type if its trait value is one of the selected values
                return selectedValues.includes(nftTraits[traitType]);
            });
        });
    
    // Apply current sort order to filtered results
    filteredNFTIds = getSortedNFTIds(matchingNFTs);
    isFiltering = true;
    
    resultsDiv.innerHTML = '';
    
    // if (filteredNFTIds.length === 0) {
    //     resultsDiv.innerHTML = '<div class="no-results">No Kamigotchi match your selected traits</div>';
    //     isFiltering = false;
    //     return;
    // }
    
    // --- START OF NEW/MODIFIED SECTION: Interactive Count Header ---
    
    // 1. Build the filter summary HTML using single, clickable buttons
    let summaryButtonsHTML = '';
    
    Object.entries(selectedTraits).forEach(([type, values]) => {
        values.forEach(value => {
            // Create a button for each trait value
            summaryButtonsHTML += `
                <button class="count-header-trait-btn" 
                        data-trait-type="${type}" 
                        data-trait-value="${value}"
                        title="Click to remove filter: ${type}: ${value}">
                    ${type}: ${value} x
                </button>
            `;
        });
    });
    
    // 2. Create the count header and insert the buttons
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div id="count-summary" style="font-size: 14px; margin-bottom: 15px;">Found matching Kamigotchi: ${filteredNFTIds.length}</div>
        <div id="filter-summary-buttons" class="filter-summary-buttons-container" style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;">
            ${summaryButtonsHTML}
        </div>
    `;

    // Line 704
    resultsDiv.textContent = ''; // Clear the "Filtering..." message before adding results

    resultsDiv.appendChild(countDiv);
    
    // 3. Attach event listeners to the new buttons, using the existing removal function
    countDiv.querySelectorAll('.count-header-trait-btn').forEach(btn => {
        btn.addEventListener('click', removeSelectedTrait);
    });

    // --- END OF NEW/MODIFIED SECTION ---
    // Check if no results found AFTER showing the count header
    if (filteredNFTIds.length === 0) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.textContent = 'No Kamigotchi match your selected traits';
        resultsDiv.appendChild(noResultsDiv);
        isFiltering = false;
        return;
    }
    // Reset load index
    currentLoadIndex = 0;
    
    // Load filtered results with infinite scroll
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
    
    // Clear filtering state and reload all NFTs
    isFiltering = false;
    filteredNFTIds = [];
    loadInitialNFTs();
}

document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByID();
});
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
// document.getElementById('filterBtn').addEventListener('click', filterByTraits);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

// Scroll to top functionality
function setupScrollToTop() {
    const scrollBtn = document.getElementById('scrollToTop');
    let lastScrollTop = 0;
    let scrollTimeout;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        // Clear previous timeout
        clearTimeout(scrollTimeout);
        
        // Show button if scrolled down more than 300px
        if (currentScroll > 300) {
            // Check scroll direction
            if (currentScroll > lastScrollTop) {
                // Scrolling DOWN - show button
                scrollBtn.classList.add('show');
            } else {
                // Scrolling UP - hide button
                scrollBtn.classList.remove('show');
            }
        } else {
            // Near top of page - hide button
            scrollBtn.classList.remove('show');
        }
        
        // Update last scroll position
        lastScrollTop = currentScroll;
    });
    
    // Smooth scroll to top when clicked
    scrollBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', setupScrollToTop);

loadData();