// 七日練功試算 — pure model.
// The player enters hours per day (play, train, abandoned land, shadow temple); ATS = map hours.
// check(): works out which stones are needed, takes them from the bag first, then exchanges
// with feathers / crystals as cheaply as possible, and reports any shortfall per day.
// suggest(): fills in the hour split that gives the most exp with the stones available.
(function (root) {
  const TYPES = ['A', 'S', 'T']; // 被遺棄者之地, 暗影神殿, ATS

  function needs(S, d) {
    const A = Math.max(0, d.a || 0), Sh = Math.max(0, d.s || 0);
    return [Math.max(0, A - S.freeA), Math.max(0, Sh - S.freeS), Math.max(0, A + Sh - S.freeT)];
  }

  function rates(S) { return { a: S.rateA * 3, s: S.rateS * 3, t: S.rateT / 3 }; }

  function addExp(S, st, gain) {
    let left = gain;
    if (S.expMode === 'pct') {
      while (left > 1e-12) {
        const need = 100 - st.pct;
        if (left >= need) { left -= need; st.lv++; st.pct = 0; } else { st.pct += left; left = 0; }
      }
    } else {
      while (left > 1e-12) {
        const needAbs = (100 - st.pct) * st.req;
        if (left >= needAbs) { left -= needAbs; st.lv++; st.pct = 0; st.req *= 1 + S.growth / 100; }
        else { st.pct += left / st.req; left = 0; }
      }
    }
  }

  // ---------- stone sourcing ----------
  function sourceLP(solver, S, days, useFeathers) {
    const n = days.length, inv0 = [S.invA, S.invS, S.invT];
    const cc = [S.cA, S.cS, S.cT], fc = [S.fA, S.fS, S.fT];
    const m = { optimize: 'cost', opType: 'min', constraints: {}, variables: {}, ints: {} };
    const C = m.constraints, V = m.variables;
    C.cry = { max: S.crystals };
    days.forEach((d, i) => {
      const nd = needs(S, d);
      C['F' + i] = { max: S.feathers0 + S.featherDay * i };
      TYPES.forEach((k, kk) => {
        C['N' + k + i] = { min: nd[kk] };
        C['B' + k + i] = { max: inv0[kk] + S.shop * (i + 1) };
      });
    });
    days.forEach((d, i) => {
      TYPES.forEach((k, kk) => {
        const u = 'u' + k + i, sh = 'x' + k + i, c = 'c' + k + i, f = 'f' + k + i;
        V[u] = { cost: 0, ['N' + k + i]: 1 };
        V[sh] = { cost: 1000 * (1 + 0.2 * (n - 1 - i)), ['N' + k + i]: 1 };
        V[c] = { cost: cc[kk] * (1 + 0.001 * (n - i)), cry: cc[kk], ['L' + c]: 1 };
        C['L' + c] = { max: S.climit > 0 ? S.climit : 999 };
        m.ints[c] = 1;
        if (useFeathers) {
          V[f] = { cost: 0.05 * fc[kk] * (1 + 0.001 * (n - i)), ['L' + f]: 1 };
          C['L' + f] = { max: S.flimit };
          m.ints[f] = 1;
        }
        for (let j = i; j < n; j++) {
          V[u]['B' + k + j] = 1;
          V[c]['B' + k + j] = -1;
          if (useFeathers) { V[f]['B' + k + j] = -1; V[f]['F' + j] = fc[kk]; }
        }
      });
    });
    m.options = { timeout: 3000, tolerance: 0 };
    const r = solver.Solve(m);
    if (!r.feasible) return null;
    const g = (k) => Math.max(0, Math.round(r[k] || 0));
    return days.map((d, i) => ({
      cry: TYPES.map(k => g('c' + k + i)),
      fea: TYPES.map(k => useFeathers ? g('f' + k + i) : 0),
    }));
  }

  // fallback when the solver is unavailable: bag first, then feathers, then crystals, day by day
  function sourceGreedy(S, days, useFeathers) {
    const bag = [S.invA, S.invS, S.invT];
    let cry = S.crystals, fea = S.feathers0;
    const cc = [S.cA, S.cS, S.cT], fc = [S.fA, S.fS, S.fT];
    return days.map((d, i) => {
      if (i > 0) fea += S.featherDay;
      const nd = needs(S, d), out = { cry: [0, 0, 0], fea: [0, 0, 0] };
      [2, 1, 0].forEach(k => {
        bag[k] += S.shop;
        let gap = Math.max(0, nd[k] - bag[k]);
        while (gap > 0 && useFeathers && out.fea[k] < S.flimit && fea >= fc[k]) { out.fea[k]++; fea -= fc[k]; gap--; }
        while (gap > 0 && (S.climit <= 0 || out.cry[k] < S.climit) && cry >= cc[k]) { out.cry[k]++; cry -= cc[k]; gap--; }
        bag[k] += out.fea[k] + out.cry[k];
        bag[k] -= Math.min(bag[k], nd[k]);
      });
      return out;
    });
  }

  // ---------- full check: exchanges, balances, shortfalls, exp ----------
  function check(solver, S, days, useFeathers) {
    const ex = (solver && sourceLP(solver, S, days, useFeathers)) || sourceGreedy(S, days, useFeathers);
    const R = rates(S);
    const bag = [S.invA, S.invS, S.invT];
    let cry = S.crystals, feaSpent = 0;
    const st = { lv: S.startLv, pct: S.startPct, req: 1 };
    let totalGain = 0, firstShort = -1;
    const out = days.map((d, i) => {
      const nd = needs(S, d), e = ex[i];
      const used = [0, 0, 0], short = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        bag[k] += S.shop + e.cry[k] + e.fea[k];
        used[k] = Math.min(bag[k], nd[k]);
        short[k] = nd[k] - used[k];
        bag[k] -= used[k];
      }
      const cryCost = e.cry[0] * S.cA + e.cry[1] * S.cS + e.cry[2] * S.cT;
      const feaCost = e.fea[0] * S.fA + e.fea[1] * S.fS + e.fea[2] * S.fT;
      cry -= cryCost; feaSpent += feaCost;
      const feaLeft = S.feathers0 + S.featherDay * i - feaSpent;
      const a = Math.max(0, d.a || 0), s = Math.max(0, d.s || 0), t = Math.max(0, d.t || 0), play = Math.max(0, d.play || 0);
      const gain = a * R.a + s * R.s + t * R.t;
      addExp(S, st, gain);
      totalGain += gain;
      const isShort = short.some(v => v > 0);
      if (isShort && firstShort < 0) firstShort = i;
      return {
        ats: a + s, need: nd, used, short, isShort, cry: e.cry, fea: e.fea, cryCost, feaCost,
        cryLeft: cry, feaLeft, bag: bag.slice(),
        sum: a + s + t, spare: play - (a + s + t),
        freeIdleA: Math.max(0, Math.min(S.freeA, play) - a), freeIdleS: Math.max(0, S.freeS - s),
        gain, lv: st.lv, pct: st.pct,
      };
    });
    return { days: out, totalGain, lv: st.lv, pct: st.pct, firstShort, bag: bag.slice(), cryLeft: cry, feaLeft: out.length ? out[out.length - 1].feaLeft : S.feathers0 };
  }

  // ---------- suggestion: max-exp split for given play hours ----------
  function suggest(solver, S, days, useFeathers) {
    const R = rates(S), n = days.length, inv0 = [S.invA, S.invS, S.invT];
    const cc = [S.cA, S.cS, S.cT], fc = [S.fA, S.fS, S.fT];
    const build = (mandatory) => {
      const m = { optimize: 'obj', opType: 'max', constraints: {}, variables: {}, ints: {} };
      const C = m.constraints, V = m.variables;
      C.cry = { max: S.crystals };
      days.forEach((d, i) => {
        C['A' + i] = { max: S.freeA }; C['S' + i] = { max: S.freeS }; C['T' + i] = { max: S.freeT };
        C['P' + i] = { max: d.play };
        C['F' + i] = { max: S.feathers0 + S.featherDay * i };
        if (mandatory) {
          const ma = Math.min(S.freeA, d.play);
          C['mA' + i] = { min: ma }; C['mS' + i] = { min: Math.min(S.freeS, Math.max(0, d.play - ma)) };
        }
        TYPES.forEach((k, kk) => { C['B' + k + i] = { max: inv0[kk] + S.shop * (i + 1) }; });
      });
      days.forEach((d, i) => {
        V['hA' + i] = { obj: R.a * (1 + 1e-4 * (n - i)), ['A' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
        V['hS' + i] = { obj: R.s * (1 + 1e-4 * (n - i)), ['S' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
        if (mandatory) { V['hA' + i]['mA' + i] = 1; V['hS' + i]['mS' + i] = 1; }
        V['tr' + i] = { obj: R.t, ['P' + i]: 1 };
        m.ints['hA' + i] = 1; m.ints['hS' + i] = 1;
        TYPES.forEach((k, kk) => {
          const c = 'c' + k + i, f = 'f' + k + i, u = 'u' + k + i;
          V[c] = { obj: -1e-4 * cc[kk], cry: cc[kk], ['L' + c]: 1 };
          C['L' + c] = { max: S.climit > 0 ? S.climit : 999 };
          V[u] = { obj: -1e-6 * (kk === 0 ? 50 : 1), [k + i]: -1 };
          m.ints[c] = 1; m.ints[u] = 1;
          if (useFeathers) {
            V[f] = { obj: -1e-5 * fc[kk], ['L' + f]: 1 };
            C['L' + f] = { max: S.flimit };
            m.ints[f] = 1;
          }
          for (let j = i; j < n; j++) {
            V[c]['B' + k + j] = -1; V[u]['B' + k + j] = 1;
            if (useFeathers) { V[f]['B' + k + j] = -1; V[f]['F' + j] = fc[kk]; }
          }
        });
      });
      m.options = { timeout: 4000, tolerance: 0.002 };
      return m;
    };
    let r = solver.Solve(build(true));
    if (!r.feasible) r = solver.Solve(build(false));
    if (!r.feasible) return null;
    return days.map((d, i) => {
      const a = Math.round(r['hA' + i] || 0), s = Math.round(r['hS' + i] || 0);
      return { play: d.play, a, s, t: Math.max(0, +(d.play - a - s).toFixed(2)) };
    });
  }

  root.GameModel = { needs, check, suggest };
})(typeof window !== 'undefined' ? window : globalThis);
