import fs from 'fs-extra'
import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'
import shadowdogLocalCache, { compressArtifact } from './shadowdog-local-cache'

describe('shadowdog local cache', () => {
  const next = vi.fn(() => fs.writeFile('tmp/tests/artifacts/foo', 'foo'))

  beforeEach(() => {
    fs.mkdirpSync('tmp/tests/cache')
    fs.mkdirpSync('tmp/tests/artifacts')
  })

  afterEach(() => {
    fs.rmSync('tmp', { recursive: true })
    return next.mockClear()
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
        invalidators: {
          environment: [],
          files: [],
        },
        next,
        abort: () => {},
        options: {
          path: 'tmp/tests/cache',
        },
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
          invalidators: {
            environment: [],
            files: [],
          },
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
          },
        })
        expect(next).not.toHaveBeenCalled()
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('foo')
      })
    })

    describe('when the artifact is a folder with some files to ignore', () => {
      beforeEach(async () => {
        fs.writeFileSync('tmp/tests/artifacts/foo', 'foo')
        fs.writeFileSync('tmp/tests/artifacts/bar', 'bar')
        await compressArtifact('tmp/tests/artifacts', 'tmp/tests/cache/079138748b.tar.gz')
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
          invalidators: {
            environment: [],
            files: [],
          },
          next,
          abort: () => {},
          options: {
            path: 'tmp/tests/cache',
          },
        })
        expect(next).not.toHaveBeenCalled()
        expect(fs.readFileSync('tmp/tests/artifacts/foo', 'utf8')).toBe('foo')
        expect(fs.existsSync('tmp/tests/artifacts/bar')).toBe(false)
      })
    })
  })
})
