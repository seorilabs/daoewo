import path from "node:path";
import { readJson } from "../io.mjs";
import { FIXTURE_ROOT } from "../paths.mjs";

export class OfflineFixtureGenerator {
  constructor(fixtureRoot = FIXTURE_ROOT) {
    this.name = "offline-fixture-v1";
    this.fixtureRoot = fixtureRoot;
  }

  async generate({ deck }) {
    return readJson(path.join(this.fixtureRoot, `${deck.id}.raw.json`));
  }
}
