import { zodToJsonSchema } from 'zod-to-json-schema'
import fs from 'fs-extra'
import { configSchema } from './config'
import prettier from 'prettier'

const main = async () => {
  const jsonSchema = zodToJsonSchema(configSchema)

  const prettierConfig = await prettier.resolveConfig(process.cwd())
  const result = await prettier.format(JSON.stringify(jsonSchema, null, 2), {
    parser: 'json',
    ...prettierConfig,
  })

  fs.writeFileSync('schema.json', result)
}

main()
