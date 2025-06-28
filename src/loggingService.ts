import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Event type definitions
export interface BaseEvent {
  timestamp: string;
  participantId: string;
  sessionId: string;
  eventType: string;
}

export interface SuggestionProvidedEvent extends BaseEvent {
  eventType: 'suggestion_provided';
  suggestionId: string;
  suggestionSource: string; // 'suggest_test_button' | 'chat_query' | 'auto_suggestion'
  suggestionText: string;
  context: {
    feature: string;
    sourceFiles: string[];
    testFiles: string[];
    tokenCount: number;
  };
}

export interface SuggestionInteractionEvent extends BaseEvent {
  eventType: 'suggestion_interaction_event';
  suggestionId: string;
  interactionType: 'used' | 'modified' | 'inspired' | 'ignored';
  interactionTimestamp: string;
}

export interface ChatQuerySentEvent extends BaseEvent {
  eventType: 'chat_query_sent';
  queryId: string;
  queryText: string;
  querySource: string; // 'manual_input' | 'suggest_test_button'
}

export interface ChatResponseReceivedEvent extends BaseEvent {
  eventType: 'chat_response_received';
  queryId: string;
  responseText: string;
  responseTokenCount?: number;
  totalInputTokens?: number;
}

export interface FileSavedEvent extends BaseEvent {
  eventType: 'file_saved';
  filePath: string;
  fileType: 'source' | 'test' | 'other';
  fileContent?: string; // Optional: full content or diff
  isSelectedFile?: boolean; // Whether this file is part of user's selected source/test files
  selectedFileType?: 'source' | 'test'; // Which type of selected file this is
}

export interface TestRunInitiatedEvent extends BaseEvent {
  eventType: 'test_run_initiated';
  testScope: string; // 'all' | 'file' | 'specific'
  testCommand?: string;
}

export interface TestRunCompletedEvent extends BaseEvent {
  eventType: 'test_run_completed';
  overallStatus: 'pass' | 'fail' | 'error';
  testResults: {
    passCount: number;
    failCount: number;
    errorCount: number;
    failingTests?: string[];
    erroringTests?: string[];
  };
}

export interface ExperimentSessionStartEvent extends BaseEvent {
  eventType: 'experiment_session_start';
  conditionOrder: string[];
}

export interface TaskStartEvent extends BaseEvent {
  eventType: 'task_start';
  taskId: string;
  condition: 'LLM' | 'Traditional';
}

export interface TaskEndEvent extends BaseEvent {
  eventType: 'task_end';
  taskId: string;
  duration: number; // in milliseconds
}

export interface FileSelectionEvent extends BaseEvent {
  eventType: 'file_selection_changed';
  action: 'selected' | 'deselected';
  fileType: 'source' | 'test';
  filePath: string;
  fileName: string;
  currentSelection: {
    sourceFiles: string[];
    testFiles: string[];
    totalSourceFiles: number;
    totalTestFiles: number;
  };
}

export interface BulkFileSelectionEvent extends BaseEvent {
  eventType: 'bulk_file_selection';
  action: 'source_files_updated' | 'test_files_updated' | 'all_files_updated';
  changes: {
    added: string[];
    removed: string[];
  };
  currentSelection: {
    sourceFiles: string[];
    testFiles: string[];
    totalSourceFiles: number;
    totalTestFiles: number;
  };
}

export type LogEvent = 
  | SuggestionProvidedEvent
  | SuggestionInteractionEvent
  | ChatQuerySentEvent
  | ChatResponseReceivedEvent
  | FileSavedEvent
  | TestRunInitiatedEvent
  | TestRunCompletedEvent
  | ExperimentSessionStartEvent
  | TaskStartEvent
  | TaskEndEvent
  | FileSelectionEvent
  | BulkFileSelectionEvent;

export class LoggingService {
  private context: vscode.ExtensionContext;
  private participantId: string = '';
  private sessionId: string = '';
  private logFilePath: string = '';
  private currentTaskId: string = '';
  private taskStartTime: number = 0;
  private fileWatcher?: vscode.FileSystemWatcher;
  private activeQueryMap: Map<string, string> = new Map(); // queryId -> suggestionId mapping
  private disposables: vscode.Disposable[] = []; // For cleanup
  
