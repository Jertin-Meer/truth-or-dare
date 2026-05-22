// ============================================================================
//  真心话大冒险 · 联机版（Supabase Realtime）
// ============================================================================
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { quickQuestions, decks, skipPenalties } from './data/questions';

// ── Utilities ────────────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const myUid = (() => {
  let id = sessionStorage.getItem('tod_uid');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('tod_uid', id);
  }
  return id;
})();

const genCode = () => {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => s[Math.floor(Math.random() * s.length)]).join('');
};

const DECK_IDS = {
  mild:   ['ice', 'secret', 'friends', 'dare-light'],
  spicy:  ['ambiguous', 'explosive', 'dare-hot'],
  random: ['secret', 'ambiguous', 'explosive', 'friends', 'ice', 'dare-light', 'dare-hot'],
};

const VOTE_MS = 7000;

// ── Stars Background ─────────────────────────────────────────────────────────
function Stars() {
  const stars = useRef(
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      dur: (Math.random() * 3 + 2).toFixed(1),
      del: (Math.random() * 4).toFixed(1),
    }))
  ).current;
  return (
    <div className="stars-bg" aria-hidden>
      {stars.map((s) => (
        <div key={s.id} className="star" style={{
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          '--duration': `${s.dur}s`, '--delay': `${s.del}s`,
        }} />
      ))}
    </div>
  );
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
const getRoom = async (code) => {
  const { data, error } = await supabase
    .from('tod_rooms').select('state').eq('code', code).single();
  if (error) return null;
  return data?.state ?? null;
};

