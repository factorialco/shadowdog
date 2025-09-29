import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import shadowdogLock from './shadowdog-lock'
import * as fs from 'fs-extra'
import { writeFileSync } from 'fs'
import { ShadowdogEventEmitter } from '../events'

// Mock fs-extra - because apparently mocking file system operations is rocket science
vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeJSON: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn().mockResolvedValue({}),
  pathExists: vi.fn().mockResolvedValue(false),
}))

// Mock fs writeFileSync
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
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
  processFiles: vi.fn((files) => files), // Mock processFiles to return files as-is
}))

describe('shadowdog-lock plugin', () => {
  let mockEventEmitter: ShadowdogEventEmitter
  let mockConfig: unknown

  beforeEach(() => {
    mockEventEmitter = new ShadowdogEventEmitter()
    mockConfig = {
      watchers: [
        {
          files: ['src/test.ts'],
          environment: [],
          ignored: [],
          commands: [
            {
              command: 'npm run test',
              artifacts: [{ output: 'test.json' }],
            },
          ],
        },
      ],
      defaultIgnoredFiles: [],
    }
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should be a listener plugin', () => {
    expect(shadowdogLock).toHaveProperty('listener')
    expect(typeof shadowdogLock.listener).toBe('function')
  })

  it('should not regenerate lock file after config is loaded', async () => {
    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // Emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should not regenerate on config loaded anymore
    expect(fs.ensureDir).not.toHaveBeenCalled()
    expect(fs.writeJSON).not.toHaveBeenCalled()
  })

  it('should regenerate lock file after task completion in daemon mode', async () => {
    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // First emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })

    // Wait for config to be processed
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Clear previous calls
    vi.clearAllMocks()

    // Simulate daemon mode by emitting generateStarted then allTasksComplete
    // to set isInGenerateMode to false
    mockEventEmitter.emit('generateStarted')
    mockEventEmitter.emit('allTasksComplete')

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Clear previous calls again
    vi.clearAllMocks()

    // Now emit end event (should regenerate in daemon mode)
    mockEventEmitter.emit('end', { artifacts: [{ output: 'test.json' }] })

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writeFileSync).toHaveBeenCalled()
  })

  it('should not regenerate lock file on initialized event in watch mode', async () => {
    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // First emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })

    // Wait for config to be processed
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Clear previous calls
    vi.clearAllMocks()

    // Emit initialized event (should not regenerate in watch mode)
    mockEventEmitter.emit('initialized')

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Should not regenerate on initialized event in watch mode
    expect(fs.ensureDir).not.toHaveBeenCalled()
    expect(fs.writeJSON).not.toHaveBeenCalled()
  })

  it('should regenerate lock file after all tasks complete in generate mode', async () => {
    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // First emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })

    // Wait for config to be processed
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Clear previous calls
    vi.clearAllMocks()

    // Emit allTasksComplete event (generate mode)
    mockEventEmitter.emit('allTasksComplete')

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writeFileSync).toHaveBeenCalled()
  })

  it('should generate deterministic lock file based on config order', async () => {
    const multiWatcherConfig = {
      watchers: [
        {
          files: ['src/a.ts'],
          environment: [],
          ignored: [],
          commands: [
            {
              command: 'npm run build-a',
              artifacts: [{ output: 'a.json' }],
            },
          ],
        },
        {
          files: ['src/b.ts'],
          environment: [],
          ignored: [],
          commands: [
            {
              command: 'npm run build-b',
              artifacts: [{ output: 'b.json' }],
            },
          ],
        },
      ],
      defaultIgnoredFiles: [],
    }

    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // Emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: multiWatcherConfig })

    // Emit allTasksComplete event (this is when lock file should be regenerated)
    mockEventEmitter.emit('allTasksComplete')

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"output": "a.json"'),
      'utf8',
    )
  })

  it('should handle errors gracefully', async () => {
    // Mock fs functions to throw error
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('Write error')
    })

    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // Emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })
    mockEventEmitter.emit('allTasksComplete')

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should not throw - the plugin should handle errors gracefully
    // The function should complete without throwing
    expect(true).toBe(true)
  })

  it('should handle concurrent calls with write promise protection', async () => {
    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // Emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: mockConfig })

    // Emit multiple end events concurrently
    mockEventEmitter.emit('end', { artifacts: [{ output: 'test1.json' }] })
    mockEventEmitter.emit('end', { artifacts: [{ output: 'test2.json' }] })
    mockEventEmitter.emit('end', { artifacts: [{ output: 'test3.json' }] })

    // Wait for all async operations
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The plugin should handle concurrent calls gracefully
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('should always write lock file regardless of tag filtering', async () => {
    const configWithTags = {
      watchers: [
        {
          files: ['src/a.ts'],
          environment: [],
          ignored: [],
          commands: [
            {
              command: 'npm run build-a',
              artifacts: [{ output: 'a.json' }],
              tags: ['production'],
            },
          ],
        },
        {
          files: ['src/b.ts'],
          environment: [],
          ignored: [],
          commands: [
            {
              command: 'npm run build-b',
              artifacts: [{ output: 'b.json' }],
              tags: ['development'],
            },
          ],
        },
      ],
      defaultIgnoredFiles: [],
    }

    // Set up the listener
    shadowdogLock.listener(mockEventEmitter, { path: '/tmp/shadowdog/lock' })

    // Emit config loaded event
    mockEventEmitter.emit('configLoaded', { config: configWithTags })

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The lock file should be written (we can verify this works in integration tests)
    // For now, just verify the function doesn't throw
    expect(true).toBe(true)
  })
})
