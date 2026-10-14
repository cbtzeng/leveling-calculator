// Pure model: evaluate a plan and build/solve the optimization. Shared by page + node test.
(function (root) {
  function evaluate(S, days) {
    // S: settings; days: array of {play, shop:[a,s,t], cry:[a,s,t], fea:[a,s,t], train:null|number}
    const rA = S.rateA * 3, rS = S.rateS * 3, rT = S.rateT / 3; // % per hour
    let lv = S.startLv, cur = S.startPct; // cur = % of current level
    let req = 1; // requirement relative to start level (abs mode)
    let cry = S.crystals, feaSpent = 0, totalGain = 0;
    const invUsed = [0,0,0];
    const out = [];
    days.forEach((d, i) => {
      const inv = d.inv || [0,0,0];
      const availA = S.freeA + d.shop[0] + d.cry[0] + d.fea[0] + inv[0];
      const availS = S.freeS + d.shop[1] + d.cry[1] + d.fea[1] + inv[1];
      const ats = S.freeT + d.shop[2] + d.cry[2] + d.fea[2] + inv[2];
      invUsed[0]+=inv[0]; invUsed[1]+=inv[1]; invUsed[2]+=inv[2];
      const hangS = Math.max(0, Math.min(availS, ats, d.play));
      const hangA = Math.max(0, Math.min(availA, ats - hangS, d.play - hangS));
      const hang = hangA + hangS;
      const autoTrain = Math.max(0, d.play - hang);
      const train = d.train == null ? autoTrain : Math.max(0, d.train);
      const gainBase = hangA * rA + hangS * rS + train * rT; // in "% of a level-L0 level" (abs) or "% of current level" (pct)
      const cryCost = d.cry[0] * S.cA + d.cry[1] * S.cS + d.cry[2] * S.cT;
      const feaCost = d.fea[0] * S.fA + d.fea[1] * S.fS + d.fea[2] * S.fT;
      const feaAvail = S.feathers0 + S.featherDay * i - feaSpent;
      cry -= cryCost; feaSpent += feaCost;
      // apply exp
      let gainLeft = gainBase;
      if (S.expMode === 'pct') {
        // gains measured as % of the level the character is in when earned
        while (gainLeft > 0) {
          const need = 100 - cur;
          if (gainLeft >= need) { gainLeft -= need; lv++; cur = 0; }
          else { cur += gainLeft; gainLeft = 0; }
        }
      } else {
        // absolute: gain is in % of the starting level's requirement
        while (gainLeft > 0) {
          const needAbs = (100 - cur) * req;
          if (gainLeft >= needAbs) { gainLeft -= needAbs; lv++; cur = 0; req *= 1 + S.growth / 100; }
          else { cur += gainLeft / req; gainLeft = 0; }
        }
      }
      totalGain += gainBase;
      out.push({
        availA, availS, ats, hangA, hangS, hang, train, autoTrain,
        playTotal: hang + train, overPlay: hang + train > d.play + 1e-9,
        idleA: availA - hangA, idleS: availS - hangS, idleT: ats - hang,
        gain: gainBase, lv, pct: cur, cryLeft: cry, cryCost, feaCost,
        feaAvail, feaLeft: feaAvail - feaCost,
        feaOver: feaCost > feaAvail + 1e-9, cryOver: cry < -1e-9,
        invLeft: [S.invA - invUsed[0], S.invS - invUsed[1], S.invT - invUsed[2]],
        invOver: invUsed[0] > S.invA || invUsed[1] > S.invS || invUsed[2] > S.invT,
        limitOver: d.fea.some(v => v > S.flimit) || (S.climit > 0 && d.cry.some(v => v > S.climit)),
      });
    });
    return { days: out, lv, pct: cur, totalGain, levelFloat: lv + cur / 100 };
  }

  function buildModel(S, days) {
    // days: provide play + shop (fixed); solver picks cry/fea + hang + train
    const rA = S.rateA * 3, rS = S.rateS * 3, rT = S.rateT / 3;
    const m = { optimize: 'obj', opType: 'max', constraints: {}, variables: {}, ints: {} };
    const C = m.constraints;
    C.cry = { max: S.crystals };
    C.invA = { max: S.invA }; C.invS = { max: S.invS }; C.invT = { max: S.invT };
    const n = days.length;
    days.forEach((d, i) => {
      C['A' + i] = { max: S.freeA + d.shop[0] };
      C['S' + i] = { max: S.freeS + d.shop[1] };
      C['T' + i] = { max: S.freeT + d.shop[2] };
      C['P' + i] = { max: d.play };
      C['F' + i] = { max: S.feathers0 + S.featherDay * i };
    });
    const V = m.variables;
    const lim = (name, i, ub) => { C[name + i] = { max: ub }; };
    days.forEach((d, i) => {
      // hang vars
      V['hA' + i] = { obj: rA, ['A' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
      V['hS' + i] = { obj: rS, ['S' + i]: 1, ['T' + i]: 1, ['P' + i]: 1 };
      V['tr' + i] = { obj: rT, ['P' + i]: 1 };
      const types = [['A', S.cA, S.fA], ['S', S.cS, S.fS], ['T', S.cT, S.fT]];
      types.forEach(([k, cc, fc]) => {
        const cv = 'c' + k + i, fv = 'f' + k + i;
        V[cv] = { obj: -1e-4 * cc, ['' + k + i]: -1, cry: cc, ['u' + cv]: 1 };
        V[fv] = { obj: -1e-5 * fc, ['' + k + i]: -1, ['u' + fv]: 1 };
        for (let j = i; j < n; j++) V[fv]['F' + j] = fc;
        lim('u' + cv, '', S.climit > 0 ? S.climit : 999);
        lim('u' + fv, '', S.flimit);
        m.ints[cv] = 1; m.ints[fv] = 1;
        const iv = 'i' + k + i;
        V[iv] = { obj: -1e-6 * (i + 1), ['' + k + i]: -1, ['inv' + k]: 1 };
        m.ints[iv] = 1;
      });
    });
    return m;
  }

  function optimize(solver, S, days) {
    const m = buildModel(S, days);
    m.options = { timeout: 4000, tolerance: 0.002 };
    const r = solver.Solve(m);
    if (!r.feasible) return null;
    const g = k => Math.round(r[k] || 0);
    return days.map((d, i) => ({
      play: d.play, shop: d.shop.slice(),
      cry: [g('cA' + i), g('cS' + i), g('cT' + i)],
      fea: [g('fA' + i), g('fS' + i), g('fT' + i)],
      inv: [g('iA' + i), g('iS' + i), g('iT' + i)],
      train: null,
    }));
  }

  root.GameModel = { evaluate, buildModel, optimize };
})(typeof window !== 'undefined' ? window : globalThis);
