import {
  CodeChunk,
  parseFilesIntoChunks,
  SUPPORTED_EXTENSIONS,
} from "./codeParser";
import * as vscode from "vscode";
import { Pinecone } from "@pinecone-database/pinecone";

export interface Embedding {
  id: string;
  values: number[];
  metadata: {
    content: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
    name: string;
  };
}

export class EmbeddingService {
  private embeddingModel: string = "llama-text-embed-v2"; // Using llama embedding model from Pinecone
  private pineconeClient: Pinecone | null = null;
  private indexName: string = "tdd-ai-companion";
  private projectId: string = ""; // Will be set to workspace name
  private userId: string = ""; // User ID for namespace separation
  private initialized: boolean = false;
  private dimension: number = 1024; // Dimension for llama-text-embed-v2 model
  private indexCreated: boolean = false;
  private isIndexing: boolean = false;
  private lastIndexedProject: string = "";

  constructor() {}

  /**
   * Sanitize a string to be used in Pinecone index names
   * Only allows lowercase alphanumeric characters and hyphens
   */
  private sanitizeForPinecone(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }

  /**
   * Initialize the embedding service with Pinecone
   */
  public async initialize(): Promise<boolean> {
    try {
      // Get API key from extension settings
      const config = vscode.workspace.getConfiguration("tddAICompanion");
      let pineconeApiKey = config.get("pineconeApiKey") as string;
      pineconeApiKey =
        "pcsk_VwUfj_SVFD7oLgq8sESu4e1VxdhvQod8HPEyLDzyowSyzrtuex3ATHLPjqtzBRdZMWNsL";

      if (!pineconeApiKey) {
        vscode.window.showErrorMessage(
          "Please set Pinecone API key in extension settings."
        );
        return false;
      }

      // Initialize Pinecone client
      this.pineconeClient = new Pinecone({
        apiKey: pineconeApiKey,
      });

      // Get workspace folder name to use as projectId
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        this.projectId = this.sanitizeForPinecone(workspaceFolder.name);
      }

      // Get user ID from VS Code settings or generate one
      this.userId = config.get("userId") as string;
      if (!this.userId) {
        // Generate a unique user ID if not set
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 9);
        this.userId = `user-${timestamp}-${random}`;
        // Sanitize the user ID
        this.userId = this.sanitizeForPinecone(this.userId);
        // Save the generated ID to settings
        await config.update("userId", this.userId, true);
      } else {
        // Sanitize existing user ID
        this.userId = this.sanitizeForPinecone(this.userId);
      }

      // Update index name to include user ID
      this.indexName = `tdd-ai-companion-${this.userId}`;
      // Ensure the index name is valid
      this.indexName = this.sanitizeForPinecone(this.indexName);

      // Get a sample embedding to confirm the actual dimension before creating the index
      try {
        const sampleText = "Sample text to determine embedding dimension";
        const sampleEmbedding = await this.generateEmbedding(sampleText, true);
        // Update dimension based on the actual model output
        this.dimension = sampleEmbedding.length;
        console.log(`Determined embedding dimension: ${this.dimension}`);
      } catch (error) {
        console.warn(
          "Could not determine embedding dimension, using default:",
          error
        );
        // Continue with the default dimension
      }

      // Ensure the index exists
      await this.ensureIndexExists();

