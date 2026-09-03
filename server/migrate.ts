import { Database } from "./db.js";
const db = new Database();
db.close();
console.log("Миграции применены.");