const setRoomState = async (code, state) => {
  await supabase.from('tod_rooms').update({ state }).eq('code', code);
};

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]       = useState('home');
  const [roomCode, setRoomCode]   = useState('');
  const [room, setRoom]           = useState(null);
  const [myName, setMyName]       = useState(() => sessionStorage.getItem('tod_name') || '');
  const [joinCode, setJoinCode]   = useState('');
  const [error, setError]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [timeLeft, setTimeLeft]   = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [sbError, setSbError]     = useState(false);

  const revealFired = useRef(false);
  const nextFired   = useRef(false);
  const timerRef    = useRef(null);

  const players     = room?.players    || {};
  const isHost      = room?.hostId     === myUid;
  const isLoser     = room?.loser      === myUid;
  const myVote      = room?.votes?.[myUid] ?? null;
  const playerCount = Object.keys(players).length;
  const votedCount  = Object.values(room?.votes || {}).filter(Boolean).length;
  const allVoted    = playerCount > 0 && votedCount >= playerCount;
  const myReady     = players[myUid]?.ready ?? false;

  // ── Supabase Realtime subscription ───────────────────────────────────────
  useEffect(() => {
    if (!roomCode) return;

    // Initial fetch
    getRoom(roomCode).then((state) => {
      if (!state) { setScreen('home'); setRoomCode(''); return; }
      setRoom(state);
    });

    // Realtime listener
    const channel = supabase
      .channel(`room-${roomCode}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tod_rooms', filter: `code=eq.${roomCode}` },
        (payload) => { if (payload.new?.state) setRoom(payload.new.state); }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') setSbError(true);
      });

    return () => { supabase.removeChannel(channel); };
  }, [roomCode]);

  // ── Timer ────────────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!room?.voteDeadline || room?.phase !== 'voting') { setTimeLeft(0); return; }
    const tick = () =>
      setTimeLeft(Math.max(0, Math.ceil((room.voteDeadline - Date.now()) / 1000)));
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => clearInterval(timerRef.current);
  }, [room?.voteDeadline, room?.phase]);

  // ── Host: auto-reveal when timer ends or all voted ────────────────────────
  useEffect(() => {
    if (!isHost || room?.phase !== 'voting' || room?.votesRevealed || revealFired.current) return;
    if (timeLeft <= 0 || allVoted) {
      revealFired.current = true;
      doReveal();
    }
  }, [timeLeft, allVoted, isHost, room?.phase, room?.votesRevealed]);

  // Reset guards on new voting phase
  useEffect(() => {
    if (room?.phase === 'voting') {
      revealFired.current = false;
      nextFired.current   = false;
    }
  }, [room?.phase]);

  // ── Host: advance when all ready ─────────────────────────────────────────
  useEffect(() => {
    if (!isHost || room?.phase !== 'card-reveal' || nextFired.current) return;
    const vals = Object.values(players);
    if (vals.length >= 2 && vals.every((p) => p.ready)) {
      nextFired.current = true;
      doNextRound();
    }
  }, [players, room?.phase, isHost]);

  // Save name
  useEffect(() => { if (myName) sessionStorage.setItem('tod_name', myName); }, [myName]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const doCreate = async () => {
    const name = myName.trim();
    if (!name) { setError('请先输入你的名字'); return; }
    setBusy(true); setError('');
    try {
      let code;
      for (let i = 0; i < 10; i++) {
        code = genCode();
        const { data } = await supabase.from('tod_rooms').select('code').eq('code', code).single();
        if (!data) break;
      }
      const initialState = {
        hostId: myUid,
        phase: 'lobby',
        round: 0,
        settings: { gameMode: 'both', intensity: 'random' },
        players: { [myUid]: { name, skipChances: 1, ready: false } },
        createdAt: Date.now(),
        votes: {},
        votesRevealed: false,
        usedQuestionIds: {},
        usedCardIds: {},
        history: {},
      };
      const { error: insertErr } = await supabase.from('tod_rooms').insert({ code, state: initialState });
      if (insertErr) throw insertErr;
      setRoomCode(code);
      setScreen('game');
    } catch (e) {
      setError('创建失败：' + (e?.message || e?.code || JSON.stringify(e)));
    }
    setBusy(false);
  };

  const doJoin = async () => {
    const name = myName.trim();
    if (!name) { setError('请先输入你的名字'); return; }
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) { setError('房间号是4位'); return; }
    setBusy(true); setError('');
    try {
      const state = await getRoom(code);
      if (!state) { setError('找不到这个房间，检查一下房间号'); setBusy(false); return; }
      if (state.phase !== 'lobby') { setError('游戏已经开始了，加入不了'); setBusy(false); return; }
      if (Object.keys(state.players || {}).length >= 10) { setError('房间满了'); setBusy(false); return; }
      // Atomic join via RPC
      await supabase.rpc('join_room', { p_code: code, p_uid: myUid, p_name: name });
      setRoomCode(code);
      setScreen('game');
    } catch {
      setError('加入失败，请重试');
    }
    setBusy(false);
  };

  const doStart = () => doNextRound(true);

  const doNextRound = async (first = false) => {
    const usedIds = Object.keys(room?.usedQuestionIds || {}).map(Number);
    let pool = quickQuestions.filter((q) => !usedIds.includes(q.id));
    if (!pool.length) pool = [...quickQuestions];
    const q = pick(pool);

    const newPlayers = Object.fromEntries(
      Object.entries(room?.players || {}).map(([uid, p]) => [uid, { ...p, ready: false }])
    );

    const newState = {
      ...room,
      phase: 'voting',
      round: first ? 1 : (room?.round || 0) + 1,
      currentQuestion: q,
      votes: {},
      votesRevealed: false,
      loser: null, loserName: null, voteBreakdown: null,
      deckId: null, deckName: null, deckIcon: null, deckGradient: null, deckGlow: null,
      card: null, cardFlipped: false,
      voteDeadline: Date.now() + VOTE_MS,
      usedQuestionIds: { ...(room?.usedQuestionIds || {}), [q.id]: true },
      players: newPlayers,
    };
    await setRoomState(roomCode, newState);
  };

  // Atomic vote via RPC (multiple players can vote simultaneously)
  const doVote = async (choice) => {
    if (myVote || room?.phase !== 'voting') return;
    await supabase.rpc('cast_vote', { p_code: roomCode, p_uid: myUid, p_choice: choice });
  };

  const doReveal = async () => {
    if (!isHost) return;
    // Fetch fresh state to avoid stale closure
    const d = await getRoom(roomCode);
    if (!d || d.phase !== 'voting' || d.votesRevealed) return;

    const votes   = d.votes || {};
    const allUids = Object.keys(d.players || {});
    const final   = { ...votes };
    allUids.forEach((uid) => { if (!final[uid]) final[uid] = pick(['A', 'B']); });

    const aUids = allUids.filter((u) => final[u] === 'A');
    const bUids = allUids.filter((u) => final[u] === 'B');
    let danger, minority;
    if (aUids.length === bUids.length) { danger = allUids; minority = 'tie'; }
    else if (aUids.length < bUids.length) { danger = aUids; minority = 'A'; }
    else { danger = bUids; minority = 'B'; }

    const loserUid  = pick(danger);
    const loserName = d.players[loserUid]?.name || '???';
    const aNames    = aUids.map((u) => d.players[u]?.name || u);
    const bNames    = bUids.map((u) => d.players[u]?.name || u);

    await setRoomState(roomCode, {
      ...d,
      votes: final,
      votesRevealed: true,
      loser: loserUid,
      loserName,
      voteBreakdown: { a: aNames, b: bNames, minority },
      phase: 'revealing',
      history: {
        ...(d.history || {}),
        [d.round]: { round: d.round, question: d.currentQuestion?.question, loserName, voteA: aNames, voteB: bNames },
      },
    });
  };

  const doForceReveal = () => {
    if (!isHost || room?.phase !== 'voting' || revealFired.current) return;
    revealFired.current = true;
    doReveal();
  };

  const doGoToDeckSelect = async () => {
    await setRoomState(roomCode, { ...room, phase: 'deck-select' });
  };

  const doSelectDeck = async (deck) => {
    const usedCards = Object.keys(room?.usedCardIds?.[deck.id] || {}).map(Number);
    let pool = deck.questions.filter((q) => !usedCards.includes(q.id));
    if (!pool.length) pool = [...deck.questions];
    const card = pick(pool);
    await setRoomState(roomCode, {
      ...room,
      phase: 'card-reveal',
      deckId: deck.id, deckName: deck.name, deckIcon: deck.icon,
      deckGradient: deck.gradient, deckGlow: deck.glow,
      card: card.text, cardFlipped: false,
      usedCardIds: {
        ...(room?.usedCardIds || {}),
        [deck.id]: { ...(room?.usedCardIds?.[deck.id] || {}), [card.id]: true },
      },
    });
  };

  const doSelectRandom = async () => {
    const { gameMode = 'both', intensity = 'random' } = room?.settings || {};
    const ids   = DECK_IDS[intensity] || DECK_IDS.random;
    const avail = decks.filter((d) => ids.includes(d.id) && (gameMode !== 'truth' || d.type !== 'dare'));
    if (avail.length) await doSelectDeck(pick(avail));
  };

  const doSkip = async () => {
    const chances = players[myUid]?.skipChances ?? 0;
    if (chances <= 0) return;
    const penalty = pick(skipPenalties);
    const newPlayers = {
      ...room.players,
      [myUid]: { ...room.players[myUid], skipChances: chances - 1 },
    };
    await setRoomState(roomCode, {
      ...room,
      players: newPlayers,
      phase: 'card-reveal',
      card: penalty, cardFlipped: true,
      deckName: '跳过惩罚', deckIcon: '🏃',
      deckGradient: 'from-yellow-600 to-amber-800',
      deckGlow: 'rgba(245,158,11,0.5)',
    });
  };

  const doFlip = async () => {
    if (room?.cardFlipped) return;
    await setRoomState(roomCode, { ...room, cardFlipped: true });
  };

  // Atomic ready via RPC (both players can click simultaneously)
  const doReady = async () => {
    if (myReady) return;
    await supabase.rpc('mark_player_ready', { p_code: roomCode, p_uid: myUid });
  };

  const doUpdateSettings = async (settings) => {
    await setRoomState(roomCode, {
      ...room,
      settings: { ...room.settings, ...settings },
    });
  };

  const doCopyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doLeave = () => {
    if (room?.phase === 'lobby') {
      const newPlayers = { ...room.players };
      delete newPlayers[myUid];
      setRoomState(roomCode, { ...room, players: newPlayers });
    }
    setScreen('home'); setRoomCode(''); setRoom(null); setError('');
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (sbError) {
    return (
      <div className="min-h-screen bg-party flex items-center justify-center px-6 text-center">
        <Stars />
        <div className="relative z-10 space-y-2">
          <p className="text-red-400 text-lg font-bold">Supabase 连接失败</p>
          <p className="text-white/40 text-sm">请检查 src/supabase.js 里的 URL 和 Key</p>
        </div>
      </div>
    );
  }

  if (screen === 'home') {
    return (
      <HomeScreen
        myName={myName} setMyName={setMyName}
        joinCode={joinCode} setJoinCode={setJoinCode}
        error={error} busy={busy}
        onCreate={doCreate} onJoin={doJoin}
      />
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-party flex items-center justify-center">
        <Stars />
        <p className="text-white/40 z-10 animate-pulse">连接中...</p>
      </div>
    );
  }

  const phase = room.phase;

  return (
    <div className="min-h-screen bg-party relative flex flex-col">
      <Stars />

      <header className="flex items-center justify-between px-4 pt-4 pb-2 relative z-10">
        <button onClick={doLeave} className="text-white/40 hover:text-white/70 text-sm transition-all">
          ← 退出
        </button>
        <div className="flex items-center gap-2">
          {phase !== 'lobby' && (
            <span className="text-white/30 text-xs">第 {room.round} 轮</span>
          )}
          <button
            onClick={doCopyCode}
            className="font-mono font-bold text-sm px-3 py-1.5 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-all"
          >
            {copied ? '✅ 已复制' : `🏠 ${roomCode}`}
          </button>
          {phase !== 'lobby' && (
            <button
              onClick={() => setShowHistory(true)}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 text-white/50 text-xs hover:bg-white/20"
            >
              📋
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col relative z-10">
        {phase === 'lobby'       && <LobbyPhase     room={room} myUid={myUid} isHost={isHost} onStart={doStart} onSettings={doUpdateSettings} onCopyCode={doCopyCode} copied={copied} />}
        {phase === 'voting'      && <VotingPhase    room={room} myUid={myUid} myVote={myVote} timeLeft={timeLeft} isHost={isHost} onVote={doVote} onForceReveal={doForceReveal} />}
        {phase === 'revealing'   && <RevealingPhase room={room} myUid={myUid} isLoser={isLoser} players={players} skipChances={players[myUid]?.skipChances ?? 0} onDrawCard={doGoToDeckSelect} onSkip={doSkip} />}
        {phase === 'deck-select' && <DeckSelectPhase room={room} isLoser={isLoser} onSelectDeck={doSelectDeck} onSelectRandom={doSelectRandom} />}
        {phase === 'card-reveal' && <CardRevealPhase room={room} myUid={myUid} players={players} myReady={myReady} onFlip={doFlip} onReady={doReady} />}
      </div>

      {showHistory && (
        <HistoryModal history={room.history || {}} onClose={() => setShowHistory(false)} />
      )}

      <footer className="text-center text-white/20 text-xs py-3 relative z-10">
        游戏归游戏，别真的伤害朋友感情。💙
      </footer>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  HOME SCREEN
// ═════════════════════════════════════════════════════════════════════════════
function HomeScreen({ myName, setMyName, joinCode, setJoinCode, error, busy, onCreate, onJoin }) {
  const [tab, setTab] = useState('create');

  return (
    <div className="min-h-screen bg-party relative flex flex-col items-center justify-center px-4 py-8">
      <Stars />

      <div className="relative z-10 text-center mb-8">
        <div className="text-6xl mb-3 animate-float inline-block">🎲</div>
        <h1 className="text-4xl font-black bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
          真心话 · 大冒险
        </h1>
        <p className="text-white/40 mt-1 text-sm">联机派对小游戏</p>
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-3">
        {/* Name */}
        <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
          <p className="text-white/40 text-xs mb-1.5">你的名字</p>
          <input
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="最多 6 个字"
            maxLength={6}
            className="w-full bg-transparent text-white text-lg font-bold placeholder-white/20 focus:outline-none"
          />
        </div>

        {/* Tab */}
        <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1">
          {[
            { v: 'create', label: '✨ 创建房间' },
            { v: 'join',   label: '🚪 加入房间' },
          ].map(({ v, label }) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                tab === v
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'create' && (
          <button
            onClick={onCreate}
            disabled={busy}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white font-black text-lg shadow-2xl shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {busy ? '⏳ 创建中...' : '开始创建 →'}
          </button>
        )}

        {tab === 'join' && (
          <div className="space-y-3">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="输入 4 位房间号"
              maxLength={4}
              className="w-full bg-white/10 border border-white/15 rounded-2xl px-4 py-4 text-white text-center text-3xl font-black font-mono tracking-[0.4em] focus:border-purple-400 focus:outline-none transition-all uppercase placeholder-white/20"
            />
            <button
              onClick={onJoin}
              disabled={busy || joinCode.length !== 4}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-bold text-lg shadow-lg disabled:opacity-40 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              {busy ? '⏳ 加入中...' : '进入房间 →'}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-xl px-4 py-3 text-red-300 text-sm text-center animate-fade-in">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  LOBBY PHASE
// ═════════════════════════════════════════════════════════════════════════════
function LobbyPhase({ room, myUid, isHost, onStart, onSettings, onCopyCode, copied }) {
  const players    = room?.players || {};
  const playerList = Object.entries(players);
  const { gameMode = 'both', intensity = 'random' } = room?.settings || {};
  const canStart   = playerList.length >= 2;

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      {/* Room code */}
      <div className="w-full max-w-sm mb-5">
        <div className="bg-gradient-to-br from-purple-900/60 to-indigo-900/60 border border-purple-500/30 rounded-3xl p-6 text-center">
          <p className="text-white/40 text-xs mb-2 tracking-widest uppercase">房间号</p>
          <p className="text-5xl font-black font-mono tracking-[0.3em] text-white mb-4">{room?.code ?? '----'}</p>
          <button
            onClick={onCopyCode}
            className="px-6 py-2.5 rounded-xl bg-purple-600/40 text-purple-300 text-sm font-bold hover:bg-purple-600/60 transition-all"
          >
            {copied ? '✅ 已复制' : '📋 复制给朋友'}
          </button>
        </div>
      </div>

      {/* Players */}
      <div className="w-full max-w-sm mb-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-white/40 text-xs mb-3">在线玩家（{playerList.length}/10）</p>
          <div className="space-y-2">
            {playerList.map(([uid, p]) => (
              <div key={uid} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold">
                  {p.name?.[0] || '?'}
                </div>
                <span className="text-white font-medium flex-1">{p.name}</span>
                {uid === room.hostId && <span className="text-xs text-yellow-400 font-medium">👑 房主</span>}
                {uid === myUid && uid !== room.hostId && <span className="text-xs text-white/30">（你）</span>}
              </div>
            ))}
            {playerList.length < 2 && (
              <p className="text-white/30 text-sm text-center py-2">等待其他玩家加入...</p>
            )}
          </div>
        </div>
      </div>

      {/* Settings (host only) */}
      {isHost && (
        <div className="w-full max-w-sm mb-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <p className="text-white/50 text-xs font-bold tracking-wide">⚙️ 游戏设置</p>
            <div>
              <p className="text-white/30 text-xs mb-2">模式</p>
              <div className="flex gap-2">
                {[{ v: 'both', label: '🎭 真心话+大冒险' }, { v: 'truth', label: '💬 纯真心话' }].map(({ v, label }) => (
                  <button key={v} onClick={() => onSettings({ gameMode: v })}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${gameMode === v ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-white/30 text-xs mb-2">强度</p>
              <div className="flex gap-2">
                {[{ v: 'mild', label: '🌸 温和' }, { v: 'spicy', label: '🔥 刺激' }, { v: 'random', label: '🎲 随机' }].map(({ v, label }) => (
                  <button key={v} onClick={() => onSettings({ intensity: v })}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${intensity === v ? 'bg-pink-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start */}
      {isHost ? (
        <div className="w-full max-w-sm">
          <button
            onClick={onStart}
            disabled={!canStart}
            className={`w-full py-4 rounded-2xl font-black text-lg transition-all ${
              canStart
                ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white shadow-2xl shadow-purple-500/40 hover:scale-[1.02] animate-pulse-glow'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
          >
            {canStart ? '🎉 开始游戏！' : '至少需要 2 位玩家'}
          </button>
        </div>
      ) : (
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2">
            {['0ms','150ms','300ms'].map((d, i) => (
              <div key={i} className={`w-2 h-2 rounded-full animate-bounce ${['bg-purple-400','bg-pink-400','bg-orange-400'][i]}`} style={{ animationDelay: d }} />
            ))}
          </div>
          <p className="text-white/40 text-sm mt-2">等待房主开始游戏...</p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  VOTING PHASE
// ═════════════════════════════════════════════════════════════════════════════
function VotingPhase({ room, myUid, myVote, timeLeft, isHost, onVote, onForceReveal }) {
  const players     = room?.players || {};
  const votes       = room?.votes   || {};
  const question    = room?.currentQuestion;
  const circumference = 2 * Math.PI * 28;
  const timerColor  = timeLeft <= 2 ? '#f43f5e' : timeLeft <= 4 ? '#fb923c' : '#a78bfa';
  const progress    = (timeLeft / 7) * circumference;

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      {/* Question */}
      <div className="w-full max-w-lg mb-5">
        <div className="bg-gradient-to-br from-purple-900/60 to-indigo-900/60 border border-purple-500/30 rounded-3xl p-6 text-center shadow-2xl">
          <p className="text-white/40 text-xs mb-3 tracking-widest uppercase">快速二选一 🎯</p>
          <p className="text-white text-xl font-bold mb-5 leading-snug">{question?.question}</p>
          <div className="flex gap-3">
            <div className="flex-1 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl py-3 px-3 text-center">
              <p className="text-indigo-300 font-bold text-sm">{question?.optionA}</p>
            </div>
            <div className="flex-1 bg-pink-600/30 border border-pink-400/30 rounded-2xl py-3 px-3 text-center">
              <p className="text-pink-300 font-bold text-sm">{question?.optionB}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Timer */}
      <div className="mb-5 flex items-center gap-3">
        <svg width="64" height="64" viewBox="0 0 64 64" className="timer-ring">
          <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
          <circle cx="32" cy="32" r="28" fill="none" stroke={timerColor} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference - progress}
            className="timer-ring-circle" style={{ filter: `drop-shadow(0 0 8px ${timerColor})` }} />
        </svg>
        <span className="text-5xl font-black" style={{ color: timerColor, textShadow: `0 0 20px ${timerColor}` }}>
          {timeLeft}
        </span>
      </div>

      {/* Other players' vote status (show voted/not voted, NOT which option) */}
      <div className="w-full max-w-lg mb-5">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-white/30 text-xs mb-3 text-center">投票状态（揭晓前隐藏选项）</p>
          <div className="space-y-2">
            {Object.entries(players).map(([uid, p]) => {
              const hasVoted = !!votes[uid];
              const isMe     = uid === myUid;
              return (
                <div key={uid} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {p.name?.[0]}
                  </div>
                  <span className="text-white text-sm font-medium flex-1">
                    {p.name} {isMe && <span className="text-white/30 text-xs">（你）</span>}
                  </span>
                  {hasVoted
                    ? <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400 font-medium">✅ 已选择</span>
                    : <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/30">⏳ 选择中</span>
                  }
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Vote buttons */}
      {!myVote ? (
        <div className="w-full max-w-lg">
          <p className="text-white/40 text-xs text-center mb-3">你的选择（对方看不到）</p>
          <div className="flex gap-3">
            <button onClick={() => onVote('A')}
              className="flex-1 py-5 rounded-2xl vote-btn-a text-white font-black text-2xl shadow-lg transition-all hover:scale-105 active:scale-95">
              A
            </button>
            <button onClick={() => onVote('B')}
              className="flex-1 py-5 rounded-2xl vote-btn-b text-white font-black text-2xl shadow-lg transition-all hover:scale-105 active:scale-95">
              B
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-lg text-center py-4 bg-white/5 border border-white/10 rounded-2xl">
          <p className="text-white font-bold text-lg">
            你选了 <span className={myVote === 'A' ? 'text-indigo-400' : 'text-pink-400'}>{myVote}</span>
          </p>
          <p className="text-white/40 text-sm mt-1">等待其他人选择...</p>
        </div>
      )}

      {isHost && (
        <button onClick={onForceReveal}
          className="mt-4 px-5 py-2 rounded-xl bg-white/10 text-white/50 text-sm hover:bg-white/20 transition-all">
          ⚡ 提前揭晓结果
        </button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  REVEALING PHASE
// ═════════════════════════════════════════════════════════════════════════════
function RevealingPhase({ room, isLoser, players, skipChances, onDrawCard, onSkip }) {
  const breakdown = room?.voteBreakdown;
  const question  = room?.currentQuestion;
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setShake(true), 200);
    const t2 = setTimeout(() => setShake(false), 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      {/* Vote breakdown */}
      {breakdown && (
        <div className="w-full max-w-lg mb-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-white/30 text-xs text-center mb-3">投票结果揭晓</p>
            <div className="flex gap-4">
              {[
                { names: breakdown.a, option: question?.optionA, side: 'A', color: 'indigo', minority: breakdown.minority === 'A' },
                { names: breakdown.b, option: question?.optionB, side: 'B', color: 'pink',   minority: breakdown.minority === 'B' },
              ].map(({ names, option, side, color, minority }) => (
                <div key={side} className="flex-1 text-center">
                  <p className={`text-${color}-400 font-bold text-xs mb-2`}>
                    {option} <span className="text-white/30">({names.length}票)</span>
                  </p>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {names.map((name) => (
                      <span key={name} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        minority ? 'bg-red-500/30 text-red-300' : `bg-${color}-500/20 text-${color}-300`
                      }`}>{name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {breakdown.minority === 'tie' && (
              <p className="text-yellow-400 text-xs text-center mt-2">票数相同，全体随机抽取</p>
            )}
          </div>
        </div>
      )}

      {/* Loser */}
      <div className={`w-full max-w-lg mb-5 loser-enter ${shake ? 'animate-shake' : ''}`}>
        <div className="bg-gradient-to-br from-red-900/50 to-orange-900/50 border border-red-500/40 rounded-3xl p-6 text-center shadow-2xl shadow-red-500/20">
          <p className="text-red-400/60 text-xs tracking-widest uppercase mb-2">💀 本轮输家</p>
          <div className="text-6xl mb-2">😬</div>
          <h2 className="text-4xl font-black text-white">{room.loserName}</h2>
          {isLoser && <p className="text-red-300/70 text-sm mt-1">就是你！</p>}
        </div>
      </div>

      {/* Actions */}
      {isLoser ? (
        <div className="w-full max-w-lg space-y-3">
          <button onClick={onDrawCard}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white font-black text-lg shadow-2xl shadow-purple-500/30 hover:scale-[1.02] transition-all">
            🃏 抽一张题卡
          </button>
          {skipChances > 0 ? (
            <button onClick={onSkip}
              className="w-full py-3 rounded-2xl bg-white/10 text-white/60 font-medium text-sm border border-white/10 hover:bg-white/20 transition-all">
              🏃 使用跳过机会（剩余 {skipChances} 次）
            </button>
          ) : (
            <div className="text-center py-2 text-white/30 text-sm">😤 没有退路了，必须回答</div>
          )}
        </div>
      ) : (
        <div className="text-center py-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            {['0ms','150ms','300ms'].map((d, i) => (
              <div key={i} className={`w-2 h-2 rounded-full animate-bounce ${['bg-purple-400','bg-pink-400','bg-orange-400'][i]}`} style={{ animationDelay: d }} />
            ))}
          </div>
          <p className="text-white/40 text-sm">等待 {room.loserName} 选择...</p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  DECK SELECT PHASE
// ═════════════════════════════════════════════════════════════════════════════
function DeckSelectPhase({ room, isLoser, onSelectDeck, onSelectRandom }) {
  const { gameMode = 'both', intensity = 'random' } = room?.settings || {};
  const ids            = DECK_IDS[intensity] || DECK_IDS.random;
  const availableDecks = decks.filter(
    (d) => ids.includes(d.id) && (gameMode !== 'truth' || d.type !== 'dare')
  );

  if (!isLoser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 page-enter">
        <div className="text-5xl mb-4 animate-float">🃏</div>
        <p className="text-white/60 text-lg font-bold">{room.loserName} 正在选题卡...</p>
        <div className="flex items-center justify-center gap-2 mt-4">
          {['0ms','150ms','300ms'].map((d, i) => (
            <div key={i} className={`w-2 h-2 rounded-full animate-bounce ${['bg-purple-400','bg-pink-400','bg-orange-400'][i]}`} style={{ animationDelay: d }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      <p className="text-white/50 text-sm mb-1 text-center">选择题卡类型</p>
      <p className="text-white/30 text-xs mb-4">或者让命运决定</p>
      <div className="w-full max-w-lg mb-4">
        <button onClick={onSelectRandom}
          className="w-full py-4 rounded-2xl bg-white/10 border border-white/15 text-white font-bold hover:bg-white/20 hover:border-purple-400 transition-all">
          🎲 随机一张（命运决定）
        </button>
      </div>
      <div className="w-full max-w-lg grid grid-cols-2 gap-3">
        {availableDecks.map((deck) => (
          <button key={deck.id} onClick={() => onSelectDeck(deck)}
            className={`relative overflow-hidden rounded-2xl p-4 text-left bg-gradient-to-br ${deck.gradient} shadow-lg hover:scale-105 active:scale-95 transition-all group`}
            style={{ boxShadow: `0 8px 30px ${deck.glow}` }}>
            <div className="shimmer absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="text-3xl mb-2">{deck.icon}</div>
            <p className="text-white font-bold text-sm">{deck.name}</p>
            <p className="text-white/60 text-xs mt-0.5">{deck.description}</p>
            <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${
              deck.type === 'truth' ? 'bg-white/20 text-white' : 'bg-black/30 text-white/80'
            }`}>{deck.type === 'truth' ? '💬 真心话' : '🎯 大冒险'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  CARD REVEAL PHASE  (解释时间在这里)
// ═════════════════════════════════════════════════════════════════════════════
function CardRevealPhase({ room, myUid, players, myReady, onFlip, onReady }) {
  const cardHeight     = 300;
  const flipped        = room?.cardFlipped;
  const isSkipPenalty  = room?.deckName === '跳过惩罚';
  const playerList     = Object.entries(players);
  const readyCount     = playerList.filter(([, p]) => p.ready).length;

  const deck = {
    name: room?.deckName,
    icon: room?.deckIcon,
    gradient: room?.deckGradient || 'from-purple-600 to-indigo-800',
    glow:     room?.deckGlow     || 'rgba(139,92,246,0.5)',
  };

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      <p className="text-white/50 text-sm mb-1 text-center">
        <span className="text-white font-bold">{room?.loserName}</span> 抽到了 {deck.icon} {deck.name}
      </p>
      {isSkipPenalty && <p className="text-yellow-400/70 text-xs mb-3">跳过了！接受轻度惩罚</p>}

      {/* 3D flip card */}
      <div className="w-full max-w-sm mb-5 cursor-pointer" style={{ height: cardHeight }}
        onClick={!flipped ? onFlip : undefined}>
        <div className="card-flip-container" style={{ height: cardHeight }}>
          <div className={`card-inner ${flipped ? 'flipped' : ''}`} style={{ height: cardHeight }}>
            {/* Front */}
            <div className="card-face" style={{ height: cardHeight }}>
              <div className={`w-full h-full bg-gradient-to-br ${deck.gradient} flex flex-col items-center justify-center rounded-3xl border border-white/20 shadow-2xl`}
                style={{ boxShadow: `0 20px 60px ${deck.glow}` }}>
                <div className="text-7xl mb-4 animate-float">{deck.icon}</div>
                <p className="text-white font-bold text-xl">{deck.name}</p>
                {!flipped && <p className="text-white/60 text-sm mt-2">点击翻牌 🃏</p>}
              </div>
            </div>
            {/* Back */}
            <div className="card-face card-back-face" style={{ height: cardHeight }}>
              <div className="w-full h-full bg-gradient-to-br from-gray-900 to-gray-800 flex flex-col items-center justify-center rounded-3xl px-6 text-center"
                style={{
                  border: `2px solid ${deck.glow?.replace('0.5','0.7') ?? 'rgba(168,85,247,0.7)'}`,
                  boxShadow: `0 20px 60px ${deck.glow}, inset 0 0 40px rgba(255,255,255,0.03)`,
                }}>
                <div className="text-3xl mb-4">{deck.icon}</div>
                <p className="text-white text-base font-semibold leading-snug">{room?.card}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!flipped ? (
        <button onClick={onFlip}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:scale-105 transition-all">
          🃏 翻开题卡
        </button>
      ) : (
        <div className="w-full max-w-sm space-y-4 animate-slide-up">
          {/* Explanation time notice */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-center">
            <p className="text-amber-300 font-bold text-sm mb-1">⏸ 解释时间</p>
            <p className="text-white/40 text-xs">
              {isSkipPenalty ? '完成惩罚后' : room?.deckId?.startsWith('dare') ? '完成大冒险后' : '认真回答后'}
              ，所有人都点"下一轮"才会继续
            </p>
          </div>

          {/* Who's ready */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-white/30 text-xs mb-3 text-center">
              已准备好 {readyCount}/{playerList.length}
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              {playerList.map(([uid, p]) => (
                <div key={uid} className="flex items-center gap-1.5">
                  <span className={p.ready ? 'text-green-400' : 'text-white/30'}>{p.ready ? '✅' : '⏳'}</span>
                  <span className={`text-sm font-medium ${p.ready ? 'text-white' : 'text-white/40'}`}>{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={onReady} disabled={myReady}
            className={`w-full py-4 rounded-2xl font-bold text-lg transition-all ${
              myReady
                ? 'bg-green-600/30 text-green-400 border border-green-500/30 cursor-default'
                : 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg hover:opacity-90 hover:scale-[1.02]'
            }`}>
            {myReady ? '✅ 我已准备好，等待其他人...' : '✅ 说完了，下一轮 →'}
          </button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  HISTORY MODAL
// ═════════════════════════════════════════════════════════════════════════════
function HistoryModal({ history, onClose }) {
  const entries = Object.values(history).sort((a, b) => a.round - b.round);
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-950 border border-white/15 rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-white font-bold">📋 本局历史</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {entries.length === 0
            ? <p className="text-white/30 text-center py-8 text-sm">还没有记录</p>
            : entries.map((e) => (
              <div key={e.round} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold px-2 py-0.5 bg-purple-500/30 text-purple-300 rounded-full">第 {e.round} 轮</span>
                  <span className="text-red-400 text-xs font-medium">输家：{e.loserName}</span>
                </div>
                <p className="text-white/40 text-xs">
                  {e.question} — A: {(e.voteA||[]).join('、')||'无'} / B: {(e.voteB||[]).join('、')||'无'}
                </p>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
