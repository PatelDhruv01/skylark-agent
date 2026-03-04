# Decision Log — Skylark Drones BI Agent

**Assignment:** Monday.com Business Intelligence Agent  
**name:** Dhruv Patel | MDS202524  
**Date:** March 4, 2026

---

## 01. Key Assumptions

Several decisions were made upfront to handle ambiguity in the brief and proceed confidently within the time constraint.

- **Data identity:** The "Item Name" column in Monday.com was mapped to `Deal name masked` for Work Orders and `Deal Name` for Deals. Serial # was treated as a unique row identifier rather than the primary display name.

- **Read-only access:** The agent never writes to Monday.com. All interactions are purely read operations via GraphQL queries — no mutations were implemented or needed.

- **Currency is INR:** All monetary values are in Indian Rupees. Numbers are formatted using the Indian system (Lakhs / Crores) in all AI responses.

- **"This quarter" means current calendar quarter:** When a user asks about "this quarter", the AI interprets it relative to the current date. Date filtering is handled by Gemini based on normalized date fields passed in the data.

- **Masked data is real data:** Customer names and deal values are masked for privacy but are treated as fully valid business data for analysis purposes.

- **Free-tier constraints apply:** Both the Gemini API (Google AI Studio free tier) and Monday.com (free workspace) impose limits. The architecture was designed to work entirely within these without requiring paid plans.

---

## 02. Trade-offs Chosen and Why

**AI Provider — Gemini 2.5 Flash over Claude / GPT-4**  
Google AI Studio offers a free tier with no credit card required. Gemini 2.5 Flash has strong tool-calling support and sufficient reasoning quality for business intelligence queries. Claude and GPT-4 both require paid credits, which was not feasible here.

**Data Strategy — Fetch full board on each query, not cache at startup**  
The assignment explicitly required live queries per user question. Pre-loading data at startup and reusing it would violate the core requirement. Every query makes a fresh GraphQL call to Monday.com, ensuring the agent always reflects current board state.

**Column Title Resolution — Fetch `board.columns` separately for id→title mapping**  
Newer versions of the Monday.com GraphQL API removed the `title` field from `column_values`. To stay API-version safe, column definitions are fetched separately from `board.columns` and a lookup map (column id → title) is built before processing items. This is more robust than relying on the deprecated field.

**Streaming — Server-Sent Events (SSE) over WebSockets or polling**  
SSE is simpler, unidirectional, and works natively with Next.js API routes without additional infrastructure. It allows the agent to stream both text tokens and action trace events (tool calls, status updates) on a single connection in real time.

**Hosting — Vercel over Railway / Render / AWS**  
Vercel offers zero-config deployment for Next.js, auto-deploys on every GitHub push, and keeps the app live on the free tier. It was the fastest path to a shareable, stable URL within the assignment timeline.

**Data Cleaning — Backend pipeline before the AI sees data, not prompting the AI to handle it**  
Normalization in code is deterministic, fast, and free. Asking the AI to interpret nulls, fix date formats, and canonicalize sector names wastes tokens, adds latency, and produces inconsistent results. Cleaning is done once in the backend before the data is passed to Gemini.

---

## 03. What I'd Do Differently With More Time

**1. Granular tool calling with server-side filtering**  
Currently the agent fetches all 300–500 rows from a board on every query and passes the full dataset to the AI. The ideal architecture defines fine-grained tools — for example, `get_deals_by_sector(sector, status)`, `get_work_orders_by_date_range(from, to)`, `get_top_deals(limit, sort_by)` — so the AI selects the right function with specific arguments, Monday.com returns only relevant rows, and token usage drops by 80–90%. This mirrors how production BI agents handle large datasets. The current approach was chosen because Monday.com's free-tier API does not support column-value filters in `items_page`, making full-board fetching the only viable option without a paid plan.

**2. Monday.com column filter API**  
The paid Monday.com plan supports column-value filters directly in GraphQL queries. With that, sector and status filtering could happen at the database level rather than in application code, making the agent significantly faster and more scalable.

**3. Authentication and multi-user support**  
Currently the agent uses a single shared Monday.com API token. A production version would use OAuth per user, restricting data visibility based on the logged-in team member's role and permissions on the board.

**4. Structured output with charts**  
Instead of markdown text, use JSON-mode responses from Gemini and render visualizations — bar charts for sector breakdowns, funnel charts for deal stages, trend lines for collections — using a library like Recharts. This would make the agent genuinely useful as a dashboard rather than just a chat interface.

**5. Query result caching with TTL**  
For repeated identical queries (e.g. a daily pipeline check), a short-lived cache (5 minutes via Redis or Vercel KV) would reduce Monday.com API calls and latency without violating the live-data intent of the product.

**6. Better error recovery**  
Add retry logic with exponential backoff for Monday.com API failures, and graceful fallback messages when Gemini returns incomplete or empty responses mid-stream.

---

## 04. Bonus: Leadership Updates

**Interpretation:**  
The brief mentioned *"the agent should help prepare data for leadership updates."* This was interpreted as the ability to generate a structured, boardroom-ready business summary on demand — not a scheduled report, but a natural conversational query.

**Implementation:**  
A user can type *"Prepare a leadership update summary"* and the agent automatically queries both the Deals and Work Orders boards, then synthesizes a structured response covering:

- **Pipeline health:** total open pipeline value, top sectors by deal value, high-probability deals
- **Operational status:** work order completion rates, billing status breakdown
- **Financial snapshot:** total contracted value vs. billed vs. collected vs. receivable
- **Risks and flags:** deals stuck in early stages, high receivables, unbilled completed work
- **Data caveats:** transparent note on missing fields that may affect completeness

**Design rationale:**  
Rather than building a separate "report" button or scheduled export, the leadership update is delivered through the same conversational interface. This keeps the architecture simple while demonstrating that the agent understands business context well enough to decide what a leadership audience needs — not just raw numbers, but framed insights with caveats. The response is formatted in markdown with clear headers and bold key figures, making it easy to copy directly into a slide or email.
