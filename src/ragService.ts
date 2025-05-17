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

      // Parse code files into function-level chunks
      const chunks = await parseFilesIntoChunks(files);

      if (chunks.length === 0) {
        vscode.window.showWarningMessage(
          "No code chunks were found in the selected files."
        );
        this.isIndexing = false;
        return false;
      }

      vscode.window.showInformationMessage(
        `Parsed ${files.length} files into ${chunks.length} code chunks. Starting to store embeddings...`
      );

      // Store the chunks in the vector database
      await this.embeddingService.storeCodeChunks(chunks);

      vscode.window.showInformationMessage(
        `Successfully indexed ${chunks.length} code chunks from ${files.length} files.`
      );

      this.isIndexing = false;
      return true;
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
      await this.embeddingService.clearWorkspaceEmbeddings();
      return true;
    } catch (error) {
      console.error("Error clearing index:", error);
      vscode.window.showErrorMessage(`Failed to clear index: ${error}`);
      return false;
    }
  }

  /**
   * Retrieve relevant code chunks for a given query
   */
  public async retrieveRelevantCode(
    query: string,
    maxResults: number = 15,
    abortSignal?: AbortSignal
  ): Promise<CodeChunk[]> {
    try {
      // Check for cancellation before starting
      if (abortSignal && abortSignal.aborted) {
        console.log("RAGService: Retrieval cancelled before starting");
        return [];
      }
      
      return await this.embeddingService.querySimilarChunks(query, maxResults, abortSignal);
    } catch (error) {
      // Check if this was an abort error
      if (error instanceof Error && error.name === 'AbortError') {
        console.log("RAGService: Retrieval was cancelled");
        return [];
      }
      
      console.error("Error retrieving relevant code:", error);
      vscode.window.showErrorMessage(
        `Failed to retrieve relevant code: ${error}`
      );
      return [];
    }
  }

  /**
   * Augment a prompt with retrieved code context
   */
  public augmentPromptWithCodeContext(
    originalPrompt: string,
    feature: string,
    relevantChunks: CodeChunk[]
  ): string {
    if (relevantChunks.length === 0) {
      return originalPrompt;
    }

    // Create a structured JSON representation
    const codebaseJson: any = {
      codebase_structure: {},
      headers: {},
      code: {},
    };

    // Extract file paths and organize them into a directory structure
    const filePathMap = new Map<string, Set<string>>();
    relevantChunks.forEach((chunk) => {
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

      // Track file relationships
      if (!filePathMap.has(relativePath)) {
        filePathMap.set(relativePath, new Set<string>());
      }
    });

    // Extract headers (relationships between files)
    relevantChunks.forEach((chunk) => {
      const filePath = chunk.filePath;
      const relativePath = this.getRelativePath(filePath);
      const fileName = relativePath.split(/[\/\\]/).pop() || "";

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

      // For simplicity, we'll infer relationships based on imports in the future
      // This would require more advanced parsing
    });

    // Extract code snippets
    relevantChunks.forEach((chunk) => {
      const filePath = chunk.filePath;
      const relativePath = this.getRelativePath(filePath);
      const fileName = relativePath.split(/[\/\\]/).pop() || "";

      // Initialize the file in code if needed
      if (!codebaseJson.code[fileName]) {
        codebaseJson.code[fileName] = {};
      }

      // Add the code snippet with function/method name as key
      codebaseJson.code[fileName][chunk.name] = chunk.content;
    });

    // Format the final prompt with JSON
    return `Task:
You are a Test-Driven Development (TDD) agent. Your goal is to analyze the given code and suggest one essential test case to verify correctness, based on the user's query and the specified feature.

Response Requirements:
Your response must:

Clearly state what needs to be tested.

Explain why this test is necessary. (Focus on correctness, security, or edge cases.)

Provide an example input and expected output.

Constraints:
Only suggest one test case per response.

Focus on a specific functionality or edge case. (Avoid generic tests.)

Do not include any code or JSON. Only provide a clear, structured natural language description.

User Query for the Feature:
${originalPrompt}

Feature being developed:
${feature}

    Relevant codebase information:
    \`\`\`json
    ${JSON.stringify(codebaseJson, null, 2)}
    \`\`\``;
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
