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

  // DOM Elements
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
  // const clearHistoryButton = document.getElementById("clear-history");

  // Initialize
  document.addEventListener("DOMContentLoaded", () => {
    init();
    console.log("Document loaded"); // Debugging
  });

  function init() {
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

    const testToggle = document.createElement("label");
    testToggle.className = "toggle-control";
    testToggle.innerHTML = `
      <input type="checkbox" id="test-toggle">
      <span class="toggle-label"><i class="codicon codicon-beaker"></i> Test Files</span>
    `;

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
      indicator.className =
        "codicon codicon-symbol-property tree-item-indicator";
      indicator.style.marginLeft = "4px";
      indicator.style.fontSize = "12px";
      indicator.style.color = "var(--primary-color)";
      itemElement.appendChild(indicator);
    }

    if (isTestFile) {
      const indicator = document.createElement("i");
      indicator.className = "codicon codicon-beaker tree-item-indicator";
      indicator.style.marginLeft = "4px";
      indicator.style.fontSize = "12px";
      indicator.style.color = "#b05800";
      itemElement.appendChild(indicator);
    }

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
      return; // Don't process directories as files
    }

    // Only process individual files for source/test designation
    if (node.type === "file") {
      const sourceToggle = document.getElementById("source-toggle");
      const testToggle = document.getElementById("test-toggle");

      // Handle source files
      if (sourceToggle && sourceToggle.checked) {
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
      }

      // Handle test files
      if (testToggle && testToggle.checked) {
        if (isChecked) {
          // Add to test files if not already there
          if (!testFiles.includes(node.path)) {
            vscode.postMessage({
              command: "selectTestFile",
              path: node.path,
            });
          }
        } else {
          // Remove from test files
          if (testFiles.includes(node.path)) {
            vscode.postMessage({
              command: "deselectTestFile",
              path: node.path,
            });
          }
        }
      }
    }

    // Save checked items to state
    saveCheckedItemsToState();
    saveCheckedItems();

    // Re-render tree to show selection
    renderFileTree();
  }

  // Add function to recursively update child checkboxes
  // Replace your existing updateChildCheckboxes function
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
        if (sourceToggle && sourceToggle.checked) {
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
        }

        // Handle test files
        if (testToggle && testToggle.checked) {
          if (isChecked) {
            // Add to test files if not already there
            if (!testFiles.includes(child.path)) {
              vscode.postMessage({
                command: "selectTestFile",
                path: child.path,
              });
            }
          } else {
            // Remove from test files
            if (testFiles.includes(child.path)) {
              vscode.postMessage({
                command: "deselectTestFile",
                path: child.path,
              });
            }
          }
        }
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
    const message = chatInput.value.trim();
    if (!message) {
      return; // Don't send empty messages
    }

    console.log("Sending message:", message); // Debugging

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
    // Create message element
    const messageElement = document.createElement("div");
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

    // For AI messages, use marked to render markdown
    if (!isUser && typeof marked !== "undefined") {
      contentElement.innerHTML = marked.parse(content);
      // Enable syntax highlighting if Prism is available
      if (typeof Prism !== "undefined") {
        contentElement.querySelectorAll("pre code").forEach((block) => {
          Prism.highlightElement(block);
        });
      }
    } else {
      contentElement.textContent = content;
    }

    messageElement.appendChild(contentElement);

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
        const content = msg.querySelector(".message-content").textContent;
        return {
          role: isUser ? "user" : "assistant",
          content: content,
        };
      });

    vscode.postMessage({
      command: "saveChatHistory",
      history: messages,
    });
  }

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
        break;

      case "updateCheckedItems":
        // Handle if extension wants to update checked items
        if (message.paths && Array.isArray(message.paths)) {
          checkedItems = new Set(message.paths);
          renderFileTree();
        }
        break;
      case "loadChatHistory":
        chatMessages.innerHTML = ""; // Clear existing messages
        if (message.history && message.history.length > 0) {
          message.history.forEach((msg) => {
            const messageElement = document.createElement("div");
            messageElement.className = `message ${msg.type}-message`;
            messageElement.innerHTML = `
                <div class="message-content">${msg.content}</div>
              `;
            chatMessages.appendChild(messageElement);
          });
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
    }
  });

  // Initial render
  updateSourceFilesDisplay();
  updateTestFilesDisplay();
})();
