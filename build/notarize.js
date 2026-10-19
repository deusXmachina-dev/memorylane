/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv').config()
const { notarizeWithRetry } = require('./mac-notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set.')
    return
  }

  const appName = context.packager.appInfo.productFilename

  console.log(`Notarizing ${appName}...`)

  await notarizeWithRetry({
    appBundleId: context.packager.appInfo.id,
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: 'ZN3J54N7AP',
  })

  console.log('Notarization complete.')
}
