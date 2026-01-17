"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { randomCode } from "@/lib/util";
import { createRoom } from "@/lib/room";

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("Trivia Night");
  const [joinCode, setJoinCode] = useState("");

  return (
    <div className="grid grid2">
      <div className="card">
        <div className="h1">Trivia Live</div>
        <div className="small">Host-controlled trivia • 10 questions • Final Jeopardy wager</div>

        <div className="hr" />

        <div className="small">Game title</div>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />

        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={async () => {
              const roomId = randomCode(6);
              const { hostSecret } = await createRoom(roomId, title);
              router.push(`/r/${roomId}?host=${hostSecret}`);
            }}
          >
            Create New Game (Host)
          </button>
        </div>

        <div className="hr" />

        <div className="small">Join a game</div>
        <input
          className="input"
          placeholder="Room code (e.g., ABC123)"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase().trim())}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn btnSecondary"
            disabled={joinCode.length < 4}
            onClick={() => router.push(`/r/${joinCode}`)}
          >
            Join
          </button>
        </div>
      </div>

      <div className="card">
        <div className="h2">How it works</div>
        <ul className="small">
          <li>Host generates 10 medium questions from OpenAI, then can edit/replace any.</li>
          <li>Host reveals each question; everyone gets it at the same time.</li>
          <li>Players type answers; host marks Correct/Incorrect for +1 point.</li>
          <li>Question 10 is Final Jeopardy: players wager up to their score, then answer.</li>
        </ul>
        <div className="small">Tip: open the host link on one device, and join as a player from another.</div>
      </div>
    </div>
  );
}
