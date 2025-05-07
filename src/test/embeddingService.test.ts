import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { EmbeddingService } from "../embeddingService";
import { CodeChunk } from "../codeParser";

suite("EmbeddingService Test Suite", () => {
  let embeddingService: EmbeddingService;
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
    sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

    // Create a new instance of EmbeddingService for each test
    embeddingService = new EmbeddingService();
  });

  teardown(() => {
    // Restore all stubs using sandbox
    sandbox.restore();
  });

  test("should initialize with valid API key", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
      update: sandbox.stub().resolves()
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    // Mock Pinecone client
    const mockPineconeClient = {
      listIndexes: sandbox.stub().resolves({ indexes: [] }),
      createIndex: sandbox.stub().resolves({ name: "test-index" }),
      index: sandbox.stub().returns({
        query: sandbox.stub().resolves({ matches: [] }),
        upsert: sandbox.stub().resolves(),
        delete: sandbox.stub().resolves()
      })
    };

    // Replace the real Pinecone client with our mock
    (embeddingService as any).pineconeClient = mockPineconeClient;

    const result = await embeddingService.initialize();
    assert.strictEqual(result, true);
  });

  test("should fail initialization without API key", async () => {
    // Mock VS Code configuration with no API key
    const mockConfig = {
      get: sandbox.stub().returns(""),
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    const result = await embeddingService.initialize();
    assert.strictEqual(result, false);
  });

  test("should generate valid embeddings", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
      update: sandbox.stub().resolves()
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    // Mock Pinecone client
    const mockPineconeClient = {
      listIndexes: sandbox.stub().resolves({ indexes: [] }),
      createIndex: sandbox.stub().resolves({ name: "test-index" }),
      index: sandbox.stub().returns({
        query: sandbox.stub().resolves({ matches: [] }),
        upsert: sandbox.stub().resolves(),
        delete: sandbox.stub().resolves()
      }),
      inference: {
        embed: sandbox.stub().resolves({
          data: [{ values: new Array(1024).fill(0.1) }]
        })
      }
    };

    // Replace the real Pinecone client with our mock
    (embeddingService as any).pineconeClient = mockPineconeClient;

    // Initialize the service
    await embeddingService.initialize();

    // Test text to embed
    const testText = "This is a test text for embedding";

    // Generate embedding
    const embedding = await (embeddingService as any).generateEmbedding(testText);

    // Verify the embedding
    assert.strictEqual(embedding.length, 1024);
    assert.ok(embedding.every((val: number) => typeof val === "number"));
  });

  test("should store code chunks with proper metadata", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
      update: sandbox.stub().resolves()
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    // Mock Pinecone client
    const mockPineconeClient = {
      listIndexes: sandbox.stub().resolves({ indexes: [] }),
      createIndex: sandbox.stub().resolves({ name: "test-index" }),
      index: sandbox.stub().returns({
        query: sandbox.stub().resolves({ matches: [] }),
        upsert: sandbox.stub().resolves(),
        delete: sandbox.stub().resolves()
      }),
      inference: {
        embed: sandbox.stub().resolves({
          data: [{ values: new Array(1024).fill(0.1) }]
        })
      }
    };

    // Replace the real Pinecone client with our mock
    (embeddingService as any).pineconeClient = mockPineconeClient;

    // Initialize the service
    await embeddingService.initialize();

    // Create test code chunks
    const testChunks: CodeChunk[] = [
      {
        id: "test1",
        content: "function test() { return true; }",
        filePath: "/test/file1.ts",
        startLine: 1,
        endLine: 1,
        type: "function",
        name: "test",
      },
    ];

    // Store the chunks
    await embeddingService.storeCodeChunks(testChunks);

    // Verify that upsert was called with the correct data
    const mockIndex = mockPineconeClient.index();
    assert.ok(mockIndex.upsert.called);
    const upsertCall = mockIndex.upsert.getCall(0);
    const vectors = upsertCall.args[0];

    // Verify vector structure
    assert.strictEqual(vectors.length, 1);
    const vector = vectors[0];
    assert.ok(vector.id.startsWith("user-"));
    assert.strictEqual(vector.metadata.filePath, "/test/file1.ts");
    assert.strictEqual(vector.metadata.startLine, 1);
    assert.strictEqual(vector.metadata.endLine, 1);
    assert.strictEqual(vector.metadata.type, "function");
    assert.strictEqual(vector.metadata.name, "test");
  });

  test("should query similar chunks with proper filtering", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
      update: sandbox.stub().resolves()
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    // Mock Pinecone client
    const mockPineconeClient = {
      listIndexes: sandbox.stub().resolves({ indexes: [] }),
      createIndex: sandbox.stub().resolves({ name: "test-index" }),
      index: sandbox.stub().returns({
        query: sandbox.stub().resolves({
          matches: [
            {
              id: "user-test1",
              metadata: {
                content: "function test() { return true; }",
                filePath: "/test/file1.ts",
                startLine: 1,
                endLine: 1,
                type: "function",
                name: "test",
              },
            },
          ],
        }),
        upsert: sandbox.stub().resolves(),
        delete: sandbox.stub().resolves()
      }),
      inference: {
        embed: sandbox.stub().resolves({
          data: [{ values: new Array(1024).fill(0.1) }]
        })
      }
    };

    // Replace the real Pinecone client with our mock
    (embeddingService as any).pineconeClient = mockPineconeClient;

    // Initialize the service
    await embeddingService.initialize();

    // Query similar chunks
    const results = await embeddingService.querySimilarChunks("test query");

    // Verify results
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].filePath, "/test/file1.ts");
    assert.strictEqual(results[0].startLine, 1);
    assert.strictEqual(results[0].endLine, 1);
    assert.strictEqual(results[0].type, "function");
    assert.strictEqual(results[0].name, "test");
  });

  test("should clear workspace embeddings", async () => {
    // Mock VS Code configuration
    const mockConfig = {
      get: sandbox.stub().returns("test-api-key"),
      update: sandbox.stub().resolves()
    };
    sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as any);

    // Mock Pinecone client
    const mockPineconeClient = {
      listIndexes: sandbox.stub().resolves({ indexes: [] }),
      createIndex: sandbox.stub().resolves({ name: "test-index" }),
      index: sandbox.stub().returns({
        query: sandbox.stub().resolves({ matches: [] }),
        upsert: sandbox.stub().resolves(),
        delete: sandbox.stub().resolves()
      })
    };

    // Replace the real Pinecone client with our mock
    (embeddingService as any).pineconeClient = mockPineconeClient;

    // Initialize the service
    await embeddingService.initialize();

    // Clear embeddings
    await embeddingService.clearWorkspaceEmbeddings();

    // Verify that delete was called with the correct filter
    const mockIndex = mockPineconeClient.index();
    assert.ok(mockIndex.delete.called);
    const deleteCall = mockIndex.delete.getCall(0);
    assert.deepStrictEqual(deleteCall.args[0].filter, {
      projectId: "test-workspace",
    });
  });
});
