import * as vscode from "vscode";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export interface CodeChunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  type: "function" | "method" | "class" | "other";
  name: string;
}

// Common programming language file extensions
export const SUPPORTED_EXTENSIONS = [
  // JavaScript/TypeScript
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  // Python
  ".py",
  ".pyw",
  // Java
  ".java",
  // C/C++
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  // C#
  ".cs",
  // Ruby
  ".rb",
  // Go
  ".go",
  // Rust
  ".rs",
  // PHP
  ".php",
  // Swift
  ".swift",
  // Kotlin
  ".kt",
  // Dart
  ".dart",
];

/**
 * Determines if a file is a supported code file based on its extension
 */
export function isSupportedFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(extension);
}

/**
 * Parses a file into chunks based on the appropriate strategy for its language
 */
export async function parseFileIntoChunks(
  filePath: string
): Promise<CodeChunk[]> {
  try {
    // Read the file content
    const content = fs.readFileSync(filePath, "utf-8");
    const extension = path.extname(filePath).toLowerCase();

    // Choose the chunking strategy based on file extension
    if ([".ts", ".js", ".tsx", ".jsx"].includes(extension)) {
      // Use TypeScript parser for TypeScript/JavaScript files
      return parseTypeScriptCode(filePath, content);
    } else {
      // For other languages, use a more generic regex-based or line-based approach
      return parseGenericCode(filePath, content);
    }
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return [];
  }
}

/**
 * Parses TypeScript/JavaScript code into function-level chunks using the TypeScript parser
 */
async function parseTypeScriptCode(
  filePath: string,
  content: string
): Promise<CodeChunk[]> {
  try {
    // Parse the file into an AST
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    // Extract function-level chunks
    const chunks: CodeChunk[] = [];
    extractFunctions(sourceFile, content, filePath, chunks);

    // If no functions were found, fall back to the generic approach
    if (chunks.length === 0) {
      return parseGenericCode(filePath, content);
    }

    return chunks;
  } catch (error) {
    console.error(`Error parsing TypeScript file ${filePath}:`, error);
    return parseGenericCode(filePath, content);
  }
}

/**
 * Extracts functions from a TypeScript AST
 */
function extractFunctions(
  node: ts.Node,
  sourceText: string,
  filePath: string,
  chunks: CodeChunk[]
): void {
  // Handle function declarations
  if (ts.isFunctionDeclaration(node) && node.name) {
    const start = node.getStart();
    const end = node.getEnd();
    const pos = node.getStart();
    const lineAndChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      pos
    );
    const startLine = lineAndChar.line + 1;
    const endLineChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      end
    );
    const endLine = endLineChar.line + 1;
    const functionName = node.name.getText();

    chunks.push({
      id: `${filePath}:${functionName}:${startLine}`,
      content: sourceText.substring(start, end),
      filePath,
      startLine,
      endLine,
      type: "function",
      name: functionName,
    });
  }

  // Handle method declarations in classes
  if (ts.isMethodDeclaration(node) && node.name) {
    const start = node.getStart();
    const end = node.getEnd();
    const pos = node.getStart();
    const lineAndChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      pos
    );
    const startLine = lineAndChar.line + 1;
    const endLineChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      end
    );
    const endLine = endLineChar.line + 1;
    const methodName = node.name.getText();

    // Find parent class name if available
    let className = "";
    let parent: ts.Node | undefined = node.parent;
    while (parent) {
      if (ts.isClassDeclaration(parent) && parent.name) {
        className = parent.name.getText();
        break;
      }
      parent = parent.parent;
    }

    chunks.push({
      id: `${filePath}:${className}.${methodName}:${startLine}`,
      content: sourceText.substring(start, end),
      filePath,
      startLine,
      endLine,
      type: "method",
      name: className ? `${className}.${methodName}` : methodName,
    });
  }

  // Handle arrow functions with variable declarations
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    ts.isArrowFunction(node.initializer) &&
    node.name
  ) {
    const start = node.getStart();
    const end = node.getEnd();
    const pos = node.getStart();
    const lineAndChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      pos
    );
    const startLine = lineAndChar.line + 1;
    const endLineChar = ts.getLineAndCharacterOfPosition(
      node.getSourceFile(),
      end
    );
    const endLine = endLineChar.line + 1;
    const functionName = node.name.getText();

    chunks.push({
      id: `${filePath}:${functionName}:${startLine}`,
      content: sourceText.substring(start, end),
      filePath,
      startLine,
      endLine,
      type: "function",
      name: functionName,
    });
  }

  // Continue traversing the AST
  ts.forEachChild(node, (child) =>
    extractFunctions(child, sourceText, filePath, chunks)
  );
}

/**
 * Parses code in any language using a generic approach based on heuristics and regular expressions
 */
