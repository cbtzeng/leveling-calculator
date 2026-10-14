(function(){
const M = window.GameModel;
const WD = '日一二三四五六';
const todayStr = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); };
let startDate = todayStr();
let DAY_LABELS = [];
function makeLabels(){
  const [y, m, d] = startDate.split('-').map(Number);
  DAY_LABELS = Array.from({length:7}, (_, i) => { const t = new Date(y, m-1, d+i); return (t.getMonth()+1) + '/' + t.getDate() + ' ' + WD[t.getDay()]; });
  const last = DAY_LABELS[6].split(' ');
  const sub = document.getElementById('rangeTxt'); if (sub) sub.textContent = DAY_LABELS[0].split(' ')[0] + '（' + DAY_LABELS[0].split(' ')[1] + '）到 ' + last[0] + '（' + last[1] + '）';
  for (let i = 0; i < 7; i++){ const th = document.getElementById('th-' + i); if (th) th.textContent = DAY_LABELS[i]; }
}
makeLabels();
const N = 7;
const DEFAULT_S = {startLv:40,startPct:93,growth:5,expMode:'abs',rateA:1.08,rateS:1.2,rateT:7,freeA:3,freeS:1,freeT:3,
  crystals:340,feathers0:286,featherDay:60,invA:7,invS:18,invT:19,cA:2,cS:3,cT:2,fA:15,fS:22,fT:15,flimit:3,climit:3};
let S = Object.assign({}, DEFAULT_S);
const blank = (play) => Array.from({length:N}, () => ({play:play, shop:[3,3,3], cry:[0,0,0], fea:[0,0,0], inv:[null,null,null], train:null}));
let plan = blank(17);
let compare = null, compareName = '只買商店';
const $ = id => document.getElementById(id);
const fmt = (v, d=1) => (Math.round(v * 10**d) / 10**d).toFixed(d);
const lvTxt = (lv, pct) => lv + ' 級 ' + fmt(pct, 1) + '%';
const hasSolver = () => typeof window.solver !== 'undefined';

function syncS(){ // keep cT/fT tied to A prices (same price in game)
  S.cT = S.cA; S.fT = S.fA;
}
function shopOnly(src){ return src.map(d => ({play:d.play, shop:d.shop.slice(), cry:[0,0,0], fea:[0,0,0], inv:[null,null,null], train:null})); }
function origPlan(src){ return src.map(d => ({play:d.play, shop:d.shop.slice(), cry:[0,0,1], fea:[0,0,3], inv:[3,null,null], train:null})); }
function runOpt(src, s){ return hasSolver() ? M.optimize(window.solver, s || S, src.map(d => ({play:d.play, shop:d.shop.slice()}))) : null; }

