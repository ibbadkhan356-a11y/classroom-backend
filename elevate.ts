import { db } from './src/db/index.js';
import { user } from './src/db/schema/auth.js';

async function checkUsers() {
    try {
        const users = await db.select().from(user).execute();
        console.log("Users in Database:");
        console.dir(users, { depth: null });
    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

checkUsers();
