import * as vscode from "vscode";
import { RAGService, IndexingProgress } from "./ragService";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface IndexingStatus {
  isIndexing: boolean;
  progress?: IndexingProgress;
  lastUpdate?: number;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tdd-ai-companion.sidebar";

  public _view?: vscode.WebviewView;
  private _currentFeature: string = "";
  private _sourceFiles: vscode.Uri[] = [];
  private _testFiles: vscode.Uri[] = []; // New: Test files

  private _context: vscode.ExtensionContext;
  private _ragService: RAGService;

  private _checkedItems: string[] = []; // For source files
  private _checkedTestItems: string[] = []; // For test files

  // Update the chat history type
  private _chatHistory: ChatMessage[] = [];
  private _cancellationTokenSource?: vscode.CancellationTokenSource;
  private _isCurrentRequestCancelled: boolean = false; // Add internal cancellation flag

  // Enhanced indexing status tracking
  private _indexingStatus: IndexingStatus = { isIndexing: false };
  private _progressUpdateTimer?: NodeJS.Timeout;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    ragService: RAGService // Add RAGService here
  ) {
    this._context = context;
    this._ragService = ragService; // Store it

    // Set up progress callback for RAG service
    this._ragService.setProgressCallback((progress: IndexingProgress) => {
      this.handleIndexingProgress(progress);
    });

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
    // Load checked test items
    this._checkedTestItems = this._context.workspaceState.get<string[]>(
      "checkedTestItems",
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


    // Save test files
    this._context.workspaceState.update(
      "testFiles",
      this._testFiles.map((file) => file.fsPath)
    );

    
    // Save checked items
    this._context.workspaceState.update(
      "checkedItems",
      this._checkedItems
    );
    // Save checked test items
    this._context.workspaceState.update(
      "checkedTestItems",
      this._checkedTestItems
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
    this.postTestFilesUpdate(); // Add this line    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
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
          });          // Send checked items
          webviewView.webview.postMessage({
            command: "loadCheckedItems",
            checkedItems: this._checkedItems,
          });

          // Send initial indexing status
          this.sendIndexingStatus();

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
          this._checkedTestItems = message.checkedTestItems; // Save checked test items
          this._context.workspaceState.update(
            "checkedItems",
            this._checkedItems
          );
          this._context.workspaceState.update(
            "checkedItems",
            this._checkedItems
          );
          break;
        case "saveCheckedTestItems": // New message handler
          this._checkedTestItems = message.checkedTestItems;
          this._context.workspaceState.update(
            "checkedTestItems",
            this._checkedTestItems
          );
          break;
        case "newChat":
          this._chatHistory = [];
          this._context.workspaceState.update("chatHistory", this._chatHistory);

          // Notify webview to clear chat UI
          webviewView.webview.postMessage({
            command: "clearChatUI",
          });
          break;        case "openExtensionSettings":
          vscode.commands.executeCommand('workbench.action.openSettings', 'tdd-ai-companion');
          break;
        case "getIndexingStatus":
          this.sendIndexingStatus();
          break;
        case "triggerManualIndex":
          await this.triggerManualIndexing();
          break;
        case "clearIndex":
          await this.clearIndex();
          break;
        case "performCleanup":
          await this.performCleanup();
          break;
        case "toggleAutoIndexing":
          this.toggleAutoIndexing();
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
  public async addTestFile(file: vscode.Uri) {
    if (!this._testFiles.some((f) => f.fsPath === file.fsPath)) {
      this._testFiles.push(file);
      // Also add to checked test items
      this._checkedTestItems.push(file.fsPath);
      
      // Update RAG service with new file selection
      await this.updateRAGServiceSelection();
      
      this.postTestFilesUpdate();
      this.postCheckedTestItemsUpdate(); // Notify webview about checked test items
      this.saveState();
      
      // Send updated indexing status
      this.sendIndexingStatus();
    }
  }

  public async removeTestFile(file: vscode.Uri) {
    this._testFiles = this._testFiles.filter(
      (f) => f.fsPath !== file.fsPath
    );
    // Also remove from checked test items
    this._checkedTestItems = this._checkedTestItems.filter(itemPath => itemPath !== file.fsPath);
    
    // Update RAG service with new file selection
    await this.updateRAGServiceSelection();
    
    this.postTestFilesUpdate();
    this.postCheckedTestItemsUpdate(); // Notify webview about checked test items
    // Also send a message to uncheck the item in the file tree
    if (this._view) {
        this._view.webview.postMessage({
            command: "uncheckFileTreeItem",
            path: file.fsPath,
            treeType: 'test' // Specify tree type
        });
    }
    this.saveState();
    
    // Send updated indexing status
    this.sendIndexingStatus();
  }

  private postTestFilesUpdate() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateTestFiles",
        files: this._testFiles.map((f) => f.fsPath),
      });
    }
  }

  private postCheckedTestItemsUpdate() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateCheckedTestItems",
        checkedTestItems: this._checkedTestItems,
      });
    }
  }

  /**
   * Update RAG service with current file selection and trigger indexing if needed
   */
  private async updateRAGServiceSelection(): Promise<void> {
    const allSelectedFiles = [...this._sourceFiles, ...this._testFiles];
    
    // Update RAG service selection
    this._ragService.setSelectedFiles(allSelectedFiles);
    
    // Get current indexing status
    const status = this._ragService.getIndexingStatus();
    
    // If auto-indexing is enabled and we have files selected, trigger indexing
    if (status.autoIndexingEnabled && allSelectedFiles.length > 0 && !status.isIndexing) {
      try {
        // Check if any selected files need indexing
        const needsIndexing = await this.checkIfFilesNeedIndexing(allSelectedFiles);
        
        if (needsIndexing) {
          vscode.window.showInformationMessage(
            `Auto-indexing ${allSelectedFiles.length} selected files...`
          );
          
          await this._ragService.indexProjectFiles(allSelectedFiles);
        }
      } catch (error) {
        console.error('Error during auto-indexing:', error);
        vscode.window.showErrorMessage(
          `Auto-indexing failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Check if any of the selected files need indexing
   */
  private async checkIfFilesNeedIndexing(files: vscode.Uri[]): Promise<boolean> {
    // Simple heuristic: if there are files selected but no indexed files,
    // or if the number of selected files is significantly different from indexed files,
    // then we probably need indexing
    const status = this._ragService.getIndexingStatus();
    
    if (status.indexedFilesCount === 0 && files.length > 0) {
      return true;
    }
    
    // Check if the difference is significant (more than 20% difference)
    const difference = Math.abs(files.length - status.indexedFilesCount);
    const threshold = Math.max(1, Math.floor(files.length * 0.2));
    
    return difference > threshold;
  }

  /**
   * Trigger manual indexing of selected files
   */
  private async triggerManualIndexing(): Promise<void> {
    const allSelectedFiles = [...this._sourceFiles, ...this._testFiles];
    
    if (allSelectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected for indexing.');
      return;
    }

    try {
      vscode.window.showInformationMessage(
        `Starting manual indexing of ${allSelectedFiles.length} files...`
      );
      
      await this._ragService.indexProjectFiles(allSelectedFiles);
      
      vscode.window.showInformationMessage(
        `Successfully indexed ${allSelectedFiles.length} files.`
      );
    } catch (error) {
      console.error('Manual indexing failed:', error);
      vscode.window.showErrorMessage(
        `Manual indexing failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clear the index
   */
  private async clearIndex(): Promise<void> {
    try {
      const confirmed = await vscode.window.showWarningMessage(
        'Are you sure you want to clear the entire index? This action cannot be undone.',
        { modal: true },
        'Clear Index'
      );

      if (confirmed === 'Clear Index') {
        await this._ragService.clearIndex();
        vscode.window.showInformationMessage('Index cleared successfully.');
        this.sendIndexingStatus();
      }
    } catch (error) {
      console.error('Failed to clear index:', error);
      vscode.window.showErrorMessage(
        `Failed to clear index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Perform manual cleanup
   */
  private async performCleanup(): Promise<void> {
    try {
      vscode.window.showInformationMessage('Starting cleanup...');
      
      const result = await this._ragService.performManualCleanup();
      
      vscode.window.showInformationMessage(
        `Cleanup complete: removed ${result.removedFiles} files and ${result.removedChunks} chunks.`
      );
      
      if (result.errors.length > 0) {
        console.error('Cleanup errors:', result.errors);
        vscode.window.showWarningMessage(
          `Cleanup completed with ${result.errors.length} errors. Check the console for details.`
        );
      }
      
      this.sendIndexingStatus();
    } catch (error) {
      console.error('Cleanup failed:', error);
      vscode.window.showErrorMessage(
        `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Toggle auto-indexing on/off
   */
  private toggleAutoIndexing(): void {
    const currentStatus = this._ragService.getIndexingStatus();
    const newStatus = !currentStatus.autoIndexingEnabled;
    
    this._ragService.setAutoIndexingEnabled(newStatus);
    
    vscode.window.showInformationMessage(
      `Auto-indexing ${newStatus ? 'enabled' : 'disabled'}.`
    );
    
    this.sendIndexingStatus();
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
          
          // Sort children alphabetically - directories first, then files
          currentNode.children.sort((a: any, b: any) => {
            // If types are different, directories come first
            if (a.type !== b.type) {
              return a.type === "directory" ? -1 : 1;
            }
            // If types are the same, sort alphabetically by name
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          });
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
  }  private async addSourceFile(file: vscode.Uri) {
    if (!this._sourceFiles.some((f) => f.fsPath === file.fsPath)) {
      this._sourceFiles.push(file);
      
      // Update RAG service with new file selection
      await this.updateRAGServiceSelection();
      
      this.postSourceFilesUpdate();
      this.saveState();
      
      // Send updated indexing status
      this.sendIndexingStatus();
    }
  }

  private async removeSourceFile(file: vscode.Uri) {
    this._sourceFiles = this._sourceFiles.filter(
      (f) => f.fsPath !== file.fsPath
    );
    // Also remove from checked items
    this._checkedItems = this._checkedItems.filter(itemPath => itemPath !== file.fsPath);
    
    // Update RAG service with new file selection
    await this.updateRAGServiceSelection();
    
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
            treeType: 'source' // Specify tree type
        });
    }
    this.postSourceFilesUpdate();
    this.saveState();
    
    // Send updated indexing status
    this.sendIndexingStatus();
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
        <body>            <div id="main-container" class="main-container">
                <section class="project-panel">
                    <div class="project-panel-header">                        <div class="section-title-wrapper">
                            <h2 class="section-title">Project Configuration</h2>
                            <button id="toggle-project-panel" class="icon-button" title="Collapse/Expand Project Panel">
                                <i class="codicon codicon-chevron-up"></i>
                            </button>
                        </div>
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
                                <span>Feature/Function:</span>
                            </div>
                            <div class="feature-input-wrapper">
                                <input type="text" id="feature-input" placeholder="What feature do you want to test?" />
                            </div>
                        </div>

                        <!-- <div class="file-warning-message">
                            <i class="codicon codicon-warning"></i>
                            <span>For best results, please select only the files related to your question. Sending too many files may reduce accuracy and slow down responses.</span>
                        </div> -->

                        <!-- Source File Explorer Tree View -->
                        <div class="tree-view-container">
                            <div class="tree-view-header">
                                <div class="header-top-row">
                                    <h3>Source Files</h3>
                                    <div class="tree-view-controls">
                                        <button id="refresh-source-tree" class="icon-button" title="Refresh Source Files">
                                            <i class="codicon codicon-sync"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="source-files" class="chip-container">None selected</div>
                            </div>
                            <div class="tree-filter">
                                <div class="source-input-wrapper">
                                    <input type="text" id="source-file-filter" placeholder="Filter source files...">
                                    <i id="source-error-icon" class="codicon codicon-warning"></i>
                                </div>
                            </div>
                            <div id="source-file-tree" class="tree-view"></div>
                        </div>

                        <!-- Test File Explorer Tree View -->
                        <div class="tree-view-container">
                            <div class="tree-view-header">
                                <div class="header-top-row">
                                    <h3>Test Files</h3>
                                    <div class="tree-view-controls">
                                        <button id="refresh-test-tree" class="icon-button" title="Refresh Test Files">
                                            <i class="codicon codicon-sync"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="test-files" class="chip-container">None selected</div>
                            </div>
                            <div class="tree-filter">
                                <div class="test-input-wrapper">
                                    <input type="text" id="test-file-filter" placeholder="Filter test files...">
                                    <i id="test-error-icon" class="codicon codicon-warning"></i>
                                </div>
                            </div>
                            <div id="test-file-tree" class="tree-view"></div>
                        </div>


                    </div>
                </section>                <section class="chat-section">                    <div class="chat-panel-header">
                        <div class="section-title-wrapper">
                            <h2 class="section-title">Test Suggestions</h2>
                        </div>
                        <div class="chat-header-actions">
                            <button id="new-chat-button" class="icon-button" title="Start a new chat (clears current conversation)">
                                <i class="codicon codicon-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="chat-container">
                        <div id="chat-messages" class="messages-container"></div>                        <div class="input-container">
                            <div class="suggest-test-container">
                                <button id="suggest-test-button" class="suggest-test-button" title="Suggest a test case">
                                    Suggest Test Case
                                </button>
                            </div>
                            <div class="action-buttons">
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

  /**
   * Handle indexing progress updates from RAG service
   */
  private handleIndexingProgress(progress: IndexingProgress): void {
    this._indexingStatus = {
      isIndexing: progress.stage !== 'complete',
      progress,
      lastUpdate: Date.now()
    };

    // Send progress update to webview
    if (this._view) {
      this._view.webview.postMessage({
        command: "indexingProgress",
        progress,
        status: this._indexingStatus
      });
    }

    // Clear timer and set new one to update UI
    if (this._progressUpdateTimer) {
      clearTimeout(this._progressUpdateTimer);
    }

    // If indexing is complete, clear status after a brief delay
    if (progress.stage === 'complete') {
      this._progressUpdateTimer = setTimeout(() => {
        this._indexingStatus.isIndexing = false;
        if (this._view) {
          this._view.webview.postMessage({
            command: "indexingComplete",
            status: this._indexingStatus
          });
        }
      }, 2000); // Show completion for 2 seconds
    }
  }

  /**
   * Send indexing status to webview
   */
  private sendIndexingStatus(): void {
    if (this._view) {
      const ragStatus = this._ragService.getIndexingStatus();
      const projectStats = this._ragService.getProjectStatistics();
      
      this._view.webview.postMessage({
        command: "indexingStatus",
        status: ragStatus,
        statistics: projectStats
      });
    }
  }
}
