# Default AI Sources

When the user does not explicitly name a site, choose one of `grok`, `chatgpt`, or `gemini` first. Do not start by running multiple AI sources in parallel.

## Usage Rules

1. Run `webcmd list -f yaml`
2. Confirm which of `grok`, `chatgpt`, and `gemini` are available in the current registry
3. Run `webcmd <site> -h`
4. After selecting a subcommand, run `webcmd <site> <command> -h`

## Routing Guidance

### grok

- Use for: real-time trends, Twitter/X context, English-language internet discussion, sentiment, and trends
- Common follow-up sources: `twitter`, `reddit`, `reuters`, `google`
- Query suggestions:
  - Add a time range, such as "today" or "this week"
  - Add a platform scope, such as "on X" or "from social posts"
  - Add a goal, such as "latest reactions", "main viewpoints", or "key claims"
  - Examples:
    - `OpenAI latest reactions on X this week`
    - `TSLA earnings main viewpoints on social media April 2026`
    - `Nintendo Switch 2 rumors latest discussion on X`

### chatgpt

- Use for: broad Q&A, synthesis, planning, coding help, and general-purpose English-language research
- Common follow-up sources: `reddit`, `youtube`, `google`, `reuters`
- Query suggestions:
  - Add a language, market, or audience scope, such as "English-language discussion" or "US users"
  - Add the requested goal, such as "summarize", "compare", or "extract recommendation reasons"
  - Add audience or use-case constraints, such as "for beginners", "under $500", or "remote jobs"
  - Examples:
    - `Is the 2026 MacBook Air worth buying? Main views in English-language discussions`
    - `Remote AI product manager hiring trends over the last month`
    - `Sunscreen recommendations for sensitive skin, common pros and cons from US users`

### gemini

- Use for: global web coverage, English-language sources, background summaries, and general retrieval
- Common follow-up sources: `google`, `wikipedia`, `arxiv`, `stackoverflow`
- Query suggestions:
  - Add a topic type, such as "overview", "comparison", "background", or "best sources"
  - Add scope constraints, such as region, time, language, or industry
  - Add an output shape, such as "with sources", "compare pros and cons", or "official guidance"
  - Examples:
    - `MCP overview and official guidance with sources`
    - `best budget travel destinations in Japan April 2026 compare pros and cons`
    - `TypeScript decorators current status official sources`

## Follow-Up Principles

- Use one AI source first to get an initial answer
- If the answer lacks raw data, vertical results, or authoritative sources, add 1-2 specialized sources
- Do not treat default AI sources as ground truth for command signatures; command details always come from `webcmd ... -h`

## General Query Templates

You can build AI queries from these templates:

- Trending topic/news:
  `<event> + latest developments + <time range> + <region/platform>`
- Comparison/recommendation:
  `<item A> vs <item B> + <evaluation dimensions> + <audience/budget/use case>`
- Regional or language community:
  `<topic> + main viewpoints in <language/market> discussions + <time range>`
- Global sources:
  `<topic> + overview/background + with sources`
- Jobs:
  `<role> + <city/country> + market trends/hiring + <time range>`
- Shopping:
  `<product> + reviews/price/value + <region/budget>`
