import { assertBacklog } from "./validation.mjs";

export function prioritizeBacklog(backlog) {
  assertBacklog(backlog);
  const topics = new Map();

  for (const signal of backlog.signals.filter((item) => item.status === "queued")) {
    const current = topics.get(signal.topicKey) ?? {
      topicKey: signal.topicKey,
      topic: signal.topic,
      category: signal.category,
      locale: signal.locale,
      score: 0,
      sourceBreakdown: {},
      signalIds: [],
    };
    const sourceScore =
      signal.signalCount * backlog.scoring[signal.source] +
      signal.proSignalCount * backlog.scoring.proSignalBonus +
      signal.strength * backlog.scoring.strengthScale;

    current.score += sourceScore;
    current.sourceBreakdown[signal.source] = (current.sourceBreakdown[signal.source] ?? 0) + sourceScore;
    current.signalIds.push(signal.id);
    topics.set(signal.topicKey, current);
  }

  const ranked = [...topics.values()].sort((left, right) => right.score - left.score || left.topicKey.localeCompare(right.topicKey));
  return ranked.map((topic, index) => ({
    rank: index + 1,
    ...topic,
    score: Math.round(topic.score * 100) / 100,
    recommendedPriority: topic.score >= 150 ? "P1" : topic.score >= 50 ? "P2" : "P3",
  }));
}
