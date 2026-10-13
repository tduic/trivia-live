import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeFirestore } from "./helpers/fake-firestore";

const fs = vi.hoisted(() => ({ current: null as any }));
vi.mock("@/lib/firebase", () => ({ db: { fake: true } }));
vi.mock("firebase/firestore", () => {
  const proxy: Record<string, unknown> = {};
  for (const name of [
    "collection", "doc", "getDoc", "onSnapshot", "query", "setDoc", "updateDoc",
    "deleteDoc", "serverTimestamp", "orderBy", "runTransaction", "getDocs",
  ]) {
    proxy[name] = (...args: unknown[]) => fs.current.api[name](...args);
  }
  return proxy;
});

import {
  clearGameData,
  createRoom,
  defaultQuestions,
  getAllPlayers,
  joinAsPlayer,
  judgeFinal,
  judgeSubmission,
  patchRoomIfHost,
  removePlayer,
  resetAllScores,
  submitAnswer,
  submitFinalAnswer,
  submitWager,
  subscribeSubmissions,
} from "@/lib/room";

let f: ReturnType<typeof createFakeFirestore>;
const ROOM = "ABC123";

async function newRoom() {
  const { hostSecret } = await createRoom(ROOM, "Friday Night");
  return hostSecret;
}

beforeEach(() => {
  f = createFakeFirestore();
  fs.current = f;
});

