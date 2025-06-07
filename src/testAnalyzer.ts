import * as fs from 'fs';
import * as path from 'path';

/**
 * Analyzes a test file's content to extract names of functions that appear to be tested.
 * This uses a heuristic approach based on common testing patterns.
 * @param filePath The path to the test file.
 * @returns A Set of strings, where each string is the name of a tested function.
 */
export function analyzeTestFile(filePath: string): Set<string> {
    const testedFunctions = new Set<string>();
    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Regex to find function names within common assertion patterns or direct calls in test blocks.
        // This is a heuristic and might need refinement for different testing frameworks or styles.
        // It looks for:
        // 1. assert.ok(functionName
        // 2. assert.strictEqual(functionName
        // 3. functionName( (followed by parenthesis, likely a call)
        // 4. new ClassName( (constructor calls)
        const functionCallRegex = /(?:assert\.(?:ok|strictEqual|equal|deepStrictEqual)\(\s*([a-zA-Z0-9_.]+)|([a-zA-Z0-9_.]+)\s*\()|new\s+([a-zA-Z0-9_]+)\s*\(/g;

        let match;
        while ((match = functionCallRegex.exec(content)) !== null) {
            // Group 1 for assert.ok/strictEqual, Group 2 for direct calls, Group 3 for new ClassName
            const functionName = match[1] || match[2] || match[3];
            if (functionName) {
                // Filter out common test framework keywords or internal functions
                if (!['test', 'it', 'describe', 'suite', 'beforeEach', 'afterEach', 'setup', 'teardown', 'sandbox', 'assert', 'sinon', 'fs', 'vscode'].includes(functionName)) {
                    testedFunctions.add(functionName.split('.')[0]); // Add base name for methods (e.g., 'TestClass' from 'TestClass.testMethod')
                }
            }
        }

    } catch (error) {
        console.error(`Error reading or analyzing test file ${filePath}:`, error);
    }
    return testedFunctions;
}

/**
 * Analyzes multiple test files to get a comprehensive list of tested functions.
 * @param filePaths An array of paths to test files.
 * @returns A Set of strings, where each string is the name of a tested function across all files.
 */
export function analyzeTestFiles(filePaths: string[]): Set<string> {
    const allTestedFunctions = new Set<string>();
    for (const filePath of filePaths) {
        const functionsInFile = analyzeTestFile(filePath);
        functionsInFile.forEach(func => allTestedFunctions.add(func));
    }
    return allTestedFunctions;
}
