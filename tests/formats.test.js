// 読み込める形式 × 書き出せる形式の組み合わせを、すべて通して確かめる(Node.js で動く VCA・PTN・JOB・DXF)。
// SVG の読み込みはブラウザの DOM が要るので、tests/ui/ で確かめる。
//   元のデータ → (反対の眼を作る・作らない) → 1 回目の書き出し → 読み込み → 2 回目の書き出し → 読み込み
// のどの段でも、眼・形・寸法・穴・JOB・DBL が変わらないことを確かめる。PTN・JOB は中身が VCA のテキストなので、VCA と同じ流れで確かめる
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../converter.js');

const CRLF = '\r\n';
const sample = f => fs.readFileSync(path.join(__dirname, '../samples', f), 'latin1');
const ring = (r, n) => Array(n).fill(r);
const rLines = vals => { const out = []; for (let i = 0; i < vals.length; i += 10) out.push('R=' + vals.slice(i, i + 10).join(';')); return out; };
// 右上(30-60°)だけへこんだ形(左右と上下の向きが分かる)
const dent = Array.from({ length: 360 }, (_, i) => (i >= 30 && i <= 60 ? 2000 : 2500));
const mirrorVals = v => v.map((_, i) => v[(540 - i) % 360]);

// 元のデータ。読み込める形式ごとに、片眼・両眼、穴の有無、等角度・不等角度、形式 1・2 を混ぜる
const SOURCES = {
  'VCA 両眼 1440 点(サンプル)': sample('_SAMPLE0001.vca'),
  'VCA 右眼だけ(サンプル)': sample('frame-right.vca'),
  'VCA 両眼(サンプル)': sample('frame-both.vca'),
  'VCA 不等角度(サンプル)': sample('frame-uneven.vca'),
  'VCA 形式 2(バイナリ)': ['REQ=FIL', 'JOB=BIN1', 'TRCFMT=2;8;E;R;F', 'R=' + ring(2500, 8).map(v => String.fromCharCode(v & 255, v >> 8)).join('')].join(CRLF) + CRLF,
  'VCA 両眼・丸穴と長穴(基準 C)': ['REQ=FIL', 'JOB=HOLE1', 'DBL=18.00', 'DRILLE=R;C;20.00;3.00;1.40', 'DRILLE=R;C;-21.00;2.00;1.20;-18.50;2.00',
    'DRILLE=L;C;-20.00;3.00;1.40', 'DRILLE=L;C;21.00;2.00;1.20;18.50;2.00',
    'TRCFMT=1;360;E;R;F', ...rLines(dent), 'TRCFMT=1;360;E;L;F', ...rLines(mirrorVals(dent))].join(CRLF) + CRLF,
  'VCA 右眼だけ・丸穴(基準 C)': ['REQ=FIL', 'JOB=RIGHT1', 'DRILLE=R;C;20.00;3.00;1.40', 'TRCFMT=1;360;E;R;F', ...rLines(dent)].join(CRLF) + CRLF,
  'VCA 左眼だけ・両眼の穴(眼 B)': ['REQ=FIL', 'JOB=LEFT1', 'DRILLE=B;C;20.00;3.00;1.40', 'TRCFMT=1;360;E;L;F', ...rLines(mirrorVals(dent))].join(CRLF) + CRLF,
};
// 隣に vca-shape-maker があれば、その書き出しも元のデータにする(角の丸い形・角のとがった五角形、穴あり)
const shapePath = path.join(__dirname, '../../vca-shape-maker/shape.js');
if (fs.existsSync(shapePath)) {
  const Shape = require(shapePath);
  const holes = [{ x: 20, y: 3, diameter: 1.4 }, { x: -21, y: 2, diameter: 1.2, xEnd: -18.5, yEnd: 2 }];
  SOURCES['VCA shape-maker 角の丸い形・穴'] = Shape.toVCA(Shape.superellipse({ x0: 100, y0: 100, x1: 400, y1: 320 }, [3, 3, 3, 3]), { widthMM: 50, job: 'SHAPE1', holes }).text;
  SOURCES['VCA shape-maker 五角形・左眼・1440 点'] = Shape.toVCA([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 4 }, { x: 3, y: 0 }, { x: 0, y: 4 }], { widthMM: 50, eye: 'L', n: 1440, job: 'SHAPE2' }).text;
}
// DXF の元のデータは、VCA の元のデータを DXF にしたもの(図面として描かれた玉形)
for (const [k, v] of Object.entries(SOURCES)) if (k.startsWith('VCA')) SOURCES[k.replace(/^VCA/, 'DXF')] = C.toDXF(C.fromVCA(v), { dbl: 18 });

const READ = { VCA: t => C.fromVCA(t), PTN: t => C.fromVCA(t), JOB: t => C.fromVCA(t), DXF: t => C.fromDXF(t) };
const EXT = { VCA: 'oma', PTN: 'ptn', JOB: 'job', DXF: 'dxf' };
// 点数は、等角度の VCA なら元の点の数のまま(点を減らすと、とがった角が削れて形が変わる)。
// 不等角度の VCA と DXF は、点の角度が変わるので、元の点の数と 360 の多いほう
const points = set => { const e = Object.values(set.eyes)[0]; return e.n && e.mode === 'E' ? e.n : Math.max(360, e.pts.length); };
const WRITE = {
  VCA: (set, job) => C.toVCA(set, { n: points(set), job, dbl: set.dbl, keepRecords: true }).text,
  DXF: (set) => C.toDXF(set, { dbl: set.dbl }),
};
WRITE.PTN = WRITE.VCA; WRITE.JOB = WRITE.VCA;   // PTN・JOB は VCA のテキストを名前と拡張子だけ変えたもの
const read = (kind, text) => { assert.equal(C.detect(text, 'x.' + EXT[kind]), kind === 'DXF' ? 'dxf' : 'vca', `${kind} と判定`); return READ[kind](text); };

