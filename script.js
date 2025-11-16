let imagesData = {};
let traitsData = {};
let selectedIDs = new Set(); // Store selected IDs

// Load JSON files
async function loadData() {
    try {
        // console.log('Attempting to load JSON files...');
        
        const imagesResponse = await fetch('kamiImage.json');
        // console.log('kamiImage.json response status:', imagesResponse.status);
        
        if (!imagesResponse.ok) {
            throw new Error(`Failed to load kamiImage.json: ${imagesResponse.status}`);
        }
        
        const traitsResponse = await fetch('kamiTraits.json');
        // console.log('kamiTraits.json response status:', traitsResponse.status);
        
        if (!traitsResponse.ok) {
            throw new Error(`Failed to load kamiTraits.json: ${traitsResponse.status}`);
        }
        
        imagesData = await imagesResponse.json();
        traitsData = await traitsResponse.json();
        
        // console.log('Data loaded successfully!');
        // console.log('Total images:', Object.keys(imagesData).length);
        createFilterControls();
        filterByTraits();
        
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
    }  finally {
      setTimeout(() => {
        document.querySelector('.loader').style.display = 'none';
      }, 1000);
      setTimeout(() => {
        document.querySelector('.container').style.display = 'block';
      }, 1000);
  }
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
    
    // Organize selected traits by type
    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    // Build display HTML
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
    
    // Collect all unique trait types and values
    Object.values(traitsData).forEach(nft => {
        Object.keys(nft).forEach(traitType => {
            if (!allTraits[traitType]) {
                allTraits[traitType] = new Set();
            }
            allTraits[traitType].add(nft[traitType]);
        });
    });
    
    // Create dropdown selector
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = 'dropdown-wrapper';
    
    const dropdownLabel = document.createElement('label');
    dropdownLabel.textContent = 'Select Trait Category:';
    dropdownLabel.className = 'dropdown-label';
    
    const dropdown = document.createElement('select');
    dropdown.id = 'traitCategoryDropdown';
    dropdown.className = 'trait-dropdown';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Choose a category --';
    dropdown.appendChild(defaultOption);
    
    // Add options for each trait type
    Object.keys(allTraits).sort().forEach(traitType => {
        const option = document.createElement('option');
        option.value = traitType;
        option.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        dropdown.appendChild(option);
    });
    
    dropdownWrapper.appendChild(dropdownLabel);
    dropdownWrapper.appendChild(dropdown);
    filterControls.appendChild(dropdownWrapper);
    
    // Create container for all filter groups (initially hidden)
    const filterGroupsContainer = document.createElement('div');
    filterGroupsContainer.id = 'filterGroupsContainer';
    filterControls.appendChild(filterGroupsContainer);
    
    // Create checkbox groups for each trait type
    Object.keys(allTraits).sort().forEach(traitType => {
        const filterGroup = document.createElement('div');
        filterGroup.className = 'filter-group';
        filterGroup.dataset.traitType = traitType;
        filterGroup.style.display = 'none'; // Hidden by default
        
        const header = document.createElement('div');
        header.className = 'filter-header';
        header.textContent = traitType.charAt(0).toUpperCase() + traitType.slice(1);
        filterGroup.appendChild(header);
        
        // Add search input for this trait category
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'trait-search';
        searchInput.placeholder = `Search ${traitType}...`;
        searchInput.autocomplete = `off`;
        searchInput.dataset.traitType = traitType;
        filterGroup.appendChild(searchInput);
        
        // Container for checkboxes
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
            
            // Add event listener to update selected traits display
            checkbox.addEventListener('change', updateSelectedTraitsDisplay);
            
            const span = document.createElement('span');
            span.textContent = value;
            
            checkboxWrapper.appendChild(checkbox);
            checkboxWrapper.appendChild(span);
            checkboxContainer.appendChild(checkboxWrapper);
        });
        
        filterGroup.appendChild(checkboxContainer);
        filterGroupsContainer.appendChild(filterGroup);
        
        // Add search event listener
        searchInput.addEventListener('input', (e) => {
            filterTraitOptions(traitType, e.target.value);
        });
    });
    
    // Add dropdown change event listener
    dropdown.addEventListener('change', (e) => {
        const selectedCategory = e.target.value;
        
        // Hide all filter groups
        const allFilterGroups = document.querySelectorAll('.filter-group');
        allFilterGroups.forEach(group => {
            group.style.display = 'none';
        });
        
        // Show selected filter group
        if (selectedCategory) {
            const selectedGroup = document.querySelector(`.filter-group[data-trait-type="${selectedCategory}"]`);
            if (selectedGroup) {
                selectedGroup.style.display = 'block';
            }
        }
    });
    
    // console.log('Filter controls created for traits:', Object.keys(allTraits));
}

