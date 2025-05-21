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
2. **Pinecone API Key**: Required for the RAG (Retrieval-Augmented Generation) functionality that enhances context awareness

## Extension Settings

This extension contributes the following settings:

- `tddAICompanion.geminiApiKey`: API key for Google Gemini
- `tddAICompanion.pineconeApiKey`: API key for Pinecone vector database
- `tddAICompanion.userId`: Unique identifier for the user (automatically generated if not set)

## Getting Started

1. **Install the extension** using the VSIX file (see Installation Instructions)
2. **Configure your API Keys**:
   - Open VS Code Settings (Ctrl+,)
   - Search for "TDD AI Companion"
   - Enter your Google Gemini API key and Pinecone API key
3. **Open a project** you want to use with TDD
4. **Access the TDD AI Companion sidebar** from the VS Code activity bar
5. **Setup your project**:
   - Define the feature you're working on
   - Select source files and test files
   - Index your codebase for RAG if desired

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
- **TDD AI: Index Codebase for RAG**: Create/update a vector index of your code
- **TDD AI: Clear Codebase Index**: Remove the RAG index

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
