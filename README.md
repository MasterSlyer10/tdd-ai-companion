# TDD AI Companion

AI-powered Test-Driven Development assistant for VS Code. Leverages Google Gemini AI and RAG (Retrieval-Augmented Generation) to provide intelligent, context-aware TDD guidance.

## ✨ Key Features

- **🤖 AI-Powered Test Suggestions** - Intelligent test case generation based on your codebase
- **💡 Contextual Code Generation** - Implementation recommendations that pass your tests
- **📁 Project Setup Assistance** - Streamlined TDD project configuration
- **🧠 RAG-Enhanced Context** - Retrieval-Augmented Generation for accurate, relevant suggestions
- **🎯 Dedicated Sidebar Interface** - All features accessible from a convenient sidebar
- **🚀 Smart Auto-Indexing System** - Intelligent codebase embedding management
  - Automatic file change detection and updates
  - Configurable strategies (smart/incremental/full)
  - Real-time progress monitoring
  - Pattern-based filtering
  - Manual override controls

## 📋 Prerequisites

⚠️ **Required API Keys** - Extension will not function without these:

1. **Google Gemini API Key** - Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Pinecone API Key** - Get from [Pinecone Dashboard](https://app.pinecone.io/)

## 📦 Installation

This extension is distributed as a VSIX file. Choose one method:

**Method 1: VS Code UI**

1. Extensions view (Ctrl+Shift+X) → "..." menu → "Install from VSIX..."

**Method 2: Command Palette**

1. Ctrl+Shift+P → "Extensions: Install from VSIX..."

**Method 3: Terminal**

```bash
code --install-extension tdd-ai-companion-0.0.1.vsix
```

Restart VS Code if prompted.

## ⚙️ Configuration

### Core Settings

- `tddAICompanion.geminiApiKey` - Google Gemini API key
- `tddAICompanion.pineconeApiKey` - Pinecone API key
- `tddAICompanion.userId` - User identifier (auto-generated)

### Auto-Indexing Settings

- `autoIndexing` - Enable/disable automatic indexing (default: true)
- `indexingStrategy` - Strategy: "smart", "incremental", or "full" (default: "smart")
- `indexingDelay` - Debounce delay in milliseconds (default: 2000)
- `batchSize` - Code chunks per batch for optimal performance (default: 15)
- `includePatterns` / `excludePatterns` - File filtering patterns
- `autoCleanup` - Auto-remove deleted files from index (default: true)

📚 **Detailed documentation**: [AUTO_INDEXING_SYSTEM.md](./AUTO_INDEXING_SYSTEM.md)

## 🚀 Quick Start

1. **Install** the extension using VSIX file
2. **Configure API Keys** in VS Code Settings:
   - Search "TDD AI Companion"
   - Add your Gemini and Pinecone API keys
3. **Open your project** and click the TDD AI Companion sidebar icon
4. **Setup project**: Define feature and select source/test files
5. **Start coding**: Auto-indexing will manage your codebase embeddings

## 💻 Usage

### TDD Workflow

1. **Write test description** in sidebar input
2. **Get test suggestions** → Implement suggested test
3. **Run tests** (they'll fail initially - that's TDD!)
4. **Get implementation suggestions** → Implement code
5. **Run tests again** to verify implementation passes
6. **Repeat** for additional features

### Available Commands

- `TDD AI: Suggest Test Case` - Get AI test suggestions
- `TDD AI: Update Source Files` - Get implementation suggestions
- `TDD AI: Update Test Files` - Improve existing tests
- `TDD AI: Index Codebase` - Manual indexing trigger
- `TDD AI: Clear Index` - Reset vector index

## 📊 Logging & Analytics

Comprehensive logging tracks user interactions and AI responses for improvement:

### Features

- **AI Suggestion Logging** - Records AI interactions and user feedback
- **Chat Query & Response Logging** - Tracks all AI conversations
- **File Activity Logging** - Records file changes (configurable content inclusion)
- **Test Run Logging** - Tracks test execution and results
- **Session Tracking** - Logs user sessions with feedback interface

### Configuration

- `tddAiCompanion.enableLogging` - Enable/disable logging (default: true)
- `tddAiCompanion.logFileContent` - Include file content in logs (default: false)
- `tddAiCompanion.logLevel` - Verbosity level (default: "info")

**Log Location**: `.tdd-ai-logs/tdd-ai-companion.log` (JSONL format)

## 🔧 Development

### Building from Source

```bash
git clone [repository-url]
cd tdd-ai-companion
npm install
npm run compile
npm install -g @vscode/vsce
vsce package
```

This creates `tdd-ai-companion-0.0.1.vsix` for installation.

## ⚠️ Known Issues

- Requires internet access for Google Gemini and Pinecone services
- Large codebases may take longer to index initially
- Development version - may contain bugs or incomplete features

## 📝 Release Notes

### v0.0.1 - Initial Release

- Core TDD workflow assistance with AI-powered suggestions
- Gemini AI integration for test case and code generation
- RAG capabilities for contextual understanding
- Sidebar interface for seamless interaction
- **🚀 Comprehensive Auto-Indexing System**
  - Intelligent codebase embedding management
  - Smart file watching with configurable strategies
  - Real-time monitoring and manual controls
  - 3-5x performance improvements through optimized batch processing
  - Pattern-based filtering and change detection

## 🤝 Contributing

Contributions welcome! Please submit Pull Requests with clear descriptions.

---

**Enjoy your AI-enhanced Test-Driven Development journey!** 🚀
