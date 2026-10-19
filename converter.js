/*
 * converter.js — vca-ptn Converter の変換処理
 *
 * VCA（OMA / DCS）・JOB・PTN・SVG・DXF の間で玉形（レンズの外形）を変換する。
 * JOB / PTN は「中身が VCA テキストのもの」だけを扱う（機器が書き出す独自形式は非公開のため扱えない）。
 * JOB / PTN の扱いは、OptiBoard の OMA 関連スレッドと公開されている取扱説明書の情報だけに基づく。
 * MIT License
 *
 * 依存: vca-parser.js（window.VCA）
 * SVG の読み込み（fromSVG）だけはブラウザの DOM が必要。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vca-parser.js'));
  else root.Converter = factory(root.VCA);
})(typeof self !== 'undefined' ? self : this, function (VCA) {
  'use strict';

  /*
   * 玉形セット（このファイルの中の共通の形）
   *   { eyes: { R?: Outline, L?: Outline }, dbl, job, rec, records, hasSag, unitScale, unitNote, warnings, errors }
   *   （rec・records・hasSag は VCA から、unitScale・unitNote は SVG / DXF から読み込んだときだけ）
   *   Outline: { pts: [{x, y}] }  単位 mm、検者が装用者を正面から見た向き（x 右、y 上）。
   *   pts は閉じた輪郭（最後の点から最初の点へ戻る）。
   */

  const EYES = ['R', 'L'];

  // ---- 入力の種類の判定 -------------------------------------------------------
  /**
   * 文字列（1 文字 = 1 バイト）とファイル名から種類を判定する。
   * @returns {'vca'|'svg'|'dxf'|'unknown'}
   */
  function detect(s, name) {
    const ext = ((name || '').match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    const head = s.slice(0, 8192);
    if (ext === 'svg' || /<svg[\s>]/i.test(head)) return 'svg';
    if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION\s*\r?$/m.test(head)) return 'dxf';
    if (/^[\s\x1c\x1d\x1e]*\*?(REQ|ANS|JOB|TRCFMT)\s*=/im.test(s)) return 'vca';
    return 'unknown';
  }

  /** 表示できない文字（制御文字など）の割合。VCA テキストかどうかの目安に使う。 */
  function binaryRatio(s) {
    const n = Math.min(s.length, 8192);
    if (!n) return 0;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) bad++;
    }
    return bad / n;
  }

  // ---- 共通の計算 -------------------------------------------------------------
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function bbox(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  function area(pts) {
    let a = 0;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; });
    return a / 2;
  }

  /** 外形の寸法（HBOX・VBOX・周長、mm） */
  function measure(pts) {
    const b = bbox(pts);
    return { hbox: b.w, vbox: b.h, circ: VCA.circumference(pts), cx: b.cx, cy: b.cy };
  }

  /** 箱の中心が原点に来るように移動する（VCA の半径の基準は箱の中心） */
  function centered(pts) {
    const b = bbox(pts);
    return pts.map(p => ({ x: p.x - b.cx, y: p.y - b.cy }));
  }

  /** 左右反転（右眼の形から左眼の形を作る）。正面視なので x の符号を反転する。 */
  function mirror(pts) {
    return pts.map(p => ({ x: -p.x, y: p.y })).reverse();
  }

  /** 片眼しかないとき、反対の眼を左右反転して作る */
  function fillMirror(set) {
    const out = Object.assign({}, set, { eyes: Object.assign({}, set.eyes) });
    if (out.eyes.R && !out.eyes.L) out.eyes.L = { pts: mirror(out.eyes.R.pts), mirrored: true };
    else if (out.eyes.L && !out.eyes.R) out.eyes.R = { pts: mirror(out.eyes.L.pts), mirrored: true };
    return out;
  }

  /**
   * 外形を等角度の半径に測り直す。
   * 原点から角度ごとに線を伸ばし、輪郭と交わる点までの距離を半径とする。
   * 原点は呼び出し側で決める（SVG / DXF は読み込み時に箱の中心へ移している。VCA は元の基準点のまま）。
   * 1 本の線が輪郭と 2 回以上交わる（内側にえぐれた形）ときは、いちばん外側を使い、件数を返す。
   * @returns {{radii: number[], multi: number, miss: number}} radii は mm
   */
  function resample(pts, n) {
    const q = pts, radii = [];
    let multi = 0, miss = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, dx = Math.cos(a), dy = Math.sin(a);
      const hits = [];
      for (let j = 0; j < q.length; j++) {
        const p = q[j], r = q[(j + 1) % q.length];
        const ex = r.x - p.x, ey = r.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = (p.x * ey - p.y * ex) / den;   // 線の上の距離
        const u = (p.x * dy - p.y * dx) / den;   // 辺の上の位置（0〜1）
        // 頂点にちょうど当たる線を取りこぼさないよう、両端に少し余裕を持たせる
        if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
      }
      if (!hits.length) { miss++; radii.push(radii.length ? radii[radii.length - 1] : 0); continue; }
      hits.sort((s, t) => s - t);
      if (hits[hits.length - 1] - hits[0] > 1e-4) multi++;
      radii.push(hits[hits.length - 1]);
    }
    return { radii, multi, miss };
  }

  /** 等角度の半径（mm）を座標に戻す */
  function radiiToPoints(radii) {
    const n = radii.length;
    return radii.map((r, i) => {
      const a = (2 * Math.PI * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }

  // ---- VCA の読み込み ---------------------------------------------------------
  /** VCA テキスト（.oma / .vca / 中身が VCA の .job / .ptn）を玉形セットにする */
  function fromVCA(text) {
    const d = VCA.parse(text);
    const set = {
      eyes: {}, rec: d.rec, records: d.records, errors: d.errors.slice(), warnings: d.warnings.slice(),
      job: VCA.sideValue(d.rec.JOB, 'R'), dbl: VCA.sideNumber(d.rec.DBL, 'R'), hasSag: false,
    };
    for (const t of d.traces) {
      if (!t.radii.length) continue;
      const eye = t.eye === 'L' ? 'L' : 'R';
      if (t.eye !== 'R' && t.eye !== 'L') set.warnings.push(`TRCFMT の眼が「${t.eye}」なので、右眼として扱います`);
      if (set.eyes[eye]) { set.warnings.push(`${eye} の玉形が複数あります。最初のものを使います`); continue; }
      if (t.sag) set.hasSag = true;
      const pts = VCA.tracePoints(t).map(p => ({ x: p.x, y: p.y }));
      // 規格では半径の基準は箱の中心。ずれていても元の基準点のまま扱い、ずれ量だけ知らせる。
      const b = bbox(pts), off = Math.hypot(b.cx, b.cy);
      if (off > 0.05) set.warnings.push(`${eye}：半径の基準点が箱の中心から ${off.toFixed(2)} mm ずれています（元の基準点のまま変換します）`);
      set.eyes[eye] = { pts, n: t.radii.length, mode: t.mode, fmt: t.fmt, kind: t.kind };
    }
    if (!set.eyes.R && !set.eyes.L) set.errors.push('玉形（TRCFMT と R）が見つかりません');
    return set;
  }

  // ---- 輪郭の整理（SVG / DXF 共通） --------------------------------------------
  /**
   * 開いた線分の列をつないで閉じた輪郭を作る。
   * @param pieces [{pts, closed}]
   * @param tol    つなぐときの許容距離
   */
  function chain(pieces, tol) {
    const closed = [], open = [];
    pieces.forEach(p => {
      if (p.pts.length < 2) return;
      if (p.closed || (p.pts.length > 2 && dist(p.pts[0], p.pts[p.pts.length - 1]) <= tol)) closed.push(trimEnd(p.pts, tol));
      else open.push(p.pts.slice());
    });
    let openLeft = 0;
    while (open.length) {
      let cur = open.shift(), grown = true;
      while (grown && dist(cur[0], cur[cur.length - 1]) > tol) {
        grown = false;
        const end = cur[cur.length - 1];
        for (let i = 0; i < open.length; i++) {
          const o = open[i];
          if (dist(end, o[0]) <= tol) cur = cur.concat(o.slice(1));
          else if (dist(end, o[o.length - 1]) <= tol) cur = cur.concat(o.slice(0, -1).reverse());
          else continue;
          open.splice(i, 1); grown = true; break;
        }
      }
      if (cur.length > 2 && dist(cur[0], cur[cur.length - 1]) <= tol) closed.push(trimEnd(cur, tol));
      else openLeft++;
    }
    return { closed, openLeft };
  }

  function trimEnd(pts, tol) {
    return pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= tol ? pts.slice(0, -1) : pts;
  }

  /**
   * 閉じた輪郭の中から玉形を選ぶ。
   * いちばん大きい輪郭を玉形とし、同じくらいの大きさで重ならない輪郭がもう 1 つあれば両眼とみなす。
   * 両眼のときは、正面視で左にあるほうが右眼。
   */
  function pickEyes(contours, singleEye) {
    const list = contours
      .filter(c => c.length >= 3)
      .map(c => ({ pts: c, a: Math.abs(area(c)), b: bbox(c) }))
      .filter(c => c.a > 0)
      .sort((s, t) => t.a - s.a);
    const set = { eyes: {}, warnings: [], errors: [], dbl: undefined };
    if (!list.length) { set.errors.push('閉じた輪郭が見つかりません'); return set; }
    const first = list[0], second = list[1];
    const apart = second && (second.b.x0 > first.b.x1 || second.b.x1 < first.b.x0);
    if (second && second.a >= first.a * 0.5 && apart) {
      const [right, left] = first.b.cx < second.b.cx ? [first, second] : [second, first];
      set.eyes.R = { pts: centered(right.pts) };
      set.eyes.L = { pts: centered(left.pts) };
      set.dbl = left.b.x0 - right.b.x1;
      if (list.length > 2) set.warnings.push(`玉形以外の輪郭 ${list.length - 2} 個（穴など）は使いません`);
    } else {
      set.eyes[singleEye === 'L' ? 'L' : 'R'] = { pts: centered(first.pts) };
      if (list.length > 1) set.warnings.push(`いちばん大きい輪郭を玉形として使います。ほかの輪郭 ${list.length - 1} 個（穴など）は使いません`);
    }
    return set;
  }

  // ---- DXF の読み込み ---------------------------------------------------------
  const DXF_UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

  /**
   * DXF（ASCII）から外形を読み込む。
   * 対応: LWPOLYLINE・POLYLINE（ふくらみ付きの円弧も）・LINE・ARC・CIRCLE・ELLIPSE・SPLINE。
   * @param opts {scale?: number（1 単位あたりの mm。省略時は $INSUNITS、なければ 1）, singleEye?: 'R'|'L'}
   */
  function fromDXF(text, opts) {
    opts = opts || {};
    const lines = text.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      if (Number.isNaN(code)) continue;
      pairs.push([code, lines[i + 1].trim()]);
    }

    // 単位（HEADER の $INSUNITS）
    let unitScale = null, unitNote = '';
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS' && pairs[i + 1]) {
        unitScale = DXF_UNITS[+pairs[i + 1][1]] || null;
        break;
      }
    }
    if (opts.scale) { unitScale = opts.scale; unitNote = '指定された縮尺を使います'; }
    else if (unitScale) unitNote = '$INSUNITS から単位を読み取りました';
    else { unitScale = 1; unitNote = '単位の指定がないため、1 単位 = 1 mm とみなします'; }

    // ENTITIES セクションの図形を取り出す
    const ents = [];
    let inEnt = false, cur = null;
    for (let i = 0; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0 && v === 'SECTION' && pairs[i + 1] && pairs[i + 1][1] === 'ENTITIES') { inEnt = true; i++; continue; }
      if (!inEnt) continue;
      if (c === 0) {
        if (v === 'ENDSEC') { inEnt = false; cur = null; continue; }
        cur = { type: v, g: [] };
        ents.push(cur);
      } else if (cur) cur.g.push([c, v]);
    }

    const warnings = [], pieces = [];
    const num = (e, code, def) => { const f = e.g.find(p => p[0] === code); return f ? parseFloat(f[1]) : def; };
    const all = (e, code) => e.g.filter(p => p[0] === code).map(p => parseFloat(p[1]));
    const skipped = {};

    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      switch (e.type) {
        case 'LWPOLYLINE': {
          const verts = [];
          for (const [c, v] of e.g) {
            if (c === 10) verts.push({ x: +v, y: 0, b: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].y = +v;
            else if (c === 42 && verts.length) verts[verts.length - 1].b = +v;
          }
          const closed = (num(e, 70, 0) & 1) === 1;
          pieces.push({ pts: bulgePolyline(verts, closed), closed });
          break;
        }
        case 'POLYLINE': {
          const flags = num(e, 70, 0), verts = [];
          if (flags & (16 | 64)) { skipped['POLYLINE（メッシュ）'] = (skipped['POLYLINE（メッシュ）'] || 0) + 1; }
          while (ents[i + 1] && ents[i + 1].type === 'VERTEX') {
            const v = ents[++i];
            verts.push({ x: num(v, 10, 0), y: num(v, 20, 0), b: num(v, 42, 0) });
          }
          if (ents[i + 1] && ents[i + 1].type === 'SEQEND') i++;
          if (flags & (16 | 64)) break;
          const closed = (flags & 1) === 1;
          pieces.push({ pts: bulgePolyline(verts, closed), closed });
          break;
        }
        case 'LINE':
          pieces.push({ pts: [{ x: num(e, 10, 0), y: num(e, 20, 0) }, { x: num(e, 11, 0), y: num(e, 21, 0) }], closed: false });
          break;
        case 'ARC': {
          const cx = num(e, 10, 0), cy = num(e, 20, 0), r = num(e, 40, 0);
          let a0 = num(e, 50, 0), a1 = num(e, 51, 360);
          if (a1 <= a0) a1 += 360;
          pieces.push({ pts: arcPoints(cx, cy, r, a0 * Math.PI / 180, (a1 - a0) * Math.PI / 180), closed: false });
          break;
        }
        case 'CIRCLE': {
          const pts = arcPoints(num(e, 10, 0), num(e, 20, 0), num(e, 40, 0), 0, 2 * Math.PI);
          pts.pop();
          pieces.push({ pts, closed: true });
          break;
        }
        case 'ELLIPSE': {
          const cx = num(e, 10, 0), cy = num(e, 20, 0), mx = num(e, 11, 1), my = num(e, 21, 0);
          const ratio = num(e, 40, 1), t0 = num(e, 41, 0);
          let t1 = num(e, 42, 2 * Math.PI);
          if (t1 <= t0) t1 += 2 * Math.PI;
          const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
          const steps = Math.max(64, Math.ceil((t1 - t0) / (2 * Math.PI) * 720)), pts = [];
          for (let k = 0; k <= steps; k++) {
            const t = t0 + ((t1 - t0) * k) / steps, c = Math.cos(t), s = Math.sin(t);
            pts.push({ x: cx + mx * c - my * ratio * s, y: cy + my * c + mx * ratio * s });
          }
          if (full) pts.pop();
          pieces.push({ pts, closed: full });
          break;
        }
        case 'SPLINE': {
          const pts = splinePoints(e, all, num);
          if (pts.length > 1) pieces.push({ pts, closed: (num(e, 70, 0) & 1) === 1 });
          break;
        }
        case 'INSERT':
          warnings.push('ブロック参照（INSERT）の中の図形は読み込みません。図形を分解してから保存してください');
          break;
        default:
          skipped[e.type] = (skipped[e.type] || 0) + 1;
      }
    }
    const sk = Object.keys(skipped).filter(k => !/^(TEXT|MTEXT|DIMENSION|POINT|HATCH|LEADER|VIEWPORT)$/.test(k));
    if (sk.length) warnings.push('読み込まなかった図形：' + sk.map(k => `${k} ×${skipped[k]}`).join('、'));

    const scaled = pieces.map(p => ({ closed: p.closed, pts: p.pts.map(q => ({ x: q.x * unitScale, y: q.y * unitScale })) }));
    return finishContours(scaled, opts, warnings, { unitScale, unitNote });
  }

  /** ふくらみ（bulge）付きの頂点列を点列にする */
  function bulgePolyline(verts, closed) {
    const pts = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const p = verts[i], q = verts[(i + 1) % n];
      pts.push({ x: p.x, y: p.y });
      if (!closed && i === n - 1) break;
      if (p.b) {
        const th = 4 * Math.atan(p.b), dx = q.x - p.x, dy = q.y - p.y, c = Math.hypot(dx, dy);
        if (c < 1e-12) continue;
        const r = c / (2 * Math.sin(th / 2)), h = r * Math.cos(th / 2);
        const cx = (p.x + q.x) / 2 - (h * dy) / c, cy = (p.y + q.y) / 2 + (h * dx) / c;
        const a0 = Math.atan2(p.y - cy, p.x - cx);
        const arc = arcPoints(cx, cy, Math.abs(r), a0, th);
        pts.push(...arc.slice(1, -1));
      }
    }
    return pts;
  }

  /** 円弧を点列にする（sweep は反時計回りが正、ラジアン） */
  function arcPoints(cx, cy, r, a0, sweep) {
    const steps = Math.max(8, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * 720)), pts = [];
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (sweep * k) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  /** SPLINE（NURBS）を点列にする。ノットがないときは通過点（11/21）か制御点をそのままつなぐ。 */
  function splinePoints(e, all, num) {
    const deg = num(e, 71, 3), knots = all(e, 40), weights = all(e, 41);
    const cx = all(e, 10), cy = all(e, 20), fx = all(e, 11), fy = all(e, 21);
    const ctrl = cx.map((x, i) => ({ x, y: cy[i] || 0 }));
    if (ctrl.length > deg && knots.length === ctrl.length + deg + 1) {
      const w = weights.length === ctrl.length ? weights : ctrl.map(() => 1);
      const t0 = knots[deg], t1 = knots[ctrl.length], steps = Math.max(200, ctrl.length * 40), pts = [];
      for (let k = 0; k <= steps; k++) pts.push(deBoor(deg, ctrl, w, knots, t0 + ((t1 - t0) * k) / steps));
      return pts;
    }
    if (fx.length > 1) return fx.map((x, i) => ({ x, y: fy[i] || 0 }));
    return ctrl;
  }

  function deBoor(p, ctrl, w, U, t) {
    const n = ctrl.length - 1;
    let k = p;
    while (k < n && t >= U[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j], wj = w[k - p + j];
      d.push({ x: c.x * wj, y: c.y * wj, w: wj });
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j, den = U[i + p - r + 1] - U[i];
        const a = den === 0 ? 0 : (t - U[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    }
    return { x: d[p].x / d[p].w, y: d[p].y / d[p].w };
  }

  /** 読み込んだ線をつないで玉形を選ぶ（SVG / DXF 共通の後半） */
  function finishContours(pieces, opts, warnings, info) {
    const all = [].concat(...pieces.map(p => p.pts));
    if (!all.length) return { eyes: {}, warnings, errors: ['図形が見つかりません'], ...info };
    const b = bbox(all), tol = Math.max(1e-4, Math.hypot(b.w, b.h) * 1e-5) * 10;
    const { closed, openLeft } = chain(pieces, tol);
    if (openLeft) warnings.push(`閉じていない線が ${openLeft} 本あり、使いません`);
    const set = pickEyes(closed, opts.singleEye);
    set.warnings = warnings.concat(set.warnings);
    return Object.assign(set, info);
  }

  // ---- SVG の読み込み（ブラウザのみ） ---------------------------------------------
  const MM_PER = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 };

  function parseLength(s) {
    const m = String(s || '').trim().match(/^([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([a-z%]*)$/i);
    return m ? { v: parseFloat(m[1]), unit: m[2].toLowerCase() } : null;
  }

  /** SVG の 1 単位が何 mm かを、width / height と viewBox から求める */
  function svgUnitScale(svg) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const w = parseLength(svg.getAttribute('width')), h = parseLength(svg.getAttribute('height'));
    const hasVb = vb && vb.width > 0 && vb.height > 0;
    const pick = (len, vbLen) => {
      if (!len || !(len.unit in MM_PER) && len.unit !== '') return null;
      if (len.unit === '' ) return null;
      return hasVb ? (len.v * MM_PER[len.unit]) / vbLen : MM_PER[len.unit];
    };
    const s = pick(w, hasVb ? vb.width : 0) || pick(h, hasVb ? vb.height : 0);
    if (s) return { unitScale: s, unitNote: 'width / height と viewBox から単位を読み取りました' };
    return { unitScale: 1, unitNote: '単位（mm など）の指定がないため、1 単位 = 1 mm とみなします' };
  }

  /**
   * SVG から外形を読み込む。曲線はブラウザの getPointAtLength で点列にする。
   * @param opts {scale?: number（1 単位あたりの mm）, singleEye?: 'R'|'L', doc?: Document}
   */
  function fromSVG(text, opts) {
    opts = opts || {};
    const doc = opts.doc || document;
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.nodeName.toLowerCase() !== 'svg') {
      return { eyes: {}, warnings: [], errors: ['SVG として読み込めません'] };
    }
    const host = doc.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden';
    const svg = doc.importNode(parsed.documentElement, true);
    host.appendChild(svg);
    doc.body.appendChild(host);
    try {
      const info = svgUnitScale(svg);
      if (opts.scale) { info.unitScale = opts.scale; info.unitNote = '指定された縮尺を使います'; }
      const k = info.unitScale;
      const rootInv = svg.getCTM() ? svg.getCTM().inverse() : null;
      const pieces = [], warnings = [];
      const els = svg.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line');
      for (const el of els) {
        if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) continue;
        if (typeof el.getTotalLength !== 'function') continue;
        const total = el.getTotalLength();
        if (!(total > 0)) continue;
        const ctm = el.getCTM(), m = rootInv && ctm ? rootInv.multiply(ctm) : null;
        const step = Math.min(0.05 / k, total / 64);
        const steps = Math.min(40000, Math.ceil(total / step));
        const tag = el.nodeName.toLowerCase();
        const shapeClosed = /^(polygon|rect|circle|ellipse)$/.test(tag);
        let pts = [], prev = null;
        const flush = closedHint => {
          if (pts.length > 1) pieces.push({ pts, closed: closedHint });
          pts = [];
        };
        for (let i = 0; i <= steps; i++) {
          let p = el.getPointAtLength((total * i) / steps);
          if (m) p = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
          const q = { x: p.x * k, y: -p.y * k };   // SVG は y が下向きなので反転する
          // サブパスの切れ目（移動）では点が飛ぶので、そこで分ける
          if (prev && dist(prev, q) > (total / steps) * k * 4 + 1e-6) flush(false);
          pts.push(q); prev = q;
        }
        if (shapeClosed && pts.length > 2) { pts.pop(); flush(true); } else flush(false);
      }
      return finishContours(pieces, opts, warnings, info);
    } finally {
      host.remove();
    }
  }

  // ---- 書き出し ---------------------------------------------------------------
  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);

  /** 両眼を並べたときの各眼の配置（正面視。右眼が左側）。dbl は鼻幅（mm）。 */
  function layout(set, dbl) {
    const out = [];
    const R = set.eyes.R && centered(set.eyes.R.pts), L = set.eyes.L && centered(set.eyes.L.pts);
    const d = Number.isFinite(dbl) ? dbl : 18;
    if (R && L) {
      const hr = bbox(R).w, hl = bbox(L).w;
      out.push({ eye: 'R', pts: R.map(p => ({ x: p.x - (d + hr) / 2, y: p.y })) });
      out.push({ eye: 'L', pts: L.map(p => ({ x: p.x + (d + hl) / 2, y: p.y })) });
    } else if (R) out.push({ eye: 'R', pts: R });
    else if (L) out.push({ eye: 'L', pts: L });
    return out;
  }

  /**
   * SVG として書き出す（単位 mm）。
   * @param opts {dbl?: number, title?: string, preview?: boolean（画面表示用の補助線を付ける）}
   */
  function toSVG(set, opts) {
    opts = opts || {};
    const items = layout(set, opts.dbl);
    if (!items.length) return '';
    const all = [].concat(...items.map(i => i.pts)), b = bbox(all), mg = 3;
    const vx = b.x0 - mg, vy = -b.y1 - mg, vw = b.w + mg * 2, vh = b.h + mg * 2;
    const path = pts => 'M' + pts.map(p => `${f3(p.x)} ${f3(-p.y)}`).join(' L') + ' Z';
    const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
    let body = '';
    for (const it of items) {
      const eb = bbox(it.pts);
      body += `  <g id="eye-${it.eye}" data-eye="${it.eye}">\n`;
      if (opts.preview) {
        body += `    <rect class="box" x="${f3(eb.x0)}" y="${f3(-eb.y1)}" width="${f3(eb.w)}" height="${f3(eb.h)}"/>\n`;
        body += `    <path class="axis" d="M${f3(eb.cx - 3)} ${f3(-eb.cy)} H${f3(eb.cx + 3)} M${f3(eb.cx)} ${f3(-eb.cy - 3)} V${f3(-eb.cy + 3)}"/>\n`;
        body += `    <text class="label" x="${f3(eb.cx)}" y="${f3(-eb.y0 + 2.2)}">${it.eye === 'R' ? 'R（右眼）' : 'L（左眼）'}</text>\n`;
      }
      body += `    <path class="outline" d="${path(it.pts)}"${opts.preview ? '' : ' fill="none" stroke="#000" stroke-width="0.1"'}/>\n`;
      body += '  </g>\n';
    }
    const size = opts.preview ? 'width="100%"' : `width="${f3(vw)}mm" height="${f3(vh)}mm"`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="${f3(vx)} ${f3(vy)} ${f3(vw)} ${f3(vh)}">\n` +
      `  <title>${esc(opts.title || 'lens shape')}</title>\n` +
      `  <desc>vca-ptn Converter で作成。単位は mm、検者が装用者を正面から見た向き。</desc>\n` +
      body + '</svg>\n';
  }

  /** DXF（R12 ASCII、単位 mm）として書き出す。眼ごとにレイヤー R / L に分ける。 */
  function toDXF(set, opts) {
    opts = opts || {};
    const items = layout(set, opts.dbl);
    const out = [];
    const g = (c, v) => out.push(String(c), String(v));
    g(999, 'vca-ptn Converter / units: mm / front view');
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$INSUNITS'); g(70, 4);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, items.length);
    for (const it of items) { g(0, 'LAYER'); g(2, it.eye); g(70, 0); g(62, it.eye === 'R' ? 1 : 5); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const it of items) {
      g(0, 'POLYLINE'); g(8, it.eye); g(66, 1); g(70, 1); g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
      for (const p of it.pts) { g(0, 'VERTEX'); g(8, it.eye); g(10, f3(p.x)); g(20, f3(p.y)); g(30, '0.0'); }
      g(0, 'SEQEND'); g(8, it.eye);
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return out.join('\r\n') + '\r\n';
  }

  // VCA に書き出すときに、元のファイルから引き継がないレコード（このツールが計算し直すもの）
  const REWRITTEN = new Set(['REQ', 'ANS', 'JOB', 'DBL', 'HBOX', 'VBOX', 'CIRC', 'CRC', 'STATUS']);

  /**
   * VCA テキスト（REQ=FIL のファイル形式、形式 1・等角度）として書き出す。
   * @param opts {n: 点数, job?: string, dbl?: number, keepRecords?: boolean（元の VCA のほかのレコードを引き継ぐ）}
   * @returns {{text: string, warnings: string[], dims: object}} dims は眼ごとの HBOX・VBOX・周長（mm）
   */
  function toVCA(set, opts) {
    opts = opts || {};
    // 点数の下限は規格（DCS v3.14）に定められていないので、指定された点数をそのまま使う
    const n = Math.round(opts.n || 400), warnings = [], lines = ['REQ=FIL'];
    if (opts.job) lines.push('JOB=' + opts.job);
    if (Number.isFinite(opts.dbl)) lines.push('DBL=' + f2(opts.dbl));

    const res = {};
    for (const eye of EYES) {
      if (!set.eyes[eye]) continue;
      const r = resample(set.eyes[eye].pts, n);
      // R レコードに書く値（1/100 mm の整数）に丸めてから寸法を計算し、HBOX などと半径データを一致させる
      r.radii = r.radii.map(v => Math.max(0, Math.round(v * 100)) / 100);
      res[eye] = r;
      if (r.multi) warnings.push(`${eye}：${n} 点中 ${r.multi} 点で輪郭と 2 回以上交わりました（内側にえぐれた形）。いちばん外側の輪郭で近似しています`);
      if (r.miss) warnings.push(`${eye}：${r.miss} 点で輪郭と交わりませんでした。箱の中心が形の外側にあるため、半径で表せません（玉形として使えない形です）`);
    }
    const dims = {};
    for (const eye of EYES) if (res[eye]) dims[eye] = measure(radiiToPoints(res[eye].radii));
    const chiral = key => {
      const v = EYES.map(e => (dims[e] ? f2(dims[e][key]) : ''));
      return v[1] === '' ? v[0] + ';' : v[0] === '' ? ';' + v[1] : v.join(';');
    };
    if (Object.keys(dims).length) {
      lines.push('HBOX=' + chiral('hbox'), 'VBOX=' + chiral('vbox'), 'CIRC=' + chiral('circ'));
    }
    if (opts.keepRecords && set.records) {
      for (const r of set.records) if (!REWRITTEN.has(r.label)) lines.push(r.label + '=' + r.fields.join(';'));
    }
    if (set.hasSag) warnings.push('Z（サグ）データは出力に含めません');
    for (const eye of EYES) {
      if (!res[eye]) continue;
      lines.push(`TRCFMT=1;${n};E;${eye};F`);
      const rs = res[eye].radii.map(r => Math.round(r * 100));
      for (let i = 0; i < rs.length; i += 15) lines.push('R=' + rs.slice(i, i + 15).join(';'));
    }
    return { text: lines.join('\r\n') + '\r\n', warnings, dims };
  }

  // ---- ファイル名 ---------------------------------------------------------------
  /**
   * Nidek 機の USB メモリ用のファイル名を作る（拡張子を除く）。
   * 取扱説明書（ICE 900）: 「銘柄名 - 番号」で、ハイフンを含めて最大 16 桁。
   * 取扱説明書（ME-1000）: コードに入力できる英字は大文字だけ。そのため銘柄名は大文字にする。
   * OptiBoard の報告: 先頭を 0 で埋めて 16 桁にする（例 0000000000123456.ptn）。
   * @returns {{name?: string, error?: string}}
   */
  function deviceFileName(brand, number) {
    brand = String(brand || '').trim().toUpperCase();
    const digits = String(number || '').replace(/\D/g, '');
    if (!digits) return { error: '番号を入力してください（数字）' };
    if (brand) {
      if (!/^[A-Z0-9]+$/.test(brand)) return { error: '銘柄名は半角英数字にしてください' };
      const room = 16 - brand.length - 1;
      if (room < 1) return { error: '銘柄名が長すぎます（ハイフンと番号を含めて 16 桁まで）' };
      if (digits.length > room) return { error: `番号が長すぎます（この銘柄名では ${room} 桁まで）` };
      return { name: `${brand}-${digits.padStart(room, '0')}` };
    }
    if (digits.length > 16) return { error: '番号は 16 桁までです' };
    return { name: digits.padStart(16, '0') };
  }

  // Windows で使えない名前（拡張子が付いていても使えない）
  const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

  /**
   * JOB 番号などを、Windows や USB メモリ（FAT32）で使えるファイル名（拡張子を除く）にする。
   * 使えない文字は「_」に、制御文字は取り除き、最後の「.」と空白を削る。予約された名前は先頭に「_」を付ける。
   */
  function safeFileStem(s, fallback) {
    let t = String(s || '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim()
      .replace(/[.\s]+$/, '')
      .slice(0, 100)
      .replace(/[.\s]+$/, '')
      .replace(/[\\/:*?"<>|\s]+/g, '_');
    if (RESERVED.test(t)) t = '_' + t;
    return t || fallback || 'shape';
  }

  return {
    detect, binaryRatio, fromVCA, fromDXF, fromSVG, toSVG, toDXF, toVCA,
    resample, radiiToPoints, measure, mirror, fillMirror, centered, deviceFileName, safeFileStem, chain, pickEyes,
  };
});
