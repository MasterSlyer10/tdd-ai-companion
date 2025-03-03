import * as vscode from "vscode";
import * as path from "path";
import { SidebarProvider } from "./SidebarProvider";

let sidebarProvider: SidebarProvider;
let typingTimeout: NodeJS.Timeout | undefined;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log("TDD AI Companion is now active!");

  // Initialize the sidebar
  sidebarProvider = new SidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Setup Project Command - Initial workflow when extension is opened
  const setupProjectCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.setupProject",
    async () => {
      // 1. Select source code files
      const sourceFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        openLabel: "Select Source Code Files",
        title: "Select files containing the implementation code",
      });

      if (!sourceFiles) {
        vscode.window.showWarningMessage(
          "No source files selected. Setup cancelled."
        );
        return;
      }

      sidebarProvider.updateSourceFiles(sourceFiles);

      // 2. Select test files
      const testFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        openLabel: "Select Test Files",
        title: "Select files containing the tests",
      });

      if (!testFiles) {
        vscode.window.showWarningMessage(
          "No test files selected. Setup cancelled."
        );
        return;
      }

      sidebarProvider.updateTestFiles(testFiles);

      // 3. Ask for the feature being worked on
      const feature = await vscode.window.showInputBox({
        placeHolder: "What feature are you working on?",
        prompt:
          "Enter the name or description of the feature you are implementing",
      });

      if (!feature) {
        vscode.window.showWarningMessage(
          "No feature specified. Setup cancelled."
        );
        return;
      }

      sidebarProvider.updateFeature(feature);

      vscode.window.showInformationMessage("TDD AI Companion setup complete!");
    }
  );
  context.subscriptions.push(setupProjectCommand);

  // Suggest Test Case Command
  const suggestTestCaseCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.suggestTestCase",
    async (userMessage: string) => {
      // Debug
      console.log(sidebarProvider.getSourceFiles());
      console.log(sidebarProvider.getTestFiles());
      console.log(sidebarProvider.getCurrentFeature());

      // Check if setup was done
      if (
        sidebarProvider.getSourceFiles().length === 0 ||
        sidebarProvider.getTestFiles().length === 0 ||
        !sidebarProvider.getCurrentFeature()
      ) {
        vscode.window.showErrorMessage("Please complete the setup first.");
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating test suggestions...",
          cancellable: false,
        },
        async (progress) => {
          try {
            // Add the user message to history before making the API call
            sidebarProvider.addUserMessage(userMessage);

            // Gather context from files
            const sourceContent = await readFilesContent(
              sidebarProvider.getSourceFiles()
            );
            const testContent = await readFilesContent(
              sidebarProvider.getTestFiles()
            );

            // Get currently open file
            let currentFileContext = "";
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
              const fileName = path.basename(activeEditor.document.fileName);
              currentFileContext = `Currently open file: ${fileName}\n${activeEditor.document.getText()}`;
            }

            // Create prompt for the LLM
            const prompt = createTestSuggestionPrompt(
              sourceContent,
              testContent,
              currentFileContext,
              sidebarProvider.getCurrentFeature(),
              userMessage
            );

            // Get conversation history
            const conversationHistory =
              sidebarProvider.getConversationHistory();

            // Call the DeepSeek r1 model
            const response = await callDeepSeekAPI(prompt);

            // Display the response
            sidebarProvider.addResponse(response);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Error generating test suggestions: ${error}`
            );
          }
        }
      );
    }
  );
  context.subscriptions.push(suggestTestCaseCommand);

  // Update source files command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tdd-ai-companion.updateSourceFiles",
      async () => {
        const files = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: true,
          openLabel: "Select Source Code Files",
        });

        if (files) {
          sidebarProvider.updateSourceFiles(files);
        }
      }
    )
  );

  // Update test files command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tdd-ai-companion.updateTestFiles",
      async () => {
        const files = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: true,
          openLabel: "Select Test Files",
        });

        if (files) {
          sidebarProvider.updateTestFiles(files);
        }
      }
    )
  );

  // Update feature command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tdd-ai-companion.updateFeature",
      async () => {
        const feature = await vscode.window.showInputBox({
          placeHolder: "What feature are you working on?",
          prompt:
            "Enter the name or description of the feature you are implementing",
          value: sidebarProvider.getCurrentFeature(),
        });

        if (feature) {
          sidebarProvider.updateFeature(feature);
        }
      }
    )
  );
}

// Responsible for opening the file based on the path
async function readFilesContent(files: vscode.Uri[]): Promise<string> {
  let combinedContent = "";

  for (const file of files) {
    try {
      const document = await vscode.workspace.openTextDocument(file);
      const fileName = path.basename(file.fsPath);
      combinedContent += `File: ${fileName}\n\n${document.getText()}\n\n`;

      //Debug
      console.log("Reading file: ", file.fsPath);
      console.log("Content: ", document.getText());
    } catch (error) {
      console.error(`Error reading file ${file.fsPath}:`, error);
    }
  }

  return combinedContent;
}

// Change ts to whatever Richter did for in finetuning
function createTestSuggestionPrompt(
  sourceContent: string,
  testContent: string,
  currentFileContext: string,
  feature: string,
  userMessage: string
): string {
  return `
You are an expert Test-Driven Development (TDD) assistant. Your task is to SUGGEST tests for the user's code, not write them.

Current feature being worked on: ${feature}

USER'S SOURCE CODE:
${sourceContent}

EXISTING TEST CODE:
${testContent}

${currentFileContext ? `CURRENTLY OPEN FILE:\n${currentFileContext}\n` : ""}

User's request: ${userMessage}

Guidelines for your response:
1. ONLY SUGGEST test cases, don't write complete test code
2. Focus on edge cases, boundary conditions, and comprehensive test coverage
3. Describe what should be tested and what assertions could be made
4. Consider the feature context and existing tests
5. Respect the existing testing style and framework
6. Suggest descriptive test names/descriptions that follow best TDD practices

Response format:
- Start with a brief analysis of the existing code and tests
- List suggested test cases with clear explanations of what they test
- Highlight any edge cases or potential issues to test
- Suggest test case names/descriptions that follow the project's naming pattern
`;
}

// Define interface for the API response
interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// This shit is what will always connect to the LLM if smt is wrong with LLM / we change llm just look at this
async function callDeepSeekAPI(
  prompt: string,
  conversationHistory: ChatMessage[] = []
): Promise<string> {
  // Get API key from extension settings
  const config = vscode.workspace.getConfiguration("tddAICompanion");
  let apiKey = config.get("openRouterApiKey") as string;

  // For testing purposes only
  if (!apiKey) {
    apiKey =
      "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"; // My key
  }

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key not found. Please set it in extension settings."
    );
  }

  try {
    // Create the messages array
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are an expert Test-Driven Development (TDD) assistant. Your task is to SUGGEST tests for the user's code, not write them.",
      },
    ];

    // Add conversation history (limited to last X exchanges to avoid token limits)
    const maxHistoryLength = 6; // Adjust based on your token requirements
    const recentHistory = conversationHistory.slice(-maxHistoryLength);
    messages.push(...recentHistory);

    // Add current prompt if not already in history
    if (
      !recentHistory.some(
        (msg) => msg.role === "user" && msg.content === prompt
      )
    ) {
      messages.push({
        role: "user",
        content: prompt,
      });
    }

    // Make API call with conversation history
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "vscode-tdd-ai-companion",
          "X-Title": "TDD AI Companion",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-r1-distill-llama-70b",
          messages: messages,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `API error: ${response.status} - ${JSON.stringify(errorData)}`
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling DeepSeek API:", error);
    throw new Error(
      `Failed to get test suggestions: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
