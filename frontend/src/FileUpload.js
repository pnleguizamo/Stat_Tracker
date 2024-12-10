import React, { useState } from 'react';
import './fileUpload.css'; // Import the CSS file

function FileUpload() {
    const [files, setFiles] = useState(null);
    const [response, setResponse] = useState(null);

    const handleFileChange = (event) => {
        setFiles(event.target.files);
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!files) {
            alert('Please select files to upload');
            return;
        }

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        try {
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
        } catch (error) {
            console.error('Error uploading files:', error);
            alert('Error uploading files. Please try again.');
        }
    };

    return (
        <div className="file-upload-container">
            <h2>Upload Spotify JSON Files</h2>
            <form onSubmit={handleSubmit}>
                <input type="file" multiple accept=".json" onChange={handleFileChange} />
                <button type="submit">Upload</button>
            </form>
            {response && (
                <div className="response-container">
                    <h3>Response from Server:</h3>
                    <pre>{JSON.stringify(response, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}

export default FileUpload;
