import React, { useState } from 'react';
import './fileUpload.css';
import api from './lib/api.js';

function FileUpload() { 
  const [files, setFiles] = useState([]);
  const [response, setResponse] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (event) => {
    setFiles(Array.from(event.target.files));
    setResponse(null);
  };

  const MAX_BATCH_BYTES = 80 * 1024 * 1024; // 80 MB limit because Cloudflare has a 100mb limit :(

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
    const { id : userId } = await api.get('https://api.spotify.com/v1/me');

    if (!files || files.length === 0) {
      alert('Please select files to upload');
      return;
    }
    // const formData = new FormData();
    // files.forEach((file) => formData.append('files', file));
    // if (userId) {
    //   formData.append('userId', userId);
    // }

    try {
      setIsUploading(true);
      const batches = chunkFilesBySize(files);
      const allSummaries = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const formData = new FormData();
        batch.forEach((file) => formData.append('files', file));
        if (userId) formData.append('userId', userId);

        const res = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/upload`, {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const responseData = await res.json();
          allSummaries.push(responseData);
          setResponse(responseData);
        } else {
          throw new Error('Failed to upload files');
        }
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      alert(error.message || 'Error uploading files. Please try again.');
    } finally {
      setIsUploading(false);
      console.log(allSummaries);
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
