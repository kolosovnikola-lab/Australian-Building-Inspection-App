import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewClientExplanation } from './client-explanation-review.ts';

test('concise client wording has no advisory warnings', () => {
  assert.deepEqual(
    reviewClientExplanation('Water is getting in near the window. A builder should inspect the seal.'),
    [],
  );
});

test('controlled technical terms produce advisory suggestions', () => {
  const warnings = reviewClientExplanation(
    'Efflorescence is visible on the substrate after moisture ingress.',
  );
  assert.deepEqual(
    warnings.map((warning) => warning.term),
    ['efflorescence', 'moisture ingress', 'substrate'],
  );
});

test('long sentences are flagged without blocking the wording', () => {
  const explanation = 'This is a deliberately long client explanation that describes the visible condition, the likely path for water entry, the possible impact on nearby materials, and the recommended next step so the client can understand what was observed and what should happen next.';
  const warnings = reviewClientExplanation(explanation);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'long_sentence');
  assert.match(warnings[0].message, /splitting it into shorter sentences/);
});