  // Track selected files for more targeted logging
  private selectedSourceFiles: Set<string> = new Set(); // Set of file paths
  private selectedTestFiles: Set<string> = new Set(); // Set of file paths

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initialize();
  }
  private async initialize(): Promise<void> {
    // Check if logging is enabled
    const config = vscode.workspace.getConfiguration('tddAICompanion');
    const loggingEnabled = config.get('enableLogging', true);
    
    if (!loggingEnabled) {
      console.log('Logging is disabled in settings');
      return;
    }

    // Generate or load participant ID
    this.participantId = this.context.globalState.get('participantId') || '';
    if (!this.participantId) {
      this.participantId = this.generateUniqueId('participant');
      await this.context.globalState.update('participantId', this.participantId);
    }

    // Generate session ID for this VS Code session
    this.sessionId = this.generateUniqueId('session');

    // Set up log file path
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const logDir = path.join(workspaceFolder.uri.fsPath, '.tdd-ai-logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logFilePath = path.join(logDir, `tdd-ai-log-${this.sessionId}.jsonl`);
    }    // Set up file watchers for development activity logging
    const logLevel = config.get('logLevel', 'standard') as string;
    console.log('[LoggingService] Current log level:', logLevel);
    if (logLevel === 'detailed' || logLevel === 'standard') {
      console.log('[LoggingService] Setting up file watchers...');
      this.setupFileWatchers();
    } else {
      console.log('[LoggingService] File watchers disabled for log level:', logLevel);
    }

    // Log session start
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'experiment_session_start',
      conditionOrder: ['LLM'] // Default condition for this extension
    } as ExperimentSessionStartEvent);
  }

  private generateUniqueId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  }
  private setupFileWatchers(): void {
    // Watch for file saves in the workspace
    if (vscode.workspace.workspaceFolders) {
      console.log('[LoggingService] Setting up file watchers for workspace:', vscode.workspace.workspaceFolders[0].uri.fsPath);
      this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
      
      // Listen for file changes (saves)
      this.fileWatcher.onDidChange(async (uri) => {
        console.log('[LoggingService] File changed:', uri.fsPath);
        await this.handleFileSaved(uri);
      });

      this.fileWatcher.onDidCreate(async (uri) => {
        console.log('[LoggingService] File created:', uri.fsPath);
        await this.handleFileSaved(uri);
      });
    } else {
      console.log('[LoggingService] No workspace folders found, file watching disabled');
    }

    // Listen for test runs (this might need integration with specific test runners)
    this.setupTestRunListeners();
  }  private async handleFileSaved(uri: vscode.Uri): Promise<void> {
    try {
      const filePath = uri.fsPath;
      const fileName = path.basename(filePath);
      
      console.log('[LoggingService] handleFileSaved called for:', filePath);
      
      // Skip log files and other non-relevant files
      if (fileName.includes('.tdd-ai-log') || fileName.startsWith('.')) {
        console.log('[LoggingService] Skipping file (log file or hidden):', fileName);
        return;
      }      // Determine file type
      // REMOVED - we now only use selectedFileType since we only log selected files// Check if this file is part of user's selected files
      let isSelectedFile = false;
      let selectedFileType: 'source' | 'test' | undefined;
      
      if (this.selectedSourceFiles.has(filePath)) {
        isSelectedFile = true;
        selectedFileType = 'source';
      } else if (this.selectedTestFiles.has(filePath)) {
        isSelectedFile = true;
        selectedFileType = 'test';
      }

      // ONLY log files that are part of user's selected source or test files
      if (!isSelectedFile) {
        console.log('[LoggingService] Skipping file (not selected by user):', filePath);
        return;
      }

      console.log('[LoggingService] Logging selected file save:', filePath, 'type:', selectedFileType);

      // Use the selected file type for logging
      let fileType: 'source' | 'test' | 'other' = selectedFileType || 'other';

      // Read file content (optional - can be disabled for privacy)
      let fileContent: string | undefined;
      const config = vscode.workspace.getConfiguration('tddAICompanion');
      const logFileContent = config.get('logFileContent', false);
      
      if (logFileContent) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          fileContent = document.getText();
        } catch (error) {
          console.warn('Could not read file content for logging:', error);
        }
      }      await this.logEvent({
        timestamp: new Date().toISOString(),
        participantId: this.participantId,
        sessionId: this.sessionId,
        eventType: 'file_saved',
        filePath: filePath,
        fileType: fileType,
        fileContent: fileContent,
        isSelectedFile: true, // Always true since we only get here for selected files
        selectedFileType: selectedFileType
      } as FileSavedEvent);
      
      console.log('[LoggingService] Successfully logged file save event for selected file:', filePath);
    } catch (error) {
      console.error('Error logging file save event:', error);
    }
  }
  private setupTestRunListeners(): void {
    // Listen for VS Code test run events
    if (vscode.tests) {
      // Register test run profile listener
      const testController = vscode.tests.createTestController('tdd-ai-companion-test-watcher', 'TDD AI Companion Test Watcher');
      this.disposables.push(testController);      // Listen for test run requests
      testController.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, (request, token) => {
        const testFiles = request.include?.map(test => test.uri?.fsPath || test.id) || [];
        this.logTestRunInitiated(
          'vscode-test-run',
          `VS Code test run: ${testFiles.join(', ')}`
        );
      });
    }

    // Also listen for terminal commands that might indicate test runs
    vscode.window.onDidOpenTerminal(async (terminal) => {
      // This is a basic implementation - in practice, you'd need to hook into specific test runners
      console.log('Terminal opened - potential test run location');
    });    // Listen for task execution which might include test runs
    vscode.tasks.onDidStartTask((e) => {
      const taskName = e.execution.task.name;
      if (taskName.toLowerCase().includes('test') || taskName.toLowerCase().includes('spec')) {
        this.logTestRunInitiated(
          `task: ${taskName}`,
          `Task execution: ${taskName}`
        );
      }
    });

    vscode.tasks.onDidEndTask((e) => {
      const taskName = e.execution.task.name;
      if (taskName.toLowerCase().includes('test') || taskName.toLowerCase().includes('spec')) {        this.logTestRunCompleted(
          'pass', // Default to pass since we can't determine from task events
          {
            passCount: 0,
            failCount: 0,
            errorCount: 0,
            failingTests: [],
            erroringTests: []
          }
        );
      }
    });
  }

  // Public methods for logging specific events

  public async logSuggestionProvided(
    suggestionId: string,
    suggestionSource: string,
    suggestionText: string,
    context: {
      feature: string;
      sourceFiles: string[];
      testFiles: string[];
      tokenCount: number;
    }
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'suggestion_provided',
      suggestionId,
      suggestionSource,
      suggestionText,
      context
    } as SuggestionProvidedEvent);
  }

  public async logSuggestionInteraction(
    suggestionId: string,
    interactionType: 'used' | 'modified' | 'inspired' | 'ignored'
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'suggestion_interaction_event',
      suggestionId,
      interactionType,
      interactionTimestamp: new Date().toISOString()
    } as SuggestionInteractionEvent);
  }

  public async logChatQuerySent(
    queryId: string,
    queryText: string,
    querySource: string,
    linkedSuggestionId?: string
  ): Promise<void> {
    // Store the mapping between query and suggestion if provided
    if (linkedSuggestionId) {
      this.activeQueryMap.set(queryId, linkedSuggestionId);
    }

    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'chat_query_sent',
      queryId,
      queryText,
      querySource
    } as ChatQuerySentEvent);
  }

  public async logChatResponseReceived(
    queryId: string,
    responseText: string,
    responseTokenCount?: number,
    totalInputTokens?: number
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'chat_response_received',
      queryId,
      responseText,
      responseTokenCount,
      totalInputTokens
    } as ChatResponseReceivedEvent);
  }

  public async logTestRunInitiated(
    testScope: string,
    testCommand?: string
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'test_run_initiated',
      testScope,
      testCommand
    } as TestRunInitiatedEvent);
  }

  public async logTestRunCompleted(
    overallStatus: 'pass' | 'fail' | 'error',
    testResults: {
      passCount: number;
      failCount: number;
      errorCount: number;
      failingTests?: string[];
      erroringTests?: string[];
    }
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'test_run_completed',
      overallStatus,
      testResults
    } as TestRunCompletedEvent);
  }

  public async logTaskStart(
    taskId: string,
    condition: 'LLM' | 'Traditional'
  ): Promise<void> {
    this.currentTaskId = taskId;
    this.taskStartTime = Date.now();

    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'task_start',
      taskId,
      condition
    } as TaskStartEvent);
  }

  public async logTaskEnd(taskId?: string): Promise<void> {
    const endTime = Date.now();
    const duration = this.taskStartTime ? endTime - this.taskStartTime : 0;
    const finalTaskId = taskId || this.currentTaskId;

    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'task_end',
      taskId: finalTaskId,
      duration
    } as TaskEndEvent);

    // Reset task tracking
    this.currentTaskId = '';
    this.taskStartTime = 0;
  }

  public async logFileSelection(
    action: 'selected' | 'deselected',
    fileType: 'source' | 'test',
    filePath: string,
    currentSourceFiles: string[],
    currentTestFiles: string[]
  ): Promise<void> {
    const fileName = path.basename(filePath);
    
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'file_selection_changed',
      action,
      fileType,
      filePath,
      fileName,
      currentSelection: {
        sourceFiles: currentSourceFiles,
        testFiles: currentTestFiles,
        totalSourceFiles: currentSourceFiles.length,
        totalTestFiles: currentTestFiles.length
      }
    } as FileSelectionEvent);
  }

  public async logBulkFileSelection(
    action: 'source_files_updated' | 'test_files_updated' | 'all_files_updated',
    addedFiles: string[],
    removedFiles: string[],
    currentSourceFiles: string[],
    currentTestFiles: string[]
  ): Promise<void> {
    await this.logEvent({
      timestamp: new Date().toISOString(),
      participantId: this.participantId,
      sessionId: this.sessionId,
      eventType: 'bulk_file_selection',
      action,
      changes: {
        added: addedFiles,
        removed: removedFiles
      },
      currentSelection: {
        sourceFiles: currentSourceFiles,
        testFiles: currentTestFiles,
        totalSourceFiles: currentSourceFiles.length,
        totalTestFiles: currentTestFiles.length
      }
    } as BulkFileSelectionEvent);
  }

  private async logEvent(event: LogEvent): Promise<void> {
    try {
      // Check if logging is enabled
      const config = vscode.workspace.getConfiguration('tddAICompanion');
      const loggingEnabled = config.get('enableLogging', true);
      
      if (!loggingEnabled || !this.logFilePath) {
        return;
      }      // Check log level filtering
      const logLevel = config.get('logLevel', 'standard') as string;
      if (logLevel === 'minimal') {
        // Only log essential events
        const essentialEvents = ['suggestion_provided', 'suggestion_interaction_event', 'chat_query_sent', 'chat_response_received', 'user_feedback'];
        if (!essentialEvents.includes(event.eventType)) {
          console.log(`[LoggingService] Event ${event.eventType} filtered out by minimal log level`);
          return;
        }
      } else if (logLevel === 'standard') {        // Log most user interactions and AI responses (including file saves)
        const standardEvents = [
          'suggestion_provided', 'suggestion_interaction_event', 
          'chat_query_sent', 'chat_response_received', 'user_feedback',
          'file_saved', 'test_run_initiated', 'test_run_completed',
          'experiment_session_start', 'task_start', 'task_end',
          'file_selection_changed', 'bulk_file_selection'
        ];
        if (!standardEvents.includes(event.eventType)) {
          console.log(`[LoggingService] Event ${event.eventType} filtered out by standard log level`);
          return;
        }
      }
      // 'detailed' level logs everything

      // Write event as JSON Lines format (one JSON object per line)
      const logLine = JSON.stringify(event) + '\n';
      fs.appendFileSync(this.logFilePath, logLine, 'utf8');

      console.log(`Logged event: ${event.eventType}`, event);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  // Utility methods
  public getParticipantId(): string {
    return this.participantId;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getCurrentTaskId(): string {
    return this.currentTaskId;
  }

  // Get suggestion ID linked to a query ID
  public getSuggestionIdForQuery(queryId: string): string | undefined {
    return this.activeQueryMap.get(queryId);
  }

  // Methods to update selected files for targeted logging
  public updateSelectedSourceFiles(sourceFiles: string[]): void {
    this.selectedSourceFiles.clear();
    sourceFiles.forEach(filePath => {
      this.selectedSourceFiles.add(filePath);
    });
  }

  public updateSelectedTestFiles(testFiles: string[]): void {
    this.selectedTestFiles.clear();
    testFiles.forEach(filePath => {
      this.selectedTestFiles.add(filePath);
    });
  }

  public updateSelectedFiles(sourceFiles: string[], testFiles: string[]): void {
    this.updateSelectedSourceFiles(sourceFiles);
    this.updateSelectedTestFiles(testFiles);
  }

  public dispose(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Clean up disposables
    this.disposables.forEach(disposable => disposable.dispose());
    this.disposables = [];

    // Log session end if there's an active task
    if (this.currentTaskId) {
      this.logTaskEnd();
    }
  }
}
