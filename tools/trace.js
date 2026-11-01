// 規格との対応(docs/conformance.md)とテスト(tests/conformance.test.js)を突き合わせ、
// どの決まりをどのテストが確かめているかの一覧(docs/conformance-tests.md)を作る
//   node tools/trace.js           docs/conformance-tests.md を作り直す(npm run trace)
//   node tools/trace.js --check   食い違いがあるか、一覧が古ければ終了コード 1(GitHub Actions で使う)
//
// テストは tests/spec.js の spec(名前, { req, kind, side }, 本体) で書く。確かめること:
//   扱いが「テスト」の行には、「送る側」「受ける側」の欄が - でない側ごとに、その側のテストが 1 件以上ある
//   扱いが「テスト」の行には、正常系(正常・規格の例)と異常系(異常・境界)のテストが 1 件以上ずつある。
//   ただし「異常系を求めない行」の表に理由と一緒に書いた行は、異常系を求めない(異常系があれば、例外をやめるよう知らせる)
//   テストの req は対応の表にあり、その行の扱いは「テスト」。kind・side は決まった値
//   「テスト」以外の行には理由がある。番号は重ならない
//   R・S・O の番号と節が vca-guide の docs/requirements.md と合う(隣に vca-guide があるときだけ)
//   すべてのテストが通る
'use strict';
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..');
const DOC = path.join(repo, 'docs/conformance.md');
const OUT = path.join(repo, 'docs/conformance-tests.md');
const GUIDE = path.join(repo, '../vca-guide/docs/requirements.md');
const KINDS = ['正常', '異常', '境界', '規格の例'], SIDES = ['送る', '受ける'];
const POSITIVE = ['正常', '規格の例'], NEGATIVE = ['異常', '境界'];
const HANDLING = ['テスト', '対象外', '利用者'];

const cellsOf = line => line.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());

