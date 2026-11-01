// Chrome をヘッドレスで起動し、DevTools Protocol でページを操作する検査用の道具
// 使い方: node tests/ui/cdp.js <ページ> <steps.js> [画像を置くフォルダ] [幅] [高さ]
//   ページはファイルの場所(index.html など、今のフォルダからの相対でよい)か URL。
//   画像を置くフォルダを省くと、OS の一時フォルダの vca-ui-check に置く。
//   Chrome は決まった場所から探す。見つからないときは環境変数 CHROME で場所を指定する。
//   steps.js は module.exports = async (t) => { ... } で、t.eval(expr) / t.shot(name) / t.drop(selector, files) / t.sleep(ms) / t.log(...) を使う
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const [page, stepsFile, outArg, W = '1280', H = '800'] = process.argv.slice(2);
if (!page || !stepsFile) { console.error('使い方: node tests/ui/cdp.js <ページ> <steps.js> [画像を置くフォルダ] [幅] [高さ]'); process.exit(2); }
const url = /^[a-z]+:\/\//i.test(page) ? page : pathToFileURL(path.resolve(page)).href;
const outDir = outArg || path.join(os.tmpdir(), 'vca-ui-check');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome が見つかりません。環境変数 CHROME に場所を指定してください。'); process.exit(2); }
const PORT = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(outDir, 'chrome-prof-' + PORT);
fs.mkdirSync(outDir, { recursive: true });

const proc = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];

(async () => {
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(200);
  }
  if (!ws) throw new Error('chrome did not start');
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push('CONSOLE ' + m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/GL Driver|favicon/.test(m.params.entry.text)) problems.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  // 応答が 60 秒来なければ失敗にする(ページが別のところへ移って止まったときなどに、待ち続けない)
  const send = (method, params = {}) => new Promise((r, reject) => {
    const i = ++id;
    const timer = setTimeout(() => { wait.delete(i); reject(new Error(`${method} の応答が 60 秒ありません`)); }, 60000);
    wait.set(i, m => { clearTimeout(timer); r(m); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 768 });
  await send('Page.navigate', { url });
  await sleep(3500);
  const t = {
    sleep,
    log: (...a) => console.log(...a),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error('eval failed: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200));
      return r.result?.result?.value;
    },
    async shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(outDir, name + '.png'); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); return f;
    },
    // ファイルを OS からドラッグして、selector の要素の上に置く(Input.dispatchDragEvent)。files は [[名前, 中身]]。
    // 中身(文字列は latin1、または Buffer)を画像を置くフォルダの下に書いてから置く
    async drop(selector, files) {
      const at = await t.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
      // 見えていない要素の上には置けない(外に落ちると、ブラウザがファイルを開いてページが移る)
      if (!at) throw new Error(`${selector} が見えていないので、ファイルを置けません`);
      const dir = fs.mkdtempSync(path.join(outDir, 'drop-'));
      const paths = files.map(([name, body]) => { const p = path.join(dir, name); fs.writeFileSync(p, typeof body === 'string' ? Buffer.from(body, 'latin1') : body); return p; });
      const data = { items: [], files: paths, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: at[0], y: at[1], data });
    },
    async emulate(w, h, dark) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
      if (dark !== undefined) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    },
    problems,
  };
  let failed = false;
  try { await require(path.resolve(stepsFile))(t); }
  catch (e) { failed = true; console.log('STEP ERROR: ' + e.message); }
  console.log(problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no console problems');
  ws.close(); proc.kill();
  await sleep(300);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
