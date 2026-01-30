# @nolawnchairs/file-chunker

A memory-efficient TypeScript library for splitting large files into manageable chunks and reassembling them with built-in checksum validation.

> This is an internal library and isn't really intended for public use.

## Features

- 🚀 **Streaming**: Uses Node.js streams for minimal memory footprint
- 🔒 **Checksum Validation**: SHA256 checksums for individual chunks and the complete file
- 📦 **TypeScript**: Full TypeScript support
- ⚡ **Async Iterators**: Modern async/await patterns with `for/await` loops
- ✅ **Error Handling**: Comprehensive error types for validation failures

## Installation

```bash
npm install @nolawnchairs/file-chunker
```

## Usage

### Chunking Files

Split a large file into chunks with automatic checksum calculation:

```typescript
import { FileChunker } from '@nolawnchairs/file-chunker'
import { writeFile } from 'node:fs/promises'

const chunker = new FileChunker('large-file.bin', {
  chunkSize: 1024 * 1024, // 1MB chunks
})

for await (const result of chunker.chunk()) {
  if (!result.done) {
    // Intermediate chunk
    console.log(`Chunk ${result.index}: ${result.checksum}`)
    
    // Save chunk to disk
    await writeFile(`chunk-${result.index}.bin`, result.chunk)
  } else {
    console.log(`Final checksum: ${result.finalChecksum}`)
  }
}
```

### Joining Files

Reassemble chunks back into the original file with validation:

```typescript
import { FileJoiner, InvalidChecksumError, InvalidFinalChecksumError } from '@nolawnchairs/file-chunker'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Load chunks from disk
const chunks = await Promise.all(
  chunkFiles.map(async (file, index) => {
    const buffer = await readFile(file)
    const checksum = createHash('sha256').update(buffer).digest('hex')
    return {
      buffer,
      index,
      checksum,
    }
  })
)

const joiner = new FileJoiner({
  finalChecksum: expectedFileChecksum,
  chunks,
})

try {
  for await (const result of joiner.join()) {
    if (!result.done) {
      // Write chunks to disk as they're validated
      await writeFile('reconstructed-file.bin', result.output, { flag: 'a' })
      console.log(`Validated chunk checksum: ${result.checksum}`)
    } else {
      // Final validation complete
      console.log(`File checksum validated: ${result.finalChecksum}`)
      console.log(`Processed ${result.sourceChunks.length} chunks`)
    }
  }
} catch (error) {
  if (error instanceof InvalidChecksumError) {
    console.error('Chunk checksum validation failed:', error.message)
  } else if (error instanceof InvalidFinalChecksumError) {
    console.error('File checksum validation failed:', error.message)
  }
}
```

## API Reference

### FileChunker

#### Constructor

```typescript
new FileChunker(filePath: string, config: FileChunkerConfig)
```

- `filePath`: Path to the file to chunk
- `config.chunkSize`: Size of each chunk in bytes

#### Method

```typescript
async *chunk(): AsyncGenerator<ChunkResult, void, unknown>
```

Returns an async generator that yields chunks of the file.

#### Types

```typescript
type FileChunkerConfig = {
  chunkSize: number
}

type ChunkResult =
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
```

### FileJoiner

#### Constructor

```typescript
new FileJoiner(config: FileJoinerConfig)
```

- `config.finalChecksum`: Expected SHA256 checksum of the complete file
- `config.chunks`: Array of file chunks to join

#### Method

```typescript
async *join(): AsyncGenerator<JoinResult, void, unknown>
```

Returns an async generator that yields validated chunks and validates the final file checksum.

#### Types

```typescript
type FileChunk = {
  buffer: Buffer
  index: number
  checksum: string
}

type FileJoinerConfig = {
  finalChecksum: string
  chunks: FileChunk[]
}

type JoinResult =
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
```

### Error Types

```typescript
class InvalidChunkError extends Error
class InvalidChecksumError extends Error
class InvalidFinalChecksumError extends Error
```

## Memory Efficiency

This library is designed for handling very large files with minimal memory usage:

- **Streaming**: Files are read using Node.js streams, never loaded entirely into memory
- **Incremental Processing**: Chunks are processed and yielded immediately
- **Single Buffer**: Only one buffer (max `chunkSize`) is kept in memory at a time
- **Incremental Hashing**: File checksums are calculated incrementally as data streams

## License

ISC
