// 読み込み(fromVCA)と書き出し(toVCA)が DCS v3.14 の決まりを守るかのテスト。番号は docs/conformance.md の表の番号
// 期待値は規格書の文と例から決めている(各テストに節を書く)
'use strict';
const assert = require('node:assert/strict');
const spec = require('./spec.js');
const C = require('../converter.js');

const CRLF = '\r\n';
const file = (...ls) => ls.join(CRLF) + CRLF;
// 半径 r(1/100 mm)の円を n 点で。ASCII(形式 1)の R の行に分ける
const circle = (r, n = 8) => Array(n).fill(r);
const rLines = vals => { const out = []; for (let i = 0; i < vals.length; i += 10) out.push('R=' + vals.slice(i, i + 10).join(';')); return out; };
const trace = (eye, vals, fmt = `1;${vals.length};E;${eye};F`) => ['TRCFMT=' + fmt, ...rLines(vals)];
const both = file('REQ=FIL', 'JOB=A1', 'DBL=18.00', ...trace('R', circle(2500, 40)), ...trace('L', circle(2500, 40)));
const rightOnly = file('REQ=FIL', 'JOB=A1', ...trace('R', circle(2500, 40)));
const leftOnly = file('REQ=FIL', 'JOB=A1', ...trace('L', circle(2500, 40)));

const out = (text, opts) => C.toVCA(C.fromVCA(text), Object.assign({ n: 360, job: 'A1' }, opts));
function lines(text) {
  assert.ok(text.endsWith(CRLF), '最後の行も CR LF で終わる');
  return text.slice(0, -2).split(CRLF);
}
const label = l => l.slice(0, l.indexOf('='));
const fields = l => l.slice(l.indexOf('=') + 1).split(';');
const first = (text, lab) => lines(text).find(l => label(l) === lab);
function traces(text) {
  const ls = lines(text), res = [];
  ls.forEach((l, i) => {
    if (label(l) !== 'TRCFMT') return;
    const rs = [];
    for (let k = i + 1; k < ls.length && label(ls[k]) === 'R'; k++) rs.push(ls[k]);
    res.push({ fmt: fields(l), rLines: rs, values: rs.flatMap(fields), next: ls[i + 1 + rs.length] });
  });
  return res;
}
const points = vals => vals.map((v, i) => {
  const a = (2 * Math.PI * i) / vals.length, r = +v / 100;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
});

// ==== 送る側(toVCA) ==============================================================
// ---- ファイル(7.5) ----
spec('ファイルの 1 行目は REQ=FIL、2 行目は JOB で、元のパケットの CRC・STATUS・ANS は書かない(7.5.1・7.5.4・7.5.5)',
  { req: ['R182', 'R183'], kind: ['正常', '境界'], side: '送る' }, () => {
    const pkt = file('ANS=TRC', 'JOB=A1', 'STATUS=0', ...trace('R', circle(2500, 40)), 'CRC=12345');
    for (const keepRecords of [false, true]) {
      const ls = lines(out(pkt, { keepRecords }).text);
      assert.equal(ls[0], 'REQ=FIL');
      assert.equal(ls[1], 'JOB=A1');
      assert.deepEqual(ls.filter(l => ['CRC', 'STATUS', 'ANS'].includes(label(l))), []);
    }
  });

spec('JOB が空・空白だけ・? なら、2 行目は JOB=?(表 A.2 の JOB、7.5.4)',
  { req: ['R225', 'R183'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const job of ['', '  ', '?', undefined]) assert.equal(lines(C.toVCA(C.fromVCA(rightOnly), { n: 40, job }).text)[1], 'JOB=?', JSON.stringify(job));
  });

spec('ファイルの玉型は形式 1(5 つの欄)。元が形式 2 でも形式 1 で書く(7.5.6・表 A.2 の TRCFMT)',
  { req: ['7.5.6', 'R234'], kind: ['正常', '境界'], side: '送る' }, () => {
    assert.deepEqual(traces(out(both).text).map(t => t.fmt), [['1', '360', 'E', 'R', 'F'], ['1', '360', 'E', 'L', 'F']]);
    const bin = file('REQ=FIL', 'JOB=A1', 'TRCFMT=2;4;E;R;P', 'R=' + [2500, 2500, 2500, 2500].map(v => String.fromCharCode(v & 255, v >> 8)).join(''));
    assert.deepEqual(traces(out(bin).text).map(t => t.fmt), [['1', '360', 'E', 'R', 'P']], '対象(P)は引き継ぐ');
  });

