const Groq = require('groq-sdk');
require('dotenv').config();
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
const io = new Server(server);

// Prevent Unhandled Rejections from crashing
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const LOCAL_MONGODB_URI = 'mongodb://127.0.0.1:27017/lovesync';

let activeMongoUri = MONGODB_URI;

// --- SMART-SYNC MONGODB CONNECTION ---
console.log("Attempting to connect to MongoDB... ⏳");
const mongoClientPromise = mongoose.connect(MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 10000
})
    .then(() => {
        console.log('✅ Success: Connected to MongoDB Atlas Cloud Cluster! 🚀');
        activeMongoUri = MONGODB_URI;
        return mongoose.connection.getClient();
    })
    .catch(async (err) => {
        console.error('⚠️ Cloud Connection Failed. Using LOCAL Fallback... 🔌');
        console.error(`Reason: ${err.message}`);

        await mongoose.connect(LOCAL_MONGODB_URI, {
            family: 4,
            serverSelectionTimeoutMS: 10000
        });

        console.log('✅ Success: Connected to LOCAL MongoDB! 💻');
        activeMongoUri = LOCAL_MONGODB_URI;
        return mongoose.connection.getClient();
    })
    .catch((localErr) => {
        console.error('🛑 DATABASE ERROR: Both Cloud and Local failed!', localErr.message);
        throw localErr;
    });

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
    pendingRequest: { type: String, default: null },
    streak: { type: Number, default: 0 },
    loveScore: { type: Number, default: 0 },
    mood: { type: String, default: '😴' }
});
const QuizResultSchema = new mongoose.Schema({
    coupleId: String,
    userId: String,
    score: Number,
    total: { type: Number, default: 10 },
    timestamp: { type: Date, default: Date.now }
});
const QuizResult = mongoose.model('QuizResult', QuizResultSchema);

const User = mongoose.model('User', UserSchema);

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
    if (req.session.userId) {
        res.locals.user = await User.findById(req.session.userId);
        if (res.locals.user) return next();
    }
    res.redirect('/auth');
};

// Generate Unique Love Code Helper
function generateLoveCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

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
    if (req.session.userId) return res.redirect('/home');
    res.render('auth');
});

// Protected routes (Always passing user)
app.get('/home', checkAuth, (req, res) => res.render('home', { user: res.locals.user }));
app.get('/chat', checkAuth, (req, res) => res.render('chat', { user: res.locals.user }));
app.get('/insights', checkAuth, (req, res) => res.render('insights', { user: res.locals.user }));
app.get('/profile', checkAuth, (req, res) => res.render('profile', { user: res.locals.user }));
app.get('/camera', checkAuth, (req, res) => res.render('camera', { user: res.locals.user }));
app.get('/quiz', checkAuth, (req, res) => res.render('quiz', { user: res.locals.user }));
app.get('/discover', checkAuth, (req, res) => res.render('discover', { user: res.locals.user }));


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


