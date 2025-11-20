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

  const handleSubmit = async (event) => {
    event.preventDefault();
    const { id : userId } = await api.get('https://api.spotify.com/v1/me');

    if (!files || files.length === 0) {
      alert('Please select files to upload');
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (userId) {
      formData.append('userId', userId);
    }

    try {
      setIsUploading(true);
      const res = await fetch('http://localhost:8081/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const responseData = await res.json();
        setResponse(responseData);
      } else {
        throw new Error('Failed to upload files');
      }

      // const data = await api.post('/api/upload', formData);
      // setResponse(data);
      
    } catch (error) {
      console.error('Error uploading files:', error);
      alert(error.message || 'Error uploading files. Please try again.');
    } finally {
      setIsUploading(false);
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