// ---- JOB(limited 型。5.1.8) ----
spec('JOB は 12 文字までは書き、13 文字は誤りにして書き出さない(5.1.8.3)',
  { req: ['5.1.8.3'], kind: ['正常', '境界', '異常'], side: '送る' }, () => {
    assert.equal(lines(out(both, { job: 'ABCDEFGHIJKL' }).text)[1], 'JOB=ABCDEFGHIJKL');
    assert.throws(() => out(both, { job: 'ABCDEFGHIJKLM' }), /12 文字/);
    const long = C.fromVCA(file('REQ=FIL', 'JOB=ABCDEFGHIJKLM', ...trace('R', circle(2500, 40))));
    assert.throws(() => C.toVCA(long, { n: 40, job: long.job }), /12 文字/, 'ファイルの JOB を使うときも同じ');
  });

spec('JOB は 32-127 の文字で書き、; と範囲の外の文字は誤りにする(5.1.8.1)',
  { req: ['5.1.8.1'], kind: ['正常', '境界', '異常'], side: '送る' }, () => {
    assert.equal(lines(out(both, { job: ' !~\x7f' }).text)[1], 'JOB=!~\x7f', '33・126・127 は書ける');
    for (const job of ['A;B', 'Ａ1', 'A\x80B']) assert.throws(() => out(both, { job }), Error, JSON.stringify(job));
  });

spec('JOB の制御文字(32 未満の文字。3.2.12)は誤りにする(5.1.7.1)',
  { req: ['O004'], kind: ['正常', '異常'], side: '送る' }, () => {
    assert.equal(lines(out(both, { job: 'A B' }).text)[1], 'JOB=A B');
    for (const job of ['A\tB', 'A\r\nB', 'A\x1bB', 'A\x1cB']) assert.throws(() => out(both, { job }), Error, JSON.stringify(job));
  });

spec('JOB に予約文字 = , * ? | は書かない。? だけなら不明値(5.1.7.2・表 1)',
  { req: ['R007'], kind: ['正常', '異常'], side: '送る' }, () => {
    for (const c of ['=', ',', '*', '?', '|']) assert.throws(() => out(both, { job: `A${c}B` }), new RegExp(`「\\${c}」`), c);
    assert.equal(lines(out(both, { job: 'A-1_B.2' }).text)[1], 'JOB=A-1_B.2');
  });

// ---- 引き継ぐレコード(keepRecords) ----
spec('引き継ぐレコードは値の数と ? ・空の欄を変えずに書く(5.1.4・5.5.1.3・A.1.1.3)',
  { req: ['R005', 'R046', 'R206'], kind: ['正常', '境界'], side: '送る' }, () => {
    const src = file('REQ=FIL', 'JOB=A1', 'IPD=?;31.00', 'OCHT=21.00;', 'SEGHT=;19.50', 'DRILLE=R;C;1.00;2.00;;3.00;2.00', ...trace('R', circle(2500, 40)));
    const ls = lines(out(src, { keepRecords: true }).text);
    for (const l of ['IPD=?;31.00', 'OCHT=21.00;', 'SEGHT=;19.50', 'DRILLE=R;C;1.00;2.00;;3.00;2.00']) assert.ok(ls.includes(l), l);
  });

spec('値に ; を含むレコード(引用符の中の ;)は、区切りと見分けられないので書かず、知らせる(5.1.8.1・5.1.7.2)',
  { req: ['5.1.8.1', 'R007'], kind: ['異常'], side: '送る' }, () => {
    const src = file('REQ=FIL', 'JOB=A1', 'LNAM="A;B";"C"', 'REM="STATUS=9; NOTE"', 'LMATID=70;70', ...trace('R', circle(2500, 40)));
    const v = out(src, { keepRecords: true }), ls = lines(v.text);
    assert.deepEqual(ls.filter(l => ['LNAM', 'REM'].includes(label(l))), []);
    assert.ok(ls.includes('LMATID=70;70'), '; を含まないレコードは引き継ぐ');
    assert.ok(v.warnings.some(w => w.includes('LNAM・REM') && w.includes('5.1.8.1')), v.warnings.join(' / '));
  });

