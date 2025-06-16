import * as vscode from "vscode";
import * as path from "path";
import { CodeChunk, parseFilesIntoChunks } from "./codeParser";
import { EmbeddingService } from "./embeddingService";
import { analyzeTestFiles } from "./testAnalyzer";
import * as crypto from 'crypto';

// Interface for tracking indexed file metadata
interface IndexedFileMetadata {
  filePath: string;
  lastModified: number;
  chunks: string[]; // IDs of chunks from this file
  checksum?: string;
  size?: number;
}

// Interface for project-level metadata
interface ProjectMetadata {
  totalFiles: number;
  lastFullIndex: number;
  version: string;
  includedFiles: string[];
  strategy: IndexingStrategy;
}

// Interface for indexing progress tracking
export interface IndexingProgress {
  current: number;
  total: number;
  currentFile: string;
  stage: 'scanning' | 'parsing' | 'embedding' | 'storing' | 'complete';
  message?: string;
}

// Configuration types
export type IndexingStrategy = 'incremental' | 'full' | 'smart';

// Interface for configuration settings
interface RAGConfiguration {
  autoIndexing: boolean;
  indexingStrategy: IndexingStrategy;
  indexingDelay: number;
  maxIndexSize: number;
  autoCleanup: boolean;
  cleanupThreshold: number;
  includePatterns: string[];
  excludePatterns: string[];
  enableProgressNotifications: boolean;
  batchSize: number;
}

/**
 * Service for handling Retrieval Augmented Generation (RAG) with code context
 */
export class RAGService {
  private embeddingService: EmbeddingService;
  private isIndexing: boolean = false;
  // File watching and management
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private indexedFiles: Map<string, IndexedFileMetadata> = new Map();
  private selectedFiles: vscode.Uri[] = [];
  private autoIndexingEnabled: boolean = true;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_DELAY = 2000; // Default delay, will be overridden by config
  private context: vscode.ExtensionContext | null = null;
  private readonly INDEXED_FILES_KEY = "ragService.indexedFiles";
  private readonly PROJECT_METADATA_KEY = "ragService.projectMetadata";
  
