import { createHash } from 'node:crypto'
import { InvalidChecksumError, InvalidFinalChecksumError } from './errors'

export type FileChunk = {
  buffer: Buffer
  index: number
  checksum: string
}

export type FileJoinerConfig = {
  finalChecksum: string
  chunks: FileChunk[]
}

export type JoinResult =
  | {
    done: false
    output: Buffer
    checksum: string
  }
  | {
    done: true
    finalChecksum: string
    sourceChunks: Array<{
      index: number
      checksum: string
    }>
  }

export class FileJoiner {
  constructor(
    readonly config: FileJoinerConfig
  ) { }

  async *join(): AsyncGenerator<JoinResult, void, unknown> {
    await Promise.resolve()
    // Sort chunks by index to ensure correct order
    const sortedChunks = [...this.config.chunks].sort((a, b) => a.index - b.index)

    // Validate we have all expected indices
    for (let i = 0; i < sortedChunks.length; i++) {
      if (sortedChunks[i].index !== i) {
        throw new Error(`Missing chunk at index ${i}`)
      }
    }

    const fileHash = createHash('sha256')
    const sourceChunksInfo: Array<{ index: number; checksum: string }> = []

    // Validate each chunk's checksum and build the file
    for (const sourceChunk of sortedChunks) {
      // Validate chunk checksum
      const calculatedChecksum = createHash('sha256').update(sourceChunk.buffer).digest('hex')
      if (calculatedChecksum !== sourceChunk.checksum) {
        throw new InvalidChecksumError(
          `Chunk at index ${sourceChunk.index} has invalid checksum. Expected: ${sourceChunk.checksum}, Got: ${calculatedChecksum}`
        )
      }

      // Update file hash
      fileHash.update(sourceChunk.buffer)

      // Track source chunk info
      sourceChunksInfo.push({
        index: sourceChunk.index,
        checksum: sourceChunk.checksum,
      })

      // Yield the chunk immediately for flushing
      yield {
        done: false,
        output: sourceChunk.buffer,
        checksum: sourceChunk.checksum,
      }
    }

    // Validate final file checksum
    const calculatedFinalChecksum = fileHash.digest('hex')
    if (calculatedFinalChecksum !== this.config.finalChecksum) {
      throw new InvalidFinalChecksumError(
        `Final file checksum is invalid. Expected: ${this.config.finalChecksum}, Got: ${calculatedFinalChecksum}`
      )
    }

    // Yield final result with all source chunks info
    yield {
      done: true,
      finalChecksum: this.config.finalChecksum,
      sourceChunks: sourceChunksInfo,
    }
  }
}
