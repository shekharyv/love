const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); 
require('dotenv').config({ path: 'e:/Loveyapa/lovesync-landing/.env' });

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: true },
    code: { type: String, unique: true },
    partnerId: { type: String, default: null },
    partnerName: { type: String, default: null },
    streak: { type: Number, default: 0 },
    exp: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

const names = ["Shekhar", "Priya", "Rahul", "Anjali", "Vikram", "Sneha", "Amit", "Pooja", "Arjun", "Kavya"];
const lovers = names.map((name, i) => ({
    name,
    email: `${name.toLowerCase()}@loveyapa.com`,
    password: 'password123',
    code: `LOVE${100 + i}`,
    streak: Math.floor(Math.random() * 30),
    exp: Math.floor(Math.random() * 5000),
    createdAt: new Date(Date.now() - (Math.random() * 1000 * 60 * 60 * 24 * 30)),
    partnerName: i % 2 === 0 ? names[i+1] : names[i-1]
}));

async function seedToUri(uri, label) {
    try {
        console.log(`🌀 Attempting to seed: ${label}...`);
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        
        await User.deleteMany({ email: { $nin: ['admin@loveyapa.com', 'shekhar@lovesync.app'] } });

        const adminExists = await User.findOne({ email: 'admin@loveyapa.com' });
        if (!adminExists) {
            await User.create({
                name: 'System Admin',
                email: 'admin@loveyapa.com',
                password: 'loveadmin999',
                code: 'ADMIN999',
                createdAt: new Date()
            });
            console.log(`👑 [${label}] Admin Created`);
        }

        await User.insertMany(lovers);
        console.log(`✅ [${label}] Seeded ${lovers.length} Lovers!`);
        await mongoose.disconnect();
    } catch (err) {
        console.error(`⚠️ [${label}] Skip: ${err.message}`);
    }
}

async function run() {
    // Try Cloud
    await seedToUri(process.env.MONGODB_URI, "CLOUD");
    // Try Local
    await seedToUri('mongodb://127.0.0.1:27017/lovesync', "LOCAL");
    process.exit(0);
}
run();
