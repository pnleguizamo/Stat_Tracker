const multer = require('multer');
const { MongoClient } = require('mongodb');
const fs = require('fs');

const url = process.env.URI;
const dbName = process.env.DB_NAME;
const client = new MongoClient(url);
const db = client.db(dbName);
const collectionName = "test_collection";

const upload = multer({ dest: 'uploads/' }); 

const express = require('express');
const router = express.Router();


router.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        await client.connect();
        const collection = db.collection(collectionName);

        for (const file of req.files) {
            const fileData = JSON.parse(fs.readFileSync(file.path, 'utf8'));
            
            const result = await collection.insertMany(fileData);
            
        }

        res.status(200).json({ message: 'Files uploaded and data saved successfully' });
    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).send('Error processing upload');
    } finally {
        await client.close();
    }
});



module.exports = router;