// ---------- ledger table ----------
const ROWS = [
  {g:'時間'},
  {k:'play', label:'可玩上限（小時）', inp:true},
  {k:'train', label:'團練時數', inp:true, ph:'自動'},
  {g:'商店購買（每種 0–3）'},
  {k:'shop.0', label:'被遺棄者之地', dot:'--aban', inp:true},
  {k:'shop.1', label:'暗影神殿', dot:'--shadow', inp:true},
  {k:'shop.2', label:'ATS', dot:'--gold', inp:true},
  {g:'結晶體兌換'},
  {k:'cry.0', label:'被遺棄者之地（2）', dot:'--aban', inp:true},
  {k:'cry.1', label:'暗影神殿（3）', dot:'--shadow', inp:true},
  {k:'cry.2', label:'ATS（2）', dot:'--gold', inp:true},
  {g:'羽毛兌換'},
  {k:'fea.0', label:'被遺棄者之地（15）', dot:'--aban', inp:true},
  {k:'fea.1', label:'暗影神殿（22）', dot:'--shadow', inp:true},
  {k:'fea.2', label:'ATS（15）', dot:'--gold', inp:true},
  {g:'當天從背包使用石頭（留空＝自動：被遺棄不用、暗影／ATS 需要多少用多少）'},
  {k:'inv.0', label:'被遺棄者之地', dot:'--aban', inp:true, ph:'自動'},
  {k:'inv.1', label:'暗影神殿', dot:'--shadow', inp:true, ph:'自動'},
  {k:'inv.2', label:'ATS', dot:'--gold', inp:true, ph:'自動'},
  {g:'結果'},
  {o:'hangS', label:'暗影神殿 掛機', dot:'--shadow'},
  {o:'hangA', label:'被遺棄者之地 掛機', dot:'--aban'},
  {o:'ats', label:'ATS 已用／可用', dot:'--gold'},
  {o:'train', label:'團練', dot:'--train'},
  {o:'play', label:'當天總遊玩時數'},
  {o:'gain', label:'當天經驗（40 級 %）'},
  {o:'lv', label:'當天結束等級', cls:'lvl'},
  {o:'cry', label:'結晶體剩餘'},
  {o:'fea', label:'羽毛剩餘'},
  {o:'inv', label:'日終背包（遺棄／暗影／ATS）'},
];
function buildLedger(){
  let h = '<thead><tr><th class="rl">項目</th>' + DAY_LABELS.map((l, i) => '<th id="th-' + i + '">' + l + '</th>').join('') + '</tr></thead><tbody>';
  ROWS.forEach((r, ri) => {
    if (r.g){ h += '<tr class="grp"><th colspan="' + (N+1) + '">' + r.g + '</th></tr>'; return; }
    const dot = r.dot ? '<span class="dot" style="background:var(' + r.dot + ')"></span>' : '';
    h += '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '><th class="rl">' + dot + r.label + '</th>';
    for (let i = 0; i < N; i++){
      if (r.inp) h += '<td><input id="in-' + r.k.replace('.', '_') + '-' + i + '" data-k="' + r.k + '" data-i="' + i + '" type="number" min="0" step="' + (r.k === 'play' || r.k === 'train' ? '0.5' : '1') + '"' + (r.ph ? ' placeholder="' + r.ph + '"' : '') + ' aria-label="' + DAY_LABELS[i] + ' ' + r.label + '"></td>';
      else h += '<td class="out" id="o-' + r.o + '-' + i + '"></td>';
    }
    h += '</tr>';
  });
  $('ledger').innerHTML = h + '</tbody>';
  $('ledger').addEventListener('input', e => {
    const t = e.target; if (!t.dataset.k) return;
    const i = +t.dataset.i, k = t.dataset.k, v = t.value;
    if (k === 'train') plan[i].train = v === '' ? null : Math.max(0, +v);
    else if (k.startsWith('inv.')) plan[i].inv[+k.split('.')[1]] = v === '' ? null : Math.max(0, Math.round(+v || 0));
    else if (k === 'play') plan[i].play = Math.max(0, +v || 0);
    else { const [a, b] = k.split('.'); plan[i][a][+b] = Math.max(0, Math.round(+v || 0)); }
    render(false);
  });
}
function fillInputs(){
  ROWS.filter(r => r.inp).forEach(r => {
    for (let i = 0; i < N; i++){
      const el = $('in-' + r.k.replace('.', '_') + '-' + i);
      let v;
      if (r.k === 'train') v = plan[i].train == null ? '' : plan[i].train;
      else if (r.k === 'play') v = plan[i].play;
      else { const [a, b] = r.k.split('.'); v = plan[i][a][+b]; if (v == null) v = ''; }
      el.value = v;
    }
  });
}

// ---------- persistence ----------
const KEY = 'leveling-calc-v2';
function save(){ try { localStorage.setItem(KEY, JSON.stringify({S, plan, startDate})); } catch(e){} }
function load(){ try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && v.S && Array.isArray(v.plan) && v.plan.length === 7){ S = Object.assign({}, DEFAULT_S, v.S); plan = v.plan.map(d => Object.assign({inv:[null,null,null], train:null}, d)); if (v.startDate) startDate = v.startDate; return true; } } catch(e){} return false; }

