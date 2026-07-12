import { normalizeText } from "./normalize.mjs";

const SAFETY_RULES = [
  { id: "guaranteed-outcome", pattern: /(무조건|100\s*%|반드시)\s*(합격|암기|성공|수익)/i },
  { id: "false-official-claim", pattern: /(공식\s*(인증|제휴|보증)|출제기관\s*공인)/i },
  { id: "medical-cure", pattern: /(완치|치료를\s*보장|약을\s*끊어)/i },
  { id: "financial-guarantee", pattern: /(원금\s*보장|확정\s*수익|손실\s*없는\s*투자)/i },
  { id: "dangerous-instruction", pattern: /(폭발물|독극물|자해|자살)\s*(제조|만드는\s*법|방법|절차)/i },
  { id: "underage-alcohol", pattern: /(미성년자|청소년).{0,20}(음주|술을\s*마시)/i },
];

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/i,
  /\bTBD\b/i,
  /확정\s*필요/,
  /출처\s*필요/,
  /검수\s*필요/,
  /\[citation(?: needed)?\]/i,
];

const TEXT_FIELDS = ["front", "back", "hint", "reading", "example", "exampleMeaning"];

function cardText(card) {
  return TEXT_FIELDS.map((field) => card[field]).filter(Boolean).join("\n");
}

export class QaError extends Error {
  constructor(stage, findings) {
    super(`${stage} QA 실패:\n- ${findings.map((finding) => `${finding.cardId ?? "deck"}: ${finding.rule}`).join("\n- ")}`);
    this.name = "QaError";
    this.stage = stage;
    this.findings = findings;
  }
}

function failIfFindings(stage, findings) {
  if (findings.length > 0) throw new QaError(stage, findings);
  return { stage, passed: true, findingCount: 0 };
}

export function runSafetyQa(cards) {
  const findings = [];
  for (const card of cards) {
    const text = cardText(card);
    for (const rule of SAFETY_RULES) {
      if (rule.pattern.test(text)) findings.push({ cardId: card.id, rule: rule.id });
    }
  }
  return failIfFindings("safety", findings);
}

function compactForCopyCheck(value) {
  return normalizeText(value).toLocaleLowerCase("ko-KR").replace(/[\p{P}\p{S}\s]/gu, "");
}

export function findVerbatimOverlap(candidate, source, minimumCharacters = 80) {
  const candidateText = compactForCopyCheck(candidate);
  const sourceText = compactForCopyCheck(source);
  if (candidateText.length < minimumCharacters || sourceText.length < minimumCharacters) return null;

  if (sourceText.includes(candidateText)) {
    return { characters: candidateText.length, kind: "full-card" };
  }

  for (let start = 0; start <= candidateText.length - minimumCharacters; start += 1) {
    const excerpt = candidateText.slice(start, start + minimumCharacters);
    if (sourceText.includes(excerpt)) return { characters: minimumCharacters, kind: "contiguous-excerpt" };
  }
  return null;
}

export function runCopyrightQa(cards, referenceTexts = []) {
  const findings = [];
  for (const reference of referenceTexts) {
    if (!reference?.id || typeof reference.text !== "string" || typeof reference.allowVerbatim !== "boolean") {
      findings.push({ rule: "invalid-reference-text" });
      continue;
    }
    if (reference.allowVerbatim) continue;

    for (const card of cards) {
      const overlap = findVerbatimOverlap([card.back, card.example, card.exampleMeaning].filter(Boolean).join(" "), reference.text);
      if (overlap !== null) {
        findings.push({ cardId: card.id, rule: `possible-source-copy:${reference.id}:${overlap.characters}` });
      }
    }
  }
  return failIfFindings("copyright", findings);
}

export function runFactualQa(cards, sourceRegistry = []) {
  const findings = [];
  const sources = new Map();
  for (const source of sourceRegistry) {
    if (!source?.id || !source?.uri || !source?.revision) {
      findings.push({ rule: "source-registry-entry-missing-id-uri-or-revision" });
      continue;
    }
    sources.set(source.id, source);
  }

  for (const card of cards) {
    const text = cardText(card);
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(text)) findings.push({ cardId: card.id, rule: "unresolved-placeholder" });
    }
    for (const sourceRef of card.sourceRefs) {
      if (!sources.has(sourceRef)) findings.push({ cardId: card.id, rule: `unknown-source-ref:${sourceRef}` });
    }
  }

  return failIfFindings("factual", findings);
}
