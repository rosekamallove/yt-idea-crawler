import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const parentPageId = process.env.NOTION_DATABASE_ID;

if (!process.env.NOTION_API_KEY || !parentPageId) {
  console.error("Set NOTION_API_KEY and NOTION_DATABASE_ID (parent page ID) in .env");
  process.exit(1);
}

async function main() {
  console.log("Creating Notion database inside page:", parentPageId);

  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "YT Idea Crawler" } }],
    icon: { type: "emoji", emoji: "🎬" },
    properties: {
      Topic: { title: {} },
      Status: {
        select: {
          options: [
            { name: "New Ideas", color: "blue" },
            { name: "Researching", color: "yellow" },
            { name: "Scripting", color: "orange" },
            { name: "Filming", color: "purple" },
            { name: "Published", color: "green" },
            { name: "Rejected", color: "red" },
          ],
        },
      },
      "Composite Score": { number: { format: "number" } },
      Buildability: { number: { format: "number" } },
      Timeliness: { number: { format: "number" } },
      Virality: { number: { format: "number" } },
      "Why Now": { rich_text: {} },
      Tags: {
        multi_select: {
          options: [
            { name: "claude", color: "orange" },
            { name: "openai", color: "green" },
            { name: "vibe-coding", color: "blue" },
            { name: "open-source", color: "purple" },
            { name: "agents", color: "yellow" },
            { name: "local-ai", color: "red" },
            { name: "security", color: "gray" },
            { name: "automation", color: "pink" },
          ],
        },
      },
      "Surfaced At": { date: {} },
    },
  });

  console.log("\nDatabase created successfully!");
  console.log(`Database ID: ${db.id}`);
  console.log(`\nUpdate your .env file:`);
  console.log(`  NOTION_DATABASE_ID=${db.id}`);
  console.log(`\n(Replace the page ID with this database ID)`);
}

main().catch((err) => {
  console.error("Failed to create database:", err.message);
  process.exit(1);
});
