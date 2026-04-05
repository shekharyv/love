const mongoose = require('mongoose');
require('dotenv').config();

async function runAudit() {
    try {
        console.log("--- STARTING DATABASE AUDIT ---");
        
        // Check Cloud
        console.log("\n🔍 PROBING CLOUD DATABASE...");
        const cloudConn = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
        const cloudUsers = await cloudConn.db.collection('users').find({}).toArray();
        console.log(`✅ CLOUD: Found ${cloudUsers.length} users.`);
        cloudUsers.forEach(u => console.log(`   - [${u.email}] ${u.name || 'No Name'}`));
        
        // Remove dummy from cloud if any
        const dummyInCloud = cloudUsers.filter(u => u.email.includes('@loveyapa.com'));
        if (dummyInCloud.length > 0) {
            console.log(`🧹 PURGING ${dummyInCloud.length} DUMMY USERS FROM CLOUD...`);
            await cloudConn.db.collection('users').deleteMany({ email: { $regex: '@loveyapa.com' } });
            console.log("   ✅ Cloud Purge Complete.");
        }

        // Check Local
        console.log("\n🔍 PROBING LOCAL DATABASE...");
        const localConn = await mongoose.createConnection('mongodb://127.0.0.1:27017/lovesync').asPromise();
        const localUsers = await localConn.db.collection('users').find({}).toArray();
        console.log(`✅ LOCAL: Found ${localUsers.length} users.`);
        localUsers.forEach(u => console.log(`   - [${u.email}] ${u.name || 'No Name'}`));

        if (localUsers.length > 0) {
            console.log("🧹 PURGING ALL LOCAL USERS TO PREVENT CONFUSION...");
            await localConn.db.collection('users').deleteMany({});
            console.log("   ✅ Local Purge Complete.");
        }

        await cloudConn.close();
        await localConn.close();
        console.log("\n--- AUDIT COMPLETE ---");
        process.exit(0);
    } catch (err) {
        console.error("🛑 AUDIT FAILED:", err.message);
        process.exit(1);
    }
}

runAudit();
