import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(path.dirname(root), 'package.json'))
const { chromium } = require('playwright'), run = promisify(execFile)
export async function phonePage() {
  const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/adb-36.0.2/platform-tools/adb.exe'
  const { stdout } = await run(adb, ['-d', 'shell', 'pidof', process.env.MODMIND_PACKAGE || 'dev.modmind.mobile.pilot'], { timeout: 5000 })
  const pid = stdout.trim(); if (!/^\d+$/.test(pid)) throw Error('Open the pilot app first')
  await run(adb, ['-d', 'forward', 'tcp:19223', 'localabstract:webview_devtools_remote_' + pid], { timeout: 5000 })
  const browser = await chromium.connectOverCDP('http://127.0.0.1:19223', { timeout: 10000 })
  const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('https://appassets.androidplatform.net/'))
  if (!page) { await browser.close(); throw Error('Pilot WebView was not found') }
  page.setDefaultTimeout(10000)
  return { page, close: () => browser.close() }
}
