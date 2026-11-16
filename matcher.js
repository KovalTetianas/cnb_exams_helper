// Fuzzy search of a question by text (typed or OCR-recognized).
// Works in the browser (window.Matcher) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  var STOP = {};
  ('a i k o s u v z na do za ze ve se je to ta ten tak jak jako ale nebo ani pro pri po od bez nad pod pred mezi aby kdyz ktery ktera ktere kteri jeho jeji jejich jsou byl byla bylo byt mu mi si jen uz vsak tedy take dle'
  ).split(' ').forEach(function (w) { STOP[w] = 1; });

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Crude Czech "stemming": keep the first 5 chars of a word.
  // Absorbs declension and most OCR errors at the end of words.
  function tokens(s) {
    var out = [], parts = norm(s).split(' ');
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i];
      if (!w || STOP[w]) continue;
      if (/^\d+$/.test(w)) { out.push('#' + w); continue; }
      if (w.length < 2) continue;
      out.push(w.length > 5 ? w.slice(0, 5) : w);
    }
    return out;
  }

  function uniq(arr) {
    var m = {}, out = [];
    for (var i = 0; i < arr.length; i++) if (!m[arr[i]]) { m[arr[i]] = 1; out.push(arr[i]); }
    return out;
  }

  function Index(exam) {
    var qs = exam.questions, df = {}, docs = [];
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      var tq = uniq(tokens(q.q));
      var to = uniq(tokens(q.o.join(' ')));
      var all = uniq(tq.concat(to));
      for (var j = 0; j < all.length; j++) df[all[j]] = (df[all[j]] || 0) + 1;
      docs.push({ q: tq, all: all });
    }
    var N = qs.length;
    this.idf = function (t) { return Math.log(1 + N / (1 + (df[t] || 0))); };
    for (var d = 0; d < docs.length; d++) {
      docs[d].wq = this.weight(docs[d].q);
      docs[d].wall = this.weight(docs[d].all);
      docs[d].setQ = toSet(docs[d].q);
      docs[d].setAll = toSet(docs[d].all);
    }
    this.docs = docs;
    this.exam = exam;
  }

  function toSet(a) { var s = {}; for (var i = 0; i < a.length; i++) s[a[i]] = 1; return s; }

  Index.prototype.weight = function (toks) {
    var w = 0;
    for (var i = 0; i < toks.length; i++) w += this.idf(toks[i]);
    return w;
  };

  // Returns [{i, score}] sorted by score desc (score 0..1).
  Index.prototype.search = function (text, limit) {
    var Q = uniq(tokens(text));
    if (!Q.length) return [];
    var wQ = this.weight(Q), idf = [], res = [];
    for (var k = 0; k < Q.length; k++) idf.push(this.idf(Q[k]));
    for (var i = 0; i < this.docs.length; i++) {
      var d = this.docs[i], interAll = 0, interQ = 0;
      for (var j = 0; j < Q.length; j++) {
        if (d.setAll[Q[j]]) interAll += idf[j];
        if (d.setQ[Q[j]]) interQ += idf[j];
      }
      if (!interAll) continue;
      // full screenshot: query ≈ question + options
      var diceAll = 2 * interAll / (wQ + d.wall);
      // only the question text was pasted / typed
      var diceQ = 2 * interQ / (wQ + d.wq);
      // screenshot contains extra stuff (case text, UI): question+options contained in query
      var cover = d.wall ? interAll / d.wall : 0;
      var coverQ = d.wq ? interQ / d.wq : 0;
      // typed fragment: query contained in the question
      var prec = interAll / wQ;
      var s = Math.max(
        diceAll,
        0.95 * diceQ,
        0.85 * cover * (0.5 + 0.5 * coverQ),
        Q.length >= 3 ? 0.8 * prec * Math.min(1, wQ / (d.wq || 1) * 2) : 0
      );
      res.push({ i: i, score: s });
    }
    res.sort(function (a, b) { return b.score - a.score; });
    return res.slice(0, limit || 5);
  };

  // ---- on-screen order of the options ----

  // text fingerprint: character bigrams + word pairs (counted, order-aware)
  function bigrams(s) {
    var t = norm(s), m = {}, n = 0, i, g;
    var c = ' ' + t + ' ';
    for (i = 0; i < c.length - 1; i++) { g = c.substr(i, 2); m[g] = (m[g] || 0) + 1; n++; }
    var w = t.split(' '), wm = {}, wn = 0;
    for (i = 0; i < w.length - 1; i++) {
      g = w[i].slice(0, 4) + '_' + w[i + 1].slice(0, 4); wm[g] = (wm[g] || 0) + 1; wn++;
    }
    return { m: m, n: n, wm: wm, wn: wn };
  }
  function mdice(A, An, B, Bn) {
    if (!An || !Bn) return 0;
    var c = 0;
    for (var g in A) if (B[g]) c += Math.min(A[g], B[g]);
    return 2 * c / (An + Bn);
  }
  function dice(A, B) {
    var ch = mdice(A.m, A.n, B.m, B.n);
    if (!A.wn || !B.wn) return ch;
    return 0.75 * ch + 0.25 * mdice(A.wm, A.wn, B.wm, B.wn);
  }
  var LABEL = /^\s*[\(\[]?[A-Ha-h1-8][.)\]:]\s*/;

  // Order of the options as they appear in the pasted/recognized text.
  // Returns an array of option indexes (q.o) in on-screen order, or null
  // when the options can't all be located reliably.
  function screenOrder(text, q) {
    var n = q.o.length;
    if (n < 2 || n > 10) return null;
    var lines = String(text || '').split(/\r?\n|\s(?=[A-Ha-h][.)]\s)/)
      .filter(function (x) { return norm(x); });
    var OW = 4, QW = 10; // max lines per option / per question
    // If the options carry labels (A. / b) / ...), glue each label with its
    // continuation lines so an option is always one whole block.
    var LBL = /^\s*[\(\[]?[A-Ha-h][.)\]]\s/, nl = 0;
    lines.forEach(function (x) { if (LBL.test(x)) nl++; });
    if (nl >= n) {
      var merged = [], inBlock = false;
      lines.forEach(function (x) {
        if (LBL.test(x)) { merged.push(x); inBlock = true; }
        else if (inBlock) merged[merged.length - 1] += ' ' + x;
        else merged.push(x);
      });
      lines = merged; OW = 1;
    }
    var L = lines.length;
    if (L < n) return null;
    var ob = q.o.map(bigrams), qb = bigrams(q.q);
    // sim[o][l][w-1]: option o vs lines l..l+w-1 ; qs[l][w-1]: question
    var sim = [], qs = [], l, w, o;
    for (o = 0; o < n; o++) sim.push([]);
    for (l = 0; l < L; l++) {
      var opt = [], qq = [];
      for (w = 1; w <= QW && l + w <= L; w++) {
        var chunk = lines.slice(l, l + w).join(' ');
        if (w <= OW) opt.push(bigrams(chunk.replace(LABEL, '')));
        qq.push(dice(qb, bigrams(chunk)));
      }
      for (o = 0; o < n; o++) sim[o].push(opt.map(function (B) { return dice(ob[o], B); }));
      qs.push(qq);
    }
    // DP over (line, used-options mask); the question (optional) must come
    // before every option. Picks the best non-overlapping placement.
    var FULL = (1 << n) - 1, M = FULL + 2; // mask index FULL+1 = "question not placed yet, nothing used"
    var NEG = -1e9, best = [], from = [];
    for (l = 0; l <= L; l++) { best.push(new Float64Array(M).fill(NEG)); from.push(new Array(M)); }
    best[0][FULL + 1] = 0; // nothing placed yet
    best[0][0] = NEG;
    for (l = 0; l < L; l++) {
      for (var mask = 0; mask < M; mask++) {
        var cur = best[l][mask];
        if (cur === NEG) continue;
        var used = mask === FULL + 1 ? 0 : mask;
        // skip line
        if (cur > best[l + 1][mask]) { best[l + 1][mask] = cur; from[l + 1][mask] = [l, mask, -1, 0]; }
        // place the question
        if (mask === FULL + 1) {
          for (w = 1; w <= QW && l + w <= L; w++) {
            var v = cur + qs[l][w - 1];
            if (v > best[l + w][0]) { best[l + w][0] = v; from[l + w][0] = [l, mask, -2, w]; }
          }
        }
        // place an option
        for (o = 0; o < n; o++) {
          if (used & (1 << o)) continue;
          var nm = used | (1 << o);
          for (w = 1; w <= OW && l + w <= L; w++) {
            var s2 = sim[o][l][w - 1];
            if (s2 < 0.35) continue;
            v = cur + s2;
            if (v > best[l + w][nm]) { best[l + w][nm] = v; from[l + w][nm] = [l, mask, o, w]; }
          }
        }
      }
    }
    if (best[L][FULL] === NEG) return null;
    // backtrack
    var order = [], place = [], st = [L, FULL];
    while (st[0] > 0) {
      var f = from[st[0]][st[1]];
      if (!f) break;
      if (f[2] >= 0) { order.unshift(f[2]); place.push([f[2], f[0], f[3] - 1]); }
      st = [f[0], f[1]];
    }
    if (order.length !== n) return null;
    for (var i = 0; i < n; i++) {
      var A1 = place[i];
      // every option must be found with reasonable confidence
      if (sim[A1[0]][A1[1]][A1[2]] < 0.5) return null;
      // ...and must not be interchangeable with another option
      for (var j = i + 1; j < n; j++) {
        var B1 = place[j];
        var keep = sim[A1[0]][A1[1]][A1[2]] + sim[B1[0]][B1[1]][B1[2]];
        var swap = (sim[A1[0]][B1[1]][B1[2]] || 0) + (sim[B1[0]][A1[1]][A1[2]] || 0);
        if (keep - swap < 0.04) return null;
      }
    }
    return order;
  }

  var api = { Index: Index, tokens: tokens, norm: norm, screenOrder: screenOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Matcher = api;
})(this);
