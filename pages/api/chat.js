import { GoogleGenerativeAI } from '@google/generative-ai';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const WORK_ORDERS_BOARD_ID = process.env.WORK_ORDERS_BOARD_ID || '5026985662';
const DEALS_BOARD_ID = process.env.DEALS_BOARD_ID || '5026985928';

// ─── Monday.com GraphQL fetcher ───────────────────────────────────────────────
async function fetchBoardItems(boardId) {
  const gql = `
    query GetBoardItems($boardId: [ID!]!) {
      boards(ids: $boardId) {
        name
        items_page(limit: 500) {
          items {
            id
            name
            column_values {
              id
              title
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

  const items = board.items_page.items.map((item) => {
    const row = { _item_name: item.name };
    for (const col of item.column_values) {
      row[col.title] = col.text || null;
    }
    return row;
  });

  return { boardName: board.name, itemCount: items.length, items };
}

// ─── Tool definitions (Gemini format) ────────────────────────────────────────
const tools = [
  {
    functionDeclarations: [
      {
        name: 'query_work_orders',
        description: `Fetch ALL live work order records from Monday.com Board ID ${WORK_ORDERS_BOARD_ID}.
Returns project execution data: deal names, customer codes, serial numbers, nature of work,
execution status (Completed/Not Started/Ongoing/Executed until current month),
sectors (Mining, Powerline, Railways, Renewables, Construction, DSP),
invoice details, amounts in Rupees excl/incl GST, billed values, collected amounts,
AR priority, quantities, invoice status, billing status, WO status, collection info.
Use for: project status, billing analysis, sector performance, collections, operational metrics.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: {
              type: 'STRING',
              description: 'Why you are querying this board — shown in the action trace',
            },
          },
          required: ['reason'],
        },
      },
      {
        name: 'query_deals',
        description: `Fetch ALL live deal records from Monday.com Board ID ${DEALS_BOARD_ID}.
Returns sales pipeline data: deal names, owner codes, client codes,
deal status (Open/On Hold), close dates, closure probability (High/Medium/Low),
masked deal values, tentative close dates,
deal stages (Sales Qualified Leads / Demo Done / Feasibility / Proposal Sent /
Negotiations / Work Order Received / Projects On Hold),
product deal types, sector/service (Mining, Powerline, Renewables, Railways, DSP, Construction).
Use for: pipeline health, revenue forecast, sector analysis, deal stage funnel.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: {
              type: 'STRING',
              description: 'Why you are querying this board — shown in the action trace',
            },
          },
          required: ['reason'],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You are a Business Intelligence agent for Skylark Drones — a drone services company operating in sectors like Mining, Powerline, Railways, Renewables, DSP, Construction, and more.

You have live access to two Monday.com boards:
1. Work Orders — operational project data (billing, collections, execution status)
2. Deals — sales pipeline data (stage, probability, deal value, sector)

RULES:
- ALWAYS call the relevant tool(s) before answering any business question. Never answer from memory.
- If a question involves both pipeline and operations, query BOTH boards.
- Handle missing/null values gracefully. If data is incomplete, say so.
- Format large numbers in Indian number system: use Lakhs (X.XX L) and Crores (X.XX Cr) with Rs. prefix.
- Provide insights and context, not just raw numbers. Think like a business analyst.
- Mention data quality caveats when relevant (e.g., "X rows had missing sector data").
- Be concise but insightful. Use bullet points for lists. Use **bold** for key numbers.`;

// ─── Execute a tool call ──────────────────────────────────────────────────────
async function executeTool(name, args, send) {
  const isWorkOrders = name === 'query_work_orders';
  const boardId = isWorkOrders ? WORK_ORDERS_BOARD_ID : DEALS_BOARD_ID;
  const boardLabel = isWorkOrders ? 'Work Orders' : 'Deals';

  send({
    type: 'tool_call',
    tool: name,
    boardId,
    boardLabel,
    reason: args.reason || 'Fetching board data',
  });

  send({ type: 'tool_status', message: `📡 Sending GraphQL request to Monday.com...` });

  try {
    const { boardName, itemCount, items } = await fetchBoardItems(boardId);
    send({ type: 'tool_status', message: `✅ Received ${itemCount} records from "${boardName}"` });
    return JSON.stringify({ board: boardName, total_records: itemCount, data: items });
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

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set in environment variables' });
  }
  if (!process.env.MONDAY_API_TOKEN) {
    return res.status(500).json({ error: 'MONDAY_API_TOKEN is not set in environment variables' });
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-lite',
      systemInstruction: SYSTEM_PROMPT,
      tools,
    });

    // Convert messages to Gemini format (role: "user" | "model")
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1].content;
    const chat = model.startChat({ history });

    // Agentic loop
    let currentMessage = lastMessage;
    let iterations = 0;
    const MAX_ITERATIONS = 6;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const result = await chat.sendMessage(currentMessage);
      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      const functionCalls = parts.filter((p) => p.functionCall);
      const textParts = parts.filter((p) => p.text);

      // Stream text to UI
      for (const part of textParts) {
        if (part.text) send({ type: 'text', content: part.text });
      }

      // No tool calls = done
      if (functionCalls.length === 0) break;

      // Execute tools and collect responses
      const functionResponses = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        const toolResult = await executeTool(name, args, send);
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: toolResult },
          },
        });
      }

      // Feed tool results back into the chat
      currentMessage = functionResponses;
    }

    send({ type: 'done' });
  } catch (err) {
    console.error('Agent error:', err);
    send({ type: 'error', message: err.message || 'Unknown error occurred' });
  }

  res.end();
}

export const config = { api: { responseLimit: false } };
