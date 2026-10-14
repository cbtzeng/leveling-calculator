// Pure model: evaluate a plan and build/solve the optimization. Shared by page + node test.
// Stones are items: whatever is bought or exchanged goes into the bag and can be used that day or later.
// Free hours are per day and must be hung: abandoned-land free hours first, then shadow temple, then extra abandoned-land hours.
(function (root) {
  const K = 3; // 0 = 被遺棄者之地, 1 = 暗影神殿, 2 = ATS

  function evaluate(S, days) {
    const rA = S.rateA * 3, rS = S.rateS * 3, rT = S.rateT / 3; // % per hour
    let lv = S.startLv, cur = S.startPct, req = 1;
    let cry = S.crystals, feaSpent = 0, totalGain = 0;
    const bag = [S.invA, S.invS, S.invT];
    const out = [];
    days.forEach((d, i) => {
      const got = [0, 1, 2].map(k => d.shop[k] + d.cry[k] + d.fea[k]);
      for (let k = 0; k < K; k++) bag[k] += got[k];
      const bagStart = bag.slice();
      // planned use: null = auto (A: 0 extra, S/ATS: as many as useful)
      const use = (d.inv || [null, null, null]).map((v, k) => v == null ? (k === 0 ? 0 : Infinity) : v);
      const useOver = use.some((v, k) => v !== Infinity && v > bagStart[k]);
      const usable = use.map((v, k) => Math.max(0, Math.min(v, bagStart[k])));
      const ats = S.freeT + usable[2];
      const play = d.play;
      const hangAfree = Math.max(0, Math.min(S.freeA, ats, play));
      const hangS = Math.max(0, Math.min(S.freeS + usable[1], ats - hangAfree, play - hangAfree));
      const hangAx = Math.max(0, Math.min(usable[0], ats - hangAfree - hangS, play - hangAfree - hangS));
      const hangA = hangAfree + hangAx, hang = hangA + hangS;
      const consumed = [hangAx, Math.max(0, hangS - S.freeS), Math.max(0, hang - S.freeT)];
      for (let k = 0; k < K; k++) bag[k] -= consumed[k];
      const autoTrain = Math.max(0, play - hang);
      const train = d.train == null ? autoTrain : Math.max(0, d.train);
      const gainBase = hangA * rA + hangS * rS + train * rT;
      const cryCost = d.cry[0] * S.cA + d.cry[1] * S.cS + d.cry[2] * S.cT;
      const feaCost = d.fea[0] * S.fA + d.fea[1] * S.fS + d.fea[2] * S.fT;
      const feaAvail = S.feathers0 + S.featherDay * i - feaSpent;
      cry -= cryCost; feaSpent += feaCost;
      let gainLeft = gainBase;
      if (S.expMode === 'pct') {
        while (gainLeft > 0) {
          const need = 100 - cur;
          if (gainLeft >= need) { gainLeft -= need; lv++; cur = 0; } else { cur += gainLeft; gainLeft = 0; }
        }
      } else {
        while (gainLeft > 0) {
          const needAbs = (100 - cur) * req;
          if (gainLeft >= needAbs) { gainLeft -= needAbs; lv++; cur = 0; req *= 1 + S.growth / 100; }
          else { cur += gainLeft / req; gainLeft = 0; }
        }
      }
      totalGain += gainBase;
      out.push({
        hangA, hangAfree, hangAx, hangS, hang, ats, train, autoTrain, consumed,
        playTotal: hang + train, overPlay: hang + train > play + 1e-9,
        freeIdleA: S.freeA - hangAfree, freeIdleS: S.freeS - Math.min(hangS, S.freeS), freeIdleT: S.freeT - Math.min(hang, S.freeT),
        gain: gainBase, lv, pct: cur, cryLeft: cry, cryCost, feaCost,
        feaAvail, feaLeft: feaAvail - feaCost,
        feaOver: feaCost > feaAvail + 1e-9, cryOver: cry < -1e-9, useOver,
        bag: bag.slice(),
        limitOver: d.fea.some(v => v > S.flimit) || (S.climit > 0 && d.cry.some(v => v > S.climit)),
      });
    });
    return { days: out, lv, pct: cur, totalGain, levelFloat: lv + cur / 100, bag: bag.slice() };
  }

  function buildModel(S, days, mandatory) {
    const rA = S.rateA * 3, rS = S.rateS * 3, rT = S.rateT / 3;
    const m = { optimize: 'obj', opType: 'max', constraints: {}, variables: {}, ints: {} };
    const C = m.constraints, V = m.variables;
    const n = days.length, keys = ['A', 'S', 'T'], inv0 = [S.invA, S.invS, S.invT];
    const costC = [S.cA, S.cS, S.cT], costF = [S.fA, S.fS, S.fT];
    C.cry = { max: S.crystals };
    days.forEach((d, i) => {
      C['A' + i] = { max: S.freeA };   // hA - uA <= freeA
      C['S' + i] = { max: S.freeS };   // hS - uS <= freeS
      C['T' + i] = { max: S.freeT };   // hA + hS - uT <= freeT
      C['P' + i] = { max: d.play };
      C['F' + i] = { max: S.feathers0 + S.featherDay * i };
      if (mandatory) {
        const ma = Math.min(S.freeA, d.play);
        C['mA' + i] = { min: ma };
        C['mS' + i] = { min: Math.min(S.freeS, Math.max(0, d.play - ma)) };
      }
      // bag balance: inv0 + sum_{j<=i}(shop + c + f - u) >= 0  ->  sum(u - c - f) <= inv0 + sum shop
      keys.forEach((k, kk) => {
        let shopSum = 0; for (let j = 0; j <= i; j++) shopSum += days[j].shop[kk];
        C['B' + k + i] = { max: inv0[kk] + shopSum };
      });
    });
    days.forEach((d, i) => {
      V['hA' + i] = { obj: rA, ['A' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
      V['hS' + i] = { obj: rS, ['S' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
      if (mandatory) { V['hA' + i]['mA' + i] = 1; V['hS' + i]['mS' + i] = 1; }
      V['tr' + i] = { obj: rT, ['P' + i]: 1 };
      keys.forEach((k, kk) => {
        const cv = 'c' + k + i, fv = 'f' + k + i, uv = 'u' + k + i;
        V[cv] = { obj: -1e-4 * costC[kk], cry: costC[kk], ['l' + cv]: 1 };
        V[fv] = { obj: -1e-5 * costF[kk], ['l' + fv]: 1 };
        V[uv] = { obj: -1e-6 * (kk === 0 ? 50 : 1) * (1 + 0.01 * i), [k + i]: -1 };
        for (let j = i; j < n; j++) {
          V[fv]['F' + j] = costF[kk];
          V[cv]['B' + k + j] = -1; V[fv]['B' + k + j] = -1; V[uv]['B' + k + j] = 1;
        }
        C['l' + cv] = { max: S.climit > 0 ? S.climit : 999 };
        C['l' + fv] = { max: S.flimit };
        m.ints[cv] = 1; m.ints[fv] = 1; m.ints[uv] = 1;
      });
    });
    return m;
  }

  function optimize(solver, S, days) {
    let m = buildModel(S, days, true);
    m.options = { timeout: 4000, tolerance: 0.002 };
    let r = solver.Solve(m);
    if (!r.feasible) { m = buildModel(S, days, false); m.options = { timeout: 4000, tolerance: 0.002 }; r = solver.Solve(m); }
    if (!r.feasible) return null;
    const g = k => Math.round(r[k] || 0);
    return days.map((d, i) => ({
      play: d.play, shop: d.shop.slice(),
      cry: [g('cA' + i), g('cS' + i), g('cT' + i)],
      fea: [g('fA' + i), g('fS' + i), g('fT' + i)],
      inv: [g('uA' + i), g('uS' + i), g('uT' + i)],
      train: null,
    }));
  }

  root.GameModel = { evaluate, buildModel, optimize };
})(typeof window !== 'undefined' ? window : globalThis);
