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

  // Initialize the RAG service
  ragService = new RAGService();

  // Initialize the sidebar
  sidebarProvider = new SidebarProvider(context.extensionUri, context, ragService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Auto-clear index on project change and track current project
  autoManageIndexForProject(context).catch((error) => {
    console.error("Error in auto index management:", error);
  });

  // Suggest Test Case Command
  const suggestTestCaseCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.suggestTestCase",
    async (userMessage: string, cancellationToken?: vscode.CancellationToken) => {
      console.log("[suggestTestCaseCommand] Received userMessage from sidebar:", userMessage); // Log the incoming message
      // Debug
      console.log(sidebarProvider.getCurrentFeature());
      console.log(sidebarProvider.getSourceFiles());

      // Check if setup was done
      if (
        sidebarProvider.getSourceFiles().length === 0 ||
        !sidebarProvider.getCurrentFeature()
      ) {
        vscode.window.showErrorMessage("Please complete the setup first.");
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating test suggestions...",
          cancellable: true, // Make progress cancellable, though primary cancellation is via Stop button
        },
        async (progress, progressToken) => { // progressToken is from withProgress
          // Link the progressToken with the sidebarCancellationToken if provided
          // This allows cancelling via VS Code's progress UI as well, if desired.
          if (cancellationToken) {
            cancellationToken.onCancellationRequested(() => {
              sidebarProvider.cancelCurrentRequest(); // Trigger our main cancellation
            });
          }
          // Also, if progressToken is cancelled (e.g., user clicks cancel on notification)
          progressToken.onCancellationRequested(() => {
            sidebarProvider.cancelCurrentRequest(); // Trigger our main cancellation
          });

          const abortController = new AbortController();
          if (cancellationToken) {
            const disposable = cancellationToken.onCancellationRequested(() => {
              console.log("Cancellation requested via sidebar token.");
              abortController.abort();
              disposable.dispose(); 
            });
          }


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

            console.log("[suggestTestCaseCommand] Value of 'prompt' variable before calling callGenerativeApi:", prompt);
            console.log("[suggestTestCaseCommand] Conversation history before calling callGenerativeApi:", JSON.stringify(conversationHistory, null, 2));

            // Call the Gemini API (callGenerativeApi now returns an object)
            const { responseText, llmInputPayload } = await callGenerativeApi(prompt, conversationHistory, abortController.signal);
            const responseTokenCount = Math.ceil(responseText.length / 4); // Estimate response token count
            
            // Estimate token count for the entire input payload sent to LLM
            // The llmInputPayload is the `messages` array.
            const totalInputTokens = Math.ceil(JSON.stringify(llmInputPayload).length / 4);

            // Display the response
            sidebarProvider.addResponse(responseText, responseTokenCount, totalInputTokens);
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.log("Fetch request aborted.");
              // SidebarProvider.cancelCurrentRequest already posts 'requestCancelled'
              // No need to show error message for user-initiated cancellation.
            } else {
              vscode.window.showErrorMessage(
                `Error generating test suggestions: ${error}`
              );
            }
          } finally {
            sidebarProvider.finalizeRequest(); // Clean up CancellationTokenSource in SidebarProvider
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
      if (sidebarProvider.getSourceFiles().length === 0) {
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

  // Return the user's message as the base for RAG query and initial prompt
  return userMessage;
}

// Define interface for the API response
interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string; // OpenAI/OpenRouter format
    };
  }>;
}

// Gemini API specific interfaces
interface GeminiPart {
  text: string;
}

interface GeminiContent {
  parts: GeminiPart[];
  role: "user" | "model";
}

interface GeminiResponseCandidate {
  content: GeminiContent;
  finishReason?: string;
  index?: number;
  safetyRatings?: Array<{ category: string; probability: string }>;
}

interface GeminiApiResponse {
  candidates: GeminiResponseCandidate[];
  promptFeedback?: any;
}


// Unified ChatMessage interface (used for history)
interface ChatMessage {
  role: "system" | "user" | "assistant"; // "assistant" maps to "model" for Gemini
  content: string;
}

