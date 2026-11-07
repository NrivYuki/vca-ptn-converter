// vca-ptn Converter の画面検査(書き出す VCA の JOB と、引き継がないレコードの知らせ)
module.exports = async (t) => {
  const ok = (c, m) => t.log((c ? 'OK   ' : 'NG   ') + m);
  const $ = id => `document.getElementById(${JSON.stringify(id)})`;
  const out = () => t.eval(`${$('outText')}.value`);
  const msgs = () => t.eval(`${$('outmsgs')}.textContent`);
  const disabled = k => t.eval(`document.querySelector('[data-out=${k}]').disabled`);
  const set = async (id, v) => {
    await t.eval(`(() => { const e = ${$(id)}; e.removeAttribute('maxlength'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await t.sleep(300);
  };
  // ファイルを選んだときと同じように読み込む
  const load = async (name, text) => {
    await t.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)})); const f = ${$('file')}; f.files = dt.files; f.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await t.sleep(800);
  };
  const R8 = 'TRCFMT=1;8;E;R;F\r\nR=2500;2500;2500;2500;2500;2500;2500;2500\r\n';

  // 1. サンプル: 1 行目 REQ=FIL、2 行目 JOB、R の後に ZFMT=0
  await t.eval(`${$('sample')}.click()`); await t.sleep(800);
  let o = await out();
  ok(/^REQ=FIL\r?\nJOB=/.test(o), 'サンプルの VCA は REQ=FIL・JOB で始まる');
  ok(/\nZFMT=0/.test(o), 'R の後に ZFMT=0 がある');

  // 2. JOB の誤り: VCA は書き出さない。元のまま保存する PTN・JOB と、SVG は保存できる
  await set('job', 'ABCDEFGHIJKLM');
  ok((await msgs()).startsWith('VCA: JOB は 12 文字') && await disabled('vca') && !(await disabled('ptn')) && !(await disabled('svg')), 'JOB が 13 文字なら誤り。VCA は押せず、元のままの PTN と SVG は押せる: ' + await msgs());
  ok((await out()) === '', '誤りのときは中身を出さない');
  await set('keep', '0');
  ok((await msgs()).startsWith('VCA・PTN・JOB: JOB は 12 文字') && await disabled('ptn') && await disabled('job'), '作り直すときは PTN・JOB も押せない: ' + await msgs());
  await set('keep', '1');
  await set('job', 'A;B');
  ok((await msgs()).includes('「;」'), 'JOB の ; は誤り');
  await set('job', 'A1');
  ok(/\nJOB=A1\r?\n/.test(await out()) && !(await disabled('vca')), 'JOB を直すと書き出せる');
  await set('job', '');

  // 3. JOB の無いファイル: JOB=?。保存名は元のファイル名
  await load('nojob-frame.vca', 'REQ=FIL\r\n' + R8);
  o = await out();
  ok(/^REQ=FIL\r?\nJOB=\?\r?\n/.test(o), 'JOB の無いファイルは JOB=?: ' + JSON.stringify(o.slice(0, 30)));
  ok((await t.eval(`${$('n-vca')}.textContent`)) === 'nojob-frame.vca', '保存名は元のファイル名(VCA は .vca): ' + await t.eval(`${$('n-vca')}.textContent`));
  ok((await t.eval(`${$('job')}.placeholder`)) === '?', 'JOB の欄の案内は ?');

  // 4. ファイルの JOB が長い: 誤りを知らせる
  await load('long.vca', 'REQ=FIL\r\nJOB=ABCDEFGHIJKLMNO\r\n' + R8);
  ok((await msgs()).includes('12 文字') && await disabled('vca'), 'ファイルの JOB が長ければ誤りを知らせる: ' + await msgs());

  // 5. 引き継がないレコード: 値に ; を含むもの、誤りのある DRILLE
  await load('quote.vca', 'REQ=FIL\r\nJOB=A1\r\nLNAM="A;B";"C"\r\nDRILLE=R;?;1;2;1.4\r\n' + R8);
  o = await out();
  ok(!/LNAM|DRILLE/.test(o) && (await msgs()).includes('LNAM') && (await msgs()).includes('DRILLE'), '; を含む値と誤りのある DRILLE は引き継がず知らせる: ' + await msgs());
  await t.shot('05-not-kept');

  // 6. SVG の受け渡し(SVG の読み込みはブラウザだけで動く)。tests/formats.test.js の SVG の分:
  //    元のデータ →(反対の眼を作る・作らない)→ SVG → 読み込み → VCA・DXF・SVG → 読み込み で、眼・形・寸法・穴が変わらないか
  const fs = require('fs'), path = require('path');
  const sources = {};
  for (const f of ['_SAMPLE0001.vca', 'frame-right.vca', 'frame-both.vca', 'frame-uneven.vca']) sources[f] = fs.readFileSync(path.join(__dirname, '../../samples', f), 'latin1');
  const dent = Array.from({ length: 360 }, (_, i) => (i >= 30 && i <= 60 ? 2000 : 2500));
  const rl = v => { const o = []; for (let i = 0; i < v.length; i += 10) o.push('R=' + v.slice(i, i + 10).join(';')); return o; };
  sources['両眼・丸穴と長穴'] = ['REQ=FIL', 'JOB=HOLE1', 'DBL=18.00', 'DRILLE=R;C;20.00;3.00;1.40', 'DRILLE=R;C;-21.00;2.00;1.20;-18.50;2.00',
    'TRCFMT=1;360;E;R;F', ...rl(dent)].join('\r\n') + '\r\n';
  const shapePath = path.join(__dirname, '../../../vca-shape-maker/shape.js');
  if (fs.existsSync(shapePath)) {
    const Shape = require(shapePath);
    sources['shape-maker 五角形・穴'] = Shape.toVCA([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 4 }, { x: 3, y: 0 }, { x: 0, y: 4 }],
      { widthMM: 50, eye: 'L', job: 'SHAPE2', holes: [{ x: 10, y: -5, diameter: 1.4 }] }).text;
  }
  const failures = await t.eval(`(() => {
    const C = Converter, TOL = 0.02, fails = [], sources = ${JSON.stringify(sources)};
    const radii = (s, e) => C.resample(C.centered(s.eyes[e].pts), 360).radii;
    const n = s => { const e = Object.values(s.eyes)[0]; return e.n && e.mode === 'E' ? e.n : Math.max(360, e.pts.length); };
    const W = { VCA: s => C.fromVCA(C.toVCA(s, { n: n(s), dbl: s.dbl, keepRecords: true }).text), DXF: s => C.fromDXF(C.toDXF(s, { dbl: s.dbl })), SVG: s => C.fromSVG(C.toSVG(s, { dbl: s.dbl })) };
    const same = (a, b, what) => {
      if (b.errors && b.errors.length) return fails.push(what + ': ' + b.errors.join(' / '));
      if (Object.keys(a.eyes).sort().join() !== Object.keys(b.eyes).sort().join()) return fails.push(what + ': 眼 ' + Object.keys(b.eyes));
      for (const e of Object.keys(a.eyes)) {
        const ra = radii(a, e), rb = radii(b, e), d = Math.max(...ra.map((v, i) => Math.abs(v - rb[i])));
        if (d > TOL) fails.push(what + ': ' + e + ' の形が ' + d.toFixed(4) + ' mm 違う');
        const ha = (a.holes && a.holes[e]) || [], hb = (b.holes && b.holes[e]) || [];
        if (ha.length !== hb.length) fails.push(what + ': ' + e + ' の穴の数 ' + ha.length + ' / ' + hb.length);
        else ha.forEach((h, i) => { if (!hb.some(g => Math.abs(g.x - h.x) <= TOL && Math.abs(g.y - h.y) <= TOL || Math.abs((g.xEnd ?? g.x) - h.x) <= TOL && Math.abs((g.yEnd ?? g.y) - h.y) <= TOL)) fails.push(what + ': ' + e + ' の穴 ' + (i + 1) + ' の位置'); });
      }
    };
    let count = 0;
    for (const [name, text] of Object.entries(sources)) {
      for (const fill of [false, true]) {
        const s0 = fill ? C.fillMirror(C.fromVCA(text)) : C.fromVCA(text);
        const s1 = W.SVG(s0);
        same(s0, s1, name + (fill ? '・反対の眼を作る' : '') + ' → SVG'); count++;
        for (const k of Object.keys(W)) { same(s0, W[k](s1), name + (fill ? '・反対の眼を作る' : '') + ' → SVG → ' + k); count++; }
        for (const k of ['VCA', 'DXF']) { same(s0, W.SVG(W[k](s0)), name + (fill ? '・反対の眼を作る' : '') + ' → ' + k + ' → SVG'); count++; }
      }
    }
    return { count, fails };
  })()`);
  ok(!failures.fails.length, `SVG を通る組み合わせ ${failures.count} 通りで、眼・形・穴が変わらない` + (failures.fails.length ? ': ' + failures.fails.slice(0, 5).join(' / ') : ''));

  // 7. vca-lens-simulator の三面図の SVG を読み込める(図形として。玉形は割り当て直す必要がある)
  const lensDir = path.join(__dirname, '../../../vca-lens-simulator');
  if (fs.existsSync(path.join(lensDir, 'lens.js'))) {
    const Lens = require(path.join(lensDir, 'lens.js')), Drawing = require(path.join(lensDir, 'drawing.js'));
    const d = Lens.fromVCA(fs.readFileSync(path.join(lensDir, 'samples/frame-both.vca'), 'latin1'));
    const svgs = ['bevel', 'groove', 'flat'].map(edge => Drawing.forExport(Drawing.threeView(Lens.build(d.eyes.R, { sph: -4, cyl: -1, ax: 180, n: 1.6, base: 3, minCT: 1.2, minEdge: 0.8, edge, grooveW: 0.6, grooveD: 0.4 }), { eye: 'R', title: 'flow' })));
    const r = await t.eval(`${JSON.stringify(svgs)}.map(s => { const x = Converter.fromSVG(s); return [Converter.detect(s, 'lens.svg'), x.contours ? x.contours.length : 0, (x.errors || []).join(' / ')]; })`);
    ok(r.every(([k, n]) => k === 'svg' && n > 0), '三面図の SVG(ヤゲン・溝・平)を SVG として読み、閉じた輪郭がある: ' + JSON.stringify(r));
  }

  // 8. ファイルを置く(OS からのドラッグ)。読み込み欄の上でも、ページのほかの場所でも読む。形式は中身と拡張子で決める
  const C = require('../../converter.js');
  const both = fs.readFileSync(path.join(__dirname, '../../samples/frame-both.vca'), 'latin1');
  const set0 = C.fromVCA(both);
  const files = [['drop.vca', both, 'VCA テキスト'], ['drop.oma', both, 'VCA テキスト'], ['DROP.PTN', both, 'VCA テキスト'], ['drop.job', both, 'VCA テキスト'],
    ['drop.dxf', C.toDXF(set0, { dbl: 18 }), 'DXF'], ['drop.svg', Buffer.from(C.toSVG(set0, { dbl: 18 }), 'utf8'), 'SVG']];
  for (const [name, body, kind] of files) {
    for (const [where, tab] of [['#drop', 'load'], ['#outText', 'out']]) {
      await t.eval(`document.getElementById('tab-${tab}').click()`);   // 置く場所が見えるタブを開く
      await t.drop(where, [[name, body]]); await t.sleep(1000);
      const info = await t.eval(`document.getElementById('srcinfo').textContent`);
      const trc = ((await t.eval(`document.getElementById('outText').value`)).match(/^TRCFMT=1;/gm) || []).length;
      ok(info === `${name}(${kind})` && trc === 2, `${where} に ${name} を置くと ${kind} として読み、両眼の VCA にする: ${info}・TRCFMT ${trc} 個`);
      ok(!(await t.eval(`document.querySelector('[data-out=vca]').disabled`)), `${name} を置いたあと VCA を保存できる`);
    }
  }

  // 9. 保存のボタン: 保存するファイルの名前と中身を、ボタンを押して受け取る(ダウンロードは止める)。
  //    VCA → DXF を保存 → その DXF を読み込む → VCA を保存、の流れで、元の点数・形・穴に戻ることと、図面に入らないレコードの知らせ
  const saved = k => t.eval(`new Promise(res => {
    const make = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = click; window.__savedName = this.download; };
    URL.createObjectURL = b => { URL.createObjectURL = make; b.arrayBuffer().then(a => setTimeout(() => res({ name: window.__savedName, body: Array.from(new Uint8Array(a), c => String.fromCharCode(c)).join('') }), 0)); return 'blob:saved'; };
    document.querySelector('[data-out=${k}]').click();
  })`);
  const rLines = vals => { const out = []; for (let i = 0; i < vals.length; i += 15) out.push('R=' + vals.slice(i, i + 15).join(';')); return out; };
  const hole = ['REQ=FIL', 'JOB=SAVE1', 'DBL=18.00', 'FCRV=4.00;4.00', 'DRILLE=R;C;20.00;3.00;1.40', 'DRILLE=L;C;-20.00;3.00;1.40',
    'TRCFMT=1;360;E;R;F', ...rLines(dent), 'TRCFMT=1;360;E;L;F', ...rLines(dent.map((_, i) => dent[(540 - i) % 360]))].join('\r\n') + '\r\n';
  await t.eval(`document.getElementById('tab-load').click()`);
  await load('save1.vca', hole);
  const outs = {};
  for (const k of ['svg', 'dxf', 'vca', 'ptn', 'job']) outs[k] = await saved(k);
  ok(outs.vca.name === 'SAVE1.vca' && outs.svg.name === 'SAVE1.svg' && outs.dxf.name === 'SAVE1.dxf', `保存名は JOB と拡張子(VCA は .vca): ${outs.vca.name} / ${outs.svg.name} / ${outs.dxf.name}`);
  ok(/\.ptn$/.test(outs.ptn.name) && /\.job$/.test(outs.job.name), `PTN・JOB の保存名: ${outs.ptn.name} / ${outs.job.name}`);
  // 1 行目 REQ・2 行目 JOB(7.5.4)。改行は CR LF のまま(画面のテキスト欄の値は LF になるので、それを保存していないこと)。
  // 元の FCRV・DRILLE を引き継ぎ、玉形は元の 360 点
  const vcaLines = outs.vca.body.split('\r\n');
  ok(outs.vca.body.startsWith('REQ=FIL\r\nJOB=SAVE1\r\nDBL=18.00\r\n') && !/[^\r]\n/.test(outs.vca.body) && vcaLines.includes('FCRV=4.00;4.00')
    && vcaLines.filter(l => l.startsWith('DRILLE=')).join('|') === 'DRILLE=R;C;20.00;3.00;1.40|DRILLE=L;C;-20.00;3.00;1.40' && vcaLines.includes('TRCFMT=1;360;E;R;F'),
    '保存する VCA: REQ=FIL・JOB=SAVE1 で始まり、CR LF のまま、FCRV・DRILLE を引き継ぎ 360 点');
  ok(outs.ptn.body === hole && outs.job.body === hole, 'PTN・JOB は「元の VCA をそのまま使う」なら元のファイルの中身');
  ok((await t.eval(`${$('outmsgs')}.textContent`)).includes('JOB・FCRV は入らない'), 'SVG・DXF に入らないレコードを知らせる: ' + await t.eval(`${$('outmsgs')}.textContent`));
  await load('SAVE1.dxf', outs.dxf.body);
  ok((await t.eval(`${$('nhint')}.textContent`)) === '360 点', 'DXF を読み込み直すと、VCA の点数の自動は元の 360 点: ' + await t.eval(`${$('nhint')}.textContent`));
  const back = await saved('vca');
  ok(back.name === 'SAVE1.vca', 'DXF から作った VCA の保存名は DXF のファイル名: ' + back.name);
  const s0 = C.fromVCA(hole), s1 = C.fromVCA(back.body);
  const r0 = C.resample(C.centered(s0.eyes.R.pts), 360).radii, r1 = C.resample(C.centered(s1.eyes.R.pts), 360).radii;
  const dmax = Math.max(...r0.map((v, i) => Math.abs(v - r1[i])));
  ok(/^REQ=FIL\r\nJOB=\?\r\nDBL=18\.00\r\n/.test(back.body) && /\r\nTRCFMT=1;360;E;R;F\r\n/.test(back.body) && dmax <= 0.01,
    `DXF から作った VCA: JOB=?・DBL=18.00・360 点で、形の違い ${dmax.toFixed(4)} mm`);
  ok((back.body.match(/^DRILLE=[RL];C;/gm) || []).length === 2 && !/FCRV/.test(back.body), 'DXF から作った VCA: 穴は両眼に 1 つずつ、FCRV は無い');
};
