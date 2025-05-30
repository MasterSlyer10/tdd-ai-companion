import * as vscode from "vscode";
import { CodeChunk, parseFilesIntoChunks } from "./codeParser";
import { EmbeddingService } from "./embeddingService";

/**
 * Service for handling Retrieval Augmented Generation (RAG) with code context
 */
export class RAGService {
  private embeddingService: EmbeddingService;
  private isIndexing: boolean = false;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  /**
   * Initialize the RAG service and make sure all dependencies are set up
   */
  public async initialize(): Promise<boolean> {
    return await this.embeddingService.initialize();
  }

  /**
   * Index all project code files by function level for RAG
   */
  public async indexProjectFiles(
    files: vscode.Uri[],
    progressCallback?: (progress: number, total: number) => void
  ): Promise<boolean> {
    if (this.isIndexing) {
      vscode.window.showWarningMessage(
        "Indexing is already in progress. Please wait for it to complete."
      );
      return false;
    }

    this.isIndexing = true;

    try {
      vscode.window.showInformationMessage(
        `Starting to index ${files.length} files...`
      );

      const sourceFiles: vscode.Uri[] = [];
      const testFiles: vscode.Uri[] = [];

      files.forEach((file) => {
        const relativePath = this.getRelativePath(file.fsPath);
        if (
          relativePath.includes("/test/") ||
          relativePath.endsWith(".test.ts") ||
          relativePath.endsWith(".spec.ts") ||
          relativePath.endsWith(".test.js") ||
          relativePath.endsWith(".spec.js")
        ) {
          testFiles.push(file);
        } else {
          sourceFiles.push(file);
        }
      });

      let success = true;

      if (sourceFiles.length > 0) {
        vscode.window.showInformationMessage(
          `Parsing ${sourceFiles.length} source files...`
        );
        const sourceChunks = await parseFilesIntoChunks(sourceFiles);
        if (sourceChunks.length > 0) {
          vscode.window.showInformationMessage(
            `Storing ${sourceChunks.length} source code embeddings...`
          );
          await this.embeddingService.storeCodeChunks(
            sourceChunks,
            "source_code"
          );
        } else {
          vscode.window.showWarningMessage(
            "No source code chunks were found in the selected files."
          );
          success = false;
        }
      }

      if (testFiles.length > 0) {
        vscode.window.showInformationMessage(
          `Parsing ${testFiles.length} test files...`
        );
        const testChunks = await parseFilesIntoChunks(testFiles);
        if (testChunks.length > 0) {
          vscode.window.showInformationMessage(
            `Storing ${testChunks.length} test code embeddings...`
          );
          await this.embeddingService.storeCodeChunks(testChunks, "test_code");
        } else {
          vscode.window.showWarningMessage(
            "No test code chunks were found in the selected files."
          );
          success = false;
        }
      }

      if (sourceFiles.length === 0 && testFiles.length === 0) {
        vscode.window.showWarningMessage(
          "No code files were found in the selected files."
        );
        success = false;
      } else if (success) {
        vscode.window.showInformationMessage(
          `Successfully indexed all relevant code chunks.`
        );
      }

      this.isIndexing = false;
      return success;
    } catch (error) {
      console.error("Error indexing project files:", error);
      vscode.window.showErrorMessage(
        `Failed to index project files: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.isIndexing = false;
      return false;
    }
  }

  /**
   * Clear all indexed files for the current workspace
   */
  public async clearIndex(): Promise<boolean> {
    try {
      // Clear both source_code and test_code namespaces
      await this.embeddingService.clearWorkspaceEmbeddings(); // This method clears all, so no need to specify namespace
      return true;
    } catch (error) {
      console.error("Error clearing index:", error);
      vscode.window.showErrorMessage(`Failed to clear index: ${error}`);
      return false;
    }
  }

  /**
   * Retrieve relevant code chunks for a given query from both source and test namespaces
   */
  public async retrieveRelevantCode(
    query: string,
    maxResults: number = 15,
    abortSignal?: AbortSignal
  ): Promise<{ sourceCode: CodeChunk[]; testCode: CodeChunk[] }> {
    try {
      // Check for cancellation before starting
      if (abortSignal && abortSignal.aborted) {
        console.log("RAGService: Retrieval cancelled before starting");
        return { sourceCode: [], testCode: [] };
      }

      // Retrieve source code snippets
      const sourceCode = await this.embeddingService.querySimilarChunks(
        query,
        maxResults,
        "source_code",
        abortSignal
      );

      // Retrieve test code snippets
      const testCode = await this.embeddingService.querySimilarChunks(
        query,
        maxResults,
        "test_code",
        abortSignal
      );

      return { sourceCode, testCode };
    } catch (error) {
      // Check if this was an abort error
      if (error instanceof Error && error.name === "AbortError") {
        console.log("RAGService: Retrieval was cancelled");
        return { sourceCode: [], testCode: [] };
      }

      console.error("Error retrieving relevant code:", error);
      vscode.window.showErrorMessage(
        `Failed to retrieve relevant code: ${error}`
      );
      return { sourceCode: [], testCode: [] };
    }
  }

  /**
   * Augment a prompt with retrieved code context
   */
  public augmentPromptWithCodeContext(
    originalPrompt: string,
    feature: string,
    sourceCodeChunks: CodeChunk[],
    testCodeChunks: CodeChunk[]
  ): string {
    // Helper to format chunks into a structured JSON
    const formatChunksToJson = (chunks: CodeChunk[]) => {
      const codebaseJson: any = {
        codebase_structure: {},
        headers: {},
        code: {},
      };

      chunks.forEach((chunk) => {
        const filePath = chunk.filePath;
        const relativePath = this.getRelativePath(filePath);
        const parts = relativePath.split(/[\/\\]/); // Split by / or \

        // Skip the file part (last part) to get the directory
        const dirPath = parts.slice(0, -1);
        const fileName = parts[parts.length - 1];

        // Create the path and add the file
        let currentObj = codebaseJson.codebase_structure;
        for (const part of dirPath) {
          if (!part) continue; // Skip empty parts
          if (!currentObj[part]) {
            currentObj[part] = {};
          }
          currentObj = currentObj[part];
        }

        // Add the file
        if (fileName) {
          currentObj[fileName] = "";
        }

        // Track file relationships (simplified for now)
        // if (!filePathMap.has(relativePath)) {
        //   filePathMap.set(relativePath, new Set<string>());
        // }

        // Initialize the file in headers if needed
        if (!codebaseJson.headers[fileName]) {
          codebaseJson.headers[fileName] = {
            functions: [],
            classes: {},
          };
        }

        // Add function or method
        if (chunk.type === "function") {
          if (!codebaseJson.headers[fileName].functions.includes(chunk.name)) {
            codebaseJson.headers[fileName].functions.push(chunk.name);
          }
        } else if (chunk.type === "method") {
          // Parse class name and method name
          const nameParts = chunk.name.split(".");
          if (nameParts.length === 2) {
            const className = nameParts[0];
            const methodName = nameParts[1];

            if (!codebaseJson.headers[fileName].classes[className]) {
              codebaseJson.headers[fileName].classes[className] = {
                methods: [],
                relationships: [],
              };
            }

            if (
              !codebaseJson.headers[fileName].classes[className].methods.includes(
                methodName
              )
            ) {
              codebaseJson.headers[fileName].classes[className].methods.push(
                methodName
              );
            }
          }
        }

        // Extract code snippets
        if (!codebaseJson.code[fileName]) {
          codebaseJson.code[fileName] = {};
        }
        codebaseJson.code[fileName][chunk.name] = chunk.content;
      });
      return JSON.stringify(codebaseJson, null, 2);
    };

    const formattedSourceCode = formatChunksToJson(sourceCodeChunks);
    const formattedTestCode = formatChunksToJson(testCodeChunks);

    // Format the final prompt with JSON
    return `You are a Test-Driven Development (TDD) agent. Your goal is to analyze the given source code and suggest one essential test case to verify correctness, based on the user's query and the specified feature.

Response Requirements:
- Clearly state what needs to be tested.
- Explain why this test is necessary (e.g., correctness, security, edge case).
- Provide an example input and expected output.
- Only suggest one test case per response.
- Avoid suggesting any tests that already exist in the test code provided.

Constraints:
- Do not include any code or JSON in your response.
- Focus on a specific functionality or edge case, not a generic test.
- When generating test suggestions, focus ONLY on the 'Relevant Source Code' section. The 'Relevant Test Code' section is provided for context to help you avoid suggesting duplicate tests.

User Query:
${originalPrompt}

Feature being developed:
${feature}

Relevant Source Code:
\`\`\`json
${formattedSourceCode}
\`\`\`

Relevant Test Code (for context only — do not repeat tests already written):
\`\`\`json
${formattedTestCode}
\`\`\`
`;
  }

  /**
   * Get the relative path from an absolute path
   */
  private getRelativePath(absolutePath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (
      workspaceFolder &&
      absolutePath.startsWith(workspaceFolder.uri.fsPath)
    ) {
      return absolutePath.substring(workspaceFolder.uri.fsPath.length + 1);
    }
    return absolutePath;
  }
}
