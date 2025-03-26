import * as vscode from "vscode";
import * as path from "path";
import { SidebarProvider } from "./SidebarProvider";
import { RAGService } from "./ragService";
import { SUPPORTED_EXTENSIONS } from "./codeParser";

let sidebarProvider: SidebarProvider;
let ragService: RAGService;
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

  // Initialize the RAG service
  ragService = new RAGService();

  // Auto-clear index on project change and track current project
  autoManageIndexForProject(context).catch((error) => {
    console.error("Error in auto index management:", error);
  });

  // Suggest Test Case Command
  const suggestTestCaseCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.suggestTestCase",
    async (userMessage: string) => {
      // Debug
      console.log(sidebarProvider.getCurrentFeature());
      console.log(sidebarProvider.getSourceFiles());
      console.log(sidebarProvider.getTestFiles());

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

            console.log("Conversation history:", conversationHistory);

            // Call the DeepSeek r1 model
            const response = await callDeepSeekAPI(prompt, conversationHistory);

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

  // Add command to index codebase for RAG
  const indexCodebaseCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.indexCodebase",
    async () => {
      // Check if Pinecone API key is set
      const config = vscode.workspace.getConfiguration("tddAICompanion");
      const pineconeApiKey = config.get("pineconeApiKey") as string;

      if (!pineconeApiKey) {
        vscode.window.showErrorMessage(
          "Pinecone API key is required for RAG functionality. Please set it in the extension settings."
        );
        return;
      }

      // Check if setup was done
      if (
        sidebarProvider.getSourceFiles().length === 0 &&
        sidebarProvider.getTestFiles().length === 0
      ) {
        // If no files are selected, show options to select all code files
        const select = await vscode.window.showInformationMessage(
          "No files are currently selected. Would you like to index all code files in the workspace?",
          "Yes",
          "No, I'll select files manually"
        );

        if (select === "No, I'll select files manually") {
          vscode.window.showInformationMessage(
            "Please select source and/or test files first before indexing."
          );
          return;
        } else if (select === "Yes") {
          // Get all supported code files in the workspace
          const filePattern = `**/*{${SUPPORTED_EXTENSIONS.join(",")}}`;
          const files = await vscode.workspace.findFiles(
            filePattern,
            "**/node_modules/**"
          );

          if (files.length === 0) {
            vscode.window.showErrorMessage(
              "No supported code files found in workspace."
            );
            return;
          }

          // Ask for confirmation due to potentially large number of files
          const confirm = await vscode.window.showWarningMessage(
            `Found ${files.length} code files. Indexing all of them might take a while and consume API resources. Continue?`,
            "Yes",
            "No"
          );

          if (confirm !== "Yes") {
            return;
          }

          // Set these files as source files
          sidebarProvider.updateSourceFiles(files);
        }
      }

      // Get the source and test files selected by the user
      const sourceFiles = sidebarProvider.getSourceFiles();
      const testFiles = sidebarProvider.getTestFiles();

      // Combine the files for indexing
      const filesToIndex = [...sourceFiles, ...testFiles];

      if (filesToIndex.length === 0) {
        vscode.window.showErrorMessage("No files selected for indexing.");
        return;
      }

      // Prompt user for confirmation
      const confirm = await vscode.window.showWarningMessage(
        `This will index ${filesToIndex.length} selected files for RAG functionality. Continue?`,
        "Yes",
        "No"
      );

      if (confirm !== "Yes") {
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Indexing selected files for RAG...",
          cancellable: false,
        },
        async (progress) => {
          try {
            // Initialize RAG service
            await ragService.initialize();

            // Index the files
            const success = await ragService.indexProjectFiles(filesToIndex);

            if (success) {
              vscode.window.showInformationMessage(
                `Successfully indexed ${filesToIndex.length} files for RAG.`
              );
            }
          } catch (error) {
            console.error("Error details:", error);
            vscode.window.showErrorMessage(
              `Error indexing files: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      );
    }
  );
  context.subscriptions.push(indexCodebaseCommand);

  // Add command to clear codebase index
  const clearCodebaseIndexCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.clearCodebaseIndex",
    async () => {
      // Check if Pinecone API key is set
      const config = vscode.workspace.getConfiguration("tddAICompanion");
      const pineconeApiKey = config.get("pineconeApiKey") as string;

      if (!pineconeApiKey) {
        vscode.window.showErrorMessage(
          "Pinecone API key is required for RAG functionality. Please set it in the extension settings."
        );
        return;
      }

      // Prompt user for confirmation
      const confirm = await vscode.window.showWarningMessage(
        "This will clear all indexed code chunks from the vector database. Continue?",
        "Yes",
        "No"
      );

      if (confirm !== "Yes") {
        return;
      }

      try {
        await ragService.clearIndex();
        vscode.window.showInformationMessage(
          "Codebase index cleared successfully."
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error clearing codebase index: ${error}`
        );
      }
    }
  );
  context.subscriptions.push(clearCodebaseIndexCommand);
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
  // Original Statement
  //   `
  // You are an expert Test-Driven Development (TDD) assistant. Your task is to SUGGEST tests for the user's code, not write them.

  // Current feature being worked on: ${feature}

  // USER'S SOURCE CODE:
  // ${sourceContent}

  // EXISTING TEST CODE:
  // ${testContent}

  // ${currentFileContext ? `CURRENTLY OPEN FILE:\n${currentFileContext}\n` : ""}

  // User's request: ${userMessage}

  // Guidelines for your response:
  // 1. ONLY SUGGEST test cases, don't write complete test code
  // 2. Focus on edge cases, boundary conditions, and comprehensive test coverage
  // 3. Describe what should be tested and what assertions could be made
  // 4. Consider the feature context and existing tests
  // 5. Respect the existing testing style and framework
  // 6. Suggest descriptive test names/descriptions that follow best TDD practices

  // Response format:
  // - Start with a brief analysis of the existing code and tests
  // - List suggested test cases with clear explanations of what they test
  // - Highlight any edge cases or potential issues to test
  // - Suggest test case names/descriptions that follow the project's naming pattern
  // `

  return `${
    currentFileContext ? `CURRENTLY OPEN FILE:\n${currentFileContext}\n` : ""
  }`;
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

// This function will now use RAG for better context
async function callDeepSeekAPI(
  prompt: string,
  conversationHistory: ChatMessage[] = []
): Promise<string> {
  // Get API key from extension settings
  const config = vscode.workspace.getConfiguration("tddAICompanion");
  const useCustomLLM = config.get("useCustomLLM") as boolean;
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
      // {
      //   role: "system",
      //   content:
      //     "You are an expert Test-Driven Development (TDD) assistant. Your task is to SUGGEST tests for the user's code, not write them.",
      // },
    ];

    // Add conversation history (limited to last X exchanges to avoid token limits)

    console.log("Conversation History:", conversationHistory);
    const maxHistoryLength = 6; // Adjust based on your token requirements
    const recentHistory = conversationHistory.slice(-maxHistoryLength);
    messages.push(...recentHistory);

    // Enhance the prompt with RAG if possible
    let enhancedPrompt = prompt;
    try {
      // Check if Pinecone is configured
      const pineconeApiKey = config.get("pineconeApiKey") as string;

      if (pineconeApiKey) {
        // Try to get relevant code chunks from the RAG service
        const relevantChunks = await ragService.retrieveRelevantCode(prompt);
        if (relevantChunks.length > 0) {
          console.log("Retrieved relevant code chunks:", relevantChunks.length);
          console.log("Relevant code chunks:", relevantChunks);
          enhancedPrompt = ragService.augmentPromptWithCodeContext(
            prompt,
            relevantChunks
          );

          console.log(enhancedPrompt);
        }
      } else {
        console.log("Pinecone not configured, skipping RAG enhancement");
      }
    } catch (error) {
      console.warn("RAG enhancement failed, using original prompt:", error);
    }

    // Add current prompt if not already in history
    if (
      !recentHistory.some(
        (msg) => msg.role === "user" && msg.content === prompt
      )
    ) {
      messages.push({
        role: "user",
        content: enhancedPrompt,
      });
    }

    console.log(messages);

    if (useCustomLLM) {
      return await callCustomLLM(messages);
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
          model: "deepseek/deepseek-r1-distill-llama-70b:free",
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

async function callCustomLLM(messages: ChatMessage[]): Promise<string> {
  const config = vscode.workspace.getConfiguration("tddAICompanion");
  const endpoint = config.get("customLLMEndpoint") as string;

  if (!endpoint) {
    throw new Error(
      "Custom LLM endpoint not configured. Please set it in the extension settings."
    );
  }

  try {
    console.log(`Calling custom LLM at ${endpoint}`);

    // Format the request for your custom endpoint
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_text: messages
          .map(
            (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
          )
          .join("\n\n"),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    // Parse the custom LLM response format
    const data = await response.json();
    console.log("Raw response from custom LLM:", data);

    // Check for the result field in the response (your API format)
    if (data.result) {
      return data.result;
    }

    if (data.status === "COMPLETED" && data.output && data.output.length > 0) {
      // Extract content from the tokens
      if (data.output[0].choices && data.output[0].choices.length > 0) {
        return data.output[0].choices[0].tokens.join("");
      }
    }

    throw new Error("Invalid response format from custom LLM");
  } catch (error) {
    console.error("Error calling custom LLM:", error);
    throw new Error(
      `Failed to get test suggestions from custom LLM: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Automatically manages the vector index when opening different projects
 * Clears the index when a new project is detected to avoid cross-contamination
 */
async function autoManageIndexForProject(context: vscode.ExtensionContext) {
  try {
    // Get current workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return; // No workspace open
    }

    // Get the current project path
    const currentProjectPath = workspaceFolder.uri.fsPath;

    // Get the previously stored project path
    const lastIndexedProject = context.globalState.get<string>(
      "lastIndexedProject",
      ""
    );

    // Check if pinecone API key is set
    const config = vscode.workspace.getConfiguration("tddAICompanion");
    const pineconeApiKey = config.get("pineconeApiKey") as string;

    if (!pineconeApiKey) {
      // Can't do anything without the API key
      return;
    }

    // If this is a different project than the last indexed one
    if (lastIndexedProject && lastIndexedProject !== currentProjectPath) {
      // Initialize RAG service
      await ragService.initialize();

      // Clear the index first
      await ragService.clearIndex();

      vscode.window.showInformationMessage(
        "Detected new project! Cleared previous project's vector index. Use 'TDD AI: Index Codebase for RAG' to index this project."
      );
    }

    // Store the current project path for future reference
    await context.globalState.update("lastIndexedProject", currentProjectPath);
  } catch (error) {
    console.error("Error in autoManageIndexForProject:", error);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  // checkAndClearIndexForNewProject(vscode.extensions.getExtension("tdd-ai-companion")?.extensionUri);
}