// ---------- render ----------
function render(refill){
  if (refill) fillInputs();
  save();
  const e = M.evaluate(S, plan);
  const base = M.evaluate(S, compare || shopOnly(plan));
  const warns = [];
  e.days.forEach((d, i) => {
    const set = (o, html, bad) => { const c = $('o-' + o + '-' + i); c.innerHTML = html; c.classList.toggle('bad', !!bad); };
    set('hangS', fmt(d.hangS,0) + ' h' + (d.freeIdleS > 0 ? '<span class="idle">免費 ' + d.freeIdleS + ' h 沒掛</span>' : ''), d.freeIdleS > 0);
    set('hangA', fmt(d.hangA,0) + ' h' + (d.hangAx > 0 ? '<span class="of">（免費 ' + d.hangAfree + '＋石頭 ' + d.hangAx + '）</span>' : '') + (d.freeIdleA > 0 ? '<span class="idle">免費 ' + d.freeIdleA + ' h 沒掛</span>' : ''), d.freeIdleA > 0);
    set('ats', fmt(d.hang,0) + '<span class="of">／' + d.ats + '</span>');
    set('train', fmt(d.train, 1) + ' h');
    set('play', fmt(d.playTotal, 1) + ' h', d.overPlay);
    set('gain', fmt(d.gain, 2));
    set('lv', lvTxt(d.lv, d.pct));
    set('cry', fmt(d.cryLeft, 0), d.cryOver);
    set('fea', fmt(d.feaLeft, 0) + '<span class="of">／' + fmt(d.feaAvail,0) + '</span>', d.feaOver);
    set('inv', d.bag.join('／'), d.useOver);
    const L = DAY_LABELS[i];
    if (d.overPlay) warns.push(L + '：遊玩時數超過可玩上限');
    if (d.feaOver) warns.push(L + '：羽毛不夠');
    if (d.limitOver) warns.push(L + '：超過每日兌換上限');
    if (d.freeIdleA > 0 || d.freeIdleS > 0) warns.push(L + '：免費時數沒掛完');
    if (d.useOver) warns.push(L + '：要用的石頭比背包裡多');
  });
  const last = e.days[N-1];
  if (last.cryLeft < 0) warns.push('結晶體超支 ' + fmt(-last.cryLeft,0) + ' 個');
    $('warns').innerHTML = warns.length ? warns.map(w => '<span class="chip">' + w + '</span>').join('') : '<span class="chip okc">配置可行，沒有超支</span>';

  $('sumLv').textContent = lvTxt(e.lv, e.pct);
  const dl = e.levelFloat - base.levelFloat;
  $('sumLvD').innerHTML = '比「' + compareName + '」' + (dl >= 0 ? '<span class="up">多 ' : '<span class="down">少 ') + fmt(Math.abs(dl) * 100, 1) + '%（約 ' + fmt(Math.abs(dl), 2) + ' 級）</span>';
  $('sumExp').textContent = fmt(e.totalGain, 1);
  const dg = e.totalGain - base.totalGain;
  $('sumExpD').innerHTML = (dg >= 0 ? '<span class="up">+' : '<span class="down">') + fmt(dg, 1) + '</span> vs 比較基準';
  const tp = e.days.reduce((a, d) => a + d.playTotal, 0), th = e.days.reduce((a, d) => a + d.hang, 0);
  $('sumPlay').textContent = fmt(tp, 1) + ' h';
  $('sumPlayD').textContent = '掛機 ' + fmt(th,0) + ' h・團練 ' + fmt(tp - th, 1) + ' h';
  $('sumLeft').textContent = fmt(last.cryLeft,0) + '／' + fmt(last.feaLeft,0) + '／' + last.bag.join('·');
  $('cmpName').textContent = '比較基準：' + compareName;
  drawChart(e, base);
}

