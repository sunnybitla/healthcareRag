'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Document {
  id: number;
  filename: string;
  file_size: number;
  uploaded_by: string;
  upload_time: string;
  status: string;
}

interface DocumentManagerProps {
  token: string;
  userRole: string;
}

export default function DocumentManager({ token, userRole }: DocumentManagerProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleExpiredSession = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    window.location.reload();
  };

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
        return;
      }

      if (res.status === 401) {
        const errorData = await res.json().catch(() => ({ detail: 'Session expired.' }));
        if ((errorData.detail || '').toLowerCase().includes('session expired')) {
          handleExpiredSession();
          return;
        }
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (userRole !== 'Admin') {
      setMessage({ text: 'Only administrators have permissions to upload documents.', type: 'error' });
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (userRole !== 'Admin') {
      setMessage({ text: 'Only administrators have permissions to upload documents.', type: 'error' });
      return;
    }

    if (e.target.files && e.target.files[0]) {
      uploadFile(e.target.files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    // Validate file type
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.pdf' && ext !== '.txt') {
      setMessage({ text: 'Invalid file format. Only PDF and TXT guidelines are supported.', type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);
    setProgress(20);

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Simulate progress progression
      const interval = setInterval(() => {
        setProgress((prev) => (prev < 90 ? prev + 10 : prev));
      }, 300);

      const res = await fetch(`${backendUrl}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      clearInterval(interval);
      setProgress(100);

      if (res.ok) {
        const data = await res.json();
        setMessage({
          text: `Successfully uploaded and indexed "${file.name}" into ${data.chunks} chunks.`,
          type: 'success',
        });
        fetchDocuments();
      } else {
        const errorData = await res.json().catch(() => ({ detail: 'Ingestion engine failed.' }));
        if (res.status === 401 && (errorData.detail || '').toLowerCase().includes('session expired')) {
          setMessage({ text: 'Session expired. Please log in again.', type: 'error' });
          handleExpiredSession();
          return;
        }
        setMessage({ text: `Failed: ${errorData.detail || 'Ingestion engine failed.'}`, type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network upload failed. Ensure the server is online.', type: 'error' });
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 500);
    }
  };

  const handleDelete = async (id: number) => {
    if (userRole !== 'Admin') {
      alert('Requires Admin role.');
      return;
    }

    if (!confirm('Are you sure you want to delete this guideline document? All vectorized chunks will be deleted.')) {
      return;
    }

    try {
      const res = await fetch(`${backendUrl}/api/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMessage({ text: 'Document deleted successfully.', type: 'success' });
        fetchDocuments();
      } else {
        const errorData = await res.json().catch(() => ({ detail: 'Could not delete.' }));
        if (res.status === 401 && (errorData.detail || '').toLowerCase().includes('session expired')) {
          setMessage({ text: 'Session expired. Please log in again.', type: 'error' });
          handleExpiredSession();
          return;
        }
        setMessage({ text: `Failed: ${errorData.detail || 'Could not delete.'}`, type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Failed to delete due to network error.', type: 'error' });
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
      <div>
        <h2 style={{ fontSize: '1.5rem', color: '#fff', marginBottom: '0.25rem' }}>Clinical Guidelines Repository</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Upload reference text or PDF materials to build the RAG database.
        </p>
      </div>

      {userRole === 'Admin' ? (
        <div
          className={`upload-zone ${dragActive ? 'dragover' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept=".pdf,.txt"
            disabled={uploading}
          />
          <div className="upload-icon">📥</div>
          {uploading ? (
            <div style={{ width: '100%', maxWidth: '300px' }}>
              <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem', fontWeight: 600 }}>Indexing document content...</p>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', transition: 'width 0.2s' }}></div>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontWeight: 600, fontSize: '1rem', color: '#fff', marginBottom: '0.25rem' }}>
                Drag & Drop PDF/TXT guidelines here
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>
                or click to browse local files (max size 20MB)
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '1.25rem', border: '1px solid rgba(245, 158, 11, 0.15)', background: 'rgba(245, 158, 11, 0.05)', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--warning)' }}>
          🔒 Upload functions are restricted to **Admin** users. Guests and Registered practitioners may query the index.
        </div>
      )}

      {message && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            border: '1px solid',
            borderColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            background: message.type === 'success' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
            color: message.type === 'success' ? 'var(--success)' : 'var(--error)',
          }}
        >
          {message.text}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '1rem' }}>Active Guildelines ({documents.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="document-table">
            <thead>
              <tr>
                <th>Guideline Name</th>
                <th>File Size</th>
                <th>Uploaded By</th>
                <th>Upload Date</th>
                <th>Indexing Status</th>
                {userRole === 'Admin' && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={{ fontWeight: 500, color: '#fff' }}>{doc.filename}</td>
                  <td>{formatBytes(doc.file_size)}</td>
                  <td>{doc.uploaded_by}</td>
                  <td>{new Date(doc.upload_time).toLocaleDateString()}</td>
                  <td>
                    <span className={`doc-status ${doc.status.toLowerCase()}`}>
                      {doc.status}
                    </span>
                  </td>
                  {userRole === 'Admin' && (
                    <td>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          padding: '0.2rem',
                          borderRadius: '4px',
                          transition: 'color 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--error)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                        title="Delete Document & Chunks"
                      >
                        🗑️
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={userRole === 'Admin' ? 6 : 5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No guideline documents indexed in vector store.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
