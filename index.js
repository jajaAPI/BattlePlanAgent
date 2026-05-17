/**
 * BattlePlanAgent - 2026 Production Edition (v1.3)
 * Author: Jaja (Fallen Crown BV)
 * Logic: Google Calendar + Gmail Context -> Gemini 2.5 Synthesis -> Email Dispatch
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// Configuration for persistent authentication
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Necessary permissions for read/send operations
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
];

// Initialize the 2026 Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Orchestrator: Connects to Google, filters meetings, and triggers AI synthesis.
 */
async function runAgent() {
    try {
        // Step 1: Authentication Handshake
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        // Step 2: Define the look-ahead window (7 days)
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        // Step 3: Extract calendar items
        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const items = events.data.items || [];
        const myDomain = process.env.MY_DOMAIN.toLowerCase();

        // Step 4: Smart Filtering logic
        // Logic: Bypass filters for 'gmail.com' (personal); keep only external for corporate domains.
        const targetMeetings = items.filter(e => {
            if (myDomain === 'gmail.com') return true;
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) {
            console.log("No relevant meetings found based on current domain filters.");
            return;
        }

        let fullReportHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                                <h1 style="color: #0052CC; border-bottom: 2px solid #0052CC; padding-bottom: 10px;">🎯 Weekly Battle Plan</h1>
                                <p style="color: #666;">Generated on: ${now.toLocaleDateString()}</p>`;

        // Step 5: Process each valid meeting for context
        for (const meeting of targetMeetings) {
            // Find the first attendee that isn't the user to build a Gmail search query
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

            // Fetch the last 3 snippets from Gmail for historical context
            const gmailRes = await gmail.users.messages.list({
                userId: 'me',
                q: searchQuery,
                maxResults: 3
            });

            let emailSnippets = [];
            if (gmailRes.data.messages) {
                for (const msg of gmailRes.data.messages) {
                    const content = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                    emailSnippets.push(content.data.snippet);
                }
            }

            // Step 6: AI Synthesis using Gemini 2.5 Flash
            const dossier = await generateDossier(meeting, emailSnippets);
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #eee; margin: 30px 0;'>";
        }

        fullReportHtml += "</div>";

        // Step 7: Final Dispatch
        await sendEmail(fullReportHtml);
        console.log(`✅ Success: Battle Plan sent to inbox (${targetMeetings.length} items).`);

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

/**
 * Generates tactical dossiers. Uses Gemini 2.5 Flash for optimal performance/latency.
 */
async function generateDossier(meeting, snippets) {
    // UPDATED: Using the Gemini 2.5 architecture to resolve 404 legacy errors
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
        ACT AS: A Technical Solution Strategy Assistant.
        CONTEXT: Meeting: ${meeting.summary}. 
        DESCRIPTION: ${meeting.description || 'N/A'}.
        EMAIL HISTORY: ${snippets.join(' | ')}.
        
        INSTRUCTIONS:
        - Output raw HTML only (H2, UL, LI).
        - ZERO FLUFF. Brutally objective and tactical.
        - If it is a solo block or focus time, provide a 1-sentence productivity tip.
        - If it is a meeting, provide:
          <h2>Objective</h2> (What are we trying to solve?)
          <h2>Tactical Wedge</h2> (A specific discovery question to move the needle).
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Authentication management: loads stored tokens or triggers new login.
 */
async function authenticate() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const oAuth2Client = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris[0]);

    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (e) {
        return getNewToken(oAuth2Client);
    }
}

/**
 * CLI-based OAuth2 handshake.
 */
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    console.log('🚀 Authorize this app by visiting:', authUrl);
    
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
        readline.question('Paste the code from the browser redirect here: ', async (code) => {
            readline.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
                console.log('✅ Token generated and saved.');
                resolve(oAuth2Client);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Dispatches the final HTML report via Gmail SMTP.
 */
async function sendEmail(html) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.MY_EMAIL,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });

    await transporter.sendMail({
        from: `BattlePlanAgent <${process.env.MY_EMAIL}>`,
        to: process.env.MY_EMAIL,
        subject: `🎯 Battle Plan: ${new Date().toLocaleDateString()}`,
        html: html
    });
}

// Initialization
runAgent();