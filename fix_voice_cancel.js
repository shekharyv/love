const fs = require('fs');
const path = 'e:/Loveyapa/lovesync-landing/views/chat.ejs';
let content = fs.readFileSync(path, 'utf8');

// Add cancellation flag and check in onstop
const fixCancelJS = `
        let isCanceled = false; // Flag to prevent sending after cancel
        async function startRecording(e) {
            if(e) e.preventDefault();
            isCanceled = false; // Reset flag
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                mediaRecorder.onstop = async () => {
                    if (isCanceled) { 
                        console.log("Recording Canceled 🚫"); 
                        return; 
                    }
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.readAsDataURL(audioBlob);
                    reader.onloadend = async () => {
                        const base64Audio = reader.result;
                        await fetch('/api/send-voice', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audio: base64Audio, coupleId: COUPLE_ID })
                        });
                        createHeartEffect();
                    };
                };
                mediaRecorder.start();
                startTime = Date.now();
                document.getElementById('voice-modal').classList.remove('hidden');
                vibrateDevice();
                timerInterval = setInterval(updateTimer, 1000);
            } catch(e) { console.error(e); }
        }

        function cancelRecording() {
            isCanceled = true; // Block sending
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                const tracks = mediaRecorder.stream.getTracks();
                tracks.forEach(track => track.stop());
            }
            clearInterval(timerInterval);
            document.getElementById('voice-modal').classList.add('hidden');
            audioChunks = [];
        }
`;

// Replace startRecording and cancelRecording
content = content.replace(/async function startRecording\(e\) \{[\s\S]*?timerInterval = setInterval\(updateTimer, 1000\);\s*\}\s*catch\(e\) \{ console\.error\(e\); \}\s*\}/, "");
content = content.replace(/function cancelRecording\(\) \{[\s\S]*?audioChunks = \[\];\s*\}/, "");

// Inject the new logic
content = content.replace('// --- VOICE LOGIC ---', '// --- VOICE LOGIC ---\n' + fixCancelJS);

fs.writeFileSync(path, content, 'utf8');
console.log("Fixed Voice Cancellation Bug! 🚫🎙️");
