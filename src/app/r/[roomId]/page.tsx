"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CopyBox } from "@/components/CopyBox";
import {
  joinAsPlayer,
  judgeFinal,
  judgeSubmission,
  patchRoomIfHost,
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

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const roomId = params.roomId;
  const sp = useSearchParams();
  const hostSecret = sp.get("host") ?? "";

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [wagers, setWagers] = useState<Wager[]>([]);
  const [finalAnswers, setFinalAnswers] = useState<FinalAnswer[]>([]);

  const playerId = useLocalId(`trivia_player_${roomId}`);
  const [playerName, setPlayerName] = useState<string>("");
  const [joined, setJoined] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribePlayers(roomId, setPlayers), [roomId]);
  useEffect(() => {
    if (!room) return;
    return subscribeSubmissions(roomId, room.currentIndex, setSubs);
  }, [roomId, room]);
  useEffect(() => subscribeWagers(roomId, setWagers), [roomId]);
  useEffect(() => subscribeFinalAnswers(roomId, setFinalAnswers), [roomId]);

  const isHost = useMemo(() => !!room && hostSecret && room.hostSecret === hostSecret, [room, hostSecret]);

  // Timer effect: auto-close answers after 30 seconds
  useEffect(() => {
    if (!room || !room.revealed || !room.acceptingAnswers || !room.revealedAt) {
      setTimeRemaining(null);
      return;
    }

    const revealTime = room.revealedAt.toMillis ? room.revealedAt.toMillis() : room.revealedAt;
    const interval = setInterval(() => {
      const elapsed = Date.now() - revealTime;
      const remaining = Math.max(0, 30 - Math.floor(elapsed / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0 && room.acceptingAnswers && isHost) {
        patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [room, roomId, hostSecret, isHost]);

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
      <div className="row" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="h1">
            <span className="mono">{roomId}</span> — {room.title}
          </div>
          <div className="small">
            Status: {room.status} • Q{room.currentIndex + 1}/10
            {timeRemaining !== null && timeRemaining > 0 && (
              <span style={{ marginLeft: 8, fontWeight: 700, color: timeRemaining <= 10 ? "#ff6b6b" : "#4ecdc4" }}>
                ⏱ {timeRemaining}s
              </span>
            )}
          </div>
          <div className="small">Mode: {isHost ? "HOST" : "PLAYER"}</div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 280 }}>
          <div className="h2">Leaderboard</div>
          <div className="grid" style={{ gap: 8 }}>
            {[...players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 10)
              .map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                  <div>{p.name}</div>
                  <div className="mono">{p.score}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="row">
        <CopyBox label="Invite link" value={joinLink} />
        {isHost && hostLink ? <CopyBox label="Host link (keep private)" value={hostLink} /> : null}
      </div>

      {isHost ? (
        <HostView
          roomId={roomId}
          room={room}
          hostSecret={hostSecret}
          players={players}
          subs={subs}
          wagers={wagers}
          finalAnswers={finalAnswers}
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
        />
      )}
    </div>
  );
}

function HostView({
  roomId,
  room,
  hostSecret,
  players,
  subs,
  wagers,
  finalAnswers
}: {
  roomId: string;
  room: Room;
  hostSecret: string;
  players: Player[];
  subs: Submission[];
  wagers: Wager[];
  finalAnswers: FinalAnswer[];
}) {
  const [busy, setBusy] = useState(false);
  const q = room.questions[room.currentIndex];

  async function generateGame() {
    setBusy(true);
    try {
      const res = await fetch("/api/generate", { method: "POST" });
      const data = await res.json();
      await patchRoomIfHost(roomId, hostSecret, {
        questions: data.questions,
        currentIndex: 0,
        status: "lobby",
        revealed: false,
        acceptingAnswers: false,
        final: { wagersOpen: false, answersOpen: false, revealedAnswer: false }
      });
    } finally {
      setBusy(false);
    }
  }

  async function resetScores() {
    if (!confirm("Reset all player scores to 0?")) return;
    try {
      await resetAllScores(roomId, hostSecret);
    } catch (err) {
      alert(`Error resetting scores: ${err}`);
    }
  }

  async function updateQField(idx: number, field: "question" | "answer" | "category", value: string) {
    const next = room.questions.map((qq, i) => (i === idx ? { ...qq, [field]: value } : qq));
    await patchRoomIfHost(roomId, hostSecret, { questions: next });
  }

  const nonFinal = room.currentIndex < 9;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="h2">Host Controls</div>
            <div className="small">Generate, edit, reveal, and grade.</div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy} onClick={generateGame}>
              Generate Game (10)
            </button>
            <button className="btn" disabled={busy} onClick={resetScores}>
              Reset Scores
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
              onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex - 1, revealed: false, acceptingAnswers: false })}
            >
              Prev
            </button>
            <button
              className="btn btnSecondary"
              disabled={room.currentIndex === 9}
              onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: room.currentIndex + 1, revealed: false, acceptingAnswers: false })}
            >
              Next
            </button>
          </div>
        </div>

        <div className="hr" />

        <div className="grid" style={{ gap: 10 }}>
          <div className="h3">All Questions</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #444" }}>
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
                      borderBottom: "1px solid #333",
                      backgroundColor: idx === room.currentIndex ? "#1e2749" : "transparent"
                    }}
                  >
                    <td style={{ padding: "8px", minWidth: 40, fontWeight: 600, cursor: "pointer" }} onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: "8px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}>
                      {question.question || "(empty)"}
                    </td>
                    <td style={{ padding: "8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}>
                      <span className="mono">{question.answer || "(empty)"}</span>
                    </td>
                    <td style={{ padding: "8px", minWidth: 100, cursor: "pointer" }} onClick={() => patchRoomIfHost(roomId, hostSecret, { currentIndex: idx, revealed: false, acceptingAnswers: false })}>
                      {question.category || "(none)"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        className="btn btnSecondary"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          replaceQuestion(idx);
                        }}
                      >
                        Replace
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hr" />

        <div className="row">
            {nonFinal ? (
              <>
                <button
                  className="btn"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "question", revealed: true, acceptingAnswers: true, revealedAt: new Date() })}
                >
                  Reveal + Open Answers (30s)
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { acceptingAnswers: false })}
                >
                  Close Answers
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { revealed: false, acceptingAnswers: false })}
                >
                  Hide Question
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "final_wager", revealed: true, acceptingAnswers: false, final: { ...room.final, wagersOpen: true, answersOpen: false, revealedAnswer: false } })}
                >
                  Open Final Wagers
                </button>
                <button
                  className="btn btnSecondary"
                  onClick={() => patchRoomIfHost(roomId, hostSecret, { status: "final_answer", revealedAt: new Date(), acceptingAnswers: true, final: { ...room.final, wagersOpen: false, answersOpen: true } })}
                >
                  Open Final Answers (30s)
                </button>
              </>
            )}
          </div>

        <div className="hr" />
      </div>

      {nonFinal ? (
        <div className="card">
          <div className="h2">Submissions (Q{room.currentIndex + 1})</div>
          <div className="small">Tap Correct/Incorrect to score +1 (or 0). Each player can submit once per question.</div>
          <div className="hr" />

          <div className="grid" style={{ gap: 6 }}>
            {subs.length === 0 ? <div className="small">No answers yet.</div> : null}
            {subs.map((s) => (
              <div key={s.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                background: "#0c1323",
                borderRadius: 6,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.playerName}
                </div>
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}
                </div>
                <div className="pill small" style={{ minWidth: 60, textAlign: "center" }}>
                  {s.judged === null ? "?" : s.judged ? "+1" : "0"}
                </div>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, true)}
                >
                  ✓
                </button>
                <button
                  className="btn btnSecondary"
                  style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                  disabled={s.judged !== null}
                  onClick={() => judgeSubmission(roomId, hostSecret, s.id, false)}
                >
                  ✗
                </button>
              </div>
            ))}
          </div>

          <div className="hr" />
          <div className="small">Answer key (host): <span className="mono">{q.answer || "(not set)"}</span></div>
        </div>
      ) : (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wagers</div>
            <div className="small">Players can wager up to their current score.</div>
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
            <div className="small">Score +wager if correct, -wager if incorrect.</div>
            <div className="hr" />

            <div className="grid" style={{ gap: 6 }}>
              {finalAnswers.length === 0 ? <div className="small">No final answers yet.</div> : null}
              {finalAnswers.map((a) => {
                const w = wagers.find((x) => x.playerId === a.playerId);
                return (
                  <div key={a.playerId} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    background: "#0c1323",
                    borderRadius: 6,
                    fontSize: 14
                  }}>
                    <div style={{ fontWeight: 600, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.playerName}
                    </div>
                    <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.answer || <span style={{ opacity: 0.5 }}>(blank)</span>}
                    </div>
                    <div className="pill small" style={{ minWidth: 80, textAlign: "center", whiteSpace: "nowrap" }}>
                      w{w ? w.wager : 0} • {a.judged === null ? "?" : a.judged ? `+${a.pointsDelta}` : `${a.pointsDelta}`}
                    </div>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                      disabled={a.judged !== null}
                      onClick={() => judgeFinal(roomId, hostSecret, a.playerId, true)}
                    >
                      ✓
                    </button>
                    <button
                      className="btn btnSecondary"
                      style={{ fontSize: 12, padding: "4px 12px", minWidth: 70 }}
                      disabled={a.judged !== null}
                      onClick={() => judgeFinal(roomId, hostSecret, a.playerId, false)}
                    >
                      ✗
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="hr" />
            <div className="small">Final answer key (host): <span className="mono">{q.answer || "(not set)"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerView({
  roomId,
  room,
  playerId,
  me,
  playerName,
  setPlayerName,
  joined,
  setJoined
}: {
  roomId: string;
  room: Room;
  playerId: string;
  me: Player | null;
  playerName: string;
  setPlayerName: (s: string) => void;
  joined: boolean;
  setJoined: (b: boolean) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [wager, setWager] = useState<number>(0);

  useEffect(() => {
    if (me) setJoined(true);
  }, [me, setJoined]);

  const q = room.questions[room.currentIndex];
  const isFinal = room.currentIndex === 9;

  const canSeeQuestion = room.revealed;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {!joined ? (
        <div className="card">
          <div className="h2">Join as a player</div>
          <div className="small">Pick a name (shows on the host screen).</div>
          <div className="hr" />
          <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Your name" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!playerName.trim()}
              onClick={async () => {
                await joinAsPlayer(roomId, playerId, playerName);
                setJoined(true);
              }}
            >
              Join
            </button>
          </div>
        </div>
      ) : null}

      {joined ? (
        <div className="card">
          <div className="h2">You</div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>{me?.name}</div>
            <div className="mono">Score: {me?.score ?? 0}</div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="h2">Question {room.currentIndex + 1}/10</div>
        {q.category ? <div className="pill small">{q.category}</div> : null}
        <div className="hr" />
        {canSeeQuestion ? (
          <div style={{ fontSize: 18, lineHeight: 1.4 }}>{q.question || (isFinal ? "Final Jeopardy" : "(Host is editing question)")}</div>
        ) : (
          <div className="small">Waiting for the host to reveal the question…</div>
        )}
      </div>

      {joined && canSeeQuestion && !isFinal ? (
        <div className="card">
          <div className="h2">Submit your answer</div>
          <div className="small">Your answer is sent to the host immediately. You can update it until the host closes answers.</div>
          <div className="hr" />
          <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer" />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={!room.acceptingAnswers}
              onClick={async () => {
                await submitAnswer(roomId, playerId, me?.name || playerName || "Player", room.currentIndex, answer);
              }}
            >
              {room.acceptingAnswers ? "Submit" : "Answers closed"}
            </button>
          </div>
        </div>
      ) : null}

      {joined && canSeeQuestion && isFinal ? (
        <div className="grid grid2">
          <div className="card">
            <div className="h2">Final Wager</div>
            <div className="small">You can wager up to your current score.</div>
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
                }}
              >
                {room.final.wagersOpen ? "Submit wager" : "Wagers closed"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="h2">Final Answer</div>
            <div className="small">Once the host opens final answers, submit yours.</div>
            <div className="hr" />
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your final answer" />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={!room.final.answersOpen}
                onClick={async () => {
                  await submitFinalAnswer(roomId, playerId, me?.name || playerName || "Player", answer);
                }}
              >
                {room.final.answersOpen ? "Submit final answer" : "Final answers closed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