// This function will now use RAG for better context and call the Gemini API
async function callGenerativeApi(
  prompt: string, // This is the original user query from the sidebar
  conversationHistory: ChatMessage[] = [],
  abortSignal?: AbortSignal
): Promise<{ responseText: string; llmInputPayload: GeminiContent[] }> { // llmInputPayload is now GeminiContent[]
  const config = vscode.workspace.getConfiguration("tddAICompanion");
  const geminiApiKey = config.get("geminiApiKey") as string;

  if (!geminiApiKey) {
    throw new Error(
      "Gemini API key not found. Please set it in TDD AI Companion extension settings."
    );
  }

  console.log("--- RAG Debugging Start ---");
  console.log("[RAG Components] Initial User Query (prompt):", prompt);
  const currentFeature = sidebarProvider.getCurrentFeature();
  console.log("[RAG Components] Current Feature:", currentFeature);

  let enhancedPromptContent = prompt; // Start with the original query

  try {
    // Ensure config is available in this scope if not already
    // const config = vscode.workspace.getConfiguration("tddAICompanion"); 
    const pineconeApiKey = config.get("pineconeApiKey") as string;

    if (pineconeApiKey) {
      console.log("[RAG Components] Pinecone configured. Attempting to retrieve relevant code chunks...");
      const relevantChunks = await ragService.retrieveRelevantCode(prompt); // Use original query for retrieval
      
      if (relevantChunks.length > 0) {
        console.log(`[RAG Components] Found ${relevantChunks.length} relevant code chunks.`);
        // Log the content of relevantChunks, stringified for better readability in console
        console.log("[RAG Components] Embedding-derived Context (relevantChunks):", JSON.stringify(relevantChunks, null, 2));
        
        enhancedPromptContent = ragService.augmentPromptWithCodeContext(
          prompt, // Original query
          currentFeature,
          relevantChunks
        );
        console.log("[RAG Components] Instruction: is part of the structure provided by augmentPromptWithCodeContext.");
        console.log("[RAG Components] Prompt has been enhanced with RAG context.");
      } else {
        console.log("[RAG Components] No relevant chunks found. Proceeding with original query.");
        // enhancedPromptContent remains the original 'prompt'
      }
    } else {
      console.log("[RAG Components] Pinecone not configured, skipping RAG enhancement. Proceeding with original query.");
      // enhancedPromptContent remains the original 'prompt'
    }
  } catch (error) {
    console.warn("[RAG Components] RAG enhancement failed. Proceeding with original query. Error:", error);
    // enhancedPromptContent remains the original 'prompt'
  }

  console.log("[RAG Components] Final Enhanced Prompt Content to be sent to LLM:", enhancedPromptContent);
  console.log("--- RAG Debugging End ---");

  try {
    // Transform conversation history and current prompt to Gemini's `contents` format
    const contents: GeminiContent[] = conversationHistory.map(chatMessage => ({
      role: chatMessage.role === "assistant" ? "model" : "user", // Map 'assistant' to 'model'
      parts: [{ text: chatMessage.content }],
    }));

    // Add current user's turn (with potentially enhanced prompt)
    contents.push({
      role: "user",
      parts: [{ text: enhancedPromptContent }],
    });
    
    console.log("Full 'contents' array being sent to Gemini API:", JSON.stringify(contents, null, 2));

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${geminiApiKey}`;

    const response = await fetch(geminiApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contents }), // Send the 'contents' array
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error("Gemini API Error Response:", errorData);
      throw new Error(
        `Gemini API error: ${response.status} - ${errorData.error?.message || JSON.stringify(errorData)}`
      );
    }

    const data = (await response.json()) as GeminiApiResponse;

    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content || !data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
      console.error("Invalid response structure from Gemini API:", data);
      throw new Error("Invalid or empty response from Gemini API.");
    }
    
    const responseText = data.candidates[0].content.parts[0].text;
    return { responseText, llmInputPayload: contents }; // Return the 'contents' sent as llmInputPayload

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    // Send a message to the webview indicating generation failure
    if (sidebarProvider) { // Use sidebarProvider directly
        sidebarProvider.addResponse("AI failed to generate a response."); // Use addResponse
    }
    throw new Error(
      `Failed to get test suggestions from Gemini API: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Remove callCustomLLM as it's no longer configured
// async function callCustomLLM(messages: ChatMessage[], abortSignal?: AbortSignal): Promise<string> { ... }

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
