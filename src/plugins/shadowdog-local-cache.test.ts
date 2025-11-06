import fs from 'fs-extra'
import { describe, it, beforeEach, afterEach, vi, expect, afterAll } from 'vitest'
import shadowdogLocalCache, { compressArtifact } from './shadowdog-local-cache'
import { ShadowdogEventEmitter } from '../events'

vi.mock('../utils', async () => {
  const utils = await vi.importActual('../utils')

  return {
    ...utils,
    computeCache: vi.fn(() => '0adeca2ac6'),
    computeFileCacheName: vi.fn(() => '0adeca2ac6'),
    readShadowdogVersion: vi.fn(() => ''),
  }
})

describe('shadowdog local cache', () => {
  const next = vi.fn(() => fs.writeFile('tmp/tests/artifacts/foo', 'foo'))
  const eventEmitter = new ShadowdogEventEmitter()

  beforeEach(() => {
    fs.mkdirpSync('tmp/tests/cache')
    fs.mkdirpSync('tmp/tests/artifacts')
  })

  afterEach(() => {
    // Clean up all test directories
    if (fs.existsSync('tmp')) {
      fs.rmSync('tmp', { recursive: true, force: true })
    }
    next.mockClear()
  })

  describe('when cache is not present', () => {
    it('executes the next middleware', async () => {
      await shadowdogLocalCache.middleware({
        config: {
          command: 'echo foo',
          artifacts: [
            {
              output: 'tmp/tests/artifacts/foo',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: [],
        environment: [],
        next,
        abort: () => {},
        options: {
          path: 'tmp/tests/cache',
          read: true,
          write: true,
        },
        eventEmitter,
      })
      expect(next).toHaveBeenCalled()
    })
  })

  describe('when cache is present', () => {
    describe('when the artifact is a single file', () => {
      beforeEach(async () => {
        fs.writeFileSync('tmp/tests/artifacts/foo', 'foo')
        await compressArtifact('tmp/tests/artifacts/foo', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        fs.rmSync('tmp/tests/artifacts', { recursive: true })
      })

      it('does not execute the next middleware', async () => {
        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/foo',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })
        expect(next).not.toHaveBeenCalled()
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('foo')
      })
    })

    describe('when the artifact is a folder with some files to ignore', () => {
      beforeEach(async () => {
        fs.mkdirpSync('tmp/tests/artifacts')
        fs.writeFileSync('tmp/tests/artifacts/foo', 'foo')
        fs.writeFileSync('tmp/tests/artifacts/bar', 'bar')
        await compressArtifact('tmp/tests/artifacts', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        fs.rmSync('tmp/tests/artifacts', { recursive: true })
      })

      it('does not execute the next middleware', async () => {
        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts',
                ignore: ['tmp/tests/artifacts/bar'],
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })
        fs.mkdirpSync('tmp/tests/artifacts')
        expect(next).not.toHaveBeenCalled()
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('foo')
        expect(fs.existsSync('tmp/tests/artifacts/bar')).toBe(false)
      })
    })
  })

  describe('when local cache path is overriden by env var', () => {
    beforeEach(async () => {
      vi.stubEnv('SHADOWDOG_LOCAL_CACHE_PATH', 'tmp/tests/cache_overriden')
      fs.mkdirpSync('tmp/tests/cache_overriden')
      fs.writeFileSync('tmp/tests/artifacts/foo', 'foo')
    })

    afterEach(() => {
      // Clean up the overridden cache path
      if (fs.existsSync('tmp/tests/cache_overriden')) {
        fs.rmSync('tmp/tests/cache_overriden', { recursive: true, force: true })
      }
    })

    afterAll(() => {
      vi.unstubAllEnvs()
    })

    it('stores the cache in the defined path', async () => {
      await shadowdogLocalCache.middleware({
        config: {
          command: 'echo foo',
          artifacts: [
            {
              output: 'tmp/tests/artifacts/foo',
            },
          ],
          tags: [],
          workingDirectory: '',
        },
        files: [],
        environment: [],
        next,
        abort: () => {},
        options: {
          path: 'tmp/tests/cache',
          read: true,
          write: true,
        },
        eventEmitter,
      })
      expect(fs.existsSync('tmp/tests/cache/0adeca2ac6.tar.gz')).toBe(false)
      expect(fs.existsSync('tmp/tests/cache_overriden/0adeca2ac6.tar.gz')).toBe(true)
    })
  })

  describe('SHA verification before restoring from cache', () => {
    describe('when artifact does not exist', () => {
      beforeEach(async () => {
        fs.writeFileSync('tmp/tests/artifacts/foo', 'original content')
        await compressArtifact('tmp/tests/artifacts/foo', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        fs.rmSync('tmp/tests/artifacts', { recursive: true })
      })

      it('restores from cache even when artifact does not exist', async () => {
        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/foo',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })
        expect(next).not.toHaveBeenCalled()
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('original content')
      })
    })

    describe('when artifact exists and SHA matches', () => {
      beforeEach(async () => {
        // Create cache with 'original content'
        fs.writeFileSync('tmp/tests/artifacts/foo', 'original content')
        await compressArtifact('tmp/tests/artifacts/foo', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        // Keep the file with same content (SHA should match)
      })

      it('skips restore when existing file SHA matches cached content', async () => {
        // Record initial content to verify it doesn't change
        const initialContent = fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')

        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/foo',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })

        expect(next).not.toHaveBeenCalled()
        // File content should remain unchanged (restore was skipped)
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe(initialContent)
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('original content')
      })
    })

    describe('when artifact exists but SHA does not match', () => {
      beforeEach(async () => {
        // Create cache with 'original content'
        fs.writeFileSync('tmp/tests/artifacts/foo', 'original content')
        await compressArtifact('tmp/tests/artifacts/foo', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        // Change the file content (SHA will not match)
        fs.writeFileSync('tmp/tests/artifacts/foo', 'modified content')
      })

      it('restores from cache when existing file SHA does not match', async () => {
        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/foo',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })

        expect(next).not.toHaveBeenCalled()
        // File should be restored to original content from cache
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('original content')
      })
    })

    describe('when artifact is a directory and SHA matches', () => {
      beforeEach(async () => {
        // Create cache with directory containing files
        fs.mkdirpSync('tmp/tests/artifacts/dir')
        fs.writeFileSync('tmp/tests/artifacts/dir/file1.txt', 'content1')
        fs.writeFileSync('tmp/tests/artifacts/dir/file2.txt', 'content2')
        await compressArtifact('tmp/tests/artifacts/dir', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        // Keep the directory with same content
      })

      it('skips restore when existing directory SHA matches cached content', async () => {
        // Record initial content to verify it doesn't change
        const initialContent1 = fs.readFileSync('tmp/tests/artifacts/dir/file1.txt', 'utf8')
        const initialContent2 = fs.readFileSync('tmp/tests/artifacts/dir/file2.txt', 'utf8')

        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/dir',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })

        expect(next).not.toHaveBeenCalled()
        // Directory content should remain unchanged (restore was skipped)
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file1.txt', 'utf8')).toBe(initialContent1)
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file2.txt', 'utf8')).toBe(initialContent2)
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file1.txt', 'utf8')).toBe('content1')
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file2.txt', 'utf8')).toBe('content2')
      })
    })

    describe('when artifact is a directory and SHA does not match', () => {
      beforeEach(async () => {
        // Create cache with directory containing files
        fs.mkdirpSync('tmp/tests/artifacts/dir')
        fs.writeFileSync('tmp/tests/artifacts/dir/file1.txt', 'content1')
        fs.writeFileSync('tmp/tests/artifacts/dir/file2.txt', 'content2')
        await compressArtifact('tmp/tests/artifacts/dir', 'tmp/tests/cache/0adeca2ac6.tar.gz')
        // Modify the directory content (SHA will not match)
        fs.writeFileSync('tmp/tests/artifacts/dir/file1.txt', 'modified content')
      })

      it('restores from cache when existing directory SHA does not match', async () => {
        await shadowdogLocalCache.middleware({
          config: {
            command: 'echo foo',
            artifacts: [
              {
                output: 'tmp/tests/artifacts/dir',
              },
            ],
            tags: [],
            workingDirectory: '',
          },
          files: [],
          environment: [],
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
            read: true,
            write: true,
          },
          eventEmitter,
        })

        expect(next).not.toHaveBeenCalled()
        // Directory should be restored to original content from cache
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file1.txt', 'utf8')).toBe('content1')
        expect(fs.readFileSync('tmp/tests/artifacts/dir/file2.txt', 'utf8')).toBe('content2')
      })
    })
  })
})
