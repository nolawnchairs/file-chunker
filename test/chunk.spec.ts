import { FileChunker } from '../src/chunk'
import { FileJoiner, type FileChunk } from '../src/join'
import { InvalidChecksumError, InvalidFinalChecksumError, MissingChunkError } from '../src/errors'
import { writeFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const createTestFile = async (content: Buffer, filename: string): Promise<string> => {
  const filePath = join(tmpdir(), filename)
  await writeFile(filePath, content)
  return filePath
}

const cleanupFile = async (filePath: string): Promise<void> => {
  try {
    await unlink(filePath)
  } catch {
    // Ignore cleanup errors
  }
}

describe('FileChunker', () => {

  describe('chunking', () => {
    it('should chunk a small file into single chunk', async () => {
      const content = Buffer.from('Hello, World!')
      const filePath = await createTestFile(content, 'small.txt')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1024 })
        const results: Array<{ done: false; index: number; chunk: Buffer; checksum: string } | { done: true; chunk: Buffer; finalChecksum: string }> = []

        for await (const result of chunker.chunk()) {
          results.push(result)
        }

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          done: true,
          chunk: content,
        })
        if (results[0].done) {
          expect(results[0].finalChecksum).toBeDefined()
        }
      } finally {
        await cleanupFile(filePath)
      }
    })

    it('should chunk a file into multiple chunks', async () => {
      const content = Buffer.alloc(2500, 'a')
      const filePath = await createTestFile(content, 'multi-chunk.bin')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1000 })
        const results: Array<{ done: false; index: number; chunk: Buffer; checksum: string } | { done: true; chunk: Buffer; finalChecksum: string }> = []

        for await (const result of chunker.chunk()) {
          results.push(result)
        }

        // Should have 2 intermediate chunks + 1 final chunk
        const intermediateChunks = results.filter((r) => !r.done)
        const finalChunk = results.find((r) => r.done)

        expect(intermediateChunks).toHaveLength(2)
        expect(finalChunk).toBeDefined()

        // Verify chunk sizes
        expect(intermediateChunks[0].chunk.length).toBe(1000)
        expect(intermediateChunks[1].chunk.length).toBe(1000)
        expect(finalChunk!.chunk.length).toBe(500)

        // Verify indices
        expect(intermediateChunks[0].index).toBe(0)
        expect(intermediateChunks[1].index).toBe(1)

        // Verify checksums are present
        expect(intermediateChunks[0].checksum).toBeDefined()
        expect(intermediateChunks[1].checksum).toBeDefined()
        expect(finalChunk!.finalChecksum).toBeDefined()
      } finally {
        await cleanupFile(filePath)
      }
    })

    it('should handle empty file', async () => {
      const content = Buffer.alloc(0)
      const filePath = await createTestFile(content, 'empty.txt')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1024 })
        const results: Array<{ done: false; index: number; chunk: Buffer; checksum: string } | { done: true; chunk: Buffer; finalChecksum: string }> = []

        for await (const result of chunker.chunk()) {
          results.push(result)
        }

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          done: true,
          chunk: Buffer.alloc(0),
        })
        if (results[0].done) {
          expect(results[0].finalChecksum).toBeDefined()
        }
      } finally {
        await cleanupFile(filePath)
      }
    })

    it('should handle file that is exactly chunk size', async () => {
      const content = Buffer.alloc(1024, 'x')
      const filePath = await createTestFile(content, 'exact-chunk.bin')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1024 })
        const results: Array<{ done: false; index: number; chunk: Buffer; checksum: string } | { done: true; chunk: Buffer; finalChecksum: string }> = []

        for await (const result of chunker.chunk()) {
          results.push(result)
        }

        // Should have 1 intermediate chunk + 1 final empty chunk
        const intermediateChunks = results.filter((r) => !r.done)
        const finalChunk = results.find((r) => r.done)

        expect(intermediateChunks).toHaveLength(1)
        expect(finalChunk).toBeDefined()
        expect(intermediateChunks[0].chunk.length).toBe(1024)
        expect(finalChunk!.chunk.length).toBe(0)
      } finally {
        await cleanupFile(filePath)
      }
    })

    it('should calculate correct checksums', async () => {
      const content = Buffer.from('Test content for checksum')
      const filePath = await createTestFile(content, 'checksum-test.txt')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1024 })
        const results: Array<{ done: false; index: number; chunk: Buffer; checksum: string } | { done: true; chunk: Buffer; finalChecksum: string }> = []

        for await (const result of chunker.chunk()) {
          results.push(result)
        }

        const finalChunk = results.find((r) => r.done)
        expect(finalChunk).toBeDefined()
        if (finalChunk && finalChunk.done) {
          const expectedChecksum = createHash('sha256').update(content).digest('hex')
          expect(finalChunk.finalChecksum).toBe(expectedChecksum)
        }
      } finally {
        await cleanupFile(filePath)
      }
    })

    it('should handle large file efficiently', async () => {
      // Create a 5MB file
      const content = Buffer.alloc(5 * 1024 * 1024, 'x')
      const filePath = await createTestFile(content, 'large.bin')

      try {
        const chunker = new FileChunker(filePath, { chunkSize: 1024 * 1024 })
        let chunkCount = 0
        let totalBytes = 0

        for await (const result of chunker.chunk()) {
          if (!result.done) {
            chunkCount++
            totalBytes += result.chunk.length
          } else {
            totalBytes += result.chunk.length
          }
        }

        expect(chunkCount).toBe(5)
        expect(totalBytes).toBe(5 * 1024 * 1024)
      } finally {
        await cleanupFile(filePath)
      }
    })
  })
})

