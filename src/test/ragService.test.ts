import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { RAGService } from "../ragService";
import { CodeChunk } from "../codeParser";

suite("RAGService Test Suite", () => {
  let ragService: RAGService;
  let mockWorkspaceFolder: vscode.WorkspaceFolder;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    // Create a sandbox for each test
    sandbox = sinon.createSandbox();

    // Create a mock workspace folder
    mockWorkspaceFolder = {
      uri: vscode.Uri.file("/test/workspace"),
      name: "test-workspace",
      index: 0,
    };

    // Mock VS Code workspace
    sandbox
      .stub(vscode.workspace, "workspaceFolders")
      .value([mockWorkspaceFolder]);

    // Create a new instance of RAGService for each test
    ragService = new RAGService();
  });

  teardown(() => {
    // Restore all stubs using sandbox
    sandbox.restore();
  });

  test("should initialize successfully", async () => {
    // Mock the embedding service initialization
    const mockEmbeddingService = {
      initialize: sandbox.stub().returns(Promise.resolve(true)),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    const result = await ragService.initialize();
    assert.strictEqual(result, true);
    assert.ok(mockEmbeddingService.initialize.called);
  });

  test("should fail initialization when embedding service fails", async () => {
    // Mock the embedding service initialization to fail
    const mockEmbeddingService = {
      initialize: sandbox.stub().returns(Promise.resolve(false)),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    const result = await ragService.initialize();
    assert.strictEqual(result, false);
    assert.ok(mockEmbeddingService.initialize.called);
  });

  test("should index project files successfully", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
    };
    sandbox
      .stub(vscode.workspace, "getConfiguration")
      .returns(mockConfig as any);

    // Mock the embedding service
    const mockEmbeddingService = {
      initialize: sandbox.stub().returns(Promise.resolve(true)),
      storeCodeChunks: sandbox.stub().returns(Promise.resolve()),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Mock file URIs
    const mockFiles = [
      vscode.Uri.file("/test/file1.ts"),
      vscode.Uri.file("/test/file2.ts"),
    ];

    // Mock parseFilesIntoChunks
    const mockChunks: CodeChunk[] = [
      {
        id: "test1",
        content: "function test1() { return true; }",
        filePath: "/test/file1.ts",
        startLine: 1,
        endLine: 1,
        type: "function",
        name: "test1",
      },
      {
        id: "test2",
        content: "function test2() { return true; }",
        filePath: "/test/file2.ts",
        startLine: 1,
        endLine: 1,
        type: "function",
        name: "test2",
      },
    ];

    // Mock the parseFilesIntoChunks function
    const { parseFilesIntoChunks } = require("../codeParser");
    sandbox.stub(parseFilesIntoChunks).returns(Promise.resolve(mockChunks));

    // Index the files
    const result = await ragService.indexProjectFiles(mockFiles);

    // Verify results
    assert.strictEqual(result, true);
    assert.ok(mockEmbeddingService.storeCodeChunks.calledWith(mockChunks));
  });

  test("should handle indexing errors gracefully", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
    };
    sandbox
      .stub(vscode.workspace, "getConfiguration")
      .returns(mockConfig as any);

    // Mock the embedding service to throw an error
    const mockEmbeddingService = {
      initialize: sandbox.stub().returns(Promise.resolve(true)),
      storeCodeChunks: sandbox
        .stub()
        .returns(Promise.reject(new Error("Test error"))),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Mock file URIs
    const mockFiles = [vscode.Uri.file("/test/file1.ts")];

    // Mock parseFilesIntoChunks
    const mockChunks: CodeChunk[] = [
      {
        id: "test1",
        content: "function test1() { return true; }",
        filePath: "/test/file1.ts",
        startLine: 1,
        endLine: 1,
        type: "function",
        name: "test1",
      },
    ];

    // Mock the parseFilesIntoChunks function
    const { parseFilesIntoChunks } = require("../codeParser");
    sandbox.stub(parseFilesIntoChunks).returns(Promise.resolve(mockChunks));

    // Index the files
    const result = await ragService.indexProjectFiles(mockFiles);

    // Verify results
    assert.strictEqual(result, false);
    assert.ok(mockEmbeddingService.storeCodeChunks.called);
  });

  test("should clear index successfully", async () => {
    // Mock the embedding service
    const mockEmbeddingService = {
      clearWorkspaceEmbeddings: sandbox.stub().returns(Promise.resolve()),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Clear the index
    const result = await ragService.clearIndex();

    // Verify results
    assert.strictEqual(result, true);
    assert.ok(mockEmbeddingService.clearWorkspaceEmbeddings.called);
  });

  test("should handle clear index errors gracefully", async () => {
    // Mock the embedding service to throw an error
    const mockEmbeddingService = {
      clearWorkspaceEmbeddings: sandbox
        .stub()
        .returns(Promise.reject(new Error("Test error"))),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Clear the index
    const result = await ragService.clearIndex();

    // Verify results
    assert.strictEqual(result, false);
    assert.ok(mockEmbeddingService.clearWorkspaceEmbeddings.called);
  });

  test("should retrieve relevant code chunks", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
    };
    sandbox
      .stub(vscode.workspace, "getConfiguration")
      .returns(mockConfig as any);

    // Mock the embedding service
    const mockChunks: CodeChunk[] = [
      {
        id: "test1",
        content: "function test1() { return true; }",
        filePath: "/test/file1.ts",
        startLine: 1,
        endLine: 1,
        type: "function",
        name: "test1",
      },
    ];

    const mockEmbeddingService = {
      querySimilarChunks: sandbox.stub().returns(Promise.resolve(mockChunks)),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Query for relevant chunks
    const query = "test query";
    const results = await ragService.retrieveRelevantCode(query);

    // Verify results
    assert.deepStrictEqual(results, mockChunks);
    assert.ok(mockEmbeddingService.querySimilarChunks.calledWith(query));
  });

  test("should handle retrieval errors gracefully", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
    };
    sandbox
      .stub(vscode.workspace, "getConfiguration")
      .returns(mockConfig as any);

    // Mock the embedding service to throw an error
    const mockEmbeddingService = {
      querySimilarChunks: sandbox
        .stub()
        .returns(Promise.reject(new Error("Test error"))),
    };
    (ragService as any).embeddingService = mockEmbeddingService;

    // Query for relevant chunks
    const query = "test query";
    const results = await ragService.retrieveRelevantCode(query);

    // Verify results
    assert.deepStrictEqual(results, []);
    assert.ok(mockEmbeddingService.querySimilarChunks.calledWith(query));
  });

  //   test("should augment prompt with code context", () => {
  //     const originalPrompt = "Test prompt";
  //     const relevantChunks: CodeChunk[] = [
  //       {
  //         id: "test1",
  //         content: "function test1() { return true; }",
  //         filePath: "/test/file1.ts",
  //         startLine: 1,
  //         endLine: 1,
  //         type: "function",
  //         name: "test1",
  //       },
  //     ];

  //     // const augmentedPrompt = ragService.augmentPromptWithCodeContext(originalPrompt, relevantChunks);

  //     // Verify the augmented prompt contains the code context
  //     assert.ok(augmentedPrompt.includes("function test1()"));
  //     assert.ok(augmentedPrompt.includes("/test/file1.ts"));
  //   });

  //   test("should return original prompt when no relevant chunks", () => {
  //     const originalPrompt = "Test prompt";
  //     const relevantChunks: CodeChunk[] = [];

  //     // const augmentedPrompt = ragService.augmentPromptWithCodeContext(originalPrompt, relevantChunks);

  //     // Verify the prompt is unchanged
  //     assert.strictEqual(augmentedPrompt, originalPrompt);
  //   });
});