// 対応の表(番号・節・要点・扱い・送る側・受ける側・理由)と、異常系を求めない行の表(番号・理由)を読む
function readRows() {
  const rows = [], exempt = new Map();
  let mode = null;
  for (const line of fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('|')) { mode = null; continue; }
    const c = cellsOf(line);
    if (c[0] === '番号' && c[3] === '扱い') { mode = 'rows'; continue; }
    if (c[0] === '番号' && c[1] === '異常系を求めない理由') { mode = 'exempt'; continue; }
    if (!mode || /^-+$/.test(c[0])) continue;
    if (mode === 'exempt') exempt.set(c[0], c[1]);
    else rows.push({ id: c[0], section: c[1], summary: c[2], handling: c[3], send: c[4], receive: c[5], why: c[6] });
  }
  rows.forEach(r => { r.exempt = exempt.get(r.id); });
  rows.exempt = exempt;
  return rows;
}
// vca-guide の義務の一覧(番号と節)
function readGuide() {
  if (!fs.existsSync(GUIDE)) return null;
  const m = new Map();
  for (const line of fs.readFileSync(GUIDE, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const c = cellsOf(line);
    if (/^[RSO]\d{3}$/.test(c[0] || '')) m.set(c[0], c[1]);
  }
  return m;
}

async function runTests() {
  const spec = require('../tests/spec.js');
  const list = spec.collect();
  require('../tests/conformance.test.js');
  const out = [];
  for (const t of list) {
    const r = { name: t.name, req: t.meta.req || [], kind: t.meta.kind || [], side: t.meta.side, ok: true };
    try { await t.fn(); } catch (e) { r.ok = false; r.msg = e.message.split('\n')[0]; }
    out.push(r);
  }
  return out;
}

const slug = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

function render(rows, tests) {
  const L = [];
  const count = (list, k) => list.filter(t => t.kind.includes(k)).length;
  L.push('# 規格との対応とテスト');
  L.push('');
  L.push('[conformance.md](conformance.md) の各行を、どのテストが確かめているかの一覧です。`tools/trace.js` がテストを実行して作るもので、手で直さないでください(`npm run trace` で作り直す)。');
  L.push('');
  L.push(`テストは全部で ${tests.length} 件です(送る側 ${tests.filter(t => t.side === '送る').length}・受ける側 ${tests.filter(t => t.side === '受ける').length}。正常 ${count(tests, '正常')}・異常 ${count(tests, '異常')}・境界 ${count(tests, '境界')}・規格の例 ${count(tests, '規格の例')})。`);
  L.push('');
  L.push('| 番号 | 節 | 扱い | 送る側 | 受ける側 | 正常 | 異常 | 境界 | 規格の例 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const list = tests.filter(t => t.req.includes(r.id));
    const n = side => { const k = list.filter(t => t.side === side).length; return k ? `[${k}](#${slug(r.id)})` : ''; };
    L.push(`| ${r.id} | ${r.section} | ${r.handling}${r.exempt ? '(例外)' : ''} | ${n('送る')} | ${n('受ける')} | ${KINDS.map(k => count(list, k) || '').join(' | ')} |`);
  }
  L.push('');
  L.push('「(例外)」は異常系を求めない行で、理由は [conformance.md](conformance.md#異常系を求めない行) にあります。');
  for (const r of rows) {
    const list = tests.filter(t => t.req.includes(r.id));
    if (!list.length) continue;
    L.push('');
    L.push(`## ${r.id}`);
    L.push('');
    L.push(`${r.section}: ${r.summary}`);
    L.push('');
    list.forEach(t => L.push(`- ${t.name}(${t.side}側、${t.kind.join('・')})`));
  }
  return L.join('\n') + '\n';
}

(async () => {
  const check = process.argv.includes('--check');
  const rows = readRows(), ids = new Map(rows.map(r => [r.id, r]));
  const tests = await runTests();
  const problems = [];
  if (!rows.length) problems.push('docs/conformance.md に対応の表がありません');
  rows.map(r => r.id).filter((k, i, a) => a.indexOf(k) !== i).forEach(k => problems.push(`番号が重なっています: ${k}`));
  for (const r of rows) {
    if (!HANDLING.includes(r.handling)) problems.push(`${r.id}: 知らない扱い「${r.handling}」`);
    if (r.handling !== 'テスト') { if (!r.why) problems.push(`${r.id}: 「${r.handling}」の理由がありません`); continue; }
    if (r.send === '-' && r.receive === '-') problems.push(`${r.id}: 送る側も受ける側も - です`);
    for (const [side, cell] of [['送る', r.send], ['受ける', r.receive]]) {
      if (cell !== '-' && !tests.some(t => t.side === side && t.req.includes(r.id))) problems.push(`${r.id}: ${side}側のテストがありません(${r.summary})`);
    }
    const list = tests.filter(t => t.req.includes(r.id));
    const has = kinds => list.some(t => t.kind.some(k => kinds.includes(k)));
    if (list.length && !has(POSITIVE)) problems.push(`${r.id}: 正常系(正常・規格の例)のテストがありません`);
    if (list.length && !r.exempt && !has(NEGATIVE)) problems.push(`${r.id}: 異常系(異常・境界)のテストがありません。足すか、「異常系を求めない行」に理由を書く`);
    if (r.exempt && has(NEGATIVE)) problems.push(`${r.id}: 異常系のテストがあるので、「異常系を求めない行」から外す`);
  }
  rows.exempt.forEach((why, id) => {
    const r = ids.get(id);
    if (!r || r.handling !== 'テスト') problems.push(`「異常系を求めない行」の ${id} が、対応の表の「テスト」の行にありません`);
    if (!why) problems.push(`「異常系を求めない行」の ${id} に理由がありません`);
  });
  for (const t of tests) {
    if (!t.ok) problems.push(`テストが失敗しています: ${t.name}(${t.msg})`);
    if (!t.req.length) problems.push(`番号が書かれていないテスト: ${t.name}`);
    if (!t.kind.length) problems.push(`確かめ方が書かれていないテスト: ${t.name}`);
    t.kind.filter(k => !KINDS.includes(k)).forEach(k => problems.push(`知らない確かめ方「${k}」: ${t.name}`));
    if (!SIDES.includes(t.side)) problems.push(`side が 送る・受ける ではないテスト: ${t.name}`);
    for (const id of t.req) {
      const r = ids.get(id);
      if (!r) problems.push(`対応の表に無い番号「${id}」: ${t.name}`);
      else if (r.handling !== 'テスト') problems.push(`扱いが「${r.handling}」の ${id} を指すテスト: ${t.name}`);
      else if ((t.side === '送る' ? r.send : r.receive) === '-') problems.push(`${id} の${t.side}側は - なのに、${t.side}側のテストがあります: ${t.name}`);
    }
  }
  const guide = readGuide();
  if (guide) {
    for (const r of rows.filter(r => /^[RSO]\d{3}$/.test(r.id))) {
      if (!guide.has(r.id)) problems.push(`vca-guide の義務の一覧に無い番号: ${r.id}`);
      else if (guide.get(r.id) !== r.section) problems.push(`${r.id} の節が vca-guide と違います(${r.section} / ${guide.get(r.id)})`);
    }
  } else console.log('- ../vca-guide が無いので、番号と節の照合は飛ばします');
  const doc = render(rows, tests);
  if (check) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== doc) problems.push('docs/conformance-tests.md が古くなっています。npm run trace で作り直してください');
  } else fs.writeFileSync(OUT, doc);
  problems.forEach(p => console.log('✗ ' + p));
  console.log(`対応の表 ${rows.length} 行・テスト ${tests.length} 件・問題 ${problems.length} 件`);
  process.exitCode = problems.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
