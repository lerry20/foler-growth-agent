export interface AnalysisScores {
  problem_relevance: number;
  measurement_intent: number;
  treatment_journey: number;
  conversation_opportunity: number;
  product_intent: number;
}

export interface Analysis {
  problem: string;
  hair_concern: string;
  treatment: string;
  treatment_duration: string;
  intent: "MEASUREMENT" | "UNCERTAINTY" | "TREATMENT_JOURNEY" | "HAIR_PROBLEM" | "PRODUCT_INTENT" | "OTHER";
  foler_relevance: number;
  conversation_opportunity: number;
  conversion_potential: number;
  recommended_action: "IGNORE" | "HELP" | "ENGAGE" | "FOLLOW_UP" | "DM" | "INTRODUCE_FOLER" | "WAITLIST_INVITE";
  should_mention_foler: boolean;
  permission_signal: "NONE" | "PERMISSION_GRANTED" | "INTEREST_EXPRESSED" | "ALREADY_SIGNED_UP" | "DECLINED";
  reason: string;
  suggested_response: string;
  scores: AnalysisScores;
}

export interface AnalysisResult extends Analysis {
  provider: "anthropic" | "heuristic";
  blocked: string[];
}