function drawChart(e, base){
  const W = 720, H = 240, pl = 52, pr = 16, pt = 14, pb = 34;
  const s0 = S.startLv + S.startPct / 100;
  const a = [s0].concat(e.days.map(d => d.lv + d.pct/100));
  const b = [s0].concat(base.days.map(d => d.lv + d.pct/100));
  const lo = Math.floor(Math.min(...a, ...b) * 2) / 2, hi = Math.ceil(Math.max(...a, ...b) * 2) / 2;
  const x = i => pl + i * (W - pl - pr) / N;
  const y = v => pt + (hi - v) * (H - pt - pb) / (hi - lo || 1);
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += 0.5){
    const whole = Math.abs(v - Math.round(v)) < 1e-9;
    g += '<line x1="' + pl + '" x2="' + (W-pr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="' + (whole ? 1 : 0.5) + '"/>';
    g += '<text x="' + (pl-8) + '" y="' + (y(v)+4) + '" text-anchor="end" font-size="11" fill="var(--muted)" font-family="Chakra Petch,sans-serif">' + (whole ? v + ' 級' : '') + '</text>';
  }
  const lbl = ['開始'].concat(DAY_LABELS.map(l => l.split(' ')[0]));
  lbl.forEach((l, i) => { g += '<text x="' + x(i) + '" y="' + (H-12) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + l + '</text>'; });
  const path = arr => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = path(a) + ' L' + x(N) + ' ' + y(lo) + ' L' + x(0) + ' ' + y(lo) + ' Z';
  g += '<path d="' + area + '" fill="var(--gold)" opacity="0.10"/>';
  g += '<path d="' + path(b) + '" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-dasharray="5 4"/>';
  g += '<path d="' + path(a) + '" fill="none" stroke="var(--gold)" stroke-width="2.4"/>';
  a.forEach((v, i) => { g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === N ? 4.5 : 3) + '" fill="var(--gold)"/>'; });
  const fl = e.lv + ' 級 ' + fmt(e.pct,1) + '%';
  g += '<text x="' + (x(N)-6) + '" y="' + (y(a[N])-10) + '" text-anchor="end" font-size="12" font-weight="600" fill="var(--gold)" font-family="Chakra Petch,sans-serif">' + fl + '</text>';
  $('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="每日等級進度">' + g + '</svg>';
}

// ---------- scenario report ----------
function scenarios(){
  const rows = [];
  const play = plan.map(d => d.play);
  const withPlay = P => blank(17).map((d, i) => Object.assign(d, {play: P == null ? play[i] : P, shop: plan[i].shop.slice()}));
  const ev = (name, p, s, tag) => { const r = M.evaluate(s || S, p); rows.push({name, tag, lv:r.lv, pct:r.pct, gain:r.totalGain, lf:r.levelFloat}); };
  ev('只買商店', shopOnly(withPlay(null)));
  ev('原本打算：每天換 4 顆 ATS', origPlan(withPlay(null)));
  if (hasSolver()){
    const sU = Object.assign({}, S, {climit: 0}), s3 = Object.assign({}, S, {climit: S.climit > 0 ? S.climit : 3});
    [16,17,18].forEach(P => {
      const p3 = runOpt(withPlay(P), s3); if (p3) ev('最佳・每天玩 ' + P + ' h', p3, s3, '結晶每天≤' + s3.climit);
    });
    [16,17,18].forEach(P => {
      const pu = runOpt(withPlay(P), sU); if (pu) ev('最佳・每天玩 ' + P + ' h', pu, sU, '結晶不限');
    });
  }
  const base = rows[0].lf;
  const best = Math.max(...rows.map(r => r.lf));
  $('report').innerHTML = '<thead><tr><th>方案</th><th>週末等級</th><th>總經驗</th><th>比只買商店</th></tr></thead><tbody>' +
    rows.map(r => '<tr' + (r.lf === best ? ' class="best"' : '') + '><td>' + r.name + (r.tag ? '<span class="tag">' + r.tag + '</span>' : '') + '</td><td class="num">' + lvTxt(r.lv, r.pct) + '</td><td class="num">' + fmt(r.gain, 1) + '</td><td class="num">+' + fmt((r.lf - base) * 100, 1) + '%</td></tr>').join('') + '</tbody>';
  $('repMsg').textContent = hasSolver() ? '前兩列用「每日配置」裡的可玩時數；最佳方案列固定每天玩 16／17／18 小時，商店照目前購買數。' : '最佳化模組沒載入，只顯示前兩個方案。';
  insights();
}
function insights(){
  const hS = S.rateS * 3, hA = S.rateA * 3, hT = S.rateT / 3;
  const li = [
    '每小時經驗：暗影神殿 ' + fmt(hS,2) + '%、被遺棄者之地 ' + fmt(hA,2) + '%、團練 ' + fmt(hT,2) + '%。能掛機就不要團練，掛機先排暗影神殿。',
    'ATS 是瓶頸：每顆 ATS 石頭都要搭一顆地圖石頭（或免費時數）才能掛機。免費時數 ' + (S.freeA+S.freeS) + ' h 比免費 ATS ' + S.freeT + ' h 多，所以 ATS 永遠先缺。羽毛和結晶都先換 ATS。',
    '換完 ATS 之後，第二優先是「暗影神殿石頭＋ATS 石頭」一組（每組比團練多 ' + fmt(hS-hT,2) + '%），比被遺棄者之地那組（多 ' + fmt(hA-hT,2) + '%）划算，所以不用另外換被遺棄者之地石頭。',
    '每天先掛完免費時數（被遺棄者之地 ' + S.freeA + ' h、暗影神殿 ' + S.freeS + ' h），剩下的 ATS 全部給暗影神殿。被遺棄者之地石頭多半用不到，會留在背包給下週。',
    '石頭買了或換了都進背包，可以晚幾天再用。背包裡的暗影和 ATS 要成對才有用，ATS 不夠時暗影石頭會卡在背包。',
    '結晶體每天兌換上限是關鍵：每種每天只能換 3 個時，結晶用不完，羽毛才是瓶頸；結晶不限量時，可以把大部分時間都排暗影神殿。',
  ];
  $('insight').innerHTML = li.map(t => '<li>' + t + '</li>').join('');
}

