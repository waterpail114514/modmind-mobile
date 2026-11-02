import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { phonePage } from './phone-page.mjs'
import { phoneRpc } from './phone-rpc.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adb = process.env.ADB || 'D:/Codex/UserData/tools/android/platform-tools/adb.exe'
const runAdb = promisify(execFile)
const output = path.join(root, 'test-results/phone'); await fs.mkdir(output, { recursive: true })
const connection = await phonePage(), { page } = connection
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const verified = []
const pass = name => { verified.push(name); console.log('PASS ' + name) }
const tap = async locator => {
  const notice = page.getByRole('button', { name: '关闭提示', exact: true })
  if (await notice.count()) await notice.evaluate(button => button.click())
  await locator.evaluate(element => { const list = element.closest('.file-list, .project-list'); if (list) element.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
  await sleep(200)
  const point = await locator.evaluate(element => { const r = element.getBoundingClientRect(); return { x: (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2 * devicePixelRatio, y: (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2 * devicePixelRatio + 120 } })
  await runAdb(adb, ['-d', 'shell', 'input', 'tap', String(Math.round(point.x)), String(Math.round(point.y))], { timeout: 10000 })
  await sleep(400)
}
const shot = async name => {
  if (process.env.MODMIND_PHONE_SCREENSHOTS !== '1') return
  await fs.writeFile(path.join(output, name + '.layout.json'), JSON.stringify(await page.evaluate(() => ({ scrollX, scrollY, viewport: { width: innerWidth, height: innerHeight, offset: visualViewport?.offsetTop }, elements: ['.mobile-app', '.app-header', '.project-heading', '.editor-toolbar', '.code-editor'].map(selector => { const el = document.querySelector(selector), rect = el?.getBoundingClientRect(); return { selector, scroll: el?.scrollTop, top: rect?.top, bottom: rect?.bottom } }) })), null, 2))
  await runAdb(adb, ['-d', 'shell', 'screencap', '-p', '/data/local/tmp/modmind-qa.png'], { timeout: 10000 })
  await runAdb(adb, ['-d', 'pull', '/data/local/tmp/modmind-qa.png', path.join(output, name + '.png')], { timeout: 10000 })
}
const button = name => page.getByRole('button', { name, exact: true })
const waitText = async (text, timeout = 20000) => {
  const end = Date.now() + timeout
  while (!(await page.locator('body').innerText()).includes(text)) { if (Date.now() > end) throw Error('Waiting for ' + text); await sleep(300) }
}
try {
  const phase = process.argv[2] || 'mod'
  if (phase === 'mod') {
    if (!await button('返回项目列表').count()) await tap(button('新建项目'))
    if (!await button('返回项目列表').count()) {
    await page.getByLabel('项目名称', { exact: true }).fill('手机模组测试')
    await page.getByLabel('项目标识', { exact: true }).fill('mobile_pilot')
    await shot('create-keyboard')
    await runAdb(adb, ['-d', 'shell', 'input', 'keyevent', '4'], { timeout: 10000 }); await sleep(300)
    await tap(button('创建项目')); await waitText('项目文件')
    }
    assert.ok((await page.locator('body').innerText()).includes('项目文件')); pass('native touch creates a real mod project')
    await tap(page.locator('.file-row').filter({ hasText: 'README.md' }))
    await page.locator('.cm-content').fill('# ModMind 手机本地测试\n\n这段内容在 OPPO 上保存。\n')
    await shot('editor-keyboard')
    await runAdb(adb, ['-d', 'shell', 'input', 'keyevent', '4'], { timeout: 10000 }); await sleep(300)
    await tap(button('保存')); await waitText('已保存')
    assert.ok((await page.locator('body').innerText()).includes('已保存')); pass('mobile editor saves real text')
    await tap(button('返回文件列表')); await tap(page.locator('.file-row').filter({ hasText: 'README.md' }))
    assert.ok((await page.locator('.cm-content').innerText()).includes('OPPO')); pass('saved text survives reopening')
    await shot('editor-light')
    await tap(button('切换深色主题')); await shot('editor-dark')
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    assert.equal(dimensions.width, dimensions.scrollWidth); pass('360px light/dark editor has no page overflow')
    await tap(button('返回文件列表')); await tap(button('构建模组'))
    pass('UI starts phone-local Gradle build')
    for (let attempt = 0; attempt < 120; attempt++) {
      const text = await page.locator('body').innerText()
      if (text.includes('构建失败') || text.includes('产物收集失败')) { await fs.writeFile(path.join(output, 'build-failure.txt'), text); throw Error('Phone build failed; see build-failure.txt') }
      if (text.includes('构建完成')) break
      if (attempt === 119) throw Error('Phone build timeout')
      if (attempt % 15 === 0) console.log('BUILD_RUNNING ' + attempt * 2 + 's')
      await sleep(2000)
    }
    pass('actual phone Gradle build completes in offline mode')
    await shot('build-completed')
    await tap(page.locator('.artifact-row').first()); await sleep(1000)
    assert.ok((await page.locator('body').innerText()).includes('下载/ModMind')); pass('native MediaStore exports compiled JAR to Downloads/ModMind')
    await tap(button('返回项目列表'))
  } else if (phase === 'pack') {
    if (await button('返回项目列表').count()) await tap(button('返回项目列表'))
    await tap(button('整合包制作')); await tap(button('新建项目'))
    await page.getByLabel('项目名称', { exact: true }).fill('手机整合包测试')
    await page.getByLabel('项目标识', { exact: true }).fill('mobile_pack')
    await runAdb(adb, ['-d', 'shell', 'input', 'keyevent', '4'], { timeout: 10000 }); await sleep(300)
    await tap(button('创建项目')); await waitText('项目文件')
    pass('native touch creates a real modpack project')
    await shot('pack-files')
    await tap(button('导入模组 JAR')); await sleep(500); console.log('NATIVE_PICKER_OPEN')
    await shot('pack-picker')
  } else if (phase === 'export') {
    await tap(button('导出整合包')); await sleep(1500)
    assert.ok((await page.locator('body').innerText()).includes('下载/ModMind')); pass('native UI exports real mrpack to Downloads/ModMind')
    await shot('pack-exported')
  } else if (phase === 'item') {
    await tap(page.locator('.project-row').filter({ hasText: '手机模组测试' }).first())
    await waitText('项目文件')
    for (const folder of ['src', 'main', 'java', 'dev', 'modmind', 'mobile_pilot']) await tap(button(folder))
    await tap(page.locator('.file-row').filter({ hasText: 'ModMindEntry.java' }))
    await page.locator('.cm-content').fill(`package dev.modmind.mobile_pilot;

import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;

public final class ModMindEntry implements ModInitializer {
    @Override
    public void onInitialize() {
        Registry.register(BuiltInRegistries.ITEM,
            ResourceLocation.fromNamespaceAndPath("mobile_pilot", "phone_item"),
            new Item(new Item.Properties()));
    }
}
`)
    await runAdb(adb, ['-d', 'shell', 'input', 'keyevent', '4'], { timeout: 10000 }); await sleep(300)
    await tap(button('保存')); await waitText('已保存')
    pass('phone editor saves Java code that registers a real Minecraft item')
    const { projects } = await phoneRpc('query', { operation: 'projects' }), selected = projects.find(value => value.namespace === 'mobile_pilot')
    const resource = 'src/main/resources/assets/mobile_pilot/models/item/phone_item.json'
    const old = await phoneRpc('query', { operation: 'read', projectId: selected.id, path: resource })
    await phoneRpc('write', { operation: 'save', projectId: selected.id, path: resource, revision: old.revision, content: JSON.stringify({ parent: 'minecraft:item/generated', textures: { layer0: 'minecraft:item/diamond' } }, null, 2) })
    await shot('java-editor-dark')
    await tap(button('切换浅色主题')); await shot('java-editor-light')
    await tap(button('返回文件列表'))
    const previous = await phoneRpc('query', { operation: 'tasks', projectId: selected.id }), ids = new Set(previous.tasks.map(task => task.id))
    await tap(button('构建模组'))
    let task
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await phoneRpc('query', { operation: 'tasks', projectId: selected.id }); task = result.tasks.find(task => !ids.has(task.id))
      if (task && task.status !== 'running') break
      if (attempt % 15 === 0) console.log('ITEM_BUILD_RUNNING ' + attempt * 2 + 's')
      await sleep(2000)
    }
    assert.equal(task?.status, 'completed', task?.log); pass('phone compiles and remaps the item mod in offline mode')
    await waitText('构建完成'); await shot('item-build-completed')
    await tap(page.locator('.artifact-row').first()); await waitText('下载/ModMind')
    pass('final APK exports the item mod JAR through MediaStore')
    await tap(button('返回项目列表'))
  } else if (phase === 'remove') {
    await tap(button('整合包制作'))
    await tap(page.locator('.project-row').filter({ hasText: '手机整合包测试' }).first())
    await tap(button('mods'))
    await tap(page.locator('.pack-jar summary').first())
    await tap(button('移出整合包'))
    await shot('remove-confirmation')
    await tap(page.getByRole('alertdialog').getByRole('button', { name: '移出整合包', exact: true }))
    await waitText('此目录还没有文件'); pass('phone UI removes an imported JAR after explicit confirmation')
    await tap(button('导入模组 JAR')); console.log('NATIVE_PICKER_OPEN_FOR_REIMPORT')
  } else if (phase === 'visual') {
    await tap(page.locator('.project-row').filter({ hasText: '手机模组测试' }).first())
    for (const folder of ['src', 'main', 'java', 'dev', 'modmind', 'mobile_pilot']) await tap(button(folder))
    await tap(page.locator('.file-row').filter({ hasText: 'ModMindEntry.java' }))
    await tap(page.locator('.cm-content')); await sleep(1000)
    await shot('final-editor-keyboard')
    const keyboard = await page.evaluate(() => ({ height: innerHeight, width: innerWidth, toolbarBottom: document.querySelector('.editor-toolbar').getBoundingClientRect().bottom }))
    assert.ok(keyboard.toolbarBottom < keyboard.height); pass('editor save and back controls remain above the native keyboard')
    await runAdb(adb, ['-d', 'shell', 'input', 'keyevent', '4'], { timeout: 10000 }); await sleep(500)
    if (await button('切换深色主题').count()) await tap(button('切换深色主题'))
    await sleep(500); await shot('final-editor-dark')
    await tap(button('切换浅色主题')); await sleep(500); await shot('final-editor-light')
    const width = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert.equal(width.width, width.scroll); pass('final light and dark editor retains the 360px page width')
    await tap(button('返回文件列表')); await tap(button('返回项目列表'))
  } else if (phase === 'local') {
    await tap(page.locator('.project-row').filter({ hasText: '手机模组测试' }).first())
    await tap(page.locator('.file-row').filter({ hasText: 'README.md' }))
    assert.ok((await page.locator('.cm-content').innerText()).includes('OPPO'))
    pass('UI reads saved phone-local files with the PC business forwarding port removed')
    await tap(button('返回文件列表')); await tap(button('返回项目列表'))
  }
  const record = path.join(output, 'verification-' + phase + '.json')
  await fs.writeFile(record, JSON.stringify({ verifiedAt: new Date().toISOString(), verified, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })) }, null, 2))
} catch (error) { await shot('failure'); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').innerText()); throw error }
finally { await connection.close() }
