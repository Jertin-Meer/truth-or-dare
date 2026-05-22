import React, { useState, useEffect, useRef, useCallback } from 'react';
import { quickQuestions, decks, skipPenalties } from './data/questions';

// ── Utilities ─────────────────────────────────────────────────────────────────
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const INTENSITY_DECK_IDS = {
  mild:   ['ice', 'secret', 'friends', 'dare-light'],
  spicy:  ['ambiguous', 'explosive', 'dare-hot'],
  random: ['secret', 'ambiguous', 'explosive', 'friends', 'ice', 'dare-light', 'dare-hot'],
};

// ── Star Background ────────────────────────────────────────────────────────────
function Stars() {
  const stars = useRef(
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: (Math.random() * 3 + 2).toFixed(1),
      delay: (Math.random() * 4).toFixed(1),
    }))
  ).current;

  return (
    <div className="stars-bg" aria-hidden>
      {stars.map((s) => (
        <div
          key={s.id}
          className="star"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            '--duration': `${s.duration}s`,
            '--delay': `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  // phase: 'setup' | 'voting' | 'result' | 'deck-select' | 'card-reveal'
  const [phase, setPhase] = useState('setup');

  // setup
  const [playerInputs, setPlayerInputs] = useState(['', '']);

  // game
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(1);
  const [currentQ, setCurrentQ] = useState(null);
  const [votes, setVotes] = useState({});       // { name: 'A'|'B'|null }
  const [timeLeft, setTimeLeft] = useState(5);
  const [timerActive, setTimerActive] = useState(false);
  const [loser, setLoser] = useState(null);
  const [voteBreakdown, setVoteBreakdown] = useState(null); // {a:[],b:[],minority,dangerZone}
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [currentCard, setCurrentCard] = useState(null);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [skipChances, setSkipChances] = useState({});
  const [skipPenalty, setSkipPenalty] = useState(null);

  // settings
  const [gameMode, setGameMode] = useState('both'); // 'both' | 'truth'
  const [intensity, setIntensity] = useState('random');

  // modals
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // history
  const [history, setHistory] = useState([]);

  // track used questions across rounds
  const usedQIds = useRef(new Set());
  const usedCardIds = useRef({});

  const timerRef = useRef(null);

  // ── Timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!timerActive) return;
    if (timeLeft <= 0) {
      setTimerActive(false);
      doFinalizeVotes();
      return;
    }
    timerRef.current = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [timerActive, timeLeft]);

  // ── Game helpers ────────────────────────────────────────────────────────────
  const getAvailableDecks = useCallback(() => {
    const ids = INTENSITY_DECK_IDS[intensity] ?? INTENSITY_DECK_IDS.random;
    return decks.filter((d) => {
      if (!ids.includes(d.id)) return false;
      if (gameMode === 'truth' && d.type === 'dare') return false;
      return true;
    });
  }, [intensity, gameMode]);

  const pickCard = (deck) => {
    const used = usedCardIds.current[deck.id] ?? new Set();
    const pool = deck.questions.filter((q) => !used.has(q.id));
    const chosen = pool.length > 0 ? pick(pool) : pick(deck.questions);
    if (pool.length > 0) {
      if (!usedCardIds.current[deck.id]) usedCardIds.current[deck.id] = new Set();
      usedCardIds.current[deck.id].add(chosen.id);
    }
    return chosen;
  };

  const beginNewRound = (playerList) => {
    // pick quick question
    let pool = quickQuestions.filter((q) => !usedQIds.current.has(q.id));
    if (pool.length === 0) {
      usedQIds.current = new Set();
      pool = [...quickQuestions];
    }
    const q = pick(pool);
    usedQIds.current.add(q.id);
    setCurrentQ(q);

    const initVotes = {};
    playerList.forEach((p) => { initVotes[p] = null; });
    setVotes(initVotes);
    setTimeLeft(5);
    setTimerActive(false);
    setLoser(null);
    setVoteBreakdown(null);
    setSelectedDeck(null);
    setCurrentCard(null);
    setCardFlipped(false);
    setSkipPenalty(null);
    setPhase('voting');
  };

  const startGame = () => {
    const valid = playerInputs.map((p) => p.trim()).filter(Boolean);
    if (valid.length < 2) return;
    const list = shuffle(valid);
    setPlayers(list);
    const sc = {};
    list.forEach((p) => { sc[p] = 1; });
    setSkipChances(sc);
    setRound(1);
    setHistory([]);
    usedQIds.current = new Set();
    usedCardIds.current = {};
    beginNewRound(list);
  };

  const castVote = (player, choice) => {
    setVotes((prev) => ({ ...prev, [player]: choice }));
  };

  const lockVotes = () => {
    clearTimeout(timerRef.current);
    setTimerActive(false);
    setTimeLeft(0);
    doFinalizeVotes();
  };

  const doFinalizeVotes = () => {
    // fill unvoted
    const final = { ...votes };
    players.forEach((p) => {
      if (!final[p]) final[p] = pick(['A', 'B']);
    });
    setVotes(final);

    const aVoters = players.filter((p) => final[p] === 'A');
    const bVoters = players.filter((p) => final[p] === 'B');

    let dangerZone, minority;
    if (aVoters.length === bVoters.length) {
      dangerZone = [...players];
      minority = 'tie';
    } else if (aVoters.length < bVoters.length) {
      dangerZone = aVoters;
      minority = 'A';
    } else {
      dangerZone = bVoters;
      minority = 'B';
    }

    const loserPlayer = pick(dangerZone);
    setVoteBreakdown({ a: aVoters, b: bVoters, minority, dangerZone });
    setLoser(loserPlayer);
    setPhase('result');
  };

  const handleSkip = () => {
    const chances = skipChances[loser] ?? 0;
    if (chances <= 0) return;
    setSkipChances((prev) => ({ ...prev, [loser]: chances - 1 }));
    setSkipPenalty(pick(skipPenalties));
  };

  const selectDeck = (deck) => {
    const card = pickCard(deck);
    setSelectedDeck(deck);
    setCurrentCard(card);
    setCardFlipped(false);
    setPhase('card-reveal');
    setTimeout(() => setCardFlipped(true), 400);
  };

  const selectRandom = () => {
    const available = getAvailableDecks();
    if (!available.length) return;
    selectDeck(pick(available));
  };

  const completeRound = () => {
    const entry = {
      round,
      question: currentQ?.question,
      optionA: currentQ?.optionA,
      optionB: currentQ?.optionB,
      loser,
      voteA: voteBreakdown?.a ?? [],
      voteB: voteBreakdown?.b ?? [],
      deckName: selectedDeck?.name ?? '(已跳过)',
      card: currentCard?.text ?? skipPenalty ?? '—',
      skipped: !currentCard && !!skipPenalty,
    };
    setHistory((h) => [...h, entry]);
    setRound((r) => r + 1);
    beginNewRound(players);
  };

  const restartGame = () => {
    setPhase('setup');
    setPlayers([]);
    setPlayerInputs(['', '']);
    setRound(1);
    setHistory([]);
  };

  // ── Renders by phase ────────────────────────────────────────────────────────

  if (phase === 'setup') {
    return (
      <SetupScreen
        playerInputs={playerInputs}
        setPlayerInputs={setPlayerInputs}
        gameMode={gameMode}
        setGameMode={setGameMode}
        intensity={intensity}
        setIntensity={setIntensity}
        onStart={startGame}
      />
    );
  }

  // Shared header
  const header = (
    <div className="flex items-center justify-between px-4 pt-5 pb-2 relative z-10">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🎲</span>
        <span className="font-bold text-white/70 text-sm tracking-widest uppercase">
          第 {round} 轮
        </span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setShowHistory(true)}
          className="px-3 py-1.5 rounded-xl bg-white/10 text-white/70 text-xs font-medium hover:bg-white/20 transition-all"
        >
          📋 历史
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 rounded-xl bg-white/10 text-white/70 text-xs font-medium hover:bg-white/20 transition-all"
        >
          ⚙️ 设置
        </button>
        <button
          onClick={restartGame}
          className="px-3 py-1.5 rounded-xl bg-white/10 text-white/70 text-xs font-medium hover:bg-white/20 transition-all"
        >
          🔄 重开
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-party relative flex flex-col">
      <Stars />
      {header}

      <div className="flex-1 flex flex-col relative z-10">
        {phase === 'voting' && (
          <VotingScreen
            question={currentQ}
            players={players}
            votes={votes}
            timeLeft={timeLeft}
            timerActive={timerActive}
            onStartTimer={() => setTimerActive(true)}
            onVote={castVote}
            onLock={lockVotes}
          />
        )}
        {phase === 'result' && (
          <ResultScreen
            loser={loser}
            voteBreakdown={voteBreakdown}
            currentQ={currentQ}
            skipChances={skipChances}
            skipPenalty={skipPenalty}
            onSkip={handleSkip}
            onDrawCard={() => setPhase('deck-select')}
            onAcceptPenalty={completeRound}
            gameMode={gameMode}
          />
        )}
        {phase === 'deck-select' && (
          <DeckSelectScreen
            loser={loser}
            availableDecks={getAvailableDecks()}
            onSelect={selectDeck}
            onRandom={selectRandom}
          />
        )}
        {phase === 'card-reveal' && (
          <CardRevealScreen
            loser={loser}
            deck={selectedDeck}
            card={currentCard}
            flipped={cardFlipped}
            onFlip={() => setCardFlipped(true)}
            onDone={completeRound}
          />
        )}
      </div>

      {/* Modals */}
      {showHistory && (
        <HistoryModal history={history} onClose={() => setShowHistory(false)} />
      )}
      {showSettings && (
        <SettingsModal
          gameMode={gameMode}
          setGameMode={setGameMode}
          intensity={intensity}
          setIntensity={setIntensity}
          onClose={() => setShowSettings(false)}
        />
      )}

      <footer className="text-center text-white/20 text-xs py-4 relative z-10">
        游戏归游戏，别真的伤害朋友感情。💙
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETUP SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function SetupScreen({ playerInputs, setPlayerInputs, gameMode, setGameMode, intensity, setIntensity, onStart }) {
  const valid = playerInputs.map((p) => p.trim()).filter(Boolean);
  const canStart = valid.length >= 2;

  const addPlayer = () => {
    if (playerInputs.length < 10) setPlayerInputs((p) => [...p, '']);
  };

  const removePlayer = (i) => {
    if (playerInputs.length > 2) setPlayerInputs((p) => p.filter((_, idx) => idx !== i));
  };

  const updatePlayer = (i, val) => {
    setPlayerInputs((p) => { const n = [...p]; n[i] = val; return n; });
  };

  const shufflePlayers = () => {
    setPlayerInputs((p) => shuffle([...p]));
  };

  return (
    <div className="min-h-screen bg-party relative flex flex-col items-center px-4 py-8">
      <Stars />

      {/* Title */}
      <div className="relative z-10 text-center mb-8 animate-float">
        <div className="text-6xl mb-3">🎲</div>
        <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
          真心话 · 大冒险
        </h1>
        <p className="text-white/40 mt-2 text-sm">派对小游戏 · 2–10 人</p>
      </div>

      <div className="relative z-10 w-full max-w-md space-y-4">
        {/* Player inputs */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-white font-bold text-sm tracking-wide">
              👥 玩家名单（{valid.length}/10）
            </h2>
            <button
              onClick={shufflePlayers}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/40 transition-all"
            >
              🔀 随机排序
            </button>
          </div>

          {playerInputs.map((val, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold flex-shrink-0">
                {i + 1}
              </div>
              <input
                value={val}
                onChange={(e) => updatePlayer(i, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
                placeholder={`玩家 ${i + 1} 的名字`}
                maxLength={8}
                className="flex-1 bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-white text-sm focus:border-purple-400 focus:bg-white/15 transition-all"
              />
              {playerInputs.length > 2 && (
                <button
                  onClick={() => removePlayer(i)}
                  className="w-8 h-8 rounded-full bg-white/10 text-white/40 hover:bg-red-500/30 hover:text-red-400 transition-all flex items-center justify-center text-lg leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {playerInputs.length < 10 && (
            <button
              onClick={addPlayer}
              className="w-full py-2.5 rounded-xl border border-dashed border-white/20 text-white/40 text-sm hover:border-purple-400 hover:text-purple-300 transition-all"
            >
              + 添加玩家
            </button>
          )}
        </div>

        {/* Settings */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 space-y-4">
          <h2 className="text-white font-bold text-sm tracking-wide">⚙️ 游戏设置</h2>

          <div>
            <p className="text-white/50 text-xs mb-2">模式</p>
            <div className="flex gap-2">
              {[
                { v: 'both', label: '真心话 + 大冒险', icon: '🎭' },
                { v: 'truth', label: '纯真心话模式', icon: '💬' },
              ].map(({ v, label, icon }) => (
                <button
                  key={v}
                  onClick={() => setGameMode(v)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
                    gameMode === v
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                      : 'bg-white/10 text-white/50 hover:bg-white/20'
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-white/50 text-xs mb-2">强度</p>
            <div className="flex gap-2">
              {[
                { v: 'mild', label: '温和', icon: '🌸' },
                { v: 'spicy', label: '刺激', icon: '🔥' },
                { v: 'random', label: '随机混合', icon: '🎲' },
              ].map(({ v, label, icon }) => (
                <button
                  key={v}
                  onClick={() => setIntensity(v)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
                    intensity === v
                      ? 'bg-pink-600 text-white shadow-lg shadow-pink-500/30'
                      : 'bg-white/10 text-white/50 hover:bg-white/20'
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Start button */}
        <button
          onClick={onStart}
          disabled={!canStart}
          className={`w-full py-4 rounded-2xl font-black text-lg tracking-wide transition-all ${
            canStart
              ? 'bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white shadow-2xl shadow-purple-500/40 hover:shadow-purple-500/60 hover:scale-[1.02] animate-pulse-glow'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          {canStart ? `🎉 开始游戏（${valid.length} 人）` : '至少需要 2 位玩家'}
        </button>

        <p className="text-center text-white/20 text-xs">
          游戏归游戏，别真的伤害朋友感情。💙
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VOTING SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function VotingScreen({ question, players, votes, timeLeft, timerActive, onStartTimer, onVote, onLock }) {
  const allVoted = players.every((p) => votes[p] !== null);
  const circumference = 2 * Math.PI * 28;
  const progress = timerActive ? (timeLeft / 5) * circumference : circumference;
  const timerColor = timeLeft <= 2 ? '#f43f5e' : timeLeft <= 3 ? '#fb923c' : '#a78bfa';

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      {/* Question card */}
      <div className="w-full max-w-lg mb-6">
        <div className="bg-gradient-to-br from-purple-900/60 to-indigo-900/60 backdrop-blur border border-purple-500/30 rounded-3xl p-6 text-center shadow-2xl">
          <p className="text-white/50 text-xs mb-3 tracking-widest uppercase">快速二选一 🎯</p>
          <p className="text-white text-xl font-bold mb-5 leading-snug">{question?.question}</p>
          <div className="flex gap-3">
            <div className="flex-1 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl py-3 px-4 text-center">
              <p className="text-indigo-300 font-bold text-sm">{question?.optionA}</p>
            </div>
            <div className="flex-1 bg-pink-600/30 border border-pink-400/30 rounded-2xl py-3 px-4 text-center">
              <p className="text-pink-300 font-bold text-sm">{question?.optionB}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Timer */}
      {!timerActive && timeLeft > 0 ? (
        <button
          onClick={onStartTimer}
          className="mb-6 px-8 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:scale-105 transition-all"
        >
          ▶ 开始计时
        </button>
      ) : (
        <div className="mb-6 flex items-center gap-4">
          <svg width="68" height="68" viewBox="0 0 68 68" className="timer-ring">
            <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
            <circle
              cx="34" cy="34" r="28"
              fill="none"
              stroke={timerColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              className="timer-ring-circle"
              style={{ filter: `drop-shadow(0 0 8px ${timerColor})` }}
            />
          </svg>
          <span className="text-5xl font-black" style={{ color: timerColor, textShadow: `0 0 20px ${timerColor}` }}>
            {timeLeft}
          </span>
        </div>
      )}

      {/* Player vote buttons */}
      <div className="w-full max-w-lg grid grid-cols-1 gap-2 mb-4">
        {players.map((player) => (
          <div
            key={player}
            className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3"
          >
            <div className="flex-1 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm font-bold">
                {player[0]}
              </div>
              <span className="text-white font-medium text-sm">{player}</span>
              {votes[player] && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  votes[player] === 'A'
                    ? 'bg-indigo-500/30 text-indigo-300'
                    : 'bg-pink-500/30 text-pink-300'
                }`}>
                  已选择 {votes[player]}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onVote(player, 'A')}
                disabled={!timerActive && timeLeft > 0}
                className={`px-4 py-2 rounded-xl text-sm font-bold vote-btn-a text-white transition-all ${
                  votes[player] === 'A' ? 'selected ring-2 ring-indigo-400' : ''
                } ${!timerActive && timeLeft > 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                A
              </button>
              <button
                onClick={() => onVote(player, 'B')}
                disabled={!timerActive && timeLeft > 0}
                className={`px-4 py-2 rounded-xl text-sm font-bold vote-btn-b text-white transition-all ${
                  votes[player] === 'B' ? 'selected ring-2 ring-pink-400' : ''
                } ${!timerActive && timeLeft > 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                B
              </button>
            </div>
          </div>
        ))}
      </div>

      {timerActive && (
        <button
          onClick={onLock}
          className="mt-2 px-6 py-2.5 rounded-xl bg-white/10 text-white/60 text-sm font-medium hover:bg-white/20 transition-all"
        >
          ✅ 所有人都选好了，提前结束
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULT SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function ResultScreen({ loser, voteBreakdown, currentQ, skipChances, skipPenalty, onSkip, onDrawCard, onAcceptPenalty, gameMode }) {
  const [shake, setShake] = useState(false);
  const skipsLeft = skipChances[loser] ?? 0;

  useEffect(() => {
    setTimeout(() => setShake(true), 300);
    const t = setTimeout(() => setShake(false), 900);
    return () => clearTimeout(t);
  }, [loser]);

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      {/* Vote results */}
      {voteBreakdown && (
        <div className="w-full max-w-lg mb-5">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-white/40 text-xs text-center mb-3">投票结果</p>
            <div className="flex gap-4">
              <div className="flex-1 text-center">
                <p className="text-indigo-400 font-bold text-sm mb-1">
                  {currentQ?.optionA} <span className="text-white/40">({voteBreakdown.a.length}票)</span>
                </p>
                <div className="flex flex-wrap gap-1 justify-center">
                  {voteBreakdown.a.map((p) => (
                    <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      voteBreakdown.minority === 'A' ? 'bg-red-500/30 text-red-300' : 'bg-indigo-500/20 text-indigo-300'
                    }`}>{p}</span>
                  ))}
                </div>
              </div>
              <div className="w-px bg-white/10" />
              <div className="flex-1 text-center">
                <p className="text-pink-400 font-bold text-sm mb-1">
                  {currentQ?.optionB} <span className="text-white/40">({voteBreakdown.b.length}票)</span>
                </p>
                <div className="flex flex-wrap gap-1 justify-center">
                  {voteBreakdown.b.map((p) => (
                    <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      voteBreakdown.minority === 'B' ? 'bg-red-500/30 text-red-300' : 'bg-pink-500/20 text-pink-300'
                    }`}>{p}</span>
                  ))}
                </div>
              </div>
            </div>
            {voteBreakdown.minority === 'tie' && (
              <p className="text-yellow-400 text-xs text-center mt-2">票数相同！从所有人中随机抽取</p>
            )}
          </div>
        </div>
      )}

      {/* Loser reveal */}
      <div className={`loser-enter w-full max-w-lg mb-5 ${shake ? 'animate-shake' : ''}`}>
        <div className="bg-gradient-to-br from-red-900/50 to-orange-900/50 border border-red-500/40 rounded-3xl p-6 text-center shadow-2xl shadow-red-500/20">
          <p className="text-red-400/70 text-xs tracking-widest uppercase mb-2">💀 本轮输家</p>
          <div className="text-7xl mb-2">😬</div>
          <h2 className="text-4xl font-black text-white mb-1">{loser}</h2>
          <p className="text-white/40 text-sm">
            {voteBreakdown?.minority === 'tie' ? '平局随机选中' : `少数派 ${voteBreakdown?.minority} 随机中签`}
          </p>
        </div>
      </div>

      {/* Skip penalty revealed */}
      {skipPenalty ? (
        <div className="w-full max-w-lg mb-5 animate-bounce-in">
          <div className="bg-gradient-to-br from-yellow-900/50 to-amber-900/50 border border-yellow-500/40 rounded-3xl p-5 text-center">
            <p className="text-yellow-400/70 text-xs tracking-widest uppercase mb-2">🏃 跳过惩罚</p>
            <p className="text-white text-base font-semibold leading-snug">{skipPenalty}</p>
          </div>
          <button
            onClick={onAcceptPenalty}
            className="w-full mt-3 py-4 rounded-2xl bg-gradient-to-r from-yellow-600 to-amber-600 text-white font-bold text-base shadow-lg hover:opacity-90 transition-all"
          >
            ✅ 完成惩罚，下一轮 →
          </button>
        </div>
      ) : (
        <div className="w-full max-w-lg space-y-3">
          <button
            onClick={onDrawCard}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 text-white font-black text-lg shadow-2xl shadow-purple-500/30 hover:scale-[1.02] transition-all"
          >
            🃏 抽一张{gameMode === 'truth' ? '真心话' : '题'}卡
          </button>

          <div className="flex gap-3">
            {skipsLeft > 0 ? (
              <button
                onClick={onSkip}
                className="flex-1 py-3 rounded-2xl bg-white/10 text-white/70 font-medium text-sm hover:bg-white/20 transition-all border border-white/10"
              >
                🏃 使用跳过机会（剩余 {skipsLeft} 次）
              </button>
            ) : (
              <div className="flex-1 py-3 rounded-2xl bg-white/5 text-white/30 font-medium text-sm text-center border border-white/5">
                😤 没有退路了，必须回答
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DECK SELECT SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function DeckSelectScreen({ loser, availableDecks, onSelect, onRandom }) {
  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      <div className="w-full max-w-lg mb-5 text-center">
        <p className="text-white/50 text-sm mb-1">
          <span className="text-white font-bold">{loser}</span> 请选择题卡类型
        </p>
        <p className="text-white/30 text-xs">或者交给命运随机决定</p>
      </div>

      {/* Random button */}
      <div className="w-full max-w-lg mb-4">
        <button
          onClick={onRandom}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-gray-600 to-gray-800 text-white font-bold text-base border border-white/20 hover:border-purple-400 hover:shadow-lg hover:shadow-purple-500/20 transition-all"
        >
          🎲 随机一张（命运决定）
        </button>
      </div>

      {/* Deck grid */}
      <div className="w-full max-w-lg grid grid-cols-2 gap-3">
        {availableDecks.map((deck) => (
          <button
            key={deck.id}
            onClick={() => onSelect(deck)}
            className={`relative overflow-hidden rounded-2xl p-4 text-left bg-gradient-to-br ${deck.gradient} shadow-lg hover:scale-105 transition-all group`}
            style={{ boxShadow: `0 8px 30px ${deck.glow}` }}
          >
            <div className="shimmer absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="text-3xl mb-2">{deck.icon}</div>
            <p className="text-white font-bold text-sm">{deck.name}</p>
            <p className="text-white/60 text-xs mt-0.5">{deck.description}</p>
            <div className="mt-2 flex gap-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                deck.type === 'truth' ? 'bg-white/20 text-white' : 'bg-black/30 text-white/80'
              }`}>
                {deck.type === 'truth' ? '💬 真心话' : '🎯 大冒险'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CARD REVEAL SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function CardRevealScreen({ loser, deck, card, flipped, onFlip, onDone }) {
  const cardHeight = 300;

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-4 page-enter">
      <p className="text-white/50 text-sm mb-6 text-center">
        <span className="text-white font-bold">{loser}</span> 抽到了 {deck?.icon} {deck?.name}
      </p>

      {/* 3D flip card */}
      <div
        className="w-full max-w-sm cursor-pointer mb-6"
        style={{ height: cardHeight }}
        onClick={!flipped ? onFlip : undefined}
      >
        <div className="card-flip-container" style={{ height: cardHeight }}>
          <div className={`card-inner ${flipped ? 'flipped' : ''}`} style={{ height: cardHeight }}>
            {/* Front face */}
            <div className="card-face" style={{ height: cardHeight }}>
              <div
                className={`w-full h-full bg-gradient-to-br ${deck?.gradient} flex flex-col items-center justify-center rounded-3xl border border-white/20 shadow-2xl`}
                style={{ boxShadow: `0 20px 60px ${deck?.glow}` }}
              >
                <div className="text-7xl mb-4 animate-float">{deck?.icon}</div>
                <p className="text-white font-bold text-xl">{deck?.name}</p>
                <p className="text-white/60 text-sm mt-2">点击翻牌 🃏</p>
              </div>
            </div>

            {/* Back face */}
            <div className="card-face card-back-face" style={{ height: cardHeight }}>
              <div
                className={`w-full h-full bg-gradient-to-br from-gray-900 to-gray-800 border-2 flex flex-col items-center justify-center rounded-3xl px-6 text-center`}
                style={{
                  borderColor: deck?.glow?.replace('0.5', '0.8') ?? 'rgba(168,85,247,0.8)',
                  boxShadow: `0 20px 60px ${deck?.glow}, inset 0 0 40px rgba(255,255,255,0.03)`,
                }}
              >
                <div className="text-3xl mb-4">{deck?.icon}</div>
                <p className="text-white text-lg font-semibold leading-snug">{card?.text}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!flipped ? (
        <button
          onClick={onFlip}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg shadow-lg hover:scale-105 transition-all"
        >
          🃏 翻开题卡
        </button>
      ) : (
        <div className="w-full max-w-sm space-y-3 animate-slide-up">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
            <p className="text-white/40 text-xs">
              {deck?.type === 'truth' ? '💬 认真回答，不许撒谎哦~' : '🎯 必须完成，加油！'}
            </p>
          </div>
          <button
            onClick={onDone}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-lg shadow-lg hover:opacity-90 transition-all"
          >
            ✅ 已完成，下一轮 →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HISTORY MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function HistoryModal({ history, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-white/15 rounded-3xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-white font-bold text-base">📋 本局历史记录</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {history.length === 0 ? (
            <p className="text-white/30 text-center py-8 text-sm">还没有记录</p>
          ) : (
            history.map((entry) => (
              <div key={entry.round} className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 bg-purple-500/30 text-purple-300 rounded-full">
                    第 {entry.round} 轮
                  </span>
                  <span className={`text-xs font-medium ${entry.skipped ? 'text-yellow-400' : 'text-red-400'}`}>
                    输家：{entry.loser} {entry.skipped ? '🏃' : ''}
                  </span>
                </div>
                <p className="text-white/50 text-xs mb-1">
                  问题：{entry.question}（A:{entry.voteA.join('、') || '无'} / B:{entry.voteB.join('、') || '无'}）
                </p>
                <p className="text-white/80 text-sm font-medium">
                  {entry.deckName}：{entry.card}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsModal({ gameMode, setGameMode, intensity, setIntensity, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-white/15 rounded-3xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-white font-bold text-base">⚙️ 游戏设置</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-white/50 text-xs mb-3 tracking-wide">游戏模式</p>
            <div className="flex gap-2">
              {[
                { v: 'both', label: '🎭 真心话 + 大冒险' },
                { v: 'truth', label: '💬 纯真心话模式' },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setGameMode(v)}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${
                    gameMode === v
                      ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                      : 'bg-white/10 text-white/50 hover:bg-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-white/50 text-xs mb-3 tracking-wide">题目强度</p>
            <div className="flex gap-2">
              {[
                { v: 'mild', label: '🌸 温和' },
                { v: 'spicy', label: '🔥 刺激' },
                { v: 'random', label: '🎲 随机混合' },
              ].map(({ v, label }) => (
                <button
                  key={v}
                  onClick={() => setIntensity(v)}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${
                    intensity === v
                      ? 'bg-pink-600 text-white shadow-lg shadow-pink-500/30'
                      : 'bg-white/10 text-white/50 hover:bg-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-white/10 text-white/70 font-medium hover:bg-white/20 transition-all"
          >
            保存并关闭
          </button>
        </div>
      </div>
    </div>
  );
}
