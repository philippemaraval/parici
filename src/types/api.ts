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
  quartierName?: string | null;
  sessionId?: string;
}

export interface DailyGuessSubmission {
  date: string;
  distanceMeters: number;
  isSuccess: boolean;
  attemptsCount?: number;
}