// Filter trait options based on search input
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
    
    // Show "no results" message if nothing matches
    let noResultsMsg = container.querySelector('.no-trait-results');
    
    if (visibleCount === 0) {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.className = 'no-trait-results';
            noResultsMsg.textContent = 'No matching traits found';
            container.appendChild(noResultsMsg);
        }
    } else {
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

// Display NFT card with close button
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
    
    const closeButtonHTML = showCloseButton ? `
        <button class="close-btn" onclick="removeSelectedID('${id}')" title="Remove this Kamigotchi">×</button>
    ` : '';
    
    card.innerHTML = `
        ${closeButtonHTML}
        <img src="${imageUrl}" alt="NFT #${id}" onerror="this.src='https://via.placeholder.com/250?text=Image+Not+Found'">
        <div class="nft-id">Kamigotchi #${id}</div>
        ${traitsHTML}
    `;
    
    return card;
}

// Update selected IDs display
function updateSelectedIDsDisplay() {
    const selectedIDsDiv = document.getElementById('selectedIDs');
    
    if (selectedIDs.size === 0) {
        selectedIDsDiv.style.display = 'none';
        return;
    }
    
    selectedIDsDiv.style.display = 'block';
    
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'selected-cards-grid';
    
    selectedIDsDiv.innerHTML = ''; // Clear previous content first!

    selectedIDs.forEach(id => {
        const card = displayNFT(id, true);
        if (card) {
            cardsContainer.appendChild(card);
        }
    });
    
    selectedIDsDiv.appendChild(cardsContainer);
}

// Add ID to selected list
function searchByID() {
    const searchInput = document.getElementById('searchInput');
    const id = searchInput.value.trim();
    
    if (!id) {
        alert('Please enter an NFT ID');
        return;
    }
    
    // Check if ID exists in data
    if (!imagesData[id] || !traitsData[id]) {
        alert(`Kamigotchi #${id} not found. Please check the ID and try again.`);
        return;
    }
    
    // Check if already selected
    if (selectedIDs.has(id)) {
        alert(`Kamigotchi #${id} is already added!`);
        return;
    }
    
    // console.log('Adding ID:', id);
    selectedIDs.add(id);
    updateSelectedIDsDisplay();
    searchInput.value = ''; // Clear input after adding
}

// Remove ID from selected list
function removeSelectedID(id) {
    // console.log('Removing ID:', id);
    selectedIDs.delete(id);
    updateSelectedIDsDisplay();
}

// Make removeSelectedID available globally
window.removeSelectedID = removeSelectedID;

// Clear all selected IDs
function clearAllSelectedIDs() {
    selectedIDs.clear();
    updateSelectedIDsDisplay();
    document.getElementById('searchInput').value = '';
}