function parseGenericCode(filePath: string, content: string): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split("\n");
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();

  // Common patterns to identify functions/methods across different languages
  const functionPatterns: { [key: string]: RegExp[] } = {
    // Generic patterns
    generic: [
      /\b(?:function|def|func|fn|sub|method|procedure)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)/,
      /\b(?:public|private|protected|static|final)\s+(?:[\w<>\[\]]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)/,
    ],
    // Python
    ".py": [
      /\bdef\s+([a-zA-Z0-9_]+)\s*\([^)]*\):/,
      /\bclass\s+([a-zA-Z0-9_]+)\s*(?:\([^)]*\))?:/,
    ],
    // Java
    ".java": [
      /\b(?:public|private|protected|static|final|abstract)?\s*(?:[\w<>\[\]]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/,
    ],
    // C/C++
    ".c": [/\b(?:[\w]+\s+)+([a-zA-Z0-9_]+)\s*\([^;]*\)\s*\{/],
    ".cpp": [
      /\b(?:[\w]+\s+)+([a-zA-Z0-9_]+)\s*\([^;]*\)\s*(?:const|override|final|noexcept)?\s*\{/,
    ],
    // Ruby
    ".rb": [/\bdef\s+([a-zA-Z0-9_?!]+)(?:\([^)]*\))?/],
  };

  // Choose patterns based on file extension or fall back to generic
  const patterns = functionPatterns[extension] || functionPatterns.generic;

  // Initialize variables to track potential functions
  let currentFunction: CodeChunk | null = null;
  let bracketCount = 0;
  let inFunction = false;
  let potentialFunctionStartLine = 0;

  // Loop through lines to identify functions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineIndex = i + 1;

    // Check for function definition patterns
    if (!inFunction) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const functionName = match[1] || `${fileName}_chunk_${lineIndex}`;
          potentialFunctionStartLine = lineIndex;
          currentFunction = {
            id: `${filePath}:${functionName}:${lineIndex}`,
            content: line,
            filePath,
            startLine: lineIndex,
            endLine: lineIndex,
            type: "function",
            name: functionName,
          };
          inFunction = true;
          bracketCount =
            (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

          // If the line contains opening and closing bracket, it might be a one-line function
          if (bracketCount === 0 && line.includes("{") && line.includes("}")) {
            chunks.push(currentFunction);
            currentFunction = null;
            inFunction = false;
          }

          break;
        }
      }
    } else {
      // Already tracking a function, add the line to it
      if (currentFunction) {
        currentFunction.content += "\n" + line;
        currentFunction.endLine = lineIndex;
      }

      // Update bracket count
      bracketCount += (line.match(/{/g) || []).length;
      bracketCount -= (line.match(/}/g) || []).length;

      // If brackets are balanced, we've reached the end of the function
      if (bracketCount <= 0) {
        if (currentFunction) {
          chunks.push(currentFunction);
        }
        currentFunction = null;
        inFunction = false;
      }
    }
  }

  // Add the last function if we're still tracking one
  if (currentFunction) {
    chunks.push(currentFunction);
  }

  // If no functions were detected, create chunks based on logical sections
  if (chunks.length === 0) {
    return createDefaultChunks(filePath, content);
  }

  return chunks;
}

/**
 * Creates default chunks for a file based on logical sections or line count
 */
function createDefaultChunks(filePath: string, content: string): CodeChunk[] {
  const fileName = path.basename(filePath);
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];

  // Define a reasonable chunk size
  const chunkSize = 50;
  const totalLines = lines.length;

  // Split content into chunks of reasonable size
  for (let i = 0; i < totalLines; i += chunkSize) {
    const endLine = Math.min(i + chunkSize, totalLines);
    const chunkContent = lines.slice(i, endLine).join("\n");

    chunks.push({
      id: `${filePath}:chunk_${i / chunkSize + 1}:${i + 1}`,
      content: chunkContent,
      filePath,
      startLine: i + 1,
      endLine,
      type: "other",
      name: `${fileName}_chunk_${i / chunkSize + 1}`,
    });
  }

  return chunks;
}

/**
 * Parse multiple files from an array of file URIs
 */
export async function parseFilesIntoChunks(
  files: vscode.Uri[]
): Promise<CodeChunk[]> {
  const allChunks: CodeChunk[] = [];
  let processedCount = 0;

  for (const file of files) {
    try {
      // Process the file if it's a supported code file
      if (isSupportedFile(file.fsPath)) {
        const chunks = await parseFileIntoChunks(file.fsPath);

        // DEBUG
        console.log(`File: ${file.fsPath} → ${chunks.length} chunks:`);
        chunks.forEach((chunk, index) => {
          console.log(
            `  [${index}] ${chunk.type} "${chunk.name}" (lines ${chunk.startLine}-${chunk.endLine})`
          );
        });

        allChunks.push(...chunks);

        // Log progress occasionally
        processedCount++;
        if (processedCount % 5 === 0 || processedCount === files.length) {
          console.log(
            `Processed ${processedCount}/${files.length} files, found ${allChunks.length} code chunks so far`
          );
        }
      } else {
        console.log(`Skipping unsupported file: ${file.fsPath}`);
      }
    } catch (error) {
      console.error(`Error processing file ${file.fsPath}:`, error);
    }
  }

  // Add this debug summary at the end
  console.log(`=== CHUNKING SUMMARY ===`);
  console.log(`Total chunks generated: ${allChunks.length}`);

  const chunksByType = allChunks.reduce((acc, chunk) => {
    acc[chunk.type] = (acc[chunk.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Chunks by type:`, chunksByType);

  return allChunks;
}
