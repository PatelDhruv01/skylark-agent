# Skylark Drones — Business Intelligence Agent

A live AI agent that answers founder-level business questions by querying Monday.com boards in real time.

## Architecture

```
User Question
     ↓
[ Next.js Chat UI ]  — shows action trace + streamed answer
     ↓
[ /api/chat — Next.js API Route ]
     ↓              ↓
[ Claude API ]   [ Monday.com GraphQL API ]
 (tool calling)    (live data — no cache)
```

**How it works:**
1. User asks a question in the chat
2. The API route sends it to Claude with tool definitions
3. Claude decides which Monday.com board(s) to query
4. The backend makes live GraphQL calls to Monday.com
5. Claude analyzes the data and responds with insights
6. The UI streams the response + shows every API call in the Action Trace panel

## Monday.com Boards

- **Work Orders** — Project execution, billing, collections, sector performance
- **Deals** — Sales pipeline, deal stages, closure probability, revenue forecast

## Setup Instructions

### Prerequisites
- Node.js 18+ installed
- Monday.com account with Work Orders and Deals boards imported
- Anthropic API key (console.anthropic.com)

### 1. Clone and install
```bash
git clone <your-repo-url>
cd skylark-agent
npm install
```

### 2. Configure environment variables
```bash
cp .env.local.example .env.local
```
Edit `.env.local` and fill in:
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `MONDAY_API_TOKEN` — from monday.com profile → Developers → My Access Tokens
- `WORK_ORDERS_BOARD_ID` — from the URL when viewing your Work Orders board
- `DEALS_BOARD_ID` — from the URL when viewing your Deals board

### 3. Run locally
```bash
npm run dev
```
Open http://localhost:3000

### 4. Deploy to Vercel
```bash
# Push to GitHub first, then:
vercel --prod
# Add env vars in Vercel Dashboard → Project → Settings → Environment Variables
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 14 | API routes + React UI in one project |
| AI | Claude claude-sonnet-4-20250514 via tool calling | Claude decides what to query — agentic behavior |
| Data | Monday.com GraphQL API | Live queries, no caching |
| Hosting | Vercel | Zero-config deployment, free tier, stays live |
| Streaming | Server-Sent Events (SSE) | Real-time action trace + streaming responses |

## Column Mapping

### Work Orders Board
Item Name: Deal name masked
Key columns: Customer Name Code, Serial #, Nature of Work, Execution Status,
Sector, Type of Work, Amount in Rupees (Excl/Incl GST), Billed Value,
Collected Amount, Invoice Status, WO Status, Billing Status, Collection Date

### Deals Board
Item Name: Deal Name
Key columns: Owner code, Client Code, Deal Status, Closure Probability,
Masked Deal value, Deal Stage, Product deal, Sector/service, Created Date
