import { dialog } from 'electron'
import log from './logger'
import {
  findWindowsUpdateBlockingMcpProcesses,
  formatBlockingHostNames,
  stopWindowsHostProcesses,
} from './windows-update-blockers'

function formatHostLabel(hostName: string): string {
  return /^[a-z]+$/.test(hostName) ? hostName.charAt(0).toUpperCase() + hostName.slice(1) : hostName
}

function buildHostCloseButtonLabel(hostNames: string[]): string {
  const labels = hostNames.map(formatHostLabel)

  if (labels.length === 1) {
    return `Close ${labels[0]}`
  }

  return 'Close Apps'
}

function buildBlockingHostsDetail(hostNames: string[]): string {
  if (hostNames.length === 0) {
    return 'Please close the app using MemoryLane, then click Try Again.'
  }

  const labels = hostNames.map(formatHostLabel)

  if (labels.length === 1) {
    return `Close ${labels[0]}, then click Try Again.`
  }

  const hostList = labels.map((name) => `- ${name}`).join('\n')
  return `Close these apps, then click Try Again:\n${hostList}`
}

export async function confirmWindowsUpdateInstall(execPath: string): Promise<boolean> {
  if (process.platform !== 'win32') return true

  let installBlocked = true
  while (installBlocked) {
    let blockers
    try {
      blockers = findWindowsUpdateBlockingMcpProcesses(execPath)
    } catch (error) {
      log.warn('[Updater] Failed to inspect MCP helper processes before install', error)
      return true
    }

    if (blockers.length === 0) {
      installBlocked = false
      continue
    }

    const hostNames = formatBlockingHostNames(blockers)
    const buttons = ['Try Again', 'Cancel']
    const closeHostButtonIndex =
      hostNames.length > 0 ? buttons.push(buildHostCloseButtonLabel(hostNames)) - 1 : -1

    const hostLabels = hostNames.map(formatHostLabel)
    const title =
      hostLabels.length === 1
        ? `Close ${hostLabels[0]} to Update MemoryLane`
        : 'Close Apps to Update MemoryLane'
    const message =
      hostLabels.length === 1
        ? `MemoryLane needs ${hostLabels[0]} to be closed before the update can continue.`
        : 'MemoryLane needs some apps to be closed before the update can continue.'

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title,
      message,
      detail: buildBlockingHostsDetail(hostNames),
    })

    if (response === 1) return false

    if (response === closeHostButtonIndex && closeHostButtonIndex >= 0) {
      try {
        stopWindowsHostProcesses(blockers)
      } catch (error) {
        log.warn('[Updater] Failed to stop host app before install', error)
        await dialog.showMessageBox({
          type: 'error',
          buttons: ['OK'],
          defaultId: 0,
          noLink: true,
          title: 'Could Not Close the App',
          message: 'MemoryLane could not close the app automatically.',
          detail: 'Please close it yourself, then click Try Again.',
        })
      }
    }
  }

  return true
}
