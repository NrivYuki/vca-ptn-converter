/*
 * vca-parser.js — VCA / OMA（DCS）データの読み書きヘルパー
 *
 * 参照: The Vision Council "Data Communication Standard" v3.14
 * 規格本文の転載ではなく、仕様を読んで独自に実装したものです。
 * MIT License
 *
 * ブラウザでは <script src="vca-parser.js"> で window.VCA に、
 * Node.js では require('./vca-parser.js') で読み込める書き方にしています（動作確認はブラウザのみ）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
  // バイナリレコード中でエスケープが必要な予約制御文字
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

  // ---- トレースのバイナリ形式（形式 2・3） -------------------------------------
  // 16 ビット値は下位バイトが先（リトルエンディアン）。
  // データが途中で切れている場合は、壊れた値を返さずに例外を投げる。
  function decodeBinary(fmt, s) {
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
    } else throw new Error('encodeBinary: 形式 ' + fmt + ' は未対応です');
    return s;
  }

  // ---- レコードの解析 -------------------------------------------------------
  const LABEL_RE = /^[\s\x1c\x1d\x1e\x1a]*\*?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/;

  function splitFields(value) {
    // 値の区切りは ";"。v3.03 より前は文字列を "" で囲むことがある。
    return value.split(';').map(v => v.trim().replace(/^"([\s\S]*)"$/, '$1'));
  }

  /**
   * VCA テキスト（ファイルやパケット本体）を解析する。
   * 文字列は 1 文字 = 1 バイトで渡すこと（バイナリ形式を含む場合）。
   * @returns {{records: {label:string, fields:string[]}[], rec: Object<string,string[]>,
   *            traces: object[], errors: string[], warnings: string[]}}
   */
  function parse(text) {
    const records = [], rec = {}, traces = [], errors = [], warnings = [];
    let cur = null, sag = null;          // 直前の TRCFMT / ZFMT
    for (const line of text.split(/\r\n|\r|\n/)) {
      const m = line.match(LABEL_RE);
      if (!m) continue;
      const label = m[1].toUpperCase(), raw = m[2];

      // トレース関連（順序に意味があるデータセット）
      if (label === 'TRCFMT') {
        const [fmt, n, mode, eye, kind] = splitFields(raw);
        sag = null;
        if (+fmt === 0) { cur = null; warnings.push('トレースデータなし（TRCFMT=0）'); continue; }
        cur = { fmt: +fmt, n: +n, mode: (mode || 'E').toUpperCase(), eye: (eye || 'R').toUpperCase(),
                kind: (kind || '').toUpperCase(), radii: [], angles: [], raw: { R: '', A: '' }, sag: null };
        cur.equi = cur.mode === 'E';
        traces.push(cur);
        continue;
      }
      if (label === 'ZFMT') {
        const [fmt, n, mode, eye, kind] = splitFields(raw);
        sag = null;
        if (cur && +fmt !== 0) {
          sag = { fmt: +fmt, n: +n, mode: (mode || 'E').toUpperCase(), eye: (eye || 'R').toUpperCase(),
                  kind: (kind || '').toUpperCase(), values: [], angles: [], raw: { Z: '', ZA: '' } };
          sag.equi = sag.mode === 'E';
          cur.sag = sag;
        }
        continue;
      }
      if ((label === 'R' || label === 'A') && cur && !sag) {
        if (cur.fmt === 1) splitFields(raw).forEach(v => { if (v !== '') (label === 'R' ? cur.radii : cur.angles).push(+v); });
        else cur.raw[label] += raw;
        continue;
      }
      if ((label === 'Z' || label === 'ZA') && sag) {
        if (sag.fmt === 1) splitFields(raw).forEach(v => { if (v !== '') (label === 'Z' ? sag.values : sag.angles).push(+v); });
        else sag.raw[label] += raw;
        continue;
      }

      // 通常のレコード
      const fields = splitFields(raw);
      records.push({ label, fields });
      rec[label] = fields;
    }

    // バイナリ形式の復元と検証。玉型（TRCFMT の R・A）とサグ（ZFMT の Z・ZA）を同じ手順で扱う。
    function finish(d, head, vLabel, aLabel, vKey) {
      if (d.fmt === 2 || d.fmt === 3) {
        try { d[vKey] = decodeBinary(d.fmt, unescapeBinary(d.raw[vLabel])); }
        catch (e) { errors.push(`${vLabel}: ${e.message}（${d.eye}）`); d[vKey] = []; return; }
        if (!d.equi) {
          try { d.angles = decodeBinary(d.fmt, unescapeBinary(d.raw[aLabel])); }
          catch (e) { errors.push(`${aLabel}: ${e.message}（${d.eye}）`); d.angles = []; return; }
        }
      } else if (d.fmt !== 1) {
        errors.push(`${head} 形式${d.fmt} は未対応です（対応: 1, 2, 3）`);
        return;
      }
      const vals = d[vKey];
      if (d.n && vals.length !== d.n) warnings.push(`${head} の点数 ${d.n} と ${vLabel} の個数 ${vals.length} が一致しません（${d.eye}）`);
      if (!d.equi && d.angles.length !== vals.length) errors.push(`角度データ ${aLabel} の個数が ${vLabel} と一致しません（${d.eye}）`);
      if (vals.some(v => !Number.isFinite(v))) errors.push(`${vLabel} に数値以外の値があります（${d.eye}）`);
    }
    traces.forEach(t => {
      finish(t, 'TRCFMT', 'R', 'A', 'radii');
      if (t.sag) finish(t.sag, 'ZFMT', 'Z', 'ZA', 'values');
    });
    if (!traces.length && !warnings.length) warnings.push('TRCFMT レコードがありません');
    return { records, rec, traces, errors, warnings };
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
   * トレースを座標点の列にする（単位 mm、角度は度）。
   * 向きは「検者が装用者を正面から見た状態」。x 右、y 上、0° は 3 時方向、反時計回り。
   * asEye を指定すると、その眼の向きに左右反転して返す。
   * 反転した点列は角度の小さい順（反時計回り）に並べ直すが、先頭は 0° とは限らない。
   * 描画や寸法の計算にはそのまま使えるが、R レコードに書き戻すときは 0° から並べ直すこと。
   */
  function tracePoints(trace, asEye) {
    const n = trace.radii.length;
    const mirror = asEye && asEye !== trace.eye && (trace.eye === 'R' || trace.eye === 'L');
    const pts = trace.radii.map((r, i) => {
      let a = trace.equi ? (i * 360) / n : trace.angles[i] / 100;
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

  // ---- パケット -------------------------------------------------------------
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
    return Object.assign(parse(body), { crcOk });
  }

  // ---- ステータスコード（要約） ------------------------------------------------
  const STATUS = {
    0: 'エラーなし', 1: 'ジョブが見つからない', 2: 'ジョブが保護されていて保存できない',
    3: '一般エラー（内容は説明欄）', 4: 'この機器向けには処理できないジョブ', 5: '初期化が必要',
    6: 'ジョブ ID が不正', 7: 'レコードが不足（説明欄にラベル名）', 8: 'ホスト内部エラー',
    9: '機器とホストの組み合わせが非互換', 10: '値が範囲外（説明欄にラベル名）', 11: '受信側がビジー',
    12: '同期ずれ（セッション中止）', 13: '初期化パケットが不正', 14: '自動フォーマット初期化に非対応（プリセットなら可）',
    15: '初期化に非対応', 16: '要求種別が不明', 17: '非対応のトレース形式',
  };

  return {
    CH, crc16, bytesToString, escapeBinary, unescapeBinary, decodeBinary, encodeBinary,
    parse, sideValue, sideNumber, tracePoints, boxOf, circumference, buildPacket, parsePacket, STATUS,
  };
});
