#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`

const repoRoot = path.resolve(__dirname, '..')
const outputDir = path.join(repoRoot, 'build', 'models', MODEL_ID)

const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx']

async function downloadFile(file) {
  const dest = path.join(outputDir, file)
  if (fs.existsSync(dest)) {
    console.log(`[build:model] Already exists, skipping: ${file}`)
    return
  }

  const url = `${BASE_URL}/${file}`
  console.log(`[build:model] Downloading ${file}...`)

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buffer)
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1)
  console.log(`[build:model] Saved ${file} (${sizeMB} MB)`)
}

async function main() {
  console.log(`[build:model] Downloading ${MODEL_ID} to ${outputDir}`)
  fs.mkdirSync(outputDir, { recursive: true })

  for (const file of FILES) {
    await downloadFile(file)
  }

  console.log('[build:model] Done.')
}

main().catch((err) => {
  console.error(`[build:model] ${err.message}`)
  process.exit(1)
})
