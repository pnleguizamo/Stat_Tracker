const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.URI);
let db;

async function initDb() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    console.log("Mongo connected");
  }
  return db;
}

module.exports = { initDb, client };
