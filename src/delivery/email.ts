import { Resend } from "resend";
import { config } from "../config.js";
import type { VideoBrief } from "../types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(briefs: VideoBrief[]): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  let rows = "";
  for (let i = 0; i < briefs.length; i++) {
    const b = briefs[i];
    const bestAngle = b.angles[0];
    const sourceCount = b.sources.length;
    const sourceTags = [...new Set(b.sources.map((s) => s.source))].join(", ");

    rows += `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 14px 12px; vertical-align: top; width: 36px; font-size: 13px; color: #999; font-weight: 600;">${i + 1}</td>
      <td style="padding: 14px 0;">
        <div style="font-size: 15px; font-weight: 600; color: #111; margin-bottom: 4px;">${escapeHtml(b.topic)}</div>
        <div style="font-size: 13px; color: #666; margin-bottom: 6px;">${escapeHtml(bestAngle?.title ? `"${bestAngle.title}"` : "")}</div>
        <div style="font-size: 12px; color: #999;">${sourceCount} source${sourceCount !== 1 ? "s" : ""} (${sourceTags}) | ${bestAngle?.format ?? ""} ~${bestAngle?.estimatedBuildTime ?? ""}</div>
      </td>
      <td style="padding: 14px 12px; vertical-align: top; text-align: right; white-space: nowrap;">
        <div style="font-size: 20px; font-weight: 700; color: #111;">${b.scores.composite}</div>
        <div style="font-size: 11px; color: #999;">/10</div>
      </td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; color: #111; background: #fff;">

  <div style="margin-bottom: 20px;">
    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 4px;">YT Idea Crawler</div>
    <div style="font-size: 18px; font-weight: 700;">${briefs.length} ideas — ${date}</div>
  </div>

  <table style="width: 100%; border-collapse: collapse;">
    ${rows}
  </table>

  <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
    Full briefs with angles, hooks, and build projects are in Notion.
  </div>

</body>
</html>`;
}

export async function sendDigest(briefs: VideoBrief[]): Promise<void> {
  if (!config.resendApiKey) {
    throw new Error("RESEND_API_KEY is required. Set it in .env");
  }
  if (!config.digestEmail) {
    throw new Error("DIGEST_EMAIL is required. Set it in .env");
  }

  const resend = new Resend(config.resendApiKey);
  const date = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  console.log(`[Email] Sending digest to ${config.digestEmail}...`);

  const { error } = await resend.emails.send({
    from: "YT Idea Crawler <onboarding@resend.dev>",
    to: config.digestEmail,
    subject: `${briefs.length} ideas — ${date}`,
    html: buildHtml(briefs),
  });

  if (error) {
    throw new Error(`Email failed: ${JSON.stringify(error)}`);
  }

  console.log(`[Email] Digest sent\n`);
}
