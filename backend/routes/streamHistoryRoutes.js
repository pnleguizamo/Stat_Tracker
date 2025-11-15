const multer = require('multer');
const { initDb, client } = require('../mongo.js');
const fs = require('fs');

const collectionName = process.env.COLLECTION_NAME;
let db;

const upload = multer({ dest: 'uploads/' }); 

const express = require('express');
const router = express.Router();


router.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No files uploaded.');
        }

        db = await initDb();
        const collection = db.collection(collectionName);

        for (const file of req.files) {
            const fileData = JSON.parse(fs.readFileSync(file.path, 'utf8'));
            
            const result = await collection.insertMany(fileData);
            
        }

        res.status(200).json({ message: 'Files uploaded and data saved successfully' });
    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).send('Error processing upload');
    }
});



module.exports = router;