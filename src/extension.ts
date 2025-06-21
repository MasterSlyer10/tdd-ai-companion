import * as vscode from "vscode";
import * as path from "path";
import { SidebarProvider } from "./SidebarProvider";
import { RAGService } from "./ragService";
import { LoggingService } from "./loggingService";
import { SUPPORTED_EXTENSIONS } from "./codeParser";

let sidebarProvider: SidebarProvider;
let ragService: RAGService;
let loggingService: LoggingService;
let typingTimeout: NodeJS.Timeout | undefined;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log("TDD AI Companion is now active!");

  // Initialize the logging service
  loggingService = new LoggingService(context);

  // Initialize the RAG service
  ragService = new RAGService();

  // Initialize the sidebar
  sidebarProvider = new SidebarProvider(context.extensionUri, context, ragService, loggingService);
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
    async (userMessage: string, cancellationToken?: vscode.CancellationToken, promptId?: string) => { // Accept promptId
      console.log("[suggestTestCaseCommand] START. Received userMessage:", userMessage, "with promptId:", promptId); // Log the incoming message
      // Debug
      console.log(sidebarProvider.getCurrentFeature());
      console.log(sidebarProvider.getSourceFiles());      // Check if setup was done
      if (sidebarProvider.getSourceFiles().length === 0) {
        vscode.window.showErrorMessage("Please select source files in the setup before generating test suggestions.");
        return;
      }
      // Check if test files are selected
      if (sidebarProvider.getTestFiles().length === 0) {
        vscode.window.showErrorMessage("Please select test files in the setup before generating test suggestions.");
        return;
      }
      // Check if feature is defined
      if (!sidebarProvider.getCurrentFeature()) {
        // Show a specific message about the missing feature
        const defineFeature = "Define Feature";
        const result = await vscode.window.showErrorMessage(
          "No feature is currently defined. Please define a feature you want to test.", 
          defineFeature
        );
        
        // If user clicked the button to define a feature
        if (result === defineFeature) {
          // Use the helper method to prompt for feature
          const featureDefined = await sidebarProvider.promptForFeature();
          
          // If feature was successfully defined, proceed with the original request
          if (featureDefined) {
            vscode.commands.executeCommand(
              "tdd-ai-companion.suggestTestCase",
              userMessage,
              cancellationToken,
              promptId
            );
          }
        }
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating test suggestions...",
          cancellable: true, // Make progress cancellable, though primary cancellation is via Stop button
        },        async (progress, progressToken) => { // progressToken is from withProgress
          // Generate a unique query ID for this interaction
          const queryId = promptId || `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
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
          let sidebarTokenDisposable: vscode.Disposable | undefined;
          let progressTokenDisposable: vscode.Disposable | undefined;

          if (cancellationToken) {
            sidebarTokenDisposable = cancellationToken.onCancellationRequested(() => {
              console.log("Cancellation requested via sidebar token.");
              abortController.abort();
              // No need to dispose sidebarTokenDisposable here, it's done in finally
            });
          }
          // Also, if progressToken is cancelled (e.g., user clicks cancel on notification)
          progressTokenDisposable = progressToken.onCancellationRequested(() => {
            console.log("Cancellation requested via progress token.");
            sidebarProvider.cancelCurrentRequest(); // Trigger our main cancellation
            // No need to dispose progressTokenDisposable here, it's done in finally
          });          try {
            // Log the chat query
            await loggingService.logChatQuerySent(
              queryId,
              userMessage,
              'suggest_test_button', // This comes from the suggest test button
              queryId // Use queryId as suggestionId for linking
            );

            // Add the user message to history before making the API call
            sidebarProvider.addUserMessage(userMessage);

            // Check if cancellation was already requested before we start
            if (abortController.signal.aborted) {
              console.log("[suggestTestCaseCommand] Request was already cancelled before fetching content");
              return;
            }

            // Get currently open file (still useful for general context, not RAG)
            let currentFileContext = "";
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
              const fileName = path.basename(activeEditor.document.fileName);
              currentFileContext = `Currently open file: ${fileName}\n${activeEditor.document.getText()}`;
            }

            // The base prompt for the LLM is now just the user message
            const basePrompt = userMessage;

            // Get conversation history
            const conversationHistory =
              sidebarProvider.getConversationHistory();

            // --- NEW CODE TO GATHER TDD PROMPT TEMPLATE DATA ---
            const originalPrompt = userMessage; // The user's query is the original prompt
            const feature = sidebarProvider.getCurrentFeature();
            const sourceFiles = sidebarProvider.getSourceFiles();
            const testFiles = sidebarProvider.getTestFiles();

            const formattedSourceCode = await formatCodeFilesToJson(sourceFiles);
            const formattedTestCode = await formatCodeFilesToJson(testFiles);
            // --- END NEW CODE ---

            console.log("[suggestTestCaseCommand] Value of 'basePrompt' variable before calling callGenerativeApi:", basePrompt);
            console.log("[suggestTestCaseCommand] Conversation history before calling callGenerativeApi:", JSON.stringify(conversationHistory, null, 2));

            console.log("[suggestTestCaseCommand] Calling callGenerativeApi...");
            // Check for cancellation before making API call
            if (abortController.signal.aborted) {
              console.log("[suggestTestCaseCommand] Request cancelled before API call");
              return;
            }

            // Call the Gemini API with streaming (callGenerativeApi now returns an object)
            // The RAG logic is now inside callGenerativeApi
            const { responseText, llmInputPayload } = await callGenerativeApi(
              basePrompt,
              conversationHistory,
              abortController.signal,
              promptId,
              originalPrompt, // Pass new parameters
              feature,
              formattedSourceCode,
              formattedTestCode
            ); // Pass promptId

            console.log("[suggestTestCaseCommand] callGenerativeApi returned.");
            // Check if cancelled after API call completed
            if (abortController.signal.aborted) {
              console.log("[suggestTestCaseCommand] Request was cancelled during or after API call");
              return; // Don't process the response if cancelled
            }

            // The responses are now streamed directly to the webview, but we still need to:
            // 1. Save the complete response to the conversation history
            // 2. Tell the sidebar provider to finalize/update any state

            // We don't need to call addResponse here as the chunks have been sent directly,
            // but we do need to inform the sidebar about response metrics
            const responseTokenCount = Math.ceil(responseText.length / 4);
            const totalInputTokens = Math.ceil(JSON.stringify(llmInputPayload).length / 4);            // Update the conversation history with the complete response
            // Only if not cancelled
            if (!abortController.signal.aborted) {
              // Log the chat response
              await loggingService.logChatResponseReceived(
                queryId,
                responseText,
                responseTokenCount,
                totalInputTokens
              );

              // Log the suggestion provided
              await loggingService.logSuggestionProvided(
                queryId, // Use queryId as suggestionId
                'suggest_test_button',
                responseText,
                {
                  feature: sidebarProvider.getCurrentFeature(),
                  sourceFiles: sidebarProvider.getSourceFiles().map(f => f.fsPath),
                  testFiles: sidebarProvider.getTestFiles().map(f => f.fsPath),
                  tokenCount: responseTokenCount + totalInputTokens
                }
              );

              sidebarProvider.updateLastResponse(responseText, responseTokenCount, totalInputTokens, promptId); // Pass promptId
            }
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.log("[suggestTestCaseCommand] Fetch request aborted successfully.");
              // The SidebarProvider's cancelCurrentRequest already posts 'requestCancelled'
              // message to the webview, which updates the UI. No need for an extra message here.
            } else {
              console.error("[suggestTestCaseCommand] Error during generation:", error);
              vscode.window.showErrorMessage(
                `Error generating test suggestions: ${error instanceof Error ? error.message : String(error)}`
              );
              // Also inform the webview about the failure
              if (sidebarProvider && sidebarProvider._view) {
                 sidebarProvider._view.webview.postMessage({ command: "generationFailed" });
              }
            }
          } finally {
            console.log("[suggestTestCaseCommand] Finalizing request.");
            // Dispose listeners
            sidebarTokenDisposable?.dispose();
            progressTokenDisposable?.dispose(); // Use ?. for safety
            // Clean up CancellationTokenSource in SidebarProvider
            sidebarProvider.finalizeRequest();
            console.log("[suggestTestCaseCommand] END.");
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
          sidebarProvider.updateTestFiles(files); // Corrected: call updateTestFiles
        }
      }
    )
  );

  // Select test file command (called from webview)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tdd-ai-companion.selectTestFile",
      async (filePath: string) => {
        sidebarProvider.addTestFile(vscode.Uri.file(filePath));
      }
    )
  );

  // Deselect test file command (called from webview)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tdd-ai-companion.deselectTestFile",
      async (filePath: string) => {
        sidebarProvider.removeTestFile(vscode.Uri.file(filePath));
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

  // Prompt for feature command
  const promptFeatureCommand = vscode.commands.registerCommand(
    "tdd-ai-companion.promptFeature",
    async () => {
      await sidebarProvider.promptForFeature();
    }
  );
  context.subscriptions.push(promptFeatureCommand);

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
      const testFiles = sidebarProvider.getSourceFiles();

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
  abortSignal?: AbortSignal,
  promptId?: string, // Accept promptId
  originalPrompt?: string, // The original user query for the TDD prompt template
  feature?: string, // The feature being developed for the TDD prompt template
  formattedSourceCode?: string, // Formatted source code for the TDD prompt template
  formattedTestCode?: string // Formatted test code for the TDD prompt template
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
    // Check for cancellation before starting RAG process
    if (abortSignal && abortSignal.aborted) {
      console.log("[RAG Components] Request cancelled before starting RAG process");
      throw new Error("Request cancelled");
    }

    // Ensure config is available in this scope if not already
    // const config = vscode.workspace.getConfiguration("tddAICompanion"); 
    const pineconeApiKey = config.get("pineconeApiKey") as string;

    if (pineconeApiKey) {
      console.log("[RAG Components] Pinecone configured. Attempting to retrieve relevant code chunks...");
      // Pass abort signal to the RAG service
      const relevantChunks = await ragService.retrieveRelevantCode(prompt, 15, abortSignal); // Use original query for retrieval
      
      // Check if the request was cancelled during retrieval
      if (abortSignal && abortSignal.aborted) {
        console.log("[RAG Components] Request cancelled during code retrieval");
        throw new Error("Request cancelled");
      }
      
      if (relevantChunks.sourceCode.length > 0 || relevantChunks.testCode.length > 0) {
        console.log(`[RAG Components] Found ${relevantChunks.sourceCode.length} source code chunks and ${relevantChunks.testCode.length} test code chunks.`);
        // Log the content of relevantChunks, stringified for better readability in console
        console.log("[RAG Components] Embedding-derived Source Code Context:", JSON.stringify(relevantChunks.sourceCode, null, 2));
        console.log("[RAG Components] Embedding-derived Test Code Context:", JSON.stringify(relevantChunks.testCode, null, 2));
        
        enhancedPromptContent = await ragService.augmentPromptWithCodeContext(
          prompt, // Original query
          currentFeature,
          relevantChunks.sourceCode, // Pass source code chunks
          relevantChunks.testCode // Pass test code chunks
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

    // Construct the system instruction dynamically
    const tddSystemInstruction = `You MUST ALWAYS structure your response in exactly two sections:

1. ALWAYS begin with '**Thinking:**' followed by your detailed analysis, reasoning process, and considerations. This section is REQUIRED in every response and should contain at least 100 words showing your reasoning process. Never skip this section.

2. Then ALWAYS follow with '**Answer:**' and format your answer with clear headings, bullet points, and code blocks as appropriate. Make this section well-structured and easy to read.

Ensure code examples are properly formatted in markdown code blocks with the appropriate language specified. Both sections are mandatory for every response. Do not deviate from this format. Do not include any meta-commentary about the format itself. Also if possible when the user asks for a follow up question regarding the response try to accomodate what asks as long as it isn't doesnt have to do anything with actually displaying code but more so on clarifications on the suggestion

You are a Test-Driven Development (TDD) agent designed to guide users through the TDD process step by step. Your task is to analyze the provided source code and test code, then suggest **one meaningful test case** that hasn't been written yet.

In every response, do the following:

1. **State what needs to be tested** — Be clear and specific.
2. **Explain why this test is necessary** — Is it for correctness, input validation, edge case, etc.?
3. **Give a natural-language example** of input and expected output (no code).
4. **Indicate where the user is in the TDD cycle** (e.g., writing test, implementation, refactoring).
5. **Always ask a follow-up question** to guide the next step. This is mandatory. Keep the user engaged in the TDD flow.

Constraints:
- Suggest **only one test case** at a time.
- Do **not include code or JSON** in your output.
- Use only the 'Relevant Source Code' when suggesting tests.
- Use the 'Relevant Test Code' section only to avoid duplicates.
- Keep your response conversational and helpful.

---

User Query:  
${originalPrompt || 'N/A'}

Feature Being Developed:  
${feature || 'N/A'}

Relevant Source Code:  
\`\`\`json  
${formattedSourceCode || 'N/A'}  
\`\`\`

Relevant Test Code (for context only — do not repeat tests already written):  
\`\`\`json  
${formattedTestCode || 'N/A'}  
\`\`\`
`;

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: tddSystemInstruction }]
      }
    };

    // Use the streaming endpoint instead of generateContent
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:streamGenerateContent?alt=sse&key=${geminiApiKey}`;

    const response = await fetch(geminiApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody), // Send the contents array and system instruction
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error("Gemini API Error Response:", errorData);
      throw new Error(
        `Gemini API error: ${response.status} - ${errorData.error?.message || JSON.stringify(errorData)}`
      );
    }

    // Process the SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get stream reader from response");
    }

    let responseText = "";
    let firstChunk = true;
    let decoder = new TextDecoder();
    let buffer = "";
    
    // Add initial message to UI before starting the stream
    if (sidebarProvider && sidebarProvider._view) {
      sidebarProvider._view.webview.postMessage({
        command: "startResponseStream",
        promptId: promptId // Include the promptId
      });
    }

    try {
      // Read chunks from the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("[SSE Debug] Stream reading complete");
          break;
        }

        // Decode the chunk and add it to our buffer
        const newText = decoder.decode(value, { stream: true });
        buffer += newText;
        console.log("[SSE Debug] Raw chunk received:", newText);
        
        // Process complete SSE messages from the buffer
        let processedBuffer = processSSEBuffer(buffer);
        console.log("[SSE Debug] Processed buffer, found", processedBuffer.messages.length, "complete messages");
        console.log("[SSE Debug] Remaining buffer:", processedBuffer.remaining);
        buffer = processedBuffer.remaining;
        
        // For each complete message, handle it
        for (const data of processedBuffer.messages) {
          console.log("[SSE Debug] Processing message:", data);
          if (data === '[DONE]') {
            console.log("[SSE Debug] Received [DONE] message");
            continue; // Skip [DONE] messages
          }
          
          try {
            const parsedData = JSON.parse(data);
            console.log("[SSE Debug] Successfully parsed JSON data");
            
            if (parsedData.candidates && 
                parsedData.candidates[0] && 
                parsedData.candidates[0].content && 
                parsedData.candidates[0].content.parts && 
                parsedData.candidates[0].content.parts[0] && 
                parsedData.candidates[0].content.parts[0].text) {
              
              const chunkContent = parsedData.candidates[0].content.parts[0].text;
              console.log("[SSE Debug] Extracted chunk content:", chunkContent);
              
              // Append to the full response
              responseText += chunkContent;
              
              // Send the chunk to the webview
              if (sidebarProvider && sidebarProvider._view) {
                console.log("[SSE Debug] Sending chunk to webview, isFirstChunk:", firstChunk, "PromptId:", promptId);
                sidebarProvider._view.webview.postMessage({
                  command: "appendResponseChunk",
                  chunk: chunkContent,
                  isFirstChunk: firstChunk,
                  promptId: promptId // Include the promptId
                });
                firstChunk = false;
              }
            } else {
              console.log("[SSE Debug] Message doesn't contain expected content structure:", parsedData);
            }
          } catch (e) {
            console.error("[SSE Debug] Error parsing SSE message JSON:", e, data);
          }
        }
      }

      // Final decoding to catch any remaining text
      buffer += decoder.decode();
      console.log("[SSE Debug] Final buffer after stream completion:", buffer);
      let processedBuffer = processSSEBuffer(buffer);
      console.log("[SSE Debug] Final processing found", processedBuffer.messages.length, "messages");

      // Process any remaining complete messages
      for (const data of processedBuffer.messages) {
        if (data === '[DONE]') {
          console.log("[SSE Debug] Skipping final [DONE] message");
          continue;
        }

        try {
          const parsedData = JSON.parse(data);
          console.log("[SSE Debug] Parsed final message JSON");

          if (parsedData.candidates &&
              parsedData.candidates[0] &&
              parsedData.candidates[0].content &&
              parsedData.candidates[0].content.parts &&
              parsedData.candidates[0].content.parts[0] &&
              parsedData.candidates[0].content.parts[0].text) {

            const chunkContent = parsedData.candidates[0].content.parts[0].text;
            console.log("[SSE Debug] Final chunk content:", chunkContent);

            // Append to the full response
            responseText += chunkContent;

            // Send the chunk to the webview
            if (sidebarProvider && sidebarProvider._view) {
              console.log("[SSE Debug] Sending final chunk to webview");
              sidebarProvider._view.webview.postMessage({
                command: "appendResponseChunk",
                chunk: chunkContent,
                isFirstChunk: firstChunk,
                promptId: promptId // Include the promptId
              });
              firstChunk = false;
            }
          } else {
            console.log("[SSE Debug] Final message doesn't contain expected structure:", parsedData);
          }
        } catch (e) {
          console.error("[SSE Debug] Error parsing final SSE message JSON:", e, data);
        }
      }    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log("Stream reading aborted");
        // Don't send any more messages to the webview for aborted requests
        // We'll let the outer try/catch handle this by checking the cancellation flag
        throw error; // Re-throw AbortError to be caught in the outer catch block
      }
      console.error("Error reading stream:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Error reading stream: ${errorMessage}`);
    } finally {
      // Only send the completion message if we weren't cancelled
      // Check if the abort signal was triggered
      if (!(abortSignal && abortSignal.aborted)) {
        // Send a message to indicate the stream is complete
        if (sidebarProvider && sidebarProvider._view) {
          sidebarProvider._view.webview.postMessage({
            command: "endResponseStream",
            fullResponse: responseText,
            promptId: promptId // Include the promptId
          });
        }
      } else {
        console.log("Stream was aborted, not sending endResponseStream command");
      }
    }

    // Estimate response token count
    const responseTokenCount = Math.ceil(responseText.length / 4);
    // Estimate token count for the entire input payload
    const totalInputTokens = Math.ceil(JSON.stringify(contents).length / 4);

    return { responseText, llmInputPayload: contents };  } catch (error) {
    // Check if it's an abort error (cancellation)
    if (error instanceof Error && error.name === 'AbortError') {
      console.log("API call aborted due to cancellation");
      // Don't show any error messages for deliberate cancellations
      throw error; // Re-throw so the calling code knows it was cancelled
    }
    
    console.error("Error calling Gemini API:", error);
    
    // Only send a failure message if it wasn't a cancellation
    if (sidebarProvider && !(abortSignal && abortSignal.aborted)) {
        sidebarProvider.addResponse("AI failed to generate a response."); 
    }
    
    throw new Error(
      `Failed to get test suggestions from Gemini API: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Helper function to process SSE buffer into complete messages
function processSSEBuffer(buffer: string): { messages: string[], remaining: string } {
  console.log("[SSE Debug] Processing buffer:", buffer);
  const result: string[] = [];
  const lines = buffer.split('\n');
  console.log("[SSE Debug] Split into", lines.length, "lines");
  let remaining = '';
  let currentMessage = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    console.log(`[SSE Debug] Processing line ${i}: "${line}"`);
    
    // Empty line marks the end of a message
    if (line === '') {
      if (currentMessage) {
        console.log(`[SSE Debug] End of message found, adding to results: "${currentMessage}"`);
        result.push(currentMessage);
        currentMessage = '';
      }
      continue;
    }
    
    // Lines starting with "data:" contain the message data
    if (line.startsWith('data: ')) {
      console.log(`[SSE Debug] Found data line: "${line}"`);
      currentMessage = line.substring(6); // Remove "data: " prefix
    }
    // For the last line, if it's incomplete, add it to remaining
    else if (i === lines.length - 1) {
      console.log(`[SSE Debug] Last line is incomplete, adding to remaining: "${line}"`);
      remaining = line;
    }
    // Any other lines are ignored for now
    else {
      console.log(`[SSE Debug] Ignoring line: "${line}"`);
    }
  }
  
  // If we have a complete message at the end with no trailing newline
  if (currentMessage) {
    console.log(`[SSE Debug] Found complete message at end without newline: "${currentMessage}"`);
    result.push(currentMessage);
  }
  
  console.log(`[SSE Debug] Processed buffer. Found ${result.length} messages and remaining: "${remaining}"`);
  return { messages: result, remaining };
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
async function formatCodeFilesToJson(fileUris: vscode.Uri[]): Promise<string> {
  const fileContents: { [key: string]: string } = {};
  const decoder = new TextDecoder();

  for (const uri of fileUris) {
    try {
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = decoder.decode(contentBytes);
      fileContents[path.basename(uri.fsPath)] = content;
    } catch (error) {
      console.error(`Error reading file ${uri.fsPath}:`, error);
      // Continue to next file even if one fails
    }
  }
  return JSON.stringify(fileContents, null, 2);
}

export function deactivate() {
  // Dispose of the logging service
  if (loggingService) {
    loggingService.dispose();
  }
  
  // Dispose of the file system watcher
  // The watcher is automatically disposed when its containing extension is deactivated
  // because it was added to context.subscriptions.
  // checkAndClearIndexForNewProject(vscode.extensions.getExtension("tdd-ai-companion")?.extensionUri);
}
