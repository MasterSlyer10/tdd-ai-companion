# File Validation Testing Guide

## Testing the File Selection Bug Fix

This guide helps test the file validation functionality that fixes the bug where selected files still show in the list even after being moved or deleted.

### Test Scenarios

#### Scenario 1: File Moved to Different Directory

1. Open the TDD AI Companion extension
2. Select some source files and test files from the file tree
3. Verify they appear in the "Selected Files" sections
4. Move one of the selected files to a different directory using VS Code's file explorer
5. Click the refresh button (🔄) in either the source or test file tree
6. **Expected Result**:
   - A warning notification should appear saying the moved file was removed from selection
   - The file should no longer appear in the selected files list
   - The file should no longer be checked in the tree view

#### Scenario 2: File Deleted

1. Select files in both source and test sections
2. Delete one of the selected files using VS Code
3. Refresh the file tree
4. **Expected Result**:
   - Warning notification about the deleted file
   - File removed from selection lists
   - File no longer visible in tree

#### Scenario 3: File Renamed

1. Select files from the tree
2. Rename one of the selected files
3. Refresh the tree
4. **Expected Result**:
   - Old file name removed from selection
   - Warning notification displayed
   - Renamed file appears as unselected in tree

#### Scenario 4: Multiple Missing Files

1. Select multiple files
2. Move/delete/rename several selected files
3. Refresh the tree
4. **Expected Result**:
   - Single notification listing all missing files
   - All missing files removed from selection
   - Proper grammar (singular vs plural message)

### Validation Points

✅ **File Validation Function**

- `fileExistsInTree()` correctly traverses the file tree
- Handles nested directories properly
- Returns false for non-existent files

✅ **Missing Files Detection**

- `validateSelectedFiles()` checks both source and test files
- Removes missing files from `checkedItems` and `checkedTestItems` Sets
- Updates display and saves state after removal

✅ **User Notification**

- `showMissingFilesNotification()` creates appropriate warnings
- Shows only filename (not full path) for better UX
- Auto-removes notification after 5 seconds
- Uses VS Code theme colors for consistency

✅ **Integration**

- Validation runs automatically when file tree updates
- Works with existing file limit warnings
- Maintains state consistency across extension and webview

### Expected Behavior

**Before Fix**: File names would persist in selection lists even when files were moved/deleted, creating confusion about what files were actually selected.

**After Fix**: Missing files are automatically detected and removed from selection with clear user feedback, ensuring the selection list always reflects available files.

### Testing Notes

- The validation runs every time the file tree is updated from the extension
- The notification uses VS Code's built-in warning theme variables
- Files are compared by full path, so moving to different directories is detected
- State is automatically saved after removing missing files
