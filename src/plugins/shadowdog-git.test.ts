import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import shadowdogGit from './shadowdog-git'
import process from 'process'

describe('shadowdog git', () => {
  const next = vi.fn()

  beforeEach(() => {
    fs.mkdirpSync('tmp/.git')
    fs.writeFile('tmp/.git/rebase-merge', 'deadbeef')
    vi.spyOn(process, 'cwd').mockReturnValue('tmp')
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
        invalidators: {
          environment: [],
          files: [],
        },
        next,
        abort: () => {},
        options: {},
        changedFilePath: 'README.md',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
