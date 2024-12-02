import fs from 'fs-extra'
import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'
import shadowdogLocalCache from './shadowdog-local-cache'

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
    beforeEach(() => {
      fs.writeFileSync('tmp/tests/artifacts/foo', 'foo')
      // TODO: Gzip things
      fs.writeFileSync('tmp/tests/cache/0adeca2ac6.tar.gz', 'foo')
    })

    it.skip('does not execute the next middleware', async () => {
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
    })
  })
})
