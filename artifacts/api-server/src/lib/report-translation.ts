import OpenAI from "openai";

export const REPORT_SUMMARY_LANGUAGES = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  vi: "Vietnamese",
  ar: "Arabic",
} as const;

export type ReportSummaryLanguage = keyof typeof REPORT_SUMMARY_LANGUAGES;
export type ApprovedExplanation = { id: number; text: string };
export type TranslatedExplanation = ApprovedExplanation & { text: string };
export type ReportTranslationTestMode = "deterministic" | "failure" | "malformed";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const reportTranslationNotice =
  "This translation is provided to help with accessibility. The English professional report controls if there is any difference.";

export async function translateApprovedExplanations(
  language: ReportSummaryLanguage,
  explanations: ApprovedExplanation[],
  testMode?: ReportTranslationTestMode,
): Promise<TranslatedExplanation[]> {
  if (language === "en" || explanations.length === 0) {
    return explanations.map((explanation) => ({ ...explanation }));
  }
  if (process.env.NODE_ENV === "test" && testMode === "deterministic") {
    return explanations.map((explanation) => ({
      ...explanation,
      text: `[translated] ${explanation.text}`,
    }));
  }
  if (process.env.NODE_ENV === "test" && testMode === "failure") {
    throw new Error("Deterministic translation failure for test coverage");
  }

  const content = process.env.NODE_ENV === "test" && testMode === "malformed"
    ? JSON.stringify({
      translations: [{ id: explanations[0]?.id, text: "   " }],
    })
    : await (async () => {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.4-mini",
        max_completion_tokens: Math.max(1200, explanations.length * 180),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Translate the inspector-approved plain-language explanations into ${REPORT_SUMMARY_LANGUAGES[language]}.
Return JSON only with this exact shape: {"translations":[{"id":number,"text":string}]}.
Translate only the supplied text. Preserve the meaning, uncertainty, safety advice, numbers, names, and finding IDs. Do not add facts, causes, measurements, legal conclusions, Standards references, or recommendations. Do not translate the IDs. Keep each translation concise and suitable for a building inspection client.`,
          },
          {
            role: "user",
            content: JSON.stringify({ explanations }),
          },
        ],
      });
      return completion.choices[0]?.message?.content;
    })();
  if (!content) throw new Error("Translation returned an empty response");

  const parsed = JSON.parse(content) as {
    translations?: Array<{ id?: unknown; text?: unknown }>;
  };
  const translations = parsed.translations;
  if (!Array.isArray(translations) || translations.length !== explanations.length) {
    throw new Error("Translation returned an incomplete set of explanations");
  }

  const expectedIds = new Set(explanations.map((explanation) => explanation.id));
  const seenIds = new Set<number>();
  const result: TranslatedExplanation[] = [];
  for (const translation of translations) {
    if (
      typeof translation.id !== "number"
      || !Number.isInteger(translation.id)
      || !expectedIds.has(translation.id)
      || seenIds.has(translation.id)
      || typeof translation.text !== "string"
      || translation.text.trim().length === 0
    ) {
      throw new Error("Translation returned invalid finding data");
    }
    seenIds.add(translation.id);
    result.push({ id: translation.id, text: translation.text.trim() });
  }
  if (seenIds.size !== expectedIds.size) {
    throw new Error("Translation did not cover every approved explanation");
  }
  return result;
}

export function parseStoredTranslations(
  value: string | null | undefined,
): TranslatedExplanation[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Stored report translations are invalid");
  return parsed.map((item) => {
    if (
      !item
      || typeof item !== "object"
      || typeof (item as { id?: unknown }).id !== "number"
      || !Number.isInteger((item as { id: number }).id)
      || typeof (item as { text?: unknown }).text !== "string"
      || !(item as { text: string }).text.trim()
    ) {
      throw new Error("Stored report translations are invalid");
    }
    return {
      id: (item as { id: number }).id,
      text: (item as { text: string }).text.trim(),
    };
  });
}