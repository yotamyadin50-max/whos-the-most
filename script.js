// Who's The Most, client. Vanilla JS, no framework, no build step.
(() => {
  const TILE_COLORS = ['blue', 'pink', 'green', 'orange', 'yellow', 'cyan'];
  const DEFAULT_VOTE_SECONDS = 15; // fallback only, the server sends the real value on every 'question' (Builder finding 2026-08-10, closes a constant-drift risk instead of just documenting it)

  // Hand-drawn SVG crown, per _process/03-web-designer-visual-spec.md's iconography rule
  // (no stock emoji, no icon library), same treatment SparkRoom already validated.
  const CROWN_SVG = '<svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true" style="vertical-align:-3px"><path d="M2 16h18l1.5-10-5 3.5L11 2 5.5 9.5 1 6 2 16Z" fill="var(--accent)" stroke="var(--ink-dark)" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const SOUND_ON_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 9v6h4l5 4V5L7 9H3Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 6a9 9 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const SOUND_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 9v6h4l5 4V5L7 9H3Z" fill="currentColor"/><path d="M15 9l6 6M21 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // דוגמאות דקורטיביות למסך הבית, מתחלפות בכל טעינה (Critic finding #3, 09-critic-review.md),
  // תת-קבוצה קטנה שנבחרה ביד מתוך final-question-bank.md, לא הבנק המלא (זה לא צריך את כל 120).
  const HOME_EXAMPLES = [
    'מי הכי יצחק מהבדיחות של עצמו?',
    'מי הכי יעשה הכל בשביל פיצה?',
    'מי הכי יזכה בתחרות ריקוד מול מצלמה?',
    'מי הכי יברח ראשון אם יראה עכביש?',
    'מי הכי יידע לחקות קול של מורה עד שלא תבחינו בהבדל?',
    'מי הכי ישכח באמצע משפט מה הוא רצה להגיד?',
    'מי הכי יקפוץ ראשון למים קרים?',
    'מי הכי יגרום ליום משעמם להיות הכי כיף בכיתה?',
  ];

  // --- צלילים (Critic finding #2, שודרג 2026-08-10 לבקשה מפורשת "תשפר את הסאונד"): טונים
  // מחוללים ב-Web Audio API, אפס קובץ חיצוני, אותה רוח של "אפס תלויות". השדרוג: כל טון עובר
  // עכשיו דרך פילטר lowpass (מרכך קצוות חדים, פחות "צפצוף זול"), ורוב הצלילים בנויים מכמה
  // טונים בו-זמנית (יוניזון עדין עם detune, או אקורד קטן) במקום גל בודד, בשביל גוף עשיר יותר. ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!state.soundEnabled) return null;
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, durationMs, { type = 'sine', gain = 0.12, delayMs = 0, detune = 0, filterFreq = 3200 } = {}) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const start = ctx.currentTime + delayMs / 1000;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (detune) osc.detune.value = detune;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.connect(filter); filter.connect(g); g.connect(ctx.destination);
    osc.start(start); osc.stop(start + durationMs / 1000 + 0.05);
  }
  // Thin unison (two oscillators, slightly detuned) reads fuller than one, the standard cheap
  // trick for turning a bare synth beep into something that sounds closer to a real instrument.
  function toneUnison(freq, durationMs, opts = {}) {
    tone(freq, durationMs, { ...opts, detune: -6 });
    tone(freq, durationMs, { ...opts, detune: 6, gain: (opts.gain ?? 0.12) * 0.7 });
  }
  function sfxTick() { toneUnison(1046, 80, { type: 'triangle', gain: 0.08, filterFreq: 2600 }); }
  function sfxVote() { toneUnison(660, 90, { type: 'sine', gain: 0.11 }); }
  function sfxJoin() { toneUnison(587, 90, { type: 'sine', gain: 0.08 }); toneUnison(880, 130, { type: 'sine', gain: 0.07, delayMs: 70 }); }
  // A real ascending major-ish chord instead of three flat sine beeps, sparklier top note on
  // triangle for a little "shine" at the end.
  function sfxReveal() {
    toneUnison(523, 150, { type: 'sine', gain: 0.10 });
    toneUnison(659, 160, { type: 'sine', gain: 0.10, delayMs: 45 });
    toneUnison(784, 200, { type: 'sine', gain: 0.10, delayMs: 95 });
    toneUnison(1047, 280, { type: 'triangle', gain: 0.10, delayMs: 160, filterFreq: 4200 });
  }
  // New, per idea-manager brainstorm 2026-08-10 (reaction burst + bonus round): a short pop for
  // tapping a reaction, and a distinct rising fanfare sting the moment the bonus badge appears,
  // so both new features have their own sound identity instead of borrowing sfxVote/sfxReveal.
  function sfxReactionTap() { toneUnison(1200, 70, { type: 'square', gain: 0.05, filterFreq: 3800 }); }
  function sfxBonus() {
    toneUnison(784, 130, { type: 'sine', gain: 0.10 });
    toneUnison(988, 150, { type: 'sine', gain: 0.10, delayMs: 80 });
    toneUnison(1319, 260, { type: 'triangle', gain: 0.12, delayMs: 170, filterFreq: 4500 });
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' ו-' + names[names.length - 1];
  }

  // Mirrors server.js's canStart() wording exactly, for the brief window before the
  // authoritative room_state broadcast arrives.
  function startBlockedReason(playerCount) {
    const missing = 3 - playerCount;
    if (missing <= 0) return null;
    return missing === 1 ? 'צריך עוד חבר אחד כדי להתחיל' : `צריך עוד לפחות ${missing} חברים כדי להתחיל`;
  }

  // Isolates Latin/digit runs inside Hebrew text with <bdi> so the Unicode Bidi Algorithm
  // doesn't drag punctuation to the wrong visual side. Same pattern validated in O-output/07-sparkroom.
  function bidiSafe(str) {
    const escaped = String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(/[A-Za-z0-9][A-Za-z0-9 '".,!?-]*[A-Za-z0-9]|[A-Za-z0-9]/g, (m) => `<bdi>${m}</bdi>`);
  }

  function colorForName(name) {
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return TILE_COLORS[h % TILE_COLORS.length];
  }

  const state = {
    ws: null, playerId: null, roomCode: null, hostId: null, isHost: false,
    mode: null, // 'create' | 'join'
    pendingJoinCode: null,
    players: [],
    myVote: null,
    questionCount: 10,
    customQuestions: [],
    emoji: null,
    myReaction: null,
    soundEnabled: localStorage.getItem('whosmost_sound') !== 'off',
    intentionalClose: false,
    serverRestarting: false,
    roundIndex: -1, // per Researcher finding 2026-08-12: lets the countdown screen show "שאלה X מתוך Y" too, not just the question screen
  };

  // Emoji picker, reaction row, and question-count toggle are now generated FROM constants.js
  // (ALLOWED_EMOJI/EMOJI_LABELS/REACTION_EMOJI/REACTION_LABELS/QUESTION_COUNT_OPTIONS, loaded as
  // globals before this file), per Gatekeeper finding 2026-08-12: these used to be hardcoded twice
  // (once here, once in server.js), the same drift risk already fixed once for VOTE_SECONDS.
  function buildEmojiPicker() {
    const row = document.getElementById('emoji-picker-row');
    row.innerHTML = ALLOWED_EMOJI.map(e => `<button class="emoji-btn" type="button" data-emoji="${e}" aria-label="בחר אימוג'י ${EMOJI_LABELS[e] || ''}">${e}</button>`).join('');
  }
  function buildReactionRow() {
    const row = document.getElementById('reaction-row');
    row.innerHTML = REACTION_EMOJI.map(e => `<button class="reaction-btn" type="button" data-emoji="${e}" aria-label="הגיבו ב${REACTION_LABELS[e] || ''}">${e}</button>`).join('');
  }
  function buildQuestionCountRow() {
    const row = document.getElementById('question-count-row');
    row.innerHTML = QUESTION_COUNT_OPTIONS.map(n => `<button class="count-toggle-btn" data-count="${n}">${n}</button>`).join('');
  }
  buildEmojiPicker();
  buildReactionRow();
  buildQuestionCountRow();
  document.getElementById('custom-q-input').maxLength = MAX_CUSTOM_QUESTION_LEN;

  // Site Planner finding 2026-08-10: the only way to leave was closing the tab, no in-game exit
  // path, `btn-exit` only ever existed on the final screen. Shown on every screen where a player
  // is actually inside a live room (not home/name/error, which have nothing to leave, and not
  // final, which already has its own leave button).
  const SCREENS_WITH_LEAVE_BUTTON = new Set(['lobby', 'countdown', 'question', 'result', 'waiting-next-round']);
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.view === name));
    const leaveBtn = document.getElementById('btn-leave-game');
    leaveBtn.classList.toggle('hidden', !SCREENS_WITH_LEAVE_BUTTON.has(name));
    // A screen change mid-"are you sure?" (the round auto-advancing while the player was
    // deciding) shouldn't leave the button stuck showing "?" on whatever screen comes next.
    if (leaveBtn.classList.contains('confirming')) {
      leaveBtn.classList.remove('confirming');
      leaveBtn.textContent = '✕';
      leaveBtn.setAttribute('aria-label', 'עזוב משחק');
    }
  }
  function announce(text) { document.getElementById('live-region').textContent = text; }
  function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  function wsUrl() { const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'; return `${proto}//${location.host}`; }
  function send(payload) { if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload)); }

  // Auto-reconnect with a visible banner, per a real bug found live, 2026-08-09: a proxy in
  // front of the deployed server can silently drop an idle WebSocket (a lobby waiting on a 3rd
  // player, someone reading the screen before typing a name), and with no reconnect logic the
  // app just sat there doing nothing on the next click, zero feedback. Server-side keepalive
  // pings (server.js) fix the root idle-drop cause; this is the client-side safety net for a
  // genuine drop (a real network blip, a backgrounded phone) so it recovers on its own instead
  // of requiring a manual page reload.
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let bootOnOpen = null;
  function showBanner(text) { const el = document.getElementById('connection-banner'); el.textContent = text; el.classList.remove('hidden'); }
  function hideBanner() { document.getElementById('connection-banner').classList.add('hidden'); }

  function openSocket() {
    state.ws = new WebSocket(wsUrl());
    state.ws.addEventListener('open', () => {
      const isReconnect = reconnectAttempt > 0;
      reconnectAttempt = 0;
      state.serverRestarting = false;
      hideBanner();
      if (isReconnect && state.roomCode && state.playerId) {
        send({ type: 'rejoin', code: state.roomCode, playerId: state.playerId });
      } else if (!isReconnect && bootOnOpen) {
        bootOnOpen();
      }
    });
    state.ws.addEventListener('message', (ev) => { let msg; try { msg = JSON.parse(ev.data); } catch { return; } handleMessage(msg); });
    state.ws.addEventListener('close', () => {
      if (state.intentionalClose) return;
      reconnectAttempt++;
      // Builder finding 2026-08-10: keep the more accurate "server updating" message through the
      // actual reconnect attempts too, not just the initial 300ms warning, otherwise this gets
      // immediately overwritten by the generic "connection lost" text the moment the socket
      // actually drops, which is exactly when the reassurance matters most.
      // Builder finding 2026-08-12: retries run every 5s forever with no upper bound, which is
      // correct (never give up on your own), but the banner text never changed either, so a
      // genuinely bad connection just kept reading the same "מתחבר מחדש..." for minutes with no
      // acknowledgement anything's actually wrong. ~13 attempts is roughly a minute of failed
      // retries at the 5s-capped backoff below.
      const longWait = reconnectAttempt >= 13;
      showBanner(state.serverRestarting ? 'השרת מתעדכן, מתחברים מחדש...' : longWait ? 'עדיין מנסים להתחבר... בדקו את האינטרנט' : 'החיבור נותק, מתחבר מחדש...');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(openSocket, Math.min(1000 * reconnectAttempt, 5000));
    });
  }
  function connect(onOpen) { bootOnOpen = onOpen; openSocket(); }

  function saveSession() {
    if (state.roomCode && state.playerId) {
      sessionStorage.setItem('whosmost', JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId }));
    }
  }
  function clearSession() { sessionStorage.removeItem('whosmost'); }

  // Quick-rejoin, per idea-manager brainstorm 2026-08-12: a separate, longer-lived localStorage
  // entry (unlike sessionStorage above, which only resumes the SAME still-open tab/session). This
  // is for coming back later, a different tab, or after actually closing the browser, offering a
  // one-tap way back into a NEW room with the same code and name rather than retyping everything.
  const LS_LAST_ROOM_KEY = 'whosmost_last_room';
  function saveLastRoom(code, name) {
    if (!code || !name) return;
    try { localStorage.setItem(LS_LAST_ROOM_KEY, JSON.stringify({ code, name })); } catch { /* storage unavailable, skip */ }
  }
  function loadLastRoom() {
    try { return JSON.parse(localStorage.getItem(LS_LAST_ROOM_KEY) || 'null'); } catch { return null; }
  }
  function renderQuickRejoin() {
    const btn = document.getElementById('btn-quick-rejoin');
    const last = loadLastRoom();
    if (!last || !last.code || !last.name) { btn.classList.add('hidden'); return; }
    btn.innerHTML = bidiSafe(`הצטרפו לחדר האחרון (${last.name}, ${last.code})`);
    btn.classList.remove('hidden');
  }
  document.getElementById('btn-quick-rejoin').addEventListener('click', () => {
    const last = loadLastRoom();
    if (!last) return;
    // Reuses the exact same name-entry -> join_room path as a normal join, just pre-filled, so
    // there's no new WS-timing risk (a bare send() here could race the socket not being open yet).
    state.mode = 'join';
    state.pendingJoinCode = last.code;
    showScreen('name');
    nameInput.value = last.name;
    nameInput.dispatchEvent(new Event('input'));
    nameInput.focus();
  });

  // ---------- Home screen ----------
  const nameInput = document.getElementById('name-input');
  const avatarPreview = document.getElementById('avatar-preview');
  const btnNameContinue = document.getElementById('btn-name-continue');

  document.getElementById('btn-create').addEventListener('click', () => {
    state.mode = 'create';
    showScreen('name');
    nameInput.focus();
  });
  document.getElementById('btn-show-join').addEventListener('click', () => {
    document.getElementById('join-code-row').classList.remove('hidden');
    document.getElementById('room-code-input').focus(); // Site Planner finding 2026-08-12: the field appeared but never actually got focus
  });
  document.getElementById('btn-go-join').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    const err = document.getElementById('join-error');
    if (code.length !== 4) { err.textContent = 'קוד בן 4 תווים'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    state.mode = 'join';
    state.pendingJoinCode = code;
    showScreen('name');
    nameInput.focus();
  });

  // ---------- Name entry ----------
  // Personal emoji avatar (idea-manager brainstorm #5, 2026-08-10): a fixed curated set, picked
  // once at name entry, shown instead of the first-letter avatar everywhere a player appears.
  // Kept optional (a re-click deselects back to the letter avatar) since the letter avatar
  // already reads fine on its own, this is purely additive personalization.
  function updateAvatarPreview() {
    const v = nameInput.value.trim();
    if (state.emoji) {
      avatarPreview.textContent = state.emoji;
    } else if (v) {
      avatarPreview.textContent = v[0];
    } else {
      avatarPreview.textContent = '?';
    }
  }
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.emoji;
      state.emoji = state.emoji === val ? null : val;
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.toggle('selected', b.dataset.emoji === state.emoji));
      updateAvatarPreview();
    });
  });
  nameInput.addEventListener('input', () => {
    const v = nameInput.value.trim();
    btnNameContinue.disabled = v.length === 0;
    document.getElementById('name-hint').classList.toggle('hidden', v.length > 0);
    if (v) {
      const color = colorForName(v);
      avatarPreview.className = 'avatar-preview tile-' + color + ' bump';
      setTimeout(() => avatarPreview.classList.remove('bump'), 150);
    }
    updateAvatarPreview();
  });
  btnNameContinue.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    getAudioCtx(); // warm up / resume the AudioContext on this real user gesture
    if (state.mode === 'create') {
      // ישר לחדר עם ברירת מחדל (10 שאלות, ניתנת לשינוי בלובי עצמו), לא עוד מסך
      // חוסם לפני הקוד לשיתוף, per Critic finding #1 (_process/09-critic-review.md).
      send({ type: 'create_room', name, questionCount: 10, emoji: state.emoji });
    } else if (state.mode === 'join') {
      send({ type: 'join_room', code: state.pendingJoinCode, name, emoji: state.emoji });
    }
  });
  // "הצטרף" label when arriving via a room link, per _process/02-site-planner-plan.md's warm-entry flow.
  btnNameContinue.textContent = 'המשך';

  // ---------- Sound toggle ----------
  const btnSoundToggle = document.getElementById('btn-sound-toggle');
  function renderSoundIcon() {
    btnSoundToggle.innerHTML = state.soundEnabled ? SOUND_ON_SVG : SOUND_OFF_SVG;
    btnSoundToggle.setAttribute('aria-pressed', String(!state.soundEnabled));
    btnSoundToggle.setAttribute('aria-label', state.soundEnabled ? 'השתק צלילים' : 'הפעל צלילים');
  }
  btnSoundToggle.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('whosmost_sound', state.soundEnabled ? 'on' : 'off');
    renderSoundIcon();
    if (state.soundEnabled) getAudioCtx();
  });
  renderSoundIcon();

  // ---------- Lobby ----------
  // The server-confirmed display name (not the raw typed input, which can get a "2" suffix from
  // uniqueDisplayName if it collides with someone already in the room), so the invite says
  // exactly the name everyone else in the room actually sees.
  function myDisplayName() {
    const me = state.players.find(p => p.id === state.playerId);
    return me ? me.name : '';
  }
  // Personalized per Copywriter/marketing-manager finding 2026-08-10: matches the funnier voice
  // already established in the question bank, and opens with the real sender's name per the
  // broadcast-copy discipline (a personal-feeling opener outperforms a generic "let's play").
  function whatsappShareText(code) {
    const url = `${location.origin}/room/${code}`;
    const name = myDisplayName();
    // Plain text, not HTML: goes straight through encodeURIComponent into a wa.me link, so no
    // bidiSafe() here, that helper's <bdi> tags are for innerHTML rendering and would show up
    // as literal text in the actual WhatsApp message.
    const invite = name ? `${name} מזמין/ה אתכם` : 'מוזמנים';
    return `${invite} להצטרף לחדר במשחק "מי הכי" 🎉 מצביעים מי הכי עושה מה, קצר וכיפי. נכנסים כאן: ${url}`;
  }
  document.getElementById('btn-share-whatsapp').addEventListener('click', () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(whatsappShareText(state.roomCode))}`, '_blank');
  });
  document.getElementById('btn-copy-link').addEventListener('click', async () => {
    const url = `${location.origin}/room/${state.roomCode}`;
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard permission denied, silently ignore */ }
    toast('הועתק');
  });
  document.getElementById('btn-start-game').addEventListener('click', () => send({ type: 'start_game' }));
  document.querySelectorAll('.count-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.isHost) return;
      send({ type: 'set_question_count', count: Number(btn.dataset.count) });
    });
  });

  // ---------- Custom questions (personalized packs) ----------
  const customQInput = document.getElementById('custom-q-input');
  const customQError = document.getElementById('custom-q-error');
  function submitCustomQuestion() {
    const text = customQInput.value.trim();
    if (!text) return;
    send({ type: 'add_custom_question', text });
    customQInput.value = '';
    customQError.classList.add('hidden');
  }
  document.getElementById('btn-add-custom-q').addEventListener('click', submitCustomQuestion);
  customQInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submitCustomQuestion(); });

  // Reuse across game nights, per idea-manager finding 2026-08-10: custom questions used to live
  // only on one room, a family had to retype their own inside jokes every time they opened a
  // fresh room. localStorage is the right tool here (no server persistence, stays zero-infra),
  // and only ever gets overwritten with a NON-empty list, so starting a fresh empty room never
  // wipes out a previously saved set before the player gets a chance to reuse it.
  function saveCustomQuestionsForReuse(questions) {
    if (!questions.length) return;
    try { localStorage.setItem('whosmost_custom_questions', JSON.stringify(questions.map(q => q.text))); } catch { /* storage unavailable, just skip saving */ }
  }
  function loadSavedCustomQuestions() {
    try { return JSON.parse(localStorage.getItem('whosmost_custom_questions') || '[]'); } catch { return []; }
  }
  function renderReuseButton() {
    const btn = document.getElementById('btn-reuse-custom-q');
    const saved = loadSavedCustomQuestions();
    if (state.customQuestions.length > 0 || saved.length === 0) { btn.classList.add('hidden'); return; }
    btn.textContent = `השתמשו בשאלות מהפעם הקודמת (${saved.length})`;
    btn.classList.remove('hidden');
  }
  document.getElementById('btn-reuse-custom-q').addEventListener('click', () => {
    for (const text of loadSavedCustomQuestions()) send({ type: 'add_custom_question', text });
  });

  function renderCustomQuestions() {
    // Critic finding 2026-08-10: the lobby was getting long, this section is the one genuinely
    // optional part, collapsed by default (index.html <details>). Only ever force it OPEN when
    // there's something worth seeing, never force it closed, that would fight a player who
    // deliberately opened it themselves to add a question.
    if (state.customQuestions.length > 0) document.getElementById('custom-q-details').open = true;
    saveCustomQuestionsForReuse(state.customQuestions);
    renderReuseButton();
    const list = document.getElementById('custom-q-list');
    list.innerHTML = '';
    state.customQuestions.forEach(q => {
      const chip = document.createElement('div');
      chip.className = 'custom-q-chip';
      const canRemove = q.authorId === state.playerId || state.isHost;
      chip.innerHTML = `<div><span class="custom-q-text">${bidiSafe(q.text)}</span><span class="custom-q-author">${bidiSafe(q.authorName)}</span></div>` +
        (canRemove ? `<button class="btn-remove-q" data-id="${q.id}" aria-label="הסר שאלה">×</button>` : '');
      list.appendChild(chip);
    });
    list.querySelectorAll('.btn-remove-q').forEach(btn => {
      btn.addEventListener('click', () => send({ type: 'remove_custom_question', questionId: btn.dataset.id }));
    });
  }

  function renderLobby(msg) {
    state.hostId = msg.hostId;
    state.isHost = msg.hostId === state.playerId;
    if (typeof msg.questionCount === 'number') state.questionCount = msg.questionCount;
    state.roundIndex = -1; // fresh set of rounds starting (new room or "עוד סבב"), per the countdown-progress feature above
    const isFreshLobbyRender = document.querySelector('.screen.active').dataset.view !== 'lobby';
    const grew = !isFreshLobbyRender && msg.players.length > state.players.length;
    state.players = msg.players;
    document.getElementById('room-code-display').textContent = state.roomCode;
    document.getElementById('players-heading').textContent = `בחדר עכשיו (${msg.players.length})`;
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    msg.players.forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      chip.innerHTML = `<span class="dot tile-${p.color}">${p.emoji || bidiSafe((p.name || '?')[0])}</span><span>${bidiSafe(p.name)}${p.connected ? '' : ' (מתנתק)'}</span>`;
      list.appendChild(chip);
    });
    if (grew) sfxJoin();

    document.getElementById('question-count-label').textContent = `כמות שאלות: ${state.questionCount}`;
    const countRow = document.getElementById('question-count-row');
    countRow.classList.toggle('hidden', !state.isHost);
    countRow.querySelectorAll('.count-toggle-btn').forEach(btn => {
      btn.classList.toggle('selected', Number(btn.dataset.count) === state.questionCount);
    });

    if (Array.isArray(msg.customQuestions)) state.customQuestions = msg.customQuestions;
    renderCustomQuestions();

    const startBtn = document.getElementById('btn-start-game');
    const reasonEl = document.getElementById('start-blocked-reason');
    const waitingEl = document.getElementById('waiting-for-host');
    if (state.isHost) {
      startBtn.classList.remove('hidden'); waitingEl.classList.add('hidden');
      startBtn.disabled = !msg.canStart;
      reasonEl.textContent = msg.canStart ? '' : (msg.startBlockedReason || '');
    } else {
      startBtn.classList.add('hidden'); reasonEl.textContent = '';
      waitingEl.classList.remove('hidden');
    }
    showScreen('lobby');
  }

  // ---------- Countdown ----------
  let countdownTimer = null;
  function runCountdown(seconds) {
    showScreen('countdown');
    let n = seconds;
    const el = document.getElementById('countdown-number');
    el.textContent = n;
    // Same "שאלה X מתוך Y" the question screen already shows, per Researcher finding 2026-08-12:
    // the countdown that comes right before it showed nothing, a small disorientation gap.
    // state.roundIndex is the LAST shown question's 0-based index (-1 before the first one ever),
    // so +1 is exactly the upcoming question's index. Hidden on the upcoming bonus question, same
    // rule the question screen itself already uses (the bonus badge implies "this is the last one").
    const progressEl = document.getElementById('countdown-progress');
    const nextIndex = state.roundIndex + 1;
    const total = state.roundTotal || state.questionCount;
    if (typeof total === 'number' && nextIndex < total - 1) {
      progressEl.textContent = `שאלה ${nextIndex + 1} מתוך ${total}`;
      progressEl.classList.remove('hidden');
    } else {
      progressEl.classList.add('hidden');
    }
    announce(`מתחילים בעוד ${n}`);
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(countdownTimer); return; }
      el.textContent = n;
      announce(String(n));
      sfxTick();
      if (navigator.vibrate) navigator.vibrate(50);
    }, 1000);
  }

  // ---------- Question / voting ----------
  function renderQuestion(msg) {
    state.myVote = null;
    state.players = msg.players;
    if (typeof msg.index === 'number') state.roundIndex = msg.index;
    if (typeof msg.total === 'number') state.roundTotal = msg.total;
    // "שאלה X מתוך Y", per Researcher finding 2026-08-10: index/total were already sent by the
    // server every question but never actually shown to the player. Critic finding 2026-08-10:
    // the question screen (seen up to 15x a game) was getting stacked with too many elements, so
    // on the bonus question the badge REPLACES the progress line instead of stacking alongside
    // it, "שאלת האלופים" already implies "this is the last one," the count would be redundant.
    const roundProgress = document.getElementById('round-progress');
    if (!msg.bonus && typeof msg.index === 'number' && typeof msg.total === 'number') {
      roundProgress.textContent = `שאלה ${msg.index + 1} מתוך ${msg.total}`;
      roundProgress.classList.remove('hidden');
    } else {
      roundProgress.classList.add('hidden');
    }
    document.getElementById('bonus-badge').classList.toggle('hidden', !msg.bonus);
    if (msg.bonus) sfxBonus();
    document.getElementById('question-text').innerHTML = bidiSafe(msg.text);
    // Shrinking timer bar, per Researcher finding 2026-08-10: the only visible countdown used to
    // be the pre-question 3-2-1, nothing during the actual 15s vote window itself. Restart-a-CSS-
    // transition trick: snap back to full with no transition, force a reflow, then re-enable the
    // transition and set the end state so the browser actually animates it.
    const fill = document.getElementById('vote-timer-fill');
    const voteSeconds = typeof msg.voteSeconds === 'number' ? msg.voteSeconds : DEFAULT_VOTE_SECONDS;
    fill.style.transition = 'none';
    fill.style.width = '100%';
    void fill.offsetWidth;
    fill.style.transition = `width ${voteSeconds}s linear`;
    fill.style.width = '0%';
    document.getElementById('vote-count').textContent = `0/${msg.players.length} הצביעו`;
    const grid = document.getElementById('vote-grid');
    // Researcher finding 2026-08-10: the grid switched to 3 columns above 8 players but never
    // scaled further, so a real large group (up to MAX_PLAYERS=20 server-side) meant a lot of
    // scrolling before seeing every option. One more breakpoint at 14+.
    grid.className = msg.players.length > 14 ? 'lots' : msg.players.length > 8 ? 'many' : '';
    grid.innerHTML = '';
    msg.players.forEach(p => {
      const btn = document.createElement('button');
      btn.className = `vote-btn tile-${p.color}` + (p.connected === false ? ' disconnected' : '');
      // Streak flame, per idea-manager brainstorm 2026-08-10: only shown from 2 consecutive wins
      // up, a single win isn't a "streak" yet. title = minimal hover/long-press hint (Gatekeeper
      // finding: nothing anywhere explains what the flame means).
      const streakTag = p.streak >= 2 ? `<span class="streak-tag" title="רצף ניצחונות">🔥${p.streak}</span> ` : '';
      btn.innerHTML = streakTag + (p.emoji ? p.emoji + ' ' : '') + bidiSafe(p.name) + (p.connected === false ? ' <span class="muted">(מתנתק)</span>' : '');
      btn.dataset.playerId = p.id;
      btn.addEventListener('click', () => {
        // Changeable until the round resolves, per idea-manager finding 2026-08-10: a misclick
        // on a crowded phone screen used to be permanent.
        if (state.myVote === p.id) return;
        state.myVote = p.id;
        grid.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('picked'));
        btn.classList.add('picked');
        sfxVote();
        if (navigator.vibrate) navigator.vibrate(30); // same feedback the countdown already gets, per Researcher finding: the vote tap itself had none
        send({ type: 'vote', targetPlayerId: p.id });
      });
      grid.appendChild(btn);
    });
    showScreen('question');
  }

  // Rotating reveal phrasing, per Copywriter finding 2026-08-10: the exact same sentence
  // repeating word-for-word 15 times in one long round felt stale. Bonus phrasing stays fixed
  // (it only ever fires once per game, so repetition was never actually a problem there).
  const REVEAL_SINGLE_TEMPLATES = [
    (name) => `${name} מקבל/ת הכי הרבה קולות`,
    (name) => `כולם הצביעו על ${name}`,
    (name) => `${name} עם הכי הרבה קולות הערב`,
    (name) => `ברור מי זה, ${name}!`,
  ];
  const REVEAL_TIE_TEMPLATES = [
    (names) => `תיקו! ${names} מקבלים הכי הרבה קולות`,
    (names) => `תיקו בין ${names}`,
    (names) => `${names} עם אותה כמות קולות בדיוק`,
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function renderResult(msg) {
    const nameEl = document.getElementById('result-name');
    const votesEl = document.getElementById('result-votes');
    const avatarEl = document.getElementById('result-avatar');
    avatarEl.classList.add('hidden');
    avatarEl.innerHTML = '';
    if (!msg.winners.length) {
      nameEl.textContent = 'אף אחד לא הצביע הפעם';
      votesEl.textContent = '';
    } else if (msg.tie) {
      const names = joinNames(msg.winners.map(w => bidiSafe(w.name)));
      nameEl.innerHTML = msg.bonus ? `תיקו! ${names} מקבלים ${msg.points} נקודות כל אחד, שאלת האלופים 🏆` : pick(REVEAL_TIE_TEMPLATES)(names);
      votesEl.textContent = `${msg.winners[0].votes} קולות`;
    } else {
      const w = msg.winners[0];
      const name = bidiSafe(w.name);
      nameEl.innerHTML = msg.bonus ? `${name} מקבל/ת ${msg.points} נקודות, שאלת האלופים 🏆` : pick(REVEAL_SINGLE_TEMPLATES)(name);
      votesEl.textContent = `${w.votes} קולות`;
      // Big avatar for the single-winner case, per Web Designer finding 2026-08-10: the reveal
      // moment was pure text, missing the exact visual identity (tile color + emoji) already
      // built everywhere else. Skipped for ties, multiple avatars don't fit the same layout.
      if (w.color) {
        avatarEl.className = `result-avatar tile-${w.color}`;
        avatarEl.textContent = w.emoji || (w.name || '?')[0];
        avatarEl.classList.remove('hidden');
      }
    }
    announce(nameEl.textContent);
    sfxReveal();
    state.myReaction = null;
    document.querySelectorAll('.reaction-btn').forEach(b => { b.disabled = false; b.classList.remove('picked'); });
    document.getElementById('reaction-burst-layer').innerHTML = '';
    // Room code visible during play too, not just the lobby, per Critic finding 2026-08-12: a
    // host wanting to re-share with a latecomer mid-game had to go dig up the original WhatsApp
    // message. Placed here specifically (once per round, a natural pause), not on the busier
    // question screen.
    document.getElementById('result-mini-code').innerHTML = state.roomCode ? bidiSafe(`קוד החדר: ${state.roomCode}`) : '';
    showScreen('result');
  }

  // ---------- Reveal-screen reactions (idea-manager brainstorm, "raise the level, a bit
  // funnier", 2026-08-10): purely visual, no scoring effect, one per player per round. ----------
  function spawnReactionBurst(emoji) {
    const layer = document.getElementById('reaction-burst-layer');
    const span = document.createElement('span');
    span.className = 'reaction-burst';
    span.textContent = emoji;
    span.style.insetInlineStart = `${10 + Math.random() * 70}%`;
    layer.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  }

  // Final-screen win celebration, per Critic finding 2026-08-12. Same spawn+CSS-animation+
  // remove-on-end mechanism as spawnReactionBurst above, adapted for a one-time burst instead of
  // a per-tap trigger: a handful of small colored pieces falling from the top of the champion card.
  function spawnConfetti() {
    const layer = document.getElementById('confetti-layer');
    for (let i = 0; i < 16; i++) {
      const piece = document.createElement('span');
      piece.className = `confetti-piece tile-${TILE_COLORS[i % TILE_COLORS.length]}`;
      piece.style.insetInlineStart = `${Math.random() * 100}%`;
      piece.style.animationDelay = `${Math.random() * 250}ms`;
      layer.appendChild(piece);
      piece.addEventListener('animationend', () => piece.remove());
    }
  }
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.myReaction) return;
      state.myReaction = btn.dataset.emoji;
      // Web Designer finding 2026-08-12: all 4 buttons used to gray out identically, no way to
      // tell afterward which one you actually tapped. Mirrors the vote-btn.picked treatment.
      document.querySelectorAll('.reaction-btn').forEach(b => { b.disabled = true; b.classList.toggle('picked', b === btn); });
      sfxReactionTap();
      send({ type: 'send_reaction', emoji: btn.dataset.emoji });
    });
  });

  // ---------- Final results ----------
  function renderFinal(msg) {
    const highlight = msg.personalHighlights[state.playerId];
    const card = document.getElementById('personal-highlight-card');
    card.innerHTML = highlight
      ? `הקולות שלך<br>הכי הרבה קולות קיבלת בשאלה "${bidiSafe(highlight.question)}"`
      : 'הקולות שלך<br>לא קיבלת קולות בסבב הזה, אולי בפעם הבאה';

    // Screenshot-worthy header, per Critic finding 2026-08-10: the champion shown big, with
    // their real avatar (tile color + emoji), not just a line of text.
    const champion = msg.leaderboard[0];
    const championEl = document.getElementById('final-share-champion');
    document.getElementById('confetti-layer').innerHTML = '';
    if (champion && champion.wins > 0) {
      const avatarClass = champion.color ? `tile-${champion.color}` : 'tile-blue';
      championEl.innerHTML = `
        <div class="final-share-avatar ${avatarClass}">${champion.emoji || (champion.name || '?')[0]}</div>
        <div class="final-share-name">${CROWN_SVG} ${bidiSafe(champion.name)}</div>`;
      // Critic finding 2026-08-12: the biggest emotional peak of the whole night (who won
      // overall) had LESS visual "juice" than a single round's reveal (which already gets the
      // reaction-burst layer). Same span+CSS-animation mechanism as spawnReactionBurst, just a
      // burst of color instead of repeated emoji.
      spawnConfetti();
    } else {
      championEl.innerHTML = `<div class="final-share-name">אף אחד לא ניצח הפעם</div>`;
    }

    const board = document.getElementById('leaderboard');
    board.innerHTML = msg.leaderboard.map((row, i) => `
      <div class="leaderboard-row">
        <span>${i === 0 && row.wins > 0 ? CROWN_SVG + ' ' : ''}${row.emoji ? row.emoji + ' ' : ''}${bidiSafe(row.name)}</span>
        <span class="n">${row.wins} נקודות</span>
      </div>`).join('');
    const votes = document.getElementById('total-votes-table');
    // Small badge on the top row too, per idea-manager brainstorm 2026-08-12: a second real
    // recognition moment (most talked-about, not just most wins), built from data already
    // computed server-side, not a fabricated category. A distinct icon from the wins-leaderboard
    // crown (👑) so the two different rankings never look interchangeable.
    votes.innerHTML = msg.totalVotesTable.map((row, i) => `
      <div class="votes-row"><span>${i === 0 && row.votes > 0 ? '🗣️ ' : ''}${row.emoji ? row.emoji + ' ' : ''}${bidiSafe(row.name)}</span><span class="n">${row.votes}</span></div>`).join('');

    // "הרגע החזק של הערב", per idea-manager brainstorm 2026-08-10: built entirely from real
    // recorded per-round vote data (personalHighlight), never a fabricated category.
    const moment = document.getElementById('strongest-moment');
    if (msg.strongestMoment) {
      const m = msg.strongestMoment;
      moment.innerHTML = `🌟 הרגע החזק של הערב: ${m.emoji ? m.emoji + ' ' : ''}${bidiSafe(m.playerName)} עם ${m.votes} קולות על "${bidiSafe(m.question)}"`;
      moment.classList.remove('hidden');
    } else {
      moment.classList.add('hidden');
    }
    showScreen('final');
  }

  document.getElementById('btn-continue-playing').addEventListener('click', () => send({ type: 'continue_playing' }));
  function leaveGame() {
    send({ type: 'leave_room' });
    clearSession();
    history.replaceState(null, '', '/');
    location.reload();
  }
  document.getElementById('btn-exit').addEventListener('click', leaveGame);
  // Site Planner finding 2026-08-10: this is a small fixed-corner button, easy to hit by
  // accident reaching for something else (a reaction button, mid-excitement). Tap-twice instead
  // of a native confirm() dialog, which would break the app's own visual language: first tap
  // switches to a "בטוח?" state for a couple of seconds, second tap within that window actually
  // leaves, otherwise it quietly reverts.
  const btnLeaveGame = document.getElementById('btn-leave-game');
  let leaveConfirmTimer = null;
  btnLeaveGame.addEventListener('click', () => {
    if (btnLeaveGame.classList.contains('confirming')) {
      clearTimeout(leaveConfirmTimer);
      leaveGame();
      return;
    }
    btnLeaveGame.classList.add('confirming');
    btnLeaveGame.textContent = '?';
    btnLeaveGame.setAttribute('aria-label', 'לחצו שוב כדי לעזוב, בטוחים?');
    leaveConfirmTimer = setTimeout(() => {
      btnLeaveGame.classList.remove('confirming');
      btnLeaveGame.textContent = '✕';
      btnLeaveGame.setAttribute('aria-label', 'עזוב משחק');
    }, 2500);
  });
  document.getElementById('btn-error-home').addEventListener('click', () => {
    clearSession();
    history.replaceState(null, '', '/');
    location.reload();
  });

  // ---------- Message router ----------
  function handleMessage(msg) {
    switch (msg.type) {
      case 'room_created': {
        state.roomCode = msg.code; state.playerId = msg.playerId; state.hostId = msg.hostId;
        saveSession();
        const meCreated = msg.players.find(p => p.id === msg.playerId);
        if (meCreated) saveLastRoom(msg.code, meCreated.name);
        history.replaceState(null, '', `/room/${msg.code}`);
        renderLobby({ hostId: msg.hostId, players: msg.players, questionCount: msg.questionCount, customQuestions: msg.customQuestions, canStart: msg.players.length >= 3, startBlockedReason: startBlockedReason(msg.players.length) });
        break;
      }

      case 'room_joined': {
        state.roomCode = msg.code; state.playerId = msg.playerId; state.hostId = msg.hostId;
        saveSession();
        const meJoined = msg.players.find(p => p.id === msg.playerId);
        if (meJoined) saveLastRoom(msg.code, meJoined.name);
        history.replaceState(null, '', `/room/${msg.code}`);
        if (msg.phase === 'lobby') {
          renderLobby({ hostId: msg.hostId, players: msg.players, questionCount: msg.questionCount, customQuestions: msg.customQuestions, canStart: msg.players.length >= 3, startBlockedReason: startBlockedReason(msg.players.length) });
        } else if (msg.phase === 'question' && msg.current) {
          renderQuestion({ text: msg.current.text, bonus: msg.current.bonus, index: msg.current.index, total: msg.current.total, voteSeconds: msg.current.voteSeconds, players: msg.players });
        } else {
          showScreen('waiting-next-round');
        }
        break;
      }

      case 'room_not_found':
        clearSession();
        if (state.warmCodeFallback) { const c = state.warmCodeFallback; state.warmCodeFallback = null; enterWarmJoin(c); break; }
        document.getElementById('error-message').textContent = 'לא מצאנו חדר עם הקוד הזה';
        showScreen('error');
        break;

      case 'room_full':
        document.getElementById('error-message').textContent = 'החדר הזה מלא';
        showScreen('error');
        break;

      case 'room_in_progress':
        showScreen('waiting-next-round');
        break;

      case 'rejoin_failed':
        clearSession();
        if (state.warmCodeFallback) { const c = state.warmCodeFallback; state.warmCodeFallback = null; enterWarmJoin(c); break; }
        showScreen('home');
        break;

      case 'room_state':
        state.roomCode = msg.code; state.hostId = msg.hostId;
        if (msg.phase === 'lobby') renderLobby(msg);
        break;

      case 'custom_question_rejected':
        customQError.textContent = msg.reason === 'limit' ? 'הגעתם למספר המקסימלי של שאלות לחדר (30)' : 'אי אפשר להוסיף שאלה ריקה';
        customQError.classList.remove('hidden');
        break;

      // Builder finding 2026-08-10: a deploy used to just silently kill the connection. The
      // reconnect logic below still does the real work (auto-reconnect + rejoin), this only
      // makes the banner say something more accurate than the generic "connection lost" text
      // for the next few seconds, so it doesn't read as the player's own wifi failing.
      case 'server_restarting':
        state.serverRestarting = true;
        showBanner('השרת מתעדכן, נחזור תוך כמה שניות...');
        break;

      case 'countdown':
        runCountdown(msg.seconds);
        break;

      case 'question':
        renderQuestion(msg);
        break;

      case 'vote_update':
        document.getElementById('vote-count').textContent = `${msg.votedCount}/${msg.totalCount} הצביעו`;
        break;

      case 'result':
        renderResult(msg);
        break;

      case 'reaction':
        spawnReactionBurst(msg.emoji);
        break;

      case 'game_over':
        renderFinal(msg);
        break;
    }
  }

  // ---------- Boot ----------
  function enterWarmJoin(code) {
    // כניסה חמה: מדלגים על מסך הבית, ישר להזנת שם, per _process/02-site-planner-plan.md.
    // Site Planner finding 2026-08-12: skipping the home screen means skipping its ONLY
    // explanation of what the game even is, so most real players (arriving via a WhatsApp link,
    // per the marketing plan) never saw it. One line here closes that gap without re-adding the
    // extra screen the warm-entry flow was specifically built to skip.
    document.getElementById('warm-entry-context').classList.remove('hidden');
    state.mode = 'join';
    state.pendingJoinCode = code.toUpperCase();
    showScreen('name');
  }

  function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA install just won't be offered, the live game itself doesn't depend on this */ });
    document.getElementById('home-example-question').textContent = HOME_EXAMPLES[Math.floor(Math.random() * HOME_EXAMPLES.length)];
    renderQuickRejoin();
    const pathMatch = location.pathname.match(/^\/room\/([A-Za-z0-9]{4})$/);
    const queryCode = new URLSearchParams(location.search).get('code');
    const warmCode = (pathMatch && pathMatch[1]) || queryCode;
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem('whosmost') || 'null'); } catch { return null; } })();
    // Exposed so the rejoin_failed/room_not_found handlers can fall back to a fresh
    // room link instead of dead-ending, when a stale saved session and a warm URL both exist.
    state.warmCodeFallback = warmCode || null;

    connect(() => {
      if (saved && saved.roomCode && saved.playerId) {
        send({ type: 'rejoin', code: saved.roomCode, playerId: saved.playerId });
        return;
      }
      // No stale session to rescue from, so a warm code that turns out invalid should
      // show the real error, not retry itself, per the one-time-rescue design above.
      state.warmCodeFallback = null;
      if (warmCode) enterWarmJoin(warmCode);
    });
  }
  boot();
})();
