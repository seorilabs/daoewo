import path from "node:path";
import { fileURLToPath } from "node:url";

export const PIPELINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CATALOG_PATH = path.join(PIPELINE_ROOT, "manifests", "v1.json");
export const BACKLOG_PATH = path.join(PIPELINE_ROOT, "backlog", "priority-backlog.json");
export const FIXTURE_ROOT = path.join(PIPELINE_ROOT, "fixtures", "offline");
export const CARD_SCHEMA_PATH = path.join(PIPELINE_ROOT, "schemas", "card.schema.json");
export const CATALOG_SCHEMA_PATH = path.join(PIPELINE_ROOT, "schemas", "catalog.schema.json");
export const P1_AI_BATCH_PLAN_PATH = path.join(PIPELINE_ROOT, "plans", "p1-ai-batch.json");
export const BATCH_RUNS_ROOT = path.join(PIPELINE_ROOT, ".work", "batch-runs");
