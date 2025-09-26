import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import shadowdogLock from './shadowdog-lock'
import * as fs from 'fs-extra'
import { ShadowdogEventEmitter } from '../events'

// Mock fs-extra - because apparently mocking file system operations is rocket science
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeJSON: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn().mockResolvedValue({}),
  pathExists: vi.fn().mockResolvedValue(false),
}))

// Mock glob
vi.mock('glob', () => ({
  glob: vi.fn(),
}))

// Mock utils
vi.mock('../utils', () => ({
  logMessage: vi.fn(),
  readShadowdogVersion: vi.fn(() => '0.8.0'),
  computeCache: vi.fn((files, env, cmd) => `cache-${files.length}-${env.length}-${cmd.length}`),
  computeFileCacheName: vi.fn((cache, fileName) => `file-cache-${cache}-${fileName}`),
}))

describe('shadowdog-lock plugin', () => {
  let mockNext: () => Promise<void>
  let mockAbort: () => void
  let mockEventEmitter: ShadowdogEventEmitter
  let mockControl: {
    files: string[]
    environment: string[]
    config: {
      command: string
      workingDirectory: string
      tags: string[]
      artifacts: Array<{ output: string; ignore?: string[] }>
    }
    options: { path: string }
    next: () => Promise<void>
    abort: () => void
    eventEmitter: ShadowdogEventEmitter
  }

  beforeEach(() => {
    mockNext = vi.fn().mockResolvedValue(undefined)
    mockAbort = vi.fn()
    mockEventEmitter = new ShadowdogEventEmitter()
    mockControl = {
      files: ['src/test.ts'],
      environment: [],
      config: {
        command: 'npm run test',
        workingDirectory: '',
        tags: [],
        artifacts: [{ output: 'test.json' }],
      },
      options: { path: '/tmp/shadowdog/lock' },
      next: mockNext,
      abort: mockAbort,
      eventEmitter: mockEventEmitter,
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should be a middleware plugin', () => {
    expect(shadowdogLock).toHaveProperty('middleware')
    expect(typeof shadowdogLock.middleware).toBe('function')
  })

  it('should write lock file after task completion', async () => {
    // The mocks are already set up, no need to mock them again
    await shadowdogLock.middleware(mockControl)

    expect(mockNext).toHaveBeenCalled()
    expect(fs.ensureDir).toHaveBeenCalled()
    expect(fs.writeJSON).toHaveBeenCalled()
  })

  it('should merge with existing lock file', async () => {
    const existingLockFile = {
      version: '0.7.0',
      nodeVersion: 'v20.0.0',
      artifacts: [
        {
          output: 'existing.json',
          cacheIdentifier: 'old-cache',
          fileManifest: {
            watchedFiles: ['src/existing.ts'],
            invalidatorFiles: [],
            environment: {},
            command: 'npm run existing',
            cacheIdentifier: 'old-watched-cache',
          },
        },
      ],
    }

    // Override the default mocks for this test - because we need different behavior
    ;(fs.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    vi.mocked(fs.readJSON).mockResolvedValue(existingLockFile)

    await shadowdogLock.middleware(mockControl)

    expect(fs.writeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({ output: 'existing.json' }),
          expect.objectContaining({ output: 'test.json' }),
        ]),
      }),
      { spaces: 2 },
    )
  })

  it('should handle file patterns as provided', async () => {
    mockControl.files = ['src/test1.ts', 'src/test2.ts']

    await shadowdogLock.middleware(mockControl)

    expect(fs.writeJSON).toHaveBeenCalled()
    // Verify the files are included in the lock file
    expect(fs.writeJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            fileManifest: expect.objectContaining({
              watchedFiles: ['src/test1.ts', 'src/test2.ts'],
            }),
          }),
        ]),
      }),
      { spaces: 2 },
    )
  })

  it('should handle errors gracefully', async () => {
    // Mock fs functions to throw error - because we need to test error handling too
    vi.mocked(fs.pathExists).mockRejectedValue(new Error('File system error'))

    // Should not throw - the plugin should handle errors gracefully
    await expect(shadowdogLock.middleware(mockControl)).resolves.not.toThrow()

    // Should still try to write the file
    expect(fs.writeJSON).toHaveBeenCalled()
  })

  it('should handle concurrent calls with write promise protection', async () => {
    // Mock fs functions with delays - because testing concurrency is fun
    vi.mocked(fs.ensureDir).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    )

    // Call middleware multiple times concurrently - this is where the magic happens
    const promises = [
      shadowdogLock.middleware(mockControl),
      shadowdogLock.middleware(mockControl),
      shadowdogLock.middleware(mockControl),
    ]

    await Promise.all(promises)

    // The plugin should write the lock file for each call, but the writePromise
    // ensures they don't interfere with each other
    expect(fs.writeJSON).toHaveBeenCalled()
    expect(fs.writeJSON).toHaveBeenCalledTimes(3)
  })
})
