const edition = process.env.EDITION === 'enterprise' ? 'enterprise' : 'customer'
const isEnterprise = edition === 'enterprise'

const productName = isEnterprise ? 'MemoryLane Enterprise' : 'MemoryLane'
const packageName = isEnterprise ? 'memorylane-enterprise' : 'memorylane'
const appId = isEnterprise ? 'com.memorylane.enterprise' : 'com.memorylane.app'

const macConfig = isEnterprise
  ? undefined
  : {
      notarize: false,
      category: 'public.app-category.productivity',
      extendInfo: {
        LSUIElement: true,
      },
      identity: 'Filip Kubis (ZN3J54N7AP)',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
      artifactName: '${productName}-${arch}-mac.${ext}',
      target: [
        {
          target: 'zip',
          arch: ['arm64'],
        },
        {
          target: 'dmg',
          arch: ['arm64'],
        },
      ],
    }

const winTargets = isEnterprise
  ? [
      {
        target: 'msi',
        arch: ['x64'],
      },
    ]
  : [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ]

/** @type {import('electron-builder').Configuration} */
module.exports = {
  publish: {
    provider: 'github',
    owner: 'deusXmachina-dev',
    repo: 'memorylane',
  },
  appId,
  productName,
  copyright: 'Copyright © 2026 Filip Kubis',
  directories: {
    buildResources: 'assets',
    output: `dist/${edition}`,
  },
  files: ['out/**/*', 'package.json'],
  extraMetadata: {
    name: packageName,
    productName,
  },
  extraResources: [
    {
      from: 'assets',
      to: 'assets',
      filter: ['**/*'],
    },
    {
      from: 'build/swift',
      to: 'swift',
      filter: ['ocr', 'app-watcher', 'screenshot'],
    },
    {
      from: 'src/main/processor/powershell',
      to: 'powershell',
      filter: ['*.ps1'],
    },
    {
      from: 'build/models',
      to: 'models',
      filter: ['**/*'],
    },
    {
      from: `config/editions/${edition}.json`,
      to: 'config/edition.json',
    },
  ],
  asar: true,
  asarUnpack: [
    'node_modules/uiohook-napi/**/*',
    'node_modules/sharp/**/*',
    'node_modules/better-sqlite3/**/*',
    'node_modules/ffmpeg-static/**/*',
    'node_modules/sqlite-vec*/**/*',
    'node_modules/@img/**/*',
    'node_modules/onnxruntime-node/**/*',
    '**/*.node',
  ],
  afterSign: 'build/notarize.js',
  ...(macConfig ? { mac: macConfig } : {}),
  win: {
    extraResources: [
      {
        from: 'build/rust',
        to: 'rust',
        filter: ['app-watcher-windows.exe', 'screenshot-capturer-windows.exe'],
      },
    ],
    azureSignOptions: {
      publisherName: 'SenseFlow, Inc.',
      endpoint: 'https://eus.codesigning.azure.net/',
      certificateProfileName: 'memorylane-codesign',
      codeSigningAccountName: 'azure-signing-dxm',
    },
    target: winTargets,
  },
  nsis: {
    artifactName: '${productName}-Setup.${ext}',
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
  },
  msi: {
    perMachine: true,
    oneClick: true,
    artifactName: '${productName}-Setup.${ext}',
  },
}