// ---- 左右のレコード ----
spec('HBOX・VBOX・CIRC は左右の 2 つの値。片眼だけなら他方を空にして ; を残す(5.1・A.1.1.3)',
  { req: ['R003', 'R206'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const lab of ['HBOX', 'VBOX', 'CIRC']) {
      assert.match(first(out(both).text, lab), /^[A-Z]+=\d+\.\d\d;\d+\.\d\d$/, lab);
      assert.match(first(out(rightOnly).text, lab), /^[A-Z]+=\d+\.\d\d;$/, `${lab} 右眼だけ`);
      assert.match(first(out(leftOnly).text, lab), /^[A-Z]+=;\d+\.\d\d$/, `${lab} 左眼だけ`);
    }
  });

// ---- 玉型(5.4) ----
spec('TRCFMT の眼は R・L。元の眼が B でも R として書き、眼ごとに TRCFMT を 1 つ(5.4.12.3)',
  { req: ['R037', 'R038'], kind: ['正常', '異常'], side: '送る' }, () => {
    assert.deepEqual(traces(out(both).text).map(t => t.fmt[3]), ['R', 'L']);
    const b = file('REQ=FIL', 'JOB=A1', ...trace('B', circle(2500, 40)));
    assert.deepEqual(traces(out(b).text).map(t => t.fmt[3]), ['R']);
  });

spec('R は TRCFMT の直後で、値の数は点数と同じ。点数と半径は整数(5.4.5・A.1.1.5.2)',
  { req: ['R024', 'R207'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const n of [3, 360, 1440]) {
      for (const t of traces(out(both, { n }).text)) {
        assert.ok(t.rLines.length > 0);
        assert.equal(t.values.length, n);
        assert.match(t.fmt[1], /^\d+$/);
        t.values.forEach(v => assert.match(v, /^\d+$/));
      }
    }
  });

spec('R の行は 80 文字以内。半径が 100 mm を超えて値が 5 けたになっても(5.4.15.1)',
  { req: ['R042'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const r of [2500, 12000]) {
      const t = out(file('REQ=FIL', 'JOB=A1', ...trace('R', circle(r, 40)))).text;
      assert.equal(traces(t)[0].values[0].length, r > 9999 ? 5 : 4);
      for (const l of lines(t)) assert.ok(l.length <= 80, `${l.length} 文字`);
      // 1 行の個数は規格に無い。値が 4 けたなら、これまでの出力と同じ 15 個ずつ
      if (r < 10000) assert.ok(traces(t)[0].rLines.every(l => fields(l).length === 15), '15 個ずつ');
    }
  });

spec('R の並びの直後に ZFMT=0 を置き、元に Z があっても書かない(5.4.1・5.4.7)',
  { req: ['S013', 'R027'], kind: ['正常', '境界'], side: '送る' }, () => {
    assert.deepEqual(traces(out(both).text).map(t => t.next), ['ZFMT=0', 'ZFMT=0']);
    const sag = file('REQ=FIL', 'JOB=A1', ...trace('R', circle(2500, 4)), 'ZFMT=1;4;E;R;F', 'Z=100;120;100;120');
    const v = out(sag, { keepRecords: true });
    assert.deepEqual(lines(v.text).filter(l => ['Z', 'ZA'].includes(label(l)) || l.startsWith('ZFMT=1')), []);
    assert.equal(traces(v.text)[0].next, 'ZFMT=0');
  });

spec('最初の半径は 0°(3 時)で、続きは反時計回り(5.4.10)',
  { req: ['R036'], kind: ['正常'], side: '送る' }, () => {
    // 半径 25 mm の円の右上(30-60°)だけを 20 mm にへこませた形(箱は変わらない)。反時計回りなら 45° の位置が 20 mm、315° が 25 mm
    const vals = Array.from({ length: 360 }, (_, i) => (i >= 30 && i <= 60 ? 2000 : 2500));
    const t = traces(out(file('REQ=FIL', 'JOB=A1', ...trace('R', vals)), { n: 360 }).text)[0].values.map(Number);
    assert.ok(Math.abs(t[45] - 2000) <= 1 && Math.abs(t[315] - 2500) <= 1, `45°: ${t[45]} / 315°: ${t[315]}`);
  });

