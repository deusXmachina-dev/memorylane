import {
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron'

// Electron's dialog API accepts a parent window or no argument, but not
// undefined; these wrappers let call sites pass an optional parent through.

export function showSaveDialog(
  parent: BrowserWindow | null | undefined,
  options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

export function showOpenDialog(
  parent: BrowserWindow | null | undefined,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

export function showMessageBox(
  parent: BrowserWindow | null | undefined,
  options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}
