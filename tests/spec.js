// 規格(DCS v3.14)の決まりを確かめるテストの書き方。node:test の test に、確かめる決まりなどを添える
//   spec(名前, { req: [番号], kind: [確かめ方], side: '送る' | '受ける' }, 本体)
//   req   docs/conformance.md の「番号」の欄(vca-guide の docs/requirements.md の R・S・O 番号か、番号の無い決まりの節)
//   kind  正常・異常・境界・規格の例
//   side  送る(このツールが書くデータが決まりを守る)・受ける(相手が決まりを破ったデータの扱い)
// node --test では普通のテストとして動く。tools/trace.js は collect() で集めて自分で実行し、docs/conformance.md と突き合わせる
'use strict';
const test = require('node:test');

let collected = null;
function spec(name, meta, fn) {
  if (collected) collected.push({ name, meta, fn });
  else test(name, fn);
}
spec.collect = () => (collected = []);
module.exports = spec;
