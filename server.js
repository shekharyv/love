const Groq = require('groq-sdk');
const similarity = require('string-similarity');
require('dotenv').config();
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const dns = require('dns');

// --- FORCE GOOGLE DNS FOR ATLAS BYPASS ---
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
console.log("DNS Hijack Protection: Using Google DNS (8.8.8.8) to bypass blocked Atlas records! 🛡️🌍");

const express = require('express');
const cors = require('cors');

const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    path: '/socket.io',
    cors: {
        origin: true,
        credentials: true
    }
});

// Prevent Unhandled Rejections from crashing
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const LOCAL_MONGODB_URI = 'mongodb://127.0.0.1:27017/lovesync';

let activeMongoUri = MONGODB_URI;

// --- STRICT REAL DATA INITIALIZATION ---
const mongoClientPromise = (async () => {
    try {
        console.log("Connecting to CLOUD MongoDB (Real Data)... ⏳");
        await mongoose.connect(MONGODB_URI, { family: 4, serverSelectionTimeoutMS: 5000 });
        activeMongoUri = MONGODB_URI;
        console.log('✅ Connected to CLOUD Cluster: Real Data Mode Active. 💎');
        return mongoose.connection.getClient();
    } catch (err) {
        console.error('🛑 DATABASE ERROR: Cloud connection failed!', err.message);
        process.exit(1);
    }
})();

// Schemas
const ActivitySchema = new mongoose.Schema({
    type: String, // 'message', 'snap', 'mood'
    content: String,
    timestamp: { type: Date, default: Date.now },
    userId: String
});

const MessageSchema = new mongoose.Schema({
    coupleId: String,
    senderId: String,
    receiverId: String,
    text: String,
    type: { type: String, default: "text" },
    status: { type: String, default: "sent" }, // sent, delivered, seen
    seenAt: { type: Date, default: null },
    opened: { type: Boolean, default: false },
    time: { type: String, default: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);
const Activity = mongoose.model('Activity', ActivitySchema);

const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: true },
    code: { type: String, unique: true },
    partnerId: { type: String, default: null },
    partnerName: { type: String, default: null },
    pendingRequest: { type: String, default: null }, // Existing system (Code based)
    
    // --- DISCOVERY FEATURES ---
    age: { type: Number, default: 20 },
    bio: { type: String, default: "I'm looking for meaningful connection! ❤️" },
    interests: { type: [String], default: ["Love", "Caring", "Life"] },
    gender: { type: String, default: "Other" },
    avatar: { type: String, default: null },
    receivedInvitations: { type: [String], default: [] }, // Array of User IDs
    sentInvitations: { type: [String], default: [] }, // Array of User IDs
    
    // 🔥 GEOLOCATION FOR DISCOVERY
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    },
    
    streak: { type: Number, default: 0 },
    loveScore: { type: Number, default: 0 },
    mood: { type: String, default: '😴' },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    lastQuizDate: { type: Date, default: null },
    ghostMode: { type: Boolean, default: false },

    // --- NEW EDIT PROFILE FIELDS ---
    username: { type: String, default: "" },
    status: { type: String, default: "Single" }
});
const QuizResultSchema = new mongoose.Schema({
    coupleId: String,
    userId: String,
    score: Number,
    total: { type: Number, default: 10 },
    timestamp: { type: Date, default: Date.now }
});
const QuizResult = mongoose.model('QuizResult', QuizResultSchema);

const TruthDareHistorySchema = new mongoose.Schema({
    userId: String,
    partnerId: String,
    coupleId: String,
    question: String,
    type: String,
    level: String,
    createdAt: { type: Date, default: Date.now }
});
const TruthDareHistory = mongoose.model('TruthDareHistory', TruthDareHistorySchema);

const User = mongoose.model('User', UserSchema);
UserSchema.index({ location: '2dsphere' }); // 🔥 Enable proximity searching

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessionStore = MongoStore.create({ clientPromise: mongoClientPromise });
sessionStore.on('error', (err) => {
    console.error(`⚠️ Session store error on ${activeMongoUri || 'unknown db'}: ${err.message}`);
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'love-secret-ultra-safe-999',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 Week
        secure: false // Set to true if using HTTPS
    }
}));

// Auth Middleware (Fixed & Shared)
const checkAuth = async (req, res, next) => {
    // SECURITY GUARD: Never redirect if we are already headed to auth
    if (req.path === '/auth' || req.path === '/login' || req.path === '/') return next();

    if (req.session.userId) {
        try {
            const u = await User.findById(req.session.userId);
            if (u) {
                res.locals.user = u;
                return next();
            }
        } catch (e) { }
        req.session.userId = null; 
    }
    res.redirect('/auth');
};

// --- NEW: STREAK SYNC MIDDLEWARE ---
const syncStreak = async (req, res, next) => {
    if (res.locals.user) {
        const user = res.locals.user;
        if (user.lastQuizDate) {
            const last = new Date(user.lastQuizDate);
            const today = new Date();
            // Calculate difference in midnights for a proper daily streak
            const diffTime = Math.abs(today.setHours(0,0,0,0) - last.setHours(0,0,0,0));
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 1) { 
                user.streak = 0;
                await User.updateOne({ _id: user._id }, { streak: 0 });
            }
        }
    }
    next();
};

// Global Middlewares (Non-blocking)
app.use(syncStreak);

// Generate Unique Love Code Helper
function generateLoveCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Super Admin Security
const checkSuperAdmin = async (req, res, next) => {
    try {
        // --- MASTER BYPASS: CHECK SESSION FIRST ---
        if (req.session.isAdmin) {
            return next();
        }

        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@loveyapa.com').trim().toLowerCase();
        
        // Fallback: Recover from DB if session flag is missing but userId exists
        if (req.session.userId) {
            const user = await User.findById(req.session.userId);
            if (user && user.email.trim().toLowerCase() === adminEmail) {
                req.session.isAdmin = true; // Fix the session for future hits
                res.locals.user = user;
                return next();
            }
        }

        console.log(`🚫 Admin Access Denied to: ${req.originalUrl}`);
        if (req.accepts('html')) return res.redirect('/auth');
        res.status(403).json({ error: "Unauthorized" });
    } catch (e) {
        console.error("🛑 SECURITY FAIL:", e.message);
        res.redirect('/auth');
    }
};

// --- LOGOUT ---
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/auth');
    });
});

// --- VIEW ROUTES ---
app.get('/watch', checkAuth, (req, res) => res.render('watch', { user: res.locals.user }));
app.get('/', (req, res) => res.render('index'));
app.get('/auth', (req, res) => {
    // Definitive loop break: Always render auth page, do not auto-redirect to home
    res.render('auth');
});

