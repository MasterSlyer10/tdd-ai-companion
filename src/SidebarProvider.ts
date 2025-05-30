import * as vscode from "vscode";
import { RAGService } from "./ragService";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tdd-ai-companion.sidebar";

  public _view?: vscode.WebviewView;
  private _currentFeature: string = "";
  private _sourceFiles: vscode.Uri[] = [];
  private _testFiles: vscode.Uri[] = []; // New: Test files

  private _context: vscode.ExtensionContext;
  private _ragService: RAGService;

  private _checkedItems: string[] = [];

  // Update the chat history type
  private _chatHistory: ChatMessage[] = [];
  private _cancellationTokenSource?: vscode.CancellationTokenSource;
  private _isCurrentRequestCancelled: boolean = false; // Add internal cancellation flag

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    ragService: RAGService // Add RAGService here
  ) {
    this._context = context;
    this._ragService = ragService; // Store it

    // Load the stuff from previous session
    this.loadState();
  }

  // Add a method to get conversation history for the LLM
  public getConversationHistory(): ChatMessage[] {
    return this._chatHistory;
  }

  // Add a method to add a user message to history
  public addUserMessage(message: string) {
    this._chatHistory.push({ role: "user", content: message });
    this._context.workspaceState.update("chatHistory", this._chatHistory);
  }

  private loadState() {
    // Load current feature
    this._currentFeature = this._context.workspaceState.get<string>(
      "currentFeature",
      ""
    );

    // Load source files
    const sourceFiles = this._context.workspaceState.get<string[]>(
      "sourceFiles",
      []
    );
    this._sourceFiles = sourceFiles.map((file) => vscode.Uri.file(file));

    // Load test files
    const testFiles = this._context.workspaceState.get<string[]>(
      "testFiles",
      []
    );
    this._testFiles = testFiles.map((file) => vscode.Uri.file(file));

    // Load chat history
    const savedHistory = this._context.workspaceState.get<any[]>(
      "chatHistory",
      []
    );

    // Load checked items
    this._checkedItems = this._context.workspaceState.get<string[]>(
      "checkedItems",
      []
    );

    // Load chat history with type checking and migration
    const savedHistoryTyped = this._context.workspaceState.get<any[]>(
      "chatHistory",
      []
    );

    // Check if history is in the old format and convert if needed
    if (savedHistoryTyped.length > 0 && !("role" in savedHistoryTyped[0])) {
      this._chatHistory = savedHistoryTyped.map((item) => {
        if (typeof item === "string") {
          return { role: "assistant", content: item };
        }
        // If it's already in the right format or close enough
        if (item.type === "user") {
          return { role: "user", content: item.content };
        }
        return { role: "assistant", content: item.content };
      });
    } else {
      this._chatHistory = savedHistoryTyped as ChatMessage[];
    }
  }

  private saveState() {
    // Save current feature
    this._context.workspaceState.update("currentFeature", this._currentFeature);

    // Save source files
    this._context.workspaceState.update(
      "sourceFiles",
      this._sourceFiles.map((file) => file.fsPath)
    );

  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Send initial state to the webview
    this.postSourceFilesUpdate();
    this.postTestFilesUpdate(); // Add this line

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "webviewReady":
          this.postSourceFilesUpdate();
          this.postTestFilesUpdate(); // Add this line
          if (this._currentFeature) {
            webviewView.webview.postMessage({
              command: "updateFeature",
              feature: this._currentFeature,
            });
          }

          // Send chat history
          webviewView.webview.postMessage({
            command: "loadChatHistory",
            history: this._chatHistory,
          });

          // Send checked items
          webviewView.webview.postMessage({
            command: "loadCheckedItems",
            checkedItems: this._checkedItems,
          });

          break;

        case "requestTestSuggestion":
          console.log("[SidebarProvider] Received requestTestSuggestion message from webview.");
          // Reset cancellation flag for the new request
          this._isCurrentRequestCancelled = false;
          // Dispose any existing CTS before creating a new one
          this._cancellationTokenSource?.dispose();
          this._cancellationTokenSource = new vscode.CancellationTokenSource();

          vscode.commands.executeCommand(
            "tdd-ai-companion.suggestTestCase",
            message.message,
            this._cancellationTokenSource.token, // Pass the token
            message.promptId // Pass the promptId
          );
          console.log("[SidebarProvider] Executed suggestTestCaseCommand.");
          break;
        case "cancelRequest":
          console.log("[SidebarProvider] Received cancelRequest message from webview.");
          this.cancelCurrentRequest();
          break;
        case "setupProject":
          vscode.commands.executeCommand("tdd-ai-companion.setupProject");
          break;        case "updateFeature":
          this._currentFeature = message.feature;
          this.saveState(); // Add this line to save the state
          break;        case "promptFeature":
          // When prompted to define a feature via UI
          this.promptForFeature().then((success) => {
            // If feature was defined successfully, notify the webview
            if (success && this._view) {
              this._view.webview.postMessage({
                command: "featureDefined",
                feature: this._currentFeature
              });
            }
          });
          break;
        case "getWorkspaceFiles":
          this.getWorkspaceFiles();
          break;
        case "selectSourceFile":
          this.addSourceFile(vscode.Uri.file(message.path));
          break;
        case "deselectSourceFile":
          this.removeSourceFile(vscode.Uri.file(message.path));
          break;
        case "openFile":
          vscode.workspace
            .openTextDocument(vscode.Uri.file(message.path))
            .then((doc) => vscode.window.showTextDocument(doc));
          break;

        case "saveChatHistory":
          this._chatHistory = message.history;
          this._context.workspaceState.update("chatHistory", this._chatHistory);
          break;

        case "saveCheckedItems":
          this._checkedItems = message.checkedItems;
          this._context.workspaceState.update(
            "checkedItems",
            this._checkedItems
          );
          break;
        case "newChat":
          this._chatHistory = [];
          this._context.workspaceState.update("chatHistory", this._chatHistory);

          // Notify webview to clear chat UI
          webviewView.webview.postMessage({
            command: "clearChatUI",
          });
          break;
        case "openExtensionSettings":
          vscode.commands.executeCommand('workbench.action.openSettings', 'tdd-ai-companion');
          break;
      }
    });
    // Load workspace files initially
    this.getWorkspaceFiles();
  }

  public cancelCurrentRequest() {
    console.log("[SidebarProvider] cancelCurrentRequest START.");
    if (this._cancellationTokenSource) {
      this._isCurrentRequestCancelled = true; // Set internal flag
      this._cancellationTokenSource.cancel();
      this._cancellationTokenSource.dispose();
      this._cancellationTokenSource = undefined;
      if (this._view) {
        this._view.webview.postMessage({ command: "requestCancelled" });
      }
      console.log("[SidebarProvider] Request cancellation attempted.");
    } else {
      console.log("[SidebarProvider] No active cancellation token source to cancel.");
    }
    console.log("[SidebarProvider] cancelCurrentRequest END.");
  }

  // Call this method from extension.ts after a request completes or errors out
  public finalizeRequest() {
    console.log("[SidebarProvider] finalizeRequest START.");
    // This method is called when the request in extension.ts finishes (either success or error/abort).
    // We should dispose the CTS here if it still exists, but NOT reset the _isCurrentRequestCancelled flag.
    // The flag is reset in addResponse when a response is successfully processed, or implicitly when a new request starts.
    if (this._cancellationTokenSource) {
      this._cancellationTokenSource.dispose();
      this._cancellationTokenSource = undefined;
      console.log("[SidebarProvider] CancellationTokenSource disposed in finalizeRequest.");
    } else {
       console.log("[SidebarProvider] No active CancellationTokenSource to dispose in finalizeRequest.");
    }
    // The webview UI reset is handled by receiving the 'requestCancelled' message (if cancelled)
    // or by the 'addResponse' handler (if completed).
    console.log("[SidebarProvider] finalizeRequest END.");
  }


  public updateSourceFiles(files: vscode.Uri[]) {
    this._sourceFiles = files;
    this.postSourceFilesUpdate();
    this.saveState();
  }


  public updateFeature(feature: string) {
    this._currentFeature = feature;
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateFeature",
        feature: feature,
      });
    }
    this.saveState();
  }

  private postSourceFilesUpdate() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateSourceFiles",
        files: this._sourceFiles.map((f) => f.fsPath),
      });
    }
  }

  public addResponse(response: string, responseTokenCount?: number, totalInputTokens?: number, promptId?: string) {
    // Check if the request was cancelled internally
    if (this._isCurrentRequestCancelled || this._cancellationTokenSource === undefined) {
        console.log("[SidebarProvider] addResponse: Request was cancelled internally or no active token source, not adding response.");
        this._isCurrentRequestCancelled = false; // Reset flag for the next request
        return; // Do not add response if cancelled or no active request
    }

    // If the response is empty, provide a default message
    if (!response) {
      response = "AI failed to generate a response.";
    }

    // Add to conversation history
    this._chatHistory.push({ role: "assistant", content: response });
    this._context.workspaceState.update("chatHistory", this._chatHistory);

    // Send to UI
    if (this._view) {
      const messagePayload: any = {
        command: "addResponse",
        response,
        promptId: promptId // Include the promptId
      };
      if (typeof responseTokenCount === 'number') {
        messagePayload.responseTokenCount = responseTokenCount;
      }
      if (typeof totalInputTokens === 'number') {
        messagePayload.totalInputTokens = totalInputTokens;
      }
      this._view.webview.postMessage(messagePayload);
    }  }

  // For use with streaming responses
  public updateLastResponse(response: string, responseTokenCount?: number, totalInputTokens?: number, promptId?: string) {
    // Check if the request was cancelled internally
    if (this._isCurrentRequestCancelled || this._cancellationTokenSource === undefined) {
        console.log("[SidebarProvider] updateLastResponse: Request was cancelled internally or no active token source, not updating response.");
        this._isCurrentRequestCancelled = false; // Reset flag for the next request
        return; // Do not update response if cancelled or no active request
    }

    // If the response is empty, provide a default message
    if (!response) {
      response = "AI failed to generate a response.";
    }

    // Add to conversation history
    this._chatHistory.push({ role: "assistant", content: response });
    this._context.workspaceState.update("chatHistory", this._chatHistory);

    // Send token metrics to UI - the response content itself was already streamed
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateResponseMetrics",
        responseTokenCount,
        totalInputTokens,
        promptId: promptId // Include the promptId
      });
    }
  }

  public getSourceFiles(): vscode.Uri[] {
    return this._sourceFiles;
  }

  public getTestFiles(): vscode.Uri[] {
    return this._testFiles;
  }

  public updateTestFiles(files: vscode.Uri[]) {
    this._testFiles = files;
    this.postTestFilesUpdate();
    this.saveState();
  }

  public addTestFile(file: vscode.Uri) {
    if (!this._testFiles.some((f) => f.fsPath === file.fsPath)) {
      this._testFiles.push(file);
      this.postTestFilesUpdate();
      this.saveState();
    }
  }

  public removeTestFile(file: vscode.Uri) {
    this._testFiles = this._testFiles.filter(
      (f) => f.fsPath !== file.fsPath
    );
    this.postTestFilesUpdate();
    this.saveState();
  }

  private postTestFilesUpdate() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateTestFiles",
        files: this._testFiles.map((f) => f.fsPath),
      });
    }
  }

  public getCurrentFeature(): string {
    return this._currentFeature;
  }

  public async getWorkspaceFiles() {
    if (!this._view) {
      return;
    }

    try {
      // Get all files in the workspace
      const files = await vscode.workspace.findFiles(
        "**/*.*",
        "**/node_modules/**"
      );

      // Convert file URIs to a more manageable structure
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const fileTree = this.buildFileTree(files, workspaceRoot || "");

      // Send the file tree to the webview
      this._view.webview.postMessage({
        command: "updateFileTree",
        fileTree: fileTree,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading workspace files: ${error}`);
    }
  }

  private buildFileTree(files: vscode.Uri[], workspaceRoot: string) {
    const fileTree: any = {
      name: "root",
      children: [],
      type: "directory",
      path: workspaceRoot,
    };
    const pathSeparator = process.platform === "win32" ? "\\" : "/";

    for (const file of files) {
      // Get the path relative to workspace root
      let relativePath = file.fsPath;
      if (relativePath.startsWith(workspaceRoot)) {
        relativePath = relativePath.substring(workspaceRoot.length + 1);
      }

      const pathParts = relativePath.split(pathSeparator);
      let currentNode = fileTree;

      // Build the tree structure
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const isFile = i === pathParts.length - 1;
        const path = pathParts.slice(0, i + 1).join(pathSeparator);

        let childNode = currentNode.children.find((n: any) => n.name === part);
        if (!childNode) {
          childNode = {
            name: part,
            type: isFile ? "file" : "directory",
            path: `${workspaceRoot}${pathSeparator}${path}`,
            children: [],
          };
          currentNode.children.push(childNode);
        }

        currentNode = childNode;
      }
    }

    return fileTree;
  }

  public async promptForFeature(): Promise<boolean> {
    // Prompt the user to define a feature
    const featureInput = await vscode.window.showInputBox({
      prompt: "Describe the feature you want to test",
      placeHolder: "Example: User Authentication with email validation",
      ignoreFocusOut: true, // Keep dialog open when clicking elsewhere
    });
    
    // Update feature if user provided one
    if (featureInput && featureInput.trim()) {
      this._currentFeature = featureInput.trim();
      this.saveState();
      
      // Update UI
      if (this._view) {
        this._view.webview.postMessage({
          command: "updateFeature",
          feature: this._currentFeature,
        });
      }
      return true;
    }
    
    return false;
  }

  private addSourceFile(file: vscode.Uri) {
    if (!this._sourceFiles.some((f) => f.fsPath === file.fsPath)) {
      this._sourceFiles.push(file);
      this.postSourceFilesUpdate();
      this.saveState();
    }
  }

  private removeSourceFile(file: vscode.Uri) {
    this._sourceFiles = this._sourceFiles.filter(
      (f) => f.fsPath !== file.fsPath
    );
    // Also remove from checked items
    this._checkedItems = this._checkedItems.filter(itemPath => itemPath !== file.fsPath);
    // Send updated checked items to webview
    if (this._view) {
        this._view.webview.postMessage({
            command: "updateCheckedItems",
            checkedItems: Array.from(this._checkedItems), // Ensure it's an array
        });
        // Also send a message to uncheck the item in the file tree
        this._view.webview.postMessage({
            command: "uncheckFileTreeItem",
            path: file.fsPath,
        });
    }
    this.postSourceFilesUpdate();
    this.saveState();
  }



  private _getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "style.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "script.js")
    );

    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css"
      )
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <link href="${codiconUri}" rel="stylesheet">
            <title>TDD AI Companion</title>

            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.24.1/themes/prism.css">
            <script src="https://cdn.jsdelivr.net/npm/prismjs@1.24.1/prism.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/prismjs@1.24.1/components/prism-javascript.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/prismjs@1.24.1/components/prism-typescript.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/prismjs@1.24.1/components/prism-python.min.js"></script>
        </head>
        <body>
            <div id="main-container" class="main-container">
                <section class="project-panel">
                    <div class="project-panel-header">
                        <h2 class="section-title">Project Configuration</h2>
                        <div class="settings-container">
                            <button id="open-settings-button" class="icon-button" title="Open Extension Settings">
                                <i class="codicon codicon-settings-gear"></i>
                            </button>
                        </div>
                    </div>
                    <div class="panel-group">

                        <!-- Feature input -->
                        <div class="info-item">
                            <div class="info-label">
                                <i class="codicon codicon-symbol-event"></i>
                                <span>Feature:</span>
                            </div>
                            <div class="feature-input-wrapper">
                                <input type="text" id="feature-input" placeholder="What feature do you want to test?" />
                            </div>
                        </div>

                        <!-- File Explorer Tree View -->
                        <div class="tree-view-container">
                            <div class="tree-view-header">
                                <h3>Workspace Files</h3>
                                <div class="tree-view-controls">
                                    <button id="refresh-tree" class="icon-button" title="Refresh">
                                        <i class="codicon codicon-sync"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="tree-filter">
                                <div class="source-input-wrapper">
                                    <input type="text" id="file-filter" placeholder="Filter files...">
                                    <i id="source-error-icon" class="codicon codicon-warning"></i>
                                </div>
                                <div class="source-warning-message">
                                    <i class="codicon codicon-warning"></i>
                                    <span>For best results, please select only the files related to your question. Sending too many files may reduce accuracy and slow down responses.</span>
                                </div>
                            </div>
                            <div id="file-tree" class="tree-view"></div>
                        </div>

                        <div class="selection-summary">

                            <!-- Removed the Source Files toggle control -->
                            
                            <div class="selection-section">
                                <h4>Source Files</h4>
                                <div id="source-files" class="chip-container">None selected</div>
                            </div>
                            
                            <div class="selection-section">
                                <h4>Test Files</h4>
                                <div id="test-files" class="chip-container">None selected</div>
                            </div>
                        </div>
                    </div>
                </section>
    
                <section class="chat-section">
                    <div class="chat-header">
                        <h2 class="section-title">Test Suggestions</h2>
                        <div class="chat-header-actions">
                            <button id="new-chat-button" class="action-button" title="Start a new chat">
                                <i class="codicon codicon-new-file"></i> New Chat
                            </button>
                        </div>
                    </div>
                    <div class="chat-container">
                        <div id="chat-messages" class="messages-container"></div>
                        <div class="input-container">
                            <div class="action-buttons">
                                <button id="suggest-test-button" class="action-button" title="Generate test suggestions">
                                    <i class="codicon codicon-lightbulb"></i> Suggest Tests
                                </button>
                                <textarea id="chat-input" class="message-input" placeholder="Enter your message..."></textarea>
                                <button id="send-button" class="send-button" title="Send Request">
                                  <i class="codicon codicon-send"></i>
                              </button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
    
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
  }
}
