import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStoredTranslations,
  translateApprovedExplanations,
} from "./report-translation.ts";

test("English summary translations preserve approved wording without an AI call", async () => {
  const approved = [{ id: 4, text: "Water may enter near the window." }];
  const translated = await translateApprovedExplanations("en", approved);
  assert.deepEqual(translated, approved);
  assert.notEqual(translated, approved);
});

test("stored translations reject malformed or incomplete payloads", () => {
  assert.deepEqual(
    parseStoredTranslations(JSON.stringify([{ id: 4, text: "Eau près de la fenêtre." }])),
    [{ id: 4, text: "Eau près de la fenêtre." }],
  );
  assert.throws(
    () => parseStoredTranslations(JSON.stringify([{ id: 4, text: "" }])),
    /invalid/,
  );
});