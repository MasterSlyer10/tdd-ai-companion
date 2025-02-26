(function () {
  const vscode = acquireVsCodeApi();
  let isSetupNeeded = true;

  // DOM elements
  document.addEventListener("DOMContentLoaded", () => {
    // Setup containers and buttons
    const setupContainer = document.getElementById("setup-container");
    const mainContainer = document.getElementById("main-container");
    const setupButton = document.getElementById("setup-button");
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-button");
    const chatMessages = document.getElementById("chat-messages");
    const suggestionsHistory = document.getElementById("suggestions-history");
    const clearHistoryButton = document.getElementById("clear-history");

    const editSourceFilesButton = document.getElementById("edit-source-files");
    const editTestFilesButton = document.getElementById("edit-test-files");
    const editFeatureButton = document.getElementById("edit-feature");

    // Initialize UI
    if (isSetupNeeded) {
      setupContainer.style.display = "flex";
      mainContainer.style.display = "none";
    } else {
      setupContainer.style.display = "none";
      mainContainer.style.display = "block";
    }

    // Setup button action
    setupButton.addEventListener("click", () => {
      vscode.postMessage({
        command: "setupProject",
      });
    });

    // Send button action
    sendButton.addEventListener("click", sendMessage);

    // Clear history button
    clearHistoryButton.addEventListener("click", clearHistory);

    // Enter key in textarea sends message
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      } else if (e.key === "Enter" && e.shiftKey) {
        // Allow multiline input with Shift+Enter
        const start = chatInput.selectionStart;
        const end = chatInput.selectionEnd;
        chatInput.value =
          chatInput.value.substring(0, start) +
          "\n" +
          chatInput.value.substring(end);
        chatInput.selectionStart = chatInput.selectionEnd = start + 1;

        // Auto-grow textarea
        chatInput.style.height = "auto";
        chatInput.style.height = Math.min(120, chatInput.scrollHeight) + "px";
        e.preventDefault();
      }
    });

    // Auto-resize input as user types
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(120, chatInput.scrollHeight) + "px";
    });

    // Edit buttons actions
    editSourceFilesButton.addEventListener("click", () => {
      vscode.postMessage({
        command: "updateSourceFiles",
      });
    });

    editTestFilesButton.addEventListener("click", () => {
      vscode.postMessage({
        command: "updateTestFiles",
      });
    });

    editFeatureButton.addEventListener("click", () => {
      vscode.postMessage({
        command: "updateFeature",
      });
    });

    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;

      // Add user message to chat
      addMessageToChat("user", message);

      // Clear input
      chatInput.value = "";
      chatInput.style.height = "32px";

      // Send to extension
      vscode.postMessage({
        command: "requestTestSuggestion",
        message: message,
      });
    }

    function addMessageToChat(sender, text) {
      const messageElement = document.createElement("div");
      messageElement.className = `message ${sender}-message`;
      messageElement.textContent = text;

      chatMessages.appendChild(messageElement);

      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addResponseToHistory(response) {
      const responseElement = document.createElement("div");
      responseElement.className = "suggestion-item";
      responseElement.innerHTML = markdownToHtml(response);

      suggestionsHistory.appendChild(responseElement);
    }

    function clearHistory() {
      suggestionsHistory.innerHTML = "";
    }

    function markdownToHtml(markdown) {
      // Simple markdown converter
      return markdown
        .replace(/^## (.*$)/gm, "<h2>$1</h2>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    }

    // Listen for messages from the extension
    window.addEventListener("message", (event) => {
      const message = event.data;

      switch (message.command) {
        case "setupNeeded":
          setupContainer.style.display = "flex";
          mainContainer.style.display = "none";
          isSetupNeeded = true;
          break;

        case "updateSourceFiles":
          document.getElementById("source-files").textContent =
            message.files.length > 0
              ? message.files.map((f) => f.split(/[/\\]/).pop()).join(", ")
              : "None selected";
          setupContainer.style.display = "none";
          mainContainer.style.display = "block";
          isSetupNeeded = false;
          break;

        case "updateTestFiles":
          document.getElementById("test-files").textContent =
            message.files.length > 0
              ? message.files.map((f) => f.split(/[/\\]/).pop()).join(", ")
              : "None selected";
          break;

        case "updateFeature":
          document.getElementById("current-feature").textContent =
            message.feature || "Not set";
          break;

        case "addResponse":
          addMessageToChat("assistant", message.response);
          addResponseToHistory(message.response);
          break;
      }
    });
  });
})();
