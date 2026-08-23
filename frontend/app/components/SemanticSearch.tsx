'use client';

import React, { useState } from 'react';
import { getApiUrl } from '../utils/api';

interface SearchResult {
  chunk_id: number;
  document_id: number;
  filename: string;
  content: string;
  score: number;
}

interface SemanticSearchProps {
  token: string;
}

export default function SemanticSearch({ token }: SemanticSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(getApiUrl(`/api/search?q=${encodeURIComponent(query.trim())}&limit=6`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data);
      }
    } catch (err) {
      console.error('Failed to run semantic search:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card" style={{ width: '100%', maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: '#fff', marginBottom: '0.25rem' }}>Semantic Search In Guidelines</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Directly query clinical guidelines. Returns raw matching text fragments and confidence scoring.
        </p>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem' }}>
        <input
          type="text"
          placeholder="Type clinical query (e.g. 'Aspirin dosing guidelines', 'hypertension risk factors')..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="chat-input"
          style={{ flexGrow: 1 }}
          disabled={loading}
        />
        <button type="submit" className="btn-primary" style={{ padding: '0 1.5rem' }} disabled={loading || !query.trim()}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            🔍 Executing embedding similarity lookup...
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-dimmed)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
            No relevant clinical matching segments were retrieved. Try adjusting your query or upload more guidelines.
          </div>
        )}

        {!loading && results.map((res, idx) => (
          <div
            key={idx}
            style={{
              padding: '1.25rem',
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              transition: 'var(--transition)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(0, 229, 255, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{res.filename}</span>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dimmed)' }}>Score:</span>
                <span
                  style={{
                    color: res.score > 0.7 ? 'var(--success)' : 'var(--warning)',
                    fontWeight: 700,
                    background: res.score > 0.7 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                  }}
                >
                  {Math.round(res.score * 100)}%
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {res.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
