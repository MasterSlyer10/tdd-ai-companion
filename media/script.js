(function () {
  // Acquire VS Code API
  const vscode = acquireVsCodeApi();

  // State management
  let fileTree = null;
  let sourceFiles = [];
  let testFiles = [];
  let currentFeature = "";
  let contextMenu = null;
  let expandedFolders = new Set();
  let checkedItems = new Set();
  let messageIdCounter = 0; // Counter for unique message IDs
  let currentTokenCount = 0; // Token counter
  const TOKEN_LIMIT = 100000; // Token limit
  let isRequestCancelled = false; // Flag to track if the current request is cancelled
  let activePromptId = null; // Track the ID of the currently active prompt

  // DOM Elements
  let tokenCountDisplay = null; // To display token count
  const featureInput = document.getElementById("feature-input");
  // const editFeatureButton = document.getElementById("edit-feature");

  const fileTreeElement = document.getElementById("file-tree");
  const refreshTreeButton = document.getElementById("refresh-tree");
  const fileFilterInput = document.getElementById("file-filter");
  const sourceFilesContainer = document.getElementById("source-files");
  const testFilesContainer = document.getElementById("test-files");

  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-button");
  const suggestTestButton = document.getElementById("suggest-test-button");
  const suggestTestCaseButton = document.getElementById("suggest-test-case-button"); // New button
  const chatMessages = document.getElementById("chat-messages");
  const suggestionsHistory = document.getElementById("suggestions-history");

  const newChatButton = document.getElementById("new-chat-button");
  const openSettingsButton = document.getElementById("open-settings-button");
  // const clearHistoryButton = document.getElementById("clear-history");

  // Initialize
  document.addEventListener("DOMContentLoaded", () => {
    init();
    console.log("Document loaded"); // Debugging
  });

  // Helper function to set the state of the send/stop button
  function setSendButtonState(state) { // "send", "stop", or "stopping"
    if (!sendButton) return;
    sendButton.dataset.state = state;
    sendButton.classList.remove('stop-button-animated'); // Remove animation class by default

    if (state === "stop") {
      sendButton.innerHTML = '<i class="codicon codicon-debug-stop"></i>'; // Use icon only
      sendButton.title = "Stop Generating";
      sendButton.classList.add('stop-button-animated'); // Add animation class
      if (chatInput) chatInput.disabled = true;
    } else if (state === "stopping") {
      sendButton.innerHTML = '<i class="codicon codicon-loading"></i>'; // Use loading icon
      sendButton.title = "Stopping...";
      sendButton.classList.add('stop-button-animated'); // Keep animation for stopping state
      if (chatInput) chatInput.disabled = true; // Keep input disabled while stopping
    }
     else { // "send"
      sendButton.innerHTML = '<i class="codicon codicon-send"></i>';
      sendButton.title = "Send Request";
      if (chatInput) chatInput.disabled = false;
    }
    // Update visibility of message actions based on the new state
    updateMessageActionsVisibility(state === "stop" || state === "stopping");
  }

  // New function to control visibility of edit/delete/rerun buttons
  function updateMessageActionsVisibility(hide) {
    if (!chatMessages) return;

    const messages = chatMessages.querySelectorAll('.message');
    messages.forEach(messageElement => {
      // Target specific buttons: edit, delete, rerun, and also save/cancel in edit mode
      const buttonsToToggle = messageElement.querySelectorAll(
        '.edit-button, .delete-button, .rerun-button, .save-resend-button, .cancel-edit-button'
      );
      
      buttonsToToggle.forEach(button => {
        button.style.display = hide ? 'none' : 'flex'; // 'flex' is the default display
      });
    });
  }

  function init() {
    // Tells the extension when the view is ready to receive
    vscode.postMessage({
      command: "webviewReady",
    });

    // Set up event listeners
    setupEventListeners();
    setSendButtonState("send"); // Initial state

    // Set up feature input
    setupFeatureInput();

    // Request workspace files
    requestWorkspaceFiles();

    // Load history from storage
    loadHistoryFromStorage();

    // Load checked items from storage
    loadCheckedItemsFromState();

    // Reset cancellation flag and active prompt ID on init
    isRequestCancelled = false;
    activePromptId = null;

    // Load token count from state
    loadTokenCountFromState();

    // Initialize and display token count
    initializeTokenDisplay(); // Create the display element and place it
    updateTokenDisplay(); // Set initial text and color

    // Removed selection mode toggles as per user request

    // Add click handler to document to close context menu
    document.addEventListener("click", (e) => {
      if (contextMenu && !contextMenu.contains(e.target)) {
        removeContextMenu();
      }
    });
    
    // Add global document-level click handler for all thinking section toggles
    document.addEventListener("click", (e) => {
      // Check if the clicked element is a thinking header or its child
      let target = e.target;
      let thinkingHeader = null;
      
      // Check if we clicked the header itself
      if (target.classList && target.classList.contains('thinking-header')) {
        thinkingHeader = target;
      } 
      // Check if we clicked the toggle button or its icon
      else if (target.classList && 
          (target.classList.contains('thinking-toggle') || 
           (target.parentElement && target.parentElement.classList.contains('thinking-toggle')))) {
        // Get the header (parent of toggle button or grandparent of icon)
        thinkingHeader = target.classList.contains('thinking-toggle') ? 
                        target.parentElement : 
                        target.parentElement.parentElement;
      }
      // Check if we clicked on the title text
      else if (target.classList && target.classList.contains('thinking-title')) {
        thinkingHeader = target.parentElement;
      }
      
      // If we found a thinking header, toggle its section
      if (thinkingHeader) {
        const thinkingSection = thinkingHeader.parentElement;
        if (thinkingSection && thinkingSection.classList.contains('thinking-section')) {
          e.preventDefault();
          e.stopPropagation();
          
          console.log("Global handler: Toggling thinking section");
          
          // Get content before toggling class
          const content = thinkingSection.querySelector('.thinking-content');
          
          // Toggle the collapsed class
          const wasCollapsed = thinkingSection.classList.contains('collapsed');
          
          // Update the icon
          const icon = thinkingSection.querySelector('.thinking-toggle i');
          if (icon) {
            icon.className = wasCollapsed ? 
                            'codicon codicon-chevron-down' : 
                            'codicon codicon-chevron-right';
          }
          
          // Handle content visibility and padding
          if (content) {
            if (wasCollapsed) {
              // Make content visible immediately when expanding
              content.style.display = 'block';
              content.style.visibility = 'visible';
              content.style.opacity = '1';
              content.style.maxHeight = '500px';
              content.style.paddingTop = '10px';
              content.style.paddingBottom = '10px';
              content.style.transform = 'scaleY(1)';
              
              // Toggle class after setting styles for expansion
              thinkingSection.classList.remove('collapsed');
            } else {
              // Hide content immediately when collapsing
              content.style.display = 'none';
              content.style.visibility = 'hidden';
              content.style.opacity = '0';
              content.style.maxHeight = '0';
              content.style.paddingTop = '0';
              content.style.paddingBottom = '0';
              content.style.transform = 'scaleY(0)';
              
              // Toggle class after setting styles for collapse
              thinkingSection.classList.add('collapsed');
            }
          } else {
            // If no content element found, just toggle the class
            thinkingSection.classList.toggle('collapsed');
          }
        }
      }
    });
  }

  function setupEventListeners() {
    // Feature editing
    // editFeatureButton.addEventListener("click", () => {
    //   promptForFeature();
    // });

    // Tree view controls
    refreshTreeButton.addEventListener("click", () => {
      // The refreshTreeButton now ONLY refreshes the file tree.
      // Edit saving/handling is done by a dedicated button within the message edit UI.
      console.log("Refreshing file tree.");
      requestWorkspaceFiles();
    });

    // File filtering
    fileFilterInput.addEventListener("input", () => {
      filterFileTree();
    });

    // Chat functionality
    if (sendButton) {
      console.log("Send button found");
      sendButton.addEventListener("click", handleSendOrStopClick); // Unified handler
    } else {
      console.error("Send button not found");
    }

    if (suggestTestButton) {
      // Modify the suggest test button to be an icon with hover text
      suggestTestButton.className = "suggest-test-button-icon";
      suggestTestButton.innerHTML = '<i class="codicon codicon-lightbulb"></i>';
      suggestTestButton.title = "Suggest test cases"; // Tooltip handled by CSS :after

      suggestTestButton.addEventListener("click", () => {
        console.log("Suggest test button clicked");
        sendPredefinedSuggestion();
      });
    } else {
      console.error("Suggest test button not found");
    }

    // Add event listener for the new suggest test case button
    if (suggestTestCaseButton) {
      suggestTestCaseButton.addEventListener("click", () => {
        console.log("Suggest test case button clicked");
        sendSuggestTestCaseMessage(); // New function to handle this
      });
    } else {
      console.error("Suggest test case button not found");
    }

    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          console.log("Enter key pressed"); // Debugging
          sendChatMessage();
        }
      });
    } else {
      console.error("Chat input not found");
    }

    // New chat button
    newChatButton.addEventListener("click", () => {
      if (chatMessages) {
        chatMessages.innerHTML = "";
      }
      vscode.postMessage({
        command: "newChat",
      });
      currentTokenCount = 0; // Reset token count
      saveTokenCountToState(); // Save reset count
      // Re-enable chat input if it was disabled
      if (chatInput) chatInput.disabled = false;
      if (sendButton) sendButton.disabled = false;
      // Remove any token limit message
      const tokenLimitMsg = document.getElementById("token-limit-message");
      if (tokenLimitMsg) tokenLimitMsg.remove();
      updateTokenDisplay(); // Update display after reset
      setSendButtonState("send"); // Ensure button is in send state
    });

    if (openSettingsButton) {
      openSettingsButton.addEventListener("click", () => {
        vscode.postMessage({ command: "openExtensionSettings" });
      });
    }
    // Clear history
    // clearHistoryButton.addEventListener("click", clearHistory);
  }

  // Feature handling
  function setupFeatureInput() {
    if (!featureInput) return;

    // Initial value - set placeholder if empty
    if (!currentFeature) {
      featureInput.placeholder = "Enter feature name/description";
    } else {
      featureInput.value = currentFeature;
    }

    // Handle input changes with debounce
    featureInput.addEventListener(
      "input",
      debounce(function () {
        const newFeature = featureInput.value.trim();
        if (newFeature !== currentFeature) {
          currentFeature = newFeature;
          vscode.postMessage({ command: "updateFeature", feature: newFeature });
        }
      }, 500)
    ); // Wait 500ms after typing stops before updating
  }

  // Useless
  function promptForFeature() {
    const currentValue = currentFeature || "";
    const feature = prompt(
      "Enter the feature you are working on:",
      currentValue
    );

    if (feature !== null) {
      updateFeature(feature);
      vscode.postMessage({ command: "updateFeature", feature });
    }
  }

  function updateFeature(feature) {
    currentFeature = feature;
    if (featureInput) {
      featureInput.value = feature || "";
    }
  }

  // Debounce helper function
  function debounce(func, wait) {
    let timeout;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        func.apply(context, args);
      }, wait);
    };
  }

  // File tree handling
  function requestWorkspaceFiles() {
    vscode.postMessage({ command: "getWorkspaceFiles" });
  }

  function renderFileTree() {
    if (!fileTree) return;

    fileTreeElement.innerHTML = "";
    renderTreeNode(fileTree, fileTreeElement, 0);
  }

  function renderTreeNode(node, parentElement, level) {
    const filter = fileFilterInput.value.toLowerCase();

    // Don't render hidden files/folders
    if (node.name.startsWith(".")) return;

    // For files, check if they match the filter
    if (
      node.type === "file" &&
      filter &&
      !node.name.toLowerCase().includes(filter)
    ) {
      return;
    }

    // For directories, check if any children match
    if (node.type === "directory" && filter) {
      const anyChildMatches = hasMatchingChild(node, filter);
      if (!anyChildMatches) return;
    }

    const itemElement = document.createElement("div");
    itemElement.className = "tree-item";
    itemElement.dataset.path = node.path;
    itemElement.dataset.type = node.type;

    // Add indentation
    for (let i = 0; i < level; i++) {
      const indentElement = document.createElement("div");
      indentElement.className = "tree-item-indent";
      itemElement.appendChild(indentElement);
    }

    // Add checkbox
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tree-item-checkbox";
    // Determine initial state based on checkedItems and descendants
    const initialState = getCheckboxState(node);
    checkbox.checked = initialState === 'checked';
    checkbox.indeterminate = initialState === 'indeterminate';

    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      handleCheckboxChange(node, checkbox.checked);
      // Trigger upward cascade after handling the change
      updateParentCheckboxStateInTree(itemElement);
    });
    itemElement.appendChild(checkbox);

    // Add expand/collapse button for directories
    if (node.type === "directory") {
      const expandElement = document.createElement("div");
      expandElement.className = "tree-item-expand";

      const isExpanded = expandedFolders.has(node.path) || filter;
      expandElement.innerHTML = isExpanded
        ? '<i class="codicon codicon-chevron-down"></i>'
        : '<i class="codicon codicon-chevron-right"></i>';

      expandElement.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFolder(node.path);
      });

      itemElement.appendChild(expandElement);
    } else {
      const spacerElement = document.createElement("div");
      spacerElement.className = "tree-item-indent";
      itemElement.appendChild(spacerElement);
    }

    // Add icon
    const iconElement = document.createElement("i");
    iconElement.className = `codicon tree-item-icon ${
      node.type === "directory" ? "codicon-folder" : "codicon-file"
    }`;
    itemElement.appendChild(iconElement);

    // Add name
    const nameElement = document.createElement("span");
    nameElement.textContent = node.name;
    itemElement.appendChild(nameElement);

    // Check if this file is selected (only files are added to sourceFiles)
    const isSourceFile = sourceFiles.some((f) => f === node.path);
    // const isTestFile = testFiles.some((f) => f === node.path); // Removed test files for now

    if (isSourceFile) {
      const indicator = document.createElement("i");

      // Removed class
      indicator.className = "codicon tree-item-indicator";
      indicator.style.marginLeft = "4px";
      indicator.style.fontSize = "12px";
      indicator.style.color = "var(--primary-color)";
      itemElement.appendChild(indicator);
    }

    // if (isTestFile) {
    //   const indicator = document.createElement("i");
    //   indicator.className = "codicon codicon-beaker tree-item-indicator";
    //   indicator.style.marginLeft = "4px";
    //   indicator.style.fontSize = "12px";
    //   indicator.style.color = "#b05800";
    //   itemElement.appendChild(indicator);
    // }

    // Add click handlers
    itemElement.addEventListener("click", (e) => {
      // Don't trigger folder toggle or file opening when clicking the checkbox
      if (e.target !== checkbox) {
        if (node.type === "directory") {
          toggleFolder(node.path);
        } else {
          // Open the file
          vscode.postMessage({
            command: "openFile",
            path: node.path,
          });
        }
      }
    });

    itemElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (node.type === "file") {
        showContextMenu(e, node.path);
      }
    });

    parentElement.appendChild(itemElement);

    // Render children for directories
    if (
      node.type === "directory" &&
      node.children &&
      (expandedFolders.has(node.path) || filter)
    ) {
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      childrenContainer.dataset.parent = node.path;

      node.children.forEach((child) => {
        renderTreeNode(child, childrenContainer, level + 1);
      });

      parentElement.appendChild(childrenContainer);
    }
  }

  // Add function to handle checkbox changes
  function handleCheckboxChange(node, isChecked) {
    // Update checkedItems set for the clicked item
    if (isChecked) {
      checkedItems.add(node.path);
    } else {
      checkedItems.delete(node.path);
    }

    // Apply to children if it's a directory
    if (node.type === "directory" && node.children) {
      updateChildCheckboxes(node, isChecked);
    }

    // Handle file selection for source files (only for files or when a folder is checked/unchecked)
    if (node.type === "file") {
       if (isChecked) {
        // Add to source files if not already there
        if (!sourceFiles.includes(node.path)) {
          vscode.postMessage({
            command: "selectSourceFile",
            path: node.path,
          });
        }
      } else {
        // Remove from source files
        if (sourceFiles.includes(node.path)) {
          vscode.postMessage({
            command: "deselectSourceFile",
            path: node.path,
          });
        }
      }
    } else if (node.type === 'directory') {
        // When a folder is checked/unchecked, update sourceFiles based on its descendant files
        if (isChecked) {
            // Add all descendant files to sourceFiles
            getAllDescendantFiles(node).forEach(filePath => {
                 if (!sourceFiles.includes(filePath)) {
                    vscode.postMessage({
                        command: "selectSourceFile",
                        path: filePath,
                    });
                }
            });
        } else {
            // Remove all descendant files from sourceFiles
             getAllDescendantFiles(node).forEach(filePath => {
                 if (sourceFiles.includes(filePath)) {
                    vscode.postMessage({
                        command: "deselectSourceFile",
                        path: filePath,
                    });
                }
            });
        }
    }


    // Save checked items to state
    saveCheckedItemsToState();
    saveCheckedItems();

    // Re-render tree to show selection (this will also update parent states)
    renderFileTree();
  }

  // Add function to recursively update child checkboxes
  function updateChildCheckboxes(node, isChecked) {
    if (!node.children) return;

    node.children.forEach((child) => {
      if (isChecked) {
        checkedItems.add(child.path);
      } else {
        checkedItems.delete(child.path);
      }

      // Recursively update if it's a directory
      if (child.type === "directory") {
        updateChildCheckboxes(child, isChecked);
      }
      // Note: File selection messages are now handled in handleCheckboxChange for folders
      // to ensure only files are added/removed from sourceFiles.
    });
  }

  // Helper function to get all descendant file paths of a folder
  function getAllDescendantFiles(node) {
      const files = [];
      if (node.type === 'file') {
          files.push(node.path);
      } else if (node.type === 'directory' && node.children) {
          node.children.forEach(child => {
              files.push(...getAllDescendantFiles(child)); // Recursively get files
          });
      }
      return files;
  }


  // Add function to save checked items to state
  function saveCheckedItemsToState() {
    try {
      // Convert Set to Array for storage
      const checkedItemsArray = Array.from(checkedItems);
      vscode.setState({
        ...vscode.getState(),
        checkedItems: checkedItemsArray,
      });

      // Optionally notify extension
      vscode.postMessage({
        command: "updateCheckedItems",
        paths: checkedItemsArray,
      });
    } catch (e) {
      console.error("Failed to save checked items:", e);
    }
  }

  // Save checked items
  function saveCheckedItems() {
    vscode.postMessage({
      command: "saveCheckedItems",
      checkedItems: Array.from(checkedItems),
    });
  }

  // Add function to load checked items from state
  function loadCheckedItemsFromState() {
    try {
      const storedItems = vscode.getState()?.checkedItems;
      if (storedItems && Array.isArray(storedItems)) {
        checkedItems = new Set(storedItems);
      }
    } catch (e) {
      console.error("Failed to load checked items:", e);
    }
  }

  // Add function to save token count to state
  function saveTokenCountToState() {
    try {
      vscode.setState({
        ...vscode.getState(),
        currentTokenCount: currentTokenCount,
      });
    } catch (e) {
      console.error("Failed to save token count:", e);
    }
  }

  // Add function to load token count from state
  function loadTokenCountFromState() {
    try {
      const storedTokenCount = vscode.getState()?.currentTokenCount;
      if (typeof storedTokenCount === 'number') {
        currentTokenCount = storedTokenCount;
      }
      // Check if limit is already reached on load
      if (currentTokenCount >= TOKEN_LIMIT) {
        if (chatInput) chatInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
        let tokenLimitMsg = document.getElementById("token-limit-message");
        if (!tokenLimitMsg) {
            tokenLimitMsg = document.createElement("div");
            tokenLimitMsg.id = "token-limit-message";
            tokenLimitMsg.style.color = "red";
            tokenLimitMsg.style.padding = "5px";
            tokenLimitMsg.textContent = `Token limit (${TOKEN_LIMIT}) reached. Please start a new chat to continue.`;
            if (chatInput && chatInput.parentNode) {
                chatInput.parentNode.insertBefore(tokenLimitMsg, chatInput);
            } else {
                chatMessages.appendChild(tokenLimitMsg);
            }
        }
      }
      updateTokenDisplay(); // Update display after loading
    } catch (e) {
      console.error("Failed to load token count:", e);
    }
  }

  // Function to initialize the token count display element and place it
  function initializeTokenDisplay() {
    if (!tokenCountDisplay) {
      tokenCountDisplay = document.createElement("div");
      tokenCountDisplay.id = "token-count-display";
      tokenCountDisplay.className = "token-count-display"; // Add the new CSS class

      // Find the chat input area container (which should have position: relative)
      const chatInputAreaContainer = document.querySelector('.chat-input-area');
      if (chatInputAreaContainer) {
        chatInputAreaContainer.appendChild(tokenCountDisplay); // Append to the container
      } else {
        console.warn("Chat input area container not found for token display.");
        // Fallback: append to body or another suitable element if the container isn't found
        document.body.appendChild(tokenCountDisplay);
      }
    }
  }

  // Function to update the token count display
  function updateTokenDisplay() {
    if (tokenCountDisplay) {
      tokenCountDisplay.textContent = `Tokens: ${currentTokenCount} / ${TOKEN_LIMIT}`;
      if (currentTokenCount >= TOKEN_LIMIT) {
        tokenCountDisplay.classList.add('error'); // Add error class for styling
      } else {
        tokenCountDisplay.classList.remove('error'); // Remove error class
      }
    }
  }

  function toggleFolder(path) {
    if (expandedFolders.has(path)) {
      expandedFolders.delete(path);
    } else {
      expandedFolders.add(path);
    }
    renderFileTree();
  }

  function collapseAllFolders() {
    expandedFolders.clear();
    renderFileTree();
  }

  function hasMatchingChild(node, filter) {
    if (node.type === "file") {
      return node.name.toLowerCase().includes(filter);
    }

    if (node.type === "directory" && node.children) {
      return node.children.some((child) => hasMatchingChild(child, filter));
    }

    return false;
  }

  function filterFileTree() {
    renderFileTree();
  }

  function showContextMenu(event, filePath) {
    // Remove existing context menu
    removeContextMenu();

    // Create new context menu
    contextMenu = document.createElement("div");
    contextMenu.className = "context-menu";
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.style.top = `${event.clientY}px`;

    // Check if file is already in source or test files
    const isSourceFile = sourceFiles.includes(filePath);
    const isTestFile = testFiles.some((f) => f === filePath); // Use some for testFiles

    // Add source file option
    const sourceOption = document.createElement("div");
    sourceOption.className = "context-menu-item";
    sourceOption.innerHTML = `<i class="codicon codicon-file-code"></i> ${
      isSourceFile ? "Remove from" : "Add to"
    } Source Files`;
    sourceOption.addEventListener("click", () => {
      if (isSourceFile) {
        vscode.postMessage({ command: "deselectSourceFile", path: filePath });
      } else {
        vscode.postMessage({ command: "selectSourceFile", path: filePath });
      }
      removeContextMenu();
    });
    contextMenu.appendChild(sourceOption);

    // Add test file option
    const testOption = document.createElement("div");
    testOption.className = "context-menu-item";
    testOption.innerHTML = `<i class="codicon codicon-beaker"></i> ${
      isTestFile ? "Remove from" : "Add to"
    } Test Files`;
    testOption.addEventListener("click", () => {
      if (isTestFile) {
        vscode.postMessage({ command: "deselectTestFile", path: filePath });
      } else {
        vscode.postMessage({ command: "selectTestFile", path: filePath });
      }
      removeContextMenu();
    });
    contextMenu.appendChild(testOption);

    // Add open file option
    const openOption = document.createElement("div");
    openOption.className = "context-menu-item";
    openOption.innerHTML =
      '<i class="codicon codicon-go-to-file"></i> Open File';
    openOption.addEventListener("click", () => {
      vscode.postMessage({ command: "openFile", path: filePath });
      removeContextMenu();
    });
    contextMenu.appendChild(openOption);

    document.body.appendChild(contextMenu);

    // Adjust position if menu goes off screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }
  }

  function removeContextMenu() {
    if (contextMenu && contextMenu.parentNode) {
      contextMenu.parentNode.removeChild(contextMenu);
      contextMenu = null;
    }
  }

  // Source and test files handling
  function updateSourceFilesDisplay() {
    sourceFilesContainer.innerHTML = "";

    if (sourceFiles.length === 0) {
      sourceFilesContainer.textContent = "None selected";
      return;
    }

    // Sort files alphabetically by name for consistent display
    const sortedSourceFiles = [...sourceFiles].sort((a, b) => {
        const nameA = a.split(/[\/\\]/).pop().toLowerCase();
        const nameB = b.split(/[\/\\]/).pop().toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });


    sortedSourceFiles.forEach((filePath) => {
      const fileName = filePath.split(/[\/\\]/).pop();
      const chip = createFileChip(fileName, filePath, "source");
      sourceFilesContainer.appendChild(chip);
    });
  }

  function updateTestFilesDisplay() {
    testFilesContainer.innerHTML = "";

    if (testFiles.length === 0) {
      testFilesContainer.textContent = "None selected";
      return;
    }

    // Sort files alphabetically by name for consistent display
     const sortedTestFiles = [...testFiles].sort((a, b) => {
        const nameA = a.split(/[\/\\]/).pop().toLowerCase();
        const nameB = b.split(/[\/\\]/).pop().toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    sortedTestFiles.forEach((filePath) => {
      const fileName = filePath.split(/[\/\\]/).pop();
      const chip = createFileChip(fileName, filePath, "test");
      testFilesContainer.appendChild(chip);
    });
  }

  function createFileChip(name, path, type) {
    const chip = document.createElement("div");
    chip.className = "file-chip";

    const nameEl = document.createElement("span");
    nameEl.textContent = name;
    nameEl.title = path;
    chip.appendChild(nameEl);

    const removeBtn = document.createElement("span");
    removeBtn.className = "file-chip-remove";
    removeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (type === "source") {
        vscode.postMessage({ command: "deselectSourceFile", path });
      } else {
        vscode.postMessage({ command: "deselectTestFile", path });
      }
    });
    chip.appendChild(removeBtn);

    // Open file on chip click
    chip.addEventListener("click", () => {
      vscode.postMessage({ command: "openFile", path });
    });

    return chip;
  }

  // CHAT FUNCTIONALITY PARTS
  //
  function handleSendOrStopClick() {
    if (!sendButton) return;

    if (sendButton.dataset.state === "stop") {
      console.log("Stop button clicked");
      vscode.postMessage({ command: "cancelRequest" });
      setSendButtonState("stopping");
      isRequestCancelled = true; // Global flag for immediate effect
      activePromptId = null; // Invalidate the active prompt ID on cancellation

      // Mark the currently streaming message, if any, as explicitly cancelled
      const streamingMsg = document.querySelector('.message.ai-message[data-streaming="true"]');
      if (streamingMsg) {
          streamingMsg.dataset.explicitlyCancelled = "true";
          console.log("[Cancellation] Marked streaming message as explicitly cancelled by user action:", streamingMsg.id);
      }
      // Wait for the 'requestCancelled' message from the extension for full UI reset.
    } else {
      console.log("Send button clicked (from handleSendOrStopClick)");
      sendChatMessage();
    }
  }

  function sendChatMessage() {
    // Explicitly get the element and its value again, right before sending.
    const currentChatInputElement = document.getElementById("chat-input");
    const message = currentChatInputElement ? currentChatInputElement.value.trim() : "";

    if (!message) {
      return; // Don't send empty messages
    }

    // Check token limit
    if (currentTokenCount >= TOKEN_LIMIT) {
      let tokenLimitMsg = document.getElementById("token-limit-message");
      if (!tokenLimitMsg) {
        tokenLimitMsg = document.createElement("div");
        tokenLimitMsg.id = "token-limit-message";
        tokenLimitMsg.style.color = "red";
        tokenLimitMsg.style.padding = "5px";
        tokenLimitMsg.textContent = `Token limit (${TOKEN_LIMIT}) reached. Please start a new chat to continue.`;
        // Insert before chat input or after chat messages
        if (chatInput && chatInput.parentNode) {
            chatInput.parentNode.insertBefore(tokenLimitMsg, chatInput);
        } else {
            chatMessages.appendChild(tokenLimitMsg);
        }
      }
      // Disable input and send button
      if (chatInput) chatInput.disabled = true;
      if (sendButton) sendButton.disabled = true;
      return;
    }

    // Token counting for user's message is now handled by the extension side via totalInputTokens.
    // The webview will only add tokens when it receives them from the extension.

    // This console.log will appear in the Webview Developer Tools console
    console.log("Webview: Sending message to extension:", message, `Current Total Tokens (before this turn): ${currentTokenCount}`);

    setSendButtonState("stop"); // Change to Stop button
    isRequestCancelled = false; // Reset cancellation flag for new request

    // Generate a unique prompt ID for this request
    const promptId = Date.now().toString();
    activePromptId = promptId; // Set the active prompt ID

    // Add message to UI
    addMessageToChat(message, true, promptId); // Pass promptId to addMessageToChat

    // Clear input field
    chatInput.value = "";

    // Display loading indicator
    const loadingElement = document.createElement("div");
    loadingElement.className = "loading-indicator";
    loadingElement.textContent = "Generating response...";
    chatMessages.appendChild(loadingElement);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send message to extension with the prompt ID
    vscode.postMessage({
      command: "requestTestSuggestion",
      message: message,
      promptId: promptId, // Include the prompt ID
    });
  }

  // Simple Suggest Button (Lightbulb icon)
  function sendPredefinedSuggestion() {
    // Send a predefined message
    const predefinedMessage =
      "Suggest a new test case for my current implementation";

    // Set the input field text (optional - shows the user what's being sent)
    if (chatInput) {
      chatInput.value = predefinedMessage;
    }

    setSendButtonState("stop"); // Change to Stop button
    isRequestCancelled = false; // Reset cancellation flag for new request

    // Generate a unique prompt ID for this request
    const promptId = Date.now().toString();
    activePromptId = promptId; // Set the active prompt ID

    // Add message to UI
    addMessageToChat(predefinedMessage, true, promptId); // Pass promptId to addMessageToChat

    // Clear input field
    if (chatInput) {
      chatInput.value = "";
    }

    // Display loading indicator
    const loadingElement = document.createElement("div");
    loadingElement.className = "loading-indicator";
    loadingElement.textContent = "Generating response...";
    chatMessages.appendChild(loadingElement);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send message to extension with the prompt ID
    vscode.postMessage({
      command: "requestTestSuggestion",
      message: predefinedMessage,
      promptId: promptId, // Include the prompt ID
    });
  }

  // New function for the "Suggest Test Case" button
  function sendSuggestTestCaseMessage() {
     // Send a predefined message for suggesting a test case
    const predefinedMessage =
      "Suggest a new test case for my current implementation"; // Same message as the lightbulb for now

    // Set the input field text (optional - shows the user what's being sent)
    if (chatInput) {
      chatInput.value = predefinedMessage;
    }

    setSendButtonState("stop"); // Change to Stop button
    isRequestCancelled = false; // Reset cancellation flag for new request

    // Generate a unique prompt ID for this request
    const promptId = Date.now().toString();
    activePromptId = promptId; // Set the active prompt ID

    // Add message to UI
    addMessageToChat(predefinedMessage, true, promptId); // Pass promptId to addMessageToChat

    // Clear input field
    if (chatInput) {
      chatInput.value = "";
    }

    // Display loading indicator
    const loadingElement = document.createElement("div");
    loadingElement.className = "loading-indicator";
    loadingElement.textContent = "Generating response...";
    chatMessages.appendChild(loadingElement);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send message to extension with the prompt ID
    vscode.postMessage({
      command: "requestTestSuggestion",
      message: predefinedMessage,
      promptId: promptId, // Include the prompt ID
    });
  }

  // Add message to chat UI
  function addMessageToChat(content, isUser = false, promptId = null) { // Accept promptId
    const messageId = `msg-${messageIdCounter++}`; // Generate unique ID

    // Create message element
    const messageElement = document.createElement("div");
    messageElement.id = messageId; // Assign ID
    messageElement.className = isUser
      ? "message user-message"
      : "message ai-message";

    // Add promptId to the message element's dataset if provided
    if (promptId) {
        messageElement.dataset.promptId = promptId;
    }

    // Add avatar
    const avatarElement = document.createElement("div");
    avatarElement.className = "message-avatar";
    avatarElement.innerHTML = isUser
      ? '<i class="codicon codicon-account"></i>'
      : '<i class="codicon codicon-beaker"></i>';
    messageElement.appendChild(avatarElement);

    // Add content
    const contentElement = document.createElement("div");
    contentElement.className = "message-content";

    if (isUser) {
      messageElement.dataset.rawText = content; // Store raw text for user messages
    }

    // For AI messages, use marked to render markdown
    if (!isUser && typeof marked !== "undefined") {
      try {
        // Configure marked options for better rendering
        marked.setOptions({
          highlight: function (code, lang) {
            if (Prism.languages[lang]) {
              return Prism.highlight(code, Prism.languages[lang], lang);
            }
            return code;
          },
          breaks: true,
          gfm: true,
        });

        // Parse markdown to HTML
        contentElement.innerHTML = marked.parse(content);

        // Apply additional styling for better readability
        setTimeout(() => {
          // Apply highlighting to code blocks
          if (typeof Prism !== "undefined") {
            contentElement.querySelectorAll("pre code").forEach((block) => {
              Prism.highlightElement(block);
            });
          }
        }, 0);
      } catch (e) {
        console.error("Error rendering markdown:", e);
        contentElement.textContent = content; // Fallback to text
      }
    } else {
      contentElement.textContent = content; // User messages are plain text
    }
    // Create a wrapper for content and actions
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "message-content-wrapper"; // Add a new class for styling

    contentWrapper.appendChild(contentElement);

    // Add actions container
    const actionsElement = document.createElement("div");
    actionsElement.className = "message-actions";

    // Add Copy Button
    const copyButton = document.createElement("button");
    copyButton.className = "message-action-button copy-button";
    // Copy button is always visible, so its display is not managed by isGenerating
    copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
    copyButton.title = "Copy message";
    copyButton.onclick = () => {
        // Use dataset.rawText for user messages, innerHTML for AI messages (to preserve formatting)
        const textToCopy = isUser ? messageElement.dataset.rawText : contentElement.textContent;
        navigator.clipboard.writeText(textToCopy).then(() => {
            // Optional: Provide visual feedback (e.g., change icon or show a tooltip)
            console.log("Message copied to clipboard");
        }).catch(err => {
            console.error("Failed to copy message: ", err);
        });
    };
    actionsElement.appendChild(copyButton);

    const isCurrentlyGenerating = sendButton.dataset.state === "stop" || sendButton.dataset.state === "stopping";

    if (isUser) {
      const editButton = document.createElement("button");
      editButton.className = "message-action-button edit-button";
      editButton.innerHTML = '<i class="codicon codicon-edit"></i>';
      editButton.title = "Edit message";
      editButton.style.display = isCurrentlyGenerating ? 'none' : 'flex';
      // Use messageElement.dataset.rawText to ensure the *current* text is edited
      editButton.onclick = () => handleEditUserMessage(messageElement, contentElement, messageElement.dataset.rawText);
      actionsElement.appendChild(editButton);

      const deleteUserButton = document.createElement("button");
      deleteUserButton.className = "message-action-button delete-button"; // This is a "delete-button"
      deleteUserButton.innerHTML = '<i class="codicon codicon-trash"></i>';
      deleteUserButton.title = "Delete message and subsequent responses";
      deleteUserButton.style.display = isCurrentlyGenerating ? 'none' : 'flex';
      deleteUserButton.onclick = () => handleDeleteUserMessage(messageElement);
      actionsElement.appendChild(deleteUserButton);

    } else { // AI message
      const deleteButton = document.createElement("button");
      deleteButton.className = "message-action-button delete-button"; // This is also a "delete-button"
      deleteButton.innerHTML = '<i class="codicon codicon-trash"></i>';
      deleteButton.title = "Delete message";
      deleteButton.style.display = isCurrentlyGenerating ? 'none' : 'flex';
      deleteButton.onclick = () => handleDeleteAIMessage(messageElement);
      actionsElement.appendChild(deleteButton);
    }
    contentWrapper.appendChild(actionsElement); // Append actions to the wrapper

    messageElement.appendChild(contentWrapper); // Append the wrapper to the message element


    // Remove any loading indicators
    const loadingIndicators =
      chatMessages.querySelectorAll(".loading-indicator");
    loadingIndicators.forEach((indicator) => indicator.remove());

    // Add to chat
    chatMessages.appendChild(messageElement);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Save chat history
    saveChatHistory();
  }

  // This function is called when an AI response or a system message (like "cancelled") is added.
  // It should ensure the UI (button, input) is in the correct state.
  // This function is now primarily called when a response is *successfully* received.
  // Cancellation UI reset is handled specifically in the 'requestCancelled' message handler.
  function finalizeChatTurn() {
    // Only revert to send state if not currently in a stopping state (waiting for cancellation confirmation)
    if (sendButton && sendButton.dataset.state !== "stopping") {
       setSendButtonState("send"); // Revert to send state
    }
    // Loading indicators are removed either by addMessageToChat or by the requestCancelled handler.
  }

  //

  function addUserMessage(text) {
    const messageElement = document.createElement("div");
    messageElement.className = "message user-message";
    messageElement.textContent = text;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Add to history
    addToHistory(text, "user");
  }

  function addAssistantMessage(text) {
    const messageElement = document.createElement("div");
    messageElement.className = "message assistant-message";
    messageElement.textContent = text;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Add to history
    addToHistory(text, "assistant");
  }

  function addToHistory(text, role) {
    const history = loadHistoryFromStorage() || [];

    if (role === "user") {
      history.push({ role: "user", content: text });
    } else {
      // Find last user message and append this response
      const lastUserIndex = findLastIndex(
        history,
        (item) => item.role === "user"
      );
      if (lastUserIndex !== -1 && !history[lastUserIndex].response) {
        history[lastUserIndex].response = text;
      }
    }

    // Save updated history
    saveHistoryToStorage(history);

    // Update history UI
    updateHistoryUI(history);
  }

  function findLastIndex(array, predicate) {
    for (let i = array.length - 1; i >= 0; i--) {
      if (predicate(array[i])) return i;
    }
    return -1;
  }

  // To fix
  function loadHistoryFromStorage() {
    try {
      const storedHistory = vscode.getState()?.history;
      return storedHistory || [];
    } catch (e) {
      console.error("Failed to load history:", e);
      return [];
    }
  }

  // To fix
  function saveHistoryToStorage(history) {
    try {
      vscode.setState({ ...vscode.getState(), history });
    } catch (e) {
      console.error("Failed to save history:", e);
    }
  }

  // To fix
  function updateHistoryUI(history) {
    suggestionsHistory.innerHTML = "";

    if (history.length === 0) {
      const emptyMessage = document.createElement("div");
      emptyMessage.className = "history-empty";
      emptyMessage.textContent = "No suggestions history yet";
      suggestionsHistory.appendChild(emptyMessage);
      return;
    }

    history.forEach((item) => {
      if (item.role === "user" && item.response) {
        const historyItem = document.createElement("div");
        historyItem.className = "suggestion-item";

        const title = document.createElement("h2");
        title.textContent = item.content;
        historyItem.appendChild(title);

        const response = document.createElement("div");
        response.className = "suggestion-response";
        response.textContent = item.response;
        historyItem.appendChild(response);

        suggestionsHistory.appendChild(historyItem);
      }
    });
  }

  // Save chat history
  function saveChatHistory() {
    const messages = Array.from(chatMessages.children)
      .filter(
        (msg) =>
          msg.classList.contains("user-message") ||
          msg.classList.contains("ai-message")
      )
      .map((msg) => {
        const isUser = msg.classList.contains("user-message");
        const contentEl = msg.querySelector(".message-content");

        // For assistant messages, get the original HTML to preserve markdown
        const content = isUser ? contentEl.textContent : contentEl.innerHTML;

        return {
          role: isUser ? "user" : "assistant",
          content: content,
          // Add a flag to indicate this content contains HTML
          contentType: isUser ? "text" : "html",
        };
      });

    vscode.postMessage({
      command: "saveChatHistory",
      history: messages,
    });
  }

  // START - New functions for message editing and deletion
  function handleDeleteAIMessage(aiMessageElement) {
    if (!aiMessageElement || aiMessageElement.parentNode !== chatMessages) {
        return;
    }

    let userMessageElement = aiMessageElement.previousElementSibling;
    // Traverse backwards to find the closest preceding user message
    while (userMessageElement && !userMessageElement.classList.contains('user-message')) {
        userMessageElement = userMessageElement.previousElementSibling;
    }

    if (!userMessageElement || !userMessageElement.classList.contains('user-message')) {
        // Could not find a preceding user message, just delete the AI message
        chatMessages.removeChild(aiMessageElement);
        saveChatHistory();
        return;
    }

    const promptToResend = userMessageElement.dataset.rawText;
    if (typeof promptToResend === 'undefined') {
        console.error("Could not find raw text for user message to re-run.", userMessageElement);
        // Fallback: just delete the AI message
        chatMessages.removeChild(aiMessageElement);
        saveChatHistory();
        return;
    }

    // Remove the AI message
    chatMessages.removeChild(aiMessageElement);
    // saveChatHistory will be called after button logic or if button not added

    const actionsElement = userMessageElement.querySelector('.message-actions');
    if (actionsElement && !actionsElement.querySelector('.rerun-button')) {
        const isCurrentlyGenerating = sendButton.dataset.state === "stop" || sendButton.dataset.state === "stopping";
        const rerunButton = document.createElement("button");
        rerunButton.className = "message-action-button rerun-button";
        rerunButton.innerHTML = '<i class="codicon codicon-refresh"></i>';
        rerunButton.title = "Re-run prompt";
        rerunButton.style.display = isCurrentlyGenerating ? 'none' : 'flex';

        rerunButton.onclick = () => {
            // 1. Remove all messages *after* this userMessageElement
            let nextSibling = userMessageElement.nextElementSibling;
            while (nextSibling) {
                const toRemove = nextSibling;
                nextSibling = nextSibling.nextElementSibling;
                if (chatMessages.contains(toRemove)) {
                    chatMessages.removeChild(toRemove);
                }
            }

            // 2. Save chat history now that subsequent messages are cleared
            saveChatHistory();

            // 3. Display loading indicator
            const loadingElement = document.createElement("div");
            loadingElement.className = "loading-indicator";
            loadingElement.textContent = "Generating response..."; // Consistent with other loading texts
            chatMessages.appendChild(loadingElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // 4. Send the message to the extension
            vscode.postMessage({
                command: "requestTestSuggestion",
                message: promptToResend,
            });

            // 5. Remove the rerunButton itself after click
            if (rerunButton.parentNode) {
                rerunButton.parentNode.removeChild(rerunButton);
            }
        };
        actionsElement.appendChild(rerunButton);
    }
    saveChatHistory(); // Save history after AI message deletion and potential button addition
  }

  function handleEditUserMessage(messageElement, contentElement, originalRawContent) {
    // Prevent editing if already in edit mode
    if (contentElement.querySelector('textarea.edit-area')) {
      return;
    }

    // Add 'editing' class to the message element
    messageElement.classList.add('editing');

    contentElement.innerHTML = ''; // Clear current content (e.g., the static text)

    const editArea = document.createElement('textarea');
    editArea.className = 'edit-area';
    editArea.value = originalRawContent; // Use the raw text for editing

    // Auto-resize textarea
    editArea.style.height = 'auto';
    editArea.style.height = (editArea.scrollHeight) + 'px';
    editArea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    const reloadAndSaveButton = document.createElement('button');
    reloadAndSaveButton.textContent = 'Save & Resend';
    reloadAndSaveButton.className = 'edit-action-button save-resend-button'; // Add a specific class
    reloadAndSaveButton.title = 'Save changes, delete subsequent messages, resend, and refresh file tree';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'edit-action-button cancel-edit-button'; // Add a specific class
    cancelButton.title = 'Cancel editing';

    // Find the existing message-actions container
    const actionsElement = messageElement.querySelector('.message-actions');
    if (!actionsElement) {
        console.error("Message actions container not found for editing.");
        // Fallback: just append the edit area and buttons below the content if actions not found
        const buttonContainer = document.createElement('div');
        buttonContainer.style.marginTop = '5px';
        buttonContainer.appendChild(reloadAndSaveButton);
        buttonContainer.appendChild(cancelButton);

        contentElement.appendChild(editArea);
        contentElement.appendChild(buttonContainer);
        editArea.focus();
        return; // Exit the function after fallback
    }

    // Hide the original action buttons (copy, edit, delete)
    actionsElement.querySelectorAll('.message-action-button:not(.edit-action-button)').forEach(btn => {
        btn.style.display = 'none';
    });

    // Append the edit area to the content element
    contentElement.appendChild(editArea);

    // Append the new buttons to the actions container
    actionsElement.appendChild(reloadAndSaveButton);
    actionsElement.appendChild(cancelButton);

    // Ensure actions container is visible and uses flex display in edit mode
    actionsElement.style.opacity = 1;
    actionsElement.style.display = 'flex';

    // Add event listeners for the new buttons
    reloadAndSaveButton.onclick = () => {
      const newContent = editArea.value.trim();
      if (newContent === "") {
        alert("Message cannot be empty.");
        return;
      }

      // 1. Update UI: Exit edit mode by replacing textarea with new text
      contentElement.innerHTML = '';
      contentElement.textContent = newContent;
      messageElement.dataset.rawText = newContent;

      // 2. Delete all subsequent messages
      let currentMsg = messageElement.nextElementSibling;
      while (currentMsg) {
        const toRemove = currentMsg;
        currentMsg = currentMsg.nextElementSibling;  // Fixed: properly declare and update currentMsg
        if (chatMessages.contains(toRemove)) {
          chatMessages.removeChild(toRemove);
        }
      }

      // 3. Save chat history
      saveChatHistory();

      // 4. Display loading indicator and resend the edited message
      const loadingElement = document.createElement("div");
      loadingElement.className = "loading-indicator";
      loadingElement.textContent = "Generating response...";
      chatMessages.appendChild(loadingElement);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Generate a new prompt ID for this edited request
      const promptId = Date.now().toString();
      activePromptId = promptId;

      // Cancel any existing request before sending the new one
      vscode.postMessage({ command: "cancelRequest" });
      isRequestCancelled = false;  // Reset cancellation flag

      // Send the edited message to extension with the new prompt ID
      vscode.postMessage({
        command: "requestTestSuggestion",
        message: newContent,
        promptId: promptId,
      });

      // 4a. Set button state to "stop" to indicate generation and hide actions
      setSendButtonState("stop");

      // 5. Refresh file tree
      requestWorkspaceFiles();

      // 6. Restore original action buttons
      restoreOriginalActions(messageElement);
    };

    cancelButton.onclick = () => {
      // Restore original content and remove edit UI
      contentElement.innerHTML = ''; // Clear textarea and buttons
      contentElement.textContent = originalRawContent; // Restore text
      // messageElement.dataset.rawText remains the value from before this edit attempt

    // Restore original action buttons
    restoreOriginalActions(messageElement);
  };


    editArea.focus();
  }

  // Function to restore original actions visibility when editing is cancelled or saved
  function restoreOriginalActions(messageElement) {
      const actionsElement = messageElement.querySelector('.message-actions');
      if (actionsElement) {
          // Remove edit action buttons (Save & Resend, Cancel)
          actionsElement.querySelectorAll('.edit-action-button').forEach(btn => {
              if (btn.parentNode) {
                  btn.parentNode.removeChild(btn);
              }
          });

          // Remove the 'editing' class
          messageElement.classList.remove('editing');

          // Do NOT explicitly set display style for original buttons here.
          // Their visibility will be managed by updateMessageActionsVisibility
          // which is called by setSendButtonState.
      }
  }

  // handleSaveUserEdit and handleCancelUserEdit are no longer needed.
  // END - New functions for message editing and deletion

  // Handle messages from the extension
  window.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.command) {
      case "updateFileTree":
        fileTree = message.fileTree;
        renderFileTree();
        break;

      case "updateSourceFiles":
        sourceFiles = message.files || [];
        updateSourceFilesDisplay();
        renderFileTree(); // Re-render to show selection
        break;

      case "updateTestFiles":
        testFiles = message.files || [];
        updateTestFilesDisplay();
        renderFileTree(); // Re-render to show selection
        break;

      case "updateFeature":
        updateFeature(message.feature);
        break;

      case "addResponse":
        // This command is likely deprecated with streaming, but keep for safety.
        // If the request was cancelled on the frontend, ignore this response
        if (isRequestCancelled) {
            console.log("Received response after cancellation, ignoring.");
            return;
        }

        // Remove any loading indicators
        const loadingIndicators =
          chatMessages.querySelectorAll(".loading-indicator");
        loadingIndicators.forEach((indicator) => indicator.remove());

        // Add the AI response to the chat
        addMessageToChat(message.response, false); // This will call finalizeChatTurn indirectly if !isUser

        let tokensThisTurn = 0;
        // Add total input tokens for this turn (sent from extension)
        if (typeof message.totalInputTokens === 'number') {
          tokensThisTurn += message.totalInputTokens;
          console.log(`Input Tokens (from extension): ${message.totalInputTokens}`);
        }

        // If the AI response includes a token count, add it
        if (typeof message.responseTokenCount === 'number') {
          tokensThisTurn += message.responseTokenCount;
          console.log(`AI Response Tokens: ${message.responseTokenCount}`);
        }

        if (tokensThisTurn > 0) {
          currentTokenCount += tokensThisTurn;
          saveTokenCountToState();
          updateTokenDisplay();
          console.log(`Total Tokens Added This Turn: ${tokensThisTurn}, New Grand Total: ${currentTokenCount}`);
        }

        // Check limit again after adding all tokens for this turn
        if (currentTokenCount >= TOKEN_LIMIT) {
            if (chatInput) chatInput.disabled = true;
            if (sendButton) sendButton.disabled = true;
            let tokenLimitMsg = document.getElementById("token-limit-message");
            if (!tokenLimitMsg) {
                tokenLimitMsg = document.createElement("div");
                tokenLimitMsg.id = "token-limit-message";
                tokenLimitMsg.style.color = "var(--vscode-errorForeground)"; // Use VS Code theme variable for error
                tokenLimitMsg.style.padding = "5px";
                tokenLimitMsg.textContent = `Token limit (${TOKEN_LIMIT}) reached. Please start a new chat to continue.`;
                if (chatInput && chatInput.parentNode) {
                    chatInput.parentNode.insertBefore(tokenLimitMsg, chatInput);
                } else {
                    chatMessages.appendChild(tokenLimitMsg);
                }
            }
            if (tokenCountDisplay) {
                 tokenCountDisplay.style.color = "var(--vscode-errorForeground)";
            }
        }
        console.log("[Webview] addResponse: Finalizing chat turn.");
        finalizeChatTurn(); // Ensure UI is reset after processing response
        break;

      case "startResponseStream":
        console.log("[Stream Debug] Received startResponseStream command with promptId:", message.promptId);
        // Check if the received promptId matches the active promptId
        if (message.promptId !== activePromptId) {
            console.log("[Stream Debug] Received startResponseStream for old promptId, ignoring.");
            return;
        }

        // Remove any loading indicators before we start streaming
        document.querySelectorAll(".loading-indicator").forEach(indicator => indicator.remove());

        // Remove any previous streaming message if it exists (shouldn't happen with promptId check, but as a safeguard)
        const existingStreamingMessage = document.querySelector('.message.ai-message[data-streaming="true"]');
        if (existingStreamingMessage) {
             console.log("[Stream Debug] Removing existing streaming message before starting new stream.");
             existingStreamingMessage.remove();
        }

        // Create a new message element for the streaming response
        const streamingMessageElement = document.createElement("div");
        streamingMessageElement.id = `msg-${messageIdCounter++}`;
        streamingMessageElement.className = "message ai-message";
        streamingMessageElement.dataset.streaming = "true"; // Mark as streaming
        streamingMessageElement.dataset.promptId = message.promptId; // Store the promptId on the element
        console.log("[Stream Debug] Created streaming message element with ID:", streamingMessageElement.id, "and promptId:", streamingMessageElement.dataset.promptId);

        // Add avatar
        const avatarElement = document.createElement("div");
        avatarElement.className = "message-avatar";
        avatarElement.innerHTML = '<i class="codicon codicon-beaker"></i>';
        streamingMessageElement.appendChild(avatarElement);

        // Add content container
        const contentElement = document.createElement("div");
        contentElement.className = "message-content";

        // Create wrapper for content and actions
        const contentWrapper = document.createElement("div");
        contentWrapper.className = "message-content-wrapper";
        contentWrapper.appendChild(contentElement);

        // Add the actions container (initially empty)
        const actionsElement = document.createElement("div");
        actionsElement.className = "message-actions";
        contentWrapper.appendChild(actionsElement);

        streamingMessageElement.appendChild(contentWrapper);
        chatMessages.appendChild(streamingMessageElement);
        console.log("[Stream Debug] Streaming message element added to DOM");

        // Scroll to the bottom to show the new message
        chatMessages.scrollTop = chatMessages.scrollHeight;
        break;

      case "appendResponseChunk":
        console.log("[Stream Debug] Received appendResponseChunk command. Chunk:", message.chunk, "Is first chunk:", message.isFirstChunk, "PromptId:", message.promptId);

        // Check if the received promptId matches the active promptId
        if (message.promptId !== activePromptId) {
            console.log("[Stream Debug] Received appendResponseChunk for old promptId, ignoring.");
            return;
        }

        // Find the streaming message element for this promptId
        const currentStreamingMessage = document.querySelector(`.message.ai-message[data-streaming="true"][data-prompt-id="${message.promptId}"]`);

        if (!currentStreamingMessage) {
          console.log("[Stream Debug] No streaming message element found for appendResponseChunk with matching promptId, ignoring chunk.");
          return;
        }

        // Check if this specific stream was explicitly cancelled by user action (redundant with activePromptId check, but keep for safety)
        if (currentStreamingMessage.dataset.explicitlyCancelled === "true") {
          console.log("[Stream Debug] Ignoring appendResponseChunk for explicitly user-cancelled stream:", currentStreamingMessage.id);
          if (currentStreamingMessage.parentNode) currentStreamingMessage.remove(); // Ensure cleanup
          return;
        }

        const contentEl = currentStreamingMessage.querySelector('.message-content');
        if (!contentEl) {
          console.error("[Stream Debug] No content element found in streaming message");
          return;
        }

        // Get current raw text content or initialize it
        if (!currentStreamingMessage.dataset.rawText) {
          console.log("[Stream Debug] Initializing rawText in dataset");
          currentStreamingMessage.dataset.rawText = '';
        }

        // Append the new chunk to the raw text
        currentStreamingMessage.dataset.rawText += message.chunk;
        console.log("[Stream Debug] Updated rawText, new length:", currentStreamingMessage.dataset.rawText.length);

        // Special handling for thinking and answer sections
        const currentRawText = currentStreamingMessage.dataset.rawText;

        // Check if we have thinking and answer markers
        const hasThinkingMarker = currentRawText.includes('**Thinking:**');
        const hasAnswerMarker = currentRawText.includes('**Answer:**');

        // If we have both markers, we can split the content
        if (hasThinkingMarker && hasAnswerMarker) {
          console.log("[Stream Debug] Found both thinking and answer markers");
          const thinkingStart = currentRawText.indexOf('**Thinking:**');
          const answerStart = currentRawText.indexOf('**Answer:**');

          if (thinkingStart >= 0 && answerStart > thinkingStart) {
            // Extract thinking and answer parts
            const thinkingPart = currentRawText.substring(thinkingStart + 13, answerStart).trim();
            const answerPart = currentRawText.substring(answerStart + 11).trim();

            // Create or update the thinking section
            let thinkingSection = contentEl.querySelector('.thinking-section');
            if (!thinkingSection) {
              thinkingSection = document.createElement('div');
              thinkingSection.className = 'thinking-section';
              thinkingSection.innerHTML = '<div class="thinking-header"><span class="thinking-title">Thinking</span><button class="thinking-toggle"><i class="codicon codicon-chevron-down"></i></button></div><div class="thinking-content"></div>';
              contentEl.innerHTML = '';
              contentEl.appendChild(thinkingSection);
            }

            // Update thinking content
            const thinkingContent = thinkingSection.querySelector('.thinking-content');
            if (thinkingContent) {
              thinkingContent.innerHTML = marked.parse(thinkingPart);
              // Apply syntax highlighting to thinking content
              if (typeof Prism !== "undefined") {
                thinkingContent.querySelectorAll("pre code").forEach((block) => {
                  Prism.highlightElement(block);
                });
              }
            }

            // Create or update the answer section
            let answerSection = contentEl.querySelector('.answer-section');
            if (!answerSection) {
              answerSection = document.createElement('div');
              answerSection.className = 'answer-section';
              contentEl.appendChild(answerSection);
            }

            // Update answer content
            answerSection.innerHTML = marked.parse(answerPart);
            // Apply syntax highlighting to answer content
            if (typeof Prism !== "undefined") {
              answerSection.querySelectorAll("pre code").forEach((block) => {
                Prism.highlightElement(block);
              });
            }
          }
        }
        // Special handling for code blocks (keep this logic for code blocks without thinking/answer markers)
        else {
          // Check if we're in the middle of a code block
          const codeBlockStarts = (currentRawText.match(/```/g) || []).length;
          const isInCodeBlock = codeBlockStarts % 2 !== 0;
          console.log("[Stream Debug] Code block analysis - Starts:", codeBlockStarts, "Is in code block:", isInCodeBlock);

          try {
            // If we're in the middle of a code block, we'll just add the raw text for now
            // and wait until the code block is complete before rendering markdown
            if (isInCodeBlock && !message.isFirstChunk) {
              console.log("[Stream Debug] Handling incomplete code block");
              // For code blocks, use a monospace container and preserve whitespace
              if (!contentEl.querySelector('.temp-code-block')) {
                console.log("[Stream Debug] Creating new temporary code block");
                // Create a temporary code block container if it doesn't exist
                const tempCodeBlock = document.createElement('div');
                tempCodeBlock.className = 'temp-code-block';
                tempCodeBlock.style.fontFamily = 'monospace';
                tempCodeBlock.style.whiteSpace = 'pre-wrap';
                tempCodeBlock.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
                tempCodeBlock.style.padding = '1em';
                tempCodeBlock.style.borderRadius = '4px';
                tempCodeBlock.style.marginTop = '0.7em';
                tempCodeBlock.style.marginBottom = '0.7em';
                tempCodeBlock.style.overflow = 'auto';

                // Find where the last code block starts and only show content after that
                const lastCodeBlockStart = currentRawText.lastIndexOf('```');
                console.log("[Stream Debug] Last code block start index:", lastCodeBlockStart);
                // Extract language if specified
                let language = '';
                const textAfterTicks = currentRawText.substring(lastCodeBlockStart + 3);
                const firstLineEnd = textAfterTicks.indexOf('\n');
                if (firstLineEnd > 0) {
                  language = textAfterTicks.substring(0, firstLineEnd).trim();
                  console.log("[Stream Debug] Detected language for code block:", language);
                }

                // Set a data attribute for the language for later highlighting
                tempCodeBlock.dataset.language = language;

                // Add the code content so far (excluding the opening ticks and language)
                const codeContent = firstLineEnd > 0 ?
                  textAfterTicks.substring(firstLineEnd + 1) :
                  textAfterTicks;
                console.log("[Stream Debug] Code content length:", codeContent.length);

                tempCodeBlock.textContent = codeContent;

                // Replace any existing content with our parsed version
                contentEl.innerHTML = '';

                // Render the content before the code block as markdown
                if (lastCodeBlockStart > 0) {
                  const contentBeforeCodeBlock = currentRawText.substring(0, lastCodeBlockStart);
                  console.log("[Stream Debug] Content before code block, length:", contentBeforeCodeBlock.length);
                  const beforeElement = document.createElement('div');
                  beforeElement.innerHTML = marked.parse(contentBeforeCodeBlock);
                  contentEl.appendChild(beforeElement);
                }

                // Add our temp code block
                contentEl.appendChild(tempCodeBlock);
                console.log("[Stream Debug] Temp code block added to DOM");
              } else {
                console.log("[Stream Debug] Updating existing temporary code block");
                // Update the existing temp code block with the latest content
                const tempCodeBlock = contentEl.querySelector('.temp-code-block');

                // Find where the last code block starts
                const lastCodeBlockStart = currentRawText.lastIndexOf('```');

                // Extract language if specified
                const textAfterTicks = currentRawText.substring(lastCodeBlockStart + 3);
                const firstLineEnd = textAfterTicks.indexOf('\n');

                // Get the code content (excluding the opening ticks and language)
                const codeContent = firstLineEnd > 0 ?
                  textAfterTicks.substring(firstLineEnd + 1) :
                  textAfterTicks;
                console.log("[Stream Debug] Updated code content length:", codeContent.length);

                tempCodeBlock.textContent = codeContent;
              }
            } else {
              console.log("[Stream Debug] Rendering complete markdown (not in code block or first chunk)");
              // We can safely render the full content with markdown
              // If it's the first chunk or if we're not in a code block
              if (typeof marked !== "undefined") {
                console.log("[Stream Debug] Using marked to render markdown");
                contentEl.innerHTML = marked.parse(currentRawText);

                // Apply syntax highlighting to all complete code blocks
                if (typeof Prism !== "undefined") {
                  console.log("[Stream Debug] Applying Prism syntax highlighting");
                  contentEl.querySelectorAll("pre code").forEach((block) => {
                    Prism.highlightElement(block);
                  });
                }
              } else {
                console.log("[Stream Debug] Marked not available, falling back to plain text");
                // Fallback to plain text if marked is not available
                contentEl.textContent = currentRawText;
              }
            }
          } catch (e) {
            console.error("[Stream Debug] Error handling response chunk:", e);
            // Fallback: just append as plain text
            contentEl.textContent = currentRawText;
          }
        }

        // Scroll to the bottom as content is added
        chatMessages.scrollTop = chatMessages.scrollHeight;
        break;

      case "endResponseStream":
        console.log("[Stream Debug] Received endResponseStream command with promptId:", message.promptId);

        // Check if the received promptId matches the active promptId
        if (message.promptId !== activePromptId) {
            console.log("[Stream Debug] Received endResponseStream for old promptId, ignoring.");
            return;
        }

        const streamedMessage = document.querySelector(`.message.ai-message[data-streaming="true"][data-prompt-id="${message.promptId}"]`);

        if (!streamedMessage) {
          console.log("[Stream Debug] No streaming message element found to finalize for endResponseStream with matching promptId. Potentially from a cancelled and removed stream.");
          return; // Do not call finalizeChatTurn() or saveChatHistory()
        }

        // Check if this specific stream was explicitly cancelled by user action (redundant with activePromptId check, but keep for safety)
        if (streamedMessage.dataset.explicitlyCancelled === "true") {
          console.log("[Stream Debug] Ignoring endResponseStream for explicitly user-cancelled stream:", streamedMessage.id);
          if (streamedMessage.parentNode) streamedMessage.remove(); // Ensure cleanup
          return; // Do not call finalizeChatTurn() or saveChatHistory()
        }

        // Get the raw text that was accumulated during streaming
        const rawText = streamedMessage.dataset.rawText || message.fullResponse || '';
        console.log("[Stream Debug] Final raw text length:", rawText.length);

        // Get the content element
        const streamedContentEl = streamedMessage.querySelector('.message-content');

        // Check if we have thinking and answer markers for final rendering
        const hasThinkingMarkerFinal = rawText.includes('**Thinking:**');
        const hasAnswerMarkerFinal = rawText.includes('**Answer:**');

        // Final render with thinking/answer sections
        if (hasThinkingMarkerFinal && hasAnswerMarkerFinal) {
          console.log("[Stream Debug] Final render with thinking/answer sections");
          const thinkingStartFinal = rawText.indexOf('**Thinking:**');
          const answerStartFinal = rawText.indexOf('**Answer:**');

          if (thinkingStartFinal >= 0 && answerStartFinal > thinkingStartFinal) {
            // Extract thinking and answer parts
            const thinkingPartFinal = rawText.substring(thinkingStartFinal + 13, answerStartFinal).trim();
            const answerPartFinal = rawText.substring(answerStartFinal + 11).trim();

            // Create or update the thinking section
            let thinkingSectionFinal = streamedContentEl.querySelector('.thinking-section');
            if (!thinkingSectionFinal) {
              thinkingSectionFinal = document.createElement('div');
              thinkingSectionFinal.className = 'thinking-section';
              thinkingSectionFinal.innerHTML = '<div class="thinking-header"><span class="thinking-title">Thinking</span><button class="thinking-toggle"><i class="codicon codicon-chevron-down"></i></button></div><div class="thinking-content"></div>';
              streamedContentEl.innerHTML = '';
              streamedContentEl.appendChild(thinkingSectionFinal);

              // Remove the local toggle function and click handlers
              // as we now use the global document click handler
            }

            // Update thinking content
            const thinkingContentFinal = thinkingSectionFinal.querySelector('.thinking-content');
            if (thinkingContentFinal) {
              thinkingContentFinal.innerHTML = marked.parse(thinkingPartFinal);
              // Apply syntax highlighting to thinking content
              if (typeof Prism !== "undefined") {
                thinkingContentFinal.querySelectorAll("pre code").forEach((block) => {
                  Prism.highlightElement(block);
                });
              }
            }

            // Create or update the answer section
            let answerSectionFinal = streamedContentEl.querySelector('.answer-section');
            if (!answerSectionFinal) {
              answerSectionFinal = document.createElement('div');
              answerSectionFinal.className = 'answer-section';
              streamedContentEl.appendChild(answerSectionFinal);
            }

            // Update answer content
            answerSectionFinal.innerHTML = marked.parse(answerPartFinal);
            // Apply syntax highlighting to answer content
            if (typeof Prism !== "undefined") {
              answerSectionFinal.querySelectorAll("pre code").forEach((block) => {
                Prism.highlightElement(block);
              });
            }

            // Auto-collapse thinking section now that we're done streaming
            console.log("[Stream Debug] Auto-collapsing thinking section after streaming");
            const icon = thinkingSectionFinal.querySelector('.thinking-toggle i');
            if (icon) {
              icon.className = 'codicon codicon-chevron-right';
            }

            // Ensure content styles are also updated when collapsing
            const content = thinkingSectionFinal.querySelector('.thinking-content');
            if (content) {
              // Set all styles immediately
              content.style.display = 'none';
              content.style.visibility = 'hidden';
              content.style.opacity = '0';
              content.style.maxHeight = '0';
              content.style.paddingTop = '0';
              content.style.paddingBottom = '0';
              content.style.transform = 'scaleY(0)';
            }

            // Apply collapsed class after setting styles
            thinkingSectionFinal.classList.add('collapsed');
          }
        }
        // Standard final render if no thinking/answer markers
        else {
          try {
            if (typeof marked !== "undefined") {
              console.log("[Stream Debug] Final rendering with marked");
              // Render the full markdown content
              streamedContentEl.innerHTML = marked.parse(rawText);

              // Apply final syntax highlighting to all code blocks
              if (typeof Prism !== "undefined") {
                console.log("[Stream Debug] Final syntax highlighting with Prism");
                streamedContentEl.querySelectorAll("pre code").forEach((block) => {
                  console.log("[Stream Debug] Highlighting code block, language:", block.className);
                  Prism.highlightElement(block);
                });
              }
            } else {
              console.log("[Stream Debug] Marked not available for final render, using plain text");
              // Fallback to plain text if marked is not available
              streamedContentEl.textContent = rawText;
            }
          } catch (e) {
            console.error("[Stream Debug] Error rendering final markdown:", e);
            // Use the existing content if there's an error
          }
        }

        // Remove the streaming flag
        streamedMessage.removeAttribute('data-streaming');
        console.log("[Stream Debug] Removed streaming flag from message");

        // Store the full raw text for copy functionality
        streamedMessage.dataset.rawText = rawText;

        // Add action buttons to the message
        const actionContainer = streamedMessage.querySelector('.message-actions');
        if (actionContainer) {
          console.log("[Stream Debug] Adding action buttons");
          // Clear any existing buttons first
          actionContainer.innerHTML = '';

          // Add Copy Button
          const copyButton = document.createElement("button");
          copyButton.className = "message-action-button copy-button";
          copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
          copyButton.title = "Copy message";
          copyButton.onclick = () => {
            // Use the stored raw text for copying
            navigator.clipboard.writeText(rawText)
              .then(() => {
                console.log("[Stream Debug] Message copied to clipboard");
                // Show a brief visual feedback
                copyButton.innerHTML = '<i class="codicon codicon-check"></i>';
                setTimeout(() => {
                  copyButton.innerHTML = '<i class="codicon codicon-copy"></i>';
                }, 1000);
              })
              .catch(err => {
                console.error("[Stream Debug] Failed to copy message: ", err);
              });
          };
          actionContainer.appendChild(copyButton);

          // Add Delete Button
          const deleteButton = document.createElement("button");
          deleteButton.className = "message-action-button delete-button";
          deleteButton.innerHTML = '<i class="codicon codicon-trash"></i>';
          deleteButton.title = "Delete message";
          deleteButton.onclick = () => handleDeleteAIMessage(streamedMessage);
          actionContainer.appendChild(deleteButton);
        }

        // Save chat history
        saveChatHistory();
        console.log("[Stream Debug] Chat history saved");

        // Reset UI state
        finalizeChatTurn();
        console.log("[Stream Debug] UI state finalized");
        break;

      case "updateResponseMetrics":
        // Update token counts after streaming is complete
        let metricTokens = 0;

        // Add total input tokens for this turn
        if (typeof message.totalInputTokens === 'number') {
          metricTokens += message.totalInputTokens;
          console.log(`Input Tokens (from extension): ${message.totalInputTokens}`);
        }

        // Add response tokens
        if (typeof message.responseTokenCount === 'number') {
          metricTokens += message.responseTokenCount;
          console.log(`AI Response Tokens: ${message.responseTokenCount}`);
        }

        if (metricTokens > 0) {
          currentTokenCount += metricTokens;
          saveTokenCountToState();
          updateTokenDisplay();
          console.log(`Total Tokens Added (From Metrics): ${metricTokens}, New Grand Total: ${currentTokenCount}`);
        }

        // Check token limit
        if (currentTokenCount >= TOKEN_LIMIT) {
          if (chatInput) chatInput.disabled = true;
          if (sendButton) sendButton.disabled = true;
          let tokenLimitMsg = document.getElementById("token-limit-message");
          if (!tokenLimitMsg) {
            tokenLimitMsg = document.createElement("div");
            tokenLimitMsg.id = "token-limit-message";
            tokenLimitMsg.style.color = "var(--vscode-errorForeground)";
            tokenLimitMsg.style.padding = "5px";
            tokenLimitMsg.textContent = `Token limit (${TOKEN_LIMIT}) reached. Please start a new chat to continue.`;
            if (chatInput && chatInput.parentNode) {
              chatInput.parentNode.insertBefore(tokenLimitMsg, chatInput);
            } else {
              chatMessages.appendChild(tokenLimitMsg);
            }
          }
          if (tokenCountDisplay) {
            tokenCountDisplay.style.color = "var(--vscode-errorForeground)";
          }
        }
        break;

      case "requestCancelled": // Message from extension confirming cancellation attempt
        console.log("[Webview] Received requestCancelled message.");
        // Now that the extension has confirmed cancellation attempt, fully reset UI

        isRequestCancelled = true; // Ensure global flag is set upon confirmation from extension
        activePromptId = null; // Invalidate the active prompt ID on cancellation

        // Remove any loading indicators
        const loadingIndicatorsOnCancel = chatMessages.querySelectorAll(".loading-indicator");
        loadingIndicatorsOnCancel.forEach((indicator) => {
            console.log("[Webview] Removing loading indicator on cancellation confirmation from extension.");
            indicator.remove();
        });

        // Remove any currently streaming message. This is a definitive cleanup.
        // Find the streaming message by the promptId that was active when cancel was clicked
        // Note: This assumes the 'requestCancelled' message from the extension includes the promptId
        // associated with the cancelled request. If not, we might need a different approach
        // or rely solely on the activePromptId being set to null.
        // For now, let's remove any message marked as streaming, as the activePromptId check
        // in the stream handlers will prevent new chunks from appearing.
        const streamingMessageOnCancel = document.querySelector('.message.ai-message[data-streaming="true"]');
        if (streamingMessageOnCancel) {
            console.log("[Webview] Removing streaming message on cancellation confirmation from extension:", streamingMessageOnCancel.id);
            streamingMessageOnCancel.remove();
        }

        addMessageToChat("AI request cancelled.", false); // System message
        setSendButtonState("send"); // Fully reset button state (enables input, hides action buttons if needed)
        if (chatInput) chatInput.disabled = false; // Ensure input is enabled
        console.log("[Webview] Processed requestCancelled from extension: Added cancellation message and finalized UI.");
        // No need to call finalizeChatTurn here, as UI is explicitly set by setSendButtonState.
        break;

      case "generationFailed": // New message to handle generation errors
        console.error("[Webview] Received generationFailed message. AI generation failed."); // Log the error in the webview console
        // Explicitly remove loading indicators before adding the failure message
        const loadingIndicatorsOnFail = chatMessages.querySelectorAll(".loading-indicator");
        loadingIndicatorsOnFail.forEach((indicator) => {
             console.log("[Webview] Removing loading indicator on generation failure.");
             indicator.remove();
        });
        addMessageToChat("AI generation failed. Please try again.", false); // Inform the user
        console.log("[Webview] Added failure message. Finalizing chat turn.");
        finalizeChatTurn(); // Reset UI state
        break;

      case "updateCheckedItems":
        // Handle if extension wants to update checked items
        if (message.paths && Array.isArray(message.paths)) {
          checkedItems = new Set(message.paths);
          renderFileTree();
        }
        break;
      case "uncheckFileTreeItem":
        // Handle message to uncheck an item in the file tree
        if (message.path) {
            checkedItems.delete(message.path);
            // Find the corresponding checkbox in the DOM and update its state
            const itemElement = fileTreeElement.querySelector(`.tree-item[data-path="${message.path}"]`);
            if (itemElement) {
                const checkbox = itemElement.querySelector('.tree-item-checkbox');
                if (checkbox) {
                    checkbox.checked = false;
                    checkbox.indeterminate = false;
                    // Also update parent checkbox states
                    updateParentCheckboxStateInTree(itemElement);
                }
            }
            saveCheckedItemsToState();
            saveCheckedItems();
        }
        break;
      case "loadChatHistory":
        chatMessages.innerHTML = ""; // Clear existing messages
        // Reset messageIdCounter when loading history to ensure fresh IDs for the new set of messages
        // or ensure IDs are saved/loaded if they need to be persistent across sessions.
        // For this implementation, ephemeral IDs are fine, so resetting is not strictly needed
        // as new messages will continue from the current counter.
        // However, if messages were frequently reloaded without page refresh, it might be good.
        // Let's assume it's fine for now. messageIdCounter will just keep incrementing.

        if (message.history && message.history.length > 0) {
          message.history.forEach((msg) => {
            // Use the addMessageToChat function to render historical messages
            addMessageToChat(msg.content, msg.role === "user");
          });

          // Scroll to bottom after all messages are added
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        break;
      case "loadCheckedItems":
        checkedItems = new Set(message.checkedItems || []);
        // Apply checked state to checkboxes in the tree
        if (fileTree) {
          // Re-render the tree to apply the loaded checked state and indeterminate states
          renderFileTree();
        }
        break;
      case "clearChatUI":
        chatMessages.innerHTML = "";
        break;
    }
  });

  // Helper function to get the checkbox state of a node (checked, unchecked, or indeterminate)
  function getCheckboxState(node) {
      if (node.type === 'file') {
          return checkedItems.has(node.path) ? 'checked' : 'unchecked';
      }

      if (node.type === 'directory' && node.children) {
          const descendantFiles = getAllDescendantFiles(node);
          if (descendantFiles.length === 0) {
              // If a folder has no files, its state depends on whether the folder itself is checked
              return checkedItems.has(node.path) ? 'checked' : 'unchecked';
          }

          const allDescendantFilesChecked = descendantFiles.every(filePath => checkedItems.has(filePath));
          const anyDescendantFilesChecked = descendantFiles.some(filePath => checkedItems.has(filePath));

          if (allDescendantFilesChecked) {
              return 'checked';
          } else if (anyDescendantFilesChecked) {
              return 'indeterminate';
          } else {
              return 'unchecked';
          }
      }

      return 'unchecked'; // Default for unexpected types
  }

  // Helper function to update the checkbox state of parent elements in the DOM tree
  function updateParentCheckboxStateInTree(itemElement) {
      let currentElement = itemElement.parentElement;
      while (currentElement && currentElement.classList.contains('tree-children')) {
          const parentItemElement = currentElement.previousElementSibling; // The tree-item element of the parent
          if (parentItemElement && parentItemElement.classList.contains('tree-item')) {
              const parentPath = parentItemElement.dataset.path;
              const parentNode = findNodeByPath(parentPath, fileTree); // Find the corresponding node in the data

              if (parentNode) {
                  const parentCheckbox = parentItemElement.querySelector('.tree-item-checkbox');
                  if (parentCheckbox) {
                      const parentState = getCheckboxState(parentNode);
                      parentCheckbox.checked = parentState === 'checked';
                      parentCheckbox.indeterminate = parentState === 'indeterminate';
                  }
              }
              currentElement = parentItemElement.parentElement; // Move up to the next parent's children container
          } else {
              break; // Stop if no parent tree-item found
          }
      }
  }

  // Helper function to find a node in the fileTree data structure by its path
  function findNodeByPath(path, node) {
      if (!node) return null;
      if (node.path === path) return node;

      if (node.children) {
          for (const child of node.children) {
              const found = findNodeByPath(path, child);
              if (found) return found;
          }
      }
      return null;
  }


  // Initial render
  updateSourceFilesDisplay();
  updateTestFilesDisplay();

  // Add a global document click handler for all thinking section toggles
  document.addEventListener('click', function(e) {
    // Check if clicked element is a thinking header or toggle button
    const thinkingHeader = e.target.closest('.thinking-header');
    const toggleButton = e.target.closest('.thinking-toggle');

    if (thinkingHeader || toggleButton) {
      // Find the thinking section
      const thinkingSection = (thinkingHeader || toggleButton).closest('.thinking-section');
      if (thinkingSection) {
        console.log("[Stream Debug] Thinking section click detected on:", e.target);

        // If it was the toggle button, prevent propagation to avoid double-toggle
        if (toggleButton) {
          e.stopPropagation();
        }

        // Toggle the collapsed state
        const isCollapsed = thinkingSection.classList.contains('collapsed');
        console.log("[Stream Debug] Current state before toggle:", isCollapsed ? "collapsed" : "expanded");

        if (isCollapsed) {
          // Expand
          thinkingSection.classList.remove('collapsed');

          // Update icon
          const icon = thinkingSection.querySelector('.thinking-toggle i');
          if (icon) {
            icon.className = 'codicon codicon-chevron-down';
          }

          // Make content visible immediately
          const content = thinkingSection.querySelector('.thinking-content');
          if (content) {
            content.style.display = 'block';
            content.style.visibility = 'visible';
            content.style.maxHeight = '500px';
            content.style.padding = '10px 15px';
            console.log("[Stream Debug] Expanded thinking section, content display:", content.style.display);
          }
        } else {
          // Collapse
          thinkingSection.classList.add('collapsed');

          // Update icon
          const icon = thinkingSection.querySelector('.thinking-toggle i');
          if (icon) {
            icon.className = 'codicon codicon-chevron-right';
          }

          // Hide content
          const content = thinkingSection.querySelector('.thinking-content');
          if (content) {
            content.style.display = 'none';
            content.style.visibility = 'hidden';
            content.style.maxHeight = '0';
            content.style.padding = '0 15px';
            console.log("[Stream Debug] Collapsed thinking section, content display:", content.style.display);
          }
        }
      }
    }
  });
})();
