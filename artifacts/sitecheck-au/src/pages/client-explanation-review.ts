export type ClientExplanationWarning = {
  kind: 'long_sentence' | 'technical_term';
  message: string;
  term?: string;
};

export type ClientLanguageGlossaryTerm = {
  term: string;
  suggestedMeaning: string;
};

export const DEFAULT_CLIENT_LANGUAGE_GLOSSARY: ClientLanguageGlossaryTerm[] = [
  { term: 'efflorescence', suggestedMeaning: 'salt deposits' },
  { term: 'capillary', suggestedMeaning: 'water moving through tiny gaps' },
  { term: 'delamination', suggestedMeaning: 'a surface layer separating' },
  { term: 'differential movement', suggestedMeaning: 'different parts moving by different amounts' },
  { term: 'hydrostatic', suggestedMeaning: 'water pressure' },
  { term: 'moisture ingress', suggestedMeaning: 'water getting in' },
  { term: 'non-compliant', suggestedMeaning: 'not meeting the stated requirement' },
  { term: 'spalling', suggestedMeaning: 'surface material breaking away' },
  { term: 'substrate', suggestedMeaning: 'the underlying surface' },
  { term: 'subfloor', suggestedMeaning: 'the floor structure underneath' },
];

const MAX_PLAIN_LANGUAGE_SENTENCE_WORDS = 28;

export function reviewClientExplanation(
  explanation: string | null | undefined,
  glossary: ClientLanguageGlossaryTerm[] = DEFAULT_CLIENT_LANGUAGE_GLOSSARY,
) {
  const text = explanation?.trim() ?? '';
  if (!text) return [] as ClientExplanationWarning[];

  const warnings: ClientExplanationWarning[] = [];
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  for (const sentence of sentences) {
    const wordCount = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > MAX_PLAIN_LANGUAGE_SENTENCE_WORDS) {
      warnings.push({
        kind: 'long_sentence',
        message: `This sentence has ${wordCount} words. Consider splitting it into shorter sentences.`,
      });
    }
  }

  for (const { term, suggestedMeaning: plainMeaning } of glossary) {
    if (new RegExp(`\\b${term.replaceAll(' ', '\\s+')}\\b`, 'i').test(text)) {
      warnings.push({
        kind: 'technical_term',
        term,
        message: `Consider explaining “${term}” in simpler words, such as “${plainMeaning}”.`,
      });
    }
  }
  return warnings;
}