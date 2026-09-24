/* Family Fitness app (v2)
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
    if (m.includes('BAD_GOAL')) return 'That goal doesn’t fit this exercise. Check the goal type and date.';
    if (m.includes('Could not find the function') || m.includes('PGRST202'))
      return 'The database needs updating. Run supabase-setup.sql again in Supabase (see README).';
    if (m.includes('Invalid API key') || m.includes('No API key'))
      return 'The key in config.js isn’t accepted. Copy the publishable key again (README step 3).';
    if (/fetch|network|Load failed/i.test(m)) return 'Couldn’t reach the server. Check your internet connection and try again.';
    return m || 'Something went wrong. Try again.';
  }

  async function rpc(fn, args = {}) {
    if (!db) throw new Error('The app isn’t connected to a database yet.');
    let res;
    try { res = await db.rpc(fn, args); }
    catch (e) { throw new Error(friendly(e && e.message)); }
    if (res.error) throw new Error(friendly(res.error.message || res.error.code));
    return res.data;
  }

  async function loadFamily() {
    if (!state.code) return;
    try {
      const d = await rpc('get_family', { p_code: state.code });
      d.entries.forEach((e) => { e.value = Number(e.value); });
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

  function setMe(id) { state.meId = id; store.set('ff_member', id); }
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
    return `<nav class="tabs" aria-label="Main">${tab('home', 'Home')}${tab('timer', 'Timer')}${tab('family', 'Family')}</nav>`;
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
               <input class="input" name="value" type="number" inputmode="decimal" min="0" step="any" placeholder="0" aria-label="Amount">
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
        ? `Better when the number goes ${ex.higher_is_better ? 'up' : 'down'}`
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
        const w = weekInfo(m.id);
        const weekText = m.weekly_goal
          ? `${w.count} of ${m.weekly_goal} days`
          : plural(w.count, 'active day', 'active days');
        return `<section class="person" style="--c:${esc(m.color)}">
          <div class="person-head">${avatar(m)}<h2>${esc(m.name)}${m.id === state.meId ? ' <span class="muted small" style="font-family:var(--body);font-weight:400">(you)</span>' : ''}</h2>
            <span class="active">${weekText}<br>this week</span></div>
          ${exs.length ? `<div class="mini-grid">
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
            }).join('')}
          </div>` : '<p class="muted" style="margin-top:12px">No exercises yet.</p>'}
        </section>`;
      }).join('')}
      <div class="section"><a class="btn wide" href="#/settings">Invite family members</a></div>`;
  }

  // ----- Timer tab -----
  function viewTimer() {
    const t = state.timerTab;
    return `<h1 class="page-title" style="margin-bottom:18px">Timer</h1>
      <div class="segmented" role="group" aria-label="Timer type">
        <button type="button" data-action="timer-tab" data-tab="stopwatch" aria-pressed="${t === 'stopwatch'}">Stopwatch</button>
        <button type="button" data-action="timer-tab" data-tab="countdown" aria-pressed="${t === 'countdown'}">Countdown</button>
      </div>
      <div data-timer-slot="${t === 'stopwatch' ? 'sw' : 'cd'}" data-compact="0"></div>
      <p class="muted small" style="text-align:center;margin-top:26px">${t === 'stopwatch'
        ? 'To save a time, open a time-based exercise. Its stopwatch fills in the time for you.'
        : 'Keep this screen open for the sound. Your phone will also vibrate if it can.'}</p>`;
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
      case 'timer': html = viewTimer(); break;
      case 'family': html = viewFamily(); break;
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
  function closeSheet() { $('#sheet-root').innerHTML = ''; sheetState = null; }

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
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">${editing ? 'Save changes' : 'Create exercise'}</button>
      </div>
      ${editing ? `<p style="margin-top:16px;text-align:center"><button type="button" class="link" data-action="archive-exercise" data-id="${s.id}">Archive this exercise</button></p>
        <p class="hint" style="text-align:center">Archiving hides it but keeps its history. You can restore it in Settings.</p>` : ''}
      <p class="error-text" data-error hidden></p>
    </form>`;
  }

  function openExerciseSheet(ex, preset) {
    const base = ex || preset || { name: '', unit_type: 'reps', unit_label: 'reps', higher_is_better: true };
    sheetState = {
      id: ex ? ex.id : null,
      name: base.name, unit_type: base.unit_type, unit_label: base.unit_label,
      higher_is_better: base.higher_is_better,
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
      <input class="input" name="${prefix}" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${value == null ? '' : value}" aria-label="Amount">
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
    const v = fld(form, prefix).value;
    return v === '' ? NaN : Number(v);
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
    const el = form.querySelector('[data-error]');
    if (el) { el.textContent = msg; el.hidden = false; }
    else toast(msg);
  }
  async function withBusy(form, fn) {
    const btns = $$('[type=submit]', form);
    const err = form.querySelector('[data-error]');
    if (err) err.hidden = true;
    btns.forEach((b) => { b.disabled = true; });
    try { await fn(); }
    catch (e) { showFormError(form, e.message); }
    finally { btns.forEach((b) => { if (b.isConnected) b.disabled = false; }); }
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
        const f = await rpc('create_family', { p_name: name });
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
        const r = await rpc('add_member', { p_code: state.code, p_name: name, p_color: color });
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
        if (raw === '') return showFormError(form, 'Enter a number.');
        value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return showFormError(form, 'Enter a number of 0 or more.');
      }
      const date = fld(form, 'date').value || todayISO();
      if (date > todayISO()) return showFormError(form, 'The date can’t be in the future.');

      const before = progressSnapshot(ex);
      await withBusy(form, async () => {
        await rpc('add_entry', {
          p_code: state.code, p_member_id: state.meId, p_exercise_id: ex.id,
          p_value: value, p_date: date, p_note: fld(form, 'note').value.trim() || null,
        });
        if (usedStopwatch || ex.unit_type === 'duration') { sw.running = false; sw.base = 0; }
        if (rest) { cd.base = 0; cd.done = false; cd.t0 = Date.now(); cd.running = true; }
        await loadFamily();
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
      });
    }

    if (kind === 'exercise') {
      captureSheet();
      const s = sheetState;
      if (!s.name.trim()) return showFormError(form, 'Give the exercise a name.');
      const unit = s.unit_type === 'duration' ? '' : (s.unit_label || '').trim();
      await withBusy(form, async () => {
        if (s.id) {
          await rpc('update_exercise', {
            p_code: state.code, p_exercise_id: s.id, p_name: s.name.trim(),
            p_unit_label: unit, p_higher_is_better: s.higher_is_better, p_archived: false,
          });
          closeSheet();
          await loadFamily();
          render();
          toast('Changes saved');
        } else {
          const r = await rpc('add_exercise', {
            p_code: state.code, p_member_id: state.meId, p_name: s.name.trim(),
            p_unit_type: s.unit_type, p_unit_label: unit, p_higher_is_better: s.higher_is_better,
          });
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
    if (a === 'timer-tab') { state.timerTab = el.dataset.tab; return render(); }

    // --- Navigation / filters ---
    if (a === 'range') { state.range = el.dataset.range; store.set('ff_range', state.range); return render(); }
    if (a === 'retry') { state.error = null; render(); await loadFamily(); return render(); }

    // --- People ---
    if (a === 'pick-member') { setMe(el.dataset.id); go('home'); return render(); }
    if (a === 'switch-person') { setMe(null); location.hash = ''; return render(); }
    if (a === 'leave') {
      if (state.data && me() && !confirm('Sign this phone out of the family? Your entries stay saved, and you can rejoin with the invite link.')) return;
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

  function onChange(e) {
    // Redraw the exercise form when the measurement type changes
    if (e.target.name === 'unit_type' && sheetState) {
      captureSheet();
      sheetState.unit_type = e.target.value;
      const units = UNIT_TYPES[e.target.value].units;
      sheetState.unit_label = units ? units[0] : '';
      $('#sheet-root .sheet').innerHTML = exerciseSheetHTML();
    }
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