  // Enhanced configuration and lifecycle management
  private configuration: RAGConfiguration;
  private projectMetadata: ProjectMetadata | null = null;
  private progressCallback?: (progress: IndexingProgress) => void;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(context?: vscode.ExtensionContext) {
    this.embeddingService = new EmbeddingService();
    this.context = context || null;
    this.configuration = this.loadConfiguration();
    
    // Set up configuration change listener
    if (context) {
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration('tddAICompanion')) {
            this.configuration = this.loadConfiguration();
            this.handleConfigurationChange();
          }
        })
      );
    }
  }
  /**
   * Load configuration from VS Code settings
   */
  private loadConfiguration(): RAGConfiguration {
    const config = vscode.workspace.getConfiguration('tddAICompanion');
    
    return {
      autoIndexing: config.get('autoIndexing', true),
      indexingStrategy: config.get('indexingStrategy', 'smart') as IndexingStrategy,
      indexingDelay: config.get('indexingDelay', 2000),
      maxIndexSize: config.get('maxIndexSize', 10000),
      autoCleanup: config.get('autoCleanup', true),
      cleanupThreshold: config.get('cleanupThreshold', 30),
      includePatterns: config.get('indexIncludePatterns', [
        "**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx", "**/*.py", 
        "**/*.java", "**/*.cs", "**/*.cpp", "**/*.c", "**/*.h"
      ]),
      excludePatterns: config.get('indexExcludePatterns', [
        "**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", 
        "**/coverage/**", "**/*.min.js", "**/*.test.*", "**/*.spec.*"
      ]),
      enableProgressNotifications: config.get('enableProgressNotifications', true),
      batchSize: config.get('batchSize', 15)
    };
  }

  /**
   * Handle configuration changes
   */
  private handleConfigurationChange(): void {
    // Update auto-indexing based on new configuration
    this.setAutoIndexingEnabled(this.configuration.autoIndexing);
    
    // Restart file watcher with new patterns if needed
    if (this.fileWatcher) {
      this.setupFileWatcher();
    }
    
    // Update cleanup timer
    this.setupCleanupTimer();
  }

  /**
   * Set up automatic cleanup timer
   */
  private setupCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.configuration.autoCleanup) {
      // Run cleanup check daily
      this.cleanupTimer = setInterval(() => {
        this.performAutomaticCleanup();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }
  }

  /**
   * Perform automatic cleanup of old indexed content
   */
  private async performAutomaticCleanup(): Promise<void> {
    try {
      const now = Date.now();
      const thresholdMs = this.configuration.cleanupThreshold * 24 * 60 * 60 * 1000;
      let cleaned = 0;

      for (const [filePath, metadata] of this.indexedFiles.entries()) {
        if (now - metadata.lastModified > thresholdMs) {
          // Check if file still exists
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
          } catch {
            // File doesn't exist, clean it up
            await this.handleFileDeleted(filePath);
            cleaned++;
          }
        }
      }

      if (cleaned > 0 && this.configuration.enableProgressNotifications) {
        vscode.window.showInformationMessage(
          `Cleaned up ${cleaned} stale entries from index`
        );
      }
    } catch (error) {
      console.error('Error during automatic cleanup:', error);
    }
  }  /**
   * Initialize the RAG service and make sure all dependencies are set up
   */
  public async initialize(): Promise<boolean> {
    const result = await this.embeddingService.initialize();
    if (result) {
      await this.loadIndexedFilesFromStorage();
      await this.loadProjectMetadata();
      this.setupFileWatcher();
      this.setupCleanupTimer();
    }
    return result;
  }

  /**
   * Load project metadata from storage
   */
  private async loadProjectMetadata(): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      const storedData = this.context.globalState.get<ProjectMetadata>(this.PROJECT_METADATA_KEY);
      if (storedData) {
        this.projectMetadata = storedData;
        console.log(`Loaded project metadata: ${this.projectMetadata.totalFiles} files indexed`);
      }
    } catch (error) {
      console.error("Failed to load project metadata from storage:", error);
    }
  }

  /**
   * Save project metadata to storage
   */
  private async saveProjectMetadata(): Promise<void> {
    if (!this.context || !this.projectMetadata) {
      return;
    }

    try {
      await this.context.globalState.update(this.PROJECT_METADATA_KEY, this.projectMetadata);
    } catch (error) {
      console.error("Failed to save project metadata to storage:", error);
    }
  }

  /**
   * Load indexed files metadata from storage
   */
  private async loadIndexedFilesFromStorage(): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      const storedData = this.context.globalState.get<Array<[string, IndexedFileMetadata]>>(this.INDEXED_FILES_KEY);
      if (storedData) {
        this.indexedFiles = new Map(storedData);
        console.log(`Loaded ${this.indexedFiles.size} indexed files from storage`);
      }
    } catch (error) {
      console.error("Failed to load indexed files from storage:", error);
    }
  }

  /**
   * Save indexed files metadata to storage
   */
  private async saveIndexedFilesToStorage(): Promise<void> {
    if (!this.context) {
      return;
    }

    try {
      const dataToStore = Array.from(this.indexedFiles.entries());
      await this.context.globalState.update(this.INDEXED_FILES_KEY, dataToStore);
    } catch (error) {
      console.error("Failed to save indexed files to storage:", error);
    }
  }

  /**
   * Set the selected files that should be monitored for changes
   */
  public setSelectedFiles(files: vscode.Uri[]): void {
    this.selectedFiles = [...files];
    this.setupFileWatcher();
  }
  /**
   * Enable or disable automatic indexing when files change
   */
  public setAutoIndexingEnabled(enabled: boolean): void {
    this.configuration.autoIndexing = enabled;
    
    if (!enabled && this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    } else if (enabled && !this.fileWatcher) {
      this.setupFileWatcher();
    }

    // Save the configuration change
    const config = vscode.workspace.getConfiguration('tddAICompanion');
    config.update('autoIndexing', enabled, vscode.ConfigurationTarget.Workspace);
  }
  /**
   * Setup file system watcher for selected files
   */
  private setupFileWatcher(): void {
    // Dispose existing watcher
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    if (!this.configuration.autoIndexing || this.selectedFiles.length === 0) {
      return;
    }

    // Create file pattern for watching based on configuration
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    // Use configured include patterns
    const includePatterns = this.configuration.includePatterns.join(',');
    const pattern = new vscode.RelativePattern(workspaceFolder, `{${includePatterns}}`);
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Handle file changes
    this.fileWatcher.onDidChange((uri) => {
      if (this.shouldWatchFile(uri)) {
        this.handleFileChange(uri, 'changed');
      }
    });

    this.fileWatcher.onDidCreate((uri) => {
      if (this.shouldWatchFile(uri)) {
        this.handleFileChange(uri, 'created');
      }
    });

    this.fileWatcher.onDidDelete((uri) => {
      if (this.shouldWatchFile(uri)) {
        this.handleFileChange(uri, 'deleted');
      }
    });

    console.log(`File watcher setup with patterns: ${includePatterns}`);
  }

  /**
   * Check if a file should be watched based on configuration and selection
   */
  private shouldWatchFile(uri: vscode.Uri): boolean {
    const relativePath = this.getRelativePath(uri.fsPath);
    
    // Check exclude patterns
    for (const pattern of this.configuration.excludePatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return false;
      }
    }

    // Check if file is in selected files or if we're watching all matching files
    return this.selectedFiles.length === 0 || this.isFileSelected(uri);
  }

  /**
   * Simple pattern matching for file paths
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
  }

  /**
   * Check if a file is in the selected files list
   */
  private isFileSelected(uri: vscode.Uri): boolean {
    return this.selectedFiles.some(file => file.fsPath === uri.fsPath);
  }
  /**
   * Handle file change events with configurable debouncing
   */
  private handleFileChange(uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted'): void {
    if (this.isIndexing) {
      console.log(`Skipping file change handling - indexing in progress: ${uri.fsPath}`);
      return;
    }

    console.log(`File ${changeType}: ${uri.fsPath}`);

    // Clear existing debounce timer
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
    }

    // Set new debounce timer with configured delay
    this.watchDebounceTimer = setTimeout(async () => {
      try {
        await this.processFileChange(uri, changeType);
      } catch (error) {
        console.error(`Error processing file change for ${uri.fsPath}:`, error);
        if (this.configuration.enableProgressNotifications) {
          vscode.window.showErrorMessage(
            `Failed to update index for changed file: ${path.basename(uri.fsPath)}`
          );
        }
      }
    }, this.configuration.indexingDelay);
  }

  /**
   * Process a file change event with smart indexing strategy
   */
  private async processFileChange(uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted'): Promise<void> {
    const filePath = uri.fsPath;

    switch (changeType) {
      case 'deleted':
        await this.handleFileDeleted(filePath);
        break;
      case 'created':
      case 'changed':
        await this.handleFileModified(uri);
        break;
    }

    // Update project metadata after processing changes
    await this.updateProjectMetadata();
  }

  /**
   * Determine if we should perform incremental or full reindexing
   */
  private async shouldPerformFullReindex(): Promise<boolean> {
    if (this.configuration.indexingStrategy === 'full') {
      return true;
    }
    
    if (this.configuration.indexingStrategy === 'incremental') {
      return false;
    }

    // Smart strategy - decide based on various factors
    const totalIndexed = this.indexedFiles.size;
    const maxSize = this.configuration.maxIndexSize;
    
    // Perform full reindex if we're approaching the size limit
    if (totalIndexed > maxSize * 0.8) {
      console.log('Performing full reindex due to size limit approach');
      return true;
    }

    // Check if too many files have been modified recently
    const now = Date.now();
    const recentlyModified = Array.from(this.indexedFiles.values())
      .filter(metadata => now - metadata.lastModified < 60000) // Last minute
      .length;

    if (recentlyModified > totalIndexed * 0.3) {
      console.log('Performing full reindex due to many recent changes');
      return true;
    }

    return false;
  }

  /**
   * Handle when a file is deleted
   */
  private async handleFileDeleted(filePath: string): Promise<void> {
    const metadata = this.indexedFiles.get(filePath);
    if (!metadata) {
      return; // File wasn't indexed
    }

    console.log(`Removing deleted file from index: ${filePath}`);

    // Remove chunks associated with this file from the vector database
    if (metadata.chunks.length > 0) {
      try {
        await this.embeddingService.deleteChunks(metadata.chunks);
      } catch (error) {
        console.error(`Failed to delete chunks for file ${filePath}:`, error);
      }
    }

    // Remove from our tracking
    this.indexedFiles.delete(filePath);

    vscode.window.showInformationMessage(
      `Removed deleted file from index: ${path.basename(filePath)}`
    );
  }
  /**
   * Handle when a file is created or modified
   */
  private async handleFileModified(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    
    try {
      const stats = await vscode.workspace.fs.stat(uri);
      const lastModified = stats.mtime;
      const fileSize = stats.size;
      
      // Calculate checksum for accurate change detection
      const checksum = await this.calculateFileChecksum(uri);

      // Check if file needs reindexing
      const metadata = this.indexedFiles.get(filePath);
      if (metadata && 
          metadata.lastModified >= lastModified && 
          metadata.checksum === checksum) {
        console.log(`File ${filePath} already up to date`);
        return;
      }

      // Check if we should perform full reindex
      if (await this.shouldPerformFullReindex()) {
        if (this.configuration.enableProgressNotifications) {
          vscode.window.showInformationMessage(
            `Performing full reindex due to indexing strategy: ${this.configuration.indexingStrategy}`
          );
        }
        await this.forceReindexAllFiles();
        return;
      }

      console.log(`Reindexing modified file: ${filePath}`);

      // Show progress notification if enabled
      if (this.configuration.enableProgressNotifications) {
        vscode.window.showInformationMessage(
          `Updating index for: ${path.basename(filePath)}`
        );
      }

      // Remove old chunks if file was previously indexed
      if (metadata && metadata.chunks.length > 0) {
        try {
          await this.embeddingService.deleteChunks(metadata.chunks);
        } catch (error) {
          console.error(`Failed to delete old chunks for file ${filePath}:`, error);
        }
      }      // Parse and index the updated file
      const chunks = await parseFilesIntoChunks([uri]);
      if (chunks.length > 0) {
        // Determine namespace based on file type
        const relativePath = this.getRelativePath(filePath);
        const namespace = this.isTestFile(relativePath) ? "test_code" : "source_code";

        await this.embeddingService.storeCodeChunks(chunks, namespace, this.configuration.batchSize);

        // Update our tracking with enhanced metadata
        const newMetadata: IndexedFileMetadata = {
          filePath,
          lastModified,
          chunks: chunks.map(chunk => `${namespace}_${chunk.id}`),
          checksum,
          size: fileSize
        };
        this.indexedFiles.set(filePath, newMetadata);

        if (this.configuration.enableProgressNotifications) {
          vscode.window.showInformationMessage(
            `Updated index for: ${path.basename(filePath)} (${chunks.length} chunks)`
          );
        }
      } else {
        // No chunks found, but remove from tracking if previously indexed
        if (metadata) {
          this.indexedFiles.delete(filePath);
        }
      }
    } catch (error) {
      console.error(`Error handling file modification for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if a file is a test file based on its path
   */
  private isTestFile(relativePath: string): boolean {
    return (
      relativePath.includes("/test/") ||
      relativePath.endsWith(".test.ts") ||
      relativePath.endsWith(".spec.ts") ||
      relativePath.endsWith(".test.js") ||
      relativePath.endsWith(".spec.js")
    );
  }
  /**
   * Get current indexing status with enhanced information
   */
  public getIndexingStatus(): {
    isIndexing: boolean;
    indexedFilesCount: number;
    autoIndexingEnabled: boolean;
    selectedFilesCount: number;
    strategy: IndexingStrategy;
    lastFullIndex?: number;
    totalChunks: number;
    configuration: RAGConfiguration;
  } {
    const totalChunks = Array.from(this.indexedFiles.values())
      .reduce((sum, metadata) => sum + metadata.chunks.length, 0);

    return {
      isIndexing: this.isIndexing,
      indexedFilesCount: this.indexedFiles.size,
      autoIndexingEnabled: this.configuration.autoIndexing,
      selectedFilesCount: this.selectedFiles.length,
      strategy: this.configuration.indexingStrategy,
      lastFullIndex: this.projectMetadata?.lastFullIndex,
      totalChunks,
      configuration: { ...this.configuration }
    };
  }

  /**
   * Set progress callback for indexing operations
   */
  public setProgressCallback(callback?: (progress: IndexingProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Get detailed project statistics
   */
  public getProjectStatistics(): {
    totalFiles: number;
    sourceFiles: number;
    testFiles: number;
    totalChunks: number;
    averageChunksPerFile: number;
    lastIndexed: number;
    indexSize: number;
    strategyUsed: IndexingStrategy;
  } {
    const sourceFiles = Array.from(this.indexedFiles.entries())
      .filter(([filePath]) => !this.isTestFile(this.getRelativePath(filePath)))
      .length;

    const testFiles = this.indexedFiles.size - sourceFiles;
    const totalChunks = Array.from(this.indexedFiles.values())
      .reduce((sum, metadata) => sum + metadata.chunks.length, 0);

    return {
      totalFiles: this.indexedFiles.size,
      sourceFiles,
      testFiles,
      totalChunks,
      averageChunksPerFile: this.indexedFiles.size > 0 ? totalChunks / this.indexedFiles.size : 0,
      lastIndexed: this.projectMetadata?.lastFullIndex || 0,
      indexSize: totalChunks,
      strategyUsed: this.configuration.indexingStrategy
    };
  }

  /**
   * Perform manual cleanup of the index
   */
  public async performManualCleanup(): Promise<{
    removedFiles: number;
    removedChunks: number;
    errors: string[];
  }> {
    const result = {
      removedFiles: 0,
      removedChunks: 0,
      errors: [] as string[]
    };

    const filesToRemove: string[] = [];

    // Check each indexed file
    for (const [filePath, metadata] of this.indexedFiles.entries()) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      } catch {
        // File doesn't exist anymore
        filesToRemove.push(filePath);
        result.removedChunks += metadata.chunks.length;
      }
    }

    // Remove non-existent files
    for (const filePath of filesToRemove) {
      try {
        await this.handleFileDeleted(filePath);
        result.removedFiles++;
      } catch (error) {
        result.errors.push(`Failed to remove ${filePath}: ${error}`);
      }
    }

    await this.updateProjectMetadata();

    if (this.configuration.enableProgressNotifications) {
      vscode.window.showInformationMessage(
        `Cleanup complete: removed ${result.removedFiles} files and ${result.removedChunks} chunks`
      );
    }

    return result;
  }

  /**
   * Clean up resources when the service is disposed
   */
  public dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.progressCallback = undefined;
  }
  /**
   * Index all project code files by function level for RAG with enhanced progress tracking
   */
  public async indexProjectFiles(
    files: vscode.Uri[],
    progressCallback?: (progress: IndexingProgress) => void
  ): Promise<boolean> {
    if (this.isIndexing) {
      if (this.configuration.enableProgressNotifications) {
        vscode.window.showWarningMessage(
          "Indexing is already in progress. Please wait for it to complete."
        );
      }
      return false;
    }

    this.isIndexing = true;
    this.progressCallback = progressCallback;

    try {
      // Initialize progress tracking
      const progress: IndexingProgress = {
        current: 0,
        total: files.length,
        currentFile: '',
        stage: 'scanning',
        message: 'Starting indexing process...'
      };

      this.reportProgress(progress);

      if (this.configuration.enableProgressNotifications) {
        vscode.window.showInformationMessage(
          `Starting to index ${files.length} files using ${this.configuration.indexingStrategy} strategy...`
        );
      }

      // Update selected files for file watching
      this.setSelectedFiles(files);

      // Categorize files
      progress.stage = 'scanning';
      progress.message = 'Categorizing files...';
      this.reportProgress(progress);

      const sourceFiles: vscode.Uri[] = [];
      const testFiles: vscode.Uri[] = [];

      files.forEach((file) => {
        const relativePath = this.getRelativePath(file.fsPath);
        if (this.isTestFile(relativePath)) {
          testFiles.push(file);
        } else {
          sourceFiles.push(file);
        }
      });      let success = true;
      let currentIndex = 0;

      // Index source files with better batch processing
      if (sourceFiles.length > 0) {
        success = await this.indexFilesInBatches(
          sourceFiles, 
          "source_code", 
          progress, 
          currentIndex
        ) && success;
        currentIndex += sourceFiles.length;
      }

      // Index test files with better batch processing  
      if (testFiles.length > 0) {
        success = await this.indexFilesInBatches(
          testFiles, 
          "test_code", 
          progress, 
          currentIndex
        ) && success;
      }

      // Complete progress
      progress.stage = 'complete';
      progress.current = progress.total;
      progress.message = 'Indexing completed successfully';
      this.reportProgress(progress);

      // Update project metadata
      if (this.projectMetadata) {
        this.projectMetadata.lastFullIndex = Date.now();
      }
      await this.updateProjectMetadata();

      if (sourceFiles.length === 0 && testFiles.length === 0) {
        if (this.configuration.enableProgressNotifications) {
          vscode.window.showWarningMessage(
            "No code files were found in the selected files."
          );
        }
        success = false;
      } else if (success) {
        if (this.configuration.enableProgressNotifications) {
          vscode.window.showInformationMessage(
            `Successfully indexed all relevant code chunks. Auto-indexing enabled for future changes.`
          );
        }
      }

      this.isIndexing = false;
      this.progressCallback = undefined;
      return success;
    } catch (error) {
      console.error("Error indexing project files:", error);
      if (this.configuration.enableProgressNotifications) {
        vscode.window.showErrorMessage(
          `Failed to index project files: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      this.isIndexing = false;
      this.progressCallback = undefined;
      return false;
    }
  }

  /**
   * Index files in smaller batches for better progress tracking and performance
   */
  private async indexFilesInBatches(
    files: vscode.Uri[],
    namespace: string,
    progress: IndexingProgress,
    startIndex: number
  ): Promise<boolean> {
    const fileBatchSize = Math.max(5, Math.floor(this.configuration.batchSize / 3)); // Process files in smaller batches
    let allChunks: CodeChunk[] = [];
    let success = true;

    // Process files in batches for better progress tracking
    for (let i = 0; i < files.length; i += fileBatchSize) {
      const fileBatch = files.slice(i, i + fileBatchSize);
      const batchNumber = Math.floor(i / fileBatchSize) + 1;
      const totalBatches = Math.ceil(files.length / fileBatchSize);

      // Update progress for parsing this batch
      progress.stage = 'parsing';
      progress.current = startIndex + i;
      progress.message = `Parsing ${namespace} files (batch ${batchNumber}/${totalBatches}): ${fileBatch.length} files...`;
      progress.currentFile = fileBatch[0].fsPath;
      this.reportProgress(progress);

      try {
        // Parse this batch of files
        const batchChunks = await parseFilesIntoChunks(fileBatch);
        
        if (batchChunks.length > 0) {
          allChunks.push(...batchChunks);
          
          // Show progress notification for this batch
          if (this.configuration.enableProgressNotifications && totalBatches > 1) {
            vscode.window.showInformationMessage(
              `Parsed ${namespace} batch ${batchNumber}/${totalBatches}: ${batchChunks.length} chunks from ${fileBatch.length} files`
            );
          }
        }
      } catch (error) {
        console.error(`Error parsing ${namespace} file batch ${batchNumber}:`, error);
        success = false;
      }
    }

    // Now process all chunks for embedding and storage
    if (allChunks.length > 0) {
      progress.stage = 'embedding';
      progress.current = startIndex + files.length;
      progress.message = `Creating embeddings for ${allChunks.length} ${namespace} chunks...`;
      this.reportProgress(progress);

      if (this.configuration.enableProgressNotifications) {
        vscode.window.showInformationMessage(
          `Generating embeddings for ${allChunks.length} ${namespace} chunks using batch size ${this.configuration.batchSize}...`
        );
      }

      progress.stage = 'storing';
      progress.message = `Storing ${allChunks.length} ${namespace} embeddings...`;
      this.reportProgress(progress);      try {
        await this.embeddingService.storeCodeChunks(allChunks, namespace, this.configuration.batchSize, (processed, total, batchNum) => {
          // Update progress during embedding storage
          progress.current = startIndex + Math.floor((processed / total) * files.length);
          progress.message = `Storing ${namespace} embeddings: batch ${batchNum}, ${processed}/${total} chunks`;
          this.reportProgress(progress);
        });
        
        // Update tracking for all files
        await this.updateFileTracking(files, allChunks, namespace);

        if (this.configuration.enableProgressNotifications) {
          vscode.window.showInformationMessage(
            `Successfully stored ${allChunks.length} ${namespace} embeddings`
          );
        }
      } catch (error) {
        console.error(`Error storing ${namespace} embeddings:`, error);
        success = false;
        if (this.configuration.enableProgressNotifications) {
          vscode.window.showErrorMessage(
            `Failed to store ${namespace} embeddings: ${error}`
          );
        }
      }
    } else {
      if (this.configuration.enableProgressNotifications) {
        vscode.window.showWarningMessage(
          `No ${namespace} chunks were found in the selected files.`
        );
      }
      success = false;
    }

    return success;
  }

  /**
   * Report progress to callback if available
   */
  private reportProgress(progress: IndexingProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }
  /**
   * Update file tracking metadata after indexing
   */
  private async updateFileTracking(
    files: vscode.Uri[],
    chunks: CodeChunk[],
    namespace: string
  ): Promise<void> {
    // Group chunks by file path
    const chunksByFile = new Map<string, string[]>();
    chunks.forEach(chunk => {
      const fileChunks = chunksByFile.get(chunk.filePath) || [];
      fileChunks.push(`${namespace}_${chunk.id}`);
      chunksByFile.set(chunk.filePath, fileChunks);
    });

    // Update tracking for each file
    for (const file of files) {
      try {
        const stats = await vscode.workspace.fs.stat(file);
        const fileChunks = chunksByFile.get(file.fsPath) || [];
        
        const metadata: IndexedFileMetadata = {
          filePath: file.fsPath,
          lastModified: stats.mtime,
          chunks: fileChunks
        };
        
        this.indexedFiles.set(file.fsPath, metadata);
      } catch (error) {
        console.error(`Failed to update tracking for file ${file.fsPath}:`, error);
      }
    }

    // Save to storage
    await this.saveIndexedFilesToStorage();
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

  /**
   * Update project metadata after changes
   */
  private async updateProjectMetadata(): Promise<void> {
    if (!this.projectMetadata) {
      this.projectMetadata = {
        totalFiles: this.indexedFiles.size,
        lastFullIndex: Date.now(),
        version: '1.0.0',
        includedFiles: Array.from(this.indexedFiles.keys()),
        strategy: this.configuration.indexingStrategy
      };
    } else {
      this.projectMetadata.totalFiles = this.indexedFiles.size;
      this.projectMetadata.includedFiles = Array.from(this.indexedFiles.keys());
      this.projectMetadata.strategy = this.configuration.indexingStrategy;
    }

    await this.saveProjectMetadata();
  }

  /**
   * Calculate file checksum for change detection
   */
  private async calculateFileChecksum(uri: vscode.Uri): Promise<string> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const hash = crypto.createHash('sha256');
      hash.update(content);
      return hash.digest('hex');
    } catch (error) {
      console.error(`Failed to calculate checksum for ${uri.fsPath}:`, error);
      return '';
    }
  }

  /**
   * Force reindex all selected files
   */
  public async forceReindexAllFiles(): Promise<boolean> {
    if (this.selectedFiles.length === 0) {
      if (this.configuration.enableProgressNotifications) {
        vscode.window.showWarningMessage("No files selected for indexing.");
      }
      return false;
    }

    // Clear existing tracking
    this.indexedFiles.clear();

    // Clear the index completely before reindexing
    try {
      await this.embeddingService.clearWorkspaceEmbeddings();
    } catch (error) {
      console.error('Error clearing index before reindexing:', error);
    }

    // Reindex all selected files
    return await this.indexProjectFiles(this.selectedFiles);
  }
}
