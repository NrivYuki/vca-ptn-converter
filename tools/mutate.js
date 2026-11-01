// ミューテーションテスト: 実装の一部をわざと壊し、テストが失敗するかを確かめる(npm run mutate)
//
// テストが「確かめているはずの処理」を本当に確かめているかを調べる。壊してもテストが通るもの(生き残り)は、
// その処理を通る場面をテストが作っていない。生き残りがあれば終了コード 1 で終わる。
//   node tools/mutate.js            すべて試す
//   node tools/mutate.js JOB         名前に「JOB」を含むものだけ試す
// 壊したファイルは各回のあとに元に戻す(途中で Ctrl+C で止めても戻す)。
// 一覧に無い壊し方まで検出できることの保証ではない。規格の決まりを守る処理を足したら、ここにも壊し方を足すこと。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.join(__dirname, '..');
const TESTS = ['tests/conformance.test.js'];
const V = 'converter.js';

// [名前, ファイル, 元の文字列, 壊した文字列]。元の文字列はファイルの中にちょうど 1 か所あること(改行は LF で書く)
const M = [
  ['REQ を FIL 以外にする', V, "lines = ['REQ=FIL', 'JOB=' + jobValue(opts.job)];", "lines = ['REQ=TRC', 'JOB=' + jobValue(opts.job)];"],
  ['JOB を 2 行目に書かない', V, "lines = ['REQ=FIL', 'JOB=' + jobValue(opts.job)];", "lines = ['REQ=FIL'];"],
  ['STATUS を引き継ぐ', V, "'CIRC', 'CRC', 'STATUS']);", "'CIRC', 'CRC']);"],
  ['JOB が空でも ? にしない', V, "if (s === '' || s === '?') return '?';", "if (s === '?') return '?';"],
  ['JOB の上限 12 → 13', V, 'if (s.length > 12)', 'if (s.length > 13)'],
  ['JOB の文字の範囲を見ない', V, 'if (/[^\\x20-\\x7f]/.test(s))', 'if (false)'],
  ['JOB の 127 を誤りにする', V, 'if (/[^\\x20-\\x7f]/.test(s))', 'if (/[^\\x20-\\x7e]/.test(s))'],
  ['JOB の予約文字を見ない', V, 'const bad = s.match(/[;=,*?|]/);', 'const bad = null;'],
  ['値に ; を含むレコードを引き継ぐ', V, "const semi = kept.filter(r => r.fields.some(f => String(f).includes(';')));", 'const semi = [];'],
  ['誤りのある DRILLE を引き継ぐ', V, "if (set.drillErrors && kept.some(r => r.label === 'DRILLE')) {", 'if (false) {'],
  ['誤りのある DRILLE の穴を描く', V, 'if (dr.errors && dr.errors.length) {', 'if (false) {'],
  ['片眼の HBOX の ; を省く', V, "return v[1] === '' ? v[0] + ';' : v[0] === '' ? ';' + v[1] : v.join(';');", "return v.filter(x => x !== '').join(';');"],
  ['TRCFMT の 5 番目の欄を書かない', V, 'lines.push(`TRCFMT=1;${n};E;${eye};${object}`);', 'lines.push(`TRCFMT=1;${n};E;${eye}`);'],
  ['眼 B の玉形を知らせない', V, "if (t.eye !== 'R' && t.eye !== 'L') set.warnings.push", 'if (false) set.warnings.push'],
  ['R の行の 80 文字を見ない', V, 'if (cur && next.length > 80)', 'if (cur && next.length > 800)'],
  ['R の行を 16 個ずつにする', V, 'function splitLines(label, vals, per = 15)', 'function splitLines(label, vals, per = 16)'],
  ['ZFMT=0 を書かない', V, "      lines.push('ZFMT=0');", ''],
  ['半径を時計回りに並べる', V, 'const a = (2 * Math.PI * i) / n, dx = Math.cos(a), dy = Math.sin(a);', 'const a = (-2 * Math.PI * i) / n, dx = Math.cos(a), dy = Math.sin(a);'],
  ['原点を箱の中心に合わせ直さない', V, 'const r = resample(centered(set.eyes[eye].pts), n);', 'const r = resample(set.eyes[eye].pts, n);'],
  ['原点のずれを知らせない', V, 'if (off > 0.05) set.warnings.push', 'if (false) set.warnings.push'],
  ['HBOX を丸める前の半径で計算する', V, 'r.radii = r.radii.map(v => Math.max(0, Math.round(v * 100)) / 100);', ''],
  ['CIRC の左右の差を知らせない', V, 'circ.every(Number.isFinite) && Math.abs(circ[0] - circ[1]) >= 0.005', 'false'],
  ['眼 B の穴を左眼で反転しない', V, "if (f.eye === 'B') set.holes.L.push(VCA.mirrorFeature(f));", "if (f.eye === 'B') set.holes.L.push(f);"],
];

function apply(file, from, to) {
  const p = path.join(repo, file), orig = fs.readFileSync(p, 'utf8');
  const crlf = orig.includes('\r\n'), text = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${file} に「${from.slice(0, 40)}」が ${n} か所あります(1 か所のはず)`);
  const out = text.replace(from, () => to);
  fs.writeFileSync(p, crlf ? out.replace(/\n/g, '\r\n') : out);
  return () => fs.writeFileSync(p, orig);
}

const filter = process.argv[2];
const list = M.filter(m => !filter || m[0].includes(filter));
let restore = null;
process.on('SIGINT', () => { if (restore) restore(); process.exit(130); });
const survived = [];
for (const [name, file, from, to] of list) {
  restore = apply(file, from, to);
  const r = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: repo, encoding: 'utf8' });
  restore(); restore = null;
  const caught = r.status !== 0;
  console.log(`${caught ? '✓ 検出' : '✗ 生き残り'}  ${name}`);
  if (!caught) survived.push(name);
}
console.log(`${list.length} 通り中 ${list.length - survived.length} 通りを検出`);
process.exitCode = survived.length ? 1 : 0;