describe("defaultQuestions", () => {
  it("creates 10 blank slots with the final question placeholder last", () => {
    const qs = defaultQuestions();
    expect(qs).toHaveLength(10);
    expect(qs.map((q) => q.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(qs[9].question).toMatch(/Final Jeopardy/);
    expect(qs.slice(0, 9).every((q) => q.question === "" && q.answer === "")).toBe(true);
  });
});

describe("createRoom", () => {
  it("stores a lobby room with a host secret", async () => {
    const secret = await newRoom();
    const room = f.get(`rooms/${ROOM}`)!;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(room).toMatchObject({
      hostSecret: secret,
      status: "lobby",
      title: "Friday Night",
      currentIndex: 0,
      revealed: false,
      acceptingAnswers: false,
      final: { wagersOpen: false, answersOpen: false, revealedAnswer: false },
    });
    expect(room.questions).toHaveLength(10);
  });

  it("defaults and truncates the title", async () => {
    await createRoom("R1", "");
    expect(f.get("rooms/R1")!.title).toBe("Cracked Trivia");
    await createRoom("R2", "x".repeat(100));
    expect(f.get("rooms/R2")!.title).toHaveLength(60);
  });
});

describe("player submissions", () => {
  it("joins with a sanitized name and zero score", async () => {
    await joinAsPlayer(ROOM, "p1", "   ");
    await joinAsPlayer(ROOM, "p2", "A".repeat(50));
    expect(f.get(`rooms/${ROOM}/players/p1`)).toMatchObject({ name: "Player", score: 0 });
    expect(f.get(`rooms/${ROOM}/players/p2`)!.name).toHaveLength(32);
  });

  it("keys answers by question+player so a resubmission overwrites", async () => {
    await submitAnswer(ROOM, "p1", "Ann", 2, "  Paris ");
    await submitAnswer(ROOM, "p1", "Ann", 2, "Lyon");
    expect(f.get(`rooms/${ROOM}/submissions/2_p1`)).toMatchObject({
      answer: "Lyon",
      questionIndex: 2,
      judged: null,
      pointsDelta: 0,
    });
  });

  it("floors and clamps wagers to 0..9999", async () => {
    await submitWager(ROOM, "p1", "Ann", 12.9);
    expect(f.get(`rooms/${ROOM}/wagers/p1`)!.wager).toBe(12);
    await submitWager(ROOM, "p1", "Ann", -5);
    expect(f.get(`rooms/${ROOM}/wagers/p1`)!.wager).toBe(0);
    await submitWager(ROOM, "p1", "Ann", 1e6);
    expect(f.get(`rooms/${ROOM}/wagers/p1`)!.wager).toBe(9999);
  });

  it("filters submissions by question, or returns all with -1", async () => {
    await submitAnswer(ROOM, "p1", "Ann", 0, "a");
    await submitAnswer(ROOM, "p2", "Bob", 1, "b");
    const cb = vi.fn();
    subscribeSubmissions(ROOM, 1, cb);
    expect(cb.mock.calls[0][0].map((s: any) => s.id)).toEqual(["1_p2"]);
    subscribeSubmissions(ROOM, -1, cb);
    expect(cb.mock.calls[1][0]).toHaveLength(2);
  });
});

describe("patchRoomIfHost", () => {
  it("applies a patch only for the host", async () => {
    const secret = await newRoom();
    await patchRoomIfHost(ROOM, secret, { status: "question", currentIndex: 3 });
    expect(f.get(`rooms/${ROOM}`)).toMatchObject({ status: "question", currentIndex: 3 });
    await expect(patchRoomIfHost(ROOM, "wrong", { status: "ended" })).rejects.toThrow("Not host");
    await expect(patchRoomIfHost("NOPE", secret, {})).rejects.toThrow("Room not found");
    expect(f.get(`rooms/${ROOM}`)!.status).toBe("question");
  });
});

describe("judgeSubmission", () => {
  it("awards one point for a correct answer, exactly once", async () => {
    const secret = await newRoom();
    await joinAsPlayer(ROOM, "p1", "Ann");
    await submitAnswer(ROOM, "p1", "Ann", 0, "Paris");

    await judgeSubmission(ROOM, secret, "0_p1", true);
    await judgeSubmission(ROOM, secret, "0_p1", true); // already judged: no-op
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(1);
    expect(f.get(`rooms/${ROOM}/submissions/0_p1`)).toMatchObject({ judged: true, pointsDelta: 1 });
  });

  it("records an incorrect answer without changing the score", async () => {
    const secret = await newRoom();
    await joinAsPlayer(ROOM, "p1", "Ann");
    await submitAnswer(ROOM, "p1", "Ann", 0, "Lyon");
    await judgeSubmission(ROOM, secret, "0_p1", false);
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(0);
    expect(f.get(`rooms/${ROOM}/submissions/0_p1`)).toMatchObject({ judged: false, pointsDelta: 0 });
  });

  it("rejects non-hosts and missing submissions", async () => {
    const secret = await newRoom();
    await submitAnswer(ROOM, "p1", "Ann", 0, "x");
    await expect(judgeSubmission(ROOM, "nope", "0_p1", true)).rejects.toThrow("Not host");
    await expect(judgeSubmission(ROOM, secret, "9_p9", true)).rejects.toThrow("Submission not found");
  });
});

describe("judgeFinal", () => {
  async function setup(score: number, wager?: number) {
    const secret = await newRoom();
    f.put(`rooms/${ROOM}/players/p1`, { name: "Ann", score });
    if (wager !== undefined) await submitWager(ROOM, "p1", "Ann", wager);
    await submitFinalAnswer(ROOM, "p1", "Ann", "Answer");
    return secret;
  }

  it("adds the wager on a correct answer", async () => {
    const secret = await setup(5, 3);
    await judgeFinal(ROOM, secret, "p1", true);
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(8);
    expect(f.get(`rooms/${ROOM}/finalAnswers/p1`)).toMatchObject({ judged: true, pointsDelta: 3 });
  });

  it("subtracts the wager on a wrong answer", async () => {
    const secret = await setup(5, 3);
    await judgeFinal(ROOM, secret, "p1", false);
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(2);
    expect(f.get(`rooms/${ROOM}/finalAnswers/p1`)!.pointsDelta).toBe(-3);
  });

  it("caps the wager at the player's current score", async () => {
    const secret = await setup(4, 9999);
    await judgeFinal(ROOM, secret, "p1", false);
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(0);
  });

  it("treats a missing wager as zero and judges only once", async () => {
    const secret = await setup(6);
    await judgeFinal(ROOM, secret, "p1", true);
    await judgeFinal(ROOM, secret, "p1", false);
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(6);
    expect(f.get(`rooms/${ROOM}/finalAnswers/p1`)).toMatchObject({ judged: true, pointsDelta: 0 });
  });

  it("requires a final answer and host rights", async () => {
    const secret = await newRoom();
    await expect(judgeFinal(ROOM, secret, "ghost", true)).rejects.toThrow("Final answer not found");
    await expect(judgeFinal(ROOM, "bad", "ghost", true)).rejects.toThrow("Not host");
  });
});

describe("resetAllScores / clearGameData / players", () => {
  it("zeros every score and wipes answers, wagers and final answers", async () => {
    const secret = await newRoom();
    f.put(`rooms/${ROOM}/players/p1`, { name: "Ann", score: 4 });
    f.put(`rooms/${ROOM}/players/p2`, { name: "Bob", score: 7 });
    await submitAnswer(ROOM, "p1", "Ann", 0, "a");
    await submitWager(ROOM, "p2", "Bob", 2);
    await submitFinalAnswer(ROOM, "p2", "Bob", "b");

    await resetAllScores(ROOM, secret);

    const players = await getAllPlayers(ROOM);
    expect(players.map((p) => [p.id, p.score])).toEqual([["p1", 0], ["p2", 0]]);
    expect([...f.store.keys()].filter((k) => /submissions|wagers|finalAnswers/.test(k))).toEqual([]);
  });

  it("refuses to reset for a non-host", async () => {
    await newRoom();
    f.put(`rooms/${ROOM}/players/p1`, { name: "Ann", score: 4 });
    await expect(resetAllScores(ROOM, "bad")).rejects.toThrow("Not host");
    expect(f.get(`rooms/${ROOM}/players/p1`)!.score).toBe(4);
  });

  it("clearGameData leaves players and the room intact", async () => {
    await newRoom();
    f.put(`rooms/${ROOM}/players/p1`, { name: "Ann", score: 4 });
    await submitAnswer(ROOM, "p1", "Ann", 0, "a");
    await clearGameData(ROOM);
    expect(f.get(`rooms/${ROOM}`)).toBeDefined();
    expect(f.get(`rooms/${ROOM}/players/p1`)).toBeDefined();
    expect(f.get(`rooms/${ROOM}/submissions/0_p1`)).toBeUndefined();
  });

  it("removes a player", async () => {
    f.put(`rooms/${ROOM}/players/p1`, { name: "Ann", score: 0 });
    await removePlayer(ROOM, "p1");
    expect(await getAllPlayers(ROOM)).toEqual([]);
  });
});