spec('半径の原点は箱の中心。元の VCA の原点がずれていても、箱の中心に合わせ直して書く(5.4.8)',
  { req: ['R028'], kind: ['正常', '異常'], side: '送る' }, () => {
    // 半径 25 mm の円を、原点から x に 3 mm ずらした形(等角度 360 点)
    const shifted = Array.from({ length: 360 }, (_, i) => {
      const a = (i * Math.PI) / 180, c = Math.cos(a);
      return Math.round((3 * c + Math.sqrt(625 - 9 * (1 - c * c))) * 100);
    });
    for (const src of [both, file('REQ=FIL', 'JOB=A1', ...trace('R', shifted))]) {
      const p = points(traces(out(src).text)[0].values), xs = p.map(q => q.x), ys = p.map(q => q.y);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      assert.ok(Math.abs(cx) <= 0.01 && Math.abs(cy) <= 0.01, `(${cx}, ${cy})`);
    }
  });

spec('HBOX・VBOX・CIRC は、R の値から求めた幅・高さ・周長と一致する(5.4.9.3)',
  { req: ['R032'], kind: ['正常', '境界'], side: '送る' }, () => {
    for (const n of [40, 360, 1440]) {
      const t = out(both, { n }).text, tr = traces(t);
      ['R', 'L'].forEach((eye, k) => {
        const p = points(tr[k].values), xs = p.map(q => q.x), ys = p.map(q => q.y);
        const circ = p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length].x - q.x, p[(i + 1) % p.length].y - q.y), 0);
        const near = (lab, v) => assert.ok(Math.abs(+fields(first(t, lab))[k] - v) <= 0.005, `${eye} ${lab} ${n}: ${fields(first(t, lab))[k]} / ${v}`);
        near('HBOX', Math.max(...xs) - Math.min(...xs));
        near('VBOX', Math.max(...ys) - Math.min(...ys));
        near('CIRC', circ);
      });
    }
  });

// ---- 穴あけ(5.5) ----
spec('図面から作った穴は DRILLE(眼 R・L、基準 C、x;y;径)で書き、すべて同じ基準(5.5.1.5・5.5.2.1-5.5.2.6)',
  { req: ['R052', 'R054', 'R055', 'R056', 'R050', 'O014'], kind: ['正常'], side: '送る' }, () => {
    const set = C.fromVCA(both);
    set.holes = { R: [{ eye: 'R', origin: 'C', x: 20, y: 3, diameter: 1.4 }], L: [{ eye: 'L', origin: 'C', x: -20, y: 3, diameter: 1.4 }] };
    const dr = lines(C.toVCA(set, { n: 40, job: 'A1' }).text).filter(l => label(l) === 'DRILLE');
    assert.deepEqual(dr.map(l => fields(l).slice(0, 2).join(';')), ['R;C', 'L;C']);
    dr.forEach(l => { const f = fields(l); assert.ok(Number.isFinite(+f[2]) && f[2] !== '' && Number.isFinite(+f[3]) && f[3] !== '', l); });
  });

spec('元の DRILLE に誤り(基準が ?・省略、眼が空、始点が無い、基準が混ざる)があれば、引き継がず知らせる(5.5.1.5・5.5.2.1・5.5.2.2・5.5.2.4)',
  { req: ['R055', 'R054', 'R052', 'O014', 'R050', 'R056'], kind: ['異常'], side: '送る' }, () => {
    for (const bad of ['DRILLE=R;?;1.00;2.00;1.40', 'DRILLE=R', 'DRILLE=;C;1.00;2.00', 'DRILLE=R;C;;2.00', 'DRILLE=R;X;1.00;2.00', 'DRILLE=R;C;1.00;2.00\r\nDRILLE=L;ENF;1.00;2.00']) {
      const v = out(file('REQ=FIL', 'JOB=A1', bad, ...trace('R', circle(2500, 40))), { keepRecords: true });
      assert.deepEqual(lines(v.text).filter(l => label(l) === 'DRILLE'), [], bad);
      assert.ok(v.warnings.some(w => w.includes('DRILLE')), bad);
    }
  });

