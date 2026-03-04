import { GoogleGenerativeAI } from '@google/generative-ai';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const WORK_ORDERS_BOARD_ID = process.env.WORK_ORDERS_BOARD_ID || '5026985662';
const DEALS_BOARD_ID = process.env.DEALS_BOARD_ID || '5026985928';

// ─── DATA CLEANING ────────────────────────────────────────────────────────────
// This runs on every record before it's sent to the AI.
// Goal: normalize messy real-world data so the AI doesn't get confused.

function normalizeDate(val) {
  if (!val || val.trim() === '' || val === '-' || val === 'N/A') return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
  // DD/MM/YYYY → YYYY-MM-DD
  const dmy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // MM/DD/YYYY → YYYY-MM-DD
  const mdy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  return val.trim(); // return as-is if unknown format
}

function normalizeNumber(val) {
  if (!val || val.trim() === '' || val === '-' || val === 'N/A') return null;
  // Remove commas, currency symbols, spaces
  const cleaned = val.replace(/[₹,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function normalizeSector(val) {
  if (!val) return null;
  const v = val.trim().toLowerCase();
  if (v.includes('mining')) return 'Mining';
  if (v.includes('power') || v.includes('powerline')) return 'Powerline';
  if (v.includes('rail')) return 'Railways';
  if (v.includes('renew') || v.includes('solar') || v.includes('wind')) return 'Renewables';
  if (v.includes('dsp') || v.includes('digital')) return 'DSP';
  if (v.includes('construct')) return 'Construction';
  if (v.includes('other')) return 'Others';
  return val.trim(); // keep original if no match
}

function normalizeStatus(val) {
  if (!val) return null;
  const v = val.trim().toLowerCase();
  if (v.includes('complet')) return 'Completed';
  if (v.includes('not start')) return 'Not Started';
  if (v.includes('ongoing') || v.includes('in progress')) return 'Ongoing';
  if (v.includes('executed until')) return 'Executed until current month';
  if (v.includes('open')) return 'Open';
  if (v.includes('hold')) return 'On Hold';
  if (v.includes('dead') || v.includes('lost')) return 'Dead/Lost';
  if (v.includes('won') || v.includes('closed')) return 'Won/Closed';
  return val.trim();
}

// Column name sets for type detection
const DATE_COLS = new Set([
  'data delivery date', 'date of po/loi', 'probable start date', 'probable end date',
  'last invoice date', 'collection date', 'close date (a)', 'tentative close date', 'created date',
]);
const NUMBER_COLS = new Set([
  'amount in rupees (excl of gst) (masked)', 'amount in rupees (incl of gst) (masked)',
  'billed value in rupees (excl of gst.) (masked)', 'billed value in rupees (incl of gst.) (masked)',
  'collected amount in rupees (incl of gst.) (masked)',
  'amount to be billed in rs. (exl. of gst) (masked)',
  'amount to be billed in rs. (incl. of gst) (masked)',
  'amount receivable (masked)', 'masked deal value',
  'quantity by ops', 'quantities as per po', 'quantity billed (till date)', 'balance in quantity',
]);
const SECTOR_COLS = new Set(['sector', 'sector/service']);
const STATUS_COLS = new Set([
  'execution status', 'invoice status', 'billing status', 'wo status (billed)',
  'deal status', 'collection status',
]);

function cleanRecord(row) {
  const cleaned = {};
  for (const [key, val] of Object.entries(row)) {
    if (key === '_item_name') { cleaned[key] = val; continue; }
    const k = key.toLowerCase().trim();

    // Skip completely empty rows
    if (val === null || val === undefined || val === '') {
      cleaned[key] = null;
      continue;
    }

    if (DATE_COLS.has(k)) {
      cleaned[key] = normalizeDate(String(val));
    } else if (NUMBER_COLS.has(k)) {
      cleaned[key] = normalizeNumber(String(val));
    } else if (SECTOR_COLS.has(k)) {
      cleaned[key] = normalizeSector(String(val));
    } else if (STATUS_COLS.has(k)) {
      cleaned[key] = normalizeStatus(String(val));
    } else {
      // General text: trim and nullify dashes
      const trimmed = String(val).trim();
      cleaned[key] = (trimmed === '-' || trimmed === 'N/A' || trimmed === '') ? null : trimmed;
    }
  }
  return cleaned;
}

// Filter out rows that look like duplicate headers (all values are column name-like strings)
function isHeaderRow(row) {
  const vals = Object.values(row).filter(Boolean);
  if (vals.length === 0) return true;
  // If the item name itself looks like a column header label, skip it
  const name = (row._item_name || '').toLowerCase();
  const headerKeywords = ['deal status', 'close date', 'sector/service', 'deal stage', 'owner code'];
  return headerKeywords.some((h) => name.includes(h));
}

// ─── Monday.com GraphQL fetcher ───────────────────────────────────────────────
async function fetchBoardItems(boardId) {
  const gql = `
    query GetBoardItems($boardId: [ID!]!) {
      boards(ids: $boardId) {
        name
        columns {
          id
          title
        }
        items_page(limit: 500) {
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.MONDAY_API_TOKEN,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query: gql, variables: { boardId: [boardId] } }),
  });

  if (!res.ok) throw new Error(`Monday.com API error: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Monday.com GraphQL error: ${json.errors[0]?.message}`);

  const board = json.data?.boards?.[0];
  if (!board) throw new Error('Board not found');

  // Build column id → title map
  const colTitleMap = {};
  for (const col of board.columns || []) {
    colTitleMap[col.id] = col.title;
  }

  // Raw items
  const rawItems = board.items_page.items.map((item) => {
    const row = { _item_name: item.name };
    for (const col of item.column_values) {
      const title = colTitleMap[col.id] || col.id;
      row[title] = col.text || null;
    }
    return row;
  });

  // Clean + filter
  const cleanedItems = rawItems
    .filter((row) => !isHeaderRow(row))   // remove accidental header rows
    .map(cleanRecord);                     // normalize dates, numbers, sectors

  // Data quality summary for the AI
  const nullCounts = {};
  for (const row of cleanedItems) {
    for (const [k, v] of Object.entries(row)) {
      if (v === null) nullCounts[k] = (nullCounts[k] || 0) + 1;
    }
  }
  const qualityIssues = Object.entries(nullCounts)
    .filter(([, count]) => count > cleanedItems.length * 0.3) // >30% null = flag it
    .map(([col, count]) => `"${col}" missing in ${count}/${cleanedItems.length} rows`);

  return {
    boardName: board.name,
    totalRaw: rawItems.length,
    itemCount: cleanedItems.length,
    items: cleanedItems,
    dataQualityNotes: qualityIssues,
  };
}

// ─── Tool definitions (Gemini format) ────────────────────────────────────────
const tools = [
  {
    functionDeclarations: [
      {
        name: 'query_work_orders',
        description: `Fetch ALL live work order records from Monday.com Board ID ${WORK_ORDERS_BOARD_ID}.
Returns cleaned, normalized project execution data: deal names, customer codes, serial numbers,
nature of work, execution status (Completed/Not Started/Ongoing/Executed until current month),
sectors (Mining, Powerline, Railways, Renewables, Construction, DSP),
invoice details, amounts in Rupees excl/incl GST, billed values, collected amounts,
AR priority, quantities, invoice status, billing status, WO status, collection info.
Use for: project status, billing analysis, sector performance, collections, operational metrics.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Why you need this data — shown in action trace' },
          },
          required: ['reason'],
        },
      },
      {
        name: 'query_deals',
        description: `Fetch ALL live deal records from Monday.com Board ID ${DEALS_BOARD_ID}.
Returns cleaned, normalized sales pipeline data: deal names, owner codes, client codes,
deal status (Open/On Hold/Dead), close dates, closure probability (High/Medium/Low),
masked deal values, tentative close dates,
deal stages (Sales Qualified Leads / Demo Done / Feasibility / Proposal Sent /
Negotiations / Work Order Received / Projects On Hold),
product deal types, sector/service (Mining, Powerline, Renewables, Railways, DSP, Construction).
Use for: pipeline health, revenue forecast, sector analysis, deal stage funnel.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Why you need this data — shown in action trace' },
          },
          required: ['reason'],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You are a Business Intelligence agent for Skylark Drones — a drone services company operating in sectors like Mining, Powerline, Railways, Renewables, DSP, Construction, and more.

You have live access to two Monday.com boards. Data is pre-cleaned and normalized before you receive it.

BOARDS:
1. Work Orders — operational project data (billing, collections, execution status)
2. Deals — sales pipeline data (stage, probability, deal value, sector)

STRICT RULES:
- ALWAYS call the relevant tool(s) before answering. Never use memory or assumptions.
- For questions about pipeline/deals: call query_deals
- For questions about projects/billing/operations: call query_work_orders  
- If the question spans both: call BOTH tools
- If data_quality_notes is present in the result, mention relevant caveats to the user
- ALWAYS put data quality notes at the very END (if there are any), under a ### Data Quality Notes header.

FORMATTING:
- Use Indian number format: Lakhs (₹X.XX L) for <1Cr, Crores (₹X.XX Cr) for >=1Cr
- Use **bold** for key numbers and insights
- Use bullet points for lists
- Use ### for section headers when giving multi-section answers
- Keep responses concise but insightful — think like a startup CFO/analyst`;

// ─── Execute a tool call ──────────────────────────────────────────────────────
async function executeTool(name, args, send) {
  const isWorkOrders = name === 'query_work_orders';
  const boardId = isWorkOrders ? WORK_ORDERS_BOARD_ID : DEALS_BOARD_ID;
  const boardLabel = isWorkOrders ? 'Work Orders' : 'Deals';

  send({ type: 'tool_call', tool: name, boardId, boardLabel, reason: args.reason || 'Fetching data' });
  send({ type: 'tool_status', message: `📡 Querying Monday.com ${boardLabel} board...` });

  try {
    const { boardName, totalRaw, itemCount, items, dataQualityNotes } = await fetchBoardItems(boardId);
    send({ type: 'tool_status', message: `🧹 Cleaned data: ${itemCount} valid records (${totalRaw - itemCount} filtered out)` });
    if (dataQualityNotes.length > 0) {
      send({ type: 'tool_status', message: `⚠️ Quality notes: ${dataQualityNotes.slice(0, 2).join('; ')}` });
    }
    send({ type: 'tool_status', message: `✅ Sending ${itemCount} records to AI for analysis...` });
    return JSON.stringify({ board: boardName, total_records: itemCount, data_quality_notes: dataQualityNotes, data: items });
  } catch (err) {
    send({ type: 'tool_error', message: `❌ ${err.message}` });
    return JSON.stringify({ error: err.message });
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' });

  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
  if (!process.env.MONDAY_API_TOKEN)
    return res.status(500).json({ error: 'MONDAY_API_TOKEN is not set' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools,
    });

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));

    const lastMessage = messages[messages.length - 1].content;
    const chat = model.startChat({ history });

    let currentMessage = lastMessage;
    let iterations = 0;
    const MAX_ITERATIONS = 6;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const isFinalIteration = iterations === MAX_ITERATIONS;

      // Use streaming for the final text response, regular for tool-call rounds
      const streamResult = await chat.sendMessageStream(currentMessage);

      let fullText = '';
      const functionCalls = [];

      for await (const chunk of streamResult.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
          if (part.text) {
            // Stream text token by token to the UI
            fullText += part.text;
            send({ type: 'text_chunk', content: part.text });
          }
          if (part.functionCall) {
            functionCalls.push(part.functionCall);
          }
        }
      }

      // No function calls → we're done streaming
      if (functionCalls.length === 0) break;

      // Signal to UI that text so far was thinking/preamble (clear it if needed)
      if (fullText) send({ type: 'text_clear' });

      // Execute tools
      const functionResponses = [];
      for (const fc of functionCalls) {
        const toolResult = await executeTool(fc.name, fc.args, send);
        functionResponses.push({
          functionResponse: { name: fc.name, response: { result: toolResult } },
        });
      }

      currentMessage = functionResponses;
    }

    send({ type: 'done' });
  } catch (err) {
    console.error('Agent error:', err);
    send({ type: 'error', message: err.message || 'Unknown error' });
  }

  res.end();
}

export const config = { api: { responseLimit: false } };
