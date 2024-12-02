import { configSchema } from './config'
import { it, expect } from 'vitest'

it('shadowdog does not accept an invalid config', () => {
  expect(() => configSchema.parse({})).toThrow()
})

it('shadowdog accepts a valid config', () => {
  expect(() =>
    configSchema.parse({
      $schema:
        'https://raw.githubusercontent.com/factorialco/shadowdog/refs/heads/main/src/config/schema.json',
      plugins: [
        {
          name: 'shadowdog-local-cache',
        },
      ],
      watchers: [
        {
          files: ['example.txt'],
          commands: [
            {
              artifacts: [
                {
                  output: 'example.output.txt',
                },
              ],
              command: 'cp example.txt example.output.txt',
            },
          ],
        },
      ],
    }),
  ).not.toThrow()
})
