// 七日練功試算 — pure model.
// The player enters hours per day (play, train, abandoned land, shadow temple); ATS = map hours.
// check(): works out which stones are needed, takes them from the bag first, then exchanges
// with feathers before crystals (day by day, no search), and reports any shortfall per day.
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
  // Fast exact-enough sourcing, day by day (no search, runs in well under a millisecond).
  // For each day's shortfall of a stone type it exchanges on the latest day that still has room
  // (today first, then earlier days), feathers before crystals, respecting the daily caps,
  // the running feather balance and the crystal total. Earlier days are always served first.
  function sourceFast(S, days, useFeathers) {
    const n = days.length, inv0 = [S.invA, S.invS, S.invT];
    const cc = [S.cA, S.cS, S.cT], fc = [S.fA, S.fS, S.fT];
    const fea = days.map(() => [0, 0, 0]), cry = days.map(() => [0, 0, 0]);
    const feaAt = new Array(n).fill(0); // feather cost spent on each day
    const budget = i => S.feathers0 + S.featherDay * i;
    let cryUsed = 0;
    const used = [0, 0, 0];
    const feaOk = (j, cost) => {
      let run = 0;
      for (let m = 0; m < n; m++) {
        run += feaAt[m] + (m === j ? cost : 0);
        if (m >= j && run > budget(m)) return false;
      }
      return true;
    };
    for (let i = 0; i < n; i++) {
      const nd = needs(S, days[i]);
      [2, 1, 0].forEach(k => {
        let have = inv0[k] + S.shop * (i + 1) - used[k];
        for (let j = 0; j <= i; j++) have += fea[j][k] + cry[j][k];
        let gap = nd[k] - have;
        while (gap > 0) {
          let done = false;
          if (useFeathers && S.flimit > 0) {
            for (let j = i; j >= 0 && !done; j--) {
              if (fea[j][k] < S.flimit && feaOk(j, fc[k])) { fea[j][k]++; feaAt[j] += fc[k]; done = true; }
            }
          }
          if (!done) {
            for (let j = i; j >= 0 && !done; j--) {
              if ((S.climit <= 0 || cry[j][k] < S.climit) && cryUsed + cc[k] <= S.crystals) { cry[j][k]++; cryUsed += cc[k]; done = true; }
            }
          }
          if (!done) break;
          gap--; have++;
        }
        used[k] += Math.min(nd[k], have);
      });
    }
    return days.map((d, i) => ({ cry: cry[i], fea: fea[i] }));
  }

  // ---------- full check: exchanges, balances, shortfalls, exp ----------
  function check(solver, S, days, useFeathers) {
    const ex = sourceFast(S, days, useFeathers);
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
        TYPES.forEach((k, kk) => {
          const c = 'c' + k + i, f = 'f' + k + i, u = 'u' + k + i;
          V[c] = { obj: -1e-4 * cc[kk], cry: cc[kk], ['L' + c]: 1 };
          C['L' + c] = { max: S.climit > 0 ? S.climit : 999 };
          V[u] = { obj: -1e-6 * (kk === 0 ? 50 : 1), [k + i]: -1 };
          if (useFeathers) {
            V[f] = { obj: -1e-5 * fc[kk], ['L' + f]: 1 };
            C['L' + f] = { max: S.flimit };
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
    // continuous LP (fast simplex), then round down and repair with the day-by-day check
    let r = solver.Solve(build(true));
    if (!r.feasible) r = solver.Solve(build(false));
    if (!r.feasible) return null;
    const plan = days.map((d, i) => {
      const a = Math.floor((r['hA' + i] || 0) + 1e-6), s = Math.floor((r['hS' + i] || 0) + 1e-6);
      return { play: d.play, a, s, t: Math.max(0, +(d.play - a - s).toFixed(2)) };
    });
    for (let guard = 0; guard < 200; guard++) {
      const res = check(null, S, plan, useFeathers);
      const bad = res.days.findIndex(x => x.isShort);
      if (bad < 0) break;
      const p = plan[bad], sh = res.days[bad].short;
      if (sh[1] > 0 || (sh[2] > 0 && p.s > S.freeS)) { p.s--; }
      else if (p.a > S.freeA) { p.a--; }
      else if (p.s > 0) { p.s--; }
      else break;
      p.t = Math.max(0, +(p.play - p.a - p.s).toFixed(2));
    }
    // use any stones freed up by rounding: try adding shadow hours back where training remains
    for (let i = 0; i < plan.length; i++) {
      while (plan[i].t >= 1) {
        plan[i].s++; plan[i].t = +(plan[i].t - 1).toFixed(2);
        if (check(null, S, plan, useFeathers).firstShort >= 0) { plan[i].s--; plan[i].t = +(plan[i].t + 1).toFixed(2); break; }
      }
    }
    return plan;
  }

  root.GameModel = { needs, check, suggest };
})(typeof window !== 'undefined' ? window : globalThis);
