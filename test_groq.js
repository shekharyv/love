const Groq = require('groq-sdk');
require('dotenv').config();

async function test() {
    try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: 'Give me a relationship truth.' }],
            model: 'llama-3.3-70b-versatile',
        });
        console.log("SUCCESS:", chatCompletion.choices[0].message.content);
    } catch (e) {
        console.error("ERROR:", e.message);
    }
}
test();
