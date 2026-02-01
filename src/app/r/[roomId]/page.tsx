"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { deleteField } from "firebase/firestore";
import { CopyBox } from "@/components/CopyBox";
import {
  joinAsPlayer,
  judgeFinal,
  judgeSubmission,
  patchRoomIfHost,
  removePlayer,
  resetAllScores,
  submitAnswer,
  submitFinalAnswer,
  submitWager,
  subscribeFinalAnswers,
  subscribePlayers,
  subscribeRoom,
  subscribeSubmissions,
  subscribeWagers
} from "@/lib/room";
import { clamp, safeTrim } from "@/lib/util";
import { FinalAnswer, Player, Room, Submission, Wager } from "@/lib/types";

// ==================== Theme Toggle ====================
function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("trivia_theme") as "dark" | "light" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle("light", saved === "light");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("trivia_theme", next);
    document.documentElement.classList.toggle("light", next === "light");
  };

  return { theme, toggleTheme };
}

// ==================== Toast System ====================
type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

function Toast({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 2500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const bgColor = toast.type === "success" ? "#4ecdc4" : toast.type === "error" ? "#ff6b6b" : "#8ab4ff";

  return (
    <div
      style={{
        padding: "12px 16px",
        background: bgColor,
        color: "#000",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 14,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        animation: "slideInRight 0.3s ease-out",
        cursor: "pointer",
        minWidth: 200,
        maxWidth: 400,
      }}
      onClick={() => onDismiss(toast.id)}
    >
      {toast.message}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}

// ==================== Hooks ====================
function useLocalId(key: string) {
  const [id, setId] = useState<string>("");
  useEffect(() => {
    const existing = localStorage.getItem(key);
    if (existing) {
      setId(existing);
    } else {
      const generated = crypto.randomUUID();
      localStorage.setItem(key, generated);
      setId(generated);
    }
  }, [key]);
  return id;
}

function useConnectionStatus() {
  const [status, setStatus] = useState<"connected" | "disconnected" | "reconnecting">("connected");

  useEffect(() => {
    const handleOnline = () => setStatus("connected");
    const handleOffline = () => setStatus("disconnected");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return status;
}

function useNotificationSound() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("trivia_sound") === "true";
    setEnabled(saved);
  }, []);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("trivia_sound", String(next));
  };

  const play = useCallback(() => {
    if (!enabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }, [enabled]);

  const vibrate = useCallback(() => {
    if (!enabled) return;
    try {
      navigator.vibrate?.(200);
    } catch {}
  }, [enabled]);

  return { enabled, toggle, play, vibrate };
}

// ==================== Components ====================
function Spinner() {
  return <span className="spinner" />;
}

function ThemeToggle({ theme, onToggle }: { theme: "dark" | "light"; onToggle: () => void }) {
  return (
    <button className="theme-toggle" onClick={onToggle} title="Toggle theme">
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

function Timer({ remaining, showWarning = true }: { remaining: number | null; showWarning?: boolean }) {
  if (remaining === null || remaining <= 0) return null;

  const className = showWarning && remaining <= 5 ? "timer-critical" : showWarning && remaining <= 10 ? "timer-warning" : "";

  return (
    <span className={className} style={{ marginLeft: 8, fontWeight: 700 }}>
      ⏱ {remaining}s
    </span>
  );
}

function WaitingIndicator({ players, submissions }: { players: Player[]; submissions: Submission[] }) {
  const submittedIds = new Set(submissions.map(s => s.playerId));
  const waiting = players.filter(p => !submittedIds.has(p.id));

  if (waiting.length === 0) return <span className="small" style={{ color: "#4ecdc4" }}>✓ All players answered</span>;

  return (
    <div>
      <span className="small">Waiting on:</span>
      <div className="waiting-list">
        {waiting.map(p => (
          <span key={p.id} className="waiting-chip">{p.name}</span>
        ))}
      </div>
    </div>
  );
}

function ConnectionStatus({ status }: { status: "connected" | "disconnected" | "reconnecting" }) {
  if (status === "connected") return null;

  return (
    <div className={`connection-status ${status}`}>
      {status === "disconnected" ? "⚠️ Connection lost" : "🔄 Reconnecting..."}
    </div>
  );
}

// ==================== Main Page ====================
export default function RoomPage({ params }: { params: { roomId: string } }) {
  const roomId = params.roomId;
  const sp = useSearchParams();
  const hostSecret = sp.get("host") ?? "";

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [allSubs, setAllSubs] = useState<Submission[]>([]);
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [finalAnswers, setFinalAnswers] = useState<FinalAnswer[]>([]);
  const [suddenDeathSubs, setSuddenDeathSubs] = useState<Submission[]>([]);

  const playerId = useLocalId(`trivia_player_${roomId}`);
  const [playerName, setPlayerName] = useState<string>("");
  const [joined, setJoined] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [expandedField, setExpandedField] = useState<{ type: "question" | "answer" | "category"; text: string; questionIndex: number } | null>(null);
  const [showSuddenDeathResults, setShowSuddenDeathResults] = useState(false);
  const [busy, setBusy] = useState(false);

  const { toasts, showToast, dismissToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const connectionStatus = useConnectionStatus();
  const sound = useNotificationSound();

  // Track previous revealed state for notifications
  const [prevRevealed, setPrevRevealed] = useState(false);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribePlayers(roomId, setPlayers), [roomId]);
  useEffect(() => {
    if (!room) return;
    return subscribeSubmissions(roomId, room.currentIndex, setSubs);
  }, [roomId, room?.currentIndex]);
  
  // Subscribe to all submissions for player history
  useEffect(() => {
    return subscribeSubmissions(roomId, -1, setAllSubs);
  }, [roomId]);
  
  useEffect(() => subscribeWagers(roomId, setWagers), [roomId]);
  useEffect(() => subscribeFinalAnswers(roomId, setFinalAnswers), [roomId]);
  useEffect(() => {
    if (!room || !room.suddenDeath?.active) return;
    return subscribeSubmissions(roomId, 999, setSuddenDeathSubs);
  }, [roomId, room?.suddenDeath?.active]);

  // Notification when question is revealed
  useEffect(() => {
    if (room?.revealed && !prevRevealed && !isHost) {
      sound.play();
      sound.vibrate();
    }
    setPrevRevealed(room?.revealed ?? false);
  }, [room?.revealed, prevRevealed, sound]);

  const isHost = useMemo(() => !!(room && hostSecret && room.hostSecret === hostSecret), [room, hostSecret]);

  const allFinalAnswersJudged = useMemo(() => {
    if (!finalAnswers.length || !players.length) return false;
    const playersWithAnswers = finalAnswers.filter(a => a.judged !== null);
    return playersWithAnswers.length === players.length || (finalAnswers.length > 0 && finalAnswers.every(a => a.judged !== null));
  }, [finalAnswers, players]);

  const leaders = useMemo(() => {
    if (!players.length) return [];
    const maxScore = Math.max(...players.map(p => p.score));
    return players.filter(p => p.score === maxScore);
  }, [players]);

  const suddenDeathWinner = useMemo(() => {
    if (!room?.suddenDeath?.active || !suddenDeathSubs.length) return null;
    const winningSubmission = suddenDeathSubs.find(s => s.judged === true);
    if (!winningSubmission) return null;
    return players.find(p => p.id === winningSubmission.playerId) || null;
  }, [room, suddenDeathSubs, players]);

  useEffect(() => {
    if (suddenDeathWinner && !showSuddenDeathResults) {
      setShowSuddenDeathResults(true);
    }
  }, [suddenDeathWinner, showSuddenDeathResults]);

  // Timer with audio warnings
  useEffect(() => {
    if (!room || !room.revealed || !room.acceptingAnswers || !room.revealedAt) {
      setTimeRemaining(null);
      return;
    }

    const revealTime = room.revealedAt.toMillis ? room.revealedAt.toMillis() : room.revealedAt;
    let lastWarning = 0;

    const interval = setInterval(() => {
      const elapsed = Date.now() - revealTime;
      const remaining = Math.max(0, 30 - Math.floor(elapsed / 1000));
      setTimeRemaining(remaining);

      // Audio warnings at 10s and 5s
      if (remaining === 10 && lastWarning !== 10) {
        lastWarning = 10;
        sound.play();
      } else if (remaining === 5 && lastWarning !== 5) {
        lastWarning = 5;
        sound.play();
        sound.vibrate();
      }

      if (remaining === 0 && room.acceptingAnswers && isHost) {
        patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, roomId, hostSecret, isHost, sound]);

  const me = useMemo(() => players.find((p) => p.id === playerId) ?? null, [players, playerId]);
  const currentQ = useMemo(() => room?.questions?.[room?.currentIndex ?? 0] ?? null, [room]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const joinLink = origin ? `${origin}/r/${roomId}` : `/r/${roomId}`;
  const hostLink = origin && room ? `${origin}/r/${roomId}?host=${room.hostSecret}` : "";

  if (!room) {
    return (
      <div className="card">
        <div className="h2">Loading…</div>
        <div className="small">If this never loads, the room code may be wrong.</div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Toast notifications */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 3000, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>

      {/* Connection status */}
      <ConnectionStatus status={connectionStatus} />

      {/* Header */}
      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="h1">
                <span className="mono">{roomId}</span> — {room.title}
              </div>
              <div className="small">
                Status: {room.status} • Q{room.currentIndex + 1}/10
                <Timer remaining={timeRemaining} />
              </div>
              <div className="small">Mode: {isHost ? "HOST" : "PLAYER"}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="theme-toggle"
                onClick={sound.toggle}
                title={sound.enabled ? "Disable sounds" : "Enable sounds"}
              >
                {sound.enabled ? "🔔" : "🔕"}
              </button>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="h2">Leaderboard</div>
          <div className="grid" style={{ gap: 8 }}>
            {[...players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 10)
              .map((p, idx) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    {idx === 0 && p.score > 0 && "👑 "}
                    {p.name}
                    {p.id === playerId && " (you)"}
                  </div>
                  <div className="mono">{p.score}</div>
                </div>
              ))}
            {players.length === 0 && <div className="small">No players yet</div>}
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="row">
        <CopyBox label="Invite link" value={joinLink} />
        {isHost && hostLink && <HostLinkCollapsible hostLink={hostLink} />}
      </div>

      {/* Main content */}
      {room.status === "ended" && !isHost ? (
        <ResultsView players={players} me={me} />
      ) : isHost ? (
        <HostView
          roomId={roomId}
          room={room}
          hostSecret={hostSecret}
          players={players}
          subs={subs}
          wagers={wagers}
          finalAnswers={finalAnswers}
          suddenDeathSubs={suddenDeathSubs}
          allFinalAnswersJudged={allFinalAnswersJudged}
          leaders={leaders}
          expandedField={expandedField}
          setExpandedField={setExpandedField}
          showToast={showToast}
          busy={busy}
          setBusy={setBusy}
        />
      ) : (
        <PlayerView
          roomId={roomId}
          room={room}
          playerId={playerId}
          me={me}
          playerName={playerName}
          setPlayerName={setPlayerName}
          joined={joined}
          setJoined={setJoined}
          expandedField={expandedField}
          setExpandedField={setExpandedField}
          showToast={showToast}
          allSubs={allSubs}
          timeRemaining={timeRemaining}
        />
      )}

      {/* Expanded field modal */}
      {expandedField && (
        <ExpandedFieldModal
          expandedField={expandedField}
          setExpandedField={setExpandedField}
          room={room}
        />
      )}

      {/* Sudden death results modal */}
      {showSuddenDeathResults && suddenDeathWinner && (
        <SuddenDeathResultsModal
          players={players}
          suddenDeathWinner={suddenDeathWinner}
          isHost={isHost}
          roomId={roomId}
          hostSecret={hostSecret}
          room={room}
          busy={busy}
          setBusy={setBusy}
          setShowSuddenDeathResults={setShowSuddenDeathResults}
        />
      )}
    </div>
  );
}

// ==================== Host Link Collapsible ====================
function HostLinkCollapsible({ hostLink }: { hostLink: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card" style={{ flex: 1 }}>
      <div
        className="collapsible-header small"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? "▼" : "▶"}</span>
        <span>Host link (keep private)</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          <CopyBox label="" value={hostLink} />
        </div>
      )}
    </div>
  );
}

// ==================== Expanded Field Modal ====================
function ExpandedFieldModal({
  expandedField,
  setExpandedField,
  room
}: {
  expandedField: { type: "question" | "answer" | "category"; text: string; questionIndex: number };
  setExpandedField: (field: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null) => void;
  room: Room;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20
      }}
      onClick={() => setExpandedField(null)}
    >
      <div
        className="card"
        style={{
          maxWidth: 600,
          maxHeight: "80vh",
          overflow: "auto",
          animation: "fadeIn 0.2s ease-in"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="h2" style={{ textTransform: "capitalize", margin: 0 }}>
            Q{expandedField.questionIndex + 1} - {expandedField.type}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btnSecondary"
              style={{ padding: "6px 12px" }}
              disabled={expandedField.questionIndex === 0}
              onClick={(e) => {
                e.stopPropagation();
                const prevIndex = expandedField.questionIndex - 1;
                const prevQ = room?.questions[prevIndex];
                if (prevQ) {
                  const fieldValue = expandedField.type === "question" ? prevQ.question : expandedField.type === "answer" ? prevQ.answer : prevQ.category || "";
                  setExpandedField({ type: expandedField.type, text: fieldValue, questionIndex: prevIndex });
                }
              }}
            >
              ← Prev
            </button>
            <button
              className="btn btnSecondary"
              style={{ padding: "6px 12px" }}
              disabled={expandedField.questionIndex === 9}
              onClick={(e) => {
                e.stopPropagation();
                const nextIndex = expandedField.questionIndex + 1;
                const nextQ = room?.questions[nextIndex];
                if (nextQ) {
                  const fieldValue = expandedField.type === "question" ? nextQ.question : expandedField.type === "answer" ? nextQ.answer : nextQ.category || "";
                  setExpandedField({ type: expandedField.type, text: fieldValue, questionIndex: nextIndex });
                }
              }}
            >
              Next →
            </button>
          </div>
        </div>
        <div className="hr" />
        <div style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {expandedField.text || "(empty)"}
        </div>
        <div className="hr" />
        <button className="btn" onClick={() => setExpandedField(null)} style={{ width: "100%" }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ==================== Sudden Death Results Modal ====================
function SuddenDeathResultsModal({
  players,
  suddenDeathWinner,
  isHost,
  roomId,
  hostSecret,
  room,
  busy,
  setBusy,
  setShowSuddenDeathResults
}: {
  players: Player[];
  suddenDeathWinner: Player;
  isHost: boolean;
  roomId: string;
  hostSecret: string;
  room: Room;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setShowSuddenDeathResults: (b: boolean) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 20,
        animation: "fadeIn 0.3s ease-in"
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 600,
          maxHeight: "85vh",
          overflow: "auto",
          animation: "slideIn 0.4s ease-out"
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          <div className="h1" style={{ color: "#4ecdc4", marginBottom: 10 }}>
            {suddenDeathWinner.name} Wins!
          </div>
          <div className="small">Sudden death tiebreaker complete</div>
        </div>

        <div className="hr" />

        <div className="h2">Final Leaderboard</div>
        <div className="grid" style={{ gap: 12, marginTop: 16 }}>
          {[...players].sort((a, b) => b.score - a.score).map((p, idx) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: p.id === suddenDeathWinner.id ? "rgba(78, 205, 196, 0.15)" : "var(--bg-input)",
                borderRadius: 8,
                border: p.id === suddenDeathWinner.id ? "2px solid #4ecdc4" : "1px solid var(--border-color)"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 700, minWidth: 30, color: idx === 0 ? "#4ecdc4" : "#8ab4ff" }}>
                  #{idx + 1}
                </div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                {p.id === suddenDeathWinner.id && <span style={{ fontSize: 20 }}>👑</span>}
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{p.score}</div>
            </div>
          ))}
        </div>

        <div className="hr" />
        {isHost && (
          <button
            className="btn"
            onClick={async () => {
              setBusy(true);
              try {
                await resetAllScores(roomId, hostSecret);
                const res = await fetch("/api/generate", { method: "POST" });
                const data = await res.json();
                await patchRoomIfHost(roomId, hostSecret, {
                  questions: data.questions,
                  currentIndex: 0,
                  status: "lobby",
                  revealed: false,
                  acceptingAnswers: false,
                  final: { wagersOpen: false, answersOpen: false, revealedAnswer: false },
                  suddenDeath: deleteField() as any
                });
                setShowSuddenDeathResults(false);
              } catch (err) {
                alert(`Error starting new game: ${err}`);
              } finally {
                setBusy(false);
              }
            }}
            style={{ width: "100%" }}
            disabled={busy}
          >
            {busy ? <><Spinner /> Generating...</> : "Start New Game"}
          </button>
        )}
        {!isHost && (
          <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
            Waiting for host to start a new game...
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Results View ====================
function ResultsView({ players, me }: { players: Player[]; me: Player | null }) {
  const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);
  const winner = sortedPlayers[0];
  const myRank = me ? sortedPlayers.findIndex(p => p.id === me.id) + 1 : 0;

  let message = "Better luck next time!";
  let messageColor = "#8ab4ff";

  if (me) {
    if (myRank === 1 && sortedPlayers.filter(p => p.score === winner?.score).length === 1) {
      message = "🎉 Congratulations! You won! 🎉";
      messageColor = "#4ecdc4";
    } else if (me.score === 0) {
      message = "You lost - better luck next time!";
      messageColor = "#ff6b6b";
    }
  }

  return (
    <div className="card">
      <div className="h1" style={{ textAlign: "center", marginBottom: 20 }}>Game Over!</div>

      {me && (
        <div style={{
          padding: 20,
          background: "var(--bg-input)",
          borderRadius: 10,
          marginBottom: 20,
          textAlign: "center",
          fontSize: 20,
          color: messageColor,
          fontWeight: 600
        }}>
          {message}
        </div>
      )}

      <div className="h2">Final Leaderboard</div>
      <div className="hr" />
      <div className="grid" style={{ gap: 12 }}>
        {sortedPlayers.map((p, idx) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: p.id === me?.id ? "rgba(138, 180, 255, 0.1)" : "var(--bg-input)",
              borderRadius: 8,
              border: idx === 0 ? "2px solid #4ecdc4" : "1px solid var(--border-color)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, minWidth: 30, color: idx === 0 ? "#4ecdc4" : "#8ab4ff" }}>
                #{idx + 1}
              </div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              {idx === 0 && <span style={{ fontSize: 20 }}>👑</span>}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{p.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== Host View ====================
function HostView({
  roomId,
  room,
  hostSecret,
  players,
  subs,
  wagers,
  finalAnswers,
  suddenDeathSubs,
  allFinalAnswersJudged,
  leaders,
  expandedField,
  setExpandedField,
  showToast,
  busy,
  setBusy
}: {
  roomId: string;
  room: Room;
  hostSecret: string;
  players: Player[];
  subs: Submission[];
  wagers: Wager[];
  finalAnswers: FinalAnswer[];
  suddenDeathSubs: Submission[];
  allFinalAnswersJudged: boolean;
  leaders: Player[];
  expandedField: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null;
  setExpandedField: (field: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [editingCell, setEditingCell] = useState<{ idx: number; field: "question" | "answer" | "category" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const q = room.questions[room.currentIndex];

  async function generateGame() {
    setBusy(true);
    try {
      const res = await fetch("/api/generate", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await patchRoomIfHost(roomId, hostSecret, {
        questions: data.questions,
        currentIndex: 0,
        status: "lobby",
        revealed: false,
        acceptingAnswers: false,
        final: { wagersOpen: false, answersOpen: false, revealedAnswer: false }
      });
      showToast("New game generated!", "success");
    } catch (err) {
      showToast(`Error: ${err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resetScores() {
    if (!confirm("Reset all player scores to 0?")) return;
    try {
      await resetAllScores(roomId, hostSecret);
      showToast("All scores reset to 0", "success");
    } catch (err) {
      showToast(`Error: ${err}`, "error");
    }
  }

  async function saveInlineEdit() {
    if (!editingCell) return;
    const next = room.questions.map((qq, i) =>
      i === editingCell.idx ? { ...qq, [editingCell.field]: editValue } : qq
    );
    await patchRoomIfHost(roomId, hostSecret, { questions: next });
    showToast(`Q${editingCell.idx + 1} ${editingCell.field} updated`, "success");
    setEditingCell(null);
  }

  async function replaceQuestion(idx: number) {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: idx })
      });
      const data = await res.json();
      if (data.question) {
        const next = room.questions.map((q, i) => i === idx ? { ...data.question, id: String(idx + 1) } : q);
        await patchRoomIfHost(roomId, hostSecret, { questions: next });
        showToast(`Q${idx + 1} replaced`, "success");
      }
    } catch (err) {
      showToast(`Error: ${err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    if (!confirm("End the game and show final results?")) return;
    await patchRoomIfHost(roomId, hostSecret, { status: "ended" });
    showToast("Game ended", "info");
  }

  async function judgeAllSubmissions(correct: boolean) {
    const unjudged = subs.filter(s => s.judged === null);
    if (unjudged.length === 0) {
      showToast("No unjudged submissions", "info");
      return;
    }
    if (!confirm(`Mark all ${unjudged.length} submissions as ${correct ? "correct" : "incorrect"}?`)) return;

    for (const s of unjudged) {
      await judgeSubmission(roomId, hostSecret, s.id, correct);
    }
    showToast(`Marked ${unjudged.length} as ${correct ? "correct (+1)" : "incorrect"}`, "success");
  }

  async function startSuddenDeath() {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: 10 }) });
      const data = await res.json();
      if (data.question) {
        await patchRoomIfHost(roomId, hostSecret, {
          suddenDeath: {
            active: true,
            question: { ...data.question, id: "sudden_death" },
            eligiblePlayerIds: leaders.map(p => p.id),
            revealed: false,
            acceptingAnswers: false
          }
        });
        showToast("Sudden death started!", "success");
      }
    } catch (err) {
      showToast(`Error: ${err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function replaceSuddenDeathQuestion() {
    setBusy(true);
    try {
      const res = await fetch("/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: 10 }) });
      const data = await res.json();
      if (data.question) {
        await patchRoomIfHost(roomId, hostSecret, {
          suddenDeath: { ...room.suddenDeath!, question: { ...data.question, id: "sudden_death" } }
        });
        showToast("Question replaced", "success");
      }
    } catch (err) {
      showToast(`Error: ${err}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const isSuddenDeath = room.suddenDeath?.active;
  const suddenDeathQ = room.suddenDeath?.question;
  const nonFinal = room.currentIndex < 9;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div className="h2">Host Controls</div>
            <div className="small">Generate, edit, reveal, and grade.</div>
          </div>
          <div className="row mobile-stack">
            <button className="btn" disabled={busy} onClick={generateGame}>
              {busy ? <><Spinner /> Generating...</> : "Generate Game (10)"}
            </button>
            <button className="btn btnSecondary" disabled={busy} onClick={resetScores}>
              Reset Scores
            </button>
            <button
              className="btn btnSecondary"
              onClick={() => {
                if (!confirm("Leave this game room?")) return;
                window.location.href = '/';
              }}
            >
              Back to Lobby
            </button>
          </div>
        </div>

        <div className="hr" />

        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div className="pill">
            <span className="mono">Q{room.currentIndex + 1}/10</span>
            <span className="small">{room.status}</span>
          </div>

          <div className="row">
            <button
              className="btn btnSecondary"
              disabled={room.currentIndex === 0}
              onClick={async () => {
                await patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex - 1, revealed: false, acceptingAnswers: false });
                showToast(`Moved to Q${room.currentIndex}`, "info");
              }}
            >
              Prev
            </button>
            <button
              className="btn btnSecondary"
              disabled={room.currentIndex === 9}
              onClick={async () => {
                await patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex + 1, revealed: false, acceptingAnswers: false });
                showToast(`Moved to Q${room.currentIndex + 2}`, "info");
              }}
            >
              Next
            </button>
          </div>
        </div>

        <div className="hr" />

        {/* Questions table with inline editing */}
        <div className="grid" style={{ gap: 10 }}>
          <div className="h3">All Questions <span className="small">(click cell to edit)</span></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Q</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Question</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Answer</th>
                  <th style={{ textAlign: "left", padding: "8px", fontWeight: 600 }}>Category</th>
                  <th style={{ textAlign: "center", padding: "8px", fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {room.questions.map((question, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      backgroundColor: idx === room.currentIndex ? "rgba(31, 111, 235, 0.15)" : "transparent"
                    }}
                  >
                    <td
                      style={{ padding: "8px", minWidth: 40, fontWeight: 600, cursor: "pointer" }}
                      onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}
                    >
                      {idx + 1}
                    </td>
                    <td style={{ padding: "8px", maxWidth: 300 }}>
                      {editingCell?.idx === idx && editingCell?.field === "question" ? (
                        <input
                          className="inline-edit"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveInlineEdit}
                          onKeyDown={(e) => e.key === "Enter" && saveInlineEdit()}
                          autoFocus
                        />
                      ) : (
                        <div
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                          onClick={() => { setEditingCell({ idx, field: "question" }); setEditValue(question.question); }}
                          onDoubleClick={() => setExpandedField({ type: "question", text: question.question, questionIndex: idx })}
                        >
                          {question.question || "(empty)"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", maxWidth: 200 }}>
                      {editingCell?.idx === idx && editingCell?.field === "answer" ? (
                        <input
                          className="inline-edit"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveInlineEdit}
                          onKeyDown={(e) => e.key === "Enter" && saveInlineEdit()}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="mono"
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                          onClick={() => { setEditingCell({ idx, field: "answer" }); setEditValue(question.answer); }}
                        >
                          {question.answer || "(empty)"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", minWidth: 100 }}>
                      {editingCell?.idx === idx && editingCell?.field === "category" ? (
                        <input
                          className="inline-edit"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveInlineEdit}
                          onKeyDown={(e) => e.key === "Enter" && saveInlineEdit()}
                          autoFocus
                        />
                      ) : (
                        <div
                          style={{ cursor: "pointer" }}
                          onClick={() => { setEditingCell({ idx, field: "category" }); setEditValue(question.category || ""); }}
                        >
                          {question.category || "(none)"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        className="btn btnSecondary"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        disabled={busy}
                        onClick={() => replaceQuestion(idx)}
                      >
                        {busy ? <Spinner /> : "Replace"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hr" />

        <div className="row mobile-stack">
          {nonFinal ? (
            <>
              <button
                className="btn"
                onClick={async () => {
                  await patchRoomIfHost(roomId, hostSecret, { status: "question", revealed: true, acceptingAnswers: true, revealedAt: new Date() });
                  showToast("Question revealed - 30s timer started", "success");
                }}
              >
                Reveal + Open (30s)
              </button>
              <button
                className="btn btnSecondary"
                onClick={async () => {
                  await patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false });
                  showToast("Answers closed", "info");
                }}
              >
                Close Answers
              </button>
              <button
                className="btn btnSecondary"
                onClick={async () => {
                  await patchRoomIfHost(roomId, hostSecret, { revealed: false, acceptingAnswers: false });
                  showToast("Question hidden", "info");
                }}
              >
                Hide
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                onClick={async () => {
                  await patchRoomIfHost(roomId, hostSecret, { status: "final_wager", revealed: true, acceptingAnswers: false, final: { ...room.final, wagersOpen: true, answersOpen: false, revealedAnswer: false } });
                  showToast("Final wagers open", "success");
                }}
              >
                Open Final Wagers
              </button>
              <button
                className="btn btnSecondary"
                onClick={async () => {
                  await patchRoomIfHost(roomId, hostSecret, { status: "final_answer", revealedAt: new Date(), acceptingAnswers: true, final: { ...room.final, wagersOpen: false, answersOpen: true } });
                  showToast("Final answers open - 30s", "success");
                }}
              >
                Open Final Answers
              </button>
            </>
          )}
        </div>
      </div>

      {/* Submissions panel */}
      {nonFinal ? (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <div className="h2">Submissions (Q{room.currentIndex + 1})</div>
              <div className="small">Click ✓ or ✗ to judge. Answer: <span className="mono">{q.answer || "(not set)"}</span></div>
            </div>
            <WaitingIndicator players={players} submissions={subs} />
          </div>
          <div className="hr" />

          <div className="grid" style={{ gap: 6 }}>
            {subs.length === 0 && <div className="small">No answers yet.</div>}
            {subs.map((s) => (
              <div key={s.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "var(--bg-input)",
                borderRadius: 6,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, minWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.playerName}
                </div>
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}
                </div>
                <div className="pill small" style={{ minWidth: 50, textAlign: "center" }}>
                  {s.judged === null ? "?" : s.judged ? "+1" : "0"}
                </div>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={s.judged !== null}
                  onClick={async () => {
                    await judgeSubmission(roomId, hostSecret, s.id, true);
                    showToast(`${s.playerName} ✓ +1`, "success");
                  }}
                >
                  ✓
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={s.judged !== null}
                  onClick={async () => {
                    await judgeSubmission(roomId, hostSecret, s.id, false);
                    showToast(`${s.playerName} ✗`, "info");
                  }}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>

          {subs.length > 0 && subs.some(s => s.judged === null) && (
            <>
              <div className="hr" />
              <div className="row">
                <button className="btn" onClick={() => judgeAllSubmissions(true)}>
                  ✓ All Correct
                </button>
                <button className="btn btnSecondary" onClick={() => judgeAllSubmissions(false)}>
                  ✗ All Incorrect
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wagers</div>
            <div className="small">Players wager up to their score.</div>
            <div className="hr" />
            <div className="grid" style={{ gap: 8 }}>
              {players.map((p) => {
                const w = wagers.find((x) => x.playerId === p.id);
                return (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                    <div>{p.name} <span className="small">({p.score})</span></div>
                    <div className="mono">{w ? w.wager : "—"}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="h2">Final Answers</div>
            <div className="small">Answer: <span className="mono">{q.answer || "(not set)"}</span></div>
            <div className="hr" />

            <div className="grid" style={{ gap: 6 }}>
              {finalAnswers.length === 0 && <div className="small">No answers yet.</div>}
              {finalAnswers.map((a) => {
                const w = wagers.find((x) => x.playerId === a.playerId);
                return (
                  <div key={a.playerId} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "var(--bg-input)",
                    borderRadius: 6,
                    fontSize: 14
                  }}>
                    <div style={{ fontWeight: 600, minWidth: 100 }}>{a.playerName}</div>
                    <div style={{ flex: 1 }}>{a.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}</div>
                    <div className="pill small" style={{ minWidth: 70, textAlign: "center" }}>
                      w{w?.wager ?? 0} • {a.judged === null ? "?" : a.judged ? `+${a.pointsDelta}` : `${a.pointsDelta}`}
                    </div>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      disabled={a.judged !== null}
                      onClick={async () => {
                        await judgeFinal(roomId, hostSecret, a.playerId, true);
                        showToast(`${a.playerName} ✓`, "success");
                      }}
                    >
                      ✓
                    </button>
                    <button
                      className="btn btnSecondary"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      disabled={a.judged !== null}
                      onClick={async () => {
                        await judgeFinal(roomId, hostSecret, a.playerId, false);
                        showToast(`${a.playerName} ✗`, "info");
                      }}
                    >
                      ✗
                    </button>
                  </div>
                );
              })}
            </div>

            {allFinalAnswersJudged && (
              <>
                <div className="hr" />
                <div className="row">
                  {leaders.length > 1 && (
                    <button className="btn" disabled={busy || isSuddenDeath} onClick={startSuddenDeath}>
                      {busy ? <Spinner /> : `⚡ Sudden Death (${leaders.length} tied)`}
                    </button>
                  )}
                  <button className="btn btnSecondary" onClick={endGame}>
                    {leaders.length === 1 ? "End Game" : "End (Tie)"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sudden death panel */}
      {isSuddenDeath && suddenDeathQ && (
        <div className="card">
          <div className="h2">⚡ Sudden Death</div>
          <div className="small">First correct answer wins!</div>
          <div className="hr" />

          <div className="row" style={{ marginBottom: 16 }}>
            <span className="small">Eligible:</span>
            {leaders.map(p => <span key={p.id} className="pill">{p.name} ({p.score})</span>)}
          </div>

          <div><strong>Q:</strong> {suddenDeathQ.question}</div>
          <div className="small"><strong>A:</strong> <span className="mono">{suddenDeathQ.answer}</span></div>

          <div className="hr" />
          <div className="row">
            <button
              className="btn"
              onClick={() => patchRoomIfHost(roomId, hostSecret, { suddenDeath: { ...room.suddenDeath!, revealed: true, acceptingAnswers: true } })}
              disabled={room.suddenDeath?.revealed}
            >
              Reveal + Open
            </button>
            <button
              className="btn btnSecondary"
              onClick={() => patchRoomIfHost(roomId, hostSecret, { suddenDeath: { ...room.suddenDeath!, acceptingAnswers: false } })}
            >
              Close
            </button>
            <button
              className="btn btnSecondary"
              disabled={busy || room.suddenDeath?.acceptingAnswers}
              onClick={replaceSuddenDeathQuestion}
            >
              {busy ? <Spinner /> : "Replace Q"}
            </button>
          </div>

          <div className="hr" />
          <div className="h3">Submissions</div>
          <div className="grid" style={{ gap: 6 }}>
            {suddenDeathSubs.length === 0 && <div className="small">No answers yet.</div>}
            {suddenDeathSubs.map((s) => (
              <div key={s.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "var(--bg-input)",
                borderRadius: 6,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, minWidth: 100 }}>{s.playerName}</div>
                <div style={{ flex: 1 }}>{s.answer}</div>
                <div className="pill small">{s.judged === null ? "?" : s.judged ? "WIN" : "✗"}</div>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={s.judged !== null}
                  onClick={async () => {
                    await judgeSubmission(roomId, hostSecret, s.id, true);
                    showToast(`${s.playerName} wins!`, "success");
                  }}
                >
                  ✓
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={s.judged !== null}
                  onClick={async () => {
                    await judgeSubmission(roomId, hostSecret, s.id, false);
                    showToast(`${s.playerName} ✗`, "info");
                  }}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== Player View ====================
function PlayerView({
  roomId,
  room,
  playerId,
  me,
  playerName,
  setPlayerName,
  joined,
  setJoined,
  expandedField,
  setExpandedField,
  showToast,
  allSubs,
  timeRemaining
}: {
  roomId: string;
  room: Room;
  playerId: string;
  me: Player | null;
  playerName: string;
  setPlayerName: (s: string) => void;
  joined: boolean;
  setJoined: (b: boolean) => void;
  expandedField: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null;
  setExpandedField: (field: { type: "question" | "answer" | "category"; text: string; questionIndex: number } | null) => void;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  allSubs: Submission[];
  timeRemaining: number | null;
}) {
  const [answer, setAnswer] = useState("");
  const [wager, setWager] = useState<number>(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (me) setJoined(true);
  }, [me, setJoined]);

  // Reset submitted state when question changes
  useEffect(() => {
    setSubmitted(false);
    setAnswer("");
  }, [room.currentIndex]);

  const q = room.questions[room.currentIndex];
  const isFinal = room.currentIndex === 9;
  const isSuddenDeath = room.suddenDeath?.active;
  const suddenDeathQ = room.suddenDeath?.question;
  const isEligibleForSuddenDeath = room.suddenDeath?.eligiblePlayerIds.includes(playerId) ?? false;

  const canSeeQuestion = room.revealed;
  const canSeeSuddenDeath = room.suddenDeath?.revealed;
  const canSeeFinalCategory = isFinal && room.final.wagersOpen;
  const canSeeFinalQuestion = isFinal && room.final.answersOpen;
  const showFinalJeopardy = isFinal && (room.final.wagersOpen || room.final.answersOpen);

  // Player's answer history
  const myHistory = useMemo(() => {
    return allSubs
      .filter(s => s.playerId === playerId)
      .sort((a, b) => a.questionIndex - b.questionIndex);
  }, [allSubs, playerId]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Join panel */}
      {!joined && (
        <div className="card">
          <div className="h2">Join as a player</div>
          <div className="small">Pick a name.</div>
          <div className="hr" />
          <input
            className="input"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Your name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && playerName.trim()) {
                joinAsPlayer(roomId, playerId, playerName);
                setJoined(true);
                showToast(`Welcome, ${playerName}!`, "success");
              }
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!playerName.trim()}
              onClick={async () => {
                await joinAsPlayer(roomId, playerId, playerName);
                setJoined(true);
                showToast(`Welcome, ${playerName}!`, "success");
              }}
            >
              Join
            </button>
          </div>
        </div>
      )}

      {/* Player info */}
      {joined && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="h2">{me?.name || playerName}</div>
              <div className="mono" style={{ fontSize: 16 }}>Score: {me?.score ?? 0}</div>
            </div>
            <button
              className="btn btnDanger"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={async () => {
                if (confirm("Leave the game?")) {
                  await removePlayer(roomId, playerId);
                  setJoined(false);
                  localStorage.removeItem(`trivia_player_${roomId}`);
                  showToast("Left game", "info");
                }
              }}
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {/* Question panel */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="h2">Question {room.currentIndex + 1}/10</div>
          {canSeeQuestion && <Timer remaining={timeRemaining} />}
        </div>
        {q.category && (canSeeQuestion || canSeeFinalCategory) && <div className="pill small">{q.category}</div>}
        <div className="hr" />

        {isFinal ? (
          <>
            {canSeeFinalQuestion ? (
              <div style={{ fontSize: 18, lineHeight: 1.4 }}>{q.question}</div>
            ) : canSeeFinalCategory ? (
              <div className="small">Category revealed. Waiting for question…</div>
            ) : (
              <div className="small">Waiting for Final Jeopardy…</div>
            )}
          </>
        ) : (
          <>
            {canSeeQuestion ? (
              <div
                style={{ fontSize: 18, lineHeight: 1.4, cursor: q.question && q.question.length > 100 ? "pointer" : "default" }}
                onClick={() => q.question && q.question.length > 100 && setExpandedField({ type: "question", text: q.question, questionIndex: room.currentIndex })}
              >
                {q.question || "(Host is setting question)"}
                {q.question && q.question.length > 100 && <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 14 }}>🔍</span>}
              </div>
            ) : (
              <div className="small">Waiting for question…</div>
            )}
          </>
        )}
      </div>

      {/* Answer submission */}
      {joined && canSeeQuestion && !isFinal && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="h2">Your Answer</div>
            {submitted && <span className="submitted-badge">✓ Submitted</span>}
          </div>
          <div className="small">Updates until host closes answers.</div>
          <div className="hr" />
          <input
            className="input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer"
            onKeyDown={(e) => {
              if (e.key === "Enter" && room.acceptingAnswers) {
                submitAnswer(roomId, playerId, me?.name || playerName || "Player", room.currentIndex, answer);
                setSubmitted(true);
                showToast("Submitted!", "success");
              }
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!room.acceptingAnswers}
              onClick={async () => {
                await submitAnswer(roomId, playerId, me?.name || playerName || "Player", room.currentIndex, answer);
                setSubmitted(true);
                showToast("Submitted!", "success");
              }}
            >
              {room.acceptingAnswers ? (submitted ? "Update" : "Submit") : "Closed"}
            </button>
          </div>
        </div>
      )}

      {/* Final Jeopardy */}
      {joined && showFinalJeopardy && (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wager</div>
            <div className="small">Wager up to your score ({me?.score ?? 0}).</div>
            <div className="hr" />
            <input
              className="input"
              type="number"
              value={wager}
              onChange={(e) => setWager(Number(e.target.value))}
              min={0}
              max={me?.score ?? 0}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={!room.final.wagersOpen}
                onClick={async () => {
                  const max = me?.score ?? 0;
                  const w = clamp(Math.floor(wager), 0, max);
                  await submitWager(roomId, playerId, me?.name || playerName || "Player", w);
                  showToast(`Wagered ${w}`, "success");
                }}
              >
                {room.final.wagersOpen ? "Submit Wager" : "Wagers Closed"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="h2">Final Answer</div>
            <div className="hr" />
            <input
              className="input"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your final answer"
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={!room.final.answersOpen}
                onClick={async () => {
                  await submitFinalAnswer(roomId, playerId, me?.name || playerName || "Player", answer);
                  showToast("Final answer submitted!", "success");
                }}
              >
                {room.final.answersOpen ? "Submit Final" : "Answers Closed"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sudden death */}
      {isSuddenDeath && joined && (
        <div className="card">
          <div className="h2">⚡ Sudden Death!</div>
          {isEligibleForSuddenDeath ? (
            <div className="small" style={{ color: "#4ecdc4", fontWeight: 600 }}>You're in! First correct wins.</div>
          ) : (
            <div className="small">Watching — only tied leaders play</div>
          )}
          <div className="hr" />

          {canSeeSuddenDeath && suddenDeathQ && (
            <>
              <div style={{ fontSize: 18, lineHeight: 1.4, marginBottom: 16 }}>{suddenDeathQ.question}</div>
              {isEligibleForSuddenDeath && (
                <>
                  <input
                    className="input"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Your answer"
                  />
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      disabled={!room.suddenDeath?.acceptingAnswers}
                      onClick={async () => {
                        await submitAnswer(roomId, playerId, me?.name || playerName || "Player", 999, answer);
                        showToast("Submitted!", "success");
                      }}
                    >
                      {room.suddenDeath?.acceptingAnswers ? "Submit" : "Closed"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {!canSeeSuddenDeath && <div className="small">Waiting for host to reveal…</div>}
        </div>
      )}

      {/* Answer history */}
      {joined && myHistory.length > 0 && (
        <div className="card">
          <div className="h2">Your Answers</div>
          <div className="hr" />
          <div className="answer-history">
            {myHistory.map((s) => (
              <div key={s.id} className="answer-history-item">
                <div>
                  <span className="small">Q{s.questionIndex + 1}:</span> {s.answer || "(blank)"}
                </div>
                <div className={s.judged === null ? "answer-pending" : s.judged ? "answer-correct" : "answer-incorrect"}>
                  {s.judged === null ? "⏳" : s.judged ? "✓ +1" : "✗ 0"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
