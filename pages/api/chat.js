import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MONDAY_API_URL = 'https://api.monday.com/v2';
const WORK_ORDERS_BOARD_ID = process.env.WORK_ORDERS_BOARD_ID || '5026985662';
const DEALS_BOARD_ID = process.env.DEALS_BOARD_ID || '5026985928';

// ─── Monday.com GraphQL fetcher ──────────────────────────────────────────────
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
    body: JSON.stringify({
      query: gql,
      variables: { boardId: [boardId] },
    }),
  });

  if (!res.ok) throw new Error(`Monday.com API error: ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.errors) throw new Error(`Monday.com GraphQL error: ${json.errors[0]?.message}`);

  const board = json.data?.boards?.[0];
  if (!board) throw new Error('Board not found');

  // Flatten each item into a plain object keyed by column title
  const items = board.items_page.items.map((item) => {
    const row = { _item_name: item.name };
    for (const col of item.column_values) {
      row[col.title] = col.text || null;
    }
    return row;
  });

  return { boardName: board.name, itemCount: items.length, items };
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────
const tools = [
  {
    name: 'query_work_orders',
    description: `Fetch ALL live work order records from Monday.com (Board ID: ${WORK_ORDERS_BOARD_ID}).
Returns project execution data: deal names, customer codes, serial numbers, nature of work,
execution status (Completed/Not Started/Ongoing/Executed until current month),
data delivery dates, PO/LOI dates, document types, start/end dates, BD/KAM personnel,
sectors (Mining, Powerline, Railways, Renewables, Construction, DSP, etc.),
type of work, invoice details, amounts in Rupees (excl/incl GST), billed values,
collected amounts, AR priority, quantities, invoice status, billing status, WO status, collection info.
Use for: project status, billing analysis, sector-wise performance, collections, operational metrics.`,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you need this data — shown in the action trace UI' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'query_deals',
    description: `Fetch ALL live deal records from Monday.com (Board ID: ${DEALS_BOARD_ID}).
Returns sales pipeline data: deal names, owner codes, client codes, deal status (Open/On Hold/Closed/Won/Lost),
close dates, closure probability (High/Medium/Low), masked deal values, tentative close dates,
deal stages (B. Sales Qualified Leads / C. Demo Done / D. Feasibility / E. Proposal/Commercials Sent /
F. Negotiations / H. Work Order Received / M. Projects On Hold),
product deal types, sector/service (Mining, Powerline, Renewables, Railways, DSP, Construction, etc.), created dates.
Use for: pipeline health, revenue forecast, sector analysis, deal stage funnel, closure probability breakdown.`,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you need this data — shown in the action trace UI' },
      },
      required: ['reason'],
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a Business Intelligence agent for Skylark Drones — a drone services company operating in sectors like Mining, Powerline, Railways, Renewables, DSP, Construction, and more.

You have live access to two Monday.com boards:
1. Work Orders — operational project data (billing, collections, execution status)
2. Deals — sales pipeline data (stage, probability, deal value, sector)

RULES:
- ALWAYS call the relevant tool(s) before answering any business question. Never answer from memory.
- If a question involves both pipeline and operations, query BOTH boards.
- Handle missing/null values gracefully. If data is incomplete, say so.
- Format large numbers in Indian number system: use Lakhs (₹X.XX L) and Crores (₹X.XX Cr).
- Provide insights and context, not just raw numbers. Think like a business analyst.
- For follow-up questions that reference prior context, still re-query if fresh data is needed.
- Mention data quality caveats when relevant (e.g., "X rows had missing sector data").
- Be concise but insightful. Use bullet points for lists. Bold key numbers.

Example insight style:
"The energy/Mining pipeline is strong with ₹4.2 Cr in open deals, though 3 are stuck in Negotiations stage — these may need follow-up."`;

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages provided' });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let loop = [...messages];
    let iterations = 0;
    const MAX_ITERATIONS = 8;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages: loop,
      });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const textBlocks = response.content.filter((b) => b.type === 'text');

      // Stream text to client
      for (const block of textBlocks) {
        if (block.text) send({ type: 'text', content: block.text });
      }

      // If no more tool calls, we're done
      if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) break;

      // Process each tool call
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const isWorkOrders = toolUse.name === 'query_work_orders';
        const boardId = isWorkOrders ? WORK_ORDERS_BOARD_ID : DEALS_BOARD_ID;
        const boardLabel = isWorkOrders ? 'Work Orders' : 'Deals';

        send({
          type: 'tool_call',
          tool: toolUse.name,
          boardId,
          boardLabel,
          reason: toolUse.input.reason,
          callId: toolUse.id,
        });

        let resultContent;
        try {
          send({ type: 'tool_status', message: `📡 Sending GraphQL request to Monday.com...` });

          const { boardName, itemCount, items } = await fetchBoardItems(boardId);

          send({
            type: 'tool_status',
            message: `✅ Received ${itemCount} records from "${boardName}" board`,
          });

          resultContent = JSON.stringify({ board: boardName, total_records: itemCount, data: items });
        } catch (err) {
          send({ type: 'tool_error', message: `❌ ${err.message}` });
          resultContent = JSON.stringify({ error: err.message, board: boardLabel });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: resultContent,
        });
      }

      // Advance the conversation with tool results
      loop = [
        ...loop,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    }

    send({ type: 'done' });
  } catch (err) {
    console.error('Agent error:', err);
    send({ type: 'error', message: err.message || 'Unknown error occurred' });
  }

  res.end();
}

export const config = { api: { responseLimit: false } };
