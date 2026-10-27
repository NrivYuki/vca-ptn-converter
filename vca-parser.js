/*
 * vca-parser.js — VCA / OMA（DCS）データの読み書きヘルパー
 *
 * 参照: The Vision Council "Data Communication Standard" v3.14
 * 規格本文の転載ではなく、仕様を読んで独自に実装したものです。
 * MIT License
 *
 * ラベル定義表（附属書 A の全ラベル）は別ファイル vca-records.js にあります。
 * ブラウザでは vca-records.js → vca-parser.js の順に <script> で読み込むと window.VCA に、
 * Node.js では require('./vca-parser.js') で読み込めます（vca-records.js は自動で読み込みます）。
 * vca-records.js が無くても動きますが、その場合は docs/records.md に載せた主なラベルだけを判別します。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let table = null;
    try { table = require('./vca-records.js'); } catch (e) { /* 定義表なしでも動く */ }
    module.exports = factory(table);
  } else root.VCA = factory(root.VCA_RECORDS || null);
})(typeof self !== 'undefined' ? self : this, function (TABLE) {
  'use strict';

  // ---- 予約文字 -------------------------------------------------------------
  const CH = {
    FS: '\x1c',   // パケット開始
    GS: '\x1d',   // パケット終了
    RS: '\x1e',   // CRC レコードの直前
    ACK: '\x06',  // 受信成功
    NAK: '\x15',  // 受信失敗
    ESC: '\x1b',  // バイナリ中のエスケープ
    SUB: '\x1a',  // DOS の EOF
  };
  // バイナリレコード中でエスケープが必要な予約制御文字（規格の表 1 のうち 32 未満のもの）
  const ESCAPED = new Set([0x1c, 0x1d, 0x11, 0x13, 0x06, 0x15, 0x1b, 0x1e, 0x1a, 0x0d, 0x0a]);

  // ---- CRC ------------------------------------------------------------------
  // CCITT CRC-16（多項式 0x1021、初期値 0、反転なし。XMODEM と同じ）
  function crc16(str) {
    let crc = 0;
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) & 0xff) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  // ---- バイト列 <-> 文字列（1 文字 = 1 バイト） ---------------------------------
  function bytesToString(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }

  function escapeBinary(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out += ESCAPED.has(c) ? CH.ESC + String.fromCharCode(c | 0x80) : s[i];
    }
    return out;
  }

  function unescapeBinary(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) === 0x1b && i + 1 < s.length) { out += String.fromCharCode(s.charCodeAt(++i) & 0x7f); }
      else out += s[i];
    }
    return out;
  }

  // ---- 形式 4（パックトバイナリ） ---------------------------------------------
  // 附属書 B の packit()/unpackit() と同じ手順。値は 16 ビット語・8 ビット・4 ビットの 3 種類で、
  // 0x8000（語→差分）、0x80（差分→増分）、0x81（差分→語）、0x8（増分→差分）で切り替える。
  // 語は下位バイトが先。奇数ニブル位置から書くときのニブル順も附属書 B に合わせる。
  function packBinary(values) {
    const out = [];
    let nib = 0;   // 書いたニブル数
    function put(v, n) {
      if (!(nib & 1)) {
        if (n === 1) out.push((v & 0x0f) << 4);
        else { out.push(v & 0xff); if (n === 4) out.push((v >> 8) & 0xff); }
      } else {
        const last = out.length - 1;
        if (n === 1) out[last] |= v & 0x0f;
        else if (n === 2) { out[last] |= (v & 0xf0) >> 4; out.push((v & 0x0f) << 4); }
        else {
          out[last] |= (v & 0x00f0) >> 4;                        // ニブル 3
          out.push(((v & 0x000f) << 4) | ((v & 0xf000) >> 12)); // ニブル 4 と 1
          out.push((v & 0x0f00) >> 4);                           // ニブル 2
        }
      }
      nib += n;
    }
    let state = 16, dr1 = 0;
    for (let i = 0; i < values.length; i++) {
      const dr = i ? values[i] - values[i - 1] : values[i], d2r = dr - dr1;
      if (state === 16) {
        if (dr < 128 && dr > -127) { state = 8; put(0x8000, 4); put(dr, 2); }
        else put(values[i], 4);
      } else if (state === 8) {
        if (dr >= 128 || dr <= -127) { state = 16; put(0x81, 2); put(values[i], 4); }
        else if (d2r < 8 && d2r > -8) { state = 4; put(0x80, 2); put(d2r, 1); }
        else put(dr, 2);
      } else {
        if (d2r >= 8 || d2r <= -8) {
          put(0x8, 1);
          if (dr >= 128 || dr <= -127) { state = 16; put(0x81, 2); put(values[i], 4); }
          else { state = 8; put(dr, 2); }
        } else put(d2r, 1);
      }
      dr1 = dr;
    }
    // 奇数ニブルで終わったら 0 ニブルを足す（上の push で下位ニブルはすでに 0）
    return String.fromCharCode.apply(null, out);
  }

  function unpackBinary(s, count) {
    const b = i => s.charCodeAt(i) & 0xff;
    let pos = 0, nib = 0;
    function need(k) { if (pos + k > s.length) throw new Error('形式 4 のデータが途中で切れています'); }
    function get(n) {
      let j;
      if (!(nib & 1)) {
        if (n === 1) { need(1); j = (b(pos) & 0xf0) >> 4; if (j > 7) j -= 16; }
        else if (n === 2) { need(1); j = b(pos++); if (j > 127) j -= 256; }
        else { need(2); j = b(pos) | (b(pos + 1) << 8); pos += 2; }
      } else {
        need(1);
        j = b(pos++) & 0x0f;
        if (n === 1) { if (j > 7) j -= 16; }
        else if (n === 2) { need(1); j = (j << 4) | ((b(pos) & 0xf0) >> 4); if (j > 127) j -= 256; }
        else {
          need(2);
          j = (j << 4) | ((b(pos) & 0xf0) >> 4);
          j |= (b(pos++) & 0x0f) << 12;
          j |= (b(pos) & 0xf0) << 4;
        }
      }
      nib += n;
      return j;
    }
    const out = [];
    let state = 16, size = 4, dr1 = 0;
    for (let i = 0; i < count; i++) {
      for (;;) {
        const x = get(size);
        if (state === 16) {
          if (x === 0x8000) { state = 8; size = 2; continue; }
          out.push(x);
          dr1 = i ? x - out[i - 1] : x;
        } else if (state === 8) {
          if ((x & 0xff) === 0x80) { state = 4; size = 1; continue; }
          if ((x & 0xff) === 0x81) { state = 16; size = 4; continue; }
          out.push(i ? out[i - 1] + x : x);
          dr1 = x;
        } else {
          if ((x & 0x0f) === 0x8) { state = 8; size = 2; continue; }
          if (!i) throw new Error('形式 4 の先頭の値が増分形式になっています');
          const dr = dr1 + x;
          out.push(out[i - 1] + dr);
          dr1 = dr;
        }
        break;
      }
    }
    return out;
  }

  // ---- バイナリ形式（形式 2・3・4） -------------------------------------------
  // 16 ビット値は下位バイトが先（リトルエンディアン）。
  // データが途中で切れている場合は、壊れた値を返さずに例外を投げる。
  // 形式 4 は値の個数が分からないと復号できないので count を渡すこと。
  function decodeBinary(fmt, s, count) {
    const b = i => s.charCodeAt(i) & 0xff, out = [];
    if (fmt === 2) {
      if (s.length % 2) throw new Error(`形式 2 のデータが ${s.length} バイトで、2 バイト単位になっていません`);
      for (let i = 0; i < s.length; i += 2) out.push(b(i) | (b(i + 1) << 8));
    } else if (fmt === 3) {
      // 先頭は 16 ビットの絶対値。以降は符号付き 1 バイトの差分で、
      // -128（0x80）が来たら次の 2 バイトが絶対値になる。
      if (s.length === 0) return out;
      if (s.length < 2) throw new Error('形式 3 の先頭の値（2 バイト）が途中で切れています');
      let i = 2, prev = b(0) | (b(1) << 8);
      out.push(prev);
      while (i < s.length) {
        let d = b(i++);
        if (d === 0x80) {
          if (i + 1 >= s.length) throw new Error('形式 3 の 0x80 に続く絶対値（2 バイト）が途中で切れています');
          prev = b(i) | (b(i + 1) << 8); i += 2;
        } else { if (d > 127) d -= 256; prev += d; }
        out.push(prev);
      }
    } else if (fmt === 4) {
      if (!(count >= 0)) throw new Error('形式 4 の復号には値の個数が必要です');
      return unpackBinary(s, count);
    } else throw new Error('decodeBinary: 形式 ' + fmt + ' は未対応です');
    return out;
  }

  function encodeBinary(fmt, values) {
    const w = v => String.fromCharCode(v & 0xff, (v >> 8) & 0xff);
    let s = '';
    if (fmt === 2) values.forEach(v => { s += w(v); });
    else if (fmt === 3) {
      values.forEach((v, i) => {
        const d = v - values[i - 1];
        if (i === 0) s += w(v);
        else if (d >= -127 && d <= 127) s += String.fromCharCode(d & 0xff);
        else s += '\x80' + w(v);
      });
    } else if (fmt === 4) s = packBinary(values);
    else throw new Error('encodeBinary: 形式 ' + fmt + ' は未対応です');
    return s;
  }

  // ---- ラベル定義 -----------------------------------------------------------
  // k: 値の並び  s=単一 c=左右 o=左右（省略可。単一値は両眼） l=可変長 m=決まった複数の欄 ?=不明
  // p: 1 なら複数回出現してよい  m: 'Y'/'O' 測定値接頭辞あり  dep: 廃止（後継ラベル）
  const DEFS = {};
  if (TABLE && TABLE.records) Object.keys(TABLE.records).forEach(l => { DEFS[l] = Object.assign({}, TABLE.records[l]); });
  else {
    // 定義表が無いときの最小限の定義（docs/records.md に載せたもの）
    ('HBOX VBOX CIRC CIRC3D FED FCRV BSIZ CSIZ').split(' ').forEach(l => { DEFS[l] = { k: 'o' }; });
    ('FBFCIN FBFCUP SPH CYL AX ADD PRVM PRVA IPD NPD OCHT SEGHT BVD PANTO LIND TIND FRNT BACK FRNTR BACKR ' +
     'DIA CRIB BCTHK BETHK LTYPE LMATTYPE CTHICK THKP THKA THKR THNP THNA THNR').split(' ').forEach(l => { DEFS[l] = { k: 'c' }; });
    ('REQ ANS JOB CRC DEV VEN MODEL SN OMAV TXTENC REM DBL MPD ETYP').split(' ').forEach(l => { DEFS[l] = { k: 's' }; });
    ('STATUS TIMEOUT DEF XSTATUS DRILLE ENGMARK PROC PROCBLK').split(' ').forEach(l => { DEFS[l] = { k: 'm' }; });
    DEFS.D = { k: 'l' };
  }

  // 規格の本文で定義されていて、附属書 A の表には無いレコード（5.12〜5.14 のデータセット）
  const BODY_RECORDS = {
    PMFMT: { k: 'm', sec: '5.12.2' }, PP: { k: 'l', sec: '5.12.3' },
    WMFMT: { k: 'm', sec: '5.13.2' }, WW: { k: 'l', sec: '5.13.3' },
    DDFMT: { k: 'm', sec: '5.14.2' }, DD: { k: 'm', sec: '5.14.3' },
  };
  Object.keys(BODY_RECORDS).forEach(l => { if (!DEFS[l]) DEFS[l] = BODY_RECORDS[l]; });
  // 表のデータ型では単一値だが、本文で複数の欄を持つ形が定義されているもの
  if (DEFS.LDPATH) DEFS.LDPATH.k = 'm';   // 5.9.3：1 欄・装置ごとの 6〜7 欄・暗号化データ用の形
  if (DEFS.ENGMARK) DEFS.ENGMARK.k = 'm';  // 表では型の記載なし。5.15.1 で最大 16 欄

  // 複数回出現してよいレコード。表の上付き P（DRILLE のみ）に加えて、本文や表の説明で
  // 「複数送ってよい」と書かれているもの。データセットの見出しは両眼分・候補の列挙で繰り返す。
  const PLURAL_BY_TEXT = {
    DRILLE: '表 A.1（上付き P）', DRILL: '表 A.1（穴ごとに 1 レコード）', JOBRTE: '表 A.1', XSTATUS: 'A.5', D: '表 A.2',
    DEF: '7.2（要求の定義ごと）', ENDDEF: '7.2（要求の定義ごと）', DRLFMT: '5.5.3（0〜3 個）',
    ENGMARK: '5.15.1.1', PROC: '5.17.1', PROCBLK: '5.17.2', DSDEV: '5.9.2.2',
    TRCFMT: '5.4.1', ZFMT: '5.4.1', CRIBFMT: '5.10.5', STHKFMT: '5.11.3', SHLFFMT: '5.8.1',
    SURFMT: '5.9.4', PASSFMT: '5.9.4', PMFMT: '5.12', WMFMT: '5.13', DDFMT: '5.14', DD: '5.14.3',
    REM: '（備考）', LDPATH: '5.9.3.2（装置ごとの形）', LDCRYPT: '5.9.3.3',
  };
  Object.keys(PLURAL_BY_TEXT).forEach(l => { if (DEFS[l]) DEFS[l].p = 1; });

  // 欄の名前（規格の本文・表の説明にある欄の並びを、このライブラリで名前にしたもの）
  const FIELDS = {
    DRILLE: ['eye', 'reference', 'x', 'y', 'diameter', 'xEnd', 'yEnd', 'depth', 'featureType', 'angleMode',
             'lateralAngle', 'verticalAngle', 'minThickness', 'maxThickness', 'group', 'resize'],      // 5.5.2
    DRILL: ['eye', 'x', 'y', 'diameter', 'xEnd', 'yEnd', 'depth', 'angleMode', 'lateralAngle', 'verticalAngle'],
    DRILLS: ['eye', 'featureType', 'startAngle', 'startDistance', 'endAngle', 'endDistance', 'diameter', 'depth',
             'lateralAngle', 'rotationalAngle'],
    ENGMARK: ['kind', 'content', 'extra', 'eye', 'surface', 'orientation', 'x', 'y', 'z', 'visibility',
              'height', 'rotation', 'font', 'color', 'width', 'method'],                                // 5.15.1
    XSTATUS: ['eye', 'code', 'text', 'severity'],                                                       // A.5
    STATUS: ['code', 'text'],
    TIMEOUT: ['ack', 'packet', 'char'],
    DEF: ['tag', 'requestId'],
    PROC: ['label', 'dev', 'ven', 'model', 'right', 'left'],                                            // 5.17.1
    PROCBLK: ['id', 'dev', 'ven', 'model', 'sn'],                                                       // 5.17.2
    REP: ['name', 'value', 'time', 'duration', 'range', 'eye', 'unit'],                                 // 5.22
    JOBRTE: ['eye', 'dev', 'ven', 'model', 'sn', 'mname', 'time', 'status', 'text'],
    DSDEV: ['dev', 'ven', 'model', 'sn', 'folder'],
    VIEWP: ['eye', 'distance', 'elevation', 'inset'],
    EDATA: ['method', 'length', 'data'],
    SMDMAX: ['in', 'out', 'up', 'down'],
    ACT: ['action', 'target'],
    TRCFMT: ['format', 'points', 'mode', 'eye', 'object'], ZFMT: ['format', 'points', 'mode', 'eye', 'object'],
    CRIBFMT: ['format', 'points', 'mode', 'eye'], STHKFMT: ['format', 'points', 'mode', 'eye'],
    SHLFFMT: ['format', 'points', 'mode', 'eye', 'reference', 'removeFrom'],
    SURFMT: ['format', 'eye', 'surface', 'columns', 'rows', 'width', 'height', 'slopeFormat', 'lowRes', 'passes'],
    PASSFMT: ['format', 'eye', 'surface', 'columns', 'rows', 'width', 'height', 'slopeFormat', 'lowRes', 'sequence'],
    PMFMT: ['format', 'eye', 'powerType', 'quantity', 'kind', 'columns', 'rows', 'width', 'height', 'index',
            'method', 'dbp'],
    WMFMT: ['format', 'eye', 'index', 'columns', 'rows', 'width', 'height'],
    DDFMT: ['format', 'eye', 'count', 'dbp'],
    DD: ['id', 'powerType', 'name', 'result', 'value', 'tolerance', 'display'],
  };
  Object.keys(FIELDS).forEach(l => { if (DEFS[l]) DEFS[l].fields = FIELDS[l]; });

  // 測定値の接頭辞（A.1.1.7）。長いものから順に照合する。
  const MEASURE_PREFIXES = ['TOLV', 'TOL', 'INS', 'CK', 'LD'];

  /**
   * ラベルの定義を返す（無ければ undefined）。
   * 表に無いラベルでも、測定値接頭辞（INS・TOL・TOLV・CK・LD）と M 欄が Y/O の基本ラベルの
   * 組み合わせなら、基本ラベルから導いた定義を返す（derived に接頭辞、base に基本ラベル）。
   */
  function recordDef(label) {
    const L = String(label).toUpperCase();
    if (DEFS[L]) return DEFS[L];
    for (const p of MEASURE_PREFIXES) {
      if (L.length > p.length && L.startsWith(p)) {
        const base = L.slice(p.length), b = DEFS[base];
        if (b && (b.m === 'Y' || b.m === 'O')) {
          const k = b.k === 'o' || b.k === 'c' ? b.k : 's';
          const t = p === 'TOL' || p === 'CK' ? 'literal' : p === 'TOLV' ? 'min|max' : b.t;
          return { k, t, derived: p, base };
        }
      }
    }
    return undefined;
  }

  /**
   * ラベル定義を追加・上書きする。
   * 旧形式の { chiral: true, repeat: true } も受け付ける（chiral → k:'c'、repeat → p:1）。
   */
  function defineRecords(table) {
    Object.keys(table).forEach(key => {
      const L = key.toUpperCase(), d = Object.assign({}, DEFS[L] || { k: 's' }, table[key]);
      if ('chiral' in table[key]) d.k = table[key].chiral ? 'c' : (d.k === 'c' || d.k === 'o' ? 's' : d.k);
      if ('repeat' in table[key]) d.p = table[key].repeat ? 1 : 0;
      d.chiral = d.k === 'c' || d.k === 'o';
      d.repeat = !!d.p;
      DEFS[L] = d;
    });
  }
  Object.keys(DEFS).forEach(l => { DEFS[l].chiral = DEFS[l].k === 'c' || DEFS[l].k === 'o'; DEFS[l].repeat = !!DEFS[l].p; });

  // ---- データセット -----------------------------------------------------------
  // 見出しレコードと、その後に続くレコード。trace 型は形式 1〜4（バイナリ可）、matrix 型は ASCII の表。
  const DATASETS = {
    TRCFMT: { type: 'trace', series: ['R', 'A'] },             // 5.4
    ZFMT: { type: 'trace', series: ['Z', 'ZA'], child: true }, // 5.4.4（直前の TRCFMT に付く）
    CRIBFMT: { type: 'trace', series: ['R', 'A'] },            // 5.10
    STHKFMT: { type: 'trace', series: ['R', 'A', 'T'] },       // 5.11
    SHLFFMT: { type: 'trace', series: ['S', 'SA', 'SD', 'SW'] },// 5.8
    SURFMT: { type: 'matrix', series: ['ZZ', 'DZY', 'DZX', 'DZXY'] }, // 5.9.4
    PASSFMT: { type: 'matrix', series: ['ZZ', 'DZY', 'DZX', 'DZXY'] },
    PMFMT: { type: 'matrix', series: ['PP'] },                 // 5.12
    WMFMT: { type: 'matrix', series: ['WW'] },                 // 5.13
    DDFMT: { type: 'rows', series: ['DD'] },                   // 5.14
  };
  // 角度の系列（等角度 E では送られない）
  const ANGLE_SERIES = { A: true, ZA: true, SA: true };

  // ---- レコードの解析 -------------------------------------------------------
  // 先頭の "*" は記録ラベル一覧での必須印、"数字!" は PROCBLK のブロック番号（5.17.2）
  const LABEL_RE = /^[\s\x1c\x1d\x1e\x1a]*(?:(\d+)!)?\*?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/;
  const MAX_LABEL = 16;

  function splitFields(value) {
    // 値の区切りは ";"。v3.03 より前は文字列を "" で囲むことがある。
    return value.split(';').map(v => v.trim().replace(/^"([\s\S]*)"$/, '$1'));
  }

  const toNum = v => (v === undefined || v === '' || v === '?' ? undefined : Number(v));

  function newDataset(label, fields) {
    const spec = DATASETS[label], f = fields;
    const ds = { type: label, fmt: +f[0], fields: f, records: 0 };
    if (spec.type === 'trace') {
      ds.n = +f[1];
      ds.mode = (f[2] || 'E').toUpperCase();
      ds.eye = (f[3] || 'R').toUpperCase();
      ds.equi = ds.mode === 'E';
      ds.series = {}; ds.raw = {};
      spec.series.forEach(s => { ds.series[s] = []; ds.raw[s] = ''; });
    } else {
      ds.eye = (f[1] || '').toUpperCase();
      ds.rows = [];
      ds.extra = {};
    }
    const names = FIELDS[label];
    if (names) { ds.info = {}; names.forEach((n, i) => { if (f[i] !== undefined && f[i] !== '') ds.info[n] = f[i]; }); }
    return ds;
  }

  /**
   * VCA テキスト（ファイルやパケット本体）を解析する。
   * 文字列は 1 文字 = 1 バイトで渡すこと（バイナリ形式を含む場合）。
   *
   * 返り値:
   *   records  出現順のレコード { label, fields, vendor?, block? }（データセットの中身は含まない）
   *   rec      各ラベルの最後の値   all  各ラベルのすべての値（複数レコード用）
   *   traces   玉型データセット（TRCFMT。ZFMT のサグは sag に入る）
   *   datasets 玉型以外を含むすべてのデータセット（CRIBFMT・STHKFMT・SHLFFMT・SURFMT など）
   *   proposals データを伴わない見出し（初期化・要求パケットで送る対応形式の候補）
   *   blocks   PROCBLK のブロック（番号ごとに、宣言 decl と、その中身を parse した結果）
   *   unknown  定義表に無いラベル（"_" で始まる試験用ラベルを除く）
   *   errors / warnings
   */
  function parse(text) {
    const records = [], rec = {}, all = {}, traces = [], datasets = [], proposals = [];
    const errors = [], warnings = [], unknown = [], blockLines = {};
    let ds = null, trace = null;   // 開いているデータセット、直前の TRCFMT

    function closeDataset() {
      if (ds && !ds.records && ds.fmt !== 0) {
        // 中身の無い見出しは、対応形式の候補（初期化・要求パケット）
        datasets.splice(datasets.indexOf(ds), 1);
        if (ds.type === 'TRCFMT') traces.splice(traces.indexOf(ds), 1);
        if (ds.type === 'ZFMT' && ds.parent) ds.parent.sag = null;
        proposals.push({ label: ds.type, fields: ds.fields });
      }
      ds = null;
    }

    for (const line of text.split(/\r\n|\r|\n/)) {
      const m = line.match(LABEL_RE);
      if (!m) continue;
      const block = m[1], label = m[2].toUpperCase(), raw = m[3];

      // PROCBLK のブロック内のレコードは、ブロックごとに集めて後でまとめて解析する
      if (block !== undefined) { (blockLines[block] = blockLines[block] || []).push(m[2] + '=' + raw); continue; }

      // データセットの見出し
      if (DATASETS[label]) {
        const fields = splitFields(raw), spec = DATASETS[label];
        closeDataset();
        const d = newDataset(label, fields);
        if (spec.child) {
          if (!trace) { warnings.push('ZFMT の前に TRCFMT がありません'); }
          if (d.fmt === 0) { if (trace) trace.sag = null; continue; }
          d.parent = trace;
          if (trace) trace.sag = d;
        } else if (label === 'TRCFMT') {
          if (d.fmt === 0) { trace = null; warnings.push('トレースデータなし（TRCFMT=0）'); datasets.push(d); continue; }
          d.kind = (fields[4] || '').toUpperCase();
          d.radii = d.series.R; d.angles = d.series.A;  // 以前の版と同じ名前でも参照できるように
          d.sag = null;
          trace = d; traces.push(d);
        } else trace = null;
        if (d.fmt === 0) { datasets.push(d); continue; }   // 「データなし」の見出し
        datasets.push(d);
        ds = d;
        continue;
      }

      // データセットの中身
      if (ds && DATASETS[ds.type].series.indexOf(label) >= 0) {
        ds.records++;
        if (DATASETS[ds.type].type === 'trace') {
          if (ds.fmt === 1) splitFields(raw).forEach(v => { if (v !== '') ds.series[label].push(+v); });
          else ds.raw[label] += raw;
        } else if (label === 'ZZ' || label === 'PP' || label === 'WW') ds.rows.push(splitFields(raw).map(toNum));
        else if (label === 'DD') ds.rows.push(splitFields(raw));
        else ds.extra[label] = splitFields(raw).map(toNum);
        continue;
      }
      if (ds) closeDataset();   // データセットの外のレコードが来たら、データセットは終わり
      if (DATASETS.TRCFMT.series.indexOf(label) >= 0 || ['Z', 'ZA', 'T', 'S', 'SA', 'SD', 'SW', 'ZZ', 'DZX', 'DZY', 'DZXY', 'PP', 'WW', 'DD'].indexOf(label) >= 0) {
        warnings.push(`${label} が対応する見出し（TRCFMT など）の直後にありません`);
      }

      // 通常のレコード
      const fields = splitFields(raw);
      const vendor = label.charAt(0) === '_';
      const r = { label, fields };
      if (vendor) r.vendor = true;
      records.push(r);
      if (label.length > MAX_LABEL) warnings.push(`ラベル ${label} が ${MAX_LABEL} 文字を超えています`);
      const def = recordDef(label);
      if (!def && !vendor) { if (unknown.indexOf(label) < 0) unknown.push(label); }
      if (def && def.dep !== undefined && def.dep !== null) {
        warnings.push(`${label} は廃止されたレコードです` + (def.dep ? `（後継: ${def.dep}）` : ''));
      }
      if (def && !(fields.length === 1 && fields[0] === '?')) {
        if (def.k === 's' && fields.length > 1) warnings.push(`${label} は値が 1 つのレコードですが ${fields.length} 個あります`);
        if ((def.k === 'c' || def.k === 'o') && fields.length > 2 && fields.slice(2).some(v => v !== '')) {
          warnings.push(`${label} は左右 2 つの値のレコードですが ${fields.length} 個あります`);
        }
      }
      if (all[label]) {
        if (def && !def.p) warnings.push(`${label} が複数回あります（rec には最後の値が入ります）`);
        all[label].push(fields);
      } else all[label] = [fields];
      rec[label] = fields;
    }
    closeDataset();

    // バイナリ形式の復元と検証
    function finish(d) {
      const spec = DATASETS[d.type], head = d.type;
      const valueSeries = spec.series.filter(s => !ANGLE_SERIES[s]);
      const angleSeries = spec.series.filter(s => ANGLE_SERIES[s]);
      if (d.fmt === 2 || d.fmt === 3 || d.fmt === 4) {
        for (const s of spec.series) {
          if (!d.raw[s]) continue;
          try { d.series[s] = decodeBinary(d.fmt, unescapeBinary(d.raw[s]), d.n); }
          catch (e) { errors.push(`${s}: ${e.message}（${head} ${d.eye}）`); d.series[s] = []; }
        }
      } else if (d.fmt !== 1) {
        errors.push(`${head} 形式${d.fmt} は未対応です（対応: 1, 2, 3, 4）`);
        return;
      }
      if (d.type === 'TRCFMT') { d.radii = d.series.R; d.angles = d.series.A; }
      const main = d.series[valueSeries[0]];
      if (d.n && main.length !== d.n) warnings.push(`${head} の点数 ${d.n} と ${valueSeries[0]} の個数 ${main.length} が一致しません（${d.eye}）`);
      if (!d.equi) {
        for (const a of angleSeries) {
          if (d.series[a].length !== main.length) errors.push(`角度データ ${a} の個数が ${valueSeries[0]} と一致しません（${d.eye}）`);
        }
      }
      for (const s of valueSeries.slice(1)) {
        if (d.series[s].length && d.series[s].length !== main.length) warnings.push(`${s} の個数が ${valueSeries[0]} と一致しません（${head} ${d.eye}）`);
      }
      for (const s of spec.series) {
        if (d.series[s].some(v => !Number.isFinite(v))) errors.push(`${s} に数値以外の値があります（${d.eye}）`);
      }
    }
    datasets.forEach(d => {
      if (d.fmt === 0) return;
      if (DATASETS[d.type].type === 'trace') finish(d);
      else if (d.info && d.info.rows && d.rows.length !== +d.info.rows) {
        warnings.push(`${d.type} の行数 ${d.info.rows} と実際の行数 ${d.rows.length} が一致しません（${d.eye}）`);
      } else if (d.type === 'DDFMT' && d.info && d.info.count && d.rows.length !== +d.info.count) {
        warnings.push(`DDFMT の件数 ${d.info.count} と DD の数 ${d.rows.length} が一致しません（${d.eye}）`);
      }
    });
    traces.forEach(t => {
      if (t.sag) {
        t.sag.values = t.sag.series.Z; t.sag.angles = t.sag.series.ZA;
        if (datasets.indexOf(t.sag) < 0) datasets.push(t.sag);
      }
    });

    // PROCBLK のブロック
    const blocks = {};
    (all.PROCBLK || []).forEach(f => { blocks[f[0]] = { decl: named('PROCBLK', f) }; });
    Object.keys(blockLines).forEach(id => {
      if (!blocks[id]) { warnings.push(`ブロック ${id} の PROCBLK 宣言がありません`); blocks[id] = { decl: null }; }
      Object.assign(blocks[id], parse(blockLines[id].join('\r\n')));
    });

    return { records, rec, all, traces, datasets, proposals, blocks, unknown, errors, warnings };
  }

  // ---- 値の取り出し ----------------------------------------------------------
  /**
   * 左右（chiral）レコードから片眼の値を取り出す。
   * 値が 1 つだけなら両眼に適用、空欄や "?" は undefined。
   */
  function sideValue(fields, eye) {
    if (!fields) return undefined;
    const v = fields.length >= 2 ? (eye === 'L' ? fields[1] : fields[0]) : fields[0];
    return v === '' || v === '?' || v === undefined ? undefined : v;
  }

  // 10 進の数値だけを受け付ける（"12abc" のように後ろに文字が付いたものは数値として扱わない）
  const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

  function sideNumber(fields, eye) {
    const v = sideValue(fields, eye);
    return v !== undefined && NUMBER_RE.test(v) ? Number(v) : undefined;
  }

  /**
   * 定義に従ってレコードの値を取り出す。左右レコードなら eye（'R'/'L'、既定 'R'）の値、
   * それ以外は最初の値。不明（空欄・?）は undefined。複数の欄を持つレコードは fieldsOf() を使う。
   */
  function value(data, label, eye) {
    const L = String(label).toUpperCase(), f = data.rec[L], def = recordDef(L);
    if (!f) return undefined;
    if (def && (def.k === 'c' || def.k === 'o')) return sideValue(f, eye || 'R');
    return f[0] === '' || f[0] === '?' ? undefined : f[0];
  }
  function number(data, label, eye) {
    const v = value(data, label, eye);
    return v !== undefined && NUMBER_RE.test(v) ? Number(v) : undefined;
  }
  /** 欄に名前を付けたオブジェクト（名前の定義が無いラベルは undefined）。_fields に元の配列 */
  function named(label, f) {
    const def = recordDef(label), names = (def && def.fields) || FIELDS[String(label).toUpperCase()];
    if (!names) return undefined;
    const o = {};
    names.forEach((n, i) => { o[n] = f[i] === undefined || f[i] === '' || f[i] === '?' ? undefined : f[i]; });
    o._fields = f;
    return o;
  }
  /** レコードの最後の値を、欄に名前を付けて返す（名前の定義が無ければ値の配列） */
  function fieldsOf(data, label) {
    const L = String(label).toUpperCase(), f = data.rec[L];
    if (!f) return undefined;
    return named(L, f) || f;
  }
  /** 複数レコードのすべての出現（無ければ空配列）。欄の名前の定義があれば名前付きの値にする */
  function occurrences(data, label) {
    const L = String(label).toUpperCase(), list = data.all[L] || [];
    return list.map(f => named(L, f) || f);
  }
  /** 1 つの値の中に "|" で区切って入れた複数の値を分ける（min|max など） */
  function subValues(v) { return v === undefined ? [] : String(v).split('|'); }

  // ---- 穴あけデータ（5.5） ------------------------------------------------------
  /**
   * DRILLE（無ければ廃止された DRILL）を解釈する。
   * status: 'absent'（レコードなし）/ 'none'（DRILLE=0、穴なし）/ 'unknown'（DRILLE=?、ホスト未対応）/ 'present'
   * features の各要素:
   *   eye 'R'|'L'|'B'（B は右眼の座標で、左眼には左右反転して使う）
   *   origin 'C' 箱中心 / 'E' 縁 / 'B' 外接箱 / 'R' グループ内の基準穴から、side 'N' 鼻側 / 'T' 耳側、
   *   mount 'F' 前面 / 'R' 後面（取付金具の面。省略時 F）
   *   x, y（始点）, diameter, xEnd, yEnd, depth（0・省略は貫通）
   *   featureType 1=穴・長穴（0 は 1 と同じ）/ 2=矩形の切り欠き、shape 'hole'|'slot'|'rectangle'
   *   angleMode 'F' 前面の法線 / 'B' 後面の法線 / 'A' 角度指定（省略時 F、グループで指定があればそれ）
   *   lateralAngle, verticalAngle, minThickness, maxThickness, group {id, seq}, resize 0|1|2
   */
  function drillFeatures(data) {
    const list = data.all.DRILLE || [], legacy = !list.length && data.all.DRILL ? data.all.DRILL : null;
    const src = list.length ? list : legacy || [];
    if (!src.length) return { status: 'absent', features: [] };
    if (src.length === 1 && src[0].length === 1 && (src[0][0] === '0' || src[0][0] === '?')) {
      return { status: src[0][0] === '0' ? 'none' : 'unknown', features: [] };
    }
    const features = [], errors = [];
    src.forEach((f, idx) => {
      const o = named(legacy ? 'DRILL' : 'DRILLE', f);
      if (!legacy && o.reference === '0') return;        // この眼には穴なし
      const ref = legacy ? 'C' : (o.reference || 'C').toUpperCase();   // 空欄は箱中心基準
      const sided = ref.charAt(0) === 'E' || ref.charAt(0) === 'B';
      const feat = {
        eye: (o.eye || '').toUpperCase(),
        origin: ref.charAt(0),
        side: sided ? ref.charAt(1) || undefined : undefined,
        mount: ref.slice(sided ? 2 : 1) || 'F',
        x: toNum(o.x), y: toNum(o.y), diameter: toNum(o.diameter),
        xEnd: toNum(o.xEnd), yEnd: toNum(o.yEnd), depth: toNum(o.depth) || 0,
        featureType: legacy ? 1 : (toNum(o.featureType) || 1),
        angleMode: o.angleMode ? o.angleMode.toUpperCase() : undefined,
        lateralAngle: toNum(o.lateralAngle), verticalAngle: toNum(o.verticalAngle),
        minThickness: toNum(o.minThickness), maxThickness: toNum(o.maxThickness),
        resize: toNum(o.resize) || 0, legacy: !!legacy,
      };
      if (feat.featureType === 0) feat.featureType = 1;
      if (o.group) {
        const g = /^([A-Z]+)(\d+)$/.exec(o.group);
        if (g) feat.group = { id: g[1], seq: +g[2] }; else errors.push(`DRILLE ${idx + 1} 件目のグループ指定 ${o.group} が不正です`);
      }
      const hasEnd = feat.xEnd !== undefined && feat.yEnd !== undefined && (feat.xEnd !== feat.x || feat.yEnd !== feat.y);
      feat.shape = feat.featureType === 2 ? 'rectangle' : hasEnd ? 'slot' : 'hole';
      if (!/^[RLB]$/.test(feat.eye)) errors.push(`${legacy ? 'DRILL' : 'DRILLE'} ${idx + 1} 件目の眼の指定 ${o.eye} が不正です`);
      if (!/^(C[FR]?|[EB][NT][FR]?|R)$/.test(ref)) errors.push(`DRILLE ${idx + 1} 件目の基準 ${ref} が不正です`);
      if (feat.x === undefined || feat.y === undefined) errors.push(`${legacy ? 'DRILL' : 'DRILLE'} ${idx + 1} 件目の座標がありません`);
      if (feat.featureType === 2 && !hasEnd) errors.push(`DRILLE ${idx + 1} 件目は矩形ですが終点がありません`);
      if (feat.angleMode === 'A' && (feat.lateralAngle === undefined || feat.verticalAngle === undefined)) {
        errors.push(`DRILLE ${idx + 1} 件目は角度モード A ですが角度がありません`);
      }
      features.push(feat);
    });
    // 角度モードの省略：同じグループ（明示グループ、無ければ同じ眼・同じ側）に指定があればそれ、無ければ F
    const keyOf = f => f.group ? 'G' + f.eye + f.group.id : 'S' + f.eye + (f.side || (f.x < 0 ? 'neg' : 'pos'));
    const groupMode = {};
    features.forEach(f => { if (f.angleMode) groupMode[keyOf(f)] = groupMode[keyOf(f)] || f.angleMode; });
    features.forEach(f => { if (!f.angleMode) f.angleMode = groupMode[keyOf(f)] || 'F'; });
    const refs = new Set(features.filter(f => f.origin !== 'R').map(f => f.origin));
    if (refs.size > 1) errors.push('1 つのパケットの DRILLE はすべて同じ基準（C・E・B）でなければなりません');
    return { status: features.length ? 'present' : 'none', features, errors, legacy: !!legacy };
  }

  /**
   * 両眼（B）の穴を左眼用に左右反転する（箱中心基準 C のみ。x と横方向の角度の符号を反転）。
   * 縁・外接箱基準（E・B）は鼻側／耳側で指定されているので座標はそのまま使える。
   */
  function mirrorFeature(f) {
    const o = Object.assign({}, f, { eye: 'L' });
    if (f.origin === 'C' || f.origin === 'R') {
      o.x = f.x === undefined ? undefined : -f.x;
      o.xEnd = f.xEnd === undefined ? undefined : -f.xEnd;
      if (f.lateralAngle !== undefined) o.lateralAngle = -f.lateralAngle;
    }
    return o;
  }

  /**
   * 穴あけの情報を DRILLE レコードにする（drillFeatures の逆。[label, field...] の形で buildPacket に渡せる）。
   * features の各要素は drillFeatures と同じ名前（eye・origin・side・mount・x・y・diameter・xEnd・yEnd・depth・
   * featureType・angleMode・lateralAngle・verticalAngle・minThickness・maxThickness・group・resize）。
   * 省略できる欄（取付面 F、深さ 0、種類 1、角度モード F など）は空欄にし、末尾の空欄は書かない。
   * 穴が無いときは DRILLE=0 を 1 つ返す（5.5.2）。
   * 1 つのパケットの基準は 1 種類（C・E・B のどれか。R はグループ内の相対位置）でなければならない。
   */
  function drillRecords(features) {
    if (!features || !features.length) return [['DRILLE', '0']];
    const refs = new Set(features.filter(f => f.origin !== 'R').map(f => f.origin || 'C'));
    if (refs.size > 1) throw new Error('drillRecords: 1 つのパケットの DRILLE はすべて同じ基準（C・E・B）でなければなりません');
    const has = v => v !== undefined && v !== null && v !== '' && Number.isFinite(+v);
    const num = v => (has(v) ? (+v).toFixed(2) : '');
    return features.map((f, i) => {
      const eye = String(f.eye || '').toUpperCase();
      if (!/^[RLB]$/.test(eye)) throw new Error(`drillRecords: ${i + 1} 件目の眼の指定 ${f.eye} が不正です`);
      if (!has(f.x) || !has(f.y)) throw new Error(`drillRecords: ${i + 1} 件目の座標がありません`);
      const origin = String(f.origin || 'C').toUpperCase();
      const sided = origin === 'E' || origin === 'B';
      if (sided && !/^[NT]$/.test(String(f.side || '').toUpperCase())) throw new Error(`drillRecords: ${i + 1} 件目は基準 ${origin} ですが鼻側・耳側（N・T）の指定がありません`);
      const mount = String(f.mount || 'F').toUpperCase();
      const ref = origin + (sided ? String(f.side).toUpperCase() : '') + (origin !== 'R' && mount !== 'F' ? mount : '');
      const type = +f.featureType === 2 ? '2' : '';
      if (type === '2' && (!has(f.xEnd) || !has(f.yEnd))) throw new Error(`drillRecords: ${i + 1} 件目は矩形ですが終点がありません`);
      // 角度モードは B と、角度の付いた A だけ書く（角度の無い A は同じ側の穴から引き継いだもので、読み手も同じく引き継ぐ）
      const m = String(f.angleMode || 'F').toUpperCase();
      const mode = m === 'B' || (m === 'A' && has(f.lateralAngle) && has(f.verticalAngle)) ? m : '';
      const group = f.group ? f.group.id + f.group.seq : '';
      const fields = [eye, ref, num(f.x), num(f.y), num(f.diameter), num(f.xEnd), num(f.yEnd),
        f.depth ? num(f.depth) : '', type, mode, num(f.lateralAngle), num(f.verticalAngle),
        num(f.minThickness), num(f.maxThickness), group, f.resize ? String(f.resize) : ''];
      while (fields.length > 4 && fields[fields.length - 1] === '') fields.pop();
      return ['DRILLE'].concat(fields);
    });
  }

  // ---- 装置ごとのレコード（5.16・5.17） ---------------------------------------
  function matchDevice(dev, ven, model, sn, want) {
    return (!dev || dev === want.dev) && (!ven || ven === want.ven) && (!model || model === want.model) &&
      (!sn || sn === want.sn);
  }
  /**
   * 指定した装置に向けた PROC レコードと PROCBLK ブロックの中身を、通常のレコードの形で返す。
   * want: { dev, ven, model, sn }
   */
  function deviceRecords(data, want) {
    const out = [];
    (data.all.PROC || []).forEach(f => {
      if (matchDevice(f[1], f[2], f[3], '', want)) out.push({ label: f[0], fields: f.slice(4), from: 'PROC' });
    });
    Object.keys(data.blocks || {}).forEach(id => {
      const b = data.blocks[id], d = b.decl;
      if (d && matchDevice(d.dev, d.ven, d.model, d.sn, want)) {
        b.records.forEach(r => out.push({ label: r.label, fields: r.fields, from: 'PROCBLK ' + id }));
      }
    });
    return out;
  }

  /** 自動フォーマット初期化の定義（DEF・D・ENDDEF）を取り出す。* 付きのラベルは mandatory */
  function autoFormatDefinitions(data) {
    const defs = [];
    let cur = null;
    data.records.forEach(r => {
      if (r.label === 'DEF') { cur = { tag: r.fields[0], requestId: r.fields[1] || undefined, labels: [] }; defs.push(cur); }
      else if (r.label === 'D' && cur) {
        r.fields.forEach(l => { if (l) cur.labels.push({ label: l.replace(/^\*/, '').toUpperCase(), mandatory: l.charAt(0) === '*' }); });
      } else if (r.label === 'ENDDEF') cur = null;
    });
    return defs;
  }

  // ---- プリセットパケット（A.3） ---------------------------------------------
  /** 要求種別（'EDG' など）のプリセットパケットの構成。[{label, mandatory, since}] */
  function presetRecords(type) {
    const p = TABLE && TABLE.presets && TABLE.presets[type];
    if (!p) return undefined;
    return p.records.map(r => ({ label: r[0], mandatory: !!r[1], since: r[2] || undefined }));
  }
  /** プリセットの必須レコードのうち、data に無いもの */
  function missingPresetRecords(data, type) {
    const list = presetRecords(type);
    if (!list) return undefined;
    return list.filter(r => r.mandatory && !data.rec[r.label]).map(r => r.label);
  }

  /**
   * パケットのレコード順序を確認する（警告の配列を返す）。6.1.1・7.1.6 による。
   * 1 番目は REQ か ANS。2 番目は JOB だが、次の例外がある。
   *   INI・TIM（7.4.4）・MNT（7.3.6）・CON（7.8.2.7.1）・ANS=ERR（7.1.5）は JOB なし
   *   LNF は OPC（7.7.1）、CMD は JOB の代わりに LIB か RMT でもよい（7.6.1）
   * CRC は parsePacket が別に扱う。
   * file: true のときは 1 行目が REQ（REQ=FIL など）か、ジョブのデータなら 2 行目が JOB かを確認する。
   */
  const NO_JOB = { INI: 1, TIM: 1, MNT: 1, CON: 1, ERR: 1 };
  function checkOrder(data, opts) {
    const w = [], r = data.records, first = r[0];
    if (!first) return ['レコードがありません'];
    const type = String(first.fields[0] || '').toUpperCase(), second = r[1] && r[1].label;
    if (opts && opts.file) {
      if (first.label !== 'REQ') w.push('ファイルの 1 行目が REQ ではありません（通常は REQ=FIL）');
      if (r.some(x => x.label === 'JOB') && second !== 'JOB') w.push('2 番目のレコードが JOB ではありません');
      return w;
    }
    if (first.label !== 'REQ' && first.label !== 'ANS') w.push('最初のレコードが REQ でも ANS でもありません');
    if (NO_JOB[type]) return w;
    if (type === 'LNF') { if (second !== 'OPC') w.push('LNF の 2 番目のレコードが OPC ではありません'); return w; }
    const ok = type === 'CMD' ? ['JOB', 'LIB', 'RMT'] : ['JOB'];
    if (ok.indexOf(second) < 0) w.push(`2 番目のレコードが ${ok.join('・')} ではありません`);
    return w;
  }

  // ---- 座標 -------------------------------------------------------------------
  /**
   * トレースを座標点の列にする（単位 mm、角度は度）。
   * 向きは「検者が装用者を正面から見た状態」。x 右、y 上、0° は 3 時方向、反時計回り。
   * asEye を指定すると、その眼の向きに左右反転して返す。
   * 反転した点列は角度の小さい順（反時計回り）に並べ直すが、先頭は 0° とは限らない。
   * 描画や寸法の計算にはそのまま使えるが、R レコードに書き戻すときは 0° から並べ直すこと。
   * CRIBFMT・STHKFMT・SHLFFMT のデータセットも渡せる（S・SA を使う）。
   */
  function tracePoints(trace, asEye) {
    const radii = trace.radii || (trace.series && (trace.series.R || trace.series.S)) || [];
    const angles = trace.angles || (trace.series && (trace.series.A || trace.series.SA)) || [];
    const n = radii.length;
    const mirror = asEye && asEye !== trace.eye && (trace.eye === 'R' || trace.eye === 'L');
    const pts = radii.map((r, i) => {
      let a = trace.equi ? (i * 360) / n : angles[i] / 100;
      if (mirror) a = (540 - a) % 360;
      const t = (a * Math.PI) / 180, mm = r / 100;
      return { a, r: mm, x: mm * Math.cos(t), y: mm * Math.sin(t) };
    });
    return mirror ? pts.reverse() : pts;
  }

  /** 点列の外接箱（HBOX・VBOX と箱中心） */
  function boxOf(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { hbox: x1 - x0, vbox: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /** 点列の周長（2 次元） */
  function circumference(points) {
    let c = 0;
    points.forEach((p, i) => { const q = points[(i + 1) % points.length]; c += Math.hypot(q.x - p.x, q.y - p.y); });
    return c;
  }

  // ---- 書き出し ---------------------------------------------------------------
  /**
   * 玉型などのデータセットをレコードの配列にする（[label, field...] の形。buildPacket に渡せる）。
   * opts: { header: 'TRCFMT', fmt: 1〜4, eye: 'R', object: 'F', values: [...], angles: [...], mode }
   * 形式 1 は 1 行 80 文字以内に分ける（5.4.15.1）。形式 2〜4 はエスケープ済みの 1 レコードにする。
   */
  function datasetRecords(opts) {
    const header = opts.header || 'TRCFMT', spec = DATASETS[header];
    if (!spec || spec.type !== 'trace') throw new Error(`datasetRecords: ${header} は玉型系のデータセットではありません`);
    const fmt = opts.fmt || 1, values = opts.values || [], angles = opts.angles;
    const mode = opts.mode || (angles ? 'U' : 'E');
    const head = [header, String(fmt), String(values.length), mode, opts.eye || 'R'];
    if (header === 'TRCFMT' || header === 'ZFMT') head.push(opts.object || 'F');
    else if (header === 'SHLFFMT') head.push(opts.reference || 'B');
    const out = [head];
    function series(label, vals) {
      if (fmt === 1) {
        let cur = [];
        vals.forEach(v => {
          const s = String(Math.round(v));
          if ((label + '=' + cur.concat([s]).join(';')).length > 80) { out.push([label].concat(cur)); cur = []; }
          cur.push(s);
        });
        if (cur.length) out.push([label].concat(cur));
      } else out.push([label, escapeBinary(encodeBinary(fmt, vals))]);
    }
    series(spec.series[0], values);
    if (mode !== 'E') {
      if (!angles || angles.length !== values.length) throw new Error('datasetRecords: 角度の個数が値と一致しません');
      series(spec.series[1], angles);
    }
    return out;
  }

  /**
   * パケットを組み立てる。records は [label, field1, field2, ...] の配列。
   * CRC は開始文字の直後から RS までの全文字で計算する。
   */
  function buildPacket(records, opts) {
    const withCrc = opts && opts.crc;
    const body = records.map(r => r[0] + '=' + r.slice(1).join(';') + '\r\n').join('');
    let pkt = CH.FS + body + CH.RS;
    if (withCrc) pkt += 'CRC=' + crc16(body + CH.RS) + '\r\n';
    return pkt + CH.GS;
  }

  /**
   * パケットを分解して CRC を検証する。
   * crcOk は、CRC レコードが無ければ null（CRC は省略できるため）、
   * 値が一致すれば true、一致しない・値が数字でない場合は false。
   * CRC を必須とするかどうかは呼び出し側で判断する。
   */
  function parsePacket(pkt) {
    const s = pkt.indexOf(CH.FS), e = pkt.lastIndexOf(CH.GS);
    if (s < 0 || e < s) throw new Error('FS と GS で囲まれたパケットが見つかりません');
    const inner = pkt.slice(s + 1, e), r = inner.lastIndexOf(CH.RS);
    const body = r >= 0 ? inner.slice(0, r) : inner;
    let crcOk = null;
    if (r >= 0) {
      const m = inner.slice(r + 1).match(/CRC\s*=([^\r\n]*)/);
      if (m) {
        const v = m[1].trim();
        crcOk = /^\d+$/.test(v) && crc16(inner.slice(0, r + 1)) === +v;
      }
    }
    const data = parse(body);
    checkOrder(data).forEach(msg => data.warnings.push(msg));
    return Object.assign(data, { crcOk });
  }

  // ---- コード表（附属書 A。訳は要約） ---------------------------------------------
  const STATUS = {
    0: 'エラーなし', 1: 'ジョブが見つからない', 2: 'ジョブが保護されていて保存できない',
    3: '一般エラー（内容は説明欄）', 4: 'この機器向けには処理できないジョブ', 5: '初期化が必要',
    6: 'ジョブ ID が不正', 7: 'レコードが不足（説明欄にラベル名）', 8: 'ホスト内部エラー',
    9: '機器とホストの組み合わせが非互換', 10: '値が範囲外（説明欄にラベル名）', 11: '受信側がビジー',
    12: '同期ずれ（セッション中止）', 13: '初期化パケットが不正', 14: '自動フォーマット初期化に非対応（プリセットなら可）',
    15: '初期化に非対応', 16: '要求種別が不明', 17: '非対応のトレース形式', 18: '書式エラー（規格どおりに解析できない）',
    19: '処理失敗（INF 要求で使う）', 20: 'TOKEN が不正（追加課金なしでは処理できない）',
    21: '契約切れ、または前払いの利用回数を使い切った', 30: '機器状態の警告（MNT）', 31: '機器状態のエラー（MNT）',
  };
  // ステータス 17 に足す修飾ビット（表 A.25）
  const STATUS_MODIFIERS = { 256: '提案されたトレース形式がどれも使えない', 512: '提案された点数がどれも使えない',
    1024: '提案された角度モードがどれも使えない' };
  /** ステータスコードを本体と修飾ビットに分ける（例: 17+512 → {code:17, modifiers:[512]}） */
  function statusInfo(code) {
    const c = +code, base = c & 0xff, mods = [];
    [256, 512, 1024].forEach(b => { if (c & b) mods.push(b); });
    return { code: base, text: STATUS[base], modifiers: mods, modifierText: mods.map(b => STATUS_MODIFIERS[b]) };
  }
  // XSTATUS の標準コード（表 A.26、ホストからレンズ設計システムへの通知）
  const XSTATUS_CODES = {
    100: 'ジョブ完了', 101: '保証による再作成', 102: 'ラボでの破損', 103: '顧客都合の再作成（処方変更など）',
    104: '顧客による破損', 105: 'ラボでの再作成・再計算', 106: 'ジョブ取消', 107: '出荷済み',
    108: 'ジェネレーターに呼び出し', 109: '外注（取消扱い）', 110: 'ジョブ遅延',
  };
  // 要求種別（表 A.3）と機器の種類（表 A.4）
  const REQUEST_TYPES = {
    INI: '初期化', TRC: 'トレーサーの玉型送信', PTG: '型板加工機へのデータ', EDG: '加工機（エッジャー）へのデータ',
    SBK: '表面加工用ブロッカーへのデータ', FBK: '玉型加工用ブロッカーへのデータ', AGN: 'ラミネーターへのデータ',
    BAS: 'ブランク選択の応答', BRS: 'ブランク選択の要求', CMD: 'コマンド要求', COA: 'コーターへのデータ',
    CON: 'ネットワーク接続の要求', DNL: '汎用ダウンロード', DRL: '穴あけ機へのデータ', ENG: '刻印機へのデータ',
    ERR: 'エラー応答', FSG: 'フリーフォーム切削機へのデータ', FSP: 'フリーフォーム研磨機へのデータ',
    GEN: 'カーブジェネレーターへのデータ', INF: '作業状況の通知', INK: 'インク印字機へのデータ',
    INS: '検査機器からの測定結果', LAP: 'ラップ供給装置へのデータ', LDI: 'LDS 初期化ファイル',
    LDS: 'レンズ設計システムへのデータ', LMD: 'レンズメーターへのデータ', LMI: 'LMS 初期化ファイル',
    LMS: 'レンズ設計システムからの結果', LNF: 'レンズ情報の要求', MNT: '保守情報の送信', POL: '研磨機へのデータ',
    SDF: '面形状定義ファイル', TIM: '時刻合わせの要求', UPL: '汎用アップロード',
  };
  const DEVICE_TYPES = {
    TRC: 'フレームトレーサー', PTG: '型板加工機', EDG: '玉型加工機（エッジャー）', SBK: '表面加工用ブロッカー',
    FBK: '玉型加工用ブロッカー', GEN: 'カーブジェネレーター', AGN: 'ラミネーター', UPL: '汎用アップロード機器',
    DNL: '汎用ダウンロード機器', COA: 'コーター', FSG: 'フリーフォーム切削機', LMD: 'レンズメーター', FIL: 'ファイル',
    INS: '検査機器', LAP: 'ラップ供給装置', DRL: '穴あけ機', FSP: 'フリーフォーム研磨機', POL: '研磨機',
    ENG: '刻印機', INK: 'インク印字機',
  };

  return {
    CH, crc16, bytesToString, escapeBinary, unescapeBinary, decodeBinary, encodeBinary,
    parse, sideValue, sideNumber, value, number, fieldsOf, occurrences, subValues, checkOrder,
    defineRecords, recordDef, drillFeatures, mirrorFeature, drillRecords, deviceRecords, autoFormatDefinitions,
    presetRecords, missingPresetRecords, tracePoints, boxOf, circumference, datasetRecords,
    buildPacket, parsePacket, STATUS, STATUS_MODIFIERS, statusInfo, XSTATUS_CODES, REQUEST_TYPES, DEVICE_TYPES,
    version: TABLE ? TABLE.version : null,
    labels: () => Object.keys(DEFS).sort(),
  };
});
