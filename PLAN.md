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

## Implementation Steps

### Step 1: Project scaffolding
- Init with `package.json`, `tsconfig.json` (ES2022, ESNext, bundler resolution, strict)
- Dependencies: `tsx`, `@anthropic-ai/sdk`, `@notionhq/client`, `resend`, `rss-parser`, `cheerio`
- Create `.env.example`, `.gitignore`, `data/` directory
- Define core types in `src/types.ts`

### Step 2: Source modules (one at a time, priority order)

Each source exports: `async function poll(): Promise<RawSignal[]>`

**2a. Hacker News** — Easiest, no auth
- Public API: `https://hacker-news.firebaseio.com/v0/`
- Poll `/topstories`, `/newstories`, `/showstories` (Show HN = high buildability signal)
- Fetch top 100 items, filter by AI/coding/vibe-coding keywords
- Extract: title, url, score, comment count, age

**2b. Reddit** — No auth needed for JSON API
- Subreddits: `r/LocalLLaMA`, `r/ClaudeAI`, `r/ChatGPT`, `r/MachineLearning`, `r/artificial`, `r/ollama`, `r/singularity`, `r/cursor`, `r/vibecoding`
- Fetch `/hot.json` and `/new.json` per subreddit
- Filter: score > 20 (hot), > 5 (new)
- Set descriptive `User-Agent` header (Reddit requires this)

**2c. GitHub Trending**
- Use search API: repos created in last 7 days, sorted by stars, filtered by AI/dev-tools topics
- Auth: `GITHUB_TOKEN` for higher rate limits (5000 req/hr)
- Also scrape `github.com/trending` page with cheerio as a backup

**2d. Google News RSS**
- Multiple query feeds via `rss-parser`:
  - "AI coding tool launch", "vibe coding", "Claude Code", "Cursor AI", "LLM open source", "AI agent framework", "AI developer tools"
- Same resilient polling pattern as swf-pipeline

**2e. Twitter/X** (Nitter RSS)
- Curated list of ~30 accounts: AI builders, tool creators, indie hackers
- Poll Nitter RSS feeds (multiple instance fallback)
- This source is inherently fragile — design for graceful degradation

**2f. Product Hunt** (optional, lower priority)
- GraphQL API, filter by "Developer Tools" + "AI" categories

**2g. YouTube Competitor Channels** (optional, lower priority)
- YT Data API v3, monitor ~20 channels for recent uploads
- Purpose: know what's already being covered

### Step 3: Deduplication
- **URL dedup**: SHA-256 of normalized URL, persisted in `data/seen-urls.json`
- **Semantic fingerprint**: lowercase title → strip stop words → sort → hash
- **Run-to-run**: persist recent idea titles in `data/history.json`, include in LLM prompt to avoid regenerating same topics

### Step 4: LLM Analysis Pipeline
- Use `@anthropic-ai/sdk` with Claude (on-brand for the channel)
- Batch all deduplicated signals into one Claude call (~50-100 signals, well within context)
- System prompt encodes channel thesis: *"Less talking about AI, more building with it. The channel focuses on vibe coding — using AI to ship real software. Every idea MUST have a concrete build project."*
- Claude clusters related signals, generates `VideoIdea` per cluster
- Use tool_use / structured output to guarantee schema conformance

**VideoIdea output schema:**
```typescript
{
  title: string              // Suggested video title
  hook: string               // Opening angle (1-2 sentences)
  whyNow: string             // Why this is timely
  buildProject: string       // What to build on camera
  format: 'tutorial' | 'deep-dive' | 'speed-build' | 'comparison' | 'reaction'
  estimatedBuildTime: string // "30 min", "2 hours"
  scores: { buildability: number, timeliness: number, virality: number, composite: number }
  sourceUrls: string[]
  tags: string[]
}
```

### Step 5: Scoring
```
composite = (buildability * 0.50) + (timeliness * 0.30) + (virality * 0.20)
```

- **Buildability (1-10)**: LLM-assessed base + heuristic boosts (+2 if GitHub repo, +1 if mentions API/SDK/open-source, -2 if pure opinion/news)
- **Timeliness (1-10)**: Age factor (< 6h = 10, < 24h = 8, < 48h = 6, < 7d = 3) + multi-source bonus (+2 if 3+ sources)
- **Virality (1-10)**: LLM-assessed + boosts for big-name brands, controversy, high engagement-to-age ratio

### Step 6: Notion Delivery
- User creates a Notion database with columns: Title, Status (New Ideas / Researching / Scripting / Filming / Published), Composite Score, Buildability, Timeliness, Virality, Hook, Why Now, Build Project, Format, Sources, Tags, Surfaced At
- Agent creates pages with Status = "New Ideas"
- Before creating, check for existing pages with similar titles to avoid duplicates

### Step 7: Email Digest
- Resend SDK (same as swf-pipeline)
- Subject: `"Idea Crawler: {count} new ideas — {date}"`
- Top 3 ideas expanded, rest as compact list
- Link to Notion board in footer

### Step 8: Pipeline Orchestration (`scripts/run.ts`)
```
1. Poll all sources in parallel (Promise.allSettled)
2. Merge into single RawSignal[]
3. Dedup (URL + fingerprint + history)
4. Send to Claude for analysis
5. Score and rank VideoIdea[]
6. Push to Notion
7. Send email digest
8. Persist run state
9. Print summary
```

CLI flags: `--dry-run`, `--no-email`, `--no-notion`, `--sources=hn,reddit`

### Step 9: Scheduling
- Start with local cron: `0 8 * * *` (daily 8 AM) + `0 16 * * *` (4 PM)
- Graduate to GitHub Actions when stable

---

## Key Files to Reference
- `startupswithfunding/swf-pipeline/scripts/run.ts` — pipeline orchestration pattern
- `startupswithfunding/swf-pipeline/src/sources/rss.ts` — resilient RSS polling
- `startupswithfunding/swf-pipeline/src/extraction/llmExtract.ts` — structured LLM extraction
- `startupswithfunding/swf-pipeline/tsconfig.json` — TypeScript config to replicate

## Environment Variables Needed
```
ANTHROPIC_API_KEY=sk-ant-...
NOTION_API_KEY=ntn_...
NOTION_DATABASE_ID=...
RESEND_API_KEY=re_...
DIGEST_EMAIL=...
GITHUB_TOKEN=ghp_...        # optional
PRODUCTHUNT_TOKEN=...        # optional
YOUTUBE_API_KEY=...          # optional
```

## Verification
1. Run `npx tsx scripts/run.ts --dry-run` — should poll sources, print signals, show scored ideas, but skip Notion/email
2. Run with `--no-email` to test Notion delivery in isolation
3. Full run: verify Notion board gets populated and email arrives
4. Check `data/history.json` to confirm dedup state persists
5. Run again immediately — should produce zero new ideas (dedup working)
