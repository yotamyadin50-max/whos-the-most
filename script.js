// Who's The Most, client. Vanilla JS, no framework, no build step.
(() => {
  const TILE_COLORS = ['blue', 'pink', 'green', 'orange', 'yellow', 'cyan'];

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

  // --- צלילים (Critic finding #2): טונים מחוללים ב-Web Audio API, אפס קובץ חיצוני,
  // באותה רוח של "אפס תלויות" שכל שאר הבנייה כבר שומרת עליה. ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!state.soundEnabled) return null;
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, durationMs, type, gain, delayMs) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const start = ctx.currentTime + (delayMs || 0) / 1000;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain || 0.12, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(start); osc.stop(start + durationMs / 1000 + 0.03);
  }
  function sfxTick() { beep(880, 90, 'square', 0.07); }
  function sfxVote() { beep(520, 70, 'sine', 0.1); }
  function sfxJoin() { beep(720, 80, 'sine', 0.07); }
  function sfxReveal() { beep(660, 130, 'sine', 0.11); beep(880, 160, 'sine', 0.11, 90); beep(1100, 220, 'sine', 0.13, 180); }

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
  };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.view === name));
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
      showBanner('החיבור נותק, מתחבר מחדש...');
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
  function whatsappShareText(code) {
    const url = `${location.origin}/room/${code}`;
    return `בואו נשחק "מי הכי", מצביעים אחד על השני, זה קצר וזה כיף. נכנסים כאן: ${url}`;
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

  function renderCustomQuestions() {
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
    document.getElementById('bonus-badge').classList.toggle('hidden', !msg.bonus);
    document.getElementById('question-text').innerHTML = bidiSafe(msg.text);
    document.getElementById('vote-count').textContent = `0/${msg.players.length} הצביעו`;
    const grid = document.getElementById('vote-grid');
    grid.className = msg.players.length > 8 ? 'many' : '';
    grid.innerHTML = '';
    msg.players.forEach(p => {
      const btn = document.createElement('button');
      btn.className = `vote-btn tile-${p.color}`;
      btn.innerHTML = (p.emoji ? p.emoji + ' ' : '') + bidiSafe(p.name);
      btn.dataset.playerId = p.id;
      btn.addEventListener('click', () => {
        if (state.myVote) return;
        state.myVote = p.id;
        grid.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('picked'));
        btn.classList.add('picked');
        sfxVote();
        send({ type: 'vote', targetPlayerId: p.id });
      });
      grid.appendChild(btn);
    });
    showScreen('question');
  }

  function renderResult(msg) {
    const nameEl = document.getElementById('result-name');
    const votesEl = document.getElementById('result-votes');
    const pointsPhrase = msg.bonus ? `מקבלים ${msg.points} נקודות, שאלת האלופים 🏆` : 'מקבלים הכי הרבה קולות';
    const pointsPhraseSingle = msg.bonus ? `מקבל/ת ${msg.points} נקודות, שאלת האלופים 🏆` : 'מקבל/ת הכי הרבה קולות';
    if (!msg.winners.length) {
      nameEl.textContent = 'אף אחד לא הצביע הפעם';
      votesEl.textContent = '';
    } else if (msg.tie) {
      nameEl.innerHTML = 'תיקו! ' + joinNames(msg.winners.map(w => bidiSafe(w.name))) + ' ' + pointsPhrase;
      votesEl.textContent = `${msg.winners[0].votes} קולות`;
    } else {
      nameEl.innerHTML = bidiSafe(msg.winners[0].name) + ' ' + pointsPhraseSingle;
      votesEl.textContent = `${msg.winners[0].votes} קולות`;
    }
    announce(nameEl.textContent);
    sfxReveal();
    state.myReaction = null;
    document.querySelectorAll('.reaction-btn').forEach(b => { b.disabled = false; });
    document.getElementById('reaction-burst-layer').innerHTML = '';
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
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.myReaction) return;
      state.myReaction = btn.dataset.emoji;
      document.querySelectorAll('.reaction-btn').forEach(b => { b.disabled = true; });
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
    const board = document.getElementById('leaderboard');
    board.innerHTML = msg.leaderboard.map((row, i) => `
      <div class="leaderboard-row">
        <span>${i === 0 && row.wins > 0 ? CROWN_SVG + ' ' : ''}${row.emoji ? row.emoji + ' ' : ''}${bidiSafe(row.name)}</span>
        <span class="n">${row.wins} נקודות</span>
      </div>`).join('');
    const votes = document.getElementById('total-votes-table');
    votes.innerHTML = msg.totalVotesTable.map(row => `
      <div class="votes-row"><span>${row.emoji ? row.emoji + ' ' : ''}${bidiSafe(row.name)}</span><span class="n">${row.votes}</span></div>`).join('');
    showScreen('final');
  }

  document.getElementById('btn-continue-playing').addEventListener('click', () => send({ type: 'continue_playing' }));
  document.getElementById('btn-exit').addEventListener('click', () => {
    send({ type: 'leave_room' });
    clearSession();
    history.replaceState(null, '', '/');
    location.reload();
  });
  document.getElementById('btn-error-home').addEventListener('click', () => {
    clearSession();
    history.replaceState(null, '', '/');
    location.reload();
  });

  // ---------- Message router ----------
  function handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        state.roomCode = msg.code; state.playerId = msg.playerId; state.hostId = msg.hostId;
        saveSession();
        history.replaceState(null, '', `/room/${msg.code}`);
        renderLobby({ hostId: msg.hostId, players: msg.players, questionCount: msg.questionCount, customQuestions: msg.customQuestions, canStart: msg.players.length >= 3, startBlockedReason: startBlockedReason(msg.players.length) });
        break;

      case 'room_joined':
        state.roomCode = msg.code; state.playerId = msg.playerId; state.hostId = msg.hostId;
        saveSession();
        history.replaceState(null, '', `/room/${msg.code}`);
        if (msg.phase === 'lobby') {
          renderLobby({ hostId: msg.hostId, players: msg.players, questionCount: msg.questionCount, customQuestions: msg.customQuestions, canStart: msg.players.length >= 3, startBlockedReason: startBlockedReason(msg.players.length) });
        } else if (msg.phase === 'question' && msg.current) {
          renderQuestion({ text: msg.current.text, bonus: msg.current.bonus, players: msg.players });
        } else {
          showScreen('waiting-next-round');
        }
        break;

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
    state.mode = 'join';
    state.pendingJoinCode = code.toUpperCase();
    showScreen('name');
  }

  function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA install just won't be offered, the live game itself doesn't depend on this */ });
    document.getElementById('home-example-question').textContent = HOME_EXAMPLES[Math.floor(Math.random() * HOME_EXAMPLES.length)];
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
