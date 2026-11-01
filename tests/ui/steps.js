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
  ok((await t.eval(`${$('n-vca')}.textContent`)) === 'nojob-frame.oma', '保存名は元のファイル名: ' + await t.eval(`${$('n-vca')}.textContent`));
  ok((await t.eval(`${$('job')}.placeholder`)) === '?', 'JOB の欄の案内は ?');

  // 4. ファイルの JOB が長い: 誤りを知らせる
  await load('long.vca', 'REQ=FIL\r\nJOB=ABCDEFGHIJKLMNO\r\n' + R8);
  ok((await msgs()).includes('12 文字') && await disabled('vca'), 'ファイルの JOB が長ければ誤りを知らせる: ' + await msgs());

  // 5. 引き継がないレコード: 値に ; を含むもの、誤りのある DRILLE
  await load('quote.vca', 'REQ=FIL\r\nJOB=A1\r\nLNAM="A;B";"C"\r\nDRILLE=R;?;1;2;1.4\r\n' + R8);
  o = await out();
  ok(!/LNAM|DRILLE/.test(o) && (await msgs()).includes('LNAM') && (await msgs()).includes('DRILLE'), '; を含む値と誤りのある DRILLE は引き継がず知らせる: ' + await msgs());
  await t.shot('05-not-kept');
};
