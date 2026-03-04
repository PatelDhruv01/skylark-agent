import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

// ─── Markdown renderer ────────────────────────────────────────────────────────
// Converts Gemini's markdown output to clean HTML
function MarkdownRenderer({ text }) {
  const html = renderMarkdown(text);
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderMarkdown(text) {
  if (!text) return '';
  let t = text;

  // Tables
  t = t.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (match) => {
    const lines = match.trim().split('\n').filter((l) => !l.match(/^\|[-| :]+\|$/));
    const [header, ...rows] = lines;
    const ths = header.split('|').filter((c) => c.trim()).map((c) => `<th>${c.trim()}</th>`).join('');
    const trs = rows.map((r) =>
      '<tr>' + r.split('|').filter((c) => c.trim()).map((c) => `<td>${c.trim()}</td>`).join('') + '</tr>'
    ).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });

  // Code blocks
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Headers
  t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  t = t.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold + italic
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bullet lists — keep consecutive items together, no <p> wrapping
  t = t.replace(/^[\-\*•] (.+)$/gm, '<li>$1</li>');
  t = t.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Numbered lists
  t = t.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Horizontal rule
  t = t.replace(/^---+$/gm, '<hr/>');

  // Paragraphs — only wrap blocks that aren't already HTML tags
  t = t.split(/\n\n+/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    // Don't wrap if already an HTML block element
    if (trimmed.match(/^<(h[1-6]|ul|ol|li|pre|table|thead|tbody|tr|hr|blockquote)/)) return trimmed;
    // Don't wrap lone <li> lines (they get grouped above)
    if (trimmed.startsWith('<li>')) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
  }).filter(Boolean).join('\n');

  return t;
}

// ─── Streaming cursor ─────────────────────────────────────────────────────────
function StreamCursor() {
  return <span className="stream-cursor">▋</span>;
}

