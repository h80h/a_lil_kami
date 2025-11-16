let imagesData = {};
let traitsData = {};
let selectedIDs = new Set();
let allNFTIds = []; // Store all NFT IDs
let currentLoadIndex = 0; // Track loading progress
const INITIAL_LOAD_COUNT = 50; // Load first 50 NFTs
const LAZY_LOAD_COUNT = 30; // Load 30 more when scrolling
let isLoading = false; // Prevent multiple simultaneous loads

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
        
        imagesData = await imagesResponse.json();
        traitsData = await traitsResponse.json();
        
        // Get all IDs sorted in descending order
        allNFTIds = Object.keys(traitsData).sort((a, b) => Number(b) - Number(a));
        
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

// Load initial batch of NFTs
function loadInitialNFTs() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';
    
    // Add count header
    const countDiv = createCountHeader(allNFTIds.length, 'Showing all Kamigotchi', 'No filters applied (Latest first)');
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
    const endIndex = Math.min(currentLoadIndex + LAZY_LOAD_COUNT, allNFTIds.length);
    
    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
        const fragment = document.createDocumentFragment();
        
        for (let i = currentLoadIndex; i < endIndex; i++) {
            const card = displayNFT(allNFTIds[i], false);
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
    
    if (currentLoadIndex >= allNFTIds.length) {
        indicator.style.display = 'none';
    }
}

// Setup infinite scroll
function setupInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && currentLoadIndex < allNFTIds.length && !isLoading) {
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
            observer.observe(lastCard);
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

// Create count header helper
function createCountHeader(count, title, subtitle) {
    const countDiv = document.createElement('div');
    countDiv.className = 'count-header';
    countDiv.innerHTML = `
        <div style="font-size: 14px; margin-bottom: 5px;">${title}: ${count}</div>
        <div style="font-size: 14px; color: #666;">${subtitle}</div>
    `;
    return countDiv;
}

// Update selected traits display
function updateSelectedTraitsDisplay() {
    const selectedTraitsDiv = document.getElementById('selectedTraitsDisplay');
    if (!selectedTraitsDiv) return;
    
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0) {
        selectedTraitsDiv.style.display = 'none';
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
    
    const traitsHTML = Object.entries(selectedTraits)
        .map(([type, values]) => `
            <div class="selected-trait-item">
                <span class="trait-type">${type}:</span>
                <span class="trait-values">${values.join(', ')}</span>
            </div>
        `).join('');
    
    selectedTraitsDiv.innerHTML = `
        <div class="selected-traits-header">Selected Traits:</div>
        <div class="selected-traits-list">${traitsHTML}</div>
    `;
    selectedTraitsDiv.style.display = 'block';
}

// Create filter controls with dropdown and checkboxes
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
        
        const sortedValues = [...allTraits[traitType]].sort();
        sortedValues.forEach(value => {
            const checkboxWrapper = document.createElement('label');
            checkboxWrapper.className = 'checkbox-label';
            checkboxWrapper.dataset.traitValue = value.toLowerCase();
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'trait-checkbox';
            checkbox.dataset.traitType = traitType;
            checkbox.dataset.traitValue = value;
            checkbox.addEventListener('change', updateSelectedTraitsDisplay);
            
            const span = document.createElement('span');
            span.textContent = value;
            
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
    
    const card = document.createElement('div');
    card.className = 'nft-card';
    card.dataset.nftId = id;
    
    const traitsHTML = Object.entries(traits)
        .map(([key, value]) => `
            <div class="trait">
                <p>${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}</p>
            </div>
        `).join('');
    
    const closeButtonHTML = showCloseButton ? 
        `<button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>` : '';
    
    card.innerHTML = `
        ${closeButtonHTML}
        <img src="${imageUrl}" alt="NFT #${id}" loading="lazy" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
        <div class="nft-id">Kamigotchi #${id}</div>
        ${traitsHTML}
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

function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '<div class="no-results">Filtering...</div>';
    
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    if (checkboxes.length === 0) {
        loadInitialNFTs();
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
    
    const matchingNFTs = Object.keys(traitsData)
        .filter(id => {
            const nftTraits = traitsData[id];
            return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
                return selectedValues.includes(nftTraits[traitType]);
            });
        })
        .sort((a, b) => Number(b) - Number(a));
    
    resultsDiv.innerHTML = '';
    
    if (matchingNFTs.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">No Kamigotchi match your selected traits</div>';
        return;
    }
    
    const filterSummary = Object.entries(selectedTraits)
        .map(([type, values]) => `${type}: ${values.join(' OR ')}`)
        .join(' | ');
    
    const countDiv = createCountHeader(matchingNFTs.length, 'Found matching Kamigotchi', filterSummary + ' (Latest first)');
    resultsDiv.appendChild(countDiv);
    
    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();
    matchingNFTs.forEach(id => {
        const card = displayNFT(id, false);
        if (card) fragment.appendChild(card);
    });
    resultsDiv.appendChild(fragment);
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
    document.getElementById('results').innerHTML = '';
}

document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByID();
});
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('filterBtn').addEventListener('click', filterByTraits);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

loadData();