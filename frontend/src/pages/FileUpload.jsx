import React, { useEffect, useState } from 'react';
import '../styles/fileUpload.css';
import api from '../lib/api.js';
import { useQuery } from '@tanstack/react-query';

const MAX_BATCH_BYTES = 35 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'abandoned']);

function chunkFilesBySize(files) {
  const batches = [];
  let currentBatch = [];
  let currentSize = 0;

  for (const file of files) {
    if (currentBatch.length > 0 && currentSize + file.size > MAX_BATCH_BYTES) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(file);
    currentSize += file.size;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function createUploadId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeUploadKey(userId) {
  return `activeUpload:${userId}`;
}

function formatStatus(status) {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildSummaryFromJob(job) {
  if (!job) return null;
  return {
    ...(job.summary || {}),
    files: job.files || [],
  };
}

function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileUpload() {
  const [files, setFiles] = useState([]);
  const [response, setResponse] = useState(null);
  const [uploadJob, setUploadJob] = useState(null);
  const [activeUploadId, setActiveUploadId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [progress, setProgress] = useState({ currentBatch: 0, totalBatches: 0, percent: 0 });
  const { data: authStatusResp, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: false,
    staleTime: 30_000,
  });
  const authStatus = authStatusResp?.spotifyUser || null;
  const userId = authStatus?.id || null;

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
    setResponse(null);
    setUploadJob(null);
  };

  useEffect(() => {
    if (!userId || activeUploadId) return;
    const storedUploadId = window.localStorage.getItem(activeUploadKey(userId));
    if (storedUploadId) {
      setActiveUploadId(storedUploadId);
      setUploadJob({ uploadId: storedUploadId, status: 'queued' });
    }
  }, [activeUploadId, userId]);

  useEffect(() => {
    if (!userId || !activeUploadId) return undefined;

    let cancelled = false;
    let timeoutId = null;
    let pollCount = 0;

    async function poll() {
      setIsPolling(true);
      try {
        const job = await api.get(`/api/upload/status/${encodeURIComponent(activeUploadId)}`, {
          timeout: 15000,
        });
        if (cancelled) return;

        setUploadJob(job);
        if (TERMINAL_STATUSES.has(job.status)) {
          window.localStorage.removeItem(activeUploadKey(userId));
          setActiveUploadId(null);
          setIsPolling(false);
          if (job.files?.length || job.status === 'succeeded') {
            setResponse(buildSummaryFromJob(job));
          }
          return;
        }

        pollCount += 1;
        timeoutId = window.setTimeout(poll, pollCount < 15 ? 2000 : 5000);
      } catch (err) {
        if (cancelled) return;
        console.error('Error polling upload status:', err);
        if (err.status === 404) {
          window.localStorage.removeItem(activeUploadKey(userId));
          setActiveUploadId(null);
          setIsPolling(false);
          setUploadJob({
            uploadId: activeUploadId,
            status: 'failed',
            error: 'Upload status was not found.',
          });
          return;
        }
        pollCount += 1;
        timeoutId = window.setTimeout(poll, 5000);
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activeUploadId, userId]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!files || files.length === 0) {
      alert('Please select files to upload');
      return;
    }

    if (!userId) {
      alert('Please sign in before uploading files.');
      return;
    }

    const oversizedFiles = files.filter((file) => file.size > MAX_FILE_BYTES);
    if (oversizedFiles.length > 0) {
      const fileList = oversizedFiles
        .map((file) => `${file.name} (${formatFileSize(file.size)})`)
        .join('\n');
      alert(`Each file must be ${formatFileSize(MAX_FILE_BYTES)} or smaller:\n${fileList}`);
      return;
    }

    const uploadId = createUploadId();

    try {
      setResponse(null);
      setUploadJob({ uploadId, status: 'uploading' });
      setIsUploading(true);

      const batches = chunkFilesBySize(files);
      setProgress({ currentBatch: 0, totalBatches: batches.length, percent: 0 });

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const formData = new FormData();
        batch.forEach((file) => formData.append('files', file));

        const res = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/upload`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers: {
            'X-Upload-Id': uploadId,
            ...(i === batches.length - 1 ? { 'X-Last-Batch': 'true' } : {}),
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to upload batch ${i + 1} (status ${res.status})`);
        }

        const responseData = await res.json();
        setUploadJob(responseData);
        if (i === 0) {
          setActiveUploadId(uploadId);
          window.localStorage.setItem(activeUploadKey(userId), uploadId);
        }

        const currentBatch = i + 1;
        const percent = batches.length ? Math.round((currentBatch / batches.length) * 100) : 100;
        setProgress({ currentBatch, totalBatches: batches.length, percent });
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      setActiveUploadId(null);
      window.localStorage.removeItem(activeUploadKey(userId));
      setUploadJob({ uploadId, status: 'failed', error: error.message });
      alert(error.message || 'Error uploading files. Please try again.');
    } finally {
      setIsUploading(false);
      setTimeout(() => setProgress({ currentBatch: 0, totalBatches: 0, percent: 0 }), 800);
    }
  };

  if (authLoading) {
    return (
      <div className="file-upload-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, border: '4px solid #eee', borderTopColor: '#1DB954', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Checking session...</div>
          <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
        </div>
      </div>
    );
  }

  const busy = isUploading || (isPolling && uploadJob && !TERMINAL_STATUSES.has(uploadJob.status));
  const showJobStatus = uploadJob && uploadJob.status && uploadJob.status !== 'uploading';

  return (
    <div className="file-upload-container">
      <h2>Upload Spotify Extended Streaming History</h2>
      <p>
        Upload all <strong>Streaming_History_Audio_*.json</strong> files from your Spotify data export.
        You can safely re-upload; duplicates will be ignored.
      </p>

      {authStatus?.is_guest && (
        <div className="guest-cta-box" style={{ border: '1px solid #1DB954', padding: 12, borderRadius: 6, marginBottom: 12 }}>
          <strong>Uploads are disabled for guest sessions.</strong>
          <div style={{ marginTop: 10 }}>
          </div>
        </div>
      )}

      {!authStatus?.is_guest && (
        <form onSubmit={handleSubmit}>
        <input
          type="file"
          multiple
          accept=".json"
          onChange={handleFileChange}
          disabled={busy}
        />
        {files.length > 0 && (
          <ul className="selected-files-list">
            {files.map((file) => (
              <li key={file.name}>{file.name}</li>
            ))}
          </ul>
        )}
        <button type="submit" disabled={busy}>
          {isUploading ? 'Uploading...' : busy ? 'Processing...' : 'Upload'}
        </button>
        </form>
      )}

      {progress.totalBatches > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 24, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress.percent}%`,
                  height: '100%',
                  background: '#4caf50',
                  transition: 'width 240ms ease'
                }}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>
              {isUploading
                ? `Uploading batch ${progress.currentBatch} of ${progress.totalBatches} - ${progress.percent}%`
                : `Last upload: ${progress.currentBatch} of ${progress.totalBatches} - ${progress.percent}%`}
            </div>
          </div>
        )}

      {showJobStatus && (
        <div className="response-container">
          <h3>Upload Status</h3>
          <p>Status: {formatStatus(uploadJob.status)}</p>
          <p>Files accepted: {uploadJob.filesAccepted ?? uploadJob.files?.length ?? 0}</p>
          {uploadJob.summary && (
            <>
              <p>Total files processed: {uploadJob.summary.totalFilesProcessed || 0}</p>
              <p>Total rows in files: {uploadJob.summary.totalRows || 0}</p>
              <p>New rows inserted: {uploadJob.summary.totalInserted || 0}</p>
              <p>Existing/duplicate rows: {uploadJob.summary.totalDuplicatesOrExisting || 0}</p>
              <p>Invalid rows skipped: {uploadJob.summary.totalInvalidRows || 0}</p>
            </>
          )}
          {(uploadJob.status === 'failed' || uploadJob.status === 'abandoned') && (
            <p>Error: {uploadJob.error || 'Upload did not complete.'}</p>
          )}
        </div>
      )}

      {response && (
        <div className="response-container">
          <h3>Upload Summary</h3>
          <p>User ID: {response.userId}</p>
          <p>Total files received: {response.totalFilesReceived}</p>
          <p>Total files processed: {response.totalFilesProcessed}</p>
          <p>Total rows in files: {response.totalRows}</p>
          <p>New rows inserted: {response.totalInserted}</p>
          <p>Existing/duplicate rows: {response.totalDuplicatesOrExisting}</p>
          <p>Invalid rows skipped: {response.totalInvalidRows}</p>
          <p>Normalized rows: {response.totalNormalized || 0}</p>
          <p>New normalized rows inserted: {response.totalNormalizedInserted || 0}</p>

          <h4>Per-file details</h4>
          <ul>
            {(response.files || []).map((file) => (
              <li key={file.fileId || file.originalName}>
                <strong>{file.originalName}</strong> -{' '}
                {file.processed
                  ? `${file.inserted} inserted, ${file.duplicatesOrExisting} existing, ${file.invalidRows} invalid`
                  : `Skipped (${file.reasonSkipped || file.error || 'not processed'})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
