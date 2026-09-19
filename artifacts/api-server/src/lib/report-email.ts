import { ReplitConnectors } from "@replit/connectors-sdk";
import type { ProxyOptions } from "@replit/connectors-sdk";

type ProviderEmail = {
  id?: string;
  last_event?: string;
  message?: string;
  name?: string;
};

type ProviderDomain = {
  name?: string;
  status?: string;
};

class ProviderRequestError extends Error {}

export class ReportEmailSubmissionError extends Error {
  constructor(message: string, readonly ambiguous: boolean) {
    super(message);
    this.name = "ReportEmailSubmissionError";
  }
}

const connectors = new ReplitConnectors();

async function resend<T>(path: string, options?: ProxyOptions): Promise<T> {
  const response = await connectors.proxy("resend", path, options);
  const data = await response.json() as T;
  if (!response.ok) {
    const error = data as ProviderEmail;
    throw new ProviderRequestError(error.message ?? error.name ?? `Email provider returned ${response.status}.`);
  }
  return data;
}

async function senderAddress(): Promise<string> {
  if (process.env.RESEND_FROM_EMAIL?.trim()) return process.env.RESEND_FROM_EMAIL.trim();
  try {
    const result = await resend<{ data?: ProviderDomain[] }>("/domains");
    const domain = result.data?.find((candidate) => candidate.status === "verified" && candidate.name)?.name;
    if (domain) return `SiteCheck AU <reports@${domain}>`;
  } catch {
    // Fall back to the connected account's authorised onboarding address.
  }
  return "SiteCheck AU <onboarding@resend.dev>";
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export async function sendReportEmail(input: {
  to: string;
  recipientType: "client" | "agent";
  clientName: string;
  propertyAddress: string;
  inspectorName: string;
  reportNumber: string;
  reportUrl: string;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  if (process.env.NODE_ENV === "test") return { id: `test-${input.idempotencyKey}` };
  const recipientLabel = input.recipientType === "client" ? input.clientName : "Property agent";
  const subject = `Your SiteCheck report for ${input.propertyAddress}`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f1e8;font-family:Arial,sans-serif;color:#193431">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ded9cc;border-radius:12px;overflow:hidden">
      <tr><td style="background:#254541;padding:26px 32px;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bbd1c7">SiteCheck AU</div><h1 style="margin:8px 0 0;font-size:24px">Your inspection report is ready</h1></td></tr>
      <tr><td style="padding:32px"><p style="margin:0 0 16px">Hello ${escapeHtml(recipientLabel)},</p><p style="margin:0 0 20px;line-height:1.6">The inspection report for <strong>${escapeHtml(input.propertyAddress)}</strong> is ready to view securely online.</p>
        <a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:#254541;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:7px">View inspection report</a>
        <p style="margin:24px 0 0;font-size:12px;color:#66736f">Report ${escapeHtml(input.reportNumber)} · Prepared by ${escapeHtml(input.inspectorName)} · This link is intended for the named recipient.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  const text = `Hello ${recipientLabel},\n\nYour SiteCheck inspection report for ${input.propertyAddress} is ready.\n\nView report: ${input.reportUrl}\n\nReport ${input.reportNumber} · Prepared by ${input.inspectorName}`;
  try {
    const result = await resend<ProviderEmail>("/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ from: await senderAddress(), to: [input.to], subject, html, text }),
    });
    if (!result.id) {
      throw new ReportEmailSubmissionError("The email provider did not return a message ID.", true);
    }
    return { id: result.id };
  } catch (error) {
    if (error instanceof ReportEmailSubmissionError) throw error;
    const message = error instanceof Error ? error.message : "Email delivery failed.";
    throw new ReportEmailSubmissionError(message, !(error instanceof ProviderRequestError));
  }
}

export async function getReportEmailEvent(id: string): Promise<string | undefined> {
  if (process.env.NODE_ENV === "test") return "delivered";
  return (await resend<ProviderEmail>(`/emails/${encodeURIComponent(id)}`)).last_event;
}
