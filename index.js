/**
 * BattlePlanAgent - 2026 Production Edition (v1.4)
 * Author: Jaja (Fallen Crown BV)
 * Logic: 
 * 1. Scans Google Calendar (Solo + Group events).
 * 2. Fetches Gmail context for relevant threads.
 * 3. Synthesizes tactical dossiers using Gemini 2.5 Flash.
 * 4. Dispatches HTML Battle Plan to inbox.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// File paths for persistence
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Required permission scopes
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
];

// Initialize Gemini 2.5 SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function runAgent() {
    try {
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        console.log(`🔎 Scanning for events: ${now.toLocaleDateString()} to ${nextWeek.toLocaleDateString()}`);

        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const items = events.data.items || [];
        const myDomain = process.env.MY_DOMAIN.toLowerCase();

        // SMART FILTER LOGIC (v1.4 Fix: Allows solo events for personal accounts)
        const targetMeetings = items.filter(e => {
            // Personal Mode: If you are using a Gmail domain, include EVERYTHING (solo blocks, lessons, etc.)
            if (myDomain === 'gmail.com') return true;

            // Corporate Mode: Only keep meetings with at least one external person (noise reduction)
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) {
            console.log("❌ No relevant meetings found for this window.");
            return;
        }

        let fullReportHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                                <h1 style="color: #0052CC; border-bottom: 2px solid #0052CC; padding-bottom: 10px;">🎯 Weekly Battle Plan</h1>`;

        for (const meeting of targetMeetings) {
            // Find a lead email to search for context, skipping 'self'
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            
            // Query logic: Search for thread with the lead, otherwise just use the meeting title
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

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

            // Synthesize the briefing dossier
            const dossier = await generateDossier(meeting, emailSnippets);
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #eee; margin: 30px 0;'>";
        }

        fullReportHtml += "</div>";

        await sendEmail(fullReportHtml);
        console.log(`✅ Success: Battle Plan sent (${targetMeetings.length} items analyzed).`);

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

/**
 * AI Synthesis Logic
 * Specific prompt tuning to prevent hallucinated objectives for generic titles.
 */
async function generateDossier(meeting, snippets) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Check if we actually have data to work with
    const contextAvailable = snippets.length > 0;
    const emailData = contextAvailable ? snippets.join(' | ') : "No recent email context found.";
    
    const prompt = `
        ACT AS: A Personal Strategic Assistant.
        MEETING: ${meeting.summary}
        DESCRIPTION: ${meeting.description || 'No description provided.'}
        GMAIL CONTEXT: ${emailData}
        
        INSTRUCTIONS:
        - Output raw HTML only (H2, UL, LI).
        - ZERO FLUFF. Be brutally honest and objective.
        - If the meeting is a solo block (no guests) like a lesson or focus time, provide 1 specific "High-Yield Tip".
        - If the meeting is with others but GMAIL CONTEXT is "No recent email context found," DO NOT invent objectives. Instead, ask me to define the goal.
        - If context exists, provide:
          <h2>Strategic Focus</h2>: The primary objective.
          <h2>Tactical Wedge</h2>: One specific, sharp discovery question or action item.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * AUTHENTICATION MODULE
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

async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    console.log('🚀 Authorize here:', authUrl);
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    
    return new Promise((resolve, reject) => {
        readline.question('Paste the code here: ', async (code) => {
            readline.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
                resolve(oAuth2Client);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * DISPATCH MODULE
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

runAgent();