import sharp from 'sharp'

const DHASH_WIDTH = 320
const DHASH_HEIGHT = 180

export async function loadImageDHash(filepath: string): Promise<string | null> {
  try {
    const { data, info } = await sharp(filepath)
      .ensureAlpha()
      .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (!info.channels || info.channels < 3) {
      return null
    }

    const grayscale = new Uint8Array(info.width * info.height)
    for (let pixel = 0, i = 0; pixel < grayscale.length; pixel++, i += info.channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      grayscale[pixel] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b)
    }

    return calculateDHash(grayscale)
  } catch {
    return null
  }
}

// Downsampled grayscale luminance profile. Unlike a dHash — whose
// adjacent-pixel comparator bits degenerate to JPEG-noise coin flips on the
// flat dark regions that dominate dark-themed apps — raw luminance compared
// via L1 distance separates "same screen" from "different screen" cleanly.
export async function loadImageLuminance(
  filepath: string,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  try {
    const { data, info } = await sharp(filepath)
      .ensureAlpha()
      .resize(width, height, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (!info.channels || info.channels < 3) {
      return null
    }

    const grayscale = new Uint8Array(info.width * info.height)
    for (let pixel = 0, i = 0; pixel < grayscale.length; pixel++, i += info.channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      grayscale[pixel] = Math.floor(0.299 * r + 0.587 * g + 0.114 * b)
    }
    return grayscale
  } catch {
    return null
  }
}

// Mean absolute luminance difference as a percentage of full scale (0-100).
export function luminanceL1DifferencePercent(left: Uint8Array, right: Uint8Array): number | null {
  if (left.length === 0 || right.length === 0) return null
  if (left.length !== right.length) return null

  let total = 0
  for (let i = 0; i < left.length; i++) {
    total += Math.abs(left[i] - right[i])
  }
  return (total / left.length / 255) * 100
}

export function dHashDifferencePercent(leftHash: string, rightHash: string): number | null {
  if (leftHash.length === 0 || rightHash.length === 0) return null
  if (leftHash.length !== rightHash.length) return null

  let distance = 0
  for (let i = 0; i < leftHash.length; i++) {
    if (leftHash[i] !== rightHash[i]) distance++
  }
  return (distance / leftHash.length) * 100
}

function calculateDHash(grayscale: Uint8Array): string {
  let hash = ''
  for (let i = 0; i < grayscale.length - 1; i++) {
    hash += grayscale[i] < grayscale[i + 1] ? '1' : '0'
  }
  return hash
}