      this.initialized = true;
      return true;
    } catch (error) {
      console.error("Failed to initialize embedding service:", error);
      vscode.window.showErrorMessage(
        `Failed to initialize embedding service: ${error}`
      );
      return false;
    }
  }

  /**
   * Ensure the Pinecone index exists, create it if it doesn't
   */
  private async ensureIndexExists(): Promise<void> {
    if (!this.pineconeClient) {
      throw new Error("Pinecone client not initialized");
    }

    try {
      // List existing indexes
      const indexes = await this.pineconeClient.listIndexes();

      // Check if our index already exists
      const existingIndex = indexes.indexes?.find(
        (index: any) => index.name === this.indexName
      );

      if (existingIndex) {
        console.log(`Found existing index: ${this.indexName}`);
        // Check if dimensions match
        const indexDimension = existingIndex.dimension || 0;
        if (indexDimension !== this.dimension) {
          console.warn(
            `Dimension mismatch: Index has ${indexDimension}, but model produces ${this.dimension}`
          );

          // Ask user for permission to delete and recreate the index
          const answer = await vscode.window.showWarningMessage(
            `The dimension of your Pinecone index (${indexDimension}) doesn't match the embedding model dimension (${this.dimension}). Delete the existing index and create a new one?`,
            "Yes",
            "No"
          );

          if (answer === "Yes") {
            console.log(`Deleting index: ${this.indexName}`);
            await this.pineconeClient.deleteIndex(this.indexName);
            console.log(
              `Creating new index with correct dimension: ${this.dimension}`
            );
            await this.createIndex();
          } else {
            // User chose not to recreate the index, so we'll use the existing dimension
            if (indexDimension > 0) {
              console.log(`Using existing index dimension: ${indexDimension}`);
              this.dimension = indexDimension;
            } else {
              throw new Error(`Cannot determine dimension of existing index`);
            }
          }
        }
        this.indexCreated = true;
      } else {
        // Create the index if it doesn't exist
        await this.createIndex();
      }
    } catch (error) {
      console.error("Error ensuring index exists:", error);
      throw new Error(`Failed to ensure index exists: ${error}`);
    }
  }

  /**
   * Create a new Pinecone index with the current dimension
   */
  private async createIndex(): Promise<void> {
    if (!this.pineconeClient) {
      throw new Error("Pinecone client not initialized");
    }

    try {
      await this.pineconeClient.createIndex({
        name: this.indexName,
        dimension: this.dimension,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1", // Using us-east-1 for free plan
          },
        },
      });

      this.indexCreated = true;
      vscode.window.showInformationMessage(
        `Created new Pinecone index: ${this.indexName} with dimension ${this.dimension}`
      );
    } catch (error) {
      console.error("Error creating index:", error);
      throw new Error(`Failed to create index: ${error}`);
    }
  }

  /**
   * Generate embedding for a text using Pinecone's inference API
   * @param text The text to embed
   * @param skipDimensionCheck If true, skip dimension checking (used during initialization)
   */
  private async generateEmbedding(
    text: string,
    skipDimensionCheck: boolean = false
  ): Promise<number[]> {
    try {
      if (!this.pineconeClient) {
        throw new Error("Pinecone client not initialized");
      }

      if (!text.trim()) {
        console.warn("Empty text provided for embedding. Using placeholder.");
        // Return a zero vector of the correct dimension as a fallback
        return new Array(this.dimension).fill(0);
      }

      // For debugging
      console.log(`Generating embedding for text (${text.length} chars)`);

      // Limit text length to avoid token limits (max 8192 chars)
      const truncatedText =
        text.length > 8192 ? text.substring(0, 8192) + "... [truncated]" : text;

      // Use Pinecone's inference API to generate embeddings
      console.log(
        `Using Pinecone inference with model: ${this.embeddingModel}`
      );

      const embeddings = await this.pineconeClient.inference.embed(
        this.embeddingModel,
        [truncatedText],
        { inputType: "passage", truncate: "END" }
      );

      console.log(`Got embedding result:`, embeddings);

      // Based on the Pinecone TypeScript SDK docs, embeddings is of type EmbeddingsList
      // which has a data property containing an array of Embedding objects
      if (embeddings && embeddings.data && embeddings.data.length > 0) {
        // The values property is actually on the embedding object
        const embeddingData = embeddings.data[0];
        // Handle both sparse and dense embedding types
        if ("values" in embeddingData) {
          const embedding = embeddingData.values as number[];
          console.log(`Embedding vector length: ${embedding.length}`);

          // Check if dimensions match what we expect, but only if we're not skipping the check
          if (!skipDimensionCheck && embedding.length !== this.dimension) {
            console.warn(
              `Embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
            );

            // If index is not yet created, we can adjust our dimension
            if (!this.indexCreated) {
              console.log(
                `Updating dimension from ${this.dimension} to ${embedding.length}`
              );
              // Update our dimension to match what the API returned
              this.dimension = embedding.length;
            } else {
              // If index is already created with a different dimension, we have a problem
              // We'll need to pad or truncate the embedding to match the index dimension
              console.warn(
                `Index already created with dimension ${this.dimension}, but embedding has dimension ${embedding.length}`
              );
              if (embedding.length > this.dimension) {
                // Truncate to match index dimension
                console.warn(
                  `Truncating embedding from ${embedding.length} to ${this.dimension}`
                );
                return embedding.slice(0, this.dimension);
              } else {
                // Pad with zeros to match index dimension
                console.warn(
                  `Padding embedding from ${embedding.length} to ${this.dimension}`
                );
                const paddedEmbedding = [...embedding];
                while (paddedEmbedding.length < this.dimension) {
                  paddedEmbedding.push(0);
                }
                return paddedEmbedding;
              }
            }
          }

          return embedding;
        } else {
          console.error(
            "Received sparse embedding but expected dense embedding:",
            embeddingData
          );
          throw new Error("Sparse embeddings are not supported");
        }
      } else {
        console.error("Unexpected embedding format from Pinecone:", embeddings);
        throw new Error("Invalid embedding format received from Pinecone");
      }
    } catch (error) {
      console.error("Error generating embedding with Pinecone:", error);

      if (error instanceof Error) {
        if (error.message.includes("404")) {
          throw new Error(
            "Embedding model not found. Make sure the model is available in your Pinecone tier."
          );
        } else if (
          error.message.includes("401") ||
          error.message.includes("403")
        ) {
          throw new Error(
            "Authentication error with Pinecone API. Please check your API key."
          );
        } else if (error.message.includes("429")) {
          throw new Error(
            "Rate limit exceeded for Pinecone API. Please try again later."
          );
        }
      }

      // Return a zero vector as fallback in case of error
      console.warn("Using fallback zero embedding due to error");
      return new Array(this.dimension).fill(0);
    }
  }  /**
   * Store code chunks in Pinecone
   * @param chunks The code chunks to store
   * @param namespace The namespace to store the chunks under (e.g., "source_code", "test_code")
   * @param batchSize The number of chunks to process in each batch (default: 15)
   * @param progressCallback Optional callback for progress updates
   */
  public async storeCodeChunks(
    chunks: CodeChunk[],
    namespace: string,
    batchSize: number = 15,
    progressCallback?: (processed: number, total: number, currentBatch: number) => void
  ): Promise<void> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error("Failed to initialize embedding service");
      }
    }

    try {
      if (!this.pineconeClient) {
        throw new Error("Pinecone client not initialized");
      }

      if (chunks.length === 0) {
        vscode.window.showWarningMessage("No code chunks to index.");
        return;
      }

      console.log(
        `Starting to index ${chunks.length} code chunks in namespace '${namespace}'...`
      );      const index = this.pineconeClient.index(this.indexName);

      // Process chunks in batches to avoid rate limits
      // Use the provided batchSize parameter instead of hardcoded value
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        console.log(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            chunks.length / batchSize
          )}, size: ${batch.length} (batchSize: ${batchSize})`
        );

        try {
          // First generate embeddings for all chunks in the batch using Pinecone's inference API
          console.log(
            `Generating embeddings for batch ${
              Math.floor(i / batchSize) + 1
            } in namespace '${namespace}'`
          );

          // Map the chunks to only their text content for embedding
          const batchTexts = batch.map((chunk) => chunk.content);

          // Generate embeddings for all texts in the batch at once
          const embeddings = await this.pineconeClient.inference.embed(
            this.embeddingModel,
            batchTexts,
            { inputType: "passage", truncate: "END" }
          );

          console.log(`Successfully generated embeddings for batch`);

          // Create vectors with metadata for upserting
          if (!embeddings.data || embeddings.data.length === 0) {
            console.error("No embeddings returned from Pinecone");
            continue;
          }

          // Create vectors for upserting, handling both sparse and dense embeddings
          const vectors = batch
            .map((chunk, idx) => {
              const embeddingData = embeddings.data[idx];
              // Ensure this is a dense embedding with values
              if (!("values" in embeddingData)) {
                console.error(
                  `Embedding for chunk ${idx} does not have values property`
                );
                return null;
              }

              let embeddingValues = embeddingData.values as number[];

              // Handle dimension mismatch
              if (embeddingValues.length !== this.dimension) {
                if (embeddingValues.length > this.dimension) {
                  // Truncate
                  embeddingValues = embeddingValues.slice(0, this.dimension);
                } else {
                  // Pad with zeros
                  embeddingValues = [
                    ...embeddingValues,
                    ...new Array(this.dimension - embeddingValues.length).fill(
                      0
                    ),
                  ];
                }
              }

              // Add user ID and namespace to the vector ID and metadata
              const vectorId = `${this.userId}_${namespace}_${chunk.id}`;

              return {
                id: vectorId,
                values: embeddingValues,
                metadata: {
                  content: chunk.content.slice(0, 1000), // Limit metadata size
                  filePath: chunk.filePath,
                  startLine: chunk.startLine,
                  endLine: chunk.endLine,
                  type: chunk.type,
                  name: chunk.name,
                  userId: this.userId,
                  projectId: this.projectId,
                  namespace: namespace, // Add namespace to metadata
                },
              };
            })
            .filter((vector) => vector !== null);

          if (vectors.length === 0) {
            console.warn(
              `No valid vectors created for batch ${
                Math.floor(i / batchSize) + 1
              }`
            );
            continue;
          }          // Store embeddings in Pinecone
          console.log(
            `Upserting ${vectors.length} vectors to Pinecone in namespace '${namespace}' (batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)})`
          );
          await index.upsert(vectors as any[]);

          // Report progress to callback if provided
          const processedCount = i + batch.length;
          if (progressCallback) {
            progressCallback(processedCount, chunks.length, Math.floor(i / batchSize) + 1);
          }

          // Show progress notification (less frequent for better performance)
          const batchNumber = Math.floor(i / batchSize) + 1;
          const totalBatches = Math.ceil(chunks.length / batchSize);
          if (batchNumber % 3 === 0 || batchNumber === totalBatches) { // Show every 3rd batch or final batch
            vscode.window.showInformationMessage(
              `Stored batch ${batchNumber}/${totalBatches}: ${processedCount}/${chunks.length} ${namespace} chunks`
            );
          }

          // Add a small delay between batches to avoid rate limits
          if (i + batchSize < chunks.length) {
            await new Promise((resolve) => setTimeout(resolve, 500)); // Reduced delay since we have larger batches
          }
        } catch (batchError) {
          console.error(
            `Error processing batch ${
              Math.floor(i / batchSize) + 1
            } for namespace '${namespace}':`,
            batchError
          );
          vscode.window.showErrorMessage(
            `Error processing batch ${
              Math.floor(i / batchSize) + 1
            } for namespace '${namespace}': ${
              batchError instanceof Error
                ? batchError.message
                : String(batchError)
            }`
          );
        }
      }
    } catch (error) {
      console.error("Error storing code chunks in Pinecone:", error);
      vscode.window.showErrorMessage(
        `Failed to store code chunks in Pinecone: ${error}`
      );
    }
  }

  /**
   * Check if the current project is already indexed in a specific namespace
   * @param namespace The namespace to check (e.g., "source_code", "test_code")
   */
  private async isProjectIndexed(namespace: string): Promise<boolean> {
    if (!this.pineconeClient) {
      throw new Error("Pinecone client not initialized");
    }

    try {
      const index = this.pineconeClient.index(this.indexName);
      const stats = await index.describeIndexStats();

      // Check if we have any vectors and if they belong to the current project and namespace
      if (stats.totalRecordCount && stats.totalRecordCount > 0) {
        // Query for a single vector to check project ID and namespace
        const queryResult = await index.query({
          vector: new Array(this.dimension).fill(0),
          topK: 1,
          includeMetadata: true,
          filter: {
            projectId: this.projectId,
            namespace: namespace, // Filter by namespace
          },
        });

        return queryResult.matches.length > 0;
      }
      return false;
    } catch (error) {
      console.error("Error checking index status:", error);
      return false;
    }
  }

  /**
   * Automatically index the current project if needed for a specific namespace
   * @param namespace The namespace to index (e.g., "source_code", "test_code")
   * @param files The files to index for this namespace
   */
  private async autoIndexIfNeeded(
    namespace: string,
    files: vscode.Uri[]
  ): Promise<void> {
    if (this.isIndexing) {
      return; // Already indexing
    }

    try {
      const isIndexed = await this.isProjectIndexed(namespace);
      if (!isIndexed) {
        if (files.length > 0) {
          // Show progress notification
          vscode.window.showInformationMessage(
            `Indexing codebase for RAG functionality (namespace: ${namespace})... This may take a few minutes.`
          );          // Parse and index the files
          const chunks = await parseFilesIntoChunks(files);
          if (chunks.length > 0) {
            await this.storeCodeChunks(chunks, namespace, 15); // Use default batch size for auto-indexing
            this.lastIndexedProject = this.projectId; // This might need to be more granular if we track per-namespace indexing
          }
        }
      }
    } catch (error) {
      console.error(`Error in auto-indexing for namespace ${namespace}:`, error);
      vscode.window.showErrorMessage(
        `Failed to automatically index the codebase for namespace ${namespace}. Please try indexing manually.`
      );
    }
  }

  /**
   * Query similar code chunks based on a text query from a specific namespace
   * @param query The text query
   * @param topK The number of top results to retrieve
   * @param namespace The namespace to query (e.g., "source_code", "test_code")
   * @param abortSignal Optional AbortSignal to cancel the operation
   */
  public async querySimilarChunks(
    query: string,
    topK: number = 5,
    namespace: string, // Add namespace parameter
    abortSignal?: AbortSignal
  ): Promise<CodeChunk[]> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error("Failed to initialize embedding service");
      }
    }

    try {
      // Check for cancellation before starting
      if (abortSignal && abortSignal.aborted) {
        console.log("EmbeddingService: Query cancelled before starting");
        const abortError = new Error("Query was cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      if (!this.pineconeClient) {
        throw new Error("Pinecone client not initialized");
      }

      // Auto-indexing logic needs to be handled by RAGService now, as it needs to differentiate files
      // await this.autoIndexIfNeeded(namespace); // This call needs to be removed or modified

      // Check for cancellation before embedding generation
      if (abortSignal && abortSignal.aborted) {
        console.log(
          "EmbeddingService: Query cancelled before embedding generation"
        );
        const abortError = new Error("Query was cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      // Generate embedding for the query using the same method
      const queryEmbedding = await this.generateEmbedding(query);

      // Check for cancellation before Pinecone query
      if (abortSignal && abortSignal.aborted) {
        console.log("EmbeddingService: Query cancelled before Pinecone query");
        const abortError = new Error("Query was cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      // Query Pinecone with namespace filter
      const index = this.pineconeClient.index(this.indexName);
      const queryResult = await index.query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true,
        filter: {
          userId: this.userId,
          projectId: this.projectId,
          namespace: namespace, // Filter by namespace
        },
      });

      // Final cancellation check after Pinecone query
      if (abortSignal && abortSignal.aborted) {
        console.log("EmbeddingService: Query cancelled after Pinecone query");
        const abortError = new Error("Query was cancelled");
        abortError.name = "AbortError";
        throw abortError;
      }

      console.log(
        `Retrieved ${queryResult.matches.length} matches from Pinecone for namespace '${namespace}'`
      );

      // Convert query results back to code chunks
      return queryResult.matches.map((match) => ({
        id: match.id.replace(`${this.userId}_${namespace}_`, ""), // Remove namespace from ID
        content: match.metadata?.content as string,
        filePath: match.metadata?.filePath as string,
        startLine: match.metadata?.startLine as number,
        endLine: match.metadata?.endLine as number,
        type: match.metadata?.type as
          | "function"
          | "method"
          | "class"
          | "other",
        name: match.metadata?.name as string,
      }));
    } catch (error) {
      console.error("Error querying similar chunks:", error);
      vscode.window.showErrorMessage(
        `Failed to query similar chunks: ${error}`
      );
      throw error;
    }
  }

  /**
   * Clear all stored embeddings for the current workspace
   */
  public async clearWorkspaceEmbeddings(): Promise<void> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error("Failed to initialize embedding service");
      }
    }

    try {
      if (!this.pineconeClient) {
        throw new Error("Pinecone client not initialized");
      }

      const index = this.pineconeClient.index(this.indexName);

      // Delete only vectors for the current project
      await (index as any).deleteAll();

      this.lastIndexedProject = "";
      vscode.window.showInformationMessage(
        "Successfully cleared all stored code chunks for this workspace"
      );
    } catch (error) {
      console.error("Error clearing workspace embeddings:", error);
      vscode.window.showErrorMessage(
        `Failed to clear workspace embeddings: ${error}`
      );
      throw error;
    }
  }

  /**
   * Delete a specific chunk by ID from Pinecone
   * @param chunkId The ID of the chunk to delete
   */
  public async deleteChunk(chunkId: string): Promise<void> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error("Failed to initialize embedding service");
      }
    }

    if (!this.pineconeClient) {
      throw new Error("Pinecone client not initialized");
    }

    try {
      const index = this.pineconeClient.index(this.indexName);
      await index.deleteOne(chunkId);
      console.log(`Successfully deleted chunk: ${chunkId}`);
    } catch (error) {
      console.error(`Error deleting chunk ${chunkId}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple chunks by IDs from Pinecone
   * @param chunkIds Array of chunk IDs to delete
   */
  public async deleteChunks(chunkIds: string[]): Promise<void> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        throw new Error("Failed to initialize embedding service");
      }
    }

    if (!this.pineconeClient) {
      throw new Error("Pinecone client not initialized");
    }

    try {
      const index = this.pineconeClient.index(this.indexName);
      // Delete chunks in batches to avoid API limits
      const batchSize = 10;
      for (let i = 0; i < chunkIds.length; i += batchSize) {
        const batch = chunkIds.slice(i, i + batchSize);
        await index.deleteMany(batch);
        console.log(`Successfully deleted ${batch.length} chunks`);
      }
    } catch (error) {
      console.error(`Error deleting chunks:`, error);
      throw error;
    }
  }
}
