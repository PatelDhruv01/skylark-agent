# 🚁 Skylark Drones — Business Intelligence Agent

A live AI-powered Business Intelligence agent that answers founder-level questions by querying Monday.com boards in real time. No cached data. No pre-loaded context. Every question triggers a fresh API call.

---

## 🌐 Live Demo

> **[https://skylark-agent-phi.vercel.app/](https://skylark-agent-phi.vercel.app/)**

**Monday.com Boards (source data):**
- Work Orders Board — project execution, billing, collections
- Deals Board — sales pipeline, deal stages, probabilities

---

## 🧠 What It Does

A founder types: *"How's our Mining pipeline looking this quarter?"*

The agent:
1. **Understands** the question using Gemini 2.5 Flash
2. **Decides** which Monday.com board(s) to query via tool calling
3. **Fetches** live data via Monday.com GraphQL API
4. **Cleans** the messy real-world data (normalizes dates, numbers, sectors, nulls)
5. **Responds** with streamed, formatted insights in real time
6. **Shows** every step in the Action Trace panel — full transparency

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User (Browser)                        │
│              React Chat UI + Action Trace                │
└────────────────────────┬────────────────────────────────┘
                         │ POST /api/chat (SSE stream)
┌────────────────────────▼────────────────────────────────┐
│              Next.js API Route (/pages/api/chat.js)      │
│                                                          │
│  1. Receive user message                                 │
│  2. Send to Gemini with tool definitions                 │
│  3. Gemini decides which tool(s) to call                 │
│  4. Fetch live data from Monday.com GraphQL API          │
│  5. Clean + normalize data (dates, numbers, sectors)     │
│  6. Feed cleaned data back to Gemini for analysis        │
│  7. Stream final response token-by-token via SSE         │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
┌──────────▼──────────┐   ┌──────────▼─────────────────┐
│   Gemini 2.5 Flash   │   │  Monday.com GraphQL API     │
│  (AI reasoning +     │   │  boards(ids: [...]) {       │
│   tool calling)      │   │    columns { id title }     │
└─────────────────────┘   │    items_page(limit: 500)   │
                           │  }                          │
                           └────────────────────────────┘
```

### Why This Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 | API routes + React UI in one repo, zero-config Vercel deploy |
| AI | Gemini 2.5 Flash | Free tier, strong reasoning, native tool calling |
| Data source | Monday.com GraphQL API | Live queries — no caching, no stale data |
| Streaming | Server-Sent Events (SSE) | Real-time token streaming + action trace events on one connection |
| Hosting | Vercel | Auto-deploy from GitHub, stays live on free tier |

---

## ✨ Features

### 1. Live Monday.com Integration
- Every query makes fresh GraphQL API calls — data is never cached or stored
- Queries both boards simultaneously when needed (cross-board questions)
- Fetches column definitions separately from `board.columns` to handle Monday.com's API versioning (newer API removed `title` from `column_values`)

### 2. Data Cleaning Pipeline
Real-world data is messy. Every record is cleaned before reaching the AI:

| Issue | Fix |
|-------|-----|
| Inconsistent date formats (DD/MM/YYYY, MM-DD-YYYY) | Normalized to YYYY-MM-DD |
| Currency strings with ₹ and commas | Parsed to clean floats |
| Sector name variations ("powerline", "Powerline Inspection", "POWERLINE") | Normalized to canonical names |
| Status string variations ("executed until c...") | Normalized to full values |
| Dash / N/A / blank values | Converted to `null` |
| Duplicate header rows accidentally imported from CSV | Filtered out automatically |
| Columns with >30% null values | Flagged in data quality notes |

### 3. Real-time Streaming
- AI response streams token-by-token using Gemini's `sendMessageStream()`
- Blinking cursor `▋` shows the AI is actively generating
- Action Trace panel updates live alongside the response

### 4. Agent Action Trace Panel
Every query shows in the right-side panel:
- Which board(s) are being queried and the reason why
- Monday.com Board IDs being called
- Record counts fetched and cleaned
- Data quality warnings (missing fields flagged)
- Timestamps for every step

### 5. Rich Markdown Rendering
Responses render with full formatting:
- **Bold** key numbers, `### headers`, bullet lists, tables
- Tight list spacing — no awkward paragraph gaps between bullets
- Data quality notes always appear **last**, after the main answer

### 6. Conversational Follow-ups
- Full conversation history is maintained across turns
- Follow-up questions like "Now filter those by Mining sector" work correctly
- Context carries forward without re-explaining the question

---

## 📁 Project Structure

```
skylark-agent/
├── pages/
│   ├── index.js          # Chat UI — streaming, markdown, action trace
│   ├── _app.js           # Next.js app wrapper
│   └── api/
│       └── chat.js       # Agent backend — all logic lives here
│           ├── normalizeDate()     # Date format normalization
│           ├── normalizeNumber()   # Currency/number cleaning
│           ├── normalizeSector()   # Sector name canonicalization
│           ├── normalizeStatus()   # Status string normalization
│           ├── cleanRecord()       # Per-row cleaning pipeline
│           ├── isHeaderRow()       # Filter accidental header rows
│           ├── fetchBoardItems()   # Monday.com GraphQL fetcher
│           └── executeTool()       # Tool execution + SSE trace events
├── styles/
│   └── globals.css       # Dark theme + markdown styles + animations
├── public/
├── .env.local.example    # Environment variable template
├── .gitignore
├── next.config.js
├── package.json
└── README.md
```

---

## 🚀 Setup & Deployment

### Prerequisites
- Node.js 18+
- Monday.com account with **Work Orders** and **Deals** boards imported
- Google AI Studio account (free) — for Gemini API key

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/skylark-agent.git
cd skylark-agent
npm install
```

### 2. Configure environment variables
```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
GEMINI_API_KEY=AIzaSy...           # from aistudio.google.com → Get API Key
MONDAY_API_TOKEN=eyJhbGci...       # monday.com → Profile → Developers → My Access Tokens
WORK_ORDERS_BOARD_ID=5026985662    # from monday.com board URL
DEALS_BOARD_ID=5026985928          # from monday.com board URL
NEXT_PUBLIC_WORK_ORDERS_BOARD_ID=5026985662
NEXT_PUBLIC_DEALS_BOARD_ID=5026985928
```

### 3. Run locally
```bash
npm run dev
# Open http://localhost:3000
```

### 4. Deploy to Vercel
Push to GitHub, then import the repo at vercel.com — it auto-detects Next.js.

**Add all 6 environment variables in Vercel:**
Dashboard → Project → Settings → Environment Variables

Then: Deployments tab → 3 dots → Redeploy.

---

## 🗂️ Monday.com Board Setup

### Work Orders Board
**Item Name:** Deal name masked

| Column | Recommended Type |
|--------|-----------------|
| Customer Name Code | Text |
| Serial # | Text |
| Nature of Work | Dropdown |
| Execution Status | Status |
| Data Delivery Date | Date |
| Date of PO/LOI | Date |
| Sector | Dropdown |
| Amount in Rupees (Excl of GST) (Masked) | Numbers |
| Billed Value in Rupees (Excl of GST.) (Masked) | Numbers |
| Collected Amount in Rupees (Incl of GST.) (Masked) | Numbers |
| Amount Receivable (Masked) | Numbers |
| Invoice Status | Status |
| WO Status (billed) | Status |
| Billing Status | Status |

### Deals Board
**Item Name:** Deal Name

| Column | Recommended Type |
|--------|-----------------|
| Owner code | Text |
| Client Code | Text |
| Deal Status | Status |
| Close Date (A) | Date |
| Closure Probability | Dropdown |
| Masked Deal value | Numbers |
| Tentative Close Date | Date |
| Deal Stage | Dropdown |
| Sector/service | Dropdown |
| Created Date | Date |

---

## 💬 Example Queries

```
"How's our pipeline looking this quarter?"
"Which sectors have the most deal value?"
"Show total revenue from completed work orders"
"What's the deal stage funnel breakdown?"
"Which deals have high closure probability?"
"Compare billing status across work orders"
"Which sector has the highest receivables?"
"Prepare a leadership update summary"
"How many work orders are fully billed vs partially billed?"
"Show me deals stuck in Negotiations stage"
```

---

## 🔒 Security Notes

- API keys are stored as Vercel environment variables — never in the codebase
- Monday.com access is **read-only** — the agent never writes or modifies board data
- `.env.local` is gitignored — never committed to the repository
- No data is ever cached, stored, or persisted — every query is stateless

---

## 🛠️ Tech Stack

- **Next.js 14** — framework
- **React 18** — UI
- **@google/generative-ai** — Gemini 2.5 Flash SDK
- **Monday.com GraphQL API v2** — live data source
- **Vercel** — hosting + serverless functions
- **Server-Sent Events (SSE)** — real-time streaming

---

## 📄 License

Built for the Skylark Drones recruitment assignment.
