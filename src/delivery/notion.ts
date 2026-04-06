import { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import { config } from "../config.js";
import type { VideoBrief } from "../types.js";

function getClient(): Client {
  if (!config.notionApiKey) {
    throw new Error("NOTION_API_KEY is required. Set it in .env");
  }
  return new Client({ auth: config.notionApiKey });
}

function richText(content: string) {
  return [{ type: "text" as const, text: { content: content.slice(0, 2000) } }];
}

function boldText(content: string) {
  return [
    {
      type: "text" as const,
      text: { content: content.slice(0, 2000) },
      annotations: { bold: true } as any,
    },
  ];
}

function linkedText(content: string, url: string) {
  return [
    {
      type: "text" as const,
      text: { content: content.slice(0, 2000), link: { url } },
    },
  ];
}

function heading2(text: string): BlockObjectRequest {
  return { type: "heading_2", heading_2: { rich_text: richText(text) } };
}

function paragraph(text: string): BlockObjectRequest {
  return { type: "paragraph", paragraph: { rich_text: richText(text) } };
}

function divider(): BlockObjectRequest {
  return { type: "divider", divider: {} };
}

function callout(text: string, icon: string): BlockObjectRequest {
  return {
    type: "callout",
    callout: {
      rich_text: richText(text),
      icon: { type: "emoji", emoji: icon as any },
      color: "gray_background" as any,
    },
  };
}

function toggle(
  title: string,
  children: BlockObjectRequest[]
): BlockObjectRequest {
  return {
    type: "toggle",
    toggle: {
      rich_text: boldText(title),
      children,
    },
  };
}

function buildBriefBlocks(brief: VideoBrief): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];

  // Why Now — compact callout
  blocks.push(callout(brief.whyNow, "\u23f0"));

  // Scores — single line
  const s = brief.scores;
  blocks.push(
    paragraph(
      `Score: ${s.composite}/10  |  Build: ${s.buildability}  |  Timeliness: ${s.timeliness}  |  Virality: ${s.virality}`
    )
  );

  blocks.push(divider());

  // Sources — compact list, each source is one bullet with link
  blocks.push(heading2("Sources"));
  for (const src of brief.sources) {
    blocks.push({
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          ...linkedText(`[${src.source}] ${src.title}`, src.url),
          { type: "text" as const, text: { content: ` — "${src.snippet}"` } },
        ],
      },
    });
  }

  blocks.push(divider());

  // Angles — each as a toggle block (collapsed by default)
  blocks.push(heading2("Angles"));

  for (let i = 0; i < brief.angles.length; i++) {
    const angle = brief.angles[i];

    const angleChildren: BlockObjectRequest[] = [
      paragraph(`Title: "${angle.title}"`),
      paragraph(`Hook: ${angle.hook}`),
      paragraph(`Thumbnail: ${angle.thumbnailConcept}`),
      paragraph(
        `Build: ${angle.buildProject}\nFormat: ${angle.format} | ~${angle.estimatedBuildTime}`
      ),
    ];

    // Intros as nested toggle
    const introChildren: BlockObjectRequest[] = angle.intros.map((intro, j) => ({
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: richText(
          `Intro ${j + 1}: "${intro.intro}"\nPayoff: ${intro.payoff}`
        ),
      },
    }));

    angleChildren.push(toggle("Intro options", introChildren));

    blocks.push(toggle(`Angle ${i + 1}: ${angle.angle}`, angleChildren));
  }

  return blocks;
}

async function findExistingPage(
  notion: Client,
  topic: string
): Promise<boolean> {
  const response = await notion.databases.query({
    database_id: config.notionDatabaseId,
    filter: {
      property: "Topic",
      title: { contains: topic.slice(0, 100) },
    },
    page_size: 1,
  });
  return response.results.length > 0;
}

async function createPage(
  notion: Client,
  brief: VideoBrief
): Promise<string> {
  const page = await notion.pages.create({
    parent: { database_id: config.notionDatabaseId },
    properties: {
      Topic: { title: richText(brief.topic) },
      Status: { select: { name: "New Ideas" } },
      "Composite Score": { number: brief.scores.composite },
      Buildability: { number: brief.scores.buildability },
      Timeliness: { number: brief.scores.timeliness },
      Virality: { number: brief.scores.virality },
      "Why Now": { rich_text: richText(brief.whyNow) },
      Tags: {
        multi_select: brief.tags.map((tag) => ({ name: tag })),
      },
      "Surfaced At": {
        date: { start: new Date().toISOString().split("T")[0] },
      },
    },
  });

  const blocks = buildBriefBlocks(brief);
  const BATCH_SIZE = 100;

  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    await notion.blocks.children.append({
      block_id: page.id,
      children: batch,
    });
  }

  return page.id;
}

export async function pushToNotion(briefs: VideoBrief[]): Promise<number> {
  if (!config.notionDatabaseId) {
    throw new Error(
      "NOTION_DATABASE_ID is required. Run scripts/setup-notion.ts first."
    );
  }

  const notion = getClient();
  let created = 0;
  let skipped = 0;

  console.log(`[Notion] Pushing ${briefs.length} briefs...`);

  for (const brief of briefs) {
    const exists = await findExistingPage(notion, brief.topic);
    if (exists) {
      console.log(`[Notion] Skipped (exists): "${brief.topic}"`);
      skipped++;
      continue;
    }

    const pageId = await createPage(notion, brief);
    console.log(`[Notion] Created: "${brief.topic}" (${pageId})`);
    created++;
  }

  console.log(`[Notion] Done: ${created} created, ${skipped} skipped\n`);
  return created;
}
