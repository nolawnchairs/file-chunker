export class InvalidChunkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChunkError'
  }
}

export class InvalidChecksumError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidChecksumError'
  }
}

export class InvalidFinalChecksumError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFinalChecksumError'
  }
}