// ==== 受ける側(fromVCA) ===========================================================
spec('左眼だけ・右眼だけの玉型も誤りにせず読む(5.4.13)',
  { req: ['R039'], kind: ['正常', '境界'], side: '受ける' }, () => {
    for (const [text, eye] of [[rightOnly, 'R'], [leftOnly, 'L']]) {
      const s = C.fromVCA(text);
      assert.deepEqual(s.errors, []);
      assert.deepEqual(Object.keys(s.eyes), [eye]);
      assert.deepEqual(Object.keys(C.fillMirror(s).eyes).sort(), ['L', 'R'], '反対の眼を左右反転して作れる');
    }
  });

spec('データの玉型の眼が B なら、右眼として読み、知らせる(5.4.12.3)',
  { req: ['R037'], kind: ['異常'], side: '受ける' }, () => {
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', ...trace('B', circle(2500, 40))));
    assert.deepEqual(Object.keys(s.eyes), ['R']);
    assert.ok(s.warnings.some(w => w.includes('「B」')), s.warnings.join(' / '));
  });

spec('DRILLE の基準が ?・省略、眼が空、始点が無い、基準が混ざるなら、穴を描かず知らせる。空欄の基準は C(5.5.1.5・5.5.2.1・5.5.2.2・5.5.2.4)',
  { req: ['R055', 'R054', 'R052', 'O014', 'R050', 'R056'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const ok = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'DRILLE=R;;1.00;2.00;1.40', ...trace('R', circle(2500, 40))));
    assert.deepEqual(ok.holes.R.map(f => [f.origin, f.x, f.y]), [['C', 1, 2]], '空欄の基準は C(5.5.2.2)');
    for (const bad of ['DRILLE=R;?;1.00;2.00;1.40', 'DRILLE=R', 'DRILLE=;C;1.00;2.00', 'DRILLE=R;C;;2.00', 'DRILLE=R;X;1.00;2.00', 'DRILLE=R;C;1.00;2.00\r\nDRILLE=L;ENF;1.00;2.00']) {
      const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', bad, ...trace('R', circle(2500, 40))));
      assert.equal(s.holes, undefined, bad);
      assert.ok(s.warnings.some(w => w.includes('DRILLE') && w.includes('描かず')), bad);
    }
  });

spec('両眼の穴(眼 B)は右眼の座標で、左眼には左右反転して置く(5.5.2.1)',
  { req: ['R053'], kind: ['正常', '境界'], side: '受ける' }, () => {
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'DRILLE=B;C;20.00;3.00;1.40', ...trace('R', circle(2500, 40)), ...trace('L', circle(2500, 40))));
    assert.deepEqual(s.holes.R.map(f => [f.x, f.y]), [[20, 3]]);
    assert.deepEqual(s.holes.L.map(f => [f.x, f.y]), [[-20, 3]]);
  });

spec('知らないラベル・_ で始まるラベルがあっても読み、引き継ぐときはそのまま書く(5.1.5・5.1.6)',
  { req: ['R006'], kind: ['正常', '境界'], side: '受ける' }, () => {
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'ZZTOP=1', '_MYTEST=abc', ...trace('R', circle(2500, 40))));
    assert.deepEqual(s.errors, []);
    assert.deepEqual(Object.keys(s.eyes), ['R']);
    const ls = lines(C.toVCA(s, { n: 40, job: 'A1', keepRecords: true }).text);
    assert.ok(ls.includes('ZZTOP=1') && ls.includes('_MYTEST=abc'));
  });

spec('引用符の付いた JOB は引用符を外して読み、引用符の有無で壊れない(6.2.2.1・6.2.2.2)',
  { req: ['S036', 'S037'], kind: ['正常', '境界'], side: '受ける' }, () => {
    for (const j of ['JOB="A1"', 'JOB=A1']) assert.equal(C.fromVCA(file('REQ=FIL', j, ...trace('R', circle(2500, 40)))).job, 'A1', j);
  });

spec('半径の原点が箱の中心からずれた玉型は、読んで知らせる(5.4.8)',
  { req: ['R028'], kind: ['異常'], side: '受ける' }, () => {
    const vals = Array.from({ length: 360 }, (_, i) => { const c = Math.cos((i * Math.PI) / 180); return Math.round((3 * c + Math.sqrt(625 - 9 * (1 - c * c))) * 100); });
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', ...trace('R', vals)));
    assert.ok(s.warnings.some(w => w.includes('箱の中心から 3.00 mm')), s.warnings.join(' / '));
    assert.ok(!C.fromVCA(both).warnings.some(w => w.includes('箱の中心から')), '中心が合っていれば知らせない');
  });

