import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'

export type FileChunkerConfig = {
  chunkSize: number
}

export type ChunkResult =
  | {
    done: false
    index: number
    chunk: Buffer
    checksum: string
  }
  | {
    done: true
    chunk: Buffer
    finalChecksum: string
  }

export class FileChunker {
  constructor(
    readonly filePath: string,
    readonly config: FileChunkerConfig
  ) { }

  async *chunk(): AsyncGenerator<ChunkResult, void, unknown> {
    const stream = createReadStream(this.filePath, {
      highWaterMark: this.config.chunkSize,
    })

    const fileHash = createHash('sha256')
    let buffer = Buffer.alloc(0)
    let hasYielded = false
    let index = 0

    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        fileHash.update(chunk)
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= this.config.chunkSize) {
          const chunkToYield = buffer.subarray(0, this.config.chunkSize)
          buffer = buffer.subarray(this.config.chunkSize)
          const chunkChecksum = createHash('sha256').update(chunkToYield).digest('hex')
          yield {
            done: false,
            index,
            chunk: chunkToYield,
            checksum: chunkChecksum,
          }
          hasYielded = true
          index++
        }
      }

      // Yield any remaining data
      const finalFileChecksum = fileHash.digest('hex')
      if (buffer.length > 0) {
        yield {
          done: true,
          chunk: buffer,
          finalChecksum: finalFileChecksum,
        }
      } else if (!hasYielded) {
        // Empty file case
        yield {
          done: true,
          chunk: Buffer.alloc(0),
          finalChecksum: finalFileChecksum,
        }
      } else {
        // No remaining buffer, but we need to provide the file checksum
        // Yield an empty chunk with just the file checksum
        yield {
          done: true,
          chunk: Buffer.alloc(0),
          finalChecksum: finalFileChecksum,
        }
      }
    } finally {
      stream.destroy()
    }
  }
}
