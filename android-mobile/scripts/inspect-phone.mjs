import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { phonePage } from './phone-page.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const connection = await phonePage()
try {
  const { page } = connection
  page.on('pageerror', error => console.log('PAGE_ERROR ' + error.message))
  console.log(JSON.stringify({ title: await page.title(), text: await page.locator('body').innerText(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })) }, null, 2))
  await fs.mkdir(path.join(root, 'test-results/phone'), { recursive: true })
  if (process.argv.includes('--connect') && await page.getByRole('button', { name: '连接本地环境', exact: true }).count()) {
    await page.getByRole('button', { name: '连接本地环境', exact: true }).evaluate(button => button.click())
    await page.waitForTimeout(1500)
    console.log('CONNECTION_REQUESTED')
  }
} finally { await connection.close() }