describe('FileJoiner', () => {
  describe('joining', () => {
    it('should join chunks back into original file', async () => {
      const originalContent = Buffer.from('Hello, World! This is a test file.')
      const expectedChecksum = createHash('sha256').update(originalContent).digest('hex')

      // Create chunks manually
      const chunkSize = 10
      const chunks: FileChunk[] = []
      let index = 0

      for (let i = 0; i < originalContent.length; i += chunkSize) {
        const chunkBuffer = originalContent.subarray(i, i + chunkSize)
        const checksum = createHash('sha256').update(chunkBuffer).digest('hex')
        chunks.push({
          getBuffer: async () => Promise.resolve(chunkBuffer),
          index: index++,
          checksum,
        })
      }

      const joiner = new FileJoiner({
        finalChecksum: expectedChecksum,
        chunks,
      })

      const output: Buffer[] = []
      let finalResult: { done: true; finalChecksum: string; sourceChunks: Array<{ index: number; checksum: string }> } | null = null

      for await (const result of joiner.join()) {
        if (!result.done) {
          output.push(result.output)
        } else {
          finalResult = result
        }
      }

      const reconstructed = Buffer.concat(output)
      expect(reconstructed).toEqual(originalContent)
      expect(finalResult).toBeDefined()
      expect(finalResult!.finalChecksum).toBe(expectedChecksum)
      expect(finalResult!.sourceChunks).toHaveLength(chunks.length)
    })

    it('should handle chunks in wrong order', async () => {
      const originalContent = Buffer.from('Test content')
      const expectedChecksum = createHash('sha256').update(originalContent).digest('hex')

      const chunk1 = originalContent.subarray(0, 5)
      const chunk2 = originalContent.subarray(5)

      const chunks: FileChunk[] = [
        {
          getBuffer: async () => Promise.resolve(chunk2),
          index: 1,
          checksum: createHash('sha256').update(chunk2).digest('hex'),
        },
        {
          getBuffer: async () => Promise.resolve(chunk1),
          index: 0,
          checksum: createHash('sha256').update(chunk1).digest('hex'),
        },
      ]

      const joiner = new FileJoiner({
        finalChecksum: expectedChecksum,
        chunks,
      })

      const output: Buffer[] = []
      for await (const result of joiner.join()) {
        if (!result.done) {
          output.push(result.output)
        }
      }

      const reconstructed = Buffer.concat(output)
      expect(reconstructed).toEqual(originalContent)
    })

    it('should throw MissingChunkError when chunk is null', async () => {
      const chunks: FileChunk[] = [
        {
          getBuffer: async () => Promise.resolve(null),
          index: 0,
          checksum: 'dummy',
        },
      ]

      const joiner = new FileJoiner({
        finalChecksum: 'dummy',
        chunks,
      })

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _result of joiner.join()) {
          // Should throw before yielding
        }
      }).rejects.toThrow(MissingChunkError)
    })

    it('should throw InvalidChecksumError for invalid chunk checksum', async () => {
      const content = Buffer.from('Test')
      const chunks: FileChunk[] = [
        {
          getBuffer: async () => Promise.resolve(content),
          index: 0,
          checksum: 'invalid-checksum',
        },
      ]

      const joiner = new FileJoiner({
        finalChecksum: createHash('sha256').update(content).digest('hex'),
        chunks,
      })

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _result of joiner.join()) {
          // Should throw on invalid checksum
        }
      }).rejects.toThrow(InvalidChecksumError)
    })

    it('should throw InvalidFinalChecksumError for invalid final checksum', async () => {
      const content = Buffer.from('Test')
      const chunks: FileChunk[] = [
        {
          getBuffer: async () => Promise.resolve(content),
          index: 0,
          checksum: createHash('sha256').update(content).digest('hex'),
        },
      ]

      const joiner = new FileJoiner({
        finalChecksum: 'invalid-final-checksum',
        chunks,
      })

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _result of joiner.join()) {
          // Should throw on final checksum validation
        }
      }).rejects.toThrow(InvalidFinalChecksumError)
    })

    it('should yield final result with all source chunks info', async () => {
      const content = Buffer.from('Test content for final result')
      const expectedChecksum = createHash('sha256').update(content).digest('hex')

      const chunks: FileChunk[] = [
        {
          getBuffer: async () => Promise.resolve(content),
          index: 0,
          checksum: createHash('sha256').update(content).digest('hex'),
        },
      ]

      const joiner = new FileJoiner({
        finalChecksum: expectedChecksum,
        chunks,
      })

      let finalResult: { done: true; finalChecksum: string; sourceChunks: Array<{ index: number; checksum: string }> } | null = null

      for await (const result of joiner.join()) {
        if (result.done) {
          finalResult = result
        }
      }

      expect(finalResult).toBeDefined()
      expect(finalResult!.finalChecksum).toBe(expectedChecksum)
      expect(finalResult!.sourceChunks).toHaveLength(1)
      expect(finalResult!.sourceChunks[0]).toMatchObject({
        index: 0,
        checksum: chunks[0].checksum,
      })
    })
  })
})

