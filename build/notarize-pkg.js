/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv').config()
const path = require('node:path')
const { notarizeWithRetry } = require('./mac-notarize')

exports.default = async function notarizePkg(context) {
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping pkg notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set.')
    return
  }

  const pkgArtifacts = (context.artifactPaths || []).filter((p) => p.endsWith('.pkg'))
  if (pkgArtifacts.length === 0) return

  for (const pkgPath of pkgArtifacts) {
    const name = path.basename(pkgPath)
    console.log(`Notarizing ${name}...`)
    await notarizeWithRetry({
      appPath: pkgPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: 'ZN3J54N7AP',
    })
    console.log(`Notarization complete: ${name}`)
  }
}
