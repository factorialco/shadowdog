import { it, expect, vi, beforeAll, afterAll } from 'vitest'
import shadowdogTag from './shadowdog-tag'
import { Task } from '../generate'

beforeAll(() => {
  vi.stubEnv('SHADOWDOG_TAG', 'documentation')
})

it('shadowdog tag filters tasks given a tag from environment variables', () => {
  const task: Task = {
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'echo documentation',
          artifacts: [],
          tags: ['documentation'],
          workingDirectory: 'backend',
        },
        files: [],
        invalidators: {
          environment: [],
          files: [],
        },
      },
      {
        type: 'command',
        config: {
          command: 'echo graphql',
          artifacts: [],
          tags: ['graphql'],
          workingDirectory: 'backend',
        },
        files: [],
        invalidators: {
          environment: [],
          files: [],
        },
      },
      {
        type: 'command',
        config: {
          command: 'echo non tags',
          artifacts: [],
          tags: [''],
          workingDirectory: 'backend',
        },
        files: [],
        invalidators: {
          environment: [],
          files: [],
        },
      },
    ],
  }

  expect(shadowdogTag.command(task)).toEqual({
    type: 'parallel',
    tasks: [
      {
        type: 'command',
        config: {
          command: 'echo documentation',
          artifacts: [],
          tags: ['documentation'],
          workingDirectory: 'backend',
        },
        files: [],
        invalidators: {
          environment: [],
          files: [],
        },
      },
      {
        type: 'empty',
      },
      {
        type: 'empty',
      },
    ],
  })
})

afterAll(() => {
  vi.unstubAllEnvs()
})
