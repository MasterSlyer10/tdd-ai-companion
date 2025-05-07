import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { parseFileIntoChunks, parseFilesIntoChunks, isSupportedFile, SUPPORTED_EXTENSIONS } from '../codeParser';

suite('Code Parser Test Suite', () => {
    let mockFileContent: string;
    let mockFilePath: string;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        // Create a sandbox for each test
        sandbox = sinon.createSandbox();
        
        // Create a mock file path
        mockFilePath = '/test/file.ts';
        mockFileContent = `
            function testFunction() {
                return true;
            }

            class TestClass {
                public testMethod() {
                    return false;
                }
            }

            const arrowFunction = () => {
                return 'test';
            };
        `;

        // Mock fs.readFileSync using sandbox
        sandbox.stub(fs, 'readFileSync').returns(mockFileContent);
    });

    teardown(() => {
        // Restore all stubs using sandbox
        sandbox.restore();
    });

    test('should identify supported file extensions', () => {
        // Test supported extensions
        assert.ok(isSupportedFile('test.ts'));
        assert.ok(isSupportedFile('test.js'));
        assert.ok(isSupportedFile('test.py'));
        assert.ok(isSupportedFile('test.java'));

        // Test unsupported extensions
        assert.ok(!isSupportedFile('test.txt'));
        assert.ok(!isSupportedFile('test.md'));
        assert.ok(!isSupportedFile('test.json'));
    });

    test('should parse TypeScript files into chunks', async () => {
        const chunks = await parseFileIntoChunks(mockFilePath);

        // Verify chunks
        assert.strictEqual(chunks.length, 3);

        // Verify function chunk
        const functionChunk = chunks.find(chunk => chunk.type === 'function');
        assert.ok(functionChunk);
        assert.strictEqual(functionChunk?.name, 'testFunction');
        assert.ok(functionChunk?.content.includes('function testFunction()'));

        // Verify class method chunk
        const methodChunk = chunks.find(chunk => chunk.type === 'method');
        assert.ok(methodChunk);
        assert.strictEqual(methodChunk?.name, 'TestClass.testMethod');
        assert.ok(methodChunk?.content.includes('testMethod()'));

        // Verify arrow function chunk
        const arrowChunk = chunks.find(chunk => chunk.type === 'function' && chunk.name === 'arrowFunction');
        assert.ok(arrowChunk);
        assert.ok(arrowChunk?.content.includes('const arrowFunction'));
    });

    test('should handle empty files', async () => {
        // Mock empty file content
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync').returns('');

        const chunks = await parseFileIntoChunks(mockFilePath);
        assert.strictEqual(chunks.length, 0);
    });

    test('should handle files with no functions or classes', async () => {
        // Mock file with only variable declarations
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync').returns(`
            const x = 1;
            let y = 2;
            var z = 3;
        `);

        const chunks = await parseFileIntoChunks(mockFilePath);
        assert.strictEqual(chunks.length, 0);
    });

    test('should parse multiple files', async () => {
        const mockFiles = [
            vscode.Uri.file('/test/file1.ts'),
            vscode.Uri.file('/test/file2.ts')
        ];

        // Mock different content for each file
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync')
            .withArgs('/test/file1.ts').returns('function test1() { return true; }')
            .withArgs('/test/file2.ts').returns('function test2() { return false; }');

        const chunks = await parseFilesIntoChunks(mockFiles);

        // Verify chunks from both files
        assert.strictEqual(chunks.length, 2);
        assert.ok(chunks.some(chunk => chunk.name === 'test1'));
        assert.ok(chunks.some(chunk => chunk.name === 'test2'));
    });

    test('should handle file reading errors gracefully', async () => {
        // Mock fs.readFileSync to throw an error
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync').throws(new Error('File not found'));

        const chunks = await parseFileIntoChunks(mockFilePath);
        assert.strictEqual(chunks.length, 0);
    });

    test('should handle unsupported file types', async () => {
        const unsupportedFile = '/test/file.txt';
        const chunks = await parseFileIntoChunks(unsupportedFile);
        assert.strictEqual(chunks.length, 0);
    });

    test('should parse Python files correctly', async () => {
        const pythonFile = '/test/file.py';
        const pythonContent = `
            def test_function():
                return True

            class TestClass:
                def test_method(self):
                    return False

            lambda_function = lambda x: x * 2
        `;

        // Mock Python file content
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync').returns(pythonContent);

        const chunks = await parseFileIntoChunks(pythonFile);

        // Verify chunks
        assert.strictEqual(chunks.length, 3);

        // Verify function chunk
        const functionChunk = chunks.find(chunk => chunk.type === 'function');
        assert.ok(functionChunk);
        assert.strictEqual(functionChunk?.name, 'test_function');
        assert.ok(functionChunk?.content.includes('def test_function()'));

        // Verify class method chunk
        const methodChunk = chunks.find(chunk => chunk.type === 'method');
        assert.ok(methodChunk);
        assert.strictEqual(methodChunk?.name, 'TestClass.test_method');
        assert.ok(methodChunk?.content.includes('def test_method(self)'));

        // Verify lambda function chunk
        const lambdaChunk = chunks.find(chunk => chunk.type === 'function' && chunk.name === 'lambda_function');
        assert.ok(lambdaChunk);
        assert.ok(lambdaChunk?.content.includes('lambda_function = lambda'));
    });

    test('should handle nested functions and classes', async () => {
        const nestedContent = `
            class OuterClass {
                class InnerClass {
                    method() {
                        function nestedFunction() {
                            return true;
                        }
                        return nestedFunction();
                    }
                }
            }
        `;

        // Mock nested content
        sandbox.restore();
        sandbox.stub(fs, 'readFileSync').returns(nestedContent);

        const chunks = await parseFileIntoChunks(mockFilePath);

        // Verify chunks
        assert.strictEqual(chunks.length, 3);

        // Verify outer class
        const outerClass = chunks.find(chunk => chunk.type === 'class' && chunk.name === 'OuterClass');
        assert.ok(outerClass);

        // Verify inner class
        const innerClass = chunks.find(chunk => chunk.type === 'class' && chunk.name === 'InnerClass');
        assert.ok(innerClass);

        // Verify nested function
        const nestedFunction = chunks.find(chunk => chunk.type === 'function' && chunk.name === 'nestedFunction');
        assert.ok(nestedFunction);
    });
}); 