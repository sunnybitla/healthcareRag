'use client';

import React, { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../utils/api';

interface Citation {
  num: number;
  filename: string;
  content: string;
}

interface Message {
  id: number;
  sender: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: string;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  messages: Message[];
}

interface ChatViewProps {
  token: string;
  userRole: string;
}

export default function ChatView({ token, userRole }: ChatViewProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Citations Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCitations, setDrawerCitations] = useState<Citation[]>([]);
  const [selectedCitationNum, setSelectedCitationNum] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Session History on mount (only for Registered Users & Admins)
  useEffect(() => {
    if (userRole !== 'Guest') {
      fetchHistory();
    }
  }, [userRole]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(getApiUrl('/api/history'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions(data);
        if (data.length > 0 && !activeSessionId) {
          setActiveSessionId(data[0].id);
          setMessages(data[0].messages);
        }
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
  };

  const handleSelectSession = (session: Session) => {
    setActiveSessionId(session.id);
    setMessages(session.messages);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessageText = input.trim();
    setInput('');
    setLoading(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: Date.now(),
      sender: 'user',
      content: userMessageText,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch(getApiUrl('/api/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: activeSessionId,
          message: userMessageText,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        
        // If this was a new session, update session list
        if (!activeSessionId && userRole !== 'Guest') {
          const newSession: Session = {
            id: data.session_id,
            title: userMessageText.substring(0, 30) + (userMessageText.length > 30 ? '...' : ''),
            created_at: new Date().toISOString(),
            messages: [tempUserMsg, data.message],
          };
          setSessions((prev) => [newSession, ...prev]);
          setActiveSessionId(data.session_id);
        }

        setMessages((prev) => [...prev, data.message]);
      } else {
        const errorData = await res.json();
        // Add error message to chat
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            sender: 'assistant',
            content: `Error: ${errorData.detail || 'Could not reach RAG agent.'}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'assistant',
          content: 'Network error. Please verify the FastAPI backend is running.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      if (userRole !== 'Guest') {
        fetchHistory();
      }
    }
  };

  const triggerPrompt = (promptText: string) => {
    setInput(promptText);
  };

  // Helper to render message content with clickable citations
  const renderMessageContent = (msg: Message) => {
    if (msg.sender === 'user') return msg.content;

    const citationMap = new Map<number, Citation>();
    if (msg.citations) {
      msg.citations.forEach((c) => citationMap.set(c.num, c));
    }

    // Split text by citation pattern like [1], [2]
    const parts = msg.content.split(/(\[\d+\])/g);
    
    return (
      <>
        {parts.map((part, index) => {
          const match = part.match(/^\[(\d+)\]$/);
          if (match) {
            const num = parseInt(match[1]);
            const citation = citationMap.get(num);
            if (citation) {
              return (
                <span
                  key={index}
                  className="citation-ref"
                  onClick={() => {
                    setDrawerCitations(msg.citations || []);
                    setSelectedCitationNum(num);
                    setDrawerOpen(true);
                  }}
                  title={`Source: ${citation.filename}`}
                >
                  {num}
                </span>
              );
            }
          }
          return part;
        })}
      </>
    );
  };

  return (
    <div className="chat-container">
      {/* Sessions History Column */}
      {userRole !== 'Guest' && (
        <div className="chat-sessions-sidebar">
          <button className="new-chat-btn" onClick={startNewChat}>
            + New Clinical Query
          </button>
          
          <div className="session-list">
            <h4 style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', marginTop: '0.5rem', textTransform: 'uppercase' }}>
              Recent Dialogs
            </h4>
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${activeSessionId === s.id ? 'active' : ''}`}
                onClick={() => handleSelectSession(s)}
              >
                {s.title}
              </button>
            ))}
            {sessions.length === 0 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', textAlign: 'center', padding: '1rem 0' }}>
                No past chat history.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="chat-main">
        <div className="chat-header">
          <div>
            <h3 style={{ fontSize: '1.1rem' }}>Clinical Dialog Assistant</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Provide guidelines to retrieve trusted medical references.
            </span>
          </div>
          {activeSessionId && userRole !== 'Guest' && (
            <button 
              onClick={startNewChat}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
            >
              Reset Chat
            </button>
          )}
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', maxWidth: '500px', textAlign: 'center' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0, 229, 255, 0.2)' }}>
                <span style={{ fontSize: '1.75rem', color: 'var(--primary)' }}>⚕️</span>
              </div>
              <div>
                <h2 style={{ fontSize: '1.4rem', marginBottom: '0.5rem', color: '#fff' }}>How can I help you today?</h2>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  Ask clinical questions. The model will parse the local guidelines DB and cite findings to prevent hallucinations.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', width: '100%', marginTop: '1rem' }}>
                <button 
                  className="session-item"
                  style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', whiteSpace: 'normal', height: 'auto', textAlign: 'center' }}
                  onClick={() => triggerPrompt("What are the diagnostic criteria for diabetes type 2?")}
                >
                  "Diagnostic criteria for diabetes type 2"
                </button>
                <button 
                  className="session-item"
                  style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', whiteSpace: 'normal', height: 'auto', textAlign: 'center' }}
                  onClick={() => triggerPrompt("List the pediatric asthma management steps according to guidelines.")}
                >
                  "Pediatric asthma management steps"
                </button>
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`message-bubble ${m.sender}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-dimmed)', marginBottom: '0.35rem', fontWeight: 600 }}>
                <span>{m.sender === 'user' ? 'Practitioner' : 'Clinical System'}</span>
                <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div style={{ whiteSpace: 'pre-line' }}>{renderMessageContent(m)}</div>
            </div>
          ))}
          {loading && (
            <div className="message-bubble assistant" style={{ alignSelf: 'flex-start', padding: '0.75rem 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)', animation: 'float 1s ease-in-out infinite' }}></div>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)', animation: 'float 1s ease-in-out infinite 0.2s' }}></div>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)', animation: 'float 1s ease-in-out infinite 0.4s' }}></div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>Searching guidelines...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="chat-input-area">
          <div className="chat-input-wrapper">
            <input
              type="text"
              placeholder={loading ? 'Processing query...' : 'Ask clinical query... (e.g. guidelines, dosing, screenings)'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="chat-input"
              disabled={loading}
            />
            <button type="submit" className="send-btn" disabled={loading || !input.trim()}>
              {loading ? '⏳' : '➔'}
            </button>
          </div>
          <div className="chat-disclaimer">
            Disclaimer: Intended for educational/information purposes only. Does not replace professional diagnostic decisions.
          </div>
        </form>
      </div>

      {/* Citations Sidebar Drawer */}
      <div className={`citations-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Medical Reference Chunks</h3>
          <button className="close-drawer-btn" onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <div className="drawer-body">
          {drawerCitations.map((c) => (
            <div
              key={c.num}
              className="citation-card"
              style={{
                borderColor: selectedCitationNum === c.num ? 'var(--primary)' : 'var(--border)',
                background: selectedCitationNum === c.num ? 'rgba(0, 229, 255, 0.03)' : 'rgba(255,255,255,0.01)',
              }}
            >
              <div className="citation-card-title">
                <span>Source [{c.num}]</span>
                <span style={{ color: 'var(--text-dimmed)' }}>File: {c.filename}</span>
              </div>
              <p className="citation-card-content">{c.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
