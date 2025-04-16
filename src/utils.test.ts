import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import { computeCache } from './utils'

// Mock fs module first to ensure all fs operations go through our mock
vi.mock('fs', () => {
  // Create a mock implementation for statSync
  const statSync = vi.fn((filePath) => {
    // If it's package.json, return that it's a file
    if (filePath.endsWith('package.json')) {
      return {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: 0,
        blksize: 0,
        blocks: 0,
        atimeMs: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
      }
    }
    // For other files, verify we're getting the expected paths
    expect(filePath).toMatch(/^\/mock\/working\/directory\/path\/to\/file.*\.txt$/)
    return {
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      dev: 0,
      ino: 0,
      mode: 0,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: 0,
      blksize: 0,
      blocks: 0,
      atimeMs: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      birthtimeMs: 0,
      atime: new Date(),
      mtime: new Date(),
      ctime: new Date(),
      birthtime: new Date(),
    }
  })

  // Create a mock implementation for readFileSync
  const readFileSync = vi.fn((filePath) => {
    // If it's package.json, return a minimal JSON with version
    if (filePath.endsWith('package.json')) {
      return JSON.stringify({ version: '1.0.0' })
    }
    // For other files, verify we're getting the expected paths
    expect(filePath).toMatch(/^\/mock\/working\/directory\/path\/to\/file.*\.txt$/)
    return 'same content'
  })

  // Create the mock object with a default export
  const mockFs = {
    statSync,
    readFileSync,
    // Import other fs functions we don't want to mock
    ...vi.importActual('fs'),
  }

  // Return both the default export and the named exports
  return {
    default: mockFs,
    ...mockFs,
  }
})

// Mock glob to return the exact pattern as a single file
vi.mock('glob', () => ({
  sync: (pattern: string) => [pattern],
}))

describe('computeCache', () => {
  beforeEach(() => {
    vi.stubEnv('TEST_ENV', 'test_value')
    // Mock process.cwd() to return a fixed path
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/working/directory')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('includes file paths in the cache key', () => {
    const filePath1 = 'path/to/file1.txt'
    const filePath2 = 'path/to/file2.txt'

    // First call with file1
    const cacheKey1 = computeCache([filePath1], ['TEST_ENV'], 'test command')

    // Second call with file2 (same content, different path)
    const cacheKey2 = computeCache([filePath2], ['TEST_ENV'], 'test command')

    // The cache keys should be different because the file paths are different
    expect(cacheKey1).not.toBe(cacheKey2)

    // Verify that both the file path and content were used in the hash
    expect(fs.readFileSync).toHaveBeenCalledWith(
      '/mock/working/directory/path/to/file1.txt',
      'utf-8',
    )
    expect(fs.readFileSync).toHaveBeenCalledWith(
      '/mock/working/directory/path/to/file2.txt',
      'utf-8',
    )
  })

  it('includes environment variables in the cache key', () => {
    const filePath = 'path/to/file.txt'

    // First call with TEST_ENV=value1
    vi.stubEnv('TEST_ENV', 'value1')
    const cacheKey1 = computeCache([filePath], ['TEST_ENV'], 'test command')

    // Second call with TEST_ENV=value2
    vi.stubEnv('TEST_ENV', 'value2')
    const cacheKey2 = computeCache([filePath], ['TEST_ENV'], 'test command')

    // The cache keys should be different because the environment variable changed
    expect(cacheKey1).not.toBe(cacheKey2)
  })

  it('includes command in the cache key', () => {
    const filePath = 'path/to/file.txt'

    // First call with command1
    const cacheKey1 = computeCache([filePath], ['TEST_ENV'], 'command1')

    // Second call with command2
    const cacheKey2 = computeCache([filePath], ['TEST_ENV'], 'command2')

    // The cache keys should be different because the commands are different
    expect(cacheKey1).not.toBe(cacheKey2)
  })
})
