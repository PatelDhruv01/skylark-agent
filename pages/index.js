import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return `<p>${html}</p>`;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "How's our pipeline looking this quarter?",
  "Which sectors have the most open deals?",
  "Show me total revenue from completed work orders",
  "What's the breakdown of deals by stage?",
  "Which deals have high closure probability?",
  "How many work orders are fully billed vs partially billed?",
  "Compare Mining vs Powerline sector performance",
  "Prepare a leadership update summary",
];

// ─── Trace entry component ────────────────────────────────────────────────────
function TraceEntry({ entry }) {
  const styles = {
    start: { bg: '#1e2235', border: '#3b82f6', icon: '🚀' },
    tool_call: { bg: '#1a2640', border: '#6366f1', icon: '🔍' },
    tool_status: { bg: '#1a2030', border: '#10b981', icon: '📡' },
    tool_error: { bg: '#2a1a1a', border: '#ef4444', icon: '❌' },
    complete: { bg: '#1a2a1a', border: '#22c55e', icon: '✅' },
  };

  const s = styles[entry.type] || styles.start;

  return (
    <div style={{
      background: s.bg,
      borderLeft: `3px solid ${s.border}`,
      borderRadius: '6px',
      padding: '8px 12px',
      marginBottom: '8px',
      fontSize: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: entry.detail ? '4px' : '0' }}>
        <span>{s.icon} {entry.message}</span>
        <span style={{ color: '#64748b', marginLeft: '8px', whiteSpace: 'nowrap' }}>{entry.timestamp}</span>
      </div>
      {entry.detail && (
        <div style={{ color: '#94a3b8', marginTop: '4px', fontStyle: 'italic' }}>
          Reason: {entry.detail}
        </div>
      )}
      {entry.boardId && (
        <div style={{ color: '#6366f1', marginTop: '4px' }}>
          Board ID: {entry.boardId}
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '16px',
      gap: '10px',
      alignItems: 'flex-start',
    }}>
      {!isUser && (
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', flexShrink: 0,
        }}>🤖</div>
      )}
      <div style={{
        maxWidth: '75%',
        background: isUser
          ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
          : '#1e2235',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        padding: '12px 16px',
        lineHeight: '1.6',
        fontSize: '14px',
        border: isUser ? 'none' : '1px solid #2d3148',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <div
            className="markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
          />
        )}
        {msg.streaming && (
          <span style={{ display: 'inline-block', marginLeft: '4px' }}>
            <span style={{ animation: 'pulse 1s infinite', color: '#6366f1' }}>▋</span>
          </span>
        )}
      </div>
      {isUser && (
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', flexShrink: 0,
        }}>👤</div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `👋 **Welcome to Skylark Drones BI Agent**

I'm connected live to your Monday.com boards. Ask me anything about your business data — I'll query Monday.com in real time and give you founder-level insights.

**Try asking:**
- "How's our pipeline looking this quarter?"
- "Which sectors have the most deal value?"
- "Show me billing status breakdown for work orders"
- "Prepare a leadership update summary"`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionTrace, setActionTrace] = useState([]);
  const [traceVisible, setTraceVisible] = useState(true);

  const messagesEndRef = useRef(null);
  const traceEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [actionTrace]);

  const addTrace = (entry) =>
    setActionTrace((prev) => [
      ...prev,
      { ...entry, timestamp: new Date().toLocaleTimeString() },
    ]);

  const sendMessage = async (text) => {
    const query = text || input.trim();
    if (!query || loading) return;

    const userMsg = { role: 'user', content: query };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setActionTrace([]);
    addTrace({ type: 'start', message: `New query received` });

    // Build API messages (skip the initial greeting)
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
      let assistantText = '';
      let assistantAdded = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'text') {
              assistantText += data.content;
              setMessages((prev) => {
                if (!assistantAdded) {
                  assistantAdded = true;
                  return [...prev, { role: 'assistant', content: assistantText, streaming: true }];
                }
                return [
                  ...prev.slice(0, -1),
                  { role: 'assistant', content: assistantText, streaming: true },
                ];
              });

            } else if (data.type === 'tool_call') {
              addTrace({
                type: 'tool_call',
                message: `Querying ${data.boardLabel} board`,
                detail: data.reason,
                boardId: data.boardId,
              });

            } else if (data.type === 'tool_status') {
              addTrace({ type: 'tool_status', message: data.message });

            } else if (data.type === 'tool_error') {
              addTrace({ type: 'tool_error', message: data.message });

            } else if (data.type === 'error') {
              addTrace({ type: 'tool_error', message: data.message });
              setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `❌ Error: ${data.message}` },
              ]);

            } else if (data.type === 'done') {
              setMessages((prev) =>
                prev.map((m) => ({ ...m, streaming: false }))
              );
              addTrace({ type: 'complete', message: 'Response complete' });
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      addTrace({ type: 'tool_error', message: err.message });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ Connection error: ${err.message}` },
      ]);
    }

    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <Head>
        <title>Skylark Drones — BI Agent</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </Head>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>

        {/* ── Header ── */}
        <header style={{
          background: '#12151f',
          borderBottom: '1px solid #1e2235',
          padding: '0 24px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '32px', height: '32px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px',
            }}>🚁</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Skylark Drones BI Agent</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Live Monday.com Integration</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <a
              href="https://monday.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#ff3d57',
                color: '#fff',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              View Monday.com Boards ↗
            </a>
            <button
              onClick={() => setTraceVisible((v) => !v)}
              style={{
                background: '#1e2235',
                border: '1px solid #2d3148',
                color: '#94a3b8',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {traceVisible ? 'Hide' : 'Show'} Action Trace
            </button>
          </div>
        </header>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Chat panel ── */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRight: traceVisible ? '1px solid #1e2235' : 'none',
          }}>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {messages.map((msg, i) => (
                <Message key={i} msg={msg} />
              ))}

              {/* Loading indicator */}
              {loading && !messages[messages.length - 1]?.streaming && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
                  }}>🤖</div>
                  <div style={{
                    background: '#1e2235', borderRadius: '18px', padding: '12px 16px',
                    border: '1px solid #2d3148', display: 'flex', gap: '6px', alignItems: 'center',
                    fontSize: '13px', color: '#64748b',
                  }}>
                    <div style={{
                      width: '16px', height: '16px', border: '2px solid #6366f1',
                      borderTopColor: 'transparent', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    Querying Monday.com…
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggestion chips */}
            {messages.length <= 1 && (
              <div style={{
                padding: '0 24px 12px',
                display: 'flex', flexWrap: 'wrap', gap: '8px',
              }}>
                {SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={loading}
                    style={{
                      background: '#1e2235',
                      border: '1px solid #2d3148',
                      color: '#94a3b8',
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input area */}
            <div style={{
              padding: '12px 24px 20px',
              background: '#0f1117',
              borderTop: '1px solid #1e2235',
            }}>
              <div style={{
                display: 'flex', gap: '10px',
                background: '#1e2235',
                border: '1px solid #2d3148',
                borderRadius: '12px',
                padding: '8px 8px 8px 16px',
                alignItems: 'flex-end',
              }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask a business question… (e.g. 'How's our Mining pipeline?')"
                  disabled={loading}
                  rows={1}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: '#e2e8f0', fontSize: '14px', resize: 'none', lineHeight: '1.5',
                    maxHeight: '120px', overflowY: 'auto',
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim()}
                  style={{
                    width: '36px', height: '36px', borderRadius: '8px',
                    background: loading || !input.trim()
                      ? '#2d3148'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', flexShrink: 0, transition: 'all 0.2s',
                  }}
                >
                  {loading ? (
                    <div style={{
                      width: '14px', height: '14px', border: '2px solid #fff',
                      borderTopColor: 'transparent', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  ) : '➤'}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#3a3f5c', marginTop: '6px', textAlign: 'center' }}>
                Enter to send • Shift+Enter for new line • All queries fetch live data from Monday.com
              </div>
            </div>
          </div>

          {/* ── Action Trace Panel ── */}
          {traceVisible && (
            <div style={{
              width: '340px',
              display: 'flex',
              flexDirection: 'column',
              background: '#0d1020',
              flexShrink: 0,
            }}>
              <div style={{
                padding: '14px 16px 10px',
                borderBottom: '1px solid #1e2235',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0' }}>
                    🔍 Agent Action Trace
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Live API calls to Monday.com
                  </div>
                </div>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: loading ? '#f59e0b' : '#22c55e',
                  boxShadow: loading ? '0 0 6px #f59e0b' : '0 0 6px #22c55e',
                  animation: loading ? 'pulse 1s infinite' : 'none',
                }} />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {actionTrace.length === 0 ? (
                  <div style={{ color: '#3a3f5c', fontSize: '12px', textAlign: 'center', marginTop: '24px' }}>
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
                    Action trace will appear here when you send a query.
                    <br /><br />
                    You'll see every API call made to Monday.com in real time.
                  </div>
                ) : (
                  actionTrace.map((entry, i) => <TraceEntry key={i} entry={entry} />)
                )}
                <div ref={traceEndRef} />
              </div>

              {/* Board info */}
              <div style={{
                borderTop: '1px solid #1e2235',
                padding: '10px 12px',
                fontSize: '11px',
                color: '#3a3f5c',
              }}>
                <div style={{ marginBottom: '4px' }}>📋 Work Orders: <span style={{ color: '#6366f1' }}>ID {process.env.NEXT_PUBLIC_WORK_ORDERS_BOARD_ID || '5026985662'}</span></div>
                <div>💼 Deals: <span style={{ color: '#6366f1' }}>ID {process.env.NEXT_PUBLIC_DEALS_BOARD_ID || '5026985928'}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
