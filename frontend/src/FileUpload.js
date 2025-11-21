import React, { useState } from 'react';
import './fileUpload.css';
import api from './lib/api.js';

function FileUpload() { 
  const [files, setFiles] = useState([]);
  const [response, setResponse] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState({ currentBatch: 0, totalBatches: 0, percent: 0 });

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
    setResponse(null);
  };

  const MAX_BATCH_BYTES = 35 * 1024 * 1024; // 40 MB limit because Cloudflare has a 100mb limit :(

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


  const handleSubmit = async (event) => {
    event.preventDefault();
    const { accountId: userId } = await api.get('/api/auth/status');

    if (!files || files.length === 0) {
      alert('Please select files to upload');
      return;
    }

    const merged = {
      userId,
      totalFilesReceived: 0,
      totalFilesProcessed: 0,
      totalRows: 0,
      totalInserted: 0,
      totalDuplicatesOrExisting: 0,
      totalInvalidRows: 0,
      files: []
    };

    try {
      setIsUploading(true);
      const batches = chunkFilesBySize(files);
      setProgress({ currentBatch: 0, totalBatches: batches.length, percent: 0 });

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const formData = new FormData();
        batch.forEach((file) => formData.append('files', file));
        if (userId) formData.append('userId', userId);

        const res = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          throw new Error(`Failed to upload batch ${i + 1} (status ${res.status})`);
        }

        const responseData = await res.json();

        merged.totalFilesReceived += responseData.totalFilesReceived || 0;
        merged.totalFilesProcessed += responseData.totalFilesProcessed || 0;
        merged.totalRows += responseData.totalRows || 0;
        merged.totalInserted += responseData.totalInserted || 0;
        merged.totalDuplicatesOrExisting += responseData.totalDuplicatesOrExisting || 0;
        merged.totalInvalidRows += responseData.totalInvalidRows || 0;
        merged.files = merged.files.concat(responseData.files || []);

        const currentBatch = i + 1;
        const percent = batches.length ? Math.round((currentBatch / batches.length) * 100) : 100;
        setProgress({ currentBatch, totalBatches: batches.length, percent });
      }

      setResponse(merged);
    } catch (error) {
      console.error('Error uploading files:', error);
      alert(error.message || 'Error uploading files. Please try again.');
    } finally {
      setIsUploading(false);
      setTimeout(() => setProgress({ currentBatch: 0, totalBatches: 0, percent: 0 }), 800);
    }
  };

  return (
    <div className="file-upload-container">
      <h2>Upload Spotify Extended Streaming History</h2>
      <p>
        Upload all <strong>Streaming_History_Audio_*.json</strong> files from your Spotify data export.
        You can safely re-upload; duplicates will be ignored.
      </p>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          multiple
          accept=".json"
          onChange={handleFileChange}
        />
        {files.length > 0 && (
          <ul className="selected-files-list">
            {files.map((file) => (
              <li key={file.name}>{file.name}</li>
            ))}
          </ul>
        )}
        <button type="submit" disabled={isUploading}>
          {isUploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

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
                ? `Uploading batch ${progress.currentBatch} of ${progress.totalBatches} — ${progress.percent}%`
                : `Last upload: ${progress.currentBatch} of ${progress.totalBatches} — ${progress.percent}%`}
            </div>
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

          <h4>Per-file details</h4>
          <ul>
            {response.files.map((file) => (
              <li key={file.originalName}>
                <strong>{file.originalName}</strong> –{' '}
                {file.processed
                  ? `${file.inserted} inserted, ${file.duplicatesOrExisting} existing, ${file.invalidRows} invalid`
                  : `Skipped (${file.reasonSkipped || file.error})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FileUpload;
