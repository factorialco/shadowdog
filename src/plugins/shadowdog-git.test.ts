import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import shadowdogGit from './shadowdog-git'
import process from 'process'
import { ShadowdogEventEmitter } from '../events'

describe('shadowdog git', () => {
  const next = vi.fn()
  const eventEmitter = new ShadowdogEventEmitter()

  beforeEach(() => {
    fs.mkdirpSync('tmp/.git')
    fs.writeFileSync('tmp/.git/rebase-merge', 'deadbeef')
    vi.spyOn(process, 'cwd').mockReturnValue('tmp')
  })

  afterEach(() => {
    fs.rmSync('tmp/.git', { recursive: true })
  })

  describe('when there is a rebase in the current folder', () => {
    it('does not execute the next middleware', async () => {
      await shadowdogGit.middleware({
        config: {
          command: 'echo foo',
          artifacts: [],
          tags: [],
          workingDirectory: '',
        },
        files: [],
        environment: [],
        next,
        abort: () => {},
        options: {},
        changedFilePath: 'README.md',
        eventEmitter,
      })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
