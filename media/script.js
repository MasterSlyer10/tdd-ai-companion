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

  // DOM Elements
  let tokenCountDisplay = null; // To display token count
  const featureInput = document.getElementById("feature-input");
  // const editFeatureButton = document.getElementById("edit-feature");

  const fileTreeElement = document.getElementById("file-tree");
  const refreshTreeButton = document.getElementById("refresh-tree");
  const collapseAllButton = document.getElementById("collapse-all");
  const fileFilterInput = document.getElementById("file-filter");
  const sourceFilesContainer = document.getElementById("source-files");
  const testFilesContainer = document.getElementById("test-files");

  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-button");
  const suggestTestButton = document.getElementById("suggest-test-button");
  const chatMessages = document.getElementById("chat-messages");
  const suggestionsHistory = document.getElementById("suggestions-history");

  const newChatButton = document.getElementById("new-chat-button");
  // const clearHistoryButton = document.getElementById("clear-history");

  // Initialize
  document.addEventListener("DOMContentLoaded", () => {
    init();
    console.log("Document loaded"); // Debugging
  });

  function init() {
    // Tells the extension when the view is ready to receive
    vscode.postMessage({
      command: "webviewReady",
    });

    // Set up event listeners
    setupEventListeners();

    // Set up feature input
    setupFeatureInput();

    // Request workspace files
    requestWorkspaceFiles();

    // Load history from storage
    loadHistoryFromStorage();

    // Load checked items from storage
    loadCheckedItemsFromState();

    // Load token count from state
    loadTokenCountFromState();

    // Initialize and display token count
    initializeTokenDisplay(); // Create the display element
    updateTokenDisplay(); // Set initial text

    // Add selection mode toggles
    addSelectionModeControls();

    // Add click handler to document to close context menu
    document.addEventListener("click", (e) => {
      if (contextMenu && !contextMenu.contains(e.target)) {
        removeContextMenu();
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

    collapseAllButton.addEventListener("click", () => {
      collapseAllFolders();
    });

    // File filtering
    fileFilterInput.addEventListener("input", () => {
      filterFileTree();
    });

    // Chat functionality
    if (sendButton) {
      console.log("Send button found");
      sendButton.addEventListener("click", () => {
        console.log("Send button clicked"); // Debugging
        sendChatMessage();
      });
    } else {
      console.error("Send button not found");
    }

    if (suggestTestButton) {
      suggestTestButton.addEventListener("click", () => {
        console.log("Suggest test button clicked");
        sendPredefinedSuggestion();
      });
    } else {
      console.error("Suggest test button not found");
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
    });
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

  // Selection mode controls
  function addSelectionModeControls() {
    const selectionControls = document.createElement("div");
    selectionControls.className = "selection-mode-controls";

    const sourceToggle = document.createElement("label");
    sourceToggle.className = "toggle-control";
    sourceToggle.innerHTML = `
      <input type="checkbox" id="source-toggle" checked>
      <span class="toggle-label"><i class="codicon codicon-file-code"></i> Source Files</span>
    `;

    // const testToggle = document.createElement("label");
    // testToggle.className = "toggle-control";
    // testToggle.innerHTML = `
    //   <input type="checkbox" id="test-toggle">
    //   <span class="toggle-label"><i class="codicon codicon-beaker"></i> Test Files</span>
    // `;

    selectionControls.appendChild(sourceToggle);
    selectionControls.appendChild(testToggle);

    // Insert before the file tree
    const treeHeader = document.querySelector(".tree-view-header");
    treeHeader.after(selectionControls);
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
    checkbox.checked = checkedItems.has(node.path);
    checkbox.addEventListener("change", (e) => {
      e.stopPropagation();
      handleCheckboxChange(node, checkbox.checked);
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

    // Check if this file is selected
    const isSourceFile = sourceFiles.some((f) => f === node.path);
    const isTestFile = testFiles.some((f) => f === node.path);

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
    if (isChecked) {
      checkedItems.add(node.path);
    } else {
      checkedItems.delete(node.path);
    }

    // Apply to children if it's a directory
    if (node.type === "directory" && node.children) {
      updateChildCheckboxes(node, isChecked);
    }

    // Only process individual files for source/test designation
    if (node.type === "file") {
      const sourceToggle = document.getElementById("source-toggle");
      const testToggle = document.getElementById("test-toggle");

      // Handle source files
      // if (sourceToggle && sourceToggle.checked) {
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
      // }

      // Handle test files
      // if (testToggle && testToggle.checked) {
      //   if (isChecked) {
      //     // Add to test files if not already there
      //     if (!testFiles.includes(node.path)) {
      //       vscode.postMessage({
      //         command: "selectTestFile",
      //         path: node.path,
      //       });
      //     }
      //   } else {
      //     // Remove from test files
      //     if (testFiles.includes(node.path)) {
      //       vscode.postMessage({
      //         command: "deselectTestFile",
      //         path: node.path,
      //       });
      //     }
      //   }
      // }
    }

    // Save checked items to state
    saveCheckedItemsToState();
    saveCheckedItems();

    // Re-render tree to show selection
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

      // Handle file selection for source/test files
      if (child.type === "file") {
        const sourceToggle = document.getElementById("source-toggle");
        const testToggle = document.getElementById("test-toggle");

        // Handle source files
        // if (sourceToggle && sourceToggle.checked) {
        if (isChecked) {
          // Add to source files if not already there
          if (!sourceFiles.includes(child.path)) {
            vscode.postMessage({
              command: "selectSourceFile",
              path: child.path,
            });
          }
        } else {
          // Remove from source files
          if (sourceFiles.includes(child.path)) {
            vscode.postMessage({
              command: "deselectSourceFile",
              path: child.path,
            });
          }
        }
        // }

        // Handle test files
        // if (testToggle && testToggle.checked) {
        //   if (isChecked) {
        //     // Add to test files if not already there
        //     if (!testFiles.includes(child.path)) {
        //       vscode.postMessage({
        //         command: "selectTestFile",
        //         path: child.path,
        //       });
        //     }
        //   } else {
        //     // Remove from test files
        //     if (testFiles.includes(child.path)) {
        //       vscode.postMessage({
        //         command: "deselectTestFile",
        //         path: child.path,
        //       });
        //     }
        //   }
        // }
      }

      // Recursively update if it's a directory
      if (child.type === "directory") {
        updateChildCheckboxes(child, isChecked);
      }
    });
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

  // Function to initialize the token count display element
  function initializeTokenDisplay() {
    if (!tokenCountDisplay) {
      tokenCountDisplay = document.createElement("div");
      tokenCountDisplay.id = "token-count-display";
      tokenCountDisplay.style.padding = "5px";
      tokenCountDisplay.style.textAlign = "right";
      tokenCountDisplay.style.fontSize = "0.9em";
      tokenCountDisplay.style.color = "var(--vscode-editor-foreground)"; // Default color

      const chatInputArea = document.getElementById('chat-input');
      if (chatInputArea && chatInputArea.parentNode) {
        // Insert the display above the chat input field
        chatInputArea.parentNode.insertBefore(tokenCountDisplay, chatInputArea);
      } else {
        // Fallback if chatInput isn't found or has no parent
        console.warn("Chat input area not found for token display.");
        // As a last resort, try to append it somewhere visible, e.g., near chatMessages
        if (chatMessages && chatMessages.parentNode) {
            chatMessages.parentNode.appendChild(tokenCountDisplay); // Or insertBefore chatMessages.nextSibling
        }
      }
    }
  }

  // Function to update the token count display
  function updateTokenDisplay() {
    if (tokenCountDisplay) {
      tokenCountDisplay.textContent = `Tokens: ${currentTokenCount} / ${TOKEN_LIMIT}`;
      if (currentTokenCount >= TOKEN_LIMIT) {
        tokenCountDisplay.style.color = "var(--vscode-errorForeground)"; // Use VS Code theme color for error
      } else {
        tokenCountDisplay.style.color = "var(--vscode-editor-foreground)";
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
    const isTestFile = testFiles.includes(filePath);

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

    sourceFiles.forEach((filePath) => {
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

    testFiles.forEach((filePath) => {
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

    // Add message to UI
    addMessageToChat(message, true);

    // Clear input field
    chatInput.value = "";

    // Display loading indicator
    const loadingElement = document.createElement("div");
    loadingElement.className = "loading-indicator";
    loadingElement.textContent = "Generating response...";
    chatMessages.appendChild(loadingElement);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send message to extension
    vscode.postMessage({
      command: "requestTestSuggestion",
      message: message,
    });
  }

  // Simple Suggest Button
  function sendPredefinedSuggestion() {
    // Send a predefined message
    const predefinedMessage =
      "Suggest a new test case for my current implementation";

    // Set the input field text (optional - shows the user what's being sent)
    if (chatInput) {
      chatInput.value = predefinedMessage;
    }

    // Add message to UI
    addMessageToChat(predefinedMessage, true);

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

    // Send message to extension
    vscode.postMessage({
      command: "requestTestSuggestion",
      message: predefinedMessage,
    });
  }

  // Add user message to chat UI
  function addMessageToChat(content, isUser = false) {
    const messageId = `msg-${messageIdCounter++}`; // Generate unique ID

    // Create message element
    const messageElement = document.createElement("div");
    messageElement.id = messageId; // Assign ID
    messageElement.className = isUser
      ? "message user-message"
      : "message ai-message";

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
    messageElement.appendChild(contentElement);

    // Add actions container
    const actionsElement = document.createElement("div");
    actionsElement.className = "message-actions";

    if (isUser) {
      const editButton = document.createElement("button");
      editButton.className = "message-action-button edit-button";
      editButton.innerHTML = '<i class="codicon codicon-edit"></i>';
      editButton.title = "Edit message";
      // Use messageElement.dataset.rawText to ensure the *current* text is edited
      editButton.onclick = () => handleEditUserMessage(messageElement, contentElement, messageElement.dataset.rawText);
      actionsElement.appendChild(editButton);

      const deleteUserButton = document.createElement("button");
      deleteUserButton.className = "message-action-button delete-button";
      deleteUserButton.innerHTML = '<i class="codicon codicon-trash"></i>';
      deleteUserButton.title = "Delete message and subsequent responses";
      deleteUserButton.onclick = () => handleDeleteUserMessage(messageElement);
      actionsElement.appendChild(deleteUserButton);

    } else { // AI message
      const deleteButton = document.createElement("button");
      deleteButton.className = "message-action-button delete-button";
      deleteButton.innerHTML = '<i class="codicon codicon-trash"></i>';
      deleteButton.title = "Delete message";
      deleteButton.onclick = () => handleDeleteAIMessage(messageElement);
      actionsElement.appendChild(deleteButton);
    }
    messageElement.appendChild(actionsElement);


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
        const rerunButton = document.createElement("button");
        rerunButton.className = "message-action-button rerun-button";
        rerunButton.innerHTML = '<i class="codicon codicon-refresh"></i>';
        rerunButton.title = "Re-run prompt";

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

  function handleDeleteUserMessage(messageElement) {
    if (messageElement && messageElement.parentNode === chatMessages) {
      // Remove this message and all subsequent messages
      let currentMsg = messageElement;
      while (currentMsg) {
        const nextMsg = currentMsg.nextElementSibling;
        if (chatMessages.contains(currentMsg)) {
          chatMessages.removeChild(currentMsg);
        }
        currentMsg = nextMsg;
      }
      saveChatHistory(); // Update the history after deletion
    }
  }

  function handleEditUserMessage(messageElement, contentElement, originalRawContent) {
    // Prevent editing if already in edit mode
    if (contentElement.querySelector('textarea.edit-area')) {
      return;
    }

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
    reloadAndSaveButton.className = 'edit-action-button'; // Reuse existing class or create a new one
    reloadAndSaveButton.title = 'Save changes, delete subsequent messages, resend, and refresh file tree';

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
        currentMsg = currentMsg.nextElementSibling;
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
      chatMessages.appendChild(loadingElement); // Append to main chat area
      chatMessages.scrollTop = chatMessages.scrollHeight;

      vscode.postMessage({
        command: "requestTestSuggestion",
        message: newContent,
      });

      // 5. Refresh file tree (as per original "reload" functionality)
      requestWorkspaceFiles();
    };

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '5px';
    buttonContainer.appendChild(reloadAndSaveButton);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'edit-action-button cancel-edit-button';
    cancelButton.title = 'Cancel editing';
    cancelButton.onclick = () => {
      // Restore original content and remove edit UI
      contentElement.innerHTML = ''; // Clear textarea and buttons
      contentElement.textContent = originalRawContent; // Restore text
      // messageElement.dataset.rawText remains the value from before this edit attempt
    };
    buttonContainer.appendChild(cancelButton);

    contentElement.appendChild(editArea);
    contentElement.appendChild(buttonContainer);
    editArea.focus();
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
        // Remove any loading indicators
        const loadingIndicators =
          chatMessages.querySelectorAll(".loading-indicator");
        loadingIndicators.forEach((indicator) => indicator.remove());

        // Add the AI response to the chat
        addMessageToChat(message.response, false);

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
        } // Closing curly brace for if (currentTokenCount >= TOKEN_LIMIT)
        break; // Break for case "addResponse"

      case "updateCheckedItems":
        // Handle if extension wants to update checked items
        if (message.paths && Array.isArray(message.paths)) {
          checkedItems = new Set(message.paths);
          renderFileTree();
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
            const messageId = `msg-${messageIdCounter++}`; // Generate unique ID for loaded message
            const messageElement = document.createElement("div");
            messageElement.id = messageId;
            messageElement.className = `message ${
              msg.role === "user" ? "user" : "ai"
            }-message`;

            // Add avatar
            const avatarElement = document.createElement("div");
            avatarElement.className = "message-avatar";
            avatarElement.innerHTML =
              msg.role === "user"
                ? '<i class="codicon codicon-account"></i>'
                : '<i class="codicon codicon-beaker"></i>';
            messageElement.appendChild(avatarElement);

            // Add content
            const contentElement = document.createElement("div");
            contentElement.className = "message-content";

            if (msg.role === "user") {
              messageElement.dataset.rawText = msg.content; // Store raw text for loaded user messages
            }

            if (msg.role === "assistant") {
              // contentType: "html" is set in saveChatHistory for AI messages
              if (msg.contentType === "html" && msg.content && msg.content.includes("<")) {
                contentElement.innerHTML = msg.content;
              } else if (typeof marked !== "undefined" && msg.content) {
                try {
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
                    contentElement.innerHTML = marked.parse(msg.content);
                } catch (e) {
                    console.error("Error parsing markdown for loaded AI message:", e);
                    contentElement.textContent = msg.content; // Fallback
                }
              } else {
                contentElement.textContent = msg.content || ""; // Fallback if no marked or not HTML
              }
              // Apply syntax highlighting after innerHTML is set
              if (typeof Prism !== "undefined") {
                setTimeout(() => { 
                    contentElement
                        .querySelectorAll("pre code")
                        .forEach((block) => {
                            Prism.highlightElement(block);
                        });
                }, 0);
              }
            } else { // User message
              contentElement.textContent = msg.content;
            }
            messageElement.appendChild(contentElement);

            // Add actions container
            const actionsElement = document.createElement("div");
            actionsElement.className = "message-actions";

            if (msg.role === "user") {
              const editButton = document.createElement("button");
              editButton.className = "message-action-button edit-button";
              editButton.innerHTML = '<i class="codicon codicon-edit"></i>';
              editButton.title = "Edit message";
              // msg.content is the raw text for user messages, which is now also in dataset.rawText
              editButton.onclick = () => handleEditUserMessage(messageElement, contentElement, messageElement.dataset.rawText);
              actionsElement.appendChild(editButton);

              const deleteUserButton = document.createElement("button");
              deleteUserButton.className = "message-action-button delete-button";
              deleteUserButton.innerHTML = '<i class="codicon codicon-trash"></i>';
              deleteUserButton.title = "Delete message and subsequent responses";
              deleteUserButton.onclick = () => handleDeleteUserMessage(messageElement);
              actionsElement.appendChild(deleteUserButton);
            } else { // AI message
              const deleteButton = document.createElement("button");
              deleteButton.className = "message-action-button delete-button";
              deleteButton.innerHTML = '<i class="codicon codicon-trash"></i>';
              deleteButton.title = "Delete message";
              deleteButton.onclick = () => handleDeleteAIMessage(messageElement);
              actionsElement.appendChild(deleteButton);
            }
            messageElement.appendChild(actionsElement);
            chatMessages.appendChild(messageElement);
          });

          // Scroll to bottom
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        break;
      case "loadCheckedItems":
        checkedItems = new Set(message.checkedItems || []);
        // Apply checked state to checkboxes in the tree
        if (fileTree) {
          const checkboxes = document.querySelectorAll(".tree-item-checkbox");
          checkboxes.forEach((checkbox) => {
            const path = checkbox.closest(".tree-item")?.dataset.path;
            if (path && checkedItems.has(path)) {
              checkbox.checked = true;
            }
          });
        }
        break;
      case "clearChatUI":
        chatMessages.innerHTML = "";
        break;
    }
  });

  // Initial render
  updateSourceFilesDisplay();
  updateTestFilesDisplay();
})();
