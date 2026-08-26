import { readFileSync, writeFileSync } from 'node:fs'
import YAML from 'yaml'
const root = new URL('../', import.meta.url)
const yml = readFileSync(new URL('src/i18n/zh.yml', root), 'utf8')
writeFileSync(new URL('src/i18n/zh.json', root), JSON.stringify(YAML.parse(yml), null, 2) + '\n')
console.log('zh.json generated')
