import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(path.join(path.dirname(root), 'package.json'))
const ts = require('typescript')
const files = ['src/main.tsx', 'backend/server.ts'].map(file => path.join(root, file))
const program = ts.createProgram(files, { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, allowSyntheticDefaultImports: true, resolveJsonModule: true, types: ['node', 'react', 'react-dom', 'vite/client'] })
const all = ts.getPreEmitDiagnostics(program)
const diagnostics = all.filter(value => !value.file || path.resolve(value.file.fileName).startsWith(root + path.sep) && !value.file.fileName.includes('node_modules'))
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n' }))
console.log(JSON.stringify({ mobileDiagnostics: diagnostics.length, externalDiagnostics: all.length - diagnostics.length }))
if (diagnostics.length) process.exitCode = 1