// Protected routes (Always passing user)
app.get('/home', checkAuth, (req, res) => res.render('home', { user: res.locals.user }));
app.get('/chat', checkAuth, (req, res) => res.render('chat', { user: res.locals.user }));
app.get('/insights', checkAuth, (req, res) => res.render('insights', { user: res.locals.user }));
app.get('/profile', checkAuth, (req, res) => res.render('profile', { user: res.locals.user }));
app.get('/edit-profile', checkAuth, (req, res) => res.render('edit-profile', { user: res.locals.user }));

app.put('/api/user/update', checkAuth, async (req, res) => {
    try {
        const { name, username, bio, mood, status, interests, avatar } = req.body;
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (username !== undefined) updateData.username = username;
        if (bio !== undefined) updateData.bio = bio;
        if (mood !== undefined) updateData.mood = mood;
        if (status !== undefined) updateData.status = status;
        if (interests !== undefined) updateData.interests = Array.isArray(interests) ? interests : interests.split(',').map(i => i.trim());
        if (avatar !== undefined) updateData.avatar = avatar;

        const updatedUser = await User.findByIdAndUpdate(res.locals.user._id, updateData, { new: true });
        res.json({ success: true, user: updatedUser });
    } catch (err) {
        console.error("Update Error:", err);
        res.status(500).json({ error: "Failed to update profile ❌" });
    }
});
app.get('/camera', checkAuth, (req, res) => res.render('camera', { user: res.locals.user }));
app.get('/quiz', checkAuth, (req, res) => res.render('quiz', { user: res.locals.user }));
app.get('/discover', checkAuth, (req, res) => res.render('discover', { user: res.locals.user }));

