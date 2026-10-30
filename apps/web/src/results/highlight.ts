import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'

const highlighter = createLowlight({ javascript, typescript, json, css, xml, python, bash, powershell, sql, yaml })
highlighter.registerAlias({ javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'], python: ['py'], bash: ['sh', 'shell'], powershell: ['ps1', 'pwsh'], yaml: ['yml'], xml: ['html', 'svg'] })

// Never guess a language or turn backend code into executable HTML.
export function highlightCode(text: string, language: string) {
  return text.length <= 20000 && highlighter.registered(language) ? highlighter.highlight(language, text) : null
}
