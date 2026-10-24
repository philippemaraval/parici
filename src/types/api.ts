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
  gameType: RankedGameType;
  score: number;
  itemsCorrect: number;
  itemsTotal: number;
  timeSec: number;
  arrondissementName?: string | null;
  sessionId: UUID;
}

export interface DailyGuessSubmission {
  date: string;
  answerName: string;
  requestId: UUID;
}

export type UUID = `${string}-${string}-${string}-${string}-${string}`;
export type DatabaseId = number | `${bigint}`;
export type RankedGameType = "classique" | "marathon" | "chrono";
export type ParisMode =
  | "ville"
  | "arrondissement"
  | "arrondissements-ville"
  | "rues-principales"
  | "rues-celebres"
  | "monuments"
  | "lignes-transports-idf";

export interface VerifiedSessionSubmission {
  mode: ParisMode | "main" | "famous";
  gameType: "classique" | "marathon" | "chrono";
  arrondissementName?: string | null;
  challengeCode?: string;
  availableNames: string[];
}

export interface VerifiedSessionAnswer {
  index: number;
  requestId: UUID;
  answerName: string;
}

export interface ExplorerProgress {
  riddle_id: number;
  started_at: string;
  solved_at?: string | null;
  hints_used?: 0 | 1;
  points_earned?: number;
  walking_time_seconds?: number;
  solution?: {
    street_name_clean: string;
    explanation_text: string;
    source_url: string;
  };
}

export type CollectFamily = "street" | "district" | "monument" | "bus";
export type CollectRarity = 1 | 2 | 3 | 4 | 5;

export interface CollectAlbum {
  id: DatabaseId;
  slug: string;
  name: string;
  description: string | null;
  active_card_count: number;
  owned_active_card_count: number;
  progress: number;
  complete: boolean;
}

export interface CollectBadge {
  slug: string;
  name: string;
  description: string;
  earned: boolean;
  earned_at: string | null;
}

export interface CollectProfileStats {
  unique_cards: number;
  active_unique_cards: number;
  total_copies: number;
  daily_copies: number;
  collect_copies: number;
  active_card_count: number;
  attempts: number;
  successes: number;
  duplicates: number;
  success_rate: number | null;
  progress: number;
  albums: CollectAlbum[];
  badges: CollectBadge[];
}

// The public shape intentionally excludes individual copy identifiers and provenance.
export interface PublicCollectCard {
  id: DatabaseId;
  family: CollectFamily;
  collection_number: number;
  name: string | null;
  image_reference: string | null;
  image_thumbnail?: string | null;
  current_rarity: CollectRarity | null;
  status: "active" | "archived";
  copy_count: number;
}

export interface PublicCollectProfile {
  username: string;
  avatar: string;
  collect: CollectProfileStats;
  cards: PublicCollectCard[];
  rarityLabels: Record<CollectRarity, string>;
}

// Social API copy origins never reveal former owners.
export type CollectVisibility = "public" | "friends" | "private";
export type CollectExchangePolicy = "everyone" | "friends" | "nobody";
export interface CollectSocialSettings {
  visibility: CollectVisibility;
  exchanges: CollectExchangePolicy;
  push: boolean;
}
export interface CollectSocialCopy {
  id: DatabaseId;
  source: "collect" | "daily" | "weekly";
  dailyDate: string | null;
  dailyAttemptCount: number | null;
  originAt: string;
  acquiredAt?: string;
  acquisition?: "earned" | "trade";
  locked: boolean;
}
export interface CollectTradeProposal {
  kind: "direct";
  requestId: UUID;
  receiverId: DatabaseId;
  offeredIds: DatabaseId[];
  requestedIds: DatabaseId[];
  parentId?: UUID;
  exact?: boolean;
}
export interface CollectMarketListing {
  kind: "market";
  requestId: UUID;
  offeredIds: DatabaseId[];
  wanted?: Array<{ cardId: DatabaseId; quantity: number }>;
}
export interface CollectCardMarketStatistics {
  circulation: number;
  owners: number;
  trades: number;
  activeOffers: number;
}

export interface VerifiedSession {
  sessionId: UUID;
  targets: string[];
}
export interface VerifiedAnswerResult {
  requestId: UUID;
  target: string;
  correct: boolean;
  timeSec: number;
  points: number;
}
export interface ExplorerRiddle {
  id: DatabaseId;
  riddle_text: string;
  image_url: string;
  revision?: number;
}
export interface ExplorerStep {
  started_at: string;
  hint_used: boolean;
  riddle: ExplorerRiddle;
  hint_text?: string;
}
export interface ExplorerProfile {
  completed: boolean;
  solved_count: number;
  synced_score?: number;
  synced_walking_time_seconds?: number;
  total_score?: number | null;
  total_walking_time_seconds?: number | null;
  completed_at?: string | null;
}
export interface ExplorerProgressPayload {
  progress: ExplorerProgress[];
  profile: ExplorerProfile;
}
export interface CollectQuota {
  copies: number;
  limit: number;
  windowMinutes: number;
  nextAvailableAt: string | null;
}
export interface CollectGame {
  gameId: UUID;
  maxAttempts: number;
  guesses: Array<{
    answerEntityId: string;
    answerName: string;
    correct: boolean;
    feedback: unknown;
  }>;
  card: {
    family: CollectFamily;
    name: string;
    imageReference: string;
    imageAttribution: CollectAttribution | null;
  };
  quota: CollectQuota;
  resumed?: boolean;
}
// Use the Paris canonical entity key, never a copy/card database id, for map placement.
export interface CollectPlacement {
  answerEntityId: string;
  answerContext?: string;
  requestId?: UUID;
}
export interface CollectCollectionPayload {
  cards: PublicCollectCard[];
  total?: number;
  rarityLabels?: Record<CollectRarity, string>;
}
export interface OwnCollectProfileStats extends CollectProfileStats {
  visibility: CollectVisibility;
}
export interface CollectPersonalAlbum {
  id: DatabaseId;
  name: string;
  total: number;
  owned: number;
  earned?: number;
}
export interface SiteReportSubmission {
  domain: "camino" | "daily" | "collect" | "explorer" | "technical";
  entity_key: string;
  category:
    "image" | "description" | "question" | "geography" | "bug" | "other";
  detail: string;
}

export interface CollectAttribution {
  source: string;
  caption?: string | null;
  sourcePage: string | null;
  author: string | null;
  license: string | null;
}
export interface ExplorerStepSubmission {
  riddle_id: DatabaseId;
  ocr_text: string;
  latitude: number;
  longitude: number;
}
