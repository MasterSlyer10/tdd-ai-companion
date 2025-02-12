import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';

let selectedFiles: vscode.Uri[] = [];
let sidebarProvider: SidebarProvider;
let typingTimeout: NodeJS.Timeout | undefined;


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "tdd-ai-companion" is now active!');

    // Shows the Sidebar
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
    );


    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const testCommand = vscode.commands.registerCommand('tdd-ai-companion.helloWorld', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World from tdd-ai-companion!');
    });
    context.subscriptions.push(testCommand);

    const scanDocumentCommand = vscode.commands.registerCommand('tdd-ai-companion.scanDocument', async () => {
        // if (selectedFiles.length === 0) {
        //     vscode.window.showErrorMessage('No files selected to scan.');
        //     return;
        // }

        // for (const file of selectedFiles) {
        //     const document = await vscode.workspace.openTextDocument(file);
        //     const documentText = document.getText();
        //     console.log(`Processing file: ${file.fsPath}`);

        //     if (sidebarProvider._view) {
        //         sidebarProvider._view.webview.postMessage({
        //             command: 'setText',
        //             text: documentText
        //         });
        //     }
        // }

        const editor = vscode.window.activeTextEditor; 
        if (editor) {
            let document = editor.document;
            let text = document.getText();
            if (sidebarProvider._view) {
                sidebarProvider._view.webview.postMessage({
                    command: 'setText',
                    text: text
                });
            }
            console.log(text);
        }
    });
    context.subscriptions.push(scanDocumentCommand);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }

        typingTimeout = setTimeout(() => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                let text = event.document.getText();
                if (sidebarProvider._view) {
                    sidebarProvider._view.webview.postMessage({
                        command: 'setText',
                        text: text
                    });
                }
            }
        }, 1000); // 1 second delay
    });

    const scanFilesCommand = vscode.commands.registerCommand('tdd-ai-companion.scanFiles', async () => {
        const selectedFileItems = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: true,
            openLabel: 'Select files to scan'
        });

        if (!selectedFileItems) {
            vscode.window.showErrorMessage('No files selected');
            return;
        }

        selectedFiles = selectedFileItems.map(item => item);

        const testFolder = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select the folder containing the tests'
        });

        if (!testFolder || testFolder.length === 0) {
            vscode.window.showErrorMessage('No test folder selected');
            return;
        }

        let combinedText = '';
        for (const file of selectedFiles) {
            const document = await vscode.workspace.openTextDocument(file);
            combinedText += document.getText() + '\n';
        }

        if (sidebarProvider._view) {
            sidebarProvider._view.webview.postMessage({
                command: 'setText',
                text: combinedText
            });
        }

        vscode.window.showInformationMessage(`Selected files: ${selectedFiles.map(file => file.fsPath).join(', ')}`);
        vscode.window.showInformationMessage(`Selected test folder: ${testFolder[0].fsPath}`);
    });


    context.subscriptions.push(scanFilesCommand);


}

// This method is called when your extension is deactivated
export function deactivate() {}