// --- DISCOVERY APIs ---
app.get('/api/discover/users', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        const { lat, lng, distance = 50 } = req.query; // distance in km

        // Build Query
        const query = {
            _id: { $ne: user._id },
            $or: [{ partnerId: null }, { partnerId: "" }],
            _id: { $nin: user.sentInvitations || [] }
        };

        // If user provides location, filter by proximity
        if (lat && lng) {
            const latitude = parseFloat(lat);
            const longitude = parseFloat(lng);
            
            // Save current user's location too for matching
            await User.findByIdAndUpdate(user._id, {
                location: { type: 'Point', coordinates: [longitude, latitude] }
            });

            try {
                query.location = {
                    $near: {
                        $geometry: { type: "Point", coordinates: [longitude, latitude] },
                        $maxDistance: parseInt(distance) * 1000 // Convert km to meters
                    }
                };
            } catch (geoErr) {
                console.warn("Geospatial error, falling back to normal search:", geoErr.message);
                delete query.location;
            }
        }

        let users = await User.find(query).limit(20);

        // Fallback: If no users found within distance, show any single users (Global search)
        if (users.length === 0 && query.location) {
            console.log(`[DISCOVER] No users within ${distance}km, falling back to global.`);
            delete query.location;
            users = await User.find(query).limit(20);
        }

        console.log(`[DISCOVER] Returning ${users.length} potential partners.`);
        res.json(users);
    } catch (e) { 
        console.error("Discover API Error:", e);
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/discover/invite', checkAuth, async (req, res) => {
    try {
        const { targetId } = req.body;
        const user = res.locals.user;
        
        // Add current user to target's receivedInvitations
        await User.findByIdAndUpdate(targetId, {
            $addToSet: { receivedInvitations: user._id.toString() }
        });
        
        // Add target to current user's sentInvitations
        user.sentInvitations.push(targetId);
        await user.save();
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/discover/accept', checkAuth, async (req, res) => {
    try {
        const { senderId } = req.body;
        const user = res.locals.user;
        const sender = await User.findById(senderId);

        if (!sender) return res.status(404).json({ error: "User no longer exists" });
        if (sender.partnerId || user.partnerId) return res.status(400).json({ error: "One of you is already paired!" });

        // Establish Partner Connection
        user.partnerId = sender._id.toString();
        user.partnerName = sender.name;
        user.receivedInvitations = user.receivedInvitations.filter(id => id !== senderId);
        await user.save();

        sender.partnerId = user._id.toString();
        sender.partnerName = user.name;
        sender.sentInvitations = sender.sentInvitations.filter(id => id !== user._id.toString());
        await sender.save();

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/discover/pending', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        const senders = await User.find({ _id: { $in: user.receivedInvitations || [] } }).select('name avatar age bio');
        res.json(senders);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin', checkAuth, checkSuperAdmin, (req, res) => res.render('admin', { user: res.locals.user }));

// --- ADMIN SYSTEM APIs ---
app.get('/api/admin/stats', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeCouples = await User.countDocuments({ partnerId: { $ne: null } });
        res.json({ totalUsers, activeCouples: Math.floor(activeCouples / 2) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/broadcast', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        // Broadcast via Socket.IO to everyone
        io.emit('system-alert', { message, timestamp: new Date() });
        res.json({ success: true, sentTo: "All Active Connections" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? "Connected 🟢" : "Disconnected 🔴";
        console.log(`[ADMIN ACCESS] DB: ${dbStatus}, URI: ${activeMongoUri.substring(0, 30)}...`);
        
        // --- FORCE PURGE DUMMY DATA ---
        const purgeResult = await User.deleteMany({ email: /@loveyapa\.com$/i });
        if (purgeResult.deletedCount > 0) {
            console.log(`🔥 [PURGE] Automatically removed ${purgeResult.deletedCount} Dummy Users!`);
        }

        const users = await User.find().sort({ _id: -1 }); // Newest first
        console.log(`[ADMIN] Returning ${users.length} Real Users. Check for Yashvi in this list:`, users.map(u => u.email));
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/delete-user/:id', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/update-streak', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const { userId, streak } = req.body;
        await User.findByIdAndUpdate(userId, { streak: streak });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- NEW: DEDICATED INTELLIGENCE PAGE ---
app.get('/admin/user-intelligence/:id', checkSuperAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.redirect('/admin');

        const messages = await Message.find({ 
            $or: [{ senderId: user._id.toString() }, { receiverId: user._id.toString() }] 
        }).sort({ timestamp: -1 }).limit(200);

        const activities = await Activity.find({ userId: user._id.toString() }).sort({ timestamp: -1 }).limit(100);

        res.render('admin-intelligence', { user, messages, activities, admin: res.locals.user });
    } catch (e) { 
        console.error("🛑 INTELLIGENCE PAGE CRASH:", e.message);
        res.redirect('/admin'); 
    }
});

// --- NEW: DEEP USER DATA FOR ADMIN (JSON API) ---
app.get('/api/admin/user-deep-data/:id', checkAuth, checkSuperAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const messages = await Message.find({ 
            $or: [{ senderId: user._id.toString() }, { receiverId: user._id.toString() }] 
        }).sort({ timestamp: -1 }).limit(100);

        const activities = await Activity.find({ userId: user._id.toString() }).sort({ timestamp: -1 }).limit(50);

        res.json({ user, messages, activities });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/send-voice', checkAuth, async (req, res) => {
    try {
        const { audio, coupleId } = req.body;
        const senderId = req.session.userId;
        const receiverId = coupleId.split('_').find(id => id !== senderId.toString());
        const msg = await Message.create({ coupleId, senderId, receiverId, text: audio, type: 'audio', status: 'sent' });
        io.to(coupleId).emit('chat message', { user: res.locals.user.name, text: audio, type: 'audio', time: msg.time, senderId: senderId, status: 'sent' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- MESSAGE STATUS APIs (GLOBAL) ---
app.post('/api/delivered', checkAuth, async (req, res) => {
    try {
        const { userId } = req.body;
        console.log("🚚 DELIVERED API HIT:", userId);
        await Message.updateMany({ receiverId: userId, status: 'sent' }, { status: 'delivered' });
        res.send("Updated to delivered");
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/seen', checkAuth, async (req, res) => {
    try {
        const { userId, partnerId } = req.body;
        const coupleId = [userId, partnerId].sort().join('_');
        console.log("🔥 SEEN API HIT:", userId, partnerId);

        const result = await Message.updateMany(
            { coupleId, receiverId: userId, status: { $ne: 'seen' } },
            { $set: { status: 'seen', seen: true, seenAt: new Date() } }
        );

        console.log("✅ UPDATED:", result);
        io.to(coupleId).emit('messages seen');
        res.send("Seen updated");
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/attention-alert', checkAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ show: false });

        // Count ignored snaps sent TO me by my partner
        const ignored = await Message.find({
            type: 'image',
            senderId: user.partnerId,
            seen: false
        }).limit(10);

        if (ignored.length >= 2) {
            res.json({ show: true, count: ignored.length });
        } else {
            res.json({ show: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/get-snaps', checkAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = res.locals.user;
        if (!user.partnerId) return res.json([]);

        const mySnaps = await Message.find({
            type: 'image',
            coupleId: [userId, user.partnerId].sort().join('_'),
            senderId: user.partnerId // Snaps sent BY partner
        }).sort({ timestamp: -1 }).limit(10);

        console.log(`[ID Check] My ID: ${userId}, Partner ID: ${user.partnerId}. Found ${mySnaps.length} snaps.`);
        res.json(mySnaps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/seen-snap', checkAuth, async (req, res) => {
    try {
        const { snapId } = req.body;
        await Message.findByIdAndUpdate(snapId, { seen: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/send-snap', checkAuth, async (req, res) => {
    try {
        const { image, coupleId } = req.body;
        const senderId = req.session.userId;
        const user = res.locals.user;
        const receiverId = coupleId.split('_').find(id => id !== senderId.toString());

        console.log("SNAP SENT:", senderId, "→", receiverId);

        const newMsg = await Message.create({ coupleId, senderId, receiverId, text: image, type: 'image', seen: false, status: 'sent' });
        io.to(coupleId).emit('chat message', {
            user: user.name,
            text: newMsg.text,
            type: 'image',
            time: newMsg.time,
            senderId: senderId,
            status: 'sent',
            _id: newMsg._id
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/open-snap', checkAuth, async (req, res) => {
    try {
        const { snapId } = req.body;
        await Message.findByIdAndUpdate(snapId, { opened: true, seen: true });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/send-message', checkAuth, async (req, res) => {
    try {
        const { senderId, receiverId, text, type, tempId } = req.body;
        const coupleId = [senderId, receiverId].sort().join('_');
        
        // Initial status: sent
        let status = 'sent';

        // Check if partner is in the room for instant delivery
        const clients = io.sockets.adapter.rooms.get(coupleId);
        if (clients && clients.size > 1) {
            status = 'delivered';
        }

        const newMsg = await Message.create({ 
            coupleId, 
            senderId, 
            receiverId, 
            text, 
            type: type || 'text', 
            status: status,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });

        // 🔥 Broadcast for Real-time
        io.to(coupleId).emit('chat message', {
            _id: newMsg._id,
            user: res.locals.user.name,
            text: newMsg.text,
            type: newMsg.type,
            time: newMsg.time,
            senderId: senderId,
            status: status,
            tempId: tempId
        });

        res.json({ success: true, message: "Stored & Emitted" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// --- NEW: BEHAVIOR ANALYTICS API ---
app.get('/api/insights/behavior', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ 
            user: { speed: "0s", snaps: 0, missed: 0, accuracy: 0 }, 
            partner: { speed: "0s", snaps: 0, missed: 0, accuracy: 0 },
            userScore: user.loveScore || 0,
            partnerScore: 0,
            weeklyUser: [250,250,250,250,250,250,250],
            weeklyPartner: [250,250,250,250,250,250,250],
            rank: { level: 1, title: "New Couple 🌱", exp: 0, nextExp: 500, percent: 0 }
        });

        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');
        const messages = await Message.find({ coupleId }).sort({ timestamp: -1 }).limit(200);

        const getStats = async (uid, pid) => {
            let totalSpeed = 0, speedCount = 0;
            let snapCount = await Message.countDocuments({ senderId: uid, type: 'image' });
            let missedCount = await Message.countDocuments({ receiverId: uid, status: { $ne: 'seen' } });

            // Calculate Speed: Find msgs from receiver, then next msg from sender
            for (let i = 0; i < messages.length - 1; i++) {
                const msg = messages[i]; // newer
                const prev = messages[i+1]; // older
                if (msg.senderId.toString() === uid.toString() && prev.senderId.toString() === pid.toString()) {
                    const diff = (msg.timestamp - prev.timestamp) / (1000 * 60);
                    if (diff > 0 && diff < 180) { // Only count if within 3 hours
                        totalSpeed += diff; speedCount++;
                    }
                }
            }

            const avgSpeed = speedCount > 0 ? (totalSpeed / speedCount) : null;
            
            // Get Quiz Accuracy
            const latestQuiz = await QuizResult.findOne({ userId: uid }).sort({ timestamp: -1 });
            const acc = latestQuiz ? Math.round((latestQuiz.score / latestQuiz.total) * 100) : 85;

            return {
                speed: avgSpeed === null ? "--" : (avgSpeed > 1 ? avgSpeed.toFixed(1) + "m" : (avgSpeed * 60).toFixed(0) + "s"),
                snaps: snapCount,
                missed: missedCount,
                accuracy: acc
            };
        };

        const getWeeklyData = (userId) => {
            const days = [0,0,0,0,0,0,0];
            const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            messages.filter(m => m.timestamp >= oneWeekAgo && m.senderId.toString() === userId.toString()).forEach(m => {
                const d = new Date(m.timestamp).getDay();
                days[d]++;
            });
            return days.map(val => Math.max(50, 250 - (val * 15)));
        };

        const partner = await User.findById(user.partnerId);
        const [uStats, pStats] = await Promise.all([
            getStats(user._id, user.partnerId),
            getStats(user.partnerId, user._id)
        ]);

        const calculateLevel = (exp) => {
            if (exp < 500) return { lvl: 1, title: "New Couple 🌱", next: 500 };
            if (exp < 1500) return { lvl: 2, title: "Getting Closer 💕", next: 1500 };
            if (exp < 3500) return { lvl: 3, title: "Caring Partner ❤️", next: 3500 };
            if (exp < 7000) return { lvl: 4, title: "Deeply Devoted 🔥", next: 7000 };
            return { lvl: 5, title: "Soulmates ♾️", next: 15000 };
        };

        const estimatedExp = (await Message.countDocuments({ coupleId })) * 5 + (user.loveScore * 10);
        const rank = calculateLevel(estimatedExp);

        res.json({
            user: uStats,
            partner: pStats,
            userScore: user.loveScore || 0,
            partnerScore: partner ? partner.loveScore : 0,
            weeklyUser: getWeeklyData(user._id),
            weeklyPartner: getWeeklyData(user.partnerId),
            rank: {
                level: rank.lvl,
                title: rank.title,
                exp: estimatedExp,
                nextExp: rank.next,
                percent: Math.min(100, Math.floor((estimatedExp / rank.next) * 100))
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/love-reminder', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ show: false });

        const lastMsg = await Message.findOne({ senderId: user._id }).sort({ timestamp: -1 });
        const now = new Date();
        let suggestion = "Send a quick heart to show you care! ❤️";
        let show = true;

        if (!lastMsg || (now - lastMsg.timestamp) > (1000 * 60 * 60 * 4)) {
            suggestion = "It's been a while, why not say Hi? 😊";
        } else if ((now.getHours() > 21)) {
            suggestion = "Time to send a sweet Good Night wish? 🌙";
        } else {
            show = Math.random() > 0.5; // Randomly show other suggestions
            const extra = ["Ask them how their day is going! ☀️", "A surprise compliment works wonders! ✨", "Share a quick snap of what you're doing! 📸"];
            suggestion = extra[Math.floor(Math.random() * extra.length)];
        }

        res.json({ show, suggestion });
    } catch (e) { res.json({ show: false }); }
});

// --- NEW: REPLY SPEED ANALYTICS ---
app.get('/api/analytics/reply-speed', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ userSpeed: 0, partnerSpeed: 0 });

        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');
        const messages = await Message.find({ coupleId }).sort({ timestamp: -1 }).limit(100);

        const calculateSpeed = (senderId, receiverId) => {
            let totalDiff = 0;
            let count = 0;

            for (let i = 0; i < messages.length - 1; i++) {
                const msg = messages[i];
                const prevMsg = messages[i + 1];

                // If msg was sent by 'senderId' as a reply to 'receiverId'
                if (msg.senderId.toString() === senderId.toString() && prevMsg.senderId.toString() === receiverId.toString()) {
                    const diff = (msg.timestamp - prevMsg.timestamp) / (1000 * 60); // minutes
                    if (diff > 0 && diff < 120) { // Limit to 2 hours to avoid outliers
                        totalDiff += diff;
                        count++;
                    }
                }
            }
            return count > 0 ? (totalDiff / count).toFixed(1) : 0;
        };

        const userSpeed = calculateSpeed(user._id.toString(), user.partnerId);
        const partnerSpeed = calculateSpeed(user.partnerId, user._id.toString());

        res.json({ userSpeed, partnerSpeed });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- QUIZ SUBMISSION API (Increments Streak) ---
app.post('/api/quiz/submit', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        const today = new Date().toDateString();
        const lastQ = user.lastQuizDate ? new Date(user.lastQuizDate).toDateString() : null;

        if (lastQ === today) {
            return res.json({ success: true, alreadyDone: true });
        }

        user.streak += 1;
        user.exp += 100; // Reward for doing quiz
        user.lastQuizDate = new Date();
        await user.save();

        res.json({ success: true, newStreak: user.streak });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/messages/:userId/:partnerId', checkAuth, async (req, res) => {
    try {
        const userId = req.params.userId.trim();
        const partnerId = req.params.partnerId.trim();
        const coupleId = [userId, partnerId].sort().join('_');

        // ULTIMATE FIX: Mark all messages where I AM THE RECEIVER as seen
        await Message.updateMany(
            { coupleId, receiverId: userId, status: { $ne: 'seen' } },
            { $set: { status: 'seen', seen: true, seenAt: new Date() } }
        );

        // Find by IDs OR coupleId for maximum compatibility
        const msgs = await Message.find({
            $or: [
                { coupleId: coupleId },
                { senderId: userId, receiverId: partnerId },
                { senderId: partnerId, receiverId: userId }
            ]
        }).sort({ timestamp: 1 });

        res.json(msgs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/send-quick-message', checkAuth, async (req, res) => {
    try {
        const { action } = req.body;
        const user = res.locals.user;
        if (!user.partnerId) return res.status(400).json({ error: "No partner" });
        const coupleId = [user._id.toString(), user.partnerId.toString()].sort().join('_');

        const newMsg = await Message.create({ coupleId, senderId: user._id, receiverId: user.partnerId, text: action, type: 'text', status: 'sent' });
        io.to(coupleId).emit('chat message', { user: user.name, text: action, type: 'text', time: newMsg.time, senderId: user._id, status: 'sent' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Guide: Get Partner data
app.get('/partner/:userId', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user.partnerId) return res.status(404).json({ error: "No partner" });
        const partner = await User.findById(user.partnerId);
        res.json(partner);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- API History ---
app.get('/api/chat-history', checkAuth, async (req, res) => {
    const user = res.locals.user;
    if (!user.partnerId) return res.json([]);
    const coupleId = [user._id.toString(), user.partnerId.toString()].sort().join('_');
    const messages = await Message.find({ coupleId }).sort({ timestamp: 1 }).limit(100);
    res.json(messages);
});

// --- AUTH APIs ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log(`🚀 [SIGNUP ATTEMPT] Name: ${name}, Email: ${email}`);
        
        const exists = await User.findOne({ email });
        if (exists) {
            console.log(`⚠️ [SIGNUP] User ${email} already exists.`);
            return res.status(400).json({ error: "User already registered! 🧐" });
        }

        const user = await User.create({ name, email, password, code: generateLoveCode() });
        console.log(`✅ [SIGNUP SUCCESS] New User Created: ${user.email} (ID: ${user._id})`);
        
        req.session.userId = user._id;
        res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, partnerId: user.partnerId } });
    } catch (err) { 
        console.error("🛑 [SIGNUP ERROR]:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const loginEmail = (email || "").trim().toLowerCase();
        const loginPass = (password || "").trim();

        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@loveyapa.com').trim().toLowerCase();
        const adminPass = (process.env.ADMIN_PASS || 'loveadmin999').trim();

        console.log(`[AUTH DEBUG] Attempt: '${loginEmail}' vs Target: '${adminEmail}'`);
        console.log(`[AUTH DEBUG] Pass Match: ${loginPass === adminPass}`);

        // Check if this is the Super Admin attempting login
        if (loginEmail === adminEmail && loginPass === adminPass) {
            let adminUser = await User.findOne({ email: adminEmail });
            if (!adminUser) {
                const adminCode = "AD" + Math.random().toString(36).substring(2, 6).toUpperCase();
                adminUser = await User.create({ 
                    name: "Super Admin", 
                    email: adminEmail, 
                    password: adminPass, 
                    code: adminCode,
                    level: 99,
                    exp: 99999
                });
                console.log(`🚀 Admin Seeded: ${adminCode}`);
            }
            req.session.userId = adminUser._id;
            req.session.isAdmin = true;
            await req.session.save();
            return res.json({ success: true, user: adminUser, isAdmin: true, redirect: '/admin' });
        }

        const user = await User.findOne({ email: loginEmail, password: loginPass });
        if (!user) {
            console.warn(`[AUTH FAIL] No match for: ${loginEmail}`);
            return res.status(401).json({ error: "Invalid email or password! ❌" });
        }

        req.session.userId = user._id;
        req.session.isAdmin = false;
        await req.session.save();
        res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, partnerId: user.partnerId } });
    } catch (err) { 
        console.error("LOGIN ERROR:", err);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/auth');
});

// --- PAIRING APIs ---
app.get('/api/my-code', checkAuth, async (req, res) => {
    const user = res.locals.user;
    res.json({ code: user.code, partnerId: user.partnerId, partnerName: user.partnerName });
});

app.post('/api/connect-partner', checkAuth, async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: "Code is required! 😂" });

        const me = res.locals.user;
        const partner = await User.findOne({ code: code.toUpperCase() });

        if (!partner) return res.status(404).json({ error: "Invalid code! ❌" });
        if (partner._id.toString() === me._id.toString()) return res.status(400).json({ error: "Your own code? 😅" });

        // If I accept a request or start one, and I already have a partner, clear THAT partner first
        if (me.pendingRequest === partner._id.toString()) {
            // DISCONNECT OLD PARTNER IF EXISTS
            if (me.partnerId) {
                await User.findByIdAndUpdate(me.partnerId, { partnerId: null, partnerName: "" });
            }
            // DISCONNECT NEW PARTNER'S OLD PARTNER IF EXISTS
            if (partner.partnerId) {
                await User.findByIdAndUpdate(partner.partnerId, { partnerId: null, partnerName: "" });
            }

            await User.findByIdAndUpdate(me._id, { partnerId: partner._id, partnerName: partner.name, pendingRequest: null, exp: 0, loveScore: 0, streak: 0 });
            await User.findByIdAndUpdate(partner._id, { partnerId: me._id, partnerName: me.name, pendingRequest: null, exp: 0, loveScore: 0, streak: 0 });
            
            console.log(`🔗 [SYNC] New Partnership formed: ${me.name} ❤️ ${partner.name}`);
            return res.json({ success: true, status: 'connected', partnerName: partner.name });
        } else {
            // Before sending a request, I don't necessarily disconnect, but clicking the button allows me to enter a new code
            await User.findByIdAndUpdate(partner._id, { pendingRequest: me._id });
            console.log(`📩 [SYNC] Request sent from ${me.name} to ${partner.name}`);
            return res.json({ success: true, status: 'waiting' });
        }
    } catch (err) { res.status(500).json({ error: "Server error!" }); }
});
app.post('/api/disconnect-partner', checkAuth, async (req, res) => {
    try {
        const me = res.locals.user;
        if (!me.partnerId) return res.status(400).json({ error: "You don't have a partner to disconnect! 😂" });

        const partnerId = me.partnerId;

        // Reset MY data
        await User.findByIdAndUpdate(me._id, { 
            partnerId: null, 
            partnerName: "", 
            pendingRequest: null, 
            exp: 0, 
            loveScore: 0, 
            streak: 0,
            coupleId: null 
        });

        // Reset PARTNER's data
        await User.findByIdAndUpdate(partnerId, { 
            partnerId: null, 
            partnerName: "", 
            pendingRequest: null, 
            exp: 0, 
            loveScore: 0, 
            streak: 0,
            coupleId: null 
        });

        console.log(`💔 [DISCONNECT] Partnership ended: ${me.name} and their partner.`);
        res.json({ success: true, message: "Disconnected successfully! 💔" });
    } catch (err) {
        console.error("Disconnect Error:", err);
        res.status(500).json({ error: "Server error!" });
    }
});

// --- PARTNER & SCORE APIs ---
app.get('/api/partner', checkAuth, async (req, res) => {
    const user = res.locals.user;
    const myLastMood = await Activity.findOne({ userId: user._id, type: 'mood' }).sort({ timestamp: -1 });

    if (!user.partnerId) {
        return res.json({
            name: "Unpaired", partnerId: null, status: "Offline", streak: 0,
            image: "/images/partner-avatar.png", partnerMood: "None",
            myMood: myLastMood ? myLastMood.content : "None"
        });
    }

    const partner = await User.findById(user.partnerId);
    if (!partner) return res.json({ name: "Unknown", partnerId: null });

    // --- GHOST MODE STATUS CHECK ---
    if (partner.ghostMode) {
        return res.json({
            name: partner.name,
            partnerId: partner._id,
            status: "Offline", // Hard-coded offline for stealth
            streak: user.streak,
            image: "/images/partner-avatar.png",
            partnerMood: "None",
            myMood: myLastMood ? myLastMood.content : "None",
            isGhosting: true
        });
    }

    const lastActivity = await Activity.findOne({ userId: user.partnerId }).sort({ timestamp: -1 });
    const lastPartnerMood = await Activity.findOne({ userId: user.partnerId, type: 'mood' }).sort({ timestamp: -1 });

    res.json({
        name: partner.name,
        partnerId: partner._id,
        status: lastActivity ? `Active ${Math.floor((new Date() - lastActivity.timestamp) / 60000)}m ago` : "Online",
        streak: user.streak,
        image: "/images/partner-avatar.png",
        partnerMood: lastPartnerMood ? lastPartnerMood.content : "None",
        myMood: myLastMood ? myLastMood.content : "None"
    });
});

// --- TOGGLE GHOST MODE ---
app.post('/api/toggle-ghost', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        user.ghostMode = !user.ghostMode;
        await user.save();
        console.log(`🎭 GHOST MODE: ${user.name} ➔ ${user.ghostMode ? 'ENABLED 🌑' : 'DISABLED ☀️'}`);
        res.json({ success: true, ghostMode: user.ghostMode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- AGORA TOKEN GENERATOR ---
app.get('/api/agora-token', checkAuth, (req, res) => {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    const channelName = req.query.channelName;
    const uid = 0; 
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    if (!channelName) return res.status(400).json({ error: 'Channel name is required' });

    if (!appId || !appCertificate || appCertificate.includes('PASTE_YOUR')) {
        return res.json({ token: '', appId, warning: "CERT_REQUIRED" });
    }

    try {
        const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, role, privilegeExpiredTs);
        res.json({ token, appId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🔥 NEW: CALL SIGNAL POLLING FOR VERCEL
app.get('/api/check-call', checkAuth, (req, res) => {
    const userId = res.locals.user._id.toString();
    const signal = activeCallSignals.get(userId);
    
    // Clear signals older than 30s
    if (signal && (Date.now() - signal.timestamp > 30000)) {
        activeCallSignals.delete(userId);
        return res.json({ call: null });
    }
    
    res.json({ call: signal || null });
});


app.get('/api/love-score', checkAuth, async (req, res) => {
    const user = res.locals.user;
    const count = await Activity.countDocuments({ userId: user._id });
    res.json({ score: user.loveScore + (count * 5) });
});

app.post('/api/activity', checkAuth, async (req, res) => {
    try {
        const { type, content } = req.body;
        const user = res.locals.user;
        await Activity.create({ type, content, userId: req.session.userId });
        await User.findByIdAndUpdate(req.session.userId, { $inc: { loveScore: 1 } });
        res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, partnerId: user.partnerId } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/last-snap', checkAuth, async (req, res) => {
    const user = res.locals.user;
    if (!user.partnerId) return res.json({ snap: { content: "Pair first! 👀" } });
    const snap = await Activity.findOne({ userId: user.partnerId, type: 'snap' }).sort({ timestamp: -1 });
    res.json({ snap: snap || { content: "No snaps today 😢" } });
});

app.get('/api/gallery', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json([]);
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');

        // Fetch all media messages (image, video, sticker)
        const media = await Message.find({
            coupleId,
            type: { $in: ['image', 'video', 'sticker', 'audio'] }
        }).sort({ timestamp: -1 });

        res.json(media);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/memory', checkAuth, async (req, res) => {
    const user = res.locals.user;
    const memories = await Activity.find({ userId: user.partnerId, type: 'snap' }).limit(5).sort({ timestamp: -1 });
    res.json(memories);
});

app.post('/api/set-mood', checkAuth, async (req, res) => {
    try {
        const { mood } = req.body;
        const user = await User.findByIdAndUpdate(req.session.userId, { mood }, { new: true });
        console.log(`Mood Saved: ${user.name} ➔ ${mood}`);

        // Also broadcast via socket if partner is in room
        if (user.partnerId) {
            const coupleId = [req.session.userId, user.partnerId].sort().join('_');
            io.to(coupleId).emit('partner mood update', { mood });
        }

        res.json({ success: true, mood: user.mood });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/unread-snap', checkAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const user = res.locals.user;
        if (!user.partnerId) return res.json(null);

        const snap = await Message.findOne({
            receiverId: userId.toString(),
            type: 'image',
            opened: false
        }).sort({ timestamp: -1 });

        res.json(snap);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/open-snap', checkAuth, async (req, res) => {
    try {
        const { snapId } = req.body;
        await Message.findByIdAndUpdate(snapId, { opened: true });
        res.send("Opened");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/generate-challenge', checkAuth, async (req, res) => {
    const { type, level: lvlNum } = req.query; // type: 'truth'|'dare', level: 1|2|3|4
    const user = res.locals.user;
    if (!user.partnerId) return res.status(400).json({ error: "No partner synced!" });

    try {
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');

        // Fetch History for Duplicate Prevention
        const [recentMessages, history] = await Promise.all([
            Message.find({ coupleId }).sort({ timestamp: -1 }).limit(15),
            TruthDareHistory.find({ coupleId }).sort({ createdAt: -1 }).limit(50)
        ]);

        const context = recentMessages
            .filter(m => m.type === 'text' && !m.text.startsWith('GAME CHALLENGE:'))
            .map(m => m.text)
            .reverse()
            .join(' | ');

        const levels = {
            "1": "normal | Sweet, safe, fun vibes.",
            "2": "medium | Romantic, flirty teasing.",
            "3": "deep | Emotional bonding and connection.",
            "4": "naughty | Bold, intimate, and passionate."
        };

        const levelInfo = levels[lvlNum] || levels["1"];
        const [levelKey, levelGoal] = levelInfo.split(' | ');

        const oldQuestions = history.map(h => h.question);
        let tries = 0;
        let resultChallenge = null;

        while (tries < 3) {
            const prompt = `
                Generate one unique, human-like ${type.toUpperCase()} for a couple.
                Level: ${levelKey} (${levelGoal})
                Mood: ${user.mood || 'Happy'}
                Avoid repeating: ${oldQuestions.slice(0, 20).join(' | ')}

                Rules:
                - Short, emotional, and Gen-Z style.
                - If type=dare -> action. If type=truth -> question.
                
                Return JSON ONLY: { "type": "${type}", "level": "${levelKey}", "question": "..." }
            `;

            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.3-70b-versatile',
                response_format: { type: "json_object" }
            });

            try {
                const aiRes = JSON.parse(completion.choices[0].message.content);
                const isDuplicate = oldQuestions.some(q => 
                    similarity.compareTwoStrings(aiRes.question.toLowerCase(), q.toLowerCase()) > 0.6
                );

                if (!isDuplicate) {
                    resultChallenge = aiRes;
                    // Save to history
                    await TruthDareHistory.create({
                        userId: user._id,
                        partnerId: user.partnerId,
                        coupleId,
                        question: aiRes.question,
                        type,
                        level: levelKey
                    });
                    break;
                }
                console.log(`[Loveyapa] Duplicate detected, retry ${tries + 1}...`);
            } catch (e) {
                console.error("[Loveyapa] Parse/Sim error:", e);
            }
            tries++;
        }

        if (resultChallenge) {
            res.json(resultChallenge);
        } else {
            const fallbackMap = {
                truth: ["What is your favorite memory of us? ❤️", "Tell me one thing you love about my personality. ✨"],
                dare: ["Send me a quick selfie with a heart sign 📸❤️", "Voice note: Say 'I love you' in your softest voice 🎤"]
            };
            const list = fallbackMap[type] || fallbackMap.truth;
            const q = list[Math.floor(Math.random() * list.length)];
            res.json({ type, level: levelKey, question: q, fallback: true });
        }

    } catch (e) {
        console.error("GROQ ERROR:", e);
        res.status(500).json({ error: "AI failed to generate challenge" });
    }
});


app.get('/api/partner-mood', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ mood: "❓", status: "Unpaired" });

        const partner = await User.findById(user.partnerId);
        console.log(`Partner Mood Fetch: ${partner?.name} is ${partner?.mood}`);
        res.json({ mood: partner?.mood || "😴", name: partner?.name });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- AI QUIZ ENGINE (GROQ) ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.get('/api/generate-quiz', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.status(400).json({ error: "Pair first! ❤️" });

        const now = new Date();
        const hour = now.getHours();
        const isQuizTime = (hour >= 21 || hour < 1);

        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');

        const todayMessages = await Message.find({
            coupleId,
            timestamp: { $gte: startOfDay }
        }).limit(20);

        const context = todayMessages.map(m => `${m.senderId === user._id.toString() ? 'User' : 'Partner'}: ${m.text}`).join('\n');

        const prompt = `
            You are a romantic relationship expert. Generate a fun, addictive, and deeply personal "Couple Quiz" with 10 questions based on their chat history today.
            
            TODAY'S CHAT CONTEXT:
            ${context || "No messages yet today, generate general romantic/fun couple questions."}
            
            OUTPUT FORMAT:
            You MUST return a JSON object with a "questions" key containing an array of 10 objects. Each object must have:
            - "q": The question text.
            - "o": Array of 4 possible options (strings).
            - "a": The correct option (exact string from the "o" array).
            - "l": Difficulty level ("Easy", "Medium", or "Hard").
            - "t": The type of question ("Memory", "Vibe", or "Daily").
            - "ev": A short piece of "Evidence" or a cute comment about why this question exists based on the chat.

            Example: {"questions": [{"q": "What movie did we talk about today?", "o": ["Titanic", "Batman", "Inception", "None"], "a": "Batman", "l": "Easy", "t": "Memory", "ev": "You both discussed how much you like Bruce Wayne at 2 PM! 🦇"}]}
            
            Return ONLY the JSON. No conversational text.
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        let quizData;
        try {
            const rawResponse = completion.choices[0].message.content;
            const parsed = JSON.parse(rawResponse);
            quizData = parsed.questions || parsed.quiz || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);
        } catch (e) {
            quizData = ["Who loves who more today? ❤️", "What was the sweetest thing said today?", "What are you both looking forward to tonight?"];
        }

        res.json({ questions: quizData.slice(0, 10), isQuizTime });
    } catch (e) {
        console.error("Groq Error:", e);
        res.status(500).json({ error: "AI logic skipped due to error", fallback: true });
    }
});

const TTTGameSchema = new mongoose.Schema({
    coupleId: String,
    player1: String, // ID of X
    player2: String, // ID of O
    board: { type: [String], default: ["", "", "", "", "", "", "", "", ""] },
    turn: String, // Current Player ID
    winner: { type: String, default: null },
    status: { type: String, default: "pending" }, // pending, playing, finished
    createdAt: { type: Date, default: Date.now }
});
const TTTGame = mongoose.model('TTTGame', TTTGameSchema);

app.post('/api/quiz-complete', checkAuth, async (req, res) => {
    try {
        const { score, total } = req.body;
        const user = res.locals.user;
        const coupleId = [user._id.toString(), (user.partnerId || '')].sort().join('_');

        await QuizResult.create({
            coupleId,
            userId: user._id.toString(),
            score: score || 0,
            total: total || 10
        });

        user.loveScore += (score * 2);
        await user.save();

        res.json({ success: true, reward: score * 2 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});



app.get('/api/today-stats', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.json({ score: 0, insight: "Pair with your partner first! ❤️", bars: [10, 10, 10, 10, 10] });

        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');

        // Fetch activity (Messages + Snaps)
        const msgCount = await Message.countDocuments({ coupleId, timestamp: { $gte: startOfDay } });
        const snapCount = await Message.countDocuments({ coupleId, type: 'image', timestamp: { $gte: startOfDay } });

        // Basic Love Score Algorithm
        let baseScore = 65; // Start with a decent base
        baseScore += (msgCount * 0.5); // +0.5 per message
        baseScore += (snapCount * 5); // +5 per snap

        // Cap at 99
        const finalScore = Math.min(Math.round(baseScore), 99);

        // Insight logic
        let insight = "Keep the love growing! ❤️";
        if (msgCount > 15) insight = "Great job! You replied faster today than usual 😍";
        else if (snapCount > 2) insight = "You're sharing so many memories today! 📸✨";
        else if (msgCount > 0) insight = "Small steps, big love. Keep talking! 💬❤️";
        else insight = "Start the day with a cute 'I Love You'! 🏹";

        // Generate dynamic bars based on activity hourly (mocked but feels real)
        const bars = [30, 45, 60, 80, msgCount > 10 ? 95 : 70];

        res.json({ score: finalScore, insight, bars });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- TIC TAC TOE APIs ---
function checkTTTWinner(board) {
    const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    for (let [a, b, c] of wins) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return null;
}

app.post('/api/ttt/create', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        if (!user.partnerId) return res.status(400).json({ error: "No partner found!" });
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');
        await TTTGame.deleteMany({ coupleId });
        const game = await TTTGame.create({
            coupleId, player1: user._id.toString(), player2: user.partnerId,
            turn: user._id.toString(), status: "playing"
        });
        io.to(coupleId).emit('ttt-invite', { senderName: user.name, gameId: game._id });
        res.json(game);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ttt/active', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');
        const game = await TTTGame.findOne({ coupleId, status: "playing" });
        res.json(game);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ttt/move', checkAuth, async (req, res) => {
    try {
        const { gameId, index } = req.body;
        const user = res.locals.user;
        const game = await TTTGame.findById(gameId);
        if (!game || game.status !== 'playing') return res.status(400).json({ error: "Invalid Game" });
        if (game.turn !== user._id.toString()) return res.status(400).json({ error: "Wait for turn! ⏳" });
        if (game.board[index] !== "") return res.status(400).json({ error: "Cell Taken" });

        const mark = (user._id.toString() === game.player1) ? 'X' : 'O';
        game.board[index] = mark;

        const winnerMark = checkTTTWinner(game.board);
        if (winnerMark) {
            game.winner = (winnerMark === 'X') ? game.player1 : game.player2;
            game.status = 'finished';
            await User.findByIdAndUpdate(game.winner, { $inc: { loveScore: 20 } });
        } else if (!game.board.includes("")) {
            game.status = 'finished';
        } else {
            game.turn = (game.turn === game.player1) ? game.player2 : game.player1;
        }

        game.markModified('board');
        await game.save();
        io.to(game.coupleId).emit('ttt-move', game);
        res.json(game);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- CHALLENGE & QUIZ ---
const challenges = ["Morning selfie! ☀️", "Say I Love you! ❤️", "Share a memory. 📸"];
app.get('/api/daily-challenge', checkAuth, (req, res) => {
    res.json({ challenge: challenges[Math.floor(Math.random() * challenges.length)] });
});

app.get('/api/quiz-status', checkAuth, async (req, res) => {
    const now = new Date();
    const isReady = (now.getHours() >= 21 || now.getHours() < 1);
    res.json({ active: isReady, streak: res.locals.user.streak, message: isReady ? "Quiz Ready! ❤️" : "Unlocks at 9PM ⏰" });
});

// Real-time Socket.io
// --- SOCKET.IO LOGIC ---
const activeCinemas = new Map();
const activeCallSignals = new Map(); // 🔥 Fix for Vercel/Serverless Call Polling

io.on('connection', async (socket) => {
    const userId = socket.handshake.query.userId || socket.userId;

    // --- AGORA CALL SIGNALING ---
    socket.on('call-user', (data) => {
        console.log(`📞 [CALL] User ${data.callerName} initiating ${data.callType} call to ${data.targetId}`);
        
        // Signal Buffer for Vercel Polling
        activeCallSignals.set(data.targetId, {
            from: data.callerId,
            callerName: data.callerName,
            type: data.callType,
            channelName: data.channelName,
            timestamp: Date.now()
        });

        socket.to(data.targetId).emit('incoming-call', activeCallSignals.get(data.targetId));
    });

    socket.on('accept-call', (data) => {
        activeCallSignals.delete(userId);
        console.log(`🟢 [CALL] Partner accepted.`);
        socket.to(data.to).emit('call-accepted', data);
    });

    socket.on('reject-call', async (data) => {
        activeCallSignals.delete(userId);
        console.log(`🔴 [CALL] Partner rejected call.`);
        socket.to(data.to).emit('call-rejected');

        
        // Save missed call record
        try {
            const coupleId = [userId, data.to].sort().join('_');
            await Message.create({
                coupleId,
                senderId: userId,
                receiverId: data.to,
                text: "Missed Call 📞",
                type: 'text',
                status: 'delivered'
            });
            io.to(coupleId).emit('chat message', { text: "Missed Call 📞", senderId: userId });
        } catch (err) {}
    });

    socket.on('end-call', (data) => {
        console.log(`🛑 [CALL] Connection ended locally.`);
        socket.to(data.to).emit('end-call-signal');
    });

    socket.on('join', async (data) => {
        let { userId, partnerId } = data;
        if (!userId) return;

        // Ensure IDs are strings
        userId = userId.toString();
        partnerId = partnerId ? partnerId.toString() : '';

        const coupleId = [userId, partnerId].sort().join('_');
        
        console.log(`📡 [SOCKET] User ${userId} joining room ${coupleId}. Partner: ${partnerId}`);
        
        socket.join(coupleId);
        socket.join(userId); // Join individual room for direct signaling (calls)

        // --- PARTNERSHIP RECIPROCITY CHECK ---
        // If B is A's partner, but A is NOT B's partner, fix it.
        try {
            if (partnerId) {
                const me = await User.findById(userId);
                const them = await User.findById(partnerId);
                
                if (me && them) {
                    if (them.partnerId !== userId) {
                        console.log(`🛠️ [FIX] Partner mismatch detected! Repairing link: ${them.email} ➔ ${me.email}`);
                        await User.findByIdAndUpdate(partnerId, { partnerId: userId, partnerName: me.name });
                    }
                }
            }
        } catch (err) {
            console.error("Partnership check error:", err);
        }
        
        // Mark all messages where I AM THE RECEIVER as seen
        try {
            const updateResult = await Message.updateMany(
                { coupleId, receiverId: userId, status: { $ne: 'seen' } },
                { $set: { status: 'seen', seen: true, seenAt: new Date() } }
            );
            
            if (updateResult.modifiedCount > 0) {
                console.log(`✅ [SYNC] Marked ${updateResult.modifiedCount} messages as SEEN for ${userId}`);
                io.to(coupleId).emit('messages seen', { viewerId: userId });
            }
        } catch (err) { }

        const history = await Message.find({ coupleId }).sort({ timestamp: 1 }).limit(100);
        socket.emit('load messages', history);
    });

    socket.on('chat message', async (msg) => {
        const { userId, partnerId, text, type, userName, tempId } = msg;
        const coupleId = [userId, partnerId].sort().join('_');

        console.log(`📩 [CHAT] From: ${userName} (${userId}) to Room: ${coupleId}. Type: ${type}`);

        if (!userId || !partnerId) {
            console.warn(`⚠️ [CHAT] Rejected message: Missing userId or partnerId.`);
            return;
        }

        let status = 'sent';
        const clients = io.sockets.adapter.rooms.get(coupleId);
        if (clients && clients.size > 1) {
            status = 'delivered'; // Both are in the room
        }

        const newMsg = await Message.create({ 
            coupleId, 
            senderId: userId, 
            receiverId: partnerId, 
            text, 
            type: type || 'text', 
            status: status 
        });

        // Instant Broadcast to BOTH partners
        io.to(coupleId).emit('chat message', {
            _id: newMsg._id,
            user: userName,
            text: newMsg.text,
            type: newMsg.type,
            time: newMsg.time,
            senderId: userId,
            status: status,
            timestamp: newMsg.timestamp,
            tempId: tempId
        });

        console.log(`✅ [CHAT] Broadcasted to room ${coupleId}. Status: ${status}`);
    });

    socket.on('typing', (data) => {
        if (data.coupleId) socket.to(data.coupleId).emit('typing', { isTyping: data.isTyping });
    });

    socket.on('love-action', (data) => {
        if (data.coupleId) io.to(data.coupleId).emit('trigger-rain', data);
    });

    // --- WATCH TOGETHER SOCKETS & PERSISTENCE ---

    // --- WATCH TOGETHER SOCKETS & PERSISTENCE ---
    socket.on('watch-join', ({ userId, partnerId }) => {
        const room = [userId, partnerId].sort().join('_');
        socket.join(room);
        console.log(`[CINEMA] User ${userId} joined Room ${room} (Room size: ${io.sockets.adapter.rooms.get(room)?.size || 0})`);

        // Sync new joiner with current state
        if (activeCinemas.has(room)) {
            const state = activeCinemas.get(room);
            console.log(`[CINEMA] Pushing initial state to ${userId} in ${room}`);
            socket.emit('video-control', {
                action: 'load',
                videoId: state.videoId,
                time: state.time,
                playing: state.playing
            });
        }
    });

    socket.on('video-control', (data) => {
        if (!data.coupleId) return;

        // Persist State
        if (!activeCinemas.has(data.coupleId)) {
            activeCinemas.set(data.coupleId, { videoId: data.videoId || 'dQw4w9WgXcQ', time: 0, playing: false });
        }
        const state = activeCinemas.get(data.coupleId);

        if (data.action === 'load') state.videoId = data.videoId;
        if (data.time !== undefined) state.time = data.time;
        if (data.action === 'play') state.playing = true;
        if (data.action === 'pause') state.playing = false;

        console.log(`[CINEMA] Sync [${data.action}] -> Room ${data.coupleId}`);
        socket.to(data.coupleId).emit('video-control', data);
    });

    socket.on('video-chat', (data) => {
        // data: { text: string, senderName: string, coupleId: string }
        socket.to(data.coupleId).emit('video-chat', data);
    });
});

server.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT} 🚀`));
