import * as vscode from "vscode";
import { CodeChunk, parseFilesIntoChunks } from "./codeParser";
import { EmbeddingService } from "./embeddingService";
import { analyzeTestFiles } from "./testAnalyzer";

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
  public async augmentPromptWithCodeContext(
    originalPrompt: string,
    feature: string,
    sourceCodeChunks: CodeChunk[],
    testCodeChunks: CodeChunk[]
  ): Promise<string> {
    const untestedFunctions = await this.getUntestedFunctions();

    // Filter sourceCodeChunks to only include chunks whose name is in the untestedFunctions set.
    // For methods (e.g., Class.method), we check if either the full name or the class name is untested.
    const filteredSourceCodeChunks = sourceCodeChunks.filter(chunk => {
      if (untestedFunctions.has(chunk.name)) {
        return true;
      }
      if (chunk.type === 'method') {
        const classNameMatch = chunk.name.match(/^([a-zA-Z0-9_]+)\./);
        if (classNameMatch && untestedFunctions.has(classNameMatch[1])) {
          return true;
        }
      }
      return false;
    });

    // Helper to format chunks into a structured JSON
    const formatChunksToJson = (chunks: CodeChunk[], includeStructureAndHeaders: boolean = true) => {
      const codebaseJson: any = {
        codebase_structure: {},
        headers: {},
        code: {},
      };

      chunks.forEach((chunk) => {
        const filePath = chunk.filePath;
        const relativePath = this.getRelativePath(filePath);
        const parts = relativePath.split(/[\/\\]/); // Split by / or \
        const fileName = parts[parts.length - 1];
        const dirPath = parts.slice(0, -1);

        // Create the path and add the file (only if includeStructureAndHeaders is true)
        if (includeStructureAndHeaders) {
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

          // Initialize the file in headers if needed
          if (!codebaseJson.headers[fileName]) {
            codebaseJson.headers[fileName] = {
              functions: [],
              classes: {},
            };
          }
        }

        // Add function or method (only if includeStructureAndHeaders is true)
        if (includeStructureAndHeaders) {
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
        }

        // Extract code snippets (always include code)
        if (!codebaseJson.code[fileName]) {
          codebaseJson.code[fileName] = {};
        }
        codebaseJson.code[fileName][chunk.name] = chunk.content;
      });

      // If not including structure and headers, return only the code part
      if (!includeStructureAndHeaders) {
        return JSON.stringify({ code: codebaseJson.code }, null, 2);
      }

      return JSON.stringify(codebaseJson, null, 2);
    };

    const formattedSourceCode = formatChunksToJson(sourceCodeChunks, true); // Include structure and headers for source
    const formattedTestCode = formatChunksToJson(testCodeChunks, false); // Only include code for test

    // Format the final prompt with JSON
    return `You are a Test-Driven Development (TDD) agent designed to guide users through the TDD process step by step. Your task is to analyze the provided source code and test code, then suggest **one meaningful test case** that hasn't been written yet.

In every response, do the following:

1. **State what needs to be tested** — Be clear and specific.
2. **Explain why this test is necessary** — Is it for correctness, input validation, edge case, etc.?
3. **Give a natural-language example** of input and expected output (no code).
4. **Indicate where the user is in the TDD cycle** (e.g., writing test, implementation, refactoring).
5. **Always ask a follow-up question** to guide the next step. This is mandatory. Keep the user engaged in the TDD flow.

Constraints:
- Suggest **only one test case** at a time.
- Do **not include code or JSON** in your output.
- Use only the 'Untested Source Code' when suggesting tests.
- Use the 'Relevant Test Code' section only to avoid duplicates.
- Keep your response conversational and helpful.

---

User Query:  
${originalPrompt}

Feature Being Developed:  
${feature}

Untested Source Code:  
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

  /**
   * Identifies functions in source files that do not appear to have corresponding tests.
   * @returns A Set of strings, where each string is the name of an untested function.
   */
  private async getUntestedFunctions(): Promise<Set<string>> {
    // Find all relevant source code files
    const sourceFiles = await vscode.workspace.findFiles('src/**/*.{ts,js,py,java}', '**/node_modules/**');
    // Find all relevant test files
    const testFiles = await vscode.workspace.findFiles('src/test/**/*.{ts,js,py,java}', '**/node_modules/**');

    // Extract function/method/class names from source files
    const allSourceChunks = await parseFilesIntoChunks(sourceFiles);
    const sourceFunctionNames = new Set<string>();
    allSourceChunks.forEach(chunk => {
      if (chunk.type === 'function' || chunk.type === 'method' || chunk.type === 'class') {
        // For methods (e.g., Class.method), we add both 'Class.method' and 'Class' to cover both cases.
        sourceFunctionNames.add(chunk.name);
        const classNameMatch = chunk.name.match(/^([a-zA-Z0-9_]+)\./);
        if (classNameMatch) {
          sourceFunctionNames.add(classNameMatch[1]); // Add the class name itself
        }
      }
    });

    // Analyze test files to get names of functions that are tested
    const testedFunctionNames = analyzeTestFiles(testFiles.map(uri => uri.fsPath));

    // Determine which source functions are not covered by tests
    const untestedFunctions = new Set<string>();
    sourceFunctionNames.forEach(funcName => {
      if (!testedFunctionNames.has(funcName)) {
        untestedFunctions.add(funcName);
      }
    });

    return untestedFunctions;
  }
}
