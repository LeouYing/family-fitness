/* Family Fitness app (v4)
   Plain JavaScript, no build step. Screens are drawn by the view*() functions,
   clicks are handled in onClick(), forms in onSubmit(). */
(() => {
  'use strict';

  // =====================================================================
  // Setup
  // =====================================================================
  const cfg = window.APP_CONFIG || {};
  const configured =
    typeof cfg.SUPABASE_URL === 'string' && cfg.SUPABASE_URL.startsWith('https://') &&
    !cfg.SUPABASE_URL.includes('YOUR-PROJECT') &&
    typeof cfg.SUPABASE_KEY === 'string' && cfg.SUPABASE_KEY.length > 20 &&
    !cfg.SUPABASE_KEY.includes('YOUR-');
  const libsLoaded = !!window.supabase;
  const db = configured && libsLoaded
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = $('#app');

  const COLORS = ['#3B6FD8', '#E0567A', '#2FA37A', '#8B5CF6', '#F08A24', '#1FA6B8', '#B8862B', '#64748B'];

  // accumulates: whether adding entries up makes sense (for monthly totals)
  const UNIT_TYPES = {
    reps:     { label: 'Reps',     units: ['reps'],           accumulates: true },
    weight:   { label: 'Weight',   units: ['kg', 'lb'],       accumulates: false },
    duration: { label: 'Time',     units: [''],               accumulates: false },
    distance: { label: 'Distance', units: ['km', 'mi', 'm'],  accumulates: true },
    custom:   { label: 'Other',    units: null,               accumulates: true },
  };

  const SUGGESTIONS = [
    { name: 'Push-ups',      unit_type: 'reps',     unit_label: 'reps',  higher_is_better: true },
    { name: 'Squats',        unit_type: 'reps',     unit_label: 'reps',  higher_is_better: true },
    { name: 'Plank',         unit_type: 'duration', unit_label: '',      higher_is_better: true },
    { name: 'Walk',          unit_type: 'distance', unit_label: 'km',    higher_is_better: true },
    { name: '5 km run',      unit_type: 'duration', unit_label: '',      higher_is_better: false },
    { name: 'Skipping rope', unit_type: 'reps',     unit_label: 'skips', higher_is_better: true },
  ];

  // Activities an exercise can count as for sport calories.
  // met = intensity (kcal per kg per hour), perKm / perRep = kcal per kg.
  const SPORTS = {
    walking:    { label: 'Walking',           met: 3.5,  perKm: 0.65 },
    running:    { label: 'Running',           met: 9.0,  perKm: 1.0 },
    cycling:    { label: 'Cycling',           met: 7.0,  perKm: 0.35 },
    swimming:   { label: 'Swimming',          met: 7.0,  perKm: 3.5 },
    rowing:     { label: 'Rowing',            met: 7.0,  perKm: 0.6 },
    elliptical: { label: 'Elliptical',        met: 5.0 },
    strength:   { label: 'Strength / core',   met: 3.8,  perRep: 0.005 },
    skipping:   { label: 'Skipping rope',     met: 11.0, perRep: 0.0017 },
    racket:     { label: 'Racket sports',     met: 5.5 },
    team:       { label: 'Team sports',       met: 7.5 },
    yoga:       { label: 'Yoga / stretching', met: 2.8 },
    dancing:    { label: 'Dancing',           met: 5.0 },
    hiking:     { label: 'Hiking',            met: 6.0,  perKm: 0.8 },
  };
  // Guess the activity from the exercise name (first match wins)
  const SPORT_GUESS = [
    [/skip|jump.?rope|跳绳/i, 'skipping'],
    [/plank|push|pull|squat|lunge|sit.?up|crunch|burpee|平板|俯卧撑|引体|深蹲|仰卧|卷腹|弓步/i, 'strength'],
    [/pickle|tennis|badminton|squash|padel|ping.?pong|匹克|网球|羽毛球|乒乓|壁球/i, 'racket'],
    [/football|soccer|basket|volley|rugby|hockey|足球|篮球|排球/i, 'team'],
    [/yoga|stretch|pilates|瑜伽|拉伸|普拉提/i, 'yoga'],
    [/danc|zumba|跳舞|舞/i, 'dancing'],
    [/hike|hiking|爬山|徒步|登山/i, 'hiking'],
    [/swim|游泳/i, 'swimming'],
    [/row|划船/i, 'rowing'],
    [/ellip|cross.?train|椭圆/i, 'elliptical'],
    [/cycl|bike|spin|骑|单车|自行车|动感/i, 'cycling'],
    [/walk|步行|走路|散步|健走/i, 'walking'],
    [/run|jog|跑/i, 'running'],
  ];

  const RANGES = [['30', 'Month'], ['90', '3 months'], ['365', 'Year'], ['all', 'All']];

  // Saved on this phone only
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const state = {
    code: store.get('ff_code'),
    meId: store.get('ff_member'),
    range: store.get('ff_range') || '90',
    timerTab: 'stopwatch',
    data: null,
    error: null,
    lastLoad: 0,
    body: null,          // this person's private body page data
    bodyLocked: false,   // 'required' | 'wrong' when a PIN is needed
    bodyError: null,
    bodyLoading: false,
  };

  // =====================================================================
  // Database calls
  // =====================================================================
  function friendly(message) {
    const m = String(message || '');
    if (m.includes('FAMILY_NOT_FOUND')) return 'No family uses that code. Check the letters and try again.';
    if (m.includes('NOT_IN_FAMILY')) return 'That item is no longer in this family. Reopen the app to refresh.';
    if (m.includes('NAME_REQUIRED')) return 'Enter a name first.';
    if (m.includes('TOO_MANY_MEMBERS')) return 'This family has reached the 30-member limit.';
    if (m.includes('BAD_VALUE')) return 'Enter a number of 0 or more.';
    if (m.includes('PIN_REQUIRED') || m.includes('PIN_WRONG')) return 'That PIN isn’t right. Try again.';
    if (m.includes('BAD_PIN')) return 'The PIN must be exactly 4 digits.';
    if (m.includes('BAD_GOAL')) return 'That goal doesn’t fit this exercise. Check the goal type and date.';
    if (m.includes('Could not find the function') || m.includes('PGRST202'))
      return 'The database needs updating. Run supabase-setup.sql again in Supabase (see README).';
    if (m.includes('Invalid API key') || m.includes('No API key'))
      return 'The key in config.js isn’t accepted. Copy the publishable key again (README step 3).';
    if (/fetch|network|Load failed|timeout/i.test(m)) return 'Couldn’t reach the server. Check your internet connection and try again.';
    return m || 'Something went wrong. Try again.';
  }

  // Calls a database function. Gives up after 15 seconds, and retries
  // automatically if the connection drops (saves carry their own id, so a
  // retry can never create a duplicate).
  async function rpc(fn, args = {}, { retries = 1 } = {}) {
    if (!db) throw new Error('The app isn’t connected to a database yet.');
    for (let attempt = 0; ; attempt++) {
      let res = null, netErr = null;
      try {
        res = await Promise.race([
          db.rpc(fn, args),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Network timeout')), 15000)),
        ]);
      } catch (e) { netErr = e; }
      if (!netErr && !res.error) return res.data;
      const raw = netErr ? String(netErr.message || netErr) : String(res.error.message || res.error.code || '');
      const isNetwork = !!netErr || /fetch|network|Load failed|timeout/i.test(raw);
      if (isNetwork && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      const err = new Error(friendly(raw));
      err.raw = raw;
      throw err;
    }
  }

  async function loadFamily() {
    if (!state.code) return;
    try {
      const d = await rpc('get_family', { p_code: state.code });
      d.entries.forEach((e) => { e.value = Number(e.value); });
      d.shared_weights = (d.shared_weights || []).map((w) => ({ ...w, delta: Number(w.delta) }));
      d.goals = (d.goals || []).map((g) => ({
        ...g,
        target_value: Number(g.target_value),
        start_value: g.start_value == null ? null : Number(g.start_value),
      }));
      state.data = d;
      state.code = d.family.code;
      store.set('ff_code', state.code);
      state.error = null;
      state.lastLoad = Date.now();
      if (state.meId && !d.members.some((m) => m.id === state.meId)) setMe(null);
    } catch (err) {
      if (err.message.startsWith('No family uses')) {
        leaveFamily();
        toast('That family code no longer works. Enter it again or start a new family.');
      } else {
        state.error = err.message;
      }
    }
  }

  // =====================================================================
  // Small helpers
  // =====================================================================
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  // Look up a form field by name (form.name / form.dir would hit built-in properties)
  const fld = (form, n) => form.elements.namedItem(n);
  // Accepts "2.5" and "2,5" (some phones type a decimal comma)
  const parseNum = (v) => { const t = String(v ?? '').trim().replace(',', '.'); return t === '' ? NaN : Number(t); };
  const newId = () => (window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      }));
  // ----- Sport calories from exercises -----
  const isKcalUnit = (ex) => ex.unit_type === 'custom' &&
    /^(k?cals?|calories?|卡|千卡|大卡|卡路里)$/i.test(String(ex.unit_label || '').trim());
  function sportOptions(ex) {
    if (ex.unit_type === 'weight') return [];
    if (ex.unit_type === 'custom') return ['kcal'];
    const keys = Object.keys(SPORTS);
    if (ex.unit_type === 'distance') return keys.filter((k) => SPORTS[k].perKm);
    if (ex.unit_type === 'reps') return keys.filter((k) => SPORTS[k].perRep);
    return keys; // time
  }
  function guessSport(name, ex) {
    if (isKcalUnit(ex)) return 'kcal';
    const opts = sportOptions(ex);
    for (const [re, k] of SPORT_GUESS) if (re.test(name || '') && opts.includes(k)) return k;
    return 'none';
  }
  // What an exercise actually counts as (null = doesn't count)
  function sportOf(ex) {
    const a = ex.sport_activity;
    if (a === 'none') return null;
    if (a === 'kcal' || SPORTS[a]) return a;
    return isKcalUnit(ex) ? 'kcal' : null; // exercises logged in kcal count automatically
  }
  function entryKcal(ex, value, kg) {
    const a = sportOf(ex);
    if (!a) return 0;
    if (a === 'kcal') return value;
    const sp = SPORTS[a];
    if (ex.unit_type === 'duration') return sp.met * kg * (value / 3600);
    if (ex.unit_type === 'distance' && sp.perKm) {
      const km = ex.unit_label === 'mi' ? value * 1.609 : ex.unit_label === 'm' ? value / 1000 : value;
      return sp.perKm * kg * km;
    }
    if (ex.unit_type === 'reps' && sp.perRep) return sp.perRep * kg * value;
    return 0;
  }

  const sortByDate = (list) => list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  function setMe(id) {
    state.meId = id;
    store.set('ff_member', id);
    state.body = null; state.bodyLocked = false; state.bodyError = null;
  }
  function leaveFamily() {
    state.code = null; state.data = null; state.error = null;
    store.set('ff_code', null); setMe(null);
  }

  const me = () => state.data && state.data.members.find((m) => m.id === state.meId);
  const memberById = (id) => state.data.members.find((m) => m.id === id);
  const exerciseById = (id) => state.data.exercises.find((e) => e.id === id);
  const entriesFor = (exId) => state.data.entries.filter((e) => e.exercise_id === exId);
  const goalFor = (exId) => state.data.goals.find((g) => g.exercise_id === exId);
  const exercisesOf = (memberId, archived = false) =>
    state.data.exercises.filter((e) => e.member_id === memberId && !!e.archived === archived);

  // ----- Dates ("YYYY-MM-DD" in the person's own calendar) -----
  function isoFromDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function todayISO() { return isoFromDate(new Date()); }
  function daysAgoISO(n) { return isoFromDate(addDays(new Date(), -n)); }
  function daysBetween(aISO, bISO) { return Math.round((parseISO(bISO) - parseISO(aISO)) / 86400000); }
  function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); }
  function monthStartISO() { const d = new Date(); return isoFromDate(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function monthEndISO() { const d = new Date(); return isoFromDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
  function lastMonthRange() {
    const d = new Date();
    return [isoFromDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoFromDate(new Date(d.getFullYear(), d.getMonth(), 0))];
  }
  function fmtDate(s) {
    const d = parseISO(s);
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }
  function relDay(s) {
    const diff = daysBetween(s, todayISO());
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return fmtDate(s);
  }
  function timeLeft(days) {
    if (days <= 0) return 'due today';
    if (days === 1) return '1 day left';
    if (days < 14) return `${days} days left`;
    if (days < 70) return `${Math.round(days / 7)} weeks left`;
    return `${Math.round(days / 30)} months left`;
  }

  // ----- Numbers -----
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtNum(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  function fmtValue(ex, v) {
    if (ex.unit_type === 'duration') return fmtDuration(v);
    return ex.unit_label ? `${fmtNum(v)} ${ex.unit_label}` : fmtNum(v);
  }
  function unitWord(ex) {
    if (ex.unit_type === 'duration') return 'time';
    return ex.unit_label || UNIT_TYPES[ex.unit_type].label.toLowerCase();
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ----- Progress maths -----
  const isBetter = (ex, a, b) => (ex.higher_is_better ? a > b : a < b);
  const meets = (ex, v, target) => (ex.higher_is_better ? v >= target : v <= target);

  // One point per day: the best set that day (keeps charts smooth when logging sets)
  function dailyBest(ex, list) {
    const map = new Map();
    list.forEach((e) => {
      const cur = map.get(e.date);
      if (!cur || isBetter(ex, e.value, cur.value)) map.set(e.date, { date: e.date, value: e.value, id: e.id });
    });
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function statsFor(ex, list) {
    const daily = dailyBest(ex, list);
    if (!daily.length) return null;
    const latest = daily[daily.length - 1];
    const first = daily[0];
    let best = daily[0];
    daily.forEach((d) => { if (isBetter(ex, d.value, best.value)) best = d; });
    const change = latest.value - first.value;
    const mood = change === 0 ? 'flat' : ((ex.higher_is_better ? change > 0 : change < 0) ? 'good' : 'bad');
    return { latest, first, best, change, mood, days: daily.length, count: list.length };
  }
  function fmtChange(ex, change) {
    if (change === 0) return 'No change';
    const sign = change > 0 ? '+' : '−';
    const abs = Math.abs(change);
    return sign + (ex.unit_type === 'duration' ? fmtDuration(abs) : fmtNum(abs));
  }

  function inRange(list) {
    if (state.range === 'all') return list;
    const cutoff = daysAgoISO(Number(state.range));
    return list.filter((e) => e.date >= cutoff);
  }

  // ----- Goals -----
  function goalProgress(ex, g) {
    const today = todayISO();
    const entries = entriesFor(ex.id);

    if (g.kind === 'monthly') {
      const start = monthStartISO();
      const total = entries.filter((e) => e.date >= start && e.date <= today).reduce((s, e) => s + e.value, 0);
      return {
        kind: 'monthly', total,
        pct: Math.min(1, total / g.target_value),
        reached: total >= g.target_value,
        remaining: Math.max(0, g.target_value - total),
        daysLeft: daysBetween(today, monthEndISO()) + 1, // including today
      };
    }

    // Target by a date: counts entries from the day it was set until the due date
    const inWindow = entries.filter((e) => e.date >= g.start_date && e.date <= g.due_date);
    let current = null, reachedDate = null;
    inWindow.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
      if (current === null || isBetter(ex, e.value, current)) current = e.value;
      if (!reachedDate && meets(ex, e.value, g.target_value)) reachedDate = e.date;
    });
    let base = g.start_value;
    if (base == null) base = inWindow.length ? dailyBest(ex, inWindow)[0].value : (ex.higher_is_better ? 0 : null);
    const reached = !!reachedDate;
    let pct = 0;
    if (reached) pct = 1;
    else if (current !== null && base !== null && g.target_value !== base) {
      pct = Math.max(0, Math.min(1, (current - base) / (g.target_value - base)));
    }
    const daysLeft = daysBetween(today, g.due_date);
    const span = Math.max(1, daysBetween(g.start_date, g.due_date));
    const expected = Math.max(0, Math.min(1, daysBetween(g.start_date, today) / span));
    return {
      kind: 'target', current, pct, reached, reachedDate, daysLeft,
      overdue: !reached && daysLeft < 0,
      onTrack: pct >= expected - 0.1,
    };
  }

  // Short version for Home and Family (null = nothing to show)
  function goalMini(ex) {
    const g = goalFor(ex.id);
    if (!g) return null;
    const p = goalProgress(ex, g);
    if (p.kind === 'target' && p.overdue) return null;
    const pct = Math.round(p.pct * 100);
    return { pct, reached: p.reached, kind: p.kind };
  }

  // ----- Weekly habit (weeks run Monday to Sunday) -----
  function activeDates(memberId) {
    return new Set(state.data.entries.filter((e) => e.member_id === memberId).map((e) => e.date));
  }
  function weekInfo(memberId) {
    const set = activeDates(memberId);
    const mon = mondayOf(new Date());
    const today = todayISO();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i);
      const iso = isoFromDate(d);
      return { iso, on: set.has(iso), today: iso === today, letter: d.toLocaleDateString(undefined, { weekday: 'narrow' }) };
    });
    return { days, count: days.filter((d) => d.on).length };
  }
  function weeklyStreak(member) {
    const goal = member.weekly_goal;
    if (!goal) return 0;
    const set = activeDates(member.id);
    const mon = mondayOf(new Date());
    const countWeek = (start) => { let c = 0; for (let i = 0; i < 7; i++) if (set.has(isoFromDate(addDays(start, i)))) c++; return c; };
    let streak = countWeek(mon) >= goal ? 1 : 0; // this week counts once it's met
    for (let w = 1; w < 520 && countWeek(addDays(mon, -7 * w)) >= goal; w++) streak++;
    return streak;
  }

  function sparkline(points, color, w = 120, h = 40) {
    const p = 5;
    if (!points.length) {
      return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <line x1="${p}" y1="${h / 2}" x2="${w - p}" y2="${h / 2}" stroke="var(--line)" stroke-width="2" stroke-dasharray="4 5"/></svg>`;
    }
    const xs = points.map((e) => parseISO(e.date).getTime());
    const ys = points.map((e) => e.value);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const px = (x) => (maxX === minX ? w / 2 : p + ((x - minX) / (maxX - minX)) * (w - 2 * p));
    const py = (y) => (maxY === minY ? h / 2 : h - p - ((y - minY) / (maxY - minY)) * (h - 2 * p));
    const pts = points.map((e, i) => `${px(xs[i]).toFixed(1)},${py(ys[i]).toFixed(1)}`);
    const last = pts[pts.length - 1].split(',');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      ${pts.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>` : ''}
      <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${color}"/></svg>`;
  }

  const ICONS = {
    home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    timer: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5"/><path d="M10 2.5h4"/><path d="M18.5 6.5l1.5-1.5"/></svg>',
    family: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><circle cx="17" cy="9.5" r="2.6"/><path d="M2.5 20c0-3.3 2.5-5.8 5.5-5.8s5.5 2.5 5.5 5.8"/><path d="M14.5 15.2c.7-.4 1.6-.7 2.5-.7 2.5 0 4.5 2.1 4.5 4.8"/></svg>',
    body: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M7.5 10a4.5 4.5 0 0 1 9 0"/><path d="M12 10l1.8-2.2"/></svg>',
    trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  };

  // =====================================================================
  // Toast messages
  // =====================================================================
  let toastTimer = null;
  function toast(msg, celebrate = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('celebrate', celebrate);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), celebrate ? 3500 : 2600);
  }

  // =====================================================================
  // Timers (stopwatch + countdown). They keep running while you move
  // between screens.
  // =====================================================================
  const sw = { running: false, t0: 0, base: 0 };
  const cd = { running: false, t0: 0, base: 0, total: 60000, done: false };
  const swMs = () => sw.base + (sw.running ? Date.now() - sw.t0 : 0);
  const cdLeft = () => Math.max(0, cd.total - (cd.base + (cd.running ? Date.now() - cd.t0 : 0)));
  const RING_C = 2 * Math.PI * 54;

  function swParts(ms) {
    const t = Math.floor(ms / 100);
    return { main: fmtDuration(Math.floor(t / 10)), tail: '.' + (t % 10) };
  }
  const cdText = (ms) => fmtDuration(Math.ceil(ms / 1000));
  function presetLabel(s) {
    if (s < 60) return `${s} s`;
    return s % 60 ? fmtDuration(s) : `${s / 60} min`;
  }

  function stopwatchHTML(compact) {
    const ms = swMs(), p = swParts(ms);
    const label = sw.running ? 'Pause' : ms > 0 ? 'Resume' : 'Start';
    return `<div class="timer ${compact ? 'compact' : ''}">
      <div class="clock" role="timer" aria-label="Stopwatch"><span data-sw-main>${p.main}</span><span class="tail" data-sw-tail>${p.tail}</span></div>
      <div class="timer-ctrls">
        <button type="button" class="btn dark" data-action="sw-toggle">${label}</button>
        <button type="button" class="btn" data-action="sw-reset" ${ms === 0 ? 'disabled' : ''}>Reset</button>
      </div>
    </div>`;
  }

  function countdownHTML(compact) {
    const left = cdLeft();
    const frac = cd.total ? left / cd.total : 0;
    const presets = compact ? [30, 60, 90, 120] : [30, 45, 60, 90, 120, 180];
    const label = cd.running ? 'Pause' : cd.done ? 'Start again' : left < cd.total ? 'Resume' : 'Start';
    return `<div class="timer cd ${compact ? 'compact' : ''} ${cd.done ? 'done' : ''}">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="54"/>
          <circle class="ring-fill" data-cd-ring cx="60" cy="60" r="54" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${(RING_C * (1 - frac)).toFixed(2)}"/>
        </svg>
        <div class="clock" role="timer" aria-label="Countdown" data-cd-main>${cdText(left)}</div>
      </div>
      <div class="chips presets">
        ${presets.map((s) => `<button type="button" class="chip" aria-pressed="${cd.total === s * 1000}" data-action="cd-preset" data-sec="${s}">${presetLabel(s)}</button>`).join('')}
      </div>
      <div class="timer-ctrls">
        <button type="button" class="btn" data-action="cd-adjust" data-delta="-15" aria-label="15 seconds less">−15 s</button>
        <button type="button" class="btn primary" data-action="cd-toggle">${label}</button>
        <button type="button" class="btn" data-action="cd-adjust" data-delta="15" aria-label="15 seconds more">+15 s</button>
      </div>
      ${left < cd.total || cd.done ? '<button type="button" class="link" data-action="cd-reset">Reset</button>' : ''}
    </div>`;
  }

  function renderTimerSlots() {
    $$('[data-timer-slot]').forEach((slot) => {
      const compact = slot.dataset.compact === '1';
      slot.innerHTML = slot.dataset.timerSlot === 'sw' ? stopwatchHTML(compact) : countdownHTML(compact);
    });
    const dot = $('.tabs [data-tab="timer"] .running-dot');
    const running = sw.running || cd.running;
    if (dot && !running) dot.remove();
    if (!dot && running) {
      const tab = $('.tabs [data-tab="timer"]');
      if (tab) tab.insertAdjacentHTML('beforeend', '<span class="running-dot" aria-hidden="true"></span>');
    }
    updateWakeLock();
  }

  // While the stopwatch runs on a time-based exercise, mirror it into the
  // min/sec boxes (unless the person typed their own time).
  function mirrorStopwatch() {
    const form = $('form[data-form="log"][data-dur="1"]');
    if (!form) return;
    const mi = fld(form, 'min'), se = fld(form, 'sec');
    const untouched = mi.dataset.auto === '1' || (mi.value === '' && se.value === '');
    if (!untouched) return;
    const s = Math.floor(swMs() / 1000);
    mi.value = Math.floor(s / 60);
    se.value = s % 60;
    mi.dataset.auto = '1';
  }

  // Sound + vibration when the countdown ends
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
  }
  function beep() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [0, 0.3, 0.6].forEach((d, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + d); o.stop(t + d + 0.25);
    });
  }
  function finishCountdown() {
    cd.running = false; cd.base = cd.total; cd.done = true;
    beep();
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch { /* ignore */ }
    renderTimerSlots();
    toast(route().name === 'exercise' ? 'Rest over. Ready for the next set.' : 'Time’s up!', true);
  }

  // Keep the screen awake while a timer runs (where the phone allows it)
  let wakeLock = null;
  async function updateWakeLock() {
    const need = sw.running || cd.running;
    try {
      if (need && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!need && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { wakeLock = null; }
  }

  setInterval(() => {
    if (cd.running && cdLeft() <= 0) finishCountdown();
    if (!sw.running && !cd.running) return;
    const ms = swMs(), p = swParts(ms);
    $$('[data-sw-main]').forEach((el) => { el.textContent = p.main; });
    $$('[data-sw-tail]').forEach((el) => { el.textContent = p.tail; });
    $$('[data-action="sw-reset"]').forEach((b) => { b.disabled = ms === 0; });
    if (sw.running) mirrorStopwatch();
    const left = cdLeft();
    $$('[data-cd-main]').forEach((el) => { el.textContent = cdText(left); });
    $$('[data-cd-ring]').forEach((el) => {
      el.setAttribute('stroke-dashoffset', (RING_C * (1 - (cd.total ? left / cd.total : 0))).toFixed(2));
    });
  }, 100);

  // =====================================================================
  // Charts
  // =====================================================================
  let charts = [];
  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  function drawDetailChart(ex, list, color) {
    const canvas = $('#ex-chart');
    const daily = dailyBest(ex, list);
    if (!canvas || !window.Chart || !daily.length) return;
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim();
    const line = css.getPropertyValue('--line').trim();
    const accent = css.getPropertyValue('--accent').trim();
    const goalColor = css.getPropertyValue('--goal').trim();
    const st = statsFor(ex, entriesFor(ex.id));
    const pts = daily.map((d) => ({ x: parseISO(d.date).getTime(), y: d.value, best: d.id === st.best.id }));
    const xMin = pts[0].x, xMax = pts[pts.length - 1].x;
    const pad3 = xMin === xMax ? 3 * 86400000 : 0;
    const fmtY = (v) => (ex.unit_type === 'duration' ? fmtDuration(v) : fmtNum(v));

    const datasets = [{
      data: pts,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 3,
      tension: 0.25,
      pointRadius: pts.map((p) => (p.best ? 7 : 3.5)),
      pointHoverRadius: 8,
      pointBackgroundColor: pts.map((p) => (p.best ? accent : color)),
      pointBorderColor: color,
      pointBorderWidth: 2,
    }];

    // Dashed line for a target goal
    const g = goalFor(ex.id);
    const target = g && g.kind === 'target' ? g.target_value : null;
    if (target !== null) {
      datasets.push({
        data: [{ x: xMin - pad3, y: target }, { x: xMax + pad3, y: target }],
        borderColor: goalColor, borderWidth: 2, borderDash: [6, 5],
        pointRadius: 0, pointHoverRadius: 0, tension: 0, fill: false,
      });
    }
    const goalLabel = {
      id: 'goalLabel',
      afterDatasetsDraw(chart) {
        if (target === null) return;
        const pt = chart.getDatasetMeta(1).data[1];
        if (!pt) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.fillStyle = goalColor;
        ctx.font = '700 12px "Atkinson Hyperlegible", system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Goal ' + fmtY(target), pt.x, pt.y - 7);
        ctx.restore();
      },
    };

    charts.push(new window.Chart(canvas, {
      type: 'line',
      data: { datasets },
      plugins: [goalLabel],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 18, right: 8 } },
        scales: {
          x: {
            type: 'linear', min: xMin - pad3, max: xMax + pad3,
            grid: { display: false }, border: { color: line },
            ticks: {
              color: muted, maxTicksLimit: 5, maxRotation: 0,
              callback: (v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
            },
          },
          y: {
            grace: '12%',
            grid: { color: line }, border: { display: false },
            ticks: { color: muted, maxTicksLimit: 5, callback: fmtY },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => new Date(items[0].parsed.x).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
              label: (item) => fmtValue(ex, item.parsed.y) + (item.raw.best ? '  (best)' : ''),
            },
          },
        },
      },
    }));
  }

  // =====================================================================
  // Views
  // =====================================================================
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, id] = h.split('/');
    return { name: name || 'home', id };
  }
  function go(path) { location.hash = '#/' + path; }

  function tabBar(active) {
    const running = sw.running || cd.running;
    const tab = (key, label) =>
      `<a href="#/${key}" data-tab="${key}" ${active === key ? 'aria-current="page"' : ''}>${ICONS[key]}<span>${label}</span>${key === 'timer' && running ? '<span class="running-dot" aria-hidden="true"></span>' : ''}</a>`;
    return `<nav class="tabs" aria-label="Main">${tab('home', 'Home')}${tab('body', 'Body')}${tab('family', 'Family')}</nav>`;
  }

  function rangeChips() {
    return `<div class="range-chips" role="group" aria-label="Time range">
      ${RANGES.map(([k, l]) => `<button type="button" class="chip" data-action="range" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}
    </div>`;
  }

  function avatar(m, tag = 'span', extra = '') {
    return `<${tag} class="avatar" style="--c:${esc(m.color)}" ${extra}>${esc((m.name || '?').trim().charAt(0).toUpperCase())}</${tag}>`;
  }

  // ----- Not configured -----
  function viewSetupNeeded() {
    return `<div class="welcome">
      <div class="wordmark">Family<br>Fitness<span class="lane"></span></div>
      ${!libsLoaded && configured
        ? `<div class="notice"><strong>Couldn’t load the app’s building blocks.</strong><p>Check your internet connection and reload the page.</p></div>`
        : `<div class="notice"><strong>Almost there: connect your database.</strong>
            <p style="margin-top:8px">Open <code>config.js</code> and paste your Supabase project URL and publishable key, then reload. The README walks through it step by step.</p></div>`}
    </div>`;
  }

  // ----- Welcome: join or create -----
  function viewWelcome() {
    return `<div class="welcome">
      <div class="wordmark">Family<br>Fitness<span class="lane"></span></div>
      <p class="lede">Log your workouts, time your sets, and follow everyone’s progress.</p>

      <form data-form="join" novalidate>
        <label class="field"><span>Family code</span>
          <input class="input code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false"
                 placeholder="ABCD-2345" maxlength="12" required>
        </label>
        <button class="btn primary big" type="submit">Join family</button>
        <p class="error-text" data-error hidden></p>
      </form>

      <div class="divider">or start a new family</div>

      <form data-form="create" novalidate>
        <label class="field"><span>Family name</span>
          <input class="input" name="name" maxlength="60" placeholder="e.g. The Smith family" required>
        </label>
        <button class="btn big" type="submit">Create family</button>
        <p class="error-text" data-error hidden></p>
      </form>
    </div>`;
  }

  // ----- Who are you? -----
  function colorSwatches(selected) {
    return `<div class="swatches" role="radiogroup" aria-label="Your color">
      ${COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${c === selected ? 'checked' : ''} aria-label="Color ${i + 1}"><span style="--c:${c}"></span></label>`).join('')}
    </div>`;
  }

  function viewWho() {
    const { family, members } = state.data;
    const used = new Set(members.map((m) => m.color));
    const freeColor = COLORS.find((c) => !used.has(c)) || COLORS[members.length % COLORS.length];
    return `<div class="welcome" style="padding-top:4vh">
      <p class="muted">${esc(family.name)}</p>
      <h1>${members.length ? 'Who’s using this phone?' : 'Add yourself'}</h1>
      ${members.length ? `<div class="who-list">
        ${members.map((m) => `<button type="button" class="who-btn" data-action="pick-member" data-id="${m.id}">${avatar(m)}${esc(m.name)}</button>`).join('')}
      </div>
      <div class="divider">new here?</div>` : '<p class="muted" style="margin:8px 0 22px">You’re the first one. Everyone else joins with the family code.</p>'}

      <form data-form="add-member" novalidate>
        <label class="field"><span>Your name</span>
          <input class="input" name="name" maxlength="40" placeholder="e.g. Mum, Kevin, Grandpa" required>
        </label>
        <fieldset><span class="legend">Your color</span>${colorSwatches(freeColor)}</fieldset>
        <button class="btn primary big" type="submit">Add me</button>
        <p class="error-text" data-error hidden></p>
      </form>
      <p style="margin-top:22px"><button type="button" class="link" data-action="leave">Use a different family code</button></p>
    </div>`;
  }

  // ----- Home -----
  function weekPanel(m) {
    const w = weekInfo(m.id);
    const goal = m.weekly_goal;
    const streak = weeklyStreak(m);
    let top;
    if (goal) {
      const left = goal - w.count;
      top = `<span><strong>${w.count} of ${goal} days</strong> <span class="muted">this week</span></span>
        <span class="small ${left <= 0 ? 'good' : 'muted'}">${left <= 0 ? 'Goal met' : `${plural(left, 'more day', 'more days')} to go`}</span>`;
    } else {
      top = `<span><strong>${plural(w.count, 'active day', 'active days')}</strong> <span class="muted">this week</span></span>
        <span class="set-goal">Set a weekly goal</span>`;
    }
    return `<button type="button" class="panel week-panel" data-action="weekly-sheet">
      <span class="week-top">${top}</span>
      <span class="week-strip" style="--c:${esc(m.color)}">
        ${w.days.map((d) => `<span class="wd ${d.on ? 'on' : ''} ${d.today ? 'today' : ''}"><i></i><small>${esc(d.letter)}</small></span>`).join('')}
      </span>
      ${goal && streak >= 2 ? `<span class="streak small">${streak} weeks in a row</span>` : ''}
    </button>`;
  }

  function viewHome() {
    const m = me();
    const mine = exercisesOf(m.id);

    let body;
    if (!mine.length) {
      body = `<div class="empty">
        <h2>What do you want to track?</h2>
        <p>Tap one to start, or create your own. You can track reps, time, weight, distance, or anything you can count.</p>
        <div class="chips" style="margin-bottom:18px">
          ${SUGGESTIONS.map((s, i) => `<button type="button" class="chip" data-action="add-suggested" data-i="${i}">${esc(s.name)}</button>`).join('')}
        </div>
        <button type="button" class="btn primary big" data-action="new-exercise">Create an exercise</button>
      </div>`;
    } else {
      body = `<div class="section-head"><h2>Your exercises</h2></div>
      <ul class="ex-list">
        ${mine.map((ex) => {
          const list = entriesFor(ex.id);
          const daily = dailyBest(ex, list);
          const last = daily[daily.length - 1];
          const gm = goalMini(ex);
          return `<li><a class="ex-row" href="#/exercise/${ex.id}">
            <span class="ex-name">${esc(ex.name)}</span>
            ${last
              ? `<span class="ex-latest">${esc(fmtValue(ex, last.value))}</span><span class="ex-when">${relDay(last.date)}</span>`
              : '<span class="ex-latest none">No entries yet</span><span></span>'}
            ${gm ? `<span class="goal-mini ${gm.reached ? 'reached' : ''}"><span class="goal-bar sm"><i style="width:${gm.pct}%"></i></span><span>${gm.reached ? (gm.kind === 'monthly' ? 'Done this month' : 'Goal reached') : `${gm.pct}% of goal`}</span></span>` : ''}
            <span class="spark-wrap"><span class="log-pill">Log</span>${sparkline(dailyBest(ex, inRange(list)), m.color, 104, 36)}</span>
          </a></li>`;
        }).join('')}
      </ul>
      <button type="button" class="btn wide" style="margin-top:18px" data-action="new-exercise">Add an exercise</button>`;
    }

    return `<header class="top">
        <div><p class="kicker">${esc(state.data.family.name)}</p><h1>Hi, ${esc(m.name)}</h1></div>
        ${avatar(m, 'a', 'href="#/settings" aria-label="Settings"')}
      </header>
      ${weekPanel(m)}
      <div class="section">${body}</div>`;
  }

  // ----- One exercise -----
  function goalBlock(ex, g, isMine) {
    const p = goalProgress(ex, g);
    const pct = Math.round(p.pct * 100);
    const finished = p.kind === 'target' && (p.reached || p.overdue);
    let head, foot;
    if (p.kind === 'monthly') {
      const month = new Date().toLocaleDateString(undefined, { month: 'long' });
      head = `<strong>${esc(month)}:</strong> ${esc(fmtValue(ex, p.total))} of ${esc(fmtValue(ex, g.target_value))}`;
      foot = p.reached
        ? '<span class="good">Monthly goal reached</span>'
        : `<span>${esc(fmtValue(ex, p.remaining))} to go</span><span>${p.daysLeft <= 1 ? 'Last day' : `${p.daysLeft} days left`}</span>`;
    } else {
      head = `<strong>Goal:</strong> ${esc(fmtValue(ex, g.target_value))} by ${fmtDate(g.due_date)}`;
      if (p.reached) foot = `<span class="good">Reached on ${fmtDate(p.reachedDate)}</span>`;
      else if (p.overdue) foot = `<span>The date has passed. ${p.current !== null ? `Your best in that time: ${esc(fmtValue(ex, p.current))}.` : ''}</span>`;
      else {
        foot = `<span>${g.start_value != null ? `Started at ${esc(fmtValue(ex, g.start_value))}` : 'Counting from your first entry'}</span>
          <span class="${p.onTrack ? 'good' : ''}">${p.onTrack ? 'On track' : 'Behind pace'}, ${timeLeft(p.daysLeft)}</span>`;
      }
    }
    return `<div class="goal-block ${p.reached ? 'reached' : ''}">
      <div class="goal-head"><span>${head}</span>
        ${isMine && !finished ? `<button type="button" class="link" data-action="goal-sheet" data-id="${ex.id}">Edit</button>` : ''}</div>
      <div class="goal-bar" role="progressbar" aria-label="Goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="goal-foot">${foot}</div>
      ${isMine && finished ? `<button type="button" class="btn wide" style="margin-top:12px" data-action="goal-sheet" data-id="${ex.id}" data-fresh="1">Set a new goal</button>` : ''}
    </div>`;
  }

  function viewExercise(id) {
    const ex = exerciseById(id);
    if (!ex) {
      return `<button type="button" class="back" data-action="back">${ICONS.back} Back</button>
        <div class="center-note"><h2>Exercise not found</h2><p>It may have been removed.</p></div>`;
    }
    const owner = memberById(ex.member_id);
    const isMine = owner.id === state.meId;
    const all = entriesFor(ex.id);
    const list = inRange(all);
    const st = statsFor(ex, all);
    const isDur = ex.unit_type === 'duration';
    const restable = ex.unit_type !== 'distance';
    const goal = goalFor(ex.id);
    const todays = all.filter((e) => e.date === todayISO());

    const logForm = isMine ? `
      <form class="panel" data-form="log" data-ex="${ex.id}" data-dur="${isDur ? 1 : 0}" novalidate>
        <div class="log-head"><h3>Log ${esc(unitWord(ex))}</h3>
          ${todays.length ? `<span class="muted small">Today: ${todays.map((e) => esc(fmtValue(ex, e.value))).join(', ')}</span>` : ''}</div>
        ${isDur
          ? `<div data-timer-slot="sw" data-compact="1"></div>
             <div class="log-value dur">
               <input class="input" name="min" type="number" inputmode="numeric" min="0" step="1" placeholder="0" aria-label="Minutes"><span class="unit">min</span>
               <input class="input" name="sec" type="number" inputmode="numeric" min="0" max="59" step="1" placeholder="0" aria-label="Seconds"><span class="unit">sec</span>
             </div>`
          : `<div class="log-value">
               <input class="input" name="value" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Amount">
               ${ex.unit_label ? `<span class="unit">${esc(ex.unit_label)}</span>` : ''}
             </div>`}
        <div class="log-meta">
          <label class="field"><span class="small">Date</span><input class="input" name="date" type="date" value="${todayISO()}" max="${todayISO()}"></label>
          <label class="field"><span class="small">Note (optional)</span><input class="input" name="note" maxlength="200" placeholder="How did it feel?"></label>
        </div>
        <div class="btn-row">
          <button class="btn primary big" type="submit" value="save">Save</button>
          ${restable ? '<button class="btn big" type="submit" value="rest">Save and rest</button>' : ''}
        </div>
        <p class="error-text" data-error hidden></p>
      </form>
      ${restable ? `<div class="section" id="rest-panel">
        <h3 style="margin-bottom:12px">Rest timer</h3>
        <div class="panel" data-timer-slot="cd" data-compact="1"></div>
      </div>` : ''}` : '';

    const statsBlock = st ? `<div class="stats">
        <div class="stat"><div class="label">Latest</div><div class="value">${esc(fmtValue(ex, st.latest.value))}</div></div>
        <div class="stat"><div class="label">Best</div><div class="value">${esc(fmtValue(ex, st.best.value))}</div></div>
        <div class="stat"><div class="label">Since first</div><div class="value ${st.mood === 'flat' ? '' : st.mood}">${esc(fmtChange(ex, st.change))}</div></div>
      </div>` : '';

    const history = all.slice().reverse();
    const historyBlock = history.length ? `<div class="section">
        <h3 style="margin-bottom:6px">History</h3>
        <ul class="history">
          ${history.map((e, i) => {
            const newDay = i === 0 || history[i - 1].date !== e.date;
            return `<li class="${newDay ? '' : 'same-day'}">
              <span class="h-date">${newDay ? fmtDate(e.date) : ''}</span>
              <span class="h-main"><span class="h-val">${esc(fmtValue(ex, e.value))}</span>${e.id === st.best.id ? '<span class="best-tag">Best</span>' : ''}
                ${e.note ? `<br><span class="h-note">${esc(e.note)}</span>` : ''}</span>
              ${isMine ? `<button type="button" class="icon-btn" data-action="delete-entry" data-id="${e.id}" aria-label="Delete entry from ${fmtDate(e.date)}">${ICONS.trash}</button>` : ''}
            </li>`;
          }).join('')}
        </ul>
      </div>` : '';

    return `<button type="button" class="back" data-action="back" data-to="${isMine ? 'home' : 'family'}">${ICONS.back} Back</button>
      <h1 class="page-title">${esc(ex.name)}</h1>
      <p class="page-sub">${isMine
        ? `Better when the number goes ${ex.higher_is_better ? 'up' : 'down'}${sportOf(ex) ? '. Counts toward sport calories' : ''}`
        : `${esc(owner.name)}’s progress`}</p>
      ${logForm}
      <div class="section">
        <div class="section-head"><h3>Progress</h3>
          ${isMine && !goal ? `<button type="button" class="link" data-action="goal-sheet" data-id="${ex.id}">Set a goal</button>` : ''}</div>
        ${goal ? goalBlock(ex, goal, isMine) : ''}
        ${statsBlock}
        <div style="margin-top:16px">${rangeChips()}</div>
        ${list.length
          ? `<div class="chart-box"><canvas id="ex-chart" aria-label="Chart of ${esc(ex.name)} over time, best of each day" role="img"></canvas></div>`
          : `<div class="chart-empty">${all.length ? 'No entries in this time range.' : (isMine ? 'Your chart appears after your first entry.' : 'No entries yet.')}</div>`}
      </div>
      ${historyBlock}
      ${isMine ? `<div class="section"><button type="button" class="btn wide" data-action="edit-exercise" data-id="${ex.id}">Edit exercise</button></div>` : ''}`;
  }

  // ----- Family -----
  function viewFamily() {
    const { family, members } = state.data;
    const ordered = [me(), ...members.filter((m) => m.id !== state.meId)];
    return `<h1 class="page-title">${esc(family.name)}</h1>
      <p class="page-sub">Everyone’s progress, each on their own scale.</p>
      ${rangeChips()}
      ${ordered.map((m) => {
        const exs = exercisesOf(m.id);
        const shared = state.data.shared_weights.filter((x) => x.member_id === m.id);
        const weightCard = shared.length ? `<div class="mini">
            <span class="m-name">Weight trend</span>
            <span class="m-latest">${shared.length > 1 ? esc(signed(shared[shared.length - 1].delta, (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`)) : 'Just started'}</span>
            <span class="m-change flat">since ${fmtDate(shared[0].date)}</span>
            ${sparkline(shared.map((x) => ({ date: x.date, value: x.delta })), m.color, 140, 40)}
          </div>` : '';
        const w = weekInfo(m.id);
        const weekText = m.weekly_goal
          ? `${w.count} of ${m.weekly_goal} days`
          : plural(w.count, 'active day', 'active days');
        return `<section class="person" style="--c:${esc(m.color)}">
          <div class="person-head">${avatar(m)}<h2>${esc(m.name)}${m.id === state.meId ? ' <span class="muted small" style="font-family:var(--body);font-weight:400">(you)</span>' : ''}</h2>
            <span class="active">${weekText}<br>this week</span></div>
          ${exs.length || weightCard ? `<div class="mini-grid">
            ${exs.map((ex) => {
              const all = entriesFor(ex.id);
              const list = inRange(all);
              const st = statsFor(ex, list);
              const gm = goalMini(ex);
              return `<a class="mini" href="#/exercise/${ex.id}">
                <span class="m-name">${esc(ex.name)}</span>
                ${st ? `<span class="m-latest">${esc(fmtValue(ex, st.latest.value))}</span>
                  <span class="m-change ${st.mood}">${st.days > 1 ? esc(fmtChange(ex, st.change)) : 'First entry'}</span>`
                  : `<span class="m-change flat">${all.length ? 'Nothing in this range' : 'No entries yet'}</span>`}
                ${gm ? `<span class="m-goal">${gm.reached ? (gm.kind === 'monthly' ? 'Monthly goal met' : 'Goal reached') : `Goal ${gm.pct}%`}</span>` : ''}
                ${sparkline(dailyBest(ex, list), m.color, 140, 40)}
              </a>`;
            }).join('')}${weightCard}
          </div>` : '<p class="muted" style="margin-top:12px">No exercises yet.</p>'}
        </section>`;
      }).join('')}
      <div class="section"><a class="btn wide" href="#/settings">Invite family members</a></div>`;
  }

  // ----- Settings -----
  function viewSettings() {
    const m = me();
    const archived = exercisesOf(m.id, true);
    const link = inviteLink();
    return `<button type="button" class="back" data-action="back">${ICONS.back} Back</button>
      <h1 class="page-title" style="margin-bottom:22px">Settings</h1>

      <form class="panel" data-form="profile" novalidate>
        <h3 style="margin-bottom:14px">You</h3>
        <label class="field"><span>Name</span><input class="input" name="name" maxlength="40" value="${esc(m.name)}" required></label>
        <fieldset><span class="legend">Color</span>${colorSwatches(m.color)}</fieldset>
        <button class="btn primary wide" type="submit">Save changes</button>
        <p class="error-text" data-error hidden></p>
      </form>

      <div class="panel section">
        <h3>Invite family</h3>
        <p class="muted" style="margin-top:6px">Send the link, or have them enter this code.</p>
        <div class="code-display">${esc(state.data.family.code)}</div>
        <div class="btn-row">
          <button type="button" class="btn primary" data-action="share-invite">Share invite</button>
          <button type="button" class="btn" data-action="copy-invite">Copy link</button>
        </div>
        <p class="hint" style="word-break:break-all">${esc(link)}</p>
        <p class="hint">Only share it with family: anyone with the code can see and add to this family’s data.</p>
      </div>

      <div class="panel section help">
        <h3>Put it on your home screen</h3>
        <p class="muted" style="margin-top:6px">It will open like an app, full screen.</p>
        <p style="margin-top:10px"><strong>Android (Chrome):</strong> tap the ⋮ menu, then <em>Add to home screen</em> or <em>Install app</em>.</p>
        <p style="margin-top:6px"><strong>iPhone (Safari):</strong> tap the Share button, then <em>Add to Home Screen</em>.</p>
      </div>

      ${archived.length ? `<div class="panel section">
        <h3 style="margin-bottom:8px">Archived exercises</h3>
        <ul class="archived-list">
          ${archived.map((ex) => `<li><span>${esc(ex.name)}</span><button type="button" class="btn" data-action="restore-exercise" data-id="${ex.id}">Restore</button></li>`).join('')}
        </ul></div>` : ''}

      <div class="panel section">
        <h3 style="margin-bottom:12px">This phone</h3>
        <div class="btn-row">
          <button type="button" class="btn" data-action="switch-person">Switch person</button>
          <button type="button" class="btn danger" data-action="leave">Leave family</button>
        </div>
        <p class="hint">Leaving only signs this phone out. Your entries stay saved, and you can rejoin with the invite link.</p>
      </div>`;
  }

  function inviteLink() {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '?join=' + encodeURIComponent(state.data.family.code);
    return url.toString();
  }

  // =====================================================================
  // Body page: weight and calories, private to each person
  // =====================================================================
  const ACTIVITY = {
    low:    { label: 'Mostly sitting',                factor: 1.2 },
    some:   { label: 'On my feet part of the day',    factor: 1.375 },
    active: { label: 'Physically active work or days', factor: 1.55 },
  };
  const KCAL_PER_KG = 7700; // rough rule of thumb: ~7,700 kcal is about 1 kg of body weight
  const pinKey = (id) => 'ff_pin_' + id;
  const bodyPin = () => store.get(pinKey(state.meId)) || null;

  async function loadBody() {
    try {
      const d = await rpc('get_body', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin() });
      const num = (v) => (v == null ? null : Number(v));
      const p = d.profile;
      if (p) ['height_cm', 'birth_year', 'weight_goal', 'weight_goal_start', 'kcal_target', 'sport_target'].forEach((k) => { p[k] = num(p[k]); });
      d.logs.forEach((l) => { l.value = Number(l.value); });
      state.body = { memberId: state.meId, profile: p, logs: d.logs };
      state.bodyLocked = false;
      state.bodyError = null;
    } catch (e) {
      if (/PIN_REQUIRED|PIN_WRONG/.test(e.raw || '')) {
        state.body = null;
        state.bodyLocked = e.raw.includes('PIN_WRONG') ? 'wrong' : 'required';
        store.set(pinKey(state.meId), null);
      } else {
        state.bodyError = e.message;
      }
    }
  }
  function ensureBody() {
    if (state.bodyLoading || state.bodyLocked || state.bodyError) return;
    if (state.body && state.body.memberId === state.meId) return;
    state.bodyLoading = true;
    loadBody().finally(() => { state.bodyLoading = false; if (route().name === 'body') safeRender(); });
  }

  // ----- Calculations -----
  const bLogs = (kind) => state.body.logs.filter((l) => l.kind === kind);
  const daySum = (kind, date) => state.body.logs.reduce((s, l) => (l.kind === kind && l.date === date ? s + l.value : s), 0);
  const latestWeight = () => { const w = bLogs('weight'); return w.length ? w[w.length - 1] : null; };
  function smoothWeight() {
    const w = bLogs('weight');
    if (!w.length) return null;
    const recent = w.filter((x) => x.date >= daysAgoISO(7));
    return recent.length >= 2 ? recent.reduce((s, x) => s + x.value, 0) / recent.length : w[w.length - 1].value;
  }
  const ageOf = (p) => (p && p.birth_year ? new Date().getFullYear() - p.birth_year : null);
  // Mifflin-St Jeor resting burn x everyday activity (sport is logged separately)
  function restingBurn(p, kg) {
    const age = ageOf(p) ?? 35;
    const s = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
    return (10 * kg + 6.25 * p.height_cm - 5 * age + s) * ACTIVITY[p.activity || 'low'].factor;
  }
  const bmiOf = (p, kg) => kg / Math.pow(p.height_cm / 100, 2);
  const bmiText = (v) => (v < 18.5 ? 'underweight range' : v < 25 ? 'healthy range' : v < 30 ? 'overweight range' : 'obese range');
  const healthyRange = (p) => { const h2 = Math.pow(p.height_cm / 100, 2); return [18.5 * h2, 24.9 * h2]; };
  const kcalFloor = (p) => (p.sex === 'male' ? 1500 : 1200);
  const fmtKg = (v) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
  const fmtKcal = (v) => Math.round(v).toLocaleString();
  const round10 = (v) => Math.round(v / 10) * 10;
  const signed = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));

  const kgNow = () => (state.body && latestWeight() ? latestWeight().value : 70);
  const watchFor = (d) => { const l = state.body.logs.find((x) => x.kind === 'watch' && x.date === d); return l ? l.value : null; };

  // Calories from the exercises you logged on a day
  function exerciseSport(date, kg) {
    const items = [];
    exercisesOf(state.meId).concat(exercisesOf(state.meId, true)).forEach((ex) => {
      const k = entriesFor(ex.id).filter((e) => e.date === date).reduce((sum, e) => sum + entryKcal(ex, e.value, kg), 0);
      if (k > 0) items.push({ name: ex.name, kcal: k });
    });
    return { items, total: items.reduce((sum, i) => sum + i.kcal, 0) };
  }

  // What you burned on a day, before any adjustment:
  // watch total > watch active + resting estimate > resting estimate + sport
  function rawBurn(d, base, kg) {
    const p = state.body.profile;
    const ex = exerciseSport(d, kg);
    const manual = daySum('sport', d);
    const w = watchFor(d);
    if (p.watch_mode === 'total' && w != null) return { burn: w, source: 'watch', ex, manual, watch: w };
    if (p.watch_mode === 'active' && w != null) return { burn: base + w, source: 'watch', ex, manual, watch: w };
    return { burn: base + ex.total + manual, source: 'estimate', ex, manual, watch: null };
  }

  // Learns from real results: over the last 4 weeks, compares what you ate
  // with how your weight actually moved, and nudges the burn numbers
  // (estimate or watch) halfway toward what your weight says.
  function calibration(base, kg) {
    const from = daysAgoISO(28), to = daysAgoISO(1);
    const ws = bLogs('weight').filter((w) => w.date >= from && w.date <= to);
    if (ws.length < 4 || daysBetween(ws[0].date, ws[ws.length - 1].date) < 14) return { f: 1, adjusted: false };
    const days = [];
    for (let i = 1; i <= 28; i++) {
      const d = daysAgoISO(i);
      const food = daySum('food', d);
      if (food > 0) days.push({ food, burn: rawBurn(d, base, kg).burn });
    }
    if (days.length < 10) return { f: 1, adjusted: false };
    const xs = ws.map((w) => daysBetween(from, w.date)), ys = ws.map((w) => w.value);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const slope = den ? num / den : 0; // kg per day
    const avgIn = days.reduce((a, d) => a + d.food, 0) / days.length;
    const avgBurn = days.reduce((a, d) => a + d.burn, 0) / days.length;
    const ratio = Math.min(1.3, Math.max(0.7, (avgIn - slope * KCAL_PER_KG) / avgBurn));
    return { f: (1 + ratio) / 2, adjusted: Math.abs(ratio - 1) > 0.02 };
  }

  function energyStats() {
    const p = state.body.profile;
    const kg = smoothWeight();
    const base = restingBurn(p, kg);
    const cal = calibration(base, kg);
    const burnOf = (d) => { const r = rawBurn(d, base, kg); return { ...r, burn: r.burn * cal.f }; };
    const days = [];
    let burnSum = 0;
    for (let i = 1; i <= 14; i++) { // full days only (today isn't over yet)
      const d = daysAgoISO(i);
      const b = burnOf(d);
      burnSum += b.burn;
      const food = daySum('food', d);
      if (food > 0) days.push({ date: d, balance: food - b.burn });
    }
    const avgBalance = days.length ? days.reduce((a, x) => a + x.balance, 0) / days.length : null;
    return { kg, base: base * cal.f, adjusted: cal.adjusted, burnOf, avgBurn: burnSum / 14, foodDays: days.length, enough: days.length >= 3, avgBalance };
  }

  function weightGoalReached() {
    const p = state.body.profile, latest = latestWeight();
    if (!p || !p.weight_goal || !latest) return false;
    const start = p.weight_goal_start ?? latest.value;
    return start >= p.weight_goal ? latest.value <= p.weight_goal : latest.value >= p.weight_goal;
  }

  function weightPlan() {
    const p = state.body.profile;
    const es = energyStats();
    const today = todayISO();
    const goal = p.weight_goal && p.weight_goal_date ? {
      kg: p.weight_goal, date: p.weight_goal_date,
      startKg: p.weight_goal_start ?? es.kg, startDate: p.weight_goal_start_date || today,
    } : null;
    const horizon = goal && goal.date > today ? goal.date : isoFromDate(addDays(new Date(), 60));
    const ahead = daysBetween(today, horizon);
    const paceKg = es.enough ? es.kg + (es.avgBalance / KCAL_PER_KG) * ahead : null;
    let need = null;
    if (goal && goal.date > today) {
      need = es.avgBurn + ((goal.kg - es.kg) * KCAL_PER_KG) / daysBetween(today, goal.date);
    }
    return { es, goal, horizon, paceKg, need, reached: weightGoalReached() };
  }

  // ----- Pieces of the page -----
  function weightGoalHTML(plan) {
    const p = state.body.profile;
    const g = plan.goal, today = todayISO();
    const latest = latestWeight().value;
    const floor = kcalFloor(p);
    if (!g) {
      if (!plan.es.enough) return `<p class="pace muted">Log your food on a few days to see where your weight is heading.</p>`;
      const perWeek = (plan.es.avgBalance * 7) / KCAL_PER_KG;
      return `<div class="pace">
        <p>At your current pace: <strong>${esc(signed(perWeek, (v) => `${v.toFixed(1)} kg`))}</strong> a week.</p>
        <p class="muted">By ${fmtDate(plan.horizon)}: about ${fmtKg(plan.paceKg)}.</p>
      </div>`;
    }
    const losing = g.startKg >= g.kg;
    const span = Math.abs(g.startKg - g.kg) || 1;
    const pct = plan.reached ? 100 : Math.round(Math.max(0, Math.min(1, (losing ? g.startKg - latest : latest - g.startKg) / span)) * 100);
    const overdue = !plan.reached && g.date <= today;

    let pace = '';
    if (plan.reached) {
      pace = `<p class="good">You reached your goal. Well done!</p>`;
    } else if (overdue) {
      pace = `<p>The goal date has passed. You’re at ${fmtKg(latest)}.</p>`;
    } else {
      if (plan.paceKg !== null) {
        const onTrack = losing ? plan.paceKg <= g.kg + 0.2 : plan.paceKg >= g.kg - 0.2;
        pace += `<p>At your current pace: <strong>${fmtKg(plan.paceKg)}</strong> by ${fmtDate(g.date)}.
          <span class="${onTrack ? 'good' : 'muted'}">${onTrack ? 'On track' : `${fmtKg(Math.abs(plan.paceKg - g.kg))} short`}</span></p>`;
      } else {
        pace += `<p class="muted">Log your food on a few days to see your pace.</p>`;
      }
      if (plan.need !== null) {
        pace += plan.need < floor
          ? `<p class="muted">Staying on plan would mean eating under ${fmtKcal(floor)} kcal a day, which isn’t recommended. Consider a later date.</p>`
          : `<p>To stay on plan: about <strong>${fmtKcal(round10(plan.need))} kcal</strong> a day.</p>`;
      }
    }
    return `<div class="goal-block ${plan.reached ? 'reached' : ''}">
      <div class="goal-head"><span><strong>Goal:</strong> ${fmtKg(g.kg)} by ${fmtDate(g.date)}</span>
        ${plan.reached || overdue ? '' : '<button type="button" class="link" data-action="body-goals">Edit</button>'}</div>
      <div class="goal-bar" role="progressbar" aria-label="Weight goal progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="goal-foot"><span>Started at ${fmtKg(g.startKg)}</span><span>${plan.reached || overdue ? '' : timeLeft(daysBetween(today, g.date))}</span></div>
      <div class="pace">${pace}</div>
      ${plan.reached || overdue ? '<button type="button" class="btn wide" style="margin-top:12px" data-action="body-goals" data-fresh="1">Set a new goal</button>' : ''}
    </div>`;
  }

  // Daily balance for the last 7 full days: below the line = ate less than burned
  function energyBars(es, color) {
    const days = [];
    for (let i = 7; i >= 1; i--) {
      const d = daysAgoISO(i);
      const food = daySum('food', d);
      days.push({
        letter: parseISO(d).toLocaleDateString(undefined, { weekday: 'narrow' }),
        bal: food > 0 ? food - es.burnOf(d).burn : null,
      });
    }
    const max = Math.max(300, ...days.filter((x) => x.bal !== null).map((x) => Math.abs(x.bal)));
    const W = 300, mid = 50, half = 42, bw = 26, gap = (W - 7 * bw) / 6;
    const bars = days.map((x, i) => {
      const cx = i * (bw + gap);
      const label = `<text class="bar-label" x="${cx + bw / 2}" y="${mid + half + 18}" text-anchor="middle">${esc(x.letter)}</text>`;
      if (x.bal === null) return `<circle cx="${cx + bw / 2}" cy="${mid}" r="3" fill="var(--line)"/>${label}`;
      const h = Math.max(2, (Math.abs(x.bal) / max) * half);
      return `<rect x="${cx}" y="${x.bal > 0 ? mid - h : mid}" width="${bw}" height="${h.toFixed(1)}" rx="4" fill="${color}"/>${label}`;
    }).join('');
    return `<svg class="energy-bars" viewBox="0 0 ${W} ${mid + half + 24}" aria-hidden="true">
      <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="var(--muted)" stroke-width="1"/>${bars}</svg>`;
  }

  // ----- Screens -----
  const sexField = (v) => `<fieldset><span class="legend">Sex</span><div class="choice">
      ${[['female', 'Female'], ['male', 'Male'], ['unspecified', 'Prefer not to say']].map(([k, l]) => `<label><input type="radio" name="sex" value="${k}" ${v === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div><p class="hint">Only used in the calorie formula.</p></fieldset>`;
  const activityField = (v) => `<fieldset><span class="legend">Your days, apart from sport</span><div class="choice stack">
      ${Object.entries(ACTIVITY).map(([k, a]) => `<label><input type="radio" name="activity" value="${k}" ${(v || 'low') === k ? 'checked' : ''}><span>${a.label}</span></label>`).join('')}
    </div></fieldset>`;
  const shareField = (on) => `<label class="check"><input type="checkbox" name="share" ${on ? 'checked' : ''}>
      <span><strong>Share my weight trend with the family</strong><br>
      <span class="muted small">They see how much it has changed, never your actual weight or what you eat.</span></span></label>`;
  const watchField = (v) => `<fieldset><span class="legend">Smartwatch</span><div class="choice stack">
      ${[['', 'No watch: estimate for me'], ['total', 'My watch shows total calories (resting + active)'], ['active', 'My watch shows active calories only']]
        .map(([k, l]) => `<label><input type="radio" name="watch_mode" value="${k}" ${(v || '') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </div><p class="hint">Not sure? If a normal day shows more than about 1,500 kcal, it’s probably the total.</p></fieldset>`;
  const heightInput = (v) => `<label class="field"><span>Height</span><div class="log-value small-inputs">
      <input class="input" name="height" type="text" inputmode="decimal" autocomplete="off" placeholder="170" value="${v ?? ''}"><span class="unit">cm</span></div></label>`;
  const birthInput = (v) => `<label class="field"><span>Year of birth</span>
      <input class="input" name="birth_year" type="text" inputmode="numeric" autocomplete="off" placeholder="1985" value="${v ?? ''}"></label>`;

  function readProfileForm(form) {
    const height = parseNum(fld(form, 'height').value);
    const by = parseInt(fld(form, 'birth_year').value, 10);
    const sexEl = form.querySelector('[name=sex]:checked');
    const actEl = form.querySelector('[name=activity]:checked');
    const pin = fld(form, 'pin') ? fld(form, 'pin').value.trim() : '';
    const year = new Date().getFullYear();
    let error = null;
    if (!(height >= 100 && height <= 250)) error = 'Enter your height in centimetres, e.g. 170.';
    else if (!(by >= 1900 && by <= year - 4)) error = 'Enter your year of birth, e.g. 1985.';
    else if (!sexEl) error = 'Pick an option for sex (or “Prefer not to say”).';
    else if (pin && !/^[0-9]{4}$/.test(pin)) error = 'The PIN must be exactly 4 digits.';
    return {
      error, pin,
      data: {
        height_cm: height, birth_year: by, sex: sexEl && sexEl.value, activity: actEl ? actEl.value : 'low',
        share_weight: fld(form, 'share').checked,
        watch_mode: (form.querySelector('[name=watch_mode]:checked') || {}).value || null,
      },
    };
  }

  function viewBodyPin() {
    return `<div class="welcome" style="padding-top:8vh">
      <h1>Body</h1>
      <p class="muted" style="margin:8px 0 22px">Enter your PIN to open this page.</p>
      <form data-form="body-pin" novalidate>
        <input class="input code" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" aria-label="PIN">
        <button class="btn primary big" type="submit" style="margin-top:14px">Unlock</button>
        <p class="error-text" data-error ${state.bodyLocked === 'wrong' ? '' : 'hidden'}>${state.bodyLocked === 'wrong' ? 'That PIN isn’t right. Try again.' : ''}</p>
      </form>
      <p class="hint" style="margin-top:22px">Forgot it? The README explains how to reset it.</p>
    </div>`;
  }

  function viewBodySetup() {
    const p = state.body.profile || {};
    return `<h1 class="page-title">Body</h1>
      <p class="page-sub">Track your weight and calories, and see where your habits are taking you. Private to you unless you choose to share.</p>
      <form class="panel" data-form="body-setup" novalidate>
        <h3 style="margin-bottom:4px">About you</h3>
        <p class="muted small" style="margin-bottom:16px">Used for your BMI and to estimate the calories your body burns.</p>
        <div class="grid2">${heightInput(p.height_cm)}
          <label class="field"><span>Weight now</span><div class="log-value small-inputs">
            <input class="input" name="weight" type="text" inputmode="decimal" autocomplete="off" placeholder="70"><span class="unit">kg</span></div></label>
        </div>
        ${birthInput(p.birth_year)}
        ${sexField(p.sex)}
        ${activityField(p.activity)}
        ${watchField(p.watch_mode)}
        ${shareField(p.share_weight)}
        ${p.has_pin ? '' : `<label class="field"><span>PIN <span class="muted small">(optional)</span></span>
          <input class="input pin" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="4 digits">
          <span class="hint">With a PIN, only you can open this page, even if someone else taps your name.</span></label>`}
        <button class="btn primary big" type="submit">Save and continue</button>
        <p class="error-text" data-error hidden></p>
      </form>`;
  }

  function viewBody() {
    const m = me();
    if (state.bodyLocked) return viewBodyPin();
    if (state.bodyError) {
      return `<div class="center-note"><h2>Couldn’t load this page</h2><p>${esc(state.bodyError)}</p>
        <p style="margin-top:18px"><button type="button" class="btn primary" data-action="body-retry">Try again</button></p></div>`;
    }
    if (!state.body || state.body.memberId !== m.id) { ensureBody(); return '<div class="center-note"><p>Loading…</p></div>'; }
    const p = state.body.profile;
    if (!p || !p.height_cm || !bLogs('weight').length) return viewBodySetup();

    const plan = weightPlan();
    const es = plan.es;
    const latest = latestWeight();
    const today = todayISO();
    const eaten = daySum('food', today);
    const tb = es.burnOf(today);
    const burn = tb.burn;
    const exToday = tb.ex.total + tb.manual;
    const uncounted = exercisesOf(m.id).filter((ex) => ex.unit_type !== 'weight' && !sportOf(ex) &&
      ex.sport_activity !== 'none' && entriesFor(ex.id).some((e) => e.date === today));
    const burnSub = tb.source === 'watch'
      ? (p.watch_mode === 'active' ? `est. + ${fmtKcal(tb.watch)} watch` : (Math.round(burn) !== Math.round(tb.watch) ? `watch said ${fmtKcal(tb.watch)}` : 'from watch'))
      : (exToday ? `est., incl. ${fmtKcal(exToday)} sport` : 'estimate');
    const age = ageOf(p);
    const adult = age === null || age >= 18;
    const bmi = bmiOf(p, latest.value);

    const week7 = [];
    for (let i = 1; i <= 7; i++) { const d = daysAgoISO(i); const f = daySum('food', d); if (f > 0) week7.push(f - es.burnOf(d).burn); }
    const avg7 = week7.length ? week7.reduce((s, x) => s + x, 0) / week7.length : null;
    const monday = isoFromDate(mondayOf(new Date()));
    let sportWeek = 0;
    for (let d = parseISO(monday); isoFromDate(d) <= today; d = addDays(d, 1)) {
      const iso = isoFromDate(d);
      sportWeek += daySum('sport', iso) + exerciseSport(iso, es.kg).total;
    }

    const recentAll = state.body.logs.filter((l) => l.date >= daysAgoISO(13)).slice().reverse();
    const recent = state.bodyShowAll ? recentAll : recentAll.slice(0, 10);
    const kindName = { weight: 'Weight', food: 'Food', sport: 'Sport', watch: 'Watch' };

    return `<header class="top">
        <div><p class="kicker">${p.share_weight ? 'Weight trend shared with family' : 'Private to you'}${p.has_pin ? ', locked with PIN' : ''}</p><h1>Body</h1></div>
      </header>
      <div class="log-buttons">
        <button type="button" class="btn primary" data-action="body-log" data-kind="weight">+ Weight</button>
        <button type="button" class="btn primary" data-action="body-log" data-kind="food">+ Food</button>
        ${p.watch_mode
          ? '<button type="button" class="btn primary" data-action="body-log" data-kind="watch">+ Watch</button>'
          : '<button type="button" class="btn primary" data-action="body-log" data-kind="sport">+ Sport</button>'}
      </div>

      <div class="panel section">
        <h3>Today</h3>
        <div class="energy-row">
          <div class="en"><span class="label">Eaten</span><span class="value">${fmtKcal(eaten)}</span><span class="sub">${p.kcal_target ? `of ${fmtKcal(p.kcal_target)} kcal` : 'kcal'}</span></div>
          <div class="en"><span class="label">Burned</span><span class="value">${fmtKcal(burn)}</span><span class="sub">${burnSub}</span></div>
          <div class="en"><span class="label">Balance</span><span class="value">${eaten ? esc(signed(eaten - burn, fmtKcal)) : '–'}</span><span class="sub">${eaten ? 'kcal' : 'log food first'}</span></div>
        </div>
        ${p.kcal_target ? `<div class="goal-bar ${eaten > p.kcal_target ? 'over' : ''}" style="margin-top:12px"><i style="width:${Math.min(100, Math.round((eaten / p.kcal_target) * 100))}%"></i></div>` : ''}
        ${exToday ? `<p class="sport-line"><strong>Sport today:</strong> ${[...tb.ex.items.map((i) => `${esc(i.name)} ${fmtKcal(i.kcal)}`), ...(tb.manual ? [`logged ${fmtKcal(tb.manual)}`] : [])].join(', ')} kcal${tb.source === 'watch' ? ' <span class="muted">(already in your watch number)</span>' : ''}</p>` : ''}
        ${uncounted.length ? `<p class="hint">${uncounted.map((ex) => esc(ex.name)).join(', ')} ${uncounted.length === 1 ? 'isn’t' : 'aren’t'} counting toward sport calories. Choose an activity in <em>Edit exercise</em> to include ${uncounted.length === 1 ? 'it' : 'them'}.</p>` : ''}
        ${p.watch_mode && tb.source !== 'watch' ? '<p class="hint">Using an estimate until you log today’s watch number (best done tomorrow morning).</p>' : ''}
      </div>

      <div class="section">
        <div class="section-head"><h3>Weight</h3>${plan.goal ? '' : '<button type="button" class="link" data-action="body-goals">Set goals</button>'}</div>
        <div class="weight-now"><span class="wn-value">${fmtKg(latest.value)}</span>
          <span class="muted small">${relDay(latest.date)}. BMI ${bmi.toFixed(1)}${adult ? `, ${bmiText(bmi)}` : ''}</span></div>
        ${weightGoalHTML(plan)}
        <div style="margin-top:16px">${rangeChips()}</div>
        <div class="chart-box"><canvas id="weight-chart" role="img" aria-label="Your weight over time, with where your current pace leads"></canvas></div>
        <div class="chart-legend">
          <span><i style="--c:${esc(m.color)}"></i>Your weight</span>
          ${plan.paceKg !== null ? `<span><i class="dots" style="--c:${esc(m.color)}"></i>Current pace</span>` : ''}
          ${plan.goal ? '<span><i class="dash" style="--c:var(--goal)"></i>Goal plan</span>' : ''}
        </div>
      </div>

      <div class="section">
        <h3 style="margin-bottom:12px">Energy</h3>
        <div class="panel">
          <p><strong>Last 7 days</strong> <span class="muted">${avg7 !== null ? `average ${esc(signed(avg7, fmtKcal))} kcal a day` : 'no food logged yet'}</span></p>
          ${energyBars(es, m.color)}
          <p class="hint">Below the line: you ate less than you burned. Above: more. All calorie numbers are estimates${es.adjusted ? ', adjusted using how your weight has actually changed' : ''}.</p>
          ${p.sport_target ? `<div style="margin-top:14px"><p><strong>Sport this week:</strong> ${fmtKcal(sportWeek)} of ${fmtKcal(p.sport_target)} kcal</p>
            <div class="goal-bar ${sportWeek >= p.sport_target ? 'done' : ''}" style="margin-top:8px"><i style="width:${Math.min(100, Math.round((sportWeek / p.sport_target) * 100))}%"></i></div></div>` : ''}
        </div>
      </div>

      <div class="section">
        <h3 style="margin-bottom:6px">Recent logs</h3>
        ${recent.length ? `<ul class="history">
          ${recent.map((l, i) => {
            const newDay = i === 0 || recent[i - 1].date !== l.date;
            return `<li class="${newDay ? '' : 'same-day'}">
              <span class="h-date">${newDay ? fmtDate(l.date) : ''}</span>
              <span class="h-main"><span class="h-val">${l.kind === 'weight' ? fmtKg(l.value) : `${fmtKcal(l.value)} kcal`}</span>
                <br><span class="h-note">${kindName[l.kind]}${l.label ? `: ${esc(l.label)}` : ''}</span></span>
              <button type="button" class="icon-btn" data-action="delete-body-log" data-id="${l.id}" aria-label="Delete this log">${ICONS.trash}</button>
            </li>`;
          }).join('')}
        </ul>${recentAll.length > recent.length ? '<button type="button" class="btn wide" style="margin-top:12px" data-action="body-show-all">Show more</button>' : ''}` : '<p class="muted">Nothing logged in the last two weeks.</p>'}
      </div>

      <div class="section btn-row">
        <button type="button" class="btn" data-action="body-goals">Goals</button>
        <button type="button" class="btn" data-action="body-profile">Profile and privacy</button>
      </div>`;
  }

  function drawWeightChart(plan) {
    const canvas = $('#weight-chart');
    if (!canvas || !window.Chart) return;
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim();
    const line = css.getPropertyValue('--line').trim();
    const goalColor = css.getPropertyValue('--goal').trim();
    const color = me().color;
    const all = bLogs('weight');
    const shown = inRange(all);
    const t = (iso) => parseISO(iso).getTime();
    const pts = (shown.length ? shown : all.slice(-1)).map((w) => ({ x: t(w.date), y: w.value }));

    const datasets = [{
      label: 'weight', data: pts, borderColor: color, backgroundColor: color,
      borderWidth: 3, tension: 0.25, pointRadius: 3.5, pointHoverRadius: 7,
    }];
    if (plan.paceKg !== null) {
      datasets.push({
        label: 'pace', data: [{ x: t(todayISO()), y: plan.es.kg }, { x: t(plan.horizon), y: plan.paceKg }],
        borderColor: color, backgroundColor: color, borderDash: [2, 5], borderWidth: 3, borderCapStyle: 'round',
        pointRadius: [0, 4], tension: 0,
      });
    }
    if (plan.goal) {
      datasets.push({
        label: 'plan', data: [{ x: t(plan.goal.startDate), y: plan.goal.startKg }, { x: t(plan.goal.date), y: plan.goal.kg }],
        borderColor: goalColor, backgroundColor: goalColor, borderDash: [7, 5], borderWidth: 2,
        pointRadius: [0, 5], tension: 0,
      });
    }
    const xs = datasets.flatMap((d) => d.data.map((p) => p.x));
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    if (xMin === xMax) { xMin -= 3 * 86400000; xMax += 3 * 86400000; }
    const names = { weight: '', pace: 'At current pace: ', plan: 'Goal plan: ' };

    charts.push(new window.Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 8, right: 8 } },
        scales: {
          x: {
            type: 'linear', min: xMin, max: xMax, grid: { display: false }, border: { color: line },
            ticks: { color: muted, maxTicksLimit: 5, maxRotation: 0, callback: (v) => new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) },
          },
          y: { grace: '8%', grid: { color: line }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, callback: (v) => fmtNum(v) } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            filter: (item) => item.dataset.label === 'weight' || item.dataIndex === 1,
            callbacks: {
              title: (items) => new Date(items[0].parsed.x).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
              label: (item) => names[item.dataset.label] + fmtKg(item.parsed.y),
            },
          },
        },
      },
    }));
  }

  // ----- Body sheets -----
  function openBodyLogSheet(kind) {
    const today = todayISO();
    const last = latestWeight();
    const existing = kind === 'weight' ? bLogs('weight').find((l) => l.date === today) : null;
    const title = { weight: 'Log weight', food: 'Log food', sport: 'Log sport' }[kind];
    if (kind === 'food') return openFoodSheet();
    if (kind === 'watch') return openWatchSheet();
    openSheet(`<form data-form="body-log" data-kind="${kind}" novalidate>
      <h2>${title}</h2>
      <div class="log-value">
        <input class="input" name="value" type="text" inputmode="decimal" autocomplete="off" placeholder="${kind === 'weight' && last ? last.value : '0'}" aria-label="Amount">
        <span class="unit">${kind === 'weight' ? 'kg' : 'kcal'}</span>
      </div>
      ${kind === 'food' ? `<div class="chips" style="margin:14px 0 2px">${['Breakfast', 'Lunch', 'Dinner', 'Snack'].map((l) => `<button type="button" class="chip" data-action="set-label" data-label="${l}" aria-pressed="false">${l}</button>`).join('')}</div>` : ''}
      ${kind !== 'weight' ? `<label class="field" style="margin-top:12px"><span class="small">${kind === 'food' ? 'What was it? (optional)' : 'What did you do? (optional)'}</span>
        <input class="input" name="label" maxlength="120" placeholder="${kind === 'food' ? 'e.g. rice, beans and salad' : 'e.g. 45 min cycling'}"></label>` : ''}
      ${kind === 'sport' ? '<p class="hint" style="margin:-8px 0 12px">For sport you don’t track as an exercise. Exercises set to count toward sport calories are added automatically.</p>' : ''}
      <label class="field" style="margin-top:12px"><span class="small">Date</span><input class="input" name="date" type="date" value="${today}" max="${today}"></label>
      ${existing ? `<p class="hint" style="margin:-6px 0 12px">Replaces today’s ${fmtKg(existing.value)}.</p>` : ''}
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
      <p class="error-text" data-error hidden></p>
    </form>`);
  }

  function openBodyGoalsSheet(fresh) {
    const p = state.body.profile;
    const es = energyStats();
    const age = ageOf(p);
    const adult = age === null || age >= 18;
    const [lo, hi] = healthyRange(p);
    const keepGoal = !fresh && p.weight_goal;
    const due = keepGoal && p.weight_goal_date > todayISO() ? p.weight_goal_date : isoFromDate(addDays(new Date(), 84));
    openSheet(`<form data-form="body-goals" data-fresh="${fresh ? 1 : 0}" novalidate>
      <h2>Goals</h2>
      <div class="field"><span class="legend">Weight goal</span>
        <div class="log-value small-inputs"><input class="input" name="goal_weight" type="text" inputmode="decimal" autocomplete="off" placeholder="${Math.round(es.kg)}" value="${keepGoal ? p.weight_goal : ''}"><span class="unit">kg</span></div>
        <p class="hint">Now: ${fmtKg(latestWeight().value)}.${adult ? ` A healthy range for your height is ${Math.ceil(lo)}–${Math.floor(hi)} kg.` : ' For under-18s, weight goals are best set together with a doctor.'}</p>
      </div>
      <label class="field"><span>By</span><input class="input" name="goal_date" type="date" value="${due}" min="${isoFromDate(addDays(new Date(), 1))}"></label>
      <div class="field"><span class="legend">Daily food target <span class="muted small">(optional)</span></span>
        <div class="log-value small-inputs"><input class="input" name="kcal_target" type="text" inputmode="numeric" autocomplete="off" placeholder="${round10(es.avgBurn)}" value="${p.kcal_target ?? ''}"><span class="unit">kcal</span></div>
        <p class="hint" data-suggest></p>
      </div>
      <div class="field"><span class="legend">Weekly sport target <span class="muted small">(optional)</span></span>
        <div class="log-value small-inputs"><input class="input" name="sport_target" type="text" inputmode="numeric" autocomplete="off" placeholder="1500" value="${p.sport_target ?? ''}"><span class="unit">kcal</span></div>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save goals</button>
      </div>
      ${keepGoal ? '<p style="margin-top:16px;text-align:center"><button type="button" class="link" data-action="remove-weight-goal">Remove weight goal</button></p>' : ''}
      <p class="error-text" data-error hidden></p>
    </form>`);
    updateSuggestion();
  }

  // Live calorie suggestion while the weight goal is typed
  function updateSuggestion() {
    const form = $('#sheet-root form[data-form="body-goals"]');
    if (!form) return;
    const el = form.querySelector('[data-suggest]');
    const p = state.body.profile;
    const es = energyStats();
    const kg = parseNum(fld(form, 'goal_weight').value);
    const date = fld(form, 'goal_date').value;
    let html = `You burn about ${fmtKcal(round10(es.avgBurn))} kcal a day on average, including sport.`;
    if (kg >= 20 && kg <= 400 && date > todayISO()) {
      const need = round10(es.avgBurn + ((kg - es.kg) * KCAL_PER_KG) / daysBetween(todayISO(), date));
      html = need < kcalFloor(p)
        ? `Reaching ${fmtKg(kg)} by then would mean eating under ${fmtKcal(kcalFloor(p))} kcal a day, which isn’t recommended. Try a later date.`
        : `For this goal: about ${fmtKcal(need)} kcal a day. <button type="button" class="link" data-action="use-suggested" data-value="${need}">Use this</button>`;
    }
    el.innerHTML = html;
  }

  function openBodyProfileSheet() {
    const p = state.body.profile;
    openSheet(`<form data-form="body-profile" novalidate>
      <h2>Profile and privacy</h2>
      <div class="grid2">${heightInput(p.height_cm)}${birthInput(p.birth_year)}</div>
      ${sexField(p.sex)}
      ${activityField(p.activity)}
      ${watchField(p.watch_mode)}
      ${shareField(p.share_weight)}
      <div class="field"><span class="legend">PIN</span>
        ${p.has_pin ? '<p class="hint" style="margin:0 0 8px">This page is locked with a PIN. Type a new one to change it.</p>' : '<p class="hint" style="margin:0 0 8px">With a PIN, only you can open this page, even if someone else taps your name.</p>'}
        <input class="input pin" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="${p.has_pin ? 'New PIN' : '4 digits (optional)'}">
        ${p.has_pin ? '<button type="button" class="link" data-action="remove-pin">Remove PIN</button>' : ''}
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
      <p class="error-text" data-error hidden></p>
    </form>`);
  }

  // ----- Food: describe, photo or manual -----
  let foodSheet = null; // { tab, meal, date, text, note, image, result, kcal, label }
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const CAMERA_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';

  function openFoodSheet() {
    foodSheet = { tab: 'describe', meal: null, date: todayISO(), text: '', note: '', image: null, result: null, kcal: '', label: '' };
    openSheet(`<div data-food>${foodSheetHTML()}</div>`);
  }
  function redrawFood() {
    const box = $('#sheet-root [data-food]');
    if (box) box.innerHTML = foodSheetHTML();
  }
  // Keep what's typed when switching tabs or views
  function captureFood() {
    const f = $('#sheet-root [data-food] form');
    if (!f || !foodSheet) return;
    const v = (n) => (fld(f, n) ? fld(f, n).value : undefined);
    if (v('text') !== undefined) foodSheet.text = v('text');
    if (v('note') !== undefined) foodSheet.note = v('note');
    if (v('kcal') !== undefined) foodSheet.kcal = v('kcal');
    if (v('label') !== undefined) foodSheet.label = v('label');
    if (v('date') !== undefined) foodSheet.date = v('date') || todayISO();
    if (foodSheet.result) {
      $$('[data-item]', f).forEach((inp) => { const it = foodSheet.result.items[Number(inp.dataset.item)]; if (it) it.kcal = parseNum(inp.value) || 0; });
    }
  }

  // Recent meals you typed yourself, for one-tap logging
  function recentFoods() {
    const seen = new Set(), out = [];
    bLogs('food').slice().reverse().forEach((l) => {
      if (!l.label || out.length >= 6) return;
      const key = l.label.replace(/^(Breakfast|Lunch|Dinner|Snack): /, '').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label: l.label.replace(/^(Breakfast|Lunch|Dinner|Snack): /, ''), kcal: l.value });
    });
    return out;
  }

  function foodSheetHTML() {
    const f = foodSheet;
    const today = todayISO();
    const common = `
      <p class="small muted" style="margin:16px 0 6px">Meal</p>
      <div class="chips">${MEALS.map((l) => `<button type="button" class="chip" data-action="food-meal" data-label="${l}" aria-pressed="${f.meal === l}">${l}</button>`).join('')}</div>
      <label class="field" style="margin-top:12px"><span class="small">Date</span><input class="input" name="date" type="date" value="${f.date}" max="${today}"></label>`;

    if (f.result) {
      const items = f.result.items;
      const total = items.reduce((a, i) => a + (Number(i.kcal) || 0), 0);
      const conf = { high: 'Good estimate.', medium: 'Estimate: check the portions look right.', low: 'Rough estimate: adjust the numbers if you know better.' }[f.result.confidence] || '';
      return `<form data-form="food-save" novalidate>
        <h2>Estimate</h2>
        ${f.image ? `<img class="food-thumb" src="${f.image.preview}" alt="Your meal">` : ''}
        ${f.resultText ? `<p class="muted" style="margin-bottom:10px">“${esc(f.resultText)}”</p>` : ''}
        <ul class="food-items">
          ${items.map((it, i) => `<li>
            <span class="fi-name">${esc(it.name)}${it.portion ? `<br><span class="muted small">${esc(it.portion)}</span>` : ''}</span>
            <span class="fi-kcal"><input class="input" data-item="${i}" type="text" inputmode="numeric" autocomplete="off" value="${Math.round(it.kcal)}" aria-label="Calories for ${esc(it.name)}"><span class="unit">kcal</span></span>
            <button type="button" class="icon-btn" data-action="food-remove" data-i="${i}" aria-label="Remove ${esc(it.name)}">${ICONS.trash}</button>
          </li>`).join('')}
        </ul>
        <p class="food-total"><span>Total</span><span><strong data-food-total>${fmtKcal(total)}</strong> kcal</span></p>
        <p class="hint">${conf}${f.result.note ? ` ${esc(f.result.note)}` : ''}</p>
        ${common}
        <div class="btn-row" style="margin-top:8px">
          <button type="button" class="btn" data-action="food-back">Back</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
        <p class="error-text" data-error hidden></p>
      </form>`;
    }

    const tabBtn = (k, l) => `<button type="button" data-action="food-tab" data-tab="${k}" aria-pressed="${f.tab === k}">${l}</button>`;
    let body = '';
    if (f.tab === 'describe') {
      body = `<label class="field"><span class="visually-hidden">What did you eat?</span>
          <textarea class="input textarea" name="text" rows="3" maxlength="1000" placeholder="What did you eat? e.g. two eggs, toast with butter and a coffee with milk">${esc(f.text)}</textarea></label>
        <p class="hint" style="margin-top:-8px">Tip: tap the microphone on your keyboard to say it instead of typing. Amounts help, like “a big bowl” or “half a plate”.</p>`;
    } else if (f.tab === 'photo') {
      body = `<label class="photo-pick">
          ${f.image ? `<img src="${f.image.preview}" alt="Your meal">` : `${CAMERA_ICON}<span>Take or choose a photo</span>`}
          <input class="visually-hidden" type="file" name="photo" accept="image/*">
        </label>
        ${f.image ? '<p class="hint" style="text-align:center;margin:-6px 0 10px">Tap the photo to change it.</p>' : ''}
        <label class="field"><span class="small">Anything the photo doesn’t show? (optional)</span>
          <input class="input" name="note" maxlength="300" value="${esc(f.note)}" placeholder="e.g. half portion, fried in oil, sweet tea"></label>`;
    } else {
      const recent = recentFoods();
      body = `<div class="log-value">
          <input class="input" name="kcal" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.kcal)}" aria-label="Calories">
          <span class="unit">kcal</span></div>
        <label class="field" style="margin-top:12px"><span class="small">What was it? (optional)</span>
          <input class="input" name="label" maxlength="120" value="${esc(f.label)}" placeholder="e.g. rice, beans and salad"></label>
        ${recent.length ? `<p class="small muted" style="margin-bottom:6px">Recent</p><div class="chips">${recent.map((r, i) => `<button type="button" class="chip" data-action="food-recent" data-i="${i}">${esc(r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label)} (${fmtKcal(r.kcal)})</button>`).join('')}</div>` : ''}`;
    }
    return `<form data-form="food" novalidate>
      <h2>Log food</h2>
      <div class="segmented three" role="group" aria-label="How to log">${tabBtn('describe', 'Describe')}${tabBtn('photo', 'Photo')}${tabBtn('manual', 'Manual')}</div>
      ${body}
      ${common}
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">${f.tab === 'manual' ? 'Save' : 'Estimate'}</button>
      </div>
      <p class="error-text" data-error hidden></p>
    </form>`;
  }

  function updateFoodTotal() {
    const el = $('#sheet-root [data-food-total]');
    if (!el) return;
    const total = $$('#sheet-root [data-item]').reduce((a, inp) => a + (parseNum(inp.value) || 0), 0);
    el.textContent = fmtKcal(total);
  }

  // Shrink the photo before sending (faster, cheaper, same accuracy)
  async function readPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.82);
      return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Calls the estimate-food function in your Supabase
  async function estimateFood(text, image) {
    const url = cfg.SUPABASE_URL.replace(/\/+$/, '') + '/functions/v1/estimate-food';
    const headers = { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_KEY };
    if (cfg.SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + cfg.SUPABASE_KEY; // older "anon" keys
    let res;
    try {
      res = await Promise.race([
        fetch(url, {
          method: 'POST', headers,
          body: JSON.stringify({
            code: state.code, member_id: state.meId, pin: bodyPin(), text,
            image: image ? { media_type: image.media_type, data: image.data } : null,
          }),
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000)),
      ]);
    } catch {
      throw new Error('Couldn’t reach the AI estimate. Check your connection. If it keeps happening, check the estimate-food setup in the README.');
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.ok) return data;
    const code = String((data && (data.code || data.error || data.message)) || '');
    if (res.status === 404) throw new Error('AI estimates aren’t set up yet (README, part “AI food estimates”). You can use Manual for now.');
    if (res.status === 401) throw new Error('The estimate-food function is refusing the app. Turn off “Verify JWT” for it (README, step A4).');
    if (code.includes('AI_LIMIT')) throw new Error('You’ve reached today’s limit of AI estimates. Use Manual, or try again tomorrow.');
    if (code.includes('AI_BUSY')) throw new Error('The AI is busy or its free limit was reached. Try again in a minute, or use Manual.');
    if (code.includes('NO_KEY')) throw new Error('The AI key isn’t saved in Supabase yet (README, step A2).');
    if (code.includes('BAD_KEY')) throw new Error('The AI key was refused. Check the secret in Supabase (README, step A2).');
    if (code.includes('BAD_MODEL')) throw new Error('The AI model name wasn’t found. Check the model setting at the top of estimate-food.ts.');
    if (/PIN_/.test(code)) throw new Error('Your PIN needs re-entering. Reopen the Body tab and try again.');
    throw new Error((data && data.error) || 'The estimate didn’t work. Try again.');
  }

  function mealLabel(text) {
    const m = foodSheet.meal;
    if (m && text) return `${m}: ${text}`.slice(0, 120);
    return (m || text || '').slice(0, 120) || null;
  }

  // ----- Watch calories -----
  function openWatchSheet() {
    const p = state.body.profile;
    const yest = daysAgoISO(1);
    const date = bLogs('watch').some((l) => l.date === yest) ? todayISO() : yest;
    const existing = bLogs('watch').find((l) => l.date === date);
    openSheet(`<form data-form="body-log" data-kind="watch" novalidate>
      <h2>Log watch calories</h2>
      <p class="muted" style="margin:-8px 0 16px">${p.watch_mode === 'active'
        ? 'Your watch’s <strong>active</strong> calories for the whole day.'
        : 'Your watch’s <strong>total</strong> calories burned for the whole day (resting + active).'}</p>
      <div class="log-value">
        <input class="input" name="value" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Calories">
        <span class="unit">kcal</span>
      </div>
      <label class="field" style="margin-top:12px"><span class="small">Day</span><input class="input" name="date" type="date" value="${date}" max="${todayISO()}"></label>
      <p class="hint" style="margin:-6px 0 12px">Best logged the next morning, once the day is complete.${existing ? ` Replaces the ${fmtKcal(existing.value)} kcal already logged for that day.` : ''}</p>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
      <p class="error-text" data-error hidden></p>
    </form>`);
  }

  // Save a body log straight away, then sync in the background
  async function saveBodyLog(kind, value, date, label) {
    const log = { id: newId(), kind, value, date, label };
    const hadReached = kind === 'weight' && weightGoalReached();
    const replaced = kind === 'weight' || kind === 'watch' ? state.body.logs.filter((l) => l.kind === kind && l.date === date) : [];
    state.body.logs = state.body.logs.filter((l) => !replaced.includes(l));
    state.body.logs.push(log);
    sortByDate(state.body.logs);
    closeSheet();
    render();
    if (kind === 'weight' && !hadReached && weightGoalReached()) toast('You reached your weight goal!', true);
    else toast('Saved');
    try {
      await rpc('add_body_log', {
        p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_id: log.id,
        p_kind: kind, p_value: value, p_date: date, p_label: label,
      }, { retries: 2 });
      if (kind === 'weight' && state.body && state.body.profile.share_weight) loadFamily();
    } catch (e) {
      if (state.body) {
        state.body.logs = state.body.logs.filter((l) => l.id !== log.id).concat(replaced);
        sortByDate(state.body.logs);
      }
      render();
      toast(`Couldn’t save. ${e.message}`);
    }
  }

  // =====================================================================
  // Rendering
  // =====================================================================
  function render() {
    destroyCharts();
    app.classList.add('no-tabs');
    if (!configured || !libsLoaded) { app.innerHTML = viewSetupNeeded(); return; }
    if (!state.code) { app.innerHTML = viewWelcome(); return; }
    if (!state.data) {
      app.innerHTML = state.error
        ? `<div class="center-note"><h2>Couldn’t load your family</h2><p>${esc(state.error)}</p>
            <p style="margin-top:18px"><button type="button" class="btn primary" data-action="retry">Try again</button></p>
            <p><button type="button" class="link" data-action="leave">Use a different family code</button></p></div>`
        : '<div class="center-note"><p>Loading your family…</p></div>';
      return;
    }
    if (!me()) { app.innerHTML = viewWho(); return; }

    const r = route();
    let html, tab = r.name;
    switch (r.name) {
      case 'family': html = viewFamily(); break;
      case 'body': html = viewBody(); break;
      case 'settings': html = viewSettings(); tab = 'home'; break;
      case 'exercise': {
        html = viewExercise(r.id);
        const ex = exerciseById(r.id);
        tab = ex && ex.member_id !== state.meId ? 'family' : 'home';
        break;
      }
      default: html = viewHome(); tab = 'home';
    }
    app.classList.remove('no-tabs');
    app.innerHTML = html + tabBar(tab);
    renderTimerSlots();
    if (sw.running || swMs() > 0) mirrorStopwatch();

    if (r.name === 'exercise') {
      const ex = exerciseById(r.id);
      if (ex) drawDetailChart(ex, inRange(entriesFor(ex.id)), memberById(ex.member_id).color);
    }
    if (r.name === 'body' && $('#weight-chart')) drawWeightChart(weightPlan());
  }

  // Don't redraw underneath someone who is halfway through typing
  function safeRender() {
    if ($('#app [data-dirty]') || $('.sheet-overlay')) return;
    render();
  }

  // =====================================================================
  // Pop-up sheets
  // =====================================================================
  let sheetState = null; // new / edit exercise form

  function openSheet(html) {
    $('#sheet-root').innerHTML = `<div class="sheet-overlay" data-action="overlay"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    const first = $('#sheet-root input:checked, #sheet-root input, #sheet-root button');
    if (first) setTimeout(() => first.focus(), 50);
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; sheetState = null; foodSheet = null; }

  // ----- New / edit exercise -----
  function exerciseSheetHTML() {
    const s = sheetState;
    const editing = !!s.id;
    const type = s.unit_type;
    const units = UNIT_TYPES[type].units;

    let unitBlock = '';
    if (!editing && units && units.length > 1) {
      unitBlock = `<fieldset><span class="legend">Unit</span><div class="choice">
        ${units.map((u) => `<label><input type="radio" name="unit_label" value="${u}" ${s.unit_label === u ? 'checked' : ''}><span>${u}</span></label>`).join('')}
      </div></fieldset>`;
    } else if (type === 'custom') {
      unitBlock = `<label class="field"><span>Unit name</span>
        <input class="input" name="unit_label" maxlength="20" value="${esc(s.unit_label)}" placeholder="e.g. laps, floors, pages">
        <span class="hint">Leave empty for a plain number.</span></label>`;
    }

    return `<form data-form="exercise" novalidate>
      <h2>${editing ? 'Edit exercise' : 'New exercise'}</h2>
      <label class="field"><span>Name</span>
        <input class="input" name="name" maxlength="60" value="${esc(s.name)}" placeholder="e.g. Push-ups" required></label>
      ${editing
        ? `<p class="muted" style="margin:-4px 0 16px">Measured in ${esc(type === 'duration' ? 'time' : (s.unit_label || UNIT_TYPES[type].label.toLowerCase()))}. This can’t change once created, so your history stays accurate.</p>`
        : `<fieldset><span class="legend">What do you measure?</span><div class="choice">
            ${Object.entries(UNIT_TYPES).map(([k, v]) => `<label><input type="radio" name="unit_type" value="${k}" ${type === k ? 'checked' : ''}><span>${v.label}</span></label>`).join('')}
          </div></fieldset>`}
      ${unitBlock}
      <fieldset><span class="legend">Progress means the number goes…</span><div class="choice">
        <label><input type="radio" name="dir" value="up" ${s.higher_is_better ? 'checked' : ''}><span>Up</span></label>
        <label><input type="radio" name="dir" value="down" ${!s.higher_is_better ? 'checked' : ''}><span>Down</span></label>
      </div><p class="hint">Pick “down” for things like a run time, where faster is better.</p></fieldset>
      ${sportFieldHTML(s)}
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Create exercise'}</button>
      </div>
      ${editing ? `<p style="margin-top:16px;text-align:center"><button type="button" class="link" data-action="archive-exercise" data-id="${s.id}">Archive this exercise</button></p>
        <p class="hint" style="text-align:center">Archiving hides it but keeps its history. You can restore it in Settings.</p>` : ''}
      <p class="error-text" data-error hidden></p>
    </form>`;
  }

  function sportFieldHTML(s) {
    const opts = sportOptions(s);
    if (!opts.length) {
      return `<fieldset><span class="legend">Sport calories</span>
        <p class="hint" style="margin-top:0">Heaviest-weight exercises can’t be turned into calories, so this one doesn’t count toward sport calories.</p></fieldset>`;
    }
    return `<fieldset><span class="legend">Counts toward sport calories as</span><div class="choice">
        ${['none', ...opts].map((k) => `<label><input type="radio" name="sport" value="${k}" ${s.sport === k ? 'checked' : ''}><span>${k === 'none' ? 'Don’t count' : k === 'kcal' ? 'Calories (as logged)' : SPORTS[k].label}</span></label>`).join('')}
      </div><p class="hint">${s.unit_type === 'custom'
        ? 'Choose “Calories (as logged)” if you log this in kcal, e.g. from a machine or your watch.'
        : 'Each time you log this, its estimated calories are added on your Body page.'}</p></fieldset>`;
  }

  function openExerciseSheet(ex, preset) {
    const base = ex || preset || { name: '', unit_type: 'reps', unit_label: 'reps', higher_is_better: true };
    sheetState = {
      id: ex ? ex.id : null,
      name: base.name, unit_type: base.unit_type, unit_label: base.unit_label,
      higher_is_better: base.higher_is_better,
      sport: ex ? (sportOf(ex) || 'none') : guessSport(base.name, base),
      sportTouched: !!ex,
    };
    openSheet(exerciseSheetHTML());
  }

  // Keep what's typed when the sheet redraws after a type change
  function captureSheet() {
    const f = $('#sheet-root form[data-form="exercise"]');
    if (!f || !sheetState) return;
    sheetState.name = fld(f, 'name').value;
    const dir = f.querySelector('[name=dir]:checked');
    if (dir) sheetState.higher_is_better = dir.value === 'up';
    const ul = f.querySelector('[name=unit_label]:checked') || f.querySelector('input[name=unit_label]:not([type=radio])');
    if (ul) sheetState.unit_label = ul.value;
    const sp = f.querySelector('[name=sport]:checked');
    if (sp) sheetState.sport = sp.value;
  }
  // Re-guess the sport activity as the name or unit is typed, until the person picks one
  function refreshSportGuess() {
    if (!sheetState || sheetState.sportTouched) return;
    captureSheet();
    const g = guessSport(sheetState.name, sheetState);
    sheetState.sport = g;
    const input = $(`#sheet-root input[name=sport][value="${g}"]`);
    if (input) input.checked = true;
  }

  // ----- Goal for one exercise -----
  function valueInputs(ex, prefix, value) {
    if (ex.unit_type === 'duration') {
      const s = value == null ? null : Math.round(value);
      return `<div class="log-value dur small-inputs">
        <input class="input" name="${prefix}_min" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="${s == null ? '' : Math.floor(s / 60)}" aria-label="Minutes"><span class="unit">min</span>
        <input class="input" name="${prefix}_sec" type="number" inputmode="numeric" min="0" max="59" step="1" placeholder="0" value="${s == null ? '' : s % 60}" aria-label="Seconds"><span class="unit">sec</span>
      </div>`;
    }
    return `<div class="log-value small-inputs">
      <input class="input" name="${prefix}" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${value == null ? '' : value}" aria-label="Amount">
      ${ex.unit_label ? `<span class="unit">${esc(ex.unit_label)}</span>` : ''}
    </div>`;
  }
  function readValue(ex, form, prefix) {
    if (ex.unit_type === 'duration') {
      const mi = fld(form, prefix + '_min').value, se = fld(form, prefix + '_sec').value;
      if (mi === '' && se === '') return NaN;
      if (Number(se) >= 60) return NaN;
      return Math.round(Number(mi || 0) * 60 + Number(se || 0));
    }
    return parseNum(fld(form, prefix).value);
  }

  function openGoalSheet(ex, fresh) {
    const g = fresh ? null : goalFor(ex.id);
    const accum = UNIT_TYPES[ex.unit_type].accumulates;
    const kind = g ? g.kind : 'target';
    const all = entriesFor(ex.id);
    const st = statsFor(ex, all);
    const dueDefault = g && g.kind === 'target' ? g.due_date : isoFromDate(addDays(new Date(), 56));
    const [lmStart, lmEnd] = lastMonthRange();
    const lastMonth = all.filter((e) => e.date >= lmStart && e.date <= lmEnd).reduce((s, e) => s + e.value, 0);
    const thisMonth = all.filter((e) => e.date >= monthStartISO()).reduce((s, e) => s + e.value, 0);

    openSheet(`<form data-form="goal" data-ex="${ex.id}" data-fresh="${fresh ? 1 : 0}" novalidate>
      <h2>${g ? 'Edit goal' : 'Set a goal'}</h2>
      <p class="muted" style="margin:-8px 0 18px">${esc(ex.name)}</p>
      ${accum ? `<fieldset><span class="legend">What kind of goal?</span><div class="choice">
          <label><input type="radio" name="goal_kind" value="target" ${kind === 'target' ? 'checked' : ''}><span>Reach a target</span></label>
          <label><input type="radio" name="goal_kind" value="monthly" ${kind === 'monthly' ? 'checked' : ''}><span>Monthly total</span></label>
        </div></fieldset>` : ''}

      <div data-kind-block="target" ${kind === 'target' ? '' : 'hidden'}>
        <div class="field"><span class="legend">Target</span>
          ${valueInputs(ex, 'target', g && g.kind === 'target' ? g.target_value : null)}
          <p class="hint">${st ? `Now: ${esc(fmtValue(ex, st.latest.value))}. Best: ${esc(fmtValue(ex, st.best.value))}.` : 'Progress is measured from your first entry.'}</p>
        </div>
        <label class="field"><span>By</span>
          <input class="input" name="due" type="date" value="${dueDefault}" min="${isoFromDate(addDays(new Date(), 1))}"></label>
      </div>

      ${accum ? `<div data-kind-block="monthly" ${kind === 'monthly' ? '' : 'hidden'}>
        <div class="field"><span class="legend">Total each month</span>
          ${valueInputs(ex, 'monthly', g && g.kind === 'monthly' ? g.target_value : null)}
          <p class="hint">So far this month: ${esc(fmtValue(ex, thisMonth))}. Last month: ${esc(fmtValue(ex, lastMonth))}.</p>
        </div>
      </div>` : ''}

      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save goal</button>
      </div>
      ${g ? `<p style="margin-top:16px;text-align:center"><button type="button" class="link" data-action="delete-goal" data-id="${ex.id}">Remove goal</button></p>` : ''}
      <p class="error-text" data-error hidden></p>
    </form>`);
  }

  // ----- Weekly habit -----
  function openWeeklySheet() {
    const m = me();
    const current = m.weekly_goal || 3;
    openSheet(`<form data-form="weekly" novalidate>
      <h2>Weekly goal</h2>
      <p class="muted" style="margin:-8px 0 18px">How many days a week do you want to be active? Logging any exercise counts for that day.</p>
      <fieldset><span class="legend">Days per week</span><div class="choice days">
        ${[1, 2, 3, 4, 5, 6, 7].map((n) => `<label><input type="radio" name="days" value="${n}" ${n === current ? 'checked' : ''}><span>${n}</span></label>`).join('')}
      </div></fieldset>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save goal</button>
      </div>
      ${m.weekly_goal ? '<p style="margin-top:16px;text-align:center"><button type="button" class="link" data-action="delete-weekly">Remove weekly goal</button></p>' : ''}
      <p class="error-text" data-error hidden></p>
    </form>`);
  }

  // =====================================================================
  // Events
  // =====================================================================
  function showFormError(form, msg) {
    const el = form && form.querySelector('[data-error]');
    if (el) { el.textContent = msg; el.hidden = false; }
    toast(msg); // shown at the top, where the keyboard can't cover it
  }
  async function withBusy(form, fn, busyLabel = 'Saving…') {
    const btns = $$('[type=submit]', form);
    const main = btns[btns.length - 1];
    const label = main ? main.textContent : '';
    const err = form.querySelector('[data-error]');
    if (err) err.hidden = true;
    if (document.activeElement) document.activeElement.blur();
    btns.forEach((b) => { b.disabled = true; });
    if (main) main.textContent = busyLabel;
    try { await fn(); }
    catch (e) { showFormError(form, e.message); }
    finally {
      btns.forEach((b) => { if (b.isConnected) b.disabled = false; });
      if (main && main.isConnected) main.textContent = label;
    }
  }

  // Remember which submit button was pressed (for older browsers without e.submitter)
  let lastSubmitValue = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[type=submit]');
    lastSubmitValue = b ? b.value : null;
  }, true);

  function progressSnapshot(ex) {
    const g = goalFor(ex.id);
    const m = me();
    const st = statsFor(ex, entriesFor(ex.id));
    return {
      goalKind: g ? g.kind : null,
      goalReached: g ? goalProgress(ex, g).reached : false,
      weekMet: m.weekly_goal ? weekInfo(m.id).count >= m.weekly_goal : false,
      best: st ? st.best.value : null,
    };
  }

  async function onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;

    if (kind === 'join') {
      const code = fld(form, 'code').value.trim();
      if (!code) return showFormError(form, 'Enter your family code.');
      await withBusy(form, async () => {
        const d = await rpc('get_family', { p_code: code });
        state.code = d.family.code;
        store.set('ff_code', state.code);
        setMe(null);
        history.replaceState(null, '', location.pathname);
        await loadFamily();
        render();
      });
    }

    if (kind === 'create') {
      const name = fld(form, 'name').value.trim();
      if (!name) return showFormError(form, 'Enter a family name.');
      await withBusy(form, async () => {
        const f = await rpc('create_family', { p_name: name }, { retries: 0 });
        state.code = f.code;
        store.set('ff_code', state.code);
        setMe(null);
        await loadFamily();
        render();
        toast(`Family created. Your code is ${f.code}`);
      });
    }

    if (kind === 'add-member') {
      const name = fld(form, 'name').value.trim();
      if (!name) return showFormError(form, 'Enter your name.');
      const color = (form.querySelector('[name=color]:checked') || {}).value || COLORS[0];
      await withBusy(form, async () => {
        const r = await rpc('add_member', { p_code: state.code, p_name: name, p_color: color }, { retries: 0 });
        setMe(r.id);
        await loadFamily();
        go('home');
        render();
      });
    }

    if (kind === 'profile') {
      const name = fld(form, 'name').value.trim();
      if (!name) return showFormError(form, 'Enter your name.');
      const color = (form.querySelector('[name=color]:checked') || {}).value || me().color;
      await withBusy(form, async () => {
        await rpc('update_member', { p_code: state.code, p_member_id: state.meId, p_name: name, p_color: color });
        await loadFamily();
        render();
        toast('Changes saved');
      });
    }

    if (kind === 'log') {
      const ex = exerciseById(form.dataset.ex);
      const rest = ((e.submitter && e.submitter.value) || lastSubmitValue) === 'rest';
      if (rest) unlockAudio(); // must happen during the tap for sound to work later
      let value, usedStopwatch = false;
      if (ex.unit_type === 'duration') {
        const mi = fld(form, 'min'), se = fld(form, 'sec');
        const typed = mi.dataset.auto !== '1' && (mi.value !== '' || se.value !== '');
        if (!typed && swMs() >= 1000) {
          value = Math.round(swMs() / 1000);
          usedStopwatch = true;
        } else {
          const secs = Number(se.value || 0);
          if (secs >= 60) return showFormError(form, 'Seconds should be 0 to 59.');
          value = Math.round(Number(mi.value || 0) * 60 + secs);
        }
        if (!(value > 0)) return showFormError(form, 'Start the stopwatch, or type a time.');
      } else {
        const raw = fld(form, 'value').value;
        if (raw.trim() === '') return showFormError(form, 'Enter a number.');
        value = parseNum(raw);
        if (!Number.isFinite(value) || value < 0) return showFormError(form, 'Enter a number of 0 or more.');
      }
      const date = fld(form, 'date').value || todayISO();
      if (date > todayISO()) return showFormError(form, 'The date can’t be in the future.');

      // Show the entry straight away, then save it in the background
      const before = progressSnapshot(ex);
      const entry = {
        id: newId(), member_id: state.meId, exercise_id: ex.id,
        value, date, note: fld(form, 'note').value.trim() || null,
      };
      if (document.activeElement) document.activeElement.blur();
      state.data.entries.push(entry);
      sortByDate(state.data.entries);
      if (usedStopwatch || ex.unit_type === 'duration') { sw.running = false; sw.base = 0; }
      if (rest) { cd.base = 0; cd.done = false; cd.t0 = Date.now(); cd.running = true; }
      render();

      const after = progressSnapshot(ex);
      const g = goalFor(ex.id);
      if (!before.goalReached && after.goalReached) {
        toast(g.kind === 'monthly' ? 'Monthly goal reached!' : `Goal reached: ${fmtValue(ex, g.target_value)}!`, true);
      } else if (before.best !== null && isBetter(ex, value, before.best)) {
        toast('New personal best!', true);
      } else if (!before.weekMet && after.weekMet) {
        toast(`Weekly goal met: ${plural(me().weekly_goal, 'day', 'days')}!`, true);
      } else {
        toast(rest ? 'Saved. Rest started.' : 'Entry saved');
      }
      if (rest) {
        const panel = $('#rest-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      try {
        await rpc('add_entry', {
          p_code: state.code, p_member_id: state.meId, p_exercise_id: ex.id,
          p_value: value, p_date: date, p_note: entry.note, p_id: entry.id,
        }, { retries: 2 });
      } catch (err) {
        state.data.entries = state.data.entries.filter((x) => x.id !== entry.id);
        render();
        toast(`Couldn’t save ${fmtValue(ex, value)}. ${err.message}`);
      }
    }

    if (kind === 'exercise') {
      captureSheet();
      const s = sheetState;
      if (!s.name.trim()) return showFormError(form, 'Give the exercise a name.');
      const unit = s.unit_type === 'duration' ? '' : (s.unit_label || '').trim();
      await withBusy(form, async () => {
        const sportChoice = sportOptions(s).length ? (s.sport || 'none') : null;
        if (s.id) {
          await rpc('update_exercise', {
            p_code: state.code, p_exercise_id: s.id, p_name: s.name.trim(),
            p_unit_label: unit, p_higher_is_better: s.higher_is_better, p_archived: false,
          });
          const old = exerciseById(s.id);
          if (sportChoice && sportChoice !== (sportOf(old) || 'none')) {
            await rpc('set_exercise_sport', { p_code: state.code, p_exercise_id: s.id, p_activity: sportChoice });
          }
          closeSheet();
          await loadFamily();
          render();
          toast('Changes saved');
        } else {
          const r = await rpc('add_exercise', {
            p_code: state.code, p_member_id: state.meId, p_name: s.name.trim(),
            p_unit_type: s.unit_type, p_unit_label: unit, p_higher_is_better: s.higher_is_better,
          });
          if (sportChoice) await rpc('set_exercise_sport', { p_code: state.code, p_exercise_id: r.id, p_activity: sportChoice });
          closeSheet();
          await loadFamily();
          go('exercise/' + r.id);
          toast('Exercise created');
        }
      });
    }

    if (kind === 'goal') {
      const ex = exerciseById(form.dataset.ex);
      const fresh = form.dataset.fresh === '1';
      const existing = fresh ? null : goalFor(ex.id);
      const checked = form.querySelector('[name=goal_kind]:checked');
      const goalKind = checked ? checked.value : 'target';
      const today = todayISO();
      const st = statsFor(ex, entriesFor(ex.id));
      let args;

      if (goalKind === 'target') {
        const target = readValue(ex, form, 'target');
        if (!(target > 0)) return showFormError(form, 'Enter a target.');
        const due = fld(form, 'due').value;
        if (!due || due <= today) return showFormError(form, 'Pick a date after today.');
        // Keep the original starting point when editing the same goal
        const keep = existing && existing.kind === 'target';
        const startValue = keep ? existing.start_value : (st ? st.latest.value : null);
        if (startValue !== null && !isBetter(ex, target, startValue)) {
          return showFormError(form, `Pick a target ${ex.higher_is_better ? 'above' : 'below'} ${fmtValue(ex, startValue)}, where you are now.`);
        }
        args = {
          p_kind: 'target', p_target: target, p_start_value: startValue,
          p_start_date: keep ? existing.start_date : today, p_due_date: due,
        };
      } else {
        const target = readValue(ex, form, 'monthly');
        if (!(target > 0)) return showFormError(form, 'Enter a monthly total.');
        args = { p_kind: 'monthly', p_target: target, p_start_value: null, p_start_date: today, p_due_date: null };
      }

      await withBusy(form, async () => {
        await rpc('set_goal', { p_code: state.code, p_exercise_id: ex.id, ...args });
        closeSheet();
        await loadFamily();
        render();
        toast('Goal saved');
      });
    }

    if (kind === 'weekly') {
      const days = Number((form.querySelector('[name=days]:checked') || {}).value || 0);
      if (!days) return showFormError(form, 'Pick a number of days.');
      await withBusy(form, async () => {
        await rpc('set_weekly_goal', { p_code: state.code, p_member_id: state.meId, p_days: days });
        closeSheet();
        await loadFamily();
        render();
        toast('Weekly goal saved');
      });
    }

    // ----- Body page forms -----
    if (kind === 'body-setup') {
      const f = readProfileForm(form);
      const weight = parseNum(fld(form, 'weight').value);
      if (f.error) return showFormError(form, f.error);
      if (!(weight >= 20 && weight <= 400)) return showFormError(form, 'Enter your weight in kg, e.g. 72.5.');
      await withBusy(form, async () => {
        await rpc('update_profile', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_data: f.data });
        if (f.pin) {
          await rpc('set_body_pin', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_new_pin: f.pin });
          store.set(pinKey(state.meId), f.pin);
        }
        await rpc('add_body_log', {
          p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_id: newId(),
          p_kind: 'weight', p_value: weight, p_date: todayISO(), p_label: null,
        }, { retries: 2 });
        await loadBody();
        if (f.data.share_weight) await loadFamily();
        render();
        toast('All set. Now you can log food and sport.');
      });
    }

    if (kind === 'body-pin') {
      const pin = fld(form, 'pin').value.trim();
      if (!/^[0-9]{4}$/.test(pin)) return showFormError(form, 'Enter your 4-digit PIN.');
      await withBusy(form, async () => {
        store.set(pinKey(state.meId), pin);
        state.bodyLocked = false;
        await loadBody();
        render();
      });
    }

    if (kind === 'body-log') {
      const k = form.dataset.kind;
      const value = parseNum(fld(form, 'value').value);
      const date = fld(form, 'date').value || todayISO();
      if (k === 'watch' && !(value > 0 && value <= 10000)) return showFormError(form, 'Enter the calories from your watch, e.g. 2350.');
      if (k === 'weight' ? !(value >= 20 && value <= 400) : !(value > 0 && value <= 10000)) {
        return showFormError(form, k === 'weight' ? 'Enter your weight in kg, e.g. 72.5.' : 'Enter the calories, e.g. 450.');
      }
      if (date > todayISO()) return showFormError(form, 'The date can’t be in the future.');
      const labelEl = fld(form, 'label');
      if (document.activeElement) document.activeElement.blur();
      const label = k === 'watch'
        ? (state.body.profile.watch_mode === 'active' ? 'active calories' : 'total burned')
        : (labelEl ? labelEl.value.trim() || null : null);
      await saveBodyLog(k, value, date, label);
    }

    if (kind === 'food') {
      captureFood();
      const f = foodSheet;
      const date = f.date || todayISO();
      if (date > todayISO()) return showFormError(form, 'The date can’t be in the future.');
      if (f.tab === 'manual') {
        const value = parseNum(f.kcal);
        if (!(value > 0 && value <= 10000)) return showFormError(form, 'Enter the calories, e.g. 450.');
        if (document.activeElement) document.activeElement.blur();
        return saveBodyLog('food', value, date, mealLabel(f.label.trim()));
      }
      const text = (f.tab === 'describe' ? f.text : f.note).trim();
      if (f.tab === 'describe' && text.length < 2) return showFormError(form, 'Describe what you ate, or use Photo or Manual.');
      if (f.tab === 'photo' && !f.image) return showFormError(form, 'Add a photo first.');
      await withBusy(form, async () => {
        const r = await estimateFood(text, f.tab === 'photo' ? f.image : null);
        if (!foodSheet) return; // sheet was closed meanwhile
        if (!r.items || !r.items.length) throw new Error(r.note || 'That doesn’t look like food. Try describing it.');
        foodSheet.result = { items: r.items, confidence: r.confidence, note: r.note };
        foodSheet.resultText = text;
        redrawFood();
      }, 'Estimating…');
      return;
    }

    if (kind === 'food-save') {
      captureFood();
      const f = foodSheet;
      const items = f.result.items.filter((i) => i.kcal > 0);
      const total = Math.round(items.reduce((a, i) => a + i.kcal, 0));
      if (!items.length || !(total > 0 && total <= 10000)) return showFormError(form, 'The total needs to be between 1 and 10,000 kcal.');
      const date = f.date || todayISO();
      if (date > todayISO()) return showFormError(form, 'The date can’t be in the future.');
      return saveBodyLog('food', total, date, mealLabel(items.map((i) => i.name).join(', ')));
    }

    if (kind === 'body-goals') {
      const p = state.body.profile;
      const today = todayISO();
      const now = latestWeight().value;
      const gwRaw = fld(form, 'goal_weight').value.trim();
      const ktRaw = fld(form, 'kcal_target').value.trim();
      const stRaw = fld(form, 'sport_target').value.trim();
      const gw = gwRaw === '' ? null : parseNum(gwRaw);
      const gd = fld(form, 'goal_date').value;
      const kt = ktRaw === '' ? null : Math.round(parseNum(ktRaw));
      const stg = stRaw === '' ? null : Math.round(parseNum(stRaw));
      const data = {};

      if (gw !== null) {
        if (!(gw >= 20 && gw <= 400)) return showFormError(form, 'Enter a goal weight in kg.');
        if (!gd || gd <= today) return showFormError(form, 'Pick a goal date after today.');
        const [lo] = healthyRange(p);
        if (gw < lo && gw < now) {
          return showFormError(form, `That’s below the healthy range for your height. Pick ${Math.ceil(lo)} kg or more.`);
        }
        const perWeek = (gw - now) / (daysBetween(today, gd) / 7);
        if (perWeek < -1 || perWeek > 0.5) {
          const maxRate = perWeek < 0 ? 1 : 0.5;
          const earliest = isoFromDate(addDays(new Date(), Math.ceil((Math.abs(gw - now) / maxRate) * 7)));
          return showFormError(form, `That’s about ${Math.abs(perWeek).toFixed(1)} kg a week, faster than the ${perWeek < 0 ? '0.5–1' : '0.25–0.5'} kg a week usually recommended. Try ${fmtDate(earliest)} or later.`);
        }
        // Keep the starting point if only the date changes
        const same = form.dataset.fresh !== '1' && p.weight_goal === gw && p.weight_goal_start != null;
        Object.assign(data, {
          weight_goal: gw, weight_goal_date: gd,
          weight_goal_start: same ? p.weight_goal_start : now,
          weight_goal_start_date: same ? p.weight_goal_start_date : today,
        });
      } else if (form.dataset.fresh !== '1') {
        Object.assign(data, { weight_goal: null, weight_goal_date: null, weight_goal_start: null, weight_goal_start_date: null });
      }

      if (kt !== null) {
        if (!(kt >= 500 && kt <= 8000)) return showFormError(form, 'Enter a daily food target in kcal, e.g. 2000.');
        if (kt < kcalFloor(p)) return showFormError(form, `Daily targets under ${fmtKcal(kcalFloor(p))} kcal aren’t recommended without medical advice.`);
      }
      data.kcal_target = kt;
      if (stg !== null && !(stg >= 0 && stg <= 50000)) return showFormError(form, 'Enter a weekly sport target in kcal, e.g. 1500.');
      data.sport_target = stg;

      await withBusy(form, async () => {
        await rpc('update_profile', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_data: data });
        closeSheet();
        await loadBody();
        render();
        toast('Goals saved');
      });
    }

    if (kind === 'body-profile') {
      const f = readProfileForm(form);
      if (f.error) return showFormError(form, f.error);
      await withBusy(form, async () => {
        await rpc('update_profile', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_data: f.data });
        if (f.pin) {
          await rpc('set_body_pin', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_new_pin: f.pin });
          store.set(pinKey(state.meId), f.pin);
        }
        closeSheet();
        await loadBody();
        await loadFamily();
        render();
        toast(f.pin ? 'Saved. Your page is locked with your PIN.' : 'Saved');
      });
    }
  }

  async function act(fn, okMsg) {
    try {
      await fn();
      await loadFamily();
      render();
      if (okMsg) toast(okMsg);
    } catch (e) { toast(e.message); }
  }

  async function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;

    if (a === 'overlay') { if (e.target === el) closeSheet(); return; }
    if (a === 'close-sheet') return closeSheet();
    if (a === 'back') return go(el.dataset.to || 'home');

    // --- Timers ---
    if (a === 'sw-toggle') {
      unlockAudio();
      if (sw.running) { sw.base = swMs(); sw.running = false; }
      else { sw.t0 = Date.now(); sw.running = true; }
      return renderTimerSlots();
    }
    if (a === 'sw-reset') {
      sw.running = false; sw.base = 0;
      const form = $('form[data-form="log"][data-dur="1"]');
      if (form && fld(form, 'min').dataset.auto === '1') {
        fld(form, 'min').value = ''; fld(form, 'sec').value = '';
        delete fld(form, 'min').dataset.auto;
      }
      return renderTimerSlots();
    }
    if (a === 'cd-toggle') {
      unlockAudio();
      if (cd.running) { cd.base = cd.total - cdLeft(); cd.running = false; }
      else {
        if (cd.done || cdLeft() <= 0) { cd.base = 0; cd.done = false; }
        cd.t0 = Date.now(); cd.running = true;
      }
      return renderTimerSlots();
    }
    if (a === 'cd-reset') { cd.running = false; cd.base = 0; cd.done = false; return renderTimerSlots(); }
    if (a === 'cd-preset') {
      cd.total = Number(el.dataset.sec) * 1000;
      cd.running = false; cd.base = 0; cd.done = false;
      return renderTimerSlots();
    }
    if (a === 'cd-adjust') {
      const delta = Number(el.dataset.delta) * 1000;
      if (cdLeft() + delta < 5000) return;
      cd.total += delta;
      if (cd.done) { cd.done = false; cd.base = cd.total - delta; } // add time after it finished
      return renderTimerSlots();
    }

    // --- Navigation / filters ---
    if (a === 'range') { state.range = el.dataset.range; store.set('ff_range', state.range); return render(); }
    if (a === 'retry') { state.error = null; render(); await loadFamily(); return render(); }

    // --- People ---
    if (a === 'pick-member') { setMe(el.dataset.id); go('home'); return render(); }
    if (a === 'switch-person') { store.set(pinKey(state.meId), null); setMe(null); location.hash = ''; return render(); }
    if (a === 'leave') {
      if (state.data && me() && !confirm('Sign this phone out of the family? Your entries stay saved, and you can rejoin with the invite link.')) return;
      if (state.data) state.data.members.forEach((m) => store.set(pinKey(m.id), null));
      leaveFamily();
      location.hash = '';
      return render();
    }

    // --- Exercises ---
    if (a === 'new-exercise') return openExerciseSheet();
    if (a === 'add-suggested') return openExerciseSheet(null, SUGGESTIONS[Number(el.dataset.i)]);
    if (a === 'edit-exercise') return openExerciseSheet(exerciseById(el.dataset.id));
    if (a === 'archive-exercise' || a === 'restore-exercise') {
      const ex = exerciseById(el.dataset.id);
      const archiving = a === 'archive-exercise';
      closeSheet();
      await act(() => rpc('update_exercise', {
        p_code: state.code, p_exercise_id: ex.id, p_name: ex.name, p_unit_label: ex.unit_label,
        p_higher_is_better: ex.higher_is_better, p_archived: archiving,
      }), archiving ? 'Exercise archived' : 'Exercise restored');
      if (archiving) go('home');
      return;
    }
    if (a === 'delete-entry') {
      if (!confirm('Delete this entry?')) return;
      return act(() => rpc('delete_entry', { p_code: state.code, p_entry_id: el.dataset.id }), 'Entry deleted');
    }

    // --- Goals ---
    if (a === 'goal-sheet') return openGoalSheet(exerciseById(el.dataset.id), el.dataset.fresh === '1');
    if (a === 'delete-goal') {
      if (!confirm('Remove this goal? Your entries stay as they are.')) return;
      closeSheet();
      return act(() => rpc('delete_goal', { p_code: state.code, p_exercise_id: el.dataset.id }), 'Goal removed');
    }
    if (a === 'weekly-sheet') return openWeeklySheet();
    if (a === 'delete-weekly') {
      closeSheet();
      return act(() => rpc('set_weekly_goal', { p_code: state.code, p_member_id: state.meId, p_days: null }), 'Weekly goal removed');
    }

    // --- Body page ---
    if (a === 'body-log') return openBodyLogSheet(el.dataset.kind);
    if (a === 'body-goals') return openBodyGoalsSheet(el.dataset.fresh === '1');
    if (a === 'body-profile') return openBodyProfileSheet();
    if (a === 'body-retry') { state.bodyError = null; return render(); }
    if (a === 'body-show-all') { state.bodyShowAll = true; return render(); }
    if (a === 'set-label') {
      const input = $('#sheet-root [name=label]');
      if (input) input.value = el.dataset.label;
      $$('#sheet-root [data-action="set-label"]').forEach((c) => c.setAttribute('aria-pressed', String(c === el)));
      return;
    }
    if (a === 'use-suggested') {
      const input = $('#sheet-root [name=kcal_target]');
      if (input) input.value = el.dataset.value;
      return;
    }
    if (a === 'delete-body-log') {
      if (!confirm('Delete this log?')) return;
      const log = state.body.logs.find((l) => l.id === el.dataset.id);
      state.body.logs = state.body.logs.filter((l) => l !== log);
      render();
      try {
        await rpc('delete_body_log', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_log_id: log.id });
        toast('Deleted');
      } catch (err) {
        state.body.logs.push(log); sortByDate(state.body.logs); render();
        toast(`Couldn’t delete. ${err.message}`);
      }
      return;
    }
    if (a === 'remove-weight-goal') {
      closeSheet();
      return act(async () => {
        await rpc('update_profile', {
          p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(),
          p_data: { weight_goal: null, weight_goal_date: null, weight_goal_start: null, weight_goal_start_date: null },
        });
        await loadBody();
      }, 'Weight goal removed');
    }
    if (a === 'remove-pin') {
      if (!confirm('Remove your PIN? Anyone who taps your name will be able to open this page.')) return;
      closeSheet();
      return act(async () => {
        await rpc('set_body_pin', { p_code: state.code, p_member_id: state.meId, p_pin: bodyPin(), p_new_pin: null });
        store.set(pinKey(state.meId), null);
        await loadBody();
      }, 'PIN removed');
    }

    // --- Food sheet ---
    if (a === 'food-tab') { captureFood(); foodSheet.tab = el.dataset.tab; return redrawFood(); }
    if (a === 'food-meal') {
      captureFood();
      foodSheet.meal = foodSheet.meal === el.dataset.label ? null : el.dataset.label;
      $$('#sheet-root [data-action="food-meal"]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.label === foodSheet.meal)));
      return;
    }
    if (a === 'food-recent') {
      const r = recentFoods()[Number(el.dataset.i)];
      const f = $('#sheet-root form[data-form="food"]');
      if (r && f) { fld(f, 'kcal').value = r.kcal; fld(f, 'label').value = r.label; }
      return;
    }
    if (a === 'food-remove') {
      captureFood();
      foodSheet.result.items.splice(Number(el.dataset.i), 1);
      if (!foodSheet.result.items.length) foodSheet.result = null;
      return redrawFood();
    }
    if (a === 'food-back') { captureFood(); foodSheet.result = null; return redrawFood(); }

    // --- Invite ---
    if (a === 'share-invite' || a === 'copy-invite') {
      const link = inviteLink();
      const text = `Join our family fitness tracker! Open this link: ${link}\n(Family code: ${state.data.family.code})`;
      if (a === 'share-invite' && navigator.share) {
        try { await navigator.share({ title: 'Family Fitness', text }); } catch { /* cancelled */ }
        return;
      }
      try { await navigator.clipboard.writeText(a === 'copy-invite' ? link : text); toast('Copied. Paste it into your family chat.'); }
      catch { prompt('Copy this link:', link); }
    }
  }

  async function onPhotoChosen(input) {
    const file = input.files && input.files[0];
    if (!file || !foodSheet) return;
    try {
      captureFood();
      foodSheet.image = await readPhoto(file);
      redrawFood();
    } catch {
      toast('Couldn’t read that photo. Try another one.');
    }
  }

  function onChange(e) {
    if (e.target.name === 'photo' && e.target.type === 'file') return onPhotoChosen(e.target);
    // Redraw the exercise form when the measurement type changes
    if (e.target.name === 'unit_type' && sheetState) {
      captureSheet();
      sheetState.unit_type = e.target.value;
      const units = UNIT_TYPES[e.target.value].units;
      sheetState.unit_label = units ? units[0] : '';
      sheetState.sportTouched = false;
      sheetState.sport = guessSport(sheetState.name, sheetState);
      $('#sheet-root .sheet').innerHTML = exerciseSheetHTML();
    }
    if (e.target.name === 'sport' && sheetState) { sheetState.sport = e.target.value; sheetState.sportTouched = true; }
    // Show the right fields for the goal type
    if (e.target.name === 'goal_kind') {
      $$('#sheet-root [data-kind-block]').forEach((b) => { b.hidden = b.dataset.kindBlock !== e.target.value; });
    }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.closest && t.closest('#sheet-root form[data-form="body-goals"]')) updateSuggestion();
    if (t.closest && t.closest('#sheet-root form[data-form="exercise"]') && (t.name === 'name' || t.name === 'unit_label')) refreshSportGuess();
    if (t.dataset && t.dataset.item !== undefined) updateFoodTotal();
    const er = t.form && t.form.querySelector('[data-error]');
    if (er) er.hidden = true;
    if (!t.matches('#app input, #app textarea') || t.type === 'date') return;
    t.dataset.dirty = '1';
    // Typing your own time takes over from the stopwatch
    if (t.name === 'min' || t.name === 'sec') {
      const form = t.form;
      if (form) delete fld(form, 'min').dataset.auto;
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.sheet-overlay')) closeSheet(); });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // Refresh when the app comes back to the front (e.g. after switching apps)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    updateWakeLock();
    if (cd.running && cdLeft() <= 0) finishCountdown();
    if (state.code && Date.now() - state.lastLoad > 20000) {
      await loadFamily();
      safeRender();
    }
  });

  // =====================================================================
  // Start
  // =====================================================================
  async function start() {
    // Invite links look like  .../?join=K7PM-Q2XD
    const join = new URLSearchParams(location.search).get('join');
    if (join && configured && libsLoaded) {
      const cleaned = join.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const current = (state.code || '').replace(/[^A-Z0-9]/g, '');
      if (cleaned !== current) {
        state.code = join;
        store.set('ff_code', join);
        setMe(null);
      }
      history.replaceState(null, '', location.pathname + location.hash);
    }
    render();
    if (state.code && configured && libsLoaded) {
      await loadFamily();
      render();
    }
  }
  start();
})();
