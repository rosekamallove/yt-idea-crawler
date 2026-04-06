# Idea Crawler — YouTube Video Idea Agent

## Context

Rose runs a YouTube channel focused on **vibe coding** — practically applying AI to build, refine, and ship real software. The audience is developers, indie hackers, and founders. Key events in the AI/coding space (tool launches, leaks, new capabilities) happen weekly and are time-sensitive video opportunities. Missing them means losing first-mover advantage.

This agent crawls multiple sources, uses Claude to analyze signals, scores them by **buildability > timeliness > virality**, and delivers ranked video ideas to a Notion board + daily email digest.

---

## Architecture

Modeled after the existing `swf-pipeline` — same patterns: `tsx` runner, `Promise.allSettled` for resilient source polling, structured LLM extraction, JSON-file-based dedup (no DB for v1).

```
yt-idea-crawler/
├── scripts/
│   └── run.ts                # Main pipeline entry point
├── src/
│   ├── sources/              # One module per source
│   │   ├── hackernews.ts     # HN API (public, no auth)
│   │   ├── reddit.ts         # Reddit JSON API (no auth)
│   │   ├── github-trending.ts# GitHub search API
│   │   ├── google-news.ts    # Google News RSS
│   │   ├── twitter.ts        # Nitter RSS for curated accounts
│   │   ├── product-hunt.ts   # GraphQL API (free token)
│   │   ├── youtube.ts        # YT Data API (competitor channels)
│   │   └── index.ts          # Barrel export + RawSignal type
│   ├── analysis/
│   │   ├── analyze.ts        # Claude API: signals → VideoIdea[]
│   │   ├── prompts.ts        # System prompt encoding channel thesis
│   │   └── scoring.ts        # Composite scoring formula
│   ├── dedup/
│   │   └── dedup.ts          # URL hash + semantic fingerprint + run history
│   ├── delivery/
│   │   ├── notion.ts         # Create/update Notion database entries
│   │   └── email.ts          # Daily digest via Resend
│   ├── types.ts              # RawSignal, VideoIdea, ScoreBreakdown
│   └── config.ts             # Env vars, source configs, keywords
├── data/                     # Persisted state (gitignored)
│   ├── seen-urls.json
│   └── history.json
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

## Phased Implementation

### Phase 1: Foundation — Scaffold + First Source + Console Output
> Goal: Run `npx tsx scripts/run.ts` and see real signals printed to console.

**1.1 Project scaffolding**
- `package.json` with deps: `tsx`, `@anthropic-ai/sdk`, `rss-parser`, `cheerio`
- `tsconfig.json` (ES2022, ESNext, bundler resolution, strict)
- `.env.example`, `.gitignore`, `data/` directory
- Core types in `src/types.ts` — `RawSignal` interface
- Config in `src/config.ts` — env vars, AI keyword list

**1.2 Hacker News source** (`src/sources/hackernews.ts`)
- Public API, no auth — fastest to get working
- Poll `/topstories`, `/newstories`, `/showstories`
- Fetch top 100 items, filter by AI/coding keywords
- Return `RawSignal[]`

**1.3 Minimal pipeline** (`scripts/run.ts`)
- Poll HN → print signals to console with counts
- CLI flag: `--sources=hn`

**Milestone:** `npx tsx scripts/run.ts` prints 20-50 filtered HN signals.

---

### Phase 2: More Sources — Reddit, GitHub, Google News
> Goal: 4 sources running in parallel, dedup working.

**2.1 Reddit source** (`src/sources/reddit.ts`)
- JSON API (no auth), 9 subreddits, `/hot.json` + `/new.json`
- Filter: score > 20 (hot), > 5 (new)

**2.2 GitHub Trending** (`src/sources/github-trending.ts`)
- Search API: repos created in last 7 days, sorted by stars
- Filter by AI/dev-tools topics in description
- Auth: `GITHUB_TOKEN` for rate limits

**2.3 Google News RSS** (`src/sources/google-news.ts`)
- Multiple query feeds via `rss-parser`:
  - "AI coding tool launch", "vibe coding", "Claude Code", "Cursor AI", "LLM open source", "AI agent framework"

**2.4 Source barrel** (`src/sources/index.ts`)
- `pollAll()` — runs all sources with `Promise.allSettled`, merges results
- Logs per-source counts and failures

**2.5 Basic dedup** (`src/dedup/dedup.ts`)
- URL dedup: SHA-256 of normalized URL
- Semantic fingerprint: lowercase title → strip stop words → sort → hash
- Persist seen URLs to `data/seen-urls.json`

**2.6 Update pipeline**
- Poll all 4 sources in parallel → dedup → print summary
- CLI flags: `--sources=hn,reddit,github,news`

**Milestone:** `npx tsx scripts/run.ts` prints 50-150 deduplicated signals from 4 sources.

---

### Phase 3: Brain — Claude Analysis + Scoring
> Goal: Raw signals go in, scored VideoBriefs come out.

**3.1 Types** — add `VideoBrief` to `src/types.ts`
```typescript
{
  // === TOPIC ===
  topic: string                // Core subject (e.g., "Claude Code source leak")
  whyNow: string               // Why this is timely
  sources: {                   // Multiple references per idea
    url: string
    title: string
    source: string
    snippet: string            // Key quote or takeaway
  }[]

  // === ANGLES (2-3 per topic) ===
  angles: {
    angle: string              // The specific spin
    title: string              // Video title for this angle
    hook: string               // Curiosity hook — opens a loop
    thumbnailConcept: string   // Visual concept (90% psychology)
    intros: {                  // 2-3 intro options to test
      intro: string            // First 2-3 sentences
      payoff: string           // What viewer hopes to walk away with
    }[]
    buildProject: string       // Concrete thing to build on camera
    format: 'tutorial' | 'deep-dive' | 'speed-build' | 'comparison' | 'reaction'
    estimatedBuildTime: string
  }[]

  // === SCORING ===
  scores: {
    buildability: number       // 1-10
    timeliness: number         // 1-10
    virality: number           // 1-10
    composite: number          // 0.50*build + 0.30*time + 0.20*viral
  }
  tags: string[]
}
```

**3.2 System prompt** (`src/analysis/prompts.ts`)
- Encodes channel thesis: "Less talking about AI, more building with it"
- Encodes video methodology: Topic → Angle → Hook
- Instructs: cluster related signals, generate VideoBrief per cluster
- Instructs: every angle MUST have a concrete build project
- Instructs: intros should pitch different payoffs to test before filming
- Instructs: thumbnail concepts are psychological, not decorative

**3.3 Claude analysis** (`src/analysis/analyze.ts`)
- `@anthropic-ai/sdk` with tool_use for structured output
- Batch all signals into one call (50-100 signals ≈ 10K tokens)
- Returns `VideoBrief[]`

**3.4 Scoring heuristics** (`src/analysis/scoring.ts`)
- Buildability: LLM base + boosts (+2 GitHub repo, +1 API/SDK mention, -2 pure opinion)
- Timeliness: age factor + multi-source bonus (+2 if 3+ sources mention it)
- Virality: LLM base + boosts (big brand, controversy, high engagement/age ratio)
- Composite: `0.50 * buildability + 0.30 * timeliness + 0.20 * virality`

**3.5 Run-to-run dedup**
- Persist generated topic titles to `data/history.json`
- Include recent history in prompt so Claude avoids regenerating same topics

**3.6 Update pipeline**
- Poll → dedup → analyze → score → print ranked VideoBriefs to console
- `--dry-run` flag skips analysis (just shows raw signals)

**Milestone:** `npx tsx scripts/run.ts` prints 5-15 scored VideoBriefs with angles, hooks, and build projects.

---

### Phase 4: Delivery — Notion Board + Email Digest
> Goal: Ideas land in Notion and your inbox automatically.

**4.1 Notion integration** (`src/delivery/notion.ts`)
- Install `@notionhq/client`
- Database properties: Topic (title), Status (select), Composite Score, Buildability, Timeliness, Virality, Why Now, Tags, Surfaced At
- Page body = full video brief:
  - **Sources** section with reference links + snippets
  - **Angle** toggle blocks, each containing: title, hook, thumbnail concept, intro options, build project
- Duplicate check: query existing pages, skip if similar topic exists
- Env: `NOTION_API_KEY`, `NOTION_DATABASE_ID`

**4.2 Email digest** (`src/delivery/email.ts`)
- Install `resend`
- Subject: `"Idea Crawler: {count} new ideas — {date}"`
- HTML body: top 3 briefs expanded (topic, best angle, score), rest as compact list
- Footer: link to Notion board
- Env: `RESEND_API_KEY`, `DIGEST_EMAIL`

**4.3 Update pipeline**
- Poll → dedup → analyze → score → push to Notion → send email → persist state
- CLI flags: `--no-email`, `--no-notion`

**Milestone:** Run the crawler, open Notion — see video briefs as pages with toggle blocks. Check email — see a digest.

---

### Phase 5: More Sources — Twitter, Product Hunt, YouTube Competitors
> Goal: Expand signal coverage with fragile/optional sources.

**5.1 Twitter/X** (`src/sources/twitter.ts`)
- Nitter RSS for ~30 curated accounts (AI builders, tool creators, indie hackers)
- Multiple Nitter instance fallback
- Graceful degradation — if all instances fail, skip silently

**5.2 Product Hunt** (`src/sources/product-hunt.ts`)
- GraphQL API, filter by "Developer Tools" + "AI" categories
- Env: `PRODUCTHUNT_TOKEN` (free)

**5.3 YouTube Competitor Channels** (`src/sources/youtube.ts`)
- YT Data API v3, monitor ~20 channel IDs for recent uploads
- Purpose: know what's already covered, find differentiated angles
- Env: `YOUTUBE_API_KEY`

**Milestone:** 7 sources running. Raw signal count doubles.

---

### Phase 6: Automation — Scheduling + Resilience
> Goal: Runs itself daily without you thinking about it.

**6.1 Error handling hardening**
- Per-source timeouts (30s default)
- Graceful failure: if a source dies, others continue
- If Claude API fails, save raw signals to `data/fallback-{date}.json` for manual review

**6.2 Local cron**
- `0 8 * * *` (8 AM daily) + `0 16 * * *` (4 PM)
- Log output to `logs/`

**6.3 GitHub Actions (graduation)**
- `.github/workflows/crawl.yml` with `schedule: cron`
- Secrets in repo settings
- Runs even when laptop is off

**Milestone:** Wake up to a Notion board with fresh video briefs + email in your inbox. Zero manual effort.

---

## Reference Files
- `startupswithfunding/swf-pipeline/scripts/run.ts` — pipeline orchestration pattern
- `startupswithfunding/swf-pipeline/src/sources/rss.ts` — resilient RSS polling
- `startupswithfunding/swf-pipeline/src/extraction/llmExtract.ts` — structured LLM extraction
- `startupswithfunding/swf-pipeline/tsconfig.json` — TypeScript config to replicate

## Environment Variables
```
# Required (Phase 3+)
ANTHROPIC_API_KEY=sk-ant-...

# Required (Phase 4)
NOTION_API_KEY=ntn_...
NOTION_DATABASE_ID=...
RESEND_API_KEY=re_...
DIGEST_EMAIL=...

# Optional (Phase 2+)
GITHUB_TOKEN=ghp_...

# Optional (Phase 5)
PRODUCTHUNT_TOKEN=...
YOUTUBE_API_KEY=...
```

## Verification (per phase)
1. **Phase 1:** `npx tsx scripts/run.ts` → 20-50 HN signals in console
2. **Phase 2:** Same command → 50-150 deduplicated signals from 4 sources
3. **Phase 3:** Same command → 5-15 ranked VideoBriefs with angles, hooks, builds
4. **Phase 4:** Notion board populated + email received
5. **Phase 5:** Signal count doubles, new source types visible
6. **Phase 6:** Runs unattended daily, failures logged not crashed
