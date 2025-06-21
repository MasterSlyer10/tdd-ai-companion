# TDD AI Companion

<!-- Icon reference removed due to SVG limitations in GitHub markdown -->

## Overview

TDD AI Companion is a VS Code extension that assists developers with Test-Driven Development (TDD) by leveraging AI to suggest test cases, help implement code based on tests, and provide guidance throughout the TDD process.

This extension uses Google's Gemini AI and RAG (Retrieval-Augmented Generation) to provide context-aware assistance tailored to your project.

## Features

- **AI-Powered Test Suggestions**: Get intelligent test case suggestions based on your current codebase and feature requirements
- **Contextual Code Generation**: Recommend implementation code that passes your tests
- **Project Setup Assistance**: Configure your project for effective TDD
- **RAG-Enhanced Context**: Uses Retrieval-Augmented Generation to provide more accurate and relevant suggestions
- **Dedicated Sidebar Interface**: Access all TDD AI Companion features from a convenient sidebar
- **🚀 Auto-Indexing System**: Intelligent automatic management of your codebase embeddings
  - **Smart File Watching**: Automatically detects file changes and updates embeddings
  - **Configurable Strategies**: Choose between smart, incremental, or full indexing approaches
  - **Real-time Status**: Monitor indexing progress and index statistics
  - **Manual Controls**: Force updates or disable auto-indexing as needed
  - **Pattern-based Filtering**: Include/exclude specific file patterns from indexing

<!-- Screenshot will be added in future releases -->
<!-- No screenshot available yet -->

## Installation Instructions (VSIX)

Since this extension is not published to the VS Code marketplace, you'll need to install it using the VSIX file:

1. **Download the VSIX file** from the project's distribution location
2. **Install using one of these methods**:

   - **Method 1: From VS Code UI**
     - Open VS Code
     - Go to Extensions view (Ctrl+Shift+X)
     - Click on the "..." menu (top-right of Extensions view)
     - Select "Install from VSIX..."
     - Navigate to the downloaded VSIX file and select it
   - **Method 2: Using Command Palette**
     - Open VS Code
     - Press Ctrl+Shift+P to open Command Palette
     - Type "vsix" and select "Extensions: Install from VSIX..."
     - Navigate to the downloaded VSIX file and select it
   - **Method 3: Using Terminal**
     - Open a terminal/command prompt
     - Navigate to the folder containing the VSIX file
     - Run: `code --install-extension tdd-ai-companion-0.0.1.vsix`

3. **Restart VS Code** after installation (if prompted)

## Requirements

To use this extension, you'll need:

1. **Google Gemini API Key**: Required for generating test suggestions and code implementations
   - Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - You **MUST** have this key to use any AI features in the extension