// ---------- settings ----------
function bindSettings(){
  Object.keys(DEFAULT_S).forEach(k => {
    const el = $('s_' + k); if (!el) return;
    el.value = S[k];
    el.addEventListener('input', () => {
      S[k] = el.tagName === 'SELECT' ? el.value : (+el.value || 0);
      syncS(); render(false); clearTimeout(bindSettings.t); bindSettings.t = setTimeout(scenarios, 400);
    });
  });
}

function doOptimize(){
  if (!hasSolver()){ $('msg').textContent = '最佳化模組沒有載入，請重新整理頁面再試。'; return; }
  const p = runOpt(plan);
  if (!p){ $('msg').textContent = '找不到可行的配置，請檢查設定。'; return; }
  plan = p; render(true); $('msg').textContent = '已依目前設定、可玩時數與商店購買數算出最佳兌換與庫存用法。';
}
$('btnOpt').addEventListener('click', doOptimize);
$('btnShop').addEventListener('click', () => { plan = shopOnly(plan); render(true); $('msg').textContent = '已改成只買商店。'; });
$('btnOrig').addEventListener('click', () => { plan = origPlan(plan); render(true); $('msg').textContent = '已改成每天換 4 顆 ATS（羽毛 3＋結晶 1），不用庫存。'; });
$('btnPin').addEventListener('click', () => { compare = JSON.parse(JSON.stringify(plan)); compareName = '已鎖定方案'; render(false); $('msg').textContent = '已把目前方案設為比較基準，接著調整數字就能看差距。'; });

const restored = load();
makeLabels(); syncS(); buildLedger(); bindSettings();
const sd = $('s_startDate'); sd.value = startDate;
sd.addEventListener('change', () => { if (sd.value){ startDate = sd.value; makeLabels(); render(false); } });
$('btnReset').addEventListener('click', () => {
  try { localStorage.removeItem(KEY); } catch(e){}
  S = Object.assign({}, DEFAULT_S); startDate = todayStr(); sd.value = startDate; makeLabels();
  Object.keys(DEFAULT_S).forEach(k => { const el = $('s_' + k); if (el) el.value = S[k]; });
  plan = blank(17); const p = runOpt(plan); if (p) plan = p; compare = null; compareName = '只買商店';
  render(true); scenarios(); $('msg').textContent = '已恢復預設值並重新最佳化。';
});
if (restored) $('msg').textContent = '已載入你上次在這台裝置的設定。';
else if (hasSolver()){ const p = runOpt(plan); if (p) plan = p; }
render(true); scenarios();
})();
