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

  var api = { Index: Index, tokens: tokens, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Matcher = api;
})(this);
