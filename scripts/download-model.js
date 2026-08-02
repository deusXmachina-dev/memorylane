#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx'],
  },
  {
    id: 'nationaldesignstudio/rampart',
    files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_q4.onnx'],
  },
]

const repoRoot = path.resolve(__dirname, '..')

async function downloadFile(model, outputDir, file) {
  const dest = path.join(outputDir, file)
  if (fs.existsSync(dest)) {
    console.log(`[build:model] Already exists, skipping: ${model.id}/${file}`)
    return
  }

  const url = `https://huggingface.co/${model.id}/resolve/main/${file}`
  console.log(`[build:model] Downloading ${model.id}/${file}...`)

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buffer)
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1)
  console.log(`[build:model] Saved ${model.id}/${file} (${sizeMB} MB)`)
}

async function main() {
  for (const model of MODELS) {
    const outputDir = path.join(repoRoot, 'build', 'models', model.id)
    console.log(`[build:model] Downloading ${model.id} to ${outputDir}`)
    fs.mkdirSync(outputDir, { recursive: true })

    for (const file of model.files) {
      await downloadFile(model, outputDir, file)
    }
  }

  console.log('[build:model] Done.')
}

main().catch((err) => {
  console.error(`[build:model] ${err.message}`)
  process.exit(1)
})
