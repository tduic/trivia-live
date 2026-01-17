export type Phase = "lobby" | "question" | "final_wager" | "final_answer" | "ended";

export type TriviaQuestion = {
  id: string;
  question: string;
  answer: string;
  category?: string;
};

export type Room = {
  createdAt: any;
  hostSecret: string;
  status: Phase;
  title: string;

  questions: TriviaQuestion[]; // length 10
  currentIndex: number; // 0-9
  revealed: boolean;
  acceptingAnswers: boolean;
  revealedAt?: any; // timestamp when question was revealed

  // Final Jeopardy
  final: {
    wagersOpen: boolean;
    answersOpen: boolean;
    revealedAnswer: boolean;
  };
};

export type Player = {
  id: string;
  name: string;
  score: number;
  joinedAt: any;
};

export type Submission = {
  id: string;
  playerId: string;
  playerName: string;
  questionIndex: number;
  answer: string;
  createdAt: any;
  judged: null | boolean;
  pointsDelta: number; // 0 until judged
};

export type Wager = {
  id: string; // playerId
  playerId: string;
  playerName: string;
  wager: number;
  createdAt: any;
};

export type FinalAnswer = {
  id: string; // playerId
  playerId: string;
  playerName: string;
  answer: string;
  createdAt: any;
  judged: null | boolean;
  pointsDelta: number;
};
