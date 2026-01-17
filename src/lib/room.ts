import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  runTransaction,
  getDocs
} from "firebase/firestore";
import { clamp, randomSecret, safeTrim } from "@/lib/util";
import { FinalAnswer, Player, Room, Submission, TriviaQuestion, Wager } from "@/lib/types";

export function defaultQuestions(): TriviaQuestion[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1),
    question: i === 9 ? "Final Jeopardy (host will set)" : "",
    answer: "",
    category: ""
  }));
}

export async function createRoom(roomId: string, title: string): Promise<{ hostSecret: string }> {
  const hostSecret = randomSecret(32);
  const room: Room = {
    createdAt: serverTimestamp(),
    hostSecret,
    status: "lobby",
    title: safeTrim(title || "Trivia Night", 60),
    questions: defaultQuestions(),
    currentIndex: 0,
    revealed: false,
    acceptingAnswers: false,
    final: { wagersOpen: false, answersOpen: false, revealedAnswer: false }
  };
  await setDoc(doc(db, "rooms", roomId), room as any);
  return { hostSecret };
}

export function subscribeRoom(roomId: string, cb: (room: Room | null) => void) {
  return onSnapshot(doc(db, "rooms", roomId), (snap) => cb((snap.data() as Room) ?? null));
}

export function subscribePlayers(roomId: string, cb: (players: Player[]) => void) {
  const q = query(collection(db, "rooms", roomId, "players"), orderBy("joinedAt", "asc"));
  return onSnapshot(q, (snap) => {
    const players = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Player[];
    cb(players);
  });
}

export function subscribeSubmissions(roomId: string, questionIndex: number, cb: (subs: Submission[]) => void) {
  const q = query(collection(db, "rooms", roomId, "submissions"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const subsAll = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Submission[];
    cb(subsAll.filter((s) => s.questionIndex === questionIndex));
  });
}

export function subscribeWagers(roomId: string, cb: (wagers: Wager[]) => void) {
  const q = query(collection(db, "rooms", roomId, "wagers"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Wager[]));
}

export function subscribeFinalAnswers(roomId: string, cb: (ans: FinalAnswer[]) => void) {
  const q = query(collection(db, "rooms", roomId, "finalAnswers"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FinalAnswer[]));
}

export async function joinAsPlayer(roomId: string, playerId: string, name: string) {
  const ref = doc(db, "rooms", roomId, "players", playerId);
  await setDoc(
    ref,
    { name: safeTrim(name, 32) || "Player", score: 0, joinedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function submitAnswer(roomId: string, playerId: string, playerName: string, questionIndex: number, answer: string) {
  const id = `${questionIndex}_${playerId}`;
  const ref = doc(db, "rooms", roomId, "submissions", id);
  await setDoc(
    ref,
    {
      playerId,
      playerName,
      questionIndex,
      answer: safeTrim(answer, 280),
      createdAt: serverTimestamp(),
      judged: null,
      pointsDelta: 0
    },
    { merge: true }
  );
}

export async function submitWager(roomId: string, playerId: string, playerName: string, wager: number) {
  const ref = doc(db, "rooms", roomId, "wagers", playerId);
  await setDoc(
    ref,
    { playerId, playerName, wager: clamp(Math.floor(wager), 0, 9999), createdAt: serverTimestamp() },
    { merge: true }
  );
}

export async function submitFinalAnswer(roomId: string, playerId: string, playerName: string, answer: string) {
  const ref = doc(db, "rooms", roomId, "finalAnswers", playerId);
  await setDoc(
    ref,
    { playerId, playerName, answer: safeTrim(answer, 280), createdAt: serverTimestamp(), judged: null, pointsDelta: 0 },
    { merge: true }
  );
}

export async function patchRoomIfHost(roomId: string, hostSecret: string, patch: Partial<Room>) {
  const ref = doc(db, "rooms", roomId);
  const snap = await getDoc(ref);
  const room = snap.data() as Room | undefined;
  if (!room) throw new Error("Room not found");
  if (room.hostSecret !== hostSecret) throw new Error("Not host");
  await updateDoc(ref, patch as any);
}

export async function judgeSubmission(roomId: string, hostSecret: string, submissionId: string, correct: boolean) {
  const roomRef = doc(db, "rooms", roomId);
  const subRef = doc(db, "rooms", roomId, "submissions", submissionId);
  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const room = roomSnap.data() as Room | undefined;
    if (!room) throw new Error("Room not found");
    if (room.hostSecret !== hostSecret) throw new Error("Not host");

    const subSnap = await tx.get(subRef);
    if (!subSnap.exists()) throw new Error("Submission not found");
    const sub = subSnap.data() as Submission;
    if (sub.judged !== null) return; // already judged

    const delta = correct ? 1 : 0;
    const playerRef = doc(db, "rooms", roomId, "players", sub.playerId);
    const playerSnap = await tx.get(playerRef);
    if (playerSnap.exists()) {
      const p = playerSnap.data() as any;
      tx.update(playerRef, { score: (p.score ?? 0) + delta });
    }
    tx.update(subRef, { judged: correct, pointsDelta: delta });
  });
}

export async function judgeFinal(roomId: string, hostSecret: string, playerId: string, correct: boolean) {
  const roomRef = doc(db, "rooms", roomId);
  const ansRef = doc(db, "rooms", roomId, "finalAnswers", playerId);
  const wagerRef = doc(db, "rooms", roomId, "wagers", playerId);
  const playerRef = doc(db, "rooms", roomId, "players", playerId);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const room = roomSnap.data() as Room | undefined;
    if (!room) throw new Error("Room not found");
    if (room.hostSecret !== hostSecret) throw new Error("Not host");

    const ansSnap = await tx.get(ansRef);
    if (!ansSnap.exists()) throw new Error("Final answer not found");
    const ans = ansSnap.data() as FinalAnswer;
    if (ans.judged !== null) return;

    const wSnap = await tx.get(wagerRef);
    const w = (wSnap.exists() ? wSnap.data() : { wager: 0 }) as any;

    const pSnap = await tx.get(playerRef);
    const p = (pSnap.exists() ? pSnap.data() : { score: 0 }) as any;
    const wager = clamp(Math.floor(w.wager ?? 0), 0, p.score ?? 0);
    const delta = correct ? wager : -wager;

    tx.update(playerRef, { score: (p.score ?? 0) + delta });
    tx.update(ansRef, { judged: correct, pointsDelta: delta });
  });
}

export async function getAllPlayers(roomId: string): Promise<Player[]> {
  const snap = await getDocs(query(collection(db, "rooms", roomId, "players"), orderBy("joinedAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Player[];
}
