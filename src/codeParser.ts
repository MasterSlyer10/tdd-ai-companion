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

  const functionPatterns: { [key: string]: { functions: RegExp[]; classes: RegExp[] } } = {
    // Generic patterns
    generic: {
      functions: [
        /\b(?:function|def|func|fn|sub|method|procedure)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)/,
        /\b(?:public|private|protected|static|final)\s+(?:[\w<>\[\]]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)/,
      ],
      classes: [
        /\bclass\s+([a-zA-Z0-9_]+)(?:\s+(?:extends|implements)\s+[a-zA-Z0-9_,\s<>]+)?\s*\{?/,
      ],
    },
    // Python
    ".py": {
      functions: [/\bdef\s+([a-zA-Z0-9_]+)\s*\([^)]*\):/],
      classes: [/\bclass\s+([a-zA-Z0-9_]+)\s*(?:\([^)]*\))?:/],
    },
    // Java
    ".java": {
      functions: [
        /\b(?:public|private|protected|static|final|abstract)?\s*(?:[\w<>\[\]]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/,
      ],
      classes: [
        /\b(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+([a-zA-Z0-9_]+)(?:\s+(?:extends|implements)\s+[a-zA-Z0-9_,\s<>]+)?\s*\{/,
      ],
    },
    // C/C++
    ".cpp": {
      functions: [
        /\b(?:[\w]+\s+)+([a-zA-Z0-9_]+)\s*\([^;]*\)\s*(?:const|override|final|noexcept)?\s*\{/,
      ],
      classes: [
        /\b(?:class|struct)\s+([a-zA-Z0-9_]+)(?:\s*:\s*(?:public|private|protected)\s+[a-zA-Z0-9_]+)?\s*\{/,
      ],
    },
    // Ruby
    ".rb": {
      functions: [/\bdef\s+([a-zA-Z0-9_?!]+)(?:\([^)]*\))?/],
      classes: [/\bclass\s+([a-zA-Z0-9_]+)(?:\s*<\s*[a-zA-Z0-9_:]+)?/],
    },
  };

  // Choose patterns based on file extension or fall back to generic
  const patterns = functionPatterns[extension] || functionPatterns.generic;

  // If this is a Python file, use the Python-specific approach
  if (extension === ".py" || extension === ".pyw") {
    return parsePythonCode(filePath, content, patterns);
  }

  // Initialize variables to track potential functions and classes
  let currentChunk: CodeChunk | null = null;
  let bracketCount = 0;
  let inChunk = false;
  let potentialStartLine = 0;

  // Loop through lines to identify functions and classes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineIndex = i + 1;

    // Check for class or function definition patterns when not already tracking a chunk
    if (!inChunk) {
      // First check for class patterns
      let isClass = false;
      for (const pattern of patterns.classes) {
        const match = line.match(pattern);
        if (match) {
          const className = match[1] || `${fileName}_class_${lineIndex}`;
          potentialStartLine = lineIndex;
          currentChunk = {
            id: `${filePath}:${className}:${lineIndex}`,
            content: line,
            filePath,
            startLine: lineIndex,
            endLine: lineIndex,
            type: "class",
            name: className,
          };
          inChunk = true;
          isClass = true;
          bracketCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
          break;
        }
      }

      // If no class was found, check for function patterns
      if (!isClass) {
        for (const pattern of patterns.functions) {
          const match = line.match(pattern);
          if (match) {
            const functionName = match[1] || `${fileName}_function_${lineIndex}`;
            potentialStartLine = lineIndex;
            currentChunk = {
              id: `${filePath}:${functionName}:${lineIndex}`,
              content: line,
              filePath,
              startLine: lineIndex,
              endLine: lineIndex,
              type: "function",
              name: functionName,
            };
            inChunk = true;
            bracketCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            // Handle one-line functions
            if (bracketCount === 0 && line.includes("{") && line.includes("}")) {
              chunks.push(currentChunk);
              currentChunk = null;
              inChunk = false;
            }
            break;
          }
        }
      }
    } else {
      // Already tracking a chunk, add the line to it
      if (currentChunk) {
        currentChunk.content += "\n" + line;
        currentChunk.endLine = lineIndex;
      }

      // Update bracket count
      bracketCount += (line.match(/{/g) || []).length;
      bracketCount -= (line.match(/}/g) || []).length;

      // If brackets are balanced, we've reached the end of the chunk
      if (bracketCount <= 0) {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = null;
        inChunk = false;
      }
    }
  }

  // Add the last chunk if we're still tracking one
  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // If no chunks were detected, create chunks based on logical sections
  if (chunks.length === 0) {
    return createDefaultChunks(filePath, content);
  }

  return chunks;
}

/**
 * Special handling for Python's indentation-based syntax
 */
function parsePythonCode(
  filePath: string, 
  content: string, 
  patterns: { functions: RegExp[]; classes: RegExp[] }
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  const lines = content.split("\n");
  const fileName = path.basename(filePath);
  
  // Track classes and functions separately with their indentation levels
  let currentClass: CodeChunk | null = null;
  let currentFunction: CodeChunk | null = null;
  let classIndentation = -1;
  let functionIndentation = -1;
  
  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineIndex = i + 1;
    
    // Skip empty lines or comment-only lines, but still add them to current chunks
    if (!line.trim() || line.trim().startsWith('#')) {
      if (currentFunction) {
        currentFunction.content += "\n" + line;
        currentFunction.endLine = lineIndex;
      } else if (currentClass) {
        currentClass.content += "\n" + line;
        currentClass.endLine = lineIndex;
      }
      continue;
    }
    
    // Calculate the indentation level of the current line
    const indentation = line.search(/\S|$/);
    
    // Check if we're exiting a function based on indentation
    if (currentFunction && indentation <= functionIndentation) {
      // Function has ended - add it to our chunks
      chunks.push(currentFunction);
      currentFunction = null;
      functionIndentation = -1;
    }
    
    // Check if we're exiting a class based on indentation
    if (currentClass && !currentFunction && indentation <= classIndentation) {
      // Class has ended - add it to our chunks
      chunks.push(currentClass);
      currentClass = null;
      classIndentation = -1;
    }
    
    // Handle line content based on context
    // Case 1: We're inside a function - add line to function content
    if (currentFunction) {
      currentFunction.content += "\n" + line;
      currentFunction.endLine = lineIndex;
      continue;
    }
    
    // Case 2: We're inside a class but not in a function - check if this is a method definition
    if (currentClass && !currentFunction) {
      // First, update the class content and endLine
      currentClass.content += "\n" + line;
      currentClass.endLine = lineIndex;
      
      // Check if this line defines a method
      let isMethod = false;
      for (const pattern of patterns.functions) {
        const match = line.match(pattern);
        if (match && indentation > classIndentation) {
          isMethod = true;
          const methodName = match[1] || `method_${lineIndex}`;
          const className = currentClass.name;
          
          currentFunction = {
            id: `${filePath}:${className}.${methodName}:${lineIndex}`,
            content: line,
            filePath,
            startLine: lineIndex,
            endLine: lineIndex,
            type: "method", // This is a method, not a standalone function
            name: `${className}.${methodName}`,
          };
          
          functionIndentation = indentation;
          break;
        }
      }
      
      continue; // Continue to next line regardless of whether this was a method or not
    }
    
    // Case 3: Not in a class or function - check for class definition first
    if (!currentClass && !currentFunction) {
      let foundClass = false;
      for (const pattern of patterns.classes) {
        const match = line.match(pattern);
        if (match) {
          foundClass = true;
          const className = match[1] || `${fileName}_class_${lineIndex}`;
          
          currentClass = {
            id: `${filePath}:${className}:${lineIndex}`,
            content: line,
            filePath,
            startLine: lineIndex,
            endLine: lineIndex,
            type: "class",
            name: className,
          };
          
          classIndentation = indentation;
          break;
        }
      }
      
      if (foundClass) continue;
      
      // Case 4: Not in a class and no class definition found - check for function
      for (const pattern of patterns.functions) {
        const match = line.match(pattern);
        if (match) {
          const functionName = match[1] || `${fileName}_function_${lineIndex}`;
          
          currentFunction = {
            id: `${filePath}:${functionName}:${lineIndex}`,
            content: line,
            filePath,
            startLine: lineIndex,
            endLine: lineIndex,
            type: "function",
            name: functionName,
          };
          
          functionIndentation = indentation;
          break;
        }
      }
    }
  }
  
  // Add any remaining chunks
  if (currentFunction) {
    chunks.push(currentFunction);
  }
  
  if (currentClass) {
    chunks.push(currentClass);
  }
  
  // If no chunks were detected, create chunks based on logical sections
  if (chunks.length === 0) {
    return createDefaultChunks(filePath, content);
  }
  
  // Post-process to ensure we didn't miss anything and to debug
  console.log(`Python parsing for ${filePath} resulted in ${chunks.length} chunks:`);
  chunks.forEach((chunk, index) => {
    console.log(`  [${index}] ${chunk.type} "${chunk.name}" (lines ${chunk.startLine}-${chunk.endLine})`);
  });
  
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