// 形を箱の中心から 360 方向に測った半径(mm)
const radii = (set, eye) => C.resample(C.centered(set.eyes[eye].pts), 360).radii;
// 許容差: R の値の 1 単位(0.01 mm)と、折れ線で表した形を測り直すときの弦の誤差(360 点・半径 30 mm で 0.0012 mm)を合わせて 0.02 mm
const TOL = 0.02;
function same(a, b, what, opts = {}) {
  assert.deepEqual(Object.keys(b.eyes).sort(), Object.keys(a.eyes).sort(), `${what}: 眼`);
  for (const eye of Object.keys(a.eyes)) {
    const ra = radii(a, eye), rb = radii(b, eye);
    const d = Math.max(...ra.map((v, i) => Math.abs(v - rb[i])));
    assert.ok(d <= TOL, `${what}: ${eye} の形が ${d.toFixed(4)} mm 違う`);
    const ma = C.measure(a.eyes[eye].pts), mb = C.measure(b.eyes[eye].pts);
    for (const k of ['hbox', 'vbox']) assert.ok(Math.abs(ma[k] - mb[k]) <= TOL, `${what}: ${eye} ${k} ${ma[k]} / ${mb[k]}`);
    const ha = (a.holes && a.holes[eye]) || [], hb = (b.holes && b.holes[eye]) || [];
    assert.equal(hb.length, ha.length, `${what}: ${eye} の穴の数`);
    // 長穴の始点と終点は説明のための呼び名で、加工の順を決めない(5.5.2.4 の注記)。両端を順序なしで比べる
    const key = h => [[h.x, h.y], [h.xEnd ?? h.x, h.yEnd ?? h.y]].sort((p, q) => p[0] - q[0] || p[1] - q[1]).flat();
    const sort = hs => hs.map(key).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    sort(ha).forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(v - sort(hb)[i][j]) <= TOL, `${what}: ${eye} の穴 ${i + 1} の位置 ${p} / ${sort(hb)[i]}`)));
    ha.forEach((h, i) => { if (h.diameter > 0) assert.ok(hb.some(g => Math.abs(g.diameter - h.diameter) <= TOL), `${what}: ${eye} の穴 ${i + 1} の径`); });
  }
  if (Number.isFinite(a.dbl) && opts.dbl !== false) assert.ok(Math.abs(a.dbl - b.dbl) <= TOL, `${what}: DBL ${a.dbl} / ${b.dbl}`);
  if (opts.job !== undefined) assert.equal(b.job, opts.job, `${what}: JOB`);
}

for (const [name, text] of Object.entries(SOURCES)) {
  const srcKind = name.slice(0, 3);
  for (const fill of [false, true]) {
    const s0 = read(srcKind, text);
    assert.deepEqual(s0.errors, [], name);
    const set0 = fill ? C.fillMirror(s0) : s0;
    for (const out1 of Object.keys(WRITE)) {
      for (const out2 of Object.keys(WRITE)) {
        test(`${name}${fill ? '・反対の眼を作る' : ''} → ${out1} → ${out2}`, () => {
          const job = srcKind === 'VCA' ? s0.job : 'D1';
          const t1 = WRITE[out1](set0, job), set1 = read(out1, t1);
          assert.deepEqual(set1.errors, [], '1 回目の読み込みの誤り');
          // VCA → VCA は、元の形・穴に加えて JOB と DBL も保つ。DXF は JOB を持たず、DBL は両眼を並べた間隔だけで表す
          const both = !!(set0.eyes.R && set0.eyes.L);
          same(set0, set1, '1 回目', { job: out1 === 'DXF' ? undefined : job, dbl: out1 !== 'DXF' || both });
          const t2 = WRITE[out2](set1, set1.job), set2 = read(out2, t2);
          assert.deepEqual(set2.errors, [], '2 回目の読み込みの誤り');
          same(set0, set2, '2 回目', { dbl: false });
          // 同じ形式で 2 回書くと、中身が同じになる(書き出しは落ち着いている)
          if (out1 === out2 && out1 !== 'DXF') assert.equal(t2, t1, '2 回書いても同じ中身');
        });
      }
    }
  }
}

test('左右反転して作った眼は、元の眼の左右反転(右上のへこみが左上に来る)', () => {
  for (const kind of ['VCA', 'DXF']) {
    const s = C.fillMirror(read(kind, kind === 'VCA' ? SOURCES['VCA 左眼だけ・両眼の穴(眼 B)'] : SOURCES['DXF 左眼だけ・両眼の穴(眼 B)']));
    const r = radii(s, 'R'), l = radii(s, 'L');
    assert.ok(Math.abs(r[45] - 20) <= TOL && Math.abs(l[135] - 20) <= TOL && Math.abs(r[135] - 25) <= TOL, kind);
  }
});
