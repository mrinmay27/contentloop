import { pool } from "../src/db/pool.js";

const niches = [
  {
    name: "AI Productivity",
    keywords: ["ai", "automation", "chatgpt", "workflow", "productivity", "tools"],
    monetization: ["template", "tool", "course", "prompt", "software", "workflow"],
    negative: ["deepfake", "spam"],
    persona: "solo creators and small business operators who want practical AI workflows"
  },
  {
    name: "Personal Finance",
    keywords: ["budget", "investing", "saving", "debt", "side hustle", "money"],
    monetization: ["calculator", "budget", "app", "course", "newsletter", "plan"],
    negative: ["guaranteed returns", "get rich quick"],
    persona: "young professionals trying to save more and make better money decisions"
  }
];

for (const niche of niches) {
  const nicheResult = await pool.query<{ id: string }>(
    `
      INSERT INTO niches (name, keywords, monetization_keywords, negative_keywords, target_persona)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (name) DO UPDATE SET
        keywords = EXCLUDED.keywords,
        monetization_keywords = EXCLUDED.monetization_keywords,
        negative_keywords = EXCLUDED.negative_keywords,
        target_persona = EXCLUDED.target_persona
      RETURNING id
    `,
    [niche.name, niche.keywords, niche.monetization, niche.negative, niche.persona]
  );

  const pages = [
    {
      name: `${niche.name} Daily`,
      platform: "instagram",
      handle: `@${niche.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}daily`
    },
    {
      name: `${niche.name} Shorts`,
      platform: "youtube_shorts",
      handle: `${niche.name.replace(/\s+/g, "")}Shorts`
    }
  ];

  for (const page of pages) {
    await pool.query(
      `
        INSERT INTO pages (niche_id, name, platform, handle, brand)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (niche_id, platform, handle) DO UPDATE SET name = EXCLUDED.name, brand = EXCLUDED.brand
      `,
      [
        nicheResult.rows[0].id,
        page.name,
        page.platform,
        page.handle,
        {
          colors: niche.name === "AI Productivity" ? ["#101828", "#2E90FA", "#F9FAFB"] : ["#102A1F", "#12B76A", "#F6FEF9"],
          fonts: ["Inter", "Arial"],
          logoPlacement: "top-right"
        }
      ]
    );
  }
}

await pool.end();
console.log("Seeded 2 niches and 4 pages");
