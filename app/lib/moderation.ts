export const REPORT_REASONS = [
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence, gore or self-harm" },
  { value: "hate", label: "Hate speech or harassment" },
  { value: "illegal", label: "Illegal or prohibited goods" },
  { value: "scam", label: "Scam, fraud or counterfeit" },
  { value: "ip", label: "Stolen image / copyright" },
  { value: "other", label: "Something else" },
] as const;

export const REPORT_REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label])) as Record<
  string,
  string
>;
