export const AI_KEYWORDS = [
  // Core terms
  "ai",
  "llm",
  "gpt",
  "claude",
  "gemini",
  "copilot",
  "chatgpt",
  "openai",
  "anthropic",
  "deepseek",
  "mistral",
  "llama",
  "ollama",

  // Vibe coding / AI dev tools
  "vibe coding",
  "vibe-coding",
  "vibecoding",
  "cursor",
  "windsurf",
  "cline",
  "aider",
  "codex",
  "claude code",
  "github copilot",
  "tabnine",
  "supermaven",
  "continue.dev",

  // AI concepts
  "agent",
  "rag",
  "fine-tune",
  "fine tuning",
  "embedding",
  "vector",
  "transformer",
  "diffusion",
  "multimodal",
  "context window",
  "token",
  "prompt engineering",
  "mcp",
  "model context protocol",
  "function calling",
  "tool use",

  // AI infrastructure
  "hugging face",
  "huggingface",
  "replicate",
  "together ai",
  "groq",
  "fireworks ai",
  "vercel ai",
  "langchain",
  "llamaindex",
  "semantic kernel",
  "autogen",
  "crewai",
  "langgraph",

  // General dev + AI intersection
  "ai coding",
  "ai developer",
  "ai tool",
  "ai sdk",
  "ai api",
  "open source ai",
  "local llm",
  "self-hosted",
];

// Lowercase set for fast lookup
export const AI_KEYWORDS_SET = new Set(
  AI_KEYWORDS.map((k) => k.toLowerCase())
);

/** Check if text contains any AI keyword */
export function matchesAIKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  notionApiKey: process.env.NOTION_API_KEY ?? "",
  notionDatabaseId: process.env.NOTION_DATABASE_ID ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  digestEmail: process.env.DIGEST_EMAIL ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  productHuntToken: process.env.PRODUCTHUNT_TOKEN ?? "",
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
};
