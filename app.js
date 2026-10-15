(function () {
  const M = window.GameModel;
  const N = 7;
  const WD = '日一二三四五六';
  const DEFAULT_START = '2026-10-14';
  const DEFAULT_S = {
    startLv: 40, startPct: 93, growth: 5, expMode: 'abs',
    rateA: 1.08, rateS: 1.2, rateT: 7,
    freeA: 3, freeS: 1, freeT: 3, shop: 3,
    crystals: 340, feathers0: 286, featherDay: 60,
    invA: 7, invS: 18, invT: 19,
    cA: 2, cS: 3, cT: 2, fA: 15, fS: 22, fT: 15, flimit: 3, climit: 3,
  };
  const DEFAULT_DAYS = [14, 14, 14, 13, 9, 9, 9].map(s => ({ play: 17, t: 14 - s, a: 3, s }));
  const KEY = 'leveling-calc-v3';

  let S = Object.assign({}, DEFAULT_S);
  let days = DEFAULT_DAYS.map(d => Object.assign({}, d));
  let useFea = true;
  let startDate = DEFAULT_START;
  let labels = [];

  const $ = id => document.getElementById(id);
  const solver = () => (typeof window.solver !== 'undefined' ? window.solver : null);
  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
  const h = v => (Math.round(v * 10) / 10).toString();
  const lvTxt = (lv, pct) => lv + ' 級 ' + fmt(pct, 1) + '%';
  const NAMES = ['被遺棄', '暗影', 'ATS'];
  const SOLVER_URL = 'https://cdn.jsdelivr.net/npm/javascript-lp-solver@0.4.24/prod/solver.js';
  const TIMEOUT_MS = 15000;
  let dirty = false, busy = false;

  // ---------- background worker ----------
  let worker = null, jobId = 0;
  const pending = {};
  function makeWorker() {
    try {
      const modelUrl = new URL('model.js', location.href).href;
      const src = "importScripts(" + JSON.stringify(SOLVER_URL) + "," + JSON.stringify(modelUrl) + ");" +
        "self.onmessage=function(e){var d=e.data,res;try{res=d.type==='check'?GameModel.check(self.solver,d.S,d.days,d.useFea):GameModel.suggest(self.solver,d.S,d.days,d.useFea);postMessage({id:d.id,ok:true,res:res});}catch(err){postMessage({id:d.id,ok:false,err:String(err)});}};";
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = e => { const p = pending[e.data.id]; if (p) { delete pending[e.data.id]; clearTimeout(p.timer); p.done(e.data); } };
      w.onerror = () => { Object.keys(pending).forEach(id => { const p = pending[id]; delete pending[id]; clearTimeout(p.timer); p.done({ ok: false, err: 'worker' }); }); worker = null; };
      return w;
    } catch (e) { return null; }
  }
  function runJob(type, payload) {
    return new Promise(resolve => {
      if (!worker) worker = makeWorker();
      if (!worker) { // no worker support: run on the main thread after the loading screen paints
        setTimeout(() => {
          try { resolve({ ok: true, res: type === 'check' ? M.check(solver(), payload.S, payload.days, payload.useFea) : M.suggest(solver(), payload.S, payload.days, payload.useFea) }); }
          catch (err) { resolve({ ok: false, err: String(err) }); }
        }, 50);
        return;
      }
      const id = ++jobId;
      const timer = setTimeout(() => {
        delete pending[id];
        try { worker.terminate(); } catch (e) {}
        worker = null;
        resolve({ ok: false, err: 'timeout' });
      }, TIMEOUT_MS);
      pending[id] = { done: resolve, timer };
      worker.postMessage(Object.assign({ id, type }, JSON.parse(JSON.stringify(payload))));
    });
  }
  function setBusy(on, text) {
    busy = on;
    $('loading').hidden = !on;
    if (text) $('loadingTxt').textContent = text;
    ['btnCalc', 'btnSuggest', 'btnReset'].forEach(id => { $(id).disabled = on; });
  }
  function markDirty() {
    dirty = true;
    document.body.classList.add('is-dirty');
    $('dirtyHint').hidden = false;
    save();
  }

  function makeLabels() {
    const [y, m, d] = startDate.split('-').map(Number);
    labels = Array.from({ length: N }, (_, i) => {
      const t = new Date(y, m - 1, d + i);
      return (t.getMonth() + 1) + '/' + t.getDate() + '（' + WD[t.getDay()] + '）';
    });
    $('rangeTxt').textContent = labels[0] + ' 到 ' + labels[N - 1] + '，共 7 天';
  }
  function syncS() { S.cT = S.cA; S.fT = S.fA; }

  // ---------- storage ----------
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ S, days, useFea, startDate })); } catch (e) {} }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && v.S && Array.isArray(v.days) && v.days.length === N) {
        S = Object.assign({}, DEFAULT_S, v.S);
        days = v.days.map(d => ({ play: +d.play || 0, t: +d.t || 0, a: +d.a || 0, s: +d.s || 0 }));
        useFea = v.useFea !== false;
        if (v.startDate) startDate = v.startDate;
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ---------- plan table ----------
  const FIELDS = [['play', '0.5'], ['t', '0.5'], ['a', '1'], ['s', '1']];
  function buildPlan() {
    let html = '';
    for (let i = 0; i < N; i++) {
      html += '<tr id="pr-' + i + '"><th class="day" id="pd-' + i + '"></th>';
      FIELDS.forEach(([k, step]) => {
        html += '<td><input id="in-' + k + '-' + i + '" data-k="' + k + '" data-i="' + i + '" type="number" min="0" max="24" step="' + step + '" inputmode="decimal"></td>';
      });
      html += '<td class="auto" id="o-ats-' + i + '"></td><td id="o-chk-' + i + '"></td><td class="num" id="o-gain-' + i + '"></td><td class="lvl" id="o-lv-' + i + '"></td></tr>';
    }
    $('planBody').innerHTML = html;
    $('planBody').addEventListener('input', e => {
      const t = e.target; if (!t.dataset.k) return;
      const i = +t.dataset.i;
      days[i][t.dataset.k] = Math.max(0, +t.value || 0);
      liveRow(i); markDirty();
    });
  }
  function fillPlan() {
    for (let i = 0; i < N; i++) FIELDS.forEach(([k]) => { $('in-' + k + '-' + i).value = days[i][k]; });
  }

  const triple = arr => arr.map((v, k) => v ? NAMES[k] + ' ' + v : '').filter(Boolean).join('、') || '<span class="zero">—</span>';

  // ---------- instant per-row feedback (no solver) ----------
  function liveRow(i) {
    const day = days[i], a = day.a, s = day.s, sum = a + s + day.t, spare = day.play - sum;
    $('pd-' + i).textContent = labels[i];
    $('o-ats-' + i).textContent = h(a + s) + ' h';
    let chk;
    if (spare < -1e-9) chk = '<span class="tag bad">超過 ' + h(-spare) + ' h</span>';
    else if (spare > 1e-9) chk = '<span class="tag warn">還有 ' + h(spare) + ' h 沒排</span>';
    else chk = '<span class="tag ok">剛好</span>';
    const idleA = Math.max(0, Math.min(S.freeA, day.play) - a), idleS = Math.max(0, S.freeS - s);
    if (idleA > 0 || idleS > 0) {
      const parts = [];
      if (idleA > 0) parts.push('被遺棄者之地 ' + h(idleA) + ' h');
      if (idleS > 0) parts.push('暗影神殿 ' + h(idleS) + ' h');
      chk += '<span class="note">免費時數沒掛完：' + parts.join('、') + '</span>';
    }
    $('o-chk-' + i).innerHTML = chk;
  }
  function liveAll() { for (let i = 0; i < N; i++) liveRow(i); }

  // ---------- results (after 計算) ----------
  function renderResults(r, note) {
    const alerts = [];
    if (note) alerts.push(['warn', note]);
    let resHtml = '';
    let totPlay = 0, totT = 0, totA = 0, totS = 0;
    r.days.forEach((d, i) => {
      const day = days[i];
      totPlay += day.play; totT += day.t; totA += day.a; totS += day.s;
      liveRow(i);
      if (d.spare < -1e-9) alerts.push(['warn', labels[i] + '：團練＋地圖 ' + h(d.sum) + ' h，超過可玩的 ' + h(day.play) + ' h。']);
      $('o-gain-' + i).textContent = '+' + fmt(d.gain, 2) + '%';
      $('o-lv-' + i).textContent = lvTxt(d.lv, d.pct);
      $('pr-' + i).classList.toggle('short', d.isShort);

      const status = d.isShort
        ? '<span class="tag bad">缺 ' + d.short.map((v, k) => v ? NAMES[k] + ' ' + v + ' h' : '').filter(Boolean).join('、') + '</span>'
        : '<span class="tag ok">夠用</span>';
      if (d.isShort) {
        const why = useFea ? '羽毛和結晶體都換到上限或用完了' : '沒開羽毛兌換，結晶體換到上限或用完了';
        alerts.push(['bad', labels[i] + '：' + d.short.map((v, k) => v ? NAMES[k] + '石頭少 ' + v + ' 顆' : '').filter(Boolean).join('、') + '（' + why + '）。請減少這天的暗影神殿或被遺棄者之地時數，改成團練。']);
      }
      resHtml += '<tr' + (d.isShort ? ' class="short"' : '') + '><th class="day">' + labels[i] + '</th>' +
        '<td class="num">' + d.need.join('／') + '</td>' +
        '<td class="ex">' + (useFea ? triple(d.fea) : '<span class="zero">不使用</span>') + (d.feaCost ? '<span class="note">花 ' + d.feaCost + ' 羽毛</span>' : '') + '</td>' +
        '<td class="ex">' + triple(d.cry) + (d.cryCost ? '<span class="note">花 ' + d.cryCost + ' 結晶</span>' : '') + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="num">' + d.feaLeft + '</td><td class="num">' + d.cryLeft + '</td>' +
        '<td class="num">' + d.bag.join('／') + '</td></tr>';
    });
    $('resBody').innerHTML = resHtml;
    $('planFoot').innerHTML = '<th class="day">合計</th><td class="num">' + h(totPlay) + '</td><td class="num">' + h(totT) + '</td><td class="num">' + h(totA) + '</td><td class="num">' + h(totS) + '</td><td class="auto">' + h(totA + totS) + ' h</td><td></td><td class="num">+' + fmt(r.totalGain, 1) + '%</td><td class="lvl">' + lvTxt(r.lv, r.pct) + '</td>';

    $('sumLv').textContent = lvTxt(r.lv, r.pct);
    $('sumExp').textContent = '一週共 +' + fmt(r.totalGain, 1) + '%（40 級一整級＝100%）';
    const ok = r.firstShort < 0;
    $('sumOk').textContent = ok ? '夠用' : labels[r.firstShort] + ' 開始不夠';
    $('sumOk').className = 'v ' + (ok ? 'okv' : 'badv');
    if (!ok) $('sumOk').style.fontSize = '17px'; else $('sumOk').style.fontSize = '';
    const shortDays = r.days.filter(d => d.isShort).length;
    $('sumOkD').textContent = ok ? '照這個時數排，資源整週都夠' : '共 ' + shortDays + ' 天石頭不足';
    $('sumLeft').textContent = r.cryLeft + '／' + r.feaLeft;
    $('sumLeftD').textContent = useFea ? '羽毛兌換：開啟' : '羽毛兌換：關閉';
    $('sumBag').textContent = r.bag.join('·');

    if (ok && !alerts.some(a => a[0] === 'warn')) alerts.unshift(['ok', '每天的時數都排得出來，羽毛和結晶體整週都夠。']);
    $('alerts').innerHTML = alerts.map(([c, t]) => '<div class="alert' + (c === 'bad' ? '' : ' ' + c) + '">' + t + '</div>').join('');
    dirty = false;
    document.body.classList.remove('is-dirty');
    $('dirtyHint').hidden = true;
    save();
  }

  async function calculate() {
    if (busy) return;
    setBusy(true, '計算中…');
    const t0 = Date.now();
    const out = await runJob('check', { S, days, useFea });
    let r = out.ok ? out.res : null, note = '';
    if (!r) { // timeout or failure: fall back to the quick day-by-day method
      r = M.check(null, S, days, useFea);
      note = out.err === 'timeout' ? '計算超過 15 秒，已改用簡易算法：先用背包、再換羽毛、最後換結晶體。結果可能不是最省的換法。' : '最佳化計算失敗，已改用簡易算法：先用背包、再換羽毛、最後換結晶體。';
    }
    const wait = Math.max(0, 250 - (Date.now() - t0)); // keep the loader visible long enough to read
    setTimeout(() => { renderResults(r, note); setBusy(false); }, wait);
  }

  // ---------- settings ----------
  function bindSettings() {
    Object.keys(DEFAULT_S).forEach(k => {
      const el = $('s_' + k); if (!el) return;
      el.value = S[k];
      el.addEventListener('input', () => {
        S[k] = el.tagName === 'SELECT' ? el.value : (+el.value || 0);
        syncS(); liveAll(); markDirty();
      });
    });
    const sd = $('s_startDate');
    sd.value = startDate;
    sd.addEventListener('change', () => { if (sd.value) { startDate = sd.value; makeLabels(); liveAll(); markDirty(); } });
  }
  function refreshSettings() {
    Object.keys(DEFAULT_S).forEach(k => { const el = $('s_' + k); if (el) el.value = S[k]; });
    $('s_startDate').value = startDate;
  }

  // ---------- actions ----------
  $('useFea').addEventListener('change', e => { useFea = e.target.checked; markDirty(); });
  $('btnCalc').addEventListener('click', calculate);
  $('btnCalc2').addEventListener('click', calculate);
  $('btnSuggest').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true, '排時數中…');
    const out = await runJob('suggest', { S, days: days.map(d => ({ play: d.play })), useFea });
    if (!out.ok || !out.res) {
      setBusy(false);
      $('msg').textContent = out.err === 'timeout' ? '排時數超過 15 秒沒有結果，請稍後再試或手動調整。' : '排不出可行的時數，請檢查設定。';
      return;
    }
    days = out.res.map(d => ({ play: d.play, t: d.t, a: d.a, s: d.s }));
    fillPlan(); liveAll();
    setBusy(false);
    $('msg').textContent = '已依每天的可玩時數排好時數，接著計算資源。';
    calculate();
  });
  $('btnReset').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch (e) {}
    S = Object.assign({}, DEFAULT_S); days = DEFAULT_DAYS.map(d => Object.assign({}, d));
    useFea = true; startDate = DEFAULT_START;
    $('useFea').checked = true; makeLabels(); refreshSettings(); fillPlan(); liveAll();
    $('msg').textContent = '已恢復預設值。';
    calculate();
  });

  // ---------- boot ----------
  const restored = load();
  syncS(); makeLabels(); buildPlan(); bindSettings(); fillPlan();
  $('useFea').checked = useFea;
  liveAll();
  calculate();
  if (restored) $('msg').textContent = '已載入你上次在這台裝置的設定。';
})();
