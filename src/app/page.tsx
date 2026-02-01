"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { randomCode } from "@/lib/util";
import { createRoom } from "@/lib/room";

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

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("Cracked Trivia");
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <div style={{ minHeight: "100vh", padding: 20 }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {/* Header */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div className="h1" style={{ margin: 0 }}>🎯 Trivia Live</div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>

        <div className="grid grid2">
          <div className="card">
            <div className="h2">Host a Game</div>
            <div className="small" style={{ marginBottom: 16 }}>
              Create a new trivia room and invite friends
            </div>

            <label className="small" style={{ display: "block", marginBottom: 4 }}>Game title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a title"
            />

            <button
              className="btn"
              style={{ width: "100%", marginTop: 12 }}
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                try {
                  const roomId = randomCode(6);
                  const { hostSecret } = await createRoom(roomId, title);
                  router.push(`/r/${roomId}?host=${hostSecret}`);
                } catch (err) {
                  alert(`Error creating room: ${err}`);
                  setCreating(false);
                }
              }}
            >
              {creating ? (
                <>
                  <span className="spinner" style={{ marginRight: 8 }} />
                  Creating...
                </>
              ) : (
                "Create Game"
              )}
            </button>

            <div className="hr" />

            <div className="h2">Join a Game</div>
            <div className="small" style={{ marginBottom: 8 }}>Enter the room code from your host</div>
            <input
              className="input"
              placeholder="ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && joinCode.length >= 4) {
                  router.push(`/r/${joinCode}`);
                }
              }}
            />
            <button
              className="btn btnSecondary"
              style={{ width: "100%", marginTop: 12 }}
              disabled={joinCode.length < 4}
              onClick={() => router.push(`/r/${joinCode}`)}
            >
              Join Game
            </button>
          </div>

          <div className="card">
            <div className="h2">How It Works</div>
            <div className="hr" />
            <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
              <li><strong>Host</strong> creates a room and generates 10 questions via Claude AI</li>
              <li><strong>Host</strong> can edit or replace any question before revealing</li>
              <li><strong>Players</strong> join via invite link on their phones</li>
              <li><strong>Host</strong> reveals each question — 30 second timer to answer</li>
              <li><strong>Host</strong> marks answers correct (+1) or incorrect (0)</li>
              <li><strong>Q10</strong> is Final Jeopardy: wager up to your score!</li>
              <li><strong>Ties</strong> go to sudden death — first correct wins</li>
            </ul>

            <div className="hr" />

            <div className="h3" style={{ marginTop: 0 }}>Tips</div>
            <ul className="small" style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
              <li>Open the host link on a big screen (TV/laptop)</li>
              <li>Players join on their phones with the room code</li>
              <li>Enable sound notifications for countdown warnings</li>
              <li>Questions are 7/10 difficulty; Final Jeopardy is harder</li>
            </ul>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16, textAlign: "center" }}>
          <div className="small">
            Built with Next.js + Firebase + Claude AI •{" "}
            <a href="https://github.com/tduic/trivia-live" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