2. **Pinecone API Key**: Required for the RAG (Retrieval-Augmented Generation) functionality
   - Sign up at [Pinecone](https://www.pinecone.io/) and create an API key
   - Required for advanced context-aware suggestions
   - The extension will not be able to index your codebase without this key

> ⚠️ **IMPORTANT**: This extension will not function properly without these API keys. They must be added to the extension settings before use.

## Extension Settings

This extension contributes the following settings:

### Core Settings

- `tddAICompanion.geminiApiKey`: API key for Google Gemini
- `tddAICompanion.pineconeApiKey`: API key for Pinecone vector database
- `tddAICompanion.userId`: Unique identifier for the user (automatically generated if not set)

### Auto-Indexing Settings

- `tddAiCompanion.autoIndexing.enabled`: Enable/disable automatic indexing (default: true)
- `tddAiCompanion.autoIndexing.strategy`: Indexing strategy - "smart", "incremental", or "full" (default: "smart")
- `tddAiCompanion.autoIndexing.delay`: Debounce delay in milliseconds (default: 2000)
- `tddAiCompanion.autoIndexing.includePatterns`: File patterns to include in indexing
- `tddAiCompanion.autoIndexing.excludePatterns`: File patterns to exclude from indexing
- `tddAiCompanion.autoIndexing.maxFileSize`: Maximum file size to index in bytes (default: 1MB)
- `tddAiCompanion.autoIndexing.batchSize`: Number of code chunks to process per batch for optimal performance (default: 15)
- `tddAiCompanion.autoIndexing.autoCleanup`: Automatically remove deleted files from index (default: true)
- `tddAiCompanion.autoIndexing.trackChanges`: Enable file change tracking with checksums (default: true)
- `tddAiCompanion.autoIndexing.showProgress`: Show detailed progress information (default: true)

> 📚 **For detailed auto-indexing documentation**, see [AUTO_INDEXING_SYSTEM.md](./AUTO_INDEXING_SYSTEM.md)

## Getting Started

1. **Install the extension** using the VSIX file (see Installation Instructions)
2. **Configure your API Keys** (REQUIRED):

   - Open VS Code Settings (Ctrl+,)
   - Search for "TDD AI Companion"
   - Enter your Google Gemini API key
     - Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Enter your Pinecone API key
     - Get from [Pinecone Dashboard](https://app.pinecone.io/)
   - Without these keys, the extension will not work properly

3. **Open a project** you want to use with TDD

4. **Access the TDD AI Companion sidebar** from the VS Code activity bar

5. **Setup your project**:

   - Define the feature you're working on
   - Select source files and test files
   - The auto-indexing system will automatically manage your codebase embeddings
   - Monitor indexing status in the sidebar

6. **Configure auto-indexing** (optional):
   - Use the auto-indexing toggle in the sidebar to enable/disable automatic updates
   - Adjust settings in VS Code preferences for indexing behavior
   - Use manual controls when needed (Index Now, Clear Index)

## How to Use

### Initial Setup

1. Click on the TDD AI Companion icon in the activity bar
2. Use the "TDD AI: Setup Project" command to:
   - Define the current feature you're working on
   - Select source files and test files

### Workflow

1. **Write a test description** in the sidebar input area
2. Click "Get Test Suggestions" or use the "TDD AI: Suggest Test Case" command
3. Implement the suggested test in your test files
4. Run your tests (they will fail initially)
5. Use "TDD AI: Update Source Files" to get implementation suggestions
6. Implement the suggested code
7. Run tests again to verify your implementation passes
8. Repeat the process for additional features or edge cases

### Additional Commands

- **TDD AI: Update Source Files**: Get suggestions for implementation code
- **TDD AI: Update Test Files**: Get suggestions for improving your tests
- **TDD AI: Update Current Feature**: Change the feature you're working on
- **TDD AI: Index Files**: Manually trigger indexing of selected files
- **TDD AI: Clear Index**: Remove all entries from the vector index
- **TDD AI: Toggle Auto-Indexing**: Enable/disable automatic indexing

### Auto-Indexing Features

The extension now includes intelligent auto-indexing capabilities:

- **Automatic Updates**: File changes are automatically detected and indexed
- **Smart Strategies**: Choose how the system handles updates (smart/incremental/full)
- **Real-time Monitoring**: View indexing status, progress, and statistics in the sidebar
- **Manual Override**: Force indexing or disable auto-updates when needed
- **Pattern Filtering**: Configure which files to include or exclude from indexing

For complete auto-indexing documentation, see [AUTO_INDEXING_SYSTEM.md](./AUTO_INDEXING_SYSTEM.md).

### User Activity & AI Interaction Logging

The extension includes comprehensive logging capabilities to track user interactions and AI responses:

- **AI Suggestion Logging**: Records when AI suggestions are provided and user interactions with them
- **Chat Query & Response Logging**: Tracks all chat queries sent to AI and the responses received
- **User Feedback Logging**: Captures user feedback (thumbs up/down) on AI responses for quality improvement
- **File Activity Logging**: Records file save events with optional content logging
- **Test Run Logging**: Tracks test execution events and results
- **Session Tracking**: Logs session start/end events with participant identification

#### Logging Configuration

Configure logging behavior through VS Code settings:

- **Enable/Disable Logging**: `tddAiCompanion.enableLogging` (default: true)
- **Log File Content**: `tddAiCompanion.logFileContent` - Include full file content in file save logs (default: false)
- **Log Level**: `tddAiCompanion.logLevel` - Control verbosity: "debug", "info", "warn", "error" (default: "info")

#### Log File Location

Logs are written to `.tdd-ai-logs/tdd-ai-companion.log` in your workspace root directory in JSONL format. Each log entry includes:
- Timestamp
- Event type
- Relevant data (query/response content, file paths, feedback, etc.)
- Session and participant tracking information

#### User Feedback Interface

Each AI response in the chat includes a feedback section with thumbs up/down buttons:
- Feedback is automatically saved and persists across sessions
- Visual indicators show your previous feedback choices
- All feedback is logged for AI model improvement

## Known Issues

- This extension requires internet access to connect to Google Gemini and Pinecone services
- Large codebases may take longer to index for RAG functionality
- This is a development version and may contain bugs or incomplete features

## Release Notes

### 0.0.1

- Initial development release
- Core functionality for TDD workflow assistance
- Gemini AI integration
- RAG capabilities for contextual understanding
- Sidebar interface for interaction
- **🚀 NEW: Comprehensive Auto-Indexing System**
  - Intelligent automatic management of codebase embeddings
  - Smart file watching with configurable patterns and strategies
  - Real-time status monitoring and progress tracking
  - Manual controls with auto-indexing toggle
  - 10 comprehensive configuration options for fine-tuning
  - Pattern-based file filtering and change detection
  - Debounced updates and batch processing for optimal performance

---

## Development

This extension is built using TypeScript and the VS Code Extension API.

### Building the Extension from Source

If you want to build the VSIX file yourself:

1. Clone the repository: `git clone [repository-url]`
2. Navigate to the project directory: `cd tdd-ai-companion`
3. Install dependencies: `npm install`
4. Install vsce if you don't have it: `npm install -g @vscode/vsce`
5. Build the extension: `npm run compile`
6. Package the extension: `vsce package`
   - This creates a file named `tdd-ai-companion-0.0.1.vsix` in the project root

The generated VSIX file can then be installed using any of the methods described in the Installation Instructions section.

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

**Enjoy your Test-Driven Development journey with AI assistance!**