// ─── Trace entry ──────────────────────────────────────────────────────────────
function TraceEntry({ entry }) {
  const config = {
    start:       { border: '#3b82f6', bg: '#0f1e3d', icon: '🚀' },
    tool_call:   { border: '#8b5cf6', bg: '#1a1040', icon: '🔍' },
    tool_status: { border: '#10b981', bg: '#0a2018', icon: '📡' },
    tool_error:  { border: '#ef4444', bg: '#2a0a0a', icon: '❌' },
    complete:    { border: '#22c55e', bg: '#0a2018', icon: '✅' },
  };
  const c = config[entry.type] || config.start;

  return (
    <div style={{
      borderLeft: `3px solid ${c.border}`,
      background: c.bg,
      borderRadius: '0 6px 6px 0',
      padding: '8px 12px',
      marginBottom: '6px',
      fontSize: '12px',
      lineHeight: '1.5',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#cbd5e1' }}>{c.icon} {entry.message}</span>
        <span style={{ color: '#475569', flexShrink: 0, fontSize: '11px' }}>{entry.timestamp}</span>
      </div>
      {entry.reason && (
        <div style={{ color: '#64748b', marginTop: '3px', fontSize: '11px' }}>
          ↳ {entry.reason}
        </div>
      )}
      {entry.boardId && (
        <div style={{ color: '#6366f1', marginTop: '3px', fontSize: '11px' }}>
          Board ID: {entry.boardId}
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '20px',
      gap: '10px',
      alignItems: 'flex-start',
    }}>
      {!isUser && (
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '17px', flexShrink: 0, marginTop: '2px',
          boxShadow: '0 0 12px rgba(99,102,241,0.4)',
        }}>🤖</div>
      )}

      <div style={{
        maxWidth: isUser ? '65%' : '80%',
        background: isUser
          ? 'linear-gradient(135deg, #4338ca, #7c3aed)'
          : '#141728',
        borderRadius: isUser ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
        padding: isUser ? '10px 16px' : '14px 18px',
        fontSize: '14px',
        lineHeight: '1.7',
        border: isUser ? 'none' : '1px solid #1e2540',
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        color: isUser ? '#f0f4ff' : '#cbd5e1',
      }}>
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <>
            <MarkdownRenderer text={msg.content} />
            {msg.streaming && <StreamCursor />}
          </>
        )}
      </div>

      {isUser && (
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '17px', flexShrink: 0, marginTop: '2px',
        }}>👤</div>
      )}
    </div>
  );
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "How's our pipeline looking this quarter?",
  "Which sectors have the most open deals?",
  "Show total revenue from completed work orders",
  "What's the deal stage funnel breakdown?",
  "Which deals have high closure probability?",
  "Compare billing status across work orders",
  "Prepare a leadership update summary",
  "Which sector has the highest receivables?",
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `## 👋 Welcome to Skylark Drones BI Agent

I'm connected **live** to your Monday.com boards. Ask me anything about your business data — I fetch real-time data and give you founder-level insights.

**Try asking:**
- *"How's our pipeline looking this quarter?"*
- *"Which sectors have the most deal value?"*
- *"Prepare a leadership update summary"*`,
    },
  ]);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionTrace, setActionTrace] = useState([]);
  const [traceOpen, setTraceOpen] = useState(true);

  const messagesEndRef = useRef(null);
  const traceEndRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [actionTrace]);

  const addTrace = (entry) =>
    setActionTrace((prev) => [...prev, { ...entry, timestamp: new Date().toLocaleTimeString() }]);

  const sendMessage = async (text) => {
    const query = (text || input).trim();
    if (!query || loading) return;

    setInput('');
    setLoading(true);
    setActionTrace([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    addTrace({ type: 'start', message: `Processing query...` });

    const userMsg = { role: 'user', content: query };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // Build API payload (skip the initial greeting message)
    const apiMessages = newMessages
      .filter((m, i) => !(i === 0 && m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamingContent = '';
      let messageAdded = false;

      const updateStreamingMessage = (content, streaming = true) => {
        setMessages((prev) => {
          if (!messageAdded) {
            messageAdded = true;
            return [...prev, { role: 'assistant', content, streaming }];
          }
          return [...prev.slice(0, -1), { role: 'assistant', content, streaming }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true })
          .split('\n')
          .filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'text_chunk') {
              // Real-time streaming — append each token
              streamingContent += data.content;
              updateStreamingMessage(streamingContent, true);

            } else if (data.type === 'text_clear') {
              // AI was thinking aloud before tool call — clear it
              streamingContent = '';
              messageAdded = false;

            } else if (data.type === 'tool_call') {
              addTrace({ type: 'tool_call', message: `Querying ${data.boardLabel} board`, reason: data.reason, boardId: data.boardId });

            } else if (data.type === 'tool_status') {
              addTrace({ type: 'tool_status', message: data.message });

            } else if (data.type === 'tool_error') {
              addTrace({ type: 'tool_error', message: data.message });

            } else if (data.type === 'error') {
              addTrace({ type: 'tool_error', message: data.message });
              updateStreamingMessage(`❌ **Error:** ${data.message}`, false);

            } else if (data.type === 'done') {
              // Finalize — remove streaming cursor
              updateStreamingMessage(streamingContent, false);
              addTrace({ type: 'complete', message: 'Response complete ✓' });
            }
          } catch (_) { /* skip malformed SSE lines */ }
        }
      }
    } catch (err) {
      addTrace({ type: 'tool_error', message: err.message });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ **Connection error:** ${err.message}`, streaming: false },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  return (
    <>
      <Head>
        <title>Skylark Drones — BI Agent</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0d18' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={{
          background: '#0d1020',
          borderBottom: '1px solid #1a2040',
          padding: '0 20px',
          height: '54px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          boxShadow: '0 1px 20px rgba(0,0,0,0.5)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px', height: '34px',
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px',
              boxShadow: '0 0 16px rgba(99,102,241,0.5)',
            }}>🚁</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#f0f4ff', letterSpacing: '0.01em' }}>
                Skylark Drones BI Agent
              </div>
              <div style={{ fontSize: '11px', color: '#475569' }}>
                Live Monday.com Integration · Powered by Gemini
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: '#0a1a12', border: '1px solid #14532d',
              borderRadius: '6px', padding: '4px 10px',
              fontSize: '11px', color: '#4ade80',
            }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
                animation: loading ? 'pulse 1s infinite' : 'none',
              }} />
              {loading ? 'Fetching live data...' : 'Connected'}
            </div>

            <a
              href="https://monday.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#ff3d57', color: '#fff',
                padding: '5px 12px', borderRadius: '6px',
                fontSize: '12px', textDecoration: 'none', fontWeight: 600,
              }}
            >📋 View Boards ↗</a>

            <button
              onClick={() => setTraceOpen((v) => !v)}
              style={{
                background: '#141728', border: '1px solid #1e2540',
                color: '#94a3b8', padding: '5px 12px',
                borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
              }}
            >
              {traceOpen ? '◀ Hide' : '▶ Show'} Trace
            </button>
          </div>
        </header>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Chat ────────────────────────────────────────────────────── */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            borderRight: traceOpen ? '1px solid #1a2040' : 'none',
          }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
              {messages.map((msg, i) => <Message key={i} msg={msg} />)}

              {/* Loading spinner when AI hasn't started typing yet */}
              {loading && !messages[messages.length - 1]?.streaming && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px',
                  }}>🤖</div>
                  <div style={{
                    background: '#141728', border: '1px solid #1e2540',
                    borderRadius: '4px 18px 18px 18px',
                    padding: '12px 16px', display: 'flex', gap: '8px', alignItems: 'center',
                    fontSize: '13px', color: '#64748b',
                  }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[0, 1, 2].map((i) => (
                        <div key={i} style={{
                          width: '7px', height: '7px', borderRadius: '50%', background: '#6366f1',
                          animation: `bounce 1.2s ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                    Querying Monday.com…
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggestion chips — show only at start */}
            {messages.length <= 1 && (
              <div style={{ padding: '0 20px 10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={loading}
                    style={{
                      background: '#141728', border: '1px solid #2d3561',
                      color: '#94a3b8', padding: '7px 14px',
                      borderRadius: '20px', fontSize: '12px',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { e.target.style.borderColor = '#6366f1'; e.target.style.color = '#a5b4fc'; }}
                    onMouseLeave={(e) => { e.target.style.borderColor = '#2d3561'; e.target.style.color = '#94a3b8'; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input area */}
            <div style={{ padding: '10px 20px 18px', borderTop: '1px solid #1a2040', background: '#0a0d18' }}>
              <div style={{
                display: 'flex', gap: '10px', alignItems: 'flex-end',
                background: '#141728', border: '1px solid #2d3561',
                borderRadius: '14px', padding: '10px 10px 10px 16px',
                transition: 'border-color 0.15s',
              }}>
                <textarea
                  ref={(el) => { inputRef.current = el; textareaRef.current = el; }}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a business question… e.g. 'How's our Mining pipeline this quarter?'"
                  disabled={loading}
                  rows={1}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: '#e2e8f0', fontSize: '14px', resize: 'none',
                    lineHeight: '1.6', maxHeight: '150px', fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim()}
                  style={{
                    width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                    background: (loading || !input.trim())
                      ? '#1e2540'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none',
                    cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', transition: 'all 0.2s',
                    boxShadow: (loading || !input.trim()) ? 'none' : '0 0 12px rgba(99,102,241,0.5)',
                  }}
                >
                  {loading ? (
                    <div style={{
                      width: '14px', height: '14px',
                      border: '2px solid #475569', borderTopColor: '#94a3b8',
                      borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                    }} />
                  ) : '➤'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#2d3561', marginTop: '6px', textAlign: 'center' }}>
                Enter to send · Shift+Enter for new line · Every query fetches live data from Monday.com
              </div>
            </div>
          </div>

          {/* ── Action Trace Panel ───────────────────────────────────────── */}
          {traceOpen && (
            <div style={{
              width: '320px', display: 'flex', flexDirection: 'column',
              background: '#080b14', flexShrink: 0,
            }}>
              <div style={{
                padding: '12px 14px 10px',
                borderBottom: '1px solid #1a2040',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>
                    🔍 Agent Action Trace
                  </div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '1px' }}>
                    Live API calls · Data cleaning log
                  </div>
                </div>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: loading ? '#f59e0b' : '#22c55e',
                  boxShadow: `0 0 8px ${loading ? '#f59e0b' : '#22c55e'}`,
                  animation: loading ? 'pulse 1s infinite' : 'none',
                }} />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                {actionTrace.length === 0 ? (
                  <div style={{ color: '#2d3561', fontSize: '12px', textAlign: 'center', paddingTop: '32px' }}>
                    <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
                    <div style={{ color: '#475569' }}>
                      Send a query to see live API calls, data cleaning steps, and record counts here.
                    </div>
                  </div>
                ) : (
                  actionTrace.map((entry, i) => <TraceEntry key={i} entry={entry} />)
                )}
                <div ref={traceEndRef} />
              </div>

              {/* Board info footer */}
              <div style={{ borderTop: '1px solid #1a2040', padding: '10px 14px', fontSize: '11px' }}>
                <div style={{ color: '#475569', marginBottom: '4px', fontWeight: 600 }}>CONNECTED BOARDS</div>
                <div style={{ color: '#475569', marginBottom: '3px' }}>
                  📋 Work Orders
                  <span style={{ color: '#4f46e5', marginLeft: '6px' }}>ID 5026985662</span>
                </div>
                <div style={{ color: '#475569' }}>
                  💼 Deals
                  <span style={{ color: '#4f46e5', marginLeft: '6px' }}>ID 5026985928</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
