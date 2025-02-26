import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tdd-ai-companion.sidebar';

    public _view?: vscode.WebviewView;
    private _sourceFiles: vscode.Uri[] = [];
    private _testFiles: vscode.Uri[] = [];
    private _currentFeature: string = '';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'requestTestSuggestion':
                    // Forward the request to the extension
                    vscode.commands.executeCommand('tdd-ai-companion.suggestTestCase', message.message);
                    break;
                case 'setupProject':
                    vscode.commands.executeCommand('tdd-ai-companion.setupProject');
                    break;
                case 'updateFeature':
                    this._currentFeature = message.feature;
                    break;
            }
        });

        // Show setup message when first opened
        setTimeout(() => {
            if (this._sourceFiles.length === 0 && this._testFiles.length === 0) {
                this.postSetupNeededMessage();
            }
        }, 500);
    }

    public updateSourceFiles(files: vscode.Uri[]) {
        this._sourceFiles = files;
        this.postSourceFilesUpdate();
    }

    public updateTestFiles(files: vscode.Uri[]) {
        this._testFiles = files;
        this.postTestFilesUpdate();
    }

    public updateFeature(feature: string) {
        this._currentFeature = feature;
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateFeature',
                feature: feature
            });
        }
    }

    private postSourceFilesUpdate() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateSourceFiles',
                files: this._sourceFiles.map(f => f.fsPath)
            });
        }
    }

    private postTestFilesUpdate() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateTestFiles',
                files: this._testFiles.map(f => f.fsPath)
            });
        }
    }

    private postSetupNeededMessage() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'setupNeeded'
            });
        }
    }

    public addResponse(response: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'addResponse',
                response
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

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js'));
        const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'));
    
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
    
            <div id="setup-container" class="setup-container">
                <div class="setup-content">
                    <div class="setup-icon">
                        <i class="codicon codicon-settings-gear"></i>
                    </div>
                    <h2>Setup Required</h2>
                    <p>Configure your project to start generating test suggestions</p>
                    <button id="setup-button" class="primary-button">
                        <i class="codicon codicon-play"></i> Set Up Project
                    </button>
                </div>
            </div>
    
            <div id="main-container" class="main-container">
                <section class="project-panel">
                    <h2 class="section-title">Project Configuration</h2>
                    <div class="panel-group">
                        <div class="info-item">
                            <div class="info-label">
                                <i class="codicon codicon-symbol-event"></i>
                                <span>Feature:</span>
                            </div>
                            <div id="current-feature" class="info-value">Not set</div>
                            <button id="edit-feature" class="icon-button" title="Edit Feature">
                                <i class="codicon codicon-edit"></i>
                            </button>
                        </div>
                        <div class="info-item">
                            <div class="info-label">
                                <i class="codicon codicon-file-code"></i>
                                <span>Source:</span>
                            </div>
                            <div id="source-files" class="info-value">None selected</div>
                            <button id="edit-source-files" class="icon-button" title="Edit Source Files">
                                <i class="codicon codicon-edit"></i>
                            </button>
                        </div>
                        <div class="info-item">
                            <div class="info-label">
                                <i class="codicon codicon-beaker"></i>
                                <span>Tests:</span>
                            </div>
                            <div id="test-files" class="info-value">None selected</div>
                            <button id="edit-test-files" class="icon-button" title="Edit Test Files">
                                <i class="codicon codicon-edit"></i>
                            </button>
                        </div>
                    </div>
                </section>
    
                <section class="chat-section">
                    <h2 class="section-title">Test Suggestions</h2>
                    <div class="chat-container">
                        <div id="chat-messages" class="messages-container"></div>
                        <div class="input-container">
                            <textarea id="chat-input" class="message-input" placeholder="Request test case suggestions..."></textarea>
                            <button id="send-button" class="send-button" title="Send Request">
                                <i class="codicon codicon-send"></i>
                            </button>
                        </div>
                    </div>
                </section>
    
                <section class="history-section">
                    <div class="history-header">
                        <h2 class="section-title">Suggestion History</h2>
                        <button id="clear-history" class="text-button" title="Clear History">
                            <i class="codicon codicon-clear-all"></i> Clear
                        </button>
                    </div>
                    <div id="suggestions-history" class="history-container"></div>
                </section>
            </div>
    
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}