import { pollAll } from "../src/sources/index.js";
import { dedup } from "../src/dedup/dedup.js";
import { loadRecentTopics, saveTopics } from "../src/dedup/history.js";
import { analyze } from "../src/analysis/analyze.js";
import { scoreAndRank } from "../src/analysis/scoring.js";
import { pushToNotion } from "../src/delivery/notion.js";
import { sendDigest } from "../src/delivery/email.js";
import type { SourceType, VideoBrief } from "../src/types.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: {
    sources?: SourceType[];
    dryRun: boolean;
    noEmail: boolean;
    noNotion: boolean;
  } = {
    dryRun: false,
    noEmail: false,
    noNotion: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--no-email") flags.noEmail = true;
    else if (arg === "--no-notion") flags.noNotion = true;
    else if (arg.startsWith("--sources=")) {
      flags.sources = arg.replace("--sources=", "").split(",") as SourceType[];
    }
  }

  return flags;
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function printBrief(brief: VideoBrief, rank: number) {
  const { scores } = brief;
  const bar = (n: number) => "█".repeat(Math.round(n)) + "░".repeat(10 - Math.round(n));

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  #${rank} │ ${brief.topic}`);
  console.log(`${"─".repeat(60)}`);
  console.log(`  Why now: ${brief.whyNow}`);
  console.log(
    `  Score: ${scores.composite}/10  │  Build ${bar(scores.buildability)} ${scores.buildability}  │  Time ${bar(scores.timeliness)} ${scores.timeliness}  │  Viral ${bar(scores.virality)} ${scores.virality}`
  );
  console.log(`  Tags: ${brief.tags.join(", ")}`);

  console.log(`\n  Sources (${brief.sources.length}):`);
  for (const src of brief.sources) {
    console.log(`    [${src.source}] ${src.title}`);
    console.log(`      "${src.snippet}"`);
    console.log(`      ${src.url}`);
  }

  for (let i = 0; i < brief.angles.length; i++) {
    const angle = brief.angles[i];
    console.log(`\n  Angle ${i + 1}: ${angle.angle}`);
    console.log(`    Title: "${angle.title}"`);
    console.log(`    Hook: ${angle.hook}`);
    console.log(`    Thumbnail: ${angle.thumbnailConcept}`);
    console.log(`    Build: ${angle.buildProject}`);
    console.log(`    Format: ${angle.format} (~${angle.estimatedBuildTime})`);

    for (let j = 0; j < angle.intros.length; j++) {
      console.log(`    Intro ${j + 1}: "${angle.intros[j].intro}"`);
      console.log(`      Payoff: ${angle.intros[j].payoff}`);
    }
  }
}

async function main() {
  const flags = parseArgs();
  const start = Date.now();

  console.log("=".repeat(60));
  console.log("  YT Idea Crawler");
  console.log("=".repeat(60));

  if (flags.dryRun) {
    console.log("  Mode: DRY RUN (signals only, no analysis)\n");
  }

  // 1. Poll sources
  const rawSignals = await pollAll(flags.sources);

  if (rawSignals.length === 0) {
    console.log("No signals found. Exiting.");
    return;
  }

  // 2. Deduplicate
  const { signals, duplicatesRemoved } = await dedup(rawSignals);

  if (signals.length === 0) {
    console.log("All signals were duplicates. Exiting.");
    return;
  }

  // Dry run: just print top signals and exit
  if (flags.dryRun) {
    const sorted = [...signals].sort((a, b) => {
      const aScore =
        (a.engagementMetrics.upvotes ?? 0) + (a.engagementMetrics.stars ?? 0);
      const bScore =
        (b.engagementMetrics.upvotes ?? 0) + (b.engagementMetrics.stars ?? 0);
      return bScore - aScore;
    });

    console.log("=".repeat(60));
    console.log(`  Top ${Math.min(20, sorted.length)} signals (dry run)`);
    console.log("=".repeat(60));

    for (const signal of sorted.slice(0, 20)) {
      const engagement =
        (signal.engagementMetrics.stars ?? 0) > 0
          ? `${signal.engagementMetrics.stars} stars`
          : `${signal.engagementMetrics.upvotes ?? 0} pts`;
      const age = signal.publishedAt
        ? timeSince(new Date(signal.publishedAt))
        : "unknown";
      console.log(
        `\n  [${signal.sourceType}] ${signal.title}\n    ${engagement} | ${age} | ${signal.url}`
      );
    }

    console.log(
      `\n  ${signals.length} signals, ${duplicatesRemoved} dupes removed`
    );
    return;
  }

  // 3. Load recent topics for run-to-run dedup
  const recentTopics = await loadRecentTopics();
  if (recentTopics.length > 0) {
    console.log(
      `[History] ${recentTopics.length} recent topics will be excluded\n`
    );
  }

  // 4. Analyze with Claude
  const rawBriefs = await analyze(signals, recentTopics);

  // 5. Score and rank
  const briefs = scoreAndRank(rawBriefs, signals);

  // 6. Print results
  console.log("\n" + "=".repeat(60));
  console.log(`  ${briefs.length} Video Briefs (ranked by composite score)`);
  console.log("=".repeat(60));

  for (let i = 0; i < briefs.length; i++) {
    printBrief(briefs[i], i + 1);
  }

  // 7. Deliver to Notion
  let notionCreated = 0;
  if (!flags.noNotion) {
    try {
      notionCreated = await pushToNotion(briefs);
    } catch (err) {
      console.error(`[Notion] Failed:`, err);
    }
  } else {
    console.log("[Notion] Skipped (--no-notion)\n");
  }

  // 8. Send email digest
  if (!flags.noEmail) {
    try {
      await sendDigest(briefs);
    } catch (err) {
      console.error(`[Email] Failed:`, err);
    }
  } else {
    console.log("[Email] Skipped (--no-email)\n");
  }

  // 9. Save topics to history
  await saveTopics(briefs);

  // 10. Summary
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const bySource = new Map<string, number>();
  for (const s of signals) {
    bySource.set(s.sourceType, (bySource.get(s.sourceType) ?? 0) + 1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Summary`);
  console.log("=".repeat(60));
  console.log(
    `  Signals: ${signals.length} unique (${duplicatesRemoved} duplicates removed)`
  );
  console.log(
    `  Sources: ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`
  );
  console.log(`  Briefs: ${briefs.length} video ideas generated`);
  console.log(`  Notion: ${notionCreated} pages created`);
  console.log(`  Email: ${flags.noEmail ? "skipped" : "sent"}`);
  console.log(`  Top idea: "${briefs[0]?.topic}" (${briefs[0]?.scores.composite}/10)`);
  console.log(`  Time: ${elapsed}s`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