describe('Integration: Chunk and Join', () => {
  it('should chunk and join a file correctly', async () => {
    const originalContent = Buffer.alloc(5000, 'x')
    const filePath = join(tmpdir(), `integration-test-${Date.now()}.bin`)

    try {
      await writeFile(filePath, originalContent)

      // Chunk the file
      const chunker = new FileChunker(filePath, { chunkSize: 1000 })
      const chunkData: Array<{ buffer: Buffer; index: number; checksum: string }> = []
      let finalChecksum = ''

      for await (const result of chunker.chunk()) {
        if (!result.done) {
          chunkData.push({
            buffer: result.chunk,
            index: result.index,
            checksum: result.checksum,
          })
        } else {
          if (result.chunk.length > 0) {
            chunkData.push({
              buffer: result.chunk,
              index: chunkData.length,
              checksum: createHash('sha256').update(result.chunk).digest('hex'),
            })
          }
          finalChecksum = result.finalChecksum
        }
      }

      // Join the chunks
      const chunks: FileChunk[] = chunkData.map((chunk) => ({
        getBuffer: async () => Promise.resolve(chunk.buffer),
        index: chunk.index,
        checksum: chunk.checksum,
      }))

      const joiner = new FileJoiner({
        finalChecksum,
        chunks,
      })

      const output: Buffer[] = []
      for await (const result of joiner.join()) {
        if (!result.done) {
          output.push(result.output)
        }
      }

      const reconstructed = Buffer.concat(output)
      expect(reconstructed).toEqual(originalContent)
    } finally {
      await cleanupFile(filePath)
    }
  })
})
