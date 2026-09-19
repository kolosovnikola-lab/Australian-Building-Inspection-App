import { Router, type IRouter } from "express";
import OpenAI from "openai";
import {
  AnalyzeInspectionImageBody,
  AnalyzeInspectionImageResponse,
  GenerateFindingWordingBody,
  GenerateFindingWordingResponse,
} from "@workspace/api-zod";
import { recordWorkspaceUsageEvent } from "../lib/workspace-usage";

const router: IRouter = Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

router.post("/ai/findings/generate", async (req, res): Promise<void> => {
  const body = GenerateFindingWordingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const {
    phrase,
    action,
    length,
    includeTradeRecommendation,
    existingObserved,
    existingRecommendation,
  } = body.data;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 1400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an Australian building and pest inspection writing assistant.
Return JSON only with keys: title, observed, recommendation, clientExplanation.
Write factual, neutral, professional wording based only on the inspector's input.
Never invent measurements, causes, Australian Standards numbers, clauses, legal conclusions, or concealed conditions.
Use "appears" or "may" for uncertain causes. Do not call work non-compliant unless the inspector explicitly supplied that conclusion.
The clientExplanation must be plain English.
Requested length: ${length}.
${includeTradeRecommendation ? "Where appropriate, recommend further inspection or rectification by a suitably qualified or licensed trade." : "Do not add a trade recommendation unless essential for safety."}`,
        },
        {
          role: "user",
          content: JSON.stringify({
            action,
            inspectorPhrase: phrase,
            existingObserved: existingObserved ?? "",
            existingRecommendation: existingRecommendation ?? "",
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("AI returned an empty response");
    }
    const parsed = JSON.parse(content);
    if (req.inspectorUserId && req.workspaceId) {
      await recordWorkspaceUsageEvent(req.workspaceId, "ai_assist");
    }
    res.json(GenerateFindingWordingResponse.parse(parsed));
  } catch (error) {
    req.log?.error({ error }, "Finding wording generation failed");
    res.status(503).json({ error: "AI wording is temporarily unavailable. Your original notes have not been changed." });
  }
});

router.post("/ai/vision/inspect", async (req, res): Promise<void> => {
  const body = AnalyzeInspectionImageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      max_completion_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a cautious visual assistant for Australian building and pest inspectors.
Return JSON only with keys: summary, findings, disclaimer.
findings is an array of at most 6 items with keys: label, category, confidence, locationHint, observation, recommendation, limitation, suggestedSeverity.
Only identify visible conditions in the supplied image. Do not invent measurements, concealed conditions, causes, legal conclusions, Australian Standards, clauses, or compliance outcomes.
Never describe work as compliant or non-compliant. Use neutral language such as "possible", "appears", and "requires inspector verification".
Confidence must be between 0 and 1. category must be one of structural, external, internal, wet_area, roofing, pest, safety, services.
suggestedSeverity must be one of critical, high, medium, low, advisory and is only a triage suggestion.
If the image is unclear or contains no visible issue, return an empty findings array.
The disclaimer must state that camera analysis cannot certify compliance and all suggestions require inspector verification.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                area: body.data.area ?? "",
                inspectorNote: body.data.inspectorNote ?? "",
                task: "Identify visible conditions worth reviewing during this inspection.",
              }),
            },
            {
              type: "image_url",
              image_url: { url: body.data.imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("AI returned an empty response");
    if (req.inspectorUserId && req.workspaceId) {
      await recordWorkspaceUsageEvent(req.workspaceId, "ai_assist");
    }
    res.json(AnalyzeInspectionImageResponse.parse(JSON.parse(content)));
  } catch (error) {
    req.log?.error({ error }, "Inspection image analysis failed");
    res.status(503).json({ error: "Camera analysis is temporarily unavailable. No finding was created." });
  }
});

export default router;