// Filter by traits with multiple selection support
function filterByTraits() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '<div class="no-results">Filtering...</div>';
    
    // Get all checked checkboxes
    const checkboxes = document.querySelectorAll('.trait-checkbox:checked');
    
    // If no traits selected, show all NFTs
    if (checkboxes.length === 0) {
        const allNFTs = Object.keys(traitsData)
            .sort((a, b) => Number(b) - Number(a)); // Sort in descending order (reverse)
        
        // console.log('No filters selected, showing all NFTs in reverse:', allNFTs.length);
        
        resultsDiv.innerHTML = '';
        
        // Add count header
        const countDiv = document.createElement('div');
        countDiv.style.gridColumn = '1 / -1';
        countDiv.style.textAlign = 'center';
        countDiv.style.padding = '15px';
        countDiv.style.fontSize = '1.1em';
        countDiv.style.fontWeight = 'bold';
        countDiv.style.color = '#667eea';
        countDiv.style.background = '#f0f4ff';
        countDiv.style.borderRadius = '8px';
        countDiv.style.border = '2px solid #999';
        countDiv.style.marginBottom = '10px';
        
        countDiv.innerHTML = `
            <div style="font-size: 14px; margin-bottom: 5px;">Showing all ${allNFTs.length} Kamigotchi</div>
            <div style="font-size: 14px; color: #666;">No filters applied (Latest first)</div>
        `;
        resultsDiv.appendChild(countDiv);
        
        allNFTs.forEach(id => {
            const card = displayNFT(id, false);
            if (card) resultsDiv.appendChild(card);
        });
        
        return;
    }
    
    // Organize selected traits by type
    const selectedTraits = {};
    checkboxes.forEach(checkbox => {
        const traitType = checkbox.dataset.traitType;
        const traitValue = checkbox.dataset.traitValue;
        
        if (!selectedTraits[traitType]) {
            selectedTraits[traitType] = [];
        }
        selectedTraits[traitType].push(traitValue);
    });
    
    // console.log('Filtering with:', selectedTraits);
    
    // Filter NFTs - an NFT matches if for each trait type, it has at least one of the selected values
    const matchingNFTs = Object.keys(traitsData)
        .filter(id => {
            const nftTraits = traitsData[id];
            
            // For each trait type that has selections, check if the NFT has one of those values
            return Object.entries(selectedTraits).every(([traitType, selectedValues]) => {
                return selectedValues.includes(nftTraits[traitType]);
            });
        })
        .sort((a, b) => Number(b) - Number(a)); // Sort in descending order (reverse)
    
    // console.log('Found matching NFTs in reverse:', matchingNFTs.length);
    
    resultsDiv.innerHTML = '';
    
    if (matchingNFTs.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">No Kamigotchi match your selected traits</div>';
        return;
    }
    
    // Add count header with selected traits info
    const countDiv = document.createElement('div');
    countDiv.style.gridColumn = '1 / -1';
    countDiv.style.textAlign = 'center';
    countDiv.style.padding = '15px';
    countDiv.style.fontSize = '1.1em';
    countDiv.style.fontWeight = 'bold';
    countDiv.style.color = '#667eea';
    countDiv.style.background = '#f0f4ff';
    countDiv.style.borderRadius = '8px';
    countDiv.style.border = '2px solid #999';
    countDiv.style.marginBottom = '10px';
    
    const filterSummary = Object.entries(selectedTraits)
        .map(([type, values]) => `${type}: ${values.join(' OR ')}`)
        .join(' | ');
    
    countDiv.innerHTML = `
        <div style="font-size: 14px; margin-bottom: 5px;">Found ${matchingNFTs.length} matching Kamigotchi</div>
        <div style="font-size: 14px; color: #666;">${filterSummary} (Latest first)</div>
    `;
    resultsDiv.appendChild(countDiv);
    
    matchingNFTs.forEach(id => {
        const card = displayNFT(id, false);
        if (card) resultsDiv.appendChild(card);
    });
}

// Clear filters
function clearFilters() {
    const checkboxes = document.querySelectorAll('.trait-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = false);
    
    // Clear all search inputs
    const searchInputs = document.querySelectorAll('.trait-search');
    searchInputs.forEach(input => {
        input.value = '';
        const traitType = input.dataset.traitType;
        filterTraitOptions(traitType, '');
    });
    
    // Reset dropdown to default
    const dropdown = document.getElementById('traitCategoryDropdown');
    if (dropdown) {
        dropdown.value = '';
    }
    
    // Hide all filter groups
    const allFilterGroups = document.querySelectorAll('.filter-group');
    allFilterGroups.forEach(group => {
        group.style.display = 'none';
    });
    
    // Update selected traits display
    updateSelectedTraitsDisplay();
    
    document.getElementById('results').innerHTML = '';
}

// Event listeners
document.getElementById('searchBtn').addEventListener('click', searchByID);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByID();
});
document.getElementById('clearSearchBtn').addEventListener('click', clearAllSelectedIDs);
document.getElementById('filterBtn').addEventListener('click', filterByTraits);
document.getElementById('clearBtn').addEventListener('click', clearFilters);

// Load data on page load
loadData();