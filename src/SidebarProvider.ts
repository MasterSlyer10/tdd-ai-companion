import * as vscode from "vscode";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tdd-ai-companion.sidebar";

  public _view?: vscode.WebviewView;
  private _currentFeature: string = "";
  private _sourceFiles: vscode.Uri[] = [];
  private _testFiles: vscode.Uri[] = [];

  private _context: vscode.ExtensionContext;

  private _checkedItems: string[] = [];

  // Update the chat history type
  private _chatHistory: ChatMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this._context = context;

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
    this._chatHistory = this._context.workspaceState.get<any[]>(
      "chatHistory",
      []
    );

    // Load checked items
    this._checkedItems = this._context.workspaceState.get<string[]>(
      "checkedItems",
      []
    );

    // Load chat history with type checking and migration
    const savedHistory = this._context.workspaceState.get<any[]>(
      "chatHistory",
      []
    );

    // Check if history is in the old format and convert if needed
    if (savedHistory.length > 0 && !("role" in savedHistory[0])) {
      this._chatHistory = savedHistory.map((item) => {
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
      this._chatHistory = savedHistory as ChatMessage[];
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

    // Save test files
    this._context.workspaceState.update(
      "testFiles",
      this._testFiles.map((file) => file.fsPath)
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
    this.postTestFilesUpdate();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case "webviewReady":
          this.postSourceFilesUpdate();
          this.postTestFilesUpdate();
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
          vscode.commands.executeCommand(
            "tdd-ai-companion.suggestTestCase",
            message.message
          );
          break;
        case "setupProject":
          vscode.commands.executeCommand("tdd-ai-companion.setupProject");
          break;
        case "updateFeature":
          this._currentFeature = message.feature;
          this.saveState(); // Add this line to save the state
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
        case "selectTestFile":
          this.addTestFile(vscode.Uri.file(message.path));
          break;
        case "deselectTestFile":
          this.removeTestFile(vscode.Uri.file(message.path));
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
      }
    });
    // Load workspace files initially
    this.getWorkspaceFiles();
  }

  public updateSourceFiles(files: vscode.Uri[]) {
    this._sourceFiles = files;
    this.postSourceFilesUpdate();
    this.saveState();
  }

  public updateTestFiles(files: vscode.Uri[]) {
    this._testFiles = files;
    this.postTestFilesUpdate();
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

  private postTestFilesUpdate() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateTestFiles",
        files: this._testFiles.map((f) => f.fsPath),
      });
    }
  }

  public addResponse(response: string) {
    // Add to conversation history
    this._chatHistory.push({ role: "assistant", content: response });
    this._context.workspaceState.update("chatHistory", this._chatHistory);

    // Send to UI (keep existing code)
    if (this._view) {
      this._view.webview.postMessage({
        command: "addResponse",
        response,
      });
    }
  }

  public getSourceFiles(): vscode.Uri[] {
    return this._sourceFiles;
  }

  public getTestFiles(): vscode.Uri[] {
    return this._testFiles;
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
    this.postSourceFilesUpdate();
    this.saveState();
  }

  private addTestFile(file: vscode.Uri) {
    if (!this._testFiles.some((f) => f.fsPath === file.fsPath)) {
      this._testFiles.push(file);
      this.postTestFilesUpdate();
      this.saveState();
    }
  }

  private removeTestFile(file: vscode.Uri) {
    this._testFiles = this._testFiles.filter((f) => f.fsPath !== file.fsPath);
    this.postTestFilesUpdate();
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
        </head>
        <body>
            <header class="app-header">
                <div class="header-content">
                    <h1>TDD AI Companion</h1>
                    <span class="header-subtitle">Test suggestion assistant</span>
                </div>
            </header>
    
            <div id="main-container" class="main-container">
                <section class="project-panel">
                    <h2 class="section-title">Project Configuration</h2>
                    <div class="panel-group">

                        <!-- Feature input -->
                        <div class="info-item">
                            <div class="info-label">
                                <i class="codicon codicon-symbol-event"></i>
                                <span>Feature:</span>
                            </div>
                            <div class="feature-input-container">
                                <input type="text" id="feature-input" placeholder="Enter feature name/description" />
                            </div>
                        </div>

                        <!-- File Explorer Tree View -->
                        <div class="tree-view-container">
                            <div class="tree-view-header">
                                <h3>Workspace Files</h3>
                                <div class="tree-view-controls">
                                    <button id="refresh-tree" class="icon-button" title="Refresh">
                                        <i class="codicon codicon-refresh"></i>
                                    </button>
                                    <button id="collapse-all" class="icon-button" title="Collapse All">
                                        <i class="codicon codicon-collapse-all"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="tree-filter">
                                <input type="text" id="file-filter" placeholder="Filter files...">
                            </div>
                            <div id="file-tree" class="tree-view"></div>
                        </div>

                        <div class="selection-summary">
                            <div class="selection-section">
                                <h4><i class="codicon codicon-file-code"></i> Source Files</h4>
                                <div id="source-files" class="chip-container">None selected</div>
                            </div>
                            <div class="selection-section">
                                <h4><i class="codicon codicon-beaker"></i> Test Files</h4>
                                <div id="test-files" class="chip-container">None selected</div>
                            </div>
                        </div>
                    </div>
                </section>
    
                <section class="chat-section">
                    <h2 class="section-title">Test Suggestions</h2>
                    <div class="chat-container">
                        <div id="chat-messages" class="messages-container"></div>
                        <div class="input-container">
                            <div class="action-buttons">
                                <button id="suggest-test-button" class="action-button" title="Generate test suggestions">
                                    <i class="codicon codicon-lightbulb"></i> Suggest Tests
                                </button>
                            </div>
                            <textarea id="chat-input" class="message-input" placeholder="Enter your message..."></textarea>
                            <button id="send-button" class="send-button" title="Send Request">
                                <i class="codicon codicon-send"></i>
                            </button>
                        </div>
                    </div>
                </section>
    
                <!--
                <section class="history-section">
                    <div class="history-header">
                        <h2 class="section-title">Suggestion History</h2>
                        <button id="clear-history" class="text-button" title="Clear History">
                            <i class="codicon codicon-clear-all"></i> Clear
                        </button>
                    </div>
                    <div id="suggestions-history" class="history-container"></div>
                </section>
                -->
            </div>
    
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
  }
}
