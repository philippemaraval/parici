export interface ApiError {
  error: string;
  code?: string;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  avatar: string;
  role: "player" | "editor" | "admin";
  referralCode?: string | null;
}

export interface ScoreSubmission {
  mode: string;
  gameType: "classique" | "marathon" | "chrono" | "lecture";
  score: number;
  itemsCorrect: number;
  itemsTotal: number;
  timeSec: number;
  arrondissementName?: string | null;
  sessionId?: string;
}

export interface DailyGuessSubmission {
  date: string;
  answerName: string;
  requestId: string;
}