app.post('/api/send-message', checkAuth, async (req, res) => {
    try {
        const { senderId, receiverId, text } = req.body;
        const coupleId = [senderId, receiverId].sort().join('_');
        const newMsg = await Message.create({ coupleId, senderId, receiverId, text, type: 'text', status: 'sent' });
        io.to(coupleId).emit('chat message', { user: res.locals.user.name, text: newMsg.text, type: 'text', time: newMsg.time, senderId: senderId, status: 'sent' });
        res.json({ success: true, message: "Stored" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/send-message', checkAuth, async (req, res) => {
    try {
        const { senderId, receiverId, text } = req.body;
        const coupleId = [senderId, receiverId].sort().join('_');
        const newMsg = await Message.create({ coupleId, senderId, receiverId, text, type: 'text', status: 'sent' });
        io.to(coupleId).emit('chat message', { user: res.locals.user.name, text: newMsg.text, type: 'text', time: newMsg.time, senderId: senderId, status: 'sent', _id: newMsg._id });
        res.send("Message stored ✅");
    } catch (e) { res.status(500).send("Error: " + e.message); }
});


// Guide: Get Chat History
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
        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ error: "User already registered! 🧐" });

        const user = await User.create({ name, email, password, code: generateLoveCode() });
        req.session.userId = user._id;
        res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, partnerId: user.partnerId } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });

        if (!user) {
            const allUsers = await User.find({}, 'email name');
            console.log("Login Failed. Current Users in DB:", allUsers);
            return res.status(401).json({ error: "Invalid email or password! ❌" });
        }

        req.session.userId = user._id;
        res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, partnerId: user.partnerId } });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        if (me.partnerId) return res.status(400).json({ error: "Already connect!" });

        if (me.pendingRequest === partner._id.toString()) {
            await User.findByIdAndUpdate(me._id, { partnerId: partner._id, partnerName: partner.name, pendingRequest: null });
            await User.findByIdAndUpdate(partner._id, { partnerId: me._id, partnerName: me.name, pendingRequest: null });
            return res.json({ success: true, status: 'connected', partnerName: partner.name });
        } else {
            await User.findByIdAndUpdate(partner._id, { pendingRequest: me._id });
            return res.json({ success: true, status: 'waiting' });
        }
    } catch (err) { res.status(500).json({ error: "Server error!" }); }
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

    const lastActivity = await Activity.findOne({ userId: user.partnerId }).sort({ timestamp: -1 });
    const lastPartnerMood = await Activity.findOne({ userId: user.partnerId, type: 'mood' }).sort({ timestamp: -1 });

    res.json({
        name: user.partnerName,
        partnerId: user.partnerId,
        status: lastActivity ? `Active ${Math.floor((new Date() - lastActivity.timestamp) / 60000)}m ago` : "Online",
        streak: user.streak,
        image: "/images/partner-avatar.png",
        partnerMood: lastPartnerMood ? lastPartnerMood.content : "None",
        myMood: myLastMood ? myLastMood.content : "None"
    });
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
    const { type } = req.query; // 'truth' or 'dare'
    const user = res.locals.user;
    if (!user.partnerId) return res.status(400).json({ error: "No partner synced!" });

    try {
        const coupleId = [user._id.toString(), user.partnerId].sort().join('_');

        // Fetch last 15 messages for context
        const recentMessages = await Message.find({ coupleId })
            .sort({ timestamp: -1 })
            .limit(15);

        // Fetch last 10 challenges to avoid repeats
        const lastGames = await Message.find({
            coupleId,
            text: { $regex: /^GAME CHALLENGE:/ }
        }).limit(10).sort({ timestamp: -1 });

        const avoidList = lastGames.map(g => g.text.replace('GAME CHALLENGE: ', '')).join(' | ');

        const context = recentMessages
            .filter(m => m.type === 'text' && !m.text.startsWith('GAME CHALLENGE:'))
            .map(m => m.text)
            .reverse()
            .join(' | ');

        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are LoveSync AI, a specialized adult relationship/couples coach. 
                    Create a highly personalized, spicy, and explicitly romantic ${type} for a couple. 
                    CONTEXT: ${context || 'They are sharing an intimate moment'}.
                    AVOID THESE (PREVIOUS CHALLENGES): ${avoidList || 'None'}.

                    DESIGN RULES:
                    1. ADULT CONTENT: Be naughty, spicy, and daring. Explicit and naughty romantic challenges are ALLOWED.
                    2. INNOVATION: Do not repeat previous themes or prompts. Use the context to be clever.
                    3. SHORT: Max 15 words. Use emojis 🔥🫦👀💋.
                    4. Output MUST be ONLY the challenge text. No introductory talk.`
                },
                {
                    role: 'user',
                    content: `Generate a naughty/spicy ${type} challenge.`
                }
            ],
            model: 'llama-3.3-70b-versatile',
        });

        let challenge = chatCompletion.choices[0].message.content.trim().replace(/"/g, '');
        res.json({ challenge });
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

app.get('/api/insights/behavior', checkAuth, async (req, res) => {
    try {
        const user = res.locals.user;
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
        const coupleId = [user._id.toString(), (user.partnerId || '')].sort().join('_');

        const messages = await Message.find({ coupleId, timestamp: { $gte: startOfDay } });

        // Calculate Snap Frequency
        const userSnaps = messages.filter(m => m.senderId === user._id.toString() && m.type === 'image').length;
        const partnerSnaps = messages.filter(m => m.senderId === (user.partnerId || '') && m.type === 'image').length;

        // Calculate Moments Missed (Unread)
        const userMissed = await Message.countDocuments({ receiverId: user._id.toString(), status: { $ne: 'seen' } });
        const partnerMissed = await Message.countDocuments({ receiverId: (user.partnerId || ''), status: { $ne: 'seen' } });

        // Calculate Quiz Accuracy (Latest result)
        const userQuiz = await QuizResult.findOne({ userId: user._id.toString() }).sort({ timestamp: -1 });
        const partnerQuiz = await QuizResult.findOne({ userId: (user.partnerId || '') }).sort({ timestamp: -1 });

        const userAcc = userQuiz ? Math.round((userQuiz.score / userQuiz.total) * 100) : 0;
        const partnerAcc = partnerQuiz ? Math.round((partnerQuiz.score / partnerQuiz.total) * 100) : 0;

        // Reply Speed Mock (Realistic based on msg count)
        const userSpeed = messages.filter(m => m.senderId === user._id.toString()).length > 10 ? "1.2m" : "2.8m";
        const partnerSpeed = messages.filter(m => m.senderId === (user.partnerId || '')).length > 8 ? "2.1m" : "3.4m";

        res.json({
            user: { speed: userSpeed, missed: userMissed, snaps: userSnaps, accuracy: userAcc },
            partner: { speed: partnerSpeed, missed: partnerMissed, snaps: partnerSnaps, accuracy: partnerAcc }
        });
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
const activeCinemas = new Map(); // Global State
io.on('connection', async (socket) => {
    socket.on('join', async (data) => {
        const { userId, partnerId } = data;
        const coupleId = [userId, partnerId].sort().join('_');
        socket.join(coupleId);

        // Mark all messages where I AM THE RECEIVER as seen
        await Message.updateMany(
            { coupleId, receiverId: userId, status: { $ne: 'seen' } },
            { $set: { status: 'seen', seen: true, seenAt: new Date() } }
        );

        io.to(coupleId).emit('messages seen', { viewerId: userId });

        const history = await Message.find({ coupleId }).sort({ timestamp: 1 }).limit(100);
        socket.emit('load messages', history);
    });

    socket.on('chat message', async (msg) => {
        const { userId, partnerId, text, type, userName } = msg;
        const coupleId = [userId, partnerId].sort().join('_');

        // Initial status: sent
        let status = 'sent';

        // Check if partner is in the room for instant delivery (double check)
        const clients = io.sockets.adapter.rooms.get(coupleId);
        if (clients && clients.size > 1) {
            status = 'delivered'; // They are both in the room!
        }

        const newMsg = await Message.create({ coupleId, senderId: userId, receiverId: partnerId, text, type: type || 'text', status: status });
        io.to(coupleId).emit('chat message', {
            user: userName,
            text: newMsg.text,
            type: newMsg.type,
            time: newMsg.time,
            senderId: userId,
            status: status
        });
    });

    socket.on('typing', (data) => {
        if (data.coupleId) socket.to(data.coupleId).emit('typing', { isTyping: data.isTyping });
    });

    // --- WebRTC Signaling for Calls ---
    socket.on('call-user', (data) => {
        socket.to(data.coupleId).emit('incoming-call', { offer: data.offer, from: data.from, type: data.type });
    });

    socket.on('answer-call', (data) => {
        socket.to(data.coupleId).emit('call-answered', { answer: data.answer });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.coupleId).emit('ice-candidate', { candidate: data.candidate });
    });

    socket.on('hangup', (data) => {
        socket.to(data.coupleId).emit('call-ended');
    });

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