spec('不等角度(U)の玉型は、A の角度どおりに読む(5.4.3)',
  { req: ['R221'], kind: ['正常'], side: '受ける' }, () => {
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'TRCFMT=1;4;U;R;F', 'R=2500;2000;2500;2000', 'A=0;9000;18000;27000'));
    const p = s.eyes.R.pts;
    assert.deepEqual(p.map(q => [Math.round(q.x * 100) / 100 || 0, Math.round(q.y * 100) / 100 || 0]), [[25, 0], [0, 20], [-25, 0], [0, -20]]);
  });

spec('形式 2(2 バイトの半径、下位バイトが先、予約文字は ESC と最上位ビット)の規格の例を読む(5.4.15.2・5.4.16.1・5.1.7.3)',
  { req: ['R011', 'R044'], kind: ['規格の例'], side: '受ける' }, () => {
    // 5.4.15.2 の例のエスケープ後のバイト列(10 は 27 138、19 は 27 147)
    const after = [175, 9, 23, 27, 138, 45, 27, 138, 223, 9, 90, 9, 205, 8, 89, 8, 252, 7, 183, 7, 143, 7, 130, 7, 147, 7, 197, 7, 24, 8,
      136, 8, 18, 9, 167, 9, 39, 27, 138, 85, 27, 138, 27, 147, 27, 138, 213, 9, 146, 9, 75, 9, 14, 9, 199, 8, 120, 8, 38, 8, 222, 7,
      166, 7, 131, 7, 117, 7, 122, 7, 149, 7, 191, 7, 241, 7, 41, 8, 92, 8, 152, 8, 229, 8, 67, 9];
    const s = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'TRCFMT=2;40;E;R;F', 'R=' + String.fromCharCode(...after)));
    assert.deepEqual(s.errors, []);
    const r = s.eyes.R.pts.map(q => Math.round(Math.hypot(q.x, q.y) * 100));
    assert.equal(r.length, 40);
    // 5.4.1・5.4.2 の形式 1 の例(同じ玉形の 1 行目と 2 行目)
    assert.deepEqual(r.slice(0, 20), [2479, 2583, 2605, 2527, 2394, 2253, 2137, 2044, 1975, 1935, 1922, 1939, 1989, 2072, 2184, 2322, 2471, 2599, 2645, 2579]);
  });

spec('パケット(FS・RS・GS)や * 印の REQ で始まるテキストも VCA と判定する(6.1・6.2.1)',
  { req: ['6.1.1'], kind: ['正常', '境界'], side: '受ける' }, () => {
    assert.equal(C.detect('\x1cREQ=TRC\r\nJOB=1\r\n\x1e\x1d', 'a.dcs'), 'vca');
    assert.equal(C.detect('*REQ=FIL\r\nJOB=1\r\n', 'a.txt'), 'vca');
    assert.equal(C.detect('hello', 'a.txt'), 'unknown');
  });

spec('片眼の玉形で CIRC の左右が違えば、反対の眼の大きさを変えないことを知らせる(5.4.9.4)',
  { req: ['R033'], kind: ['正常', '異常'], side: '受ける' }, () => {
    const differ = C.fromVCA(file('REQ=FIL', 'JOB=A1', 'CIRC=157.08;160.00', ...trace('R', circle(2500, 40))));
    assert.ok(differ.warnings.some(w => w.includes('CIRC の左右が違います')), differ.warnings.join(' / '));
    for (const same of ['CIRC=157.08;157.08', 'CIRC=157.08;']) {
      assert.ok(!C.fromVCA(file('REQ=FIL', 'JOB=A1', same, ...trace('R', circle(2500, 40)))).warnings.some(w => w.includes('CIRC')), same);
    }
    assert.ok(!C.fromVCA(file('REQ=FIL', 'JOB=A1', 'CIRC=157.08;160.00', ...trace('R', circle(2500, 40)), ...trace('L', circle(2500, 40)))).warnings.some(w => w.includes('CIRC')), '両眼なら知らせない');
  });
