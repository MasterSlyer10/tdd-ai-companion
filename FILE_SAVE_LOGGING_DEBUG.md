# File Save Logging Debug Instructions

## 🔧 Quick Test Steps

### 1. **Reload VS Code Extension**

- Press `Ctrl+Shift+P` → "Developer: Reload Window"
- OR press `F5` to launch extension development host

### 2. **Check Debug Console**

Look for these initialization messages in the VS Code Developer Console:

```
[LoggingService] Current log level: standard
[LoggingService] Setting up file watchers...
[LoggingService] Setting up file watchers for workspace: C:\path\to\your\workspace
```

### 3. **Test File Save Logging**

1. Open any file in your workspace (e.g., a `.ts`, `.js`, `.md` file)
2. Make a small change and save the file (`Ctrl+S`)
3. Check the console for these debug messages:
   ```
   [LoggingService] File changed: C:\path\to\your\file.ts
   [LoggingService] handleFileSaved called for: C:\path\to\your\file.ts
   [LoggingService] Successfully logged file save event for: C:\path\to\your\file.ts isSelectedFile: false
   Logged event: file_saved
   ```

### 4. **Check Log File**

- Navigate to your workspace root
- Look for `.tdd-ai-logs/` folder
- Open the `.jsonl` file inside
- You should see file save events like:
  ```json
  {
    "timestamp": "2025-06-24T...",
    "participantId": "participant_...",
    "sessionId": "session_...",
    "eventType": "file_saved",
    "filePath": "C:\\...\\file.ts",
    "fileType": "source",
    "isSelectedFile": false
  }
  ```

### 5. **Test Selected File Logging**

1. Open TDD AI Companion sidebar
2. Select some source or test files
3. Edit and save one of the selected files
4. Check the log - it should show `"isSelectedFile":true`

## 🔍 Troubleshooting

### If no console messages appear:

- Check if logging is enabled: Settings → Extensions → TDD AI Companion → Enable Logging
- Check log level: Settings → Extensions → TDD AI Companion → Log Level (should be "standard" or "detailed")
- Try reloading the extension window

### If file changes aren't detected:

- The file watcher might not be set up correctly
- Check if there are any workspace folder permissions issues
- Try creating a new file (which triggers `onDidCreate` instead of `onDidChange`)

### If log file doesn't exist:

- Check workspace permissions
- Verify the `.tdd-ai-logs` folder can be created
- Look for error messages in the debug console

## 🎯 Expected Results

After this fix, you should see:

1. ✅ Debug messages in console when files are saved
2. ✅ Log entries in `.tdd-ai-logs/*.jsonl` file
3. ✅ `isSelectedFile: true` for files you've selected in the TDD AI Companion
4. ✅ `isSelectedFile: false` (or undefined) for other files

The debug logging will help us identify exactly where the issue might be occurring.
