// Compile-time examples check the Paris wire contracts, including rejected shapes.
import type {
  ScoreSubmission,
  VerifiedSessionSubmission,
  CollectPlacement,
  CollectTradeProposal,
  CollectMarketListing,
  CollectGame,
  ExplorerProgressPayload,
  SiteReportSubmission,
} from "./api";
export const session = {
  mode: "arrondissement",
  gameType: "classique",
  arrondissementName: "11e arrondissement",
  availableNames: ["Rue Oberkampf"],
} satisfies VerifiedSessionSubmission;
export const score = {
  mode: "arrondissement",
  gameType: "classique",
  score: 10,
  itemsCorrect: 1,
  itemsTotal: 1,
  timeSec: 2,
  arrondissementName: "11e arrondissement",
  sessionId: "00000000-0000-4000-8000-000000000001",
} satisfies ScoreSubmission;
export const placement = {
  answerEntityId: "Rue Oberkampf",
  answerContext: "Quartier de la Folie-Méricourt",
} satisfies CollectPlacement;
export const trade = {
  kind: "direct",
  requestId: "00000000-0000-4000-8000-000000000001",
  receiverId: "12",
  offeredIds: ["31"],
  requestedIds: ["40"],
} satisfies CollectTradeProposal;
export const listing = {
  kind: "market",
  requestId: "00000000-0000-4000-8000-000000000001",
  offeredIds: ["31"],
  wanted: [{ cardId: "40", quantity: 1 }],
} satisfies CollectMarketListing;
export const game = {
  gameId: "00000000-0000-4000-8000-000000000001",
  maxAttempts: 2,
  guesses: [],
  card: {
    family: "street",
    name: "Rue Oberkampf",
    imageReference: "/data/example.jpg",
    imageAttribution: {
      source: "panoramax",
      author: "Photographe",
      sourcePage: "https://api.panoramax.xyz/",
      license: "CC-BY-SA-4.0",
    },
  },
  quota: { copies: 0, limit: 4, windowMinutes: 20, nextAvailableAt: null },
} satisfies CollectGame;
export const progress = {
  progress: [
    {
      riddle_id: 1,
      started_at: "2026-10-24T10:00:00Z",
      solved_at: "2026-10-24T10:05:00Z",
      hints_used: 1,
      points_earned: 85,
      walking_time_seconds: 300,
      solution: {
        street_name_clean: "Rue Oberkampf",
        explanation_text: "Explication",
        source_url: "https://example.test/",
      },
    },
  ],
  profile: { completed: false, solved_count: 1 },
} satisfies ExplorerProgressPayload;
export const report = {
  domain: "collect",
  entity_key: "street:Rue Oberkampf",
  category: "image",
  detail: "Photographie à contrôler.",
} satisfies SiteReportSubmission;
// @ts-expect-error A ranked score cannot omit its server-verified session.
export const missingSession: ScoreSubmission = {
  mode: "ville",
  gameType: "classique",
  score: 10,
  itemsCorrect: 1,
  itemsTotal: 1,
  timeSec: 2,
};
export const lecture: VerifiedSessionSubmission = {
  ...session,
  // @ts-expect-error Lecture is a practice mode, not a ranked session.
  gameType: "lecture",
};
export const marseille: VerifiedSessionSubmission = {
  ...session,
  // @ts-expect-error The Paris boundary uses arrondissementName.
  quartierName: "Noailles",
};
// @ts-expect-error A card database identifier cannot replace a canonical map entity key.
export const incorrectTarget: CollectPlacement = { answerEntityId: 42 };
export const incorrectCopy: CollectMarketListing = {
  ...listing,
  // @ts-expect-error Card identifiers are numeric ids, not street labels.
  offeredIds: ["Rue Oberkampf"],
};
export const reportDomain: SiteReportSubmission = {
  ...report,
  // @ts-expect-error Unknown report domains cannot be submitted.
  domain: "invented",
};
