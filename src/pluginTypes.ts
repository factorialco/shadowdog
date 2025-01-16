import { z } from 'zod'

export const pluginOptionsSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('shadowdog-rake'), options: z.object({}).optional() }),
  z.object({
    name: z.literal('shadowdog-local-cache'),
    options: z
      .object({
        path: z.string().default('/tmp/shadowdog/cache'),
        read: z.boolean().default(true),
        write: z.boolean().default(true),
      })
      .default({}),
  }),
  z.object({
    name: z.literal('shadowdog-remote-aws-s3-cache'),
    options: z.object({
      path: z.string().default('shadowdog/cache'),
      bucketName: z.string(),
      read: z.boolean().default(true),
      write: z.boolean().default(true),
    }),
  }),
  z.object({ name: z.literal('shadowdog-tag'), options: z.object({}).optional() }),
  z.object({ name: z.literal('shadowdog-tree'), options: z.object({}).optional() }),
  z.object({
    name: z.literal('shadowdog-socket'),
    options: z.object({ path: z.string().default('/tmp/shadowdog/socket') }).default({}),
  }),
  z.object({ name: z.literal('shadowdog-git'), options: z.object({}).optional() }),
])

export type PluginConfig<T extends z.infer<typeof pluginOptionsSchema>['name']> = Extract<
  z.infer<typeof pluginOptionsSchema>,
  { name: T }
>['options']

export const PluginNameEnum = z.enum([
  'shadowdog-rake',
  'shadowdog-local-cache',
  'shadowdog-remote-aws-s3-cache',
  'shadowdog-tag',
  'shadowdog-tree',
  'shadowdog-socket',
  'shadowdog-git',
])
