/**
 * BattlePlanAgent - Smart Domain Version 1.2
 * Fix: Updated model naming to resolve 404 Fetch Error
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// Global paths for the OAuth keys
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Required permission scopes for Google API
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
];

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Main execution loop: Fetches, Filters, Analyzes, and Emails.
 */
async function runAgent() {
    try {
        // Authenticate and initialize clients
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        // Set the scan window: today through 7 days out
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const items = events.data.items || [];
        const myDomain = process.env.MY_DOMAIN.toLowerCase();

        // THE SMART FILTER TOGGLE
        const targetMeetings = items.filter(e => {
            // Logic: If on a personal @gmail account, brief everything.
            if (myDomain === 'gmail.com') return true;

            // Logic: For corporate domains, only brief meetings involving people outside the organization.
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) {
            console.log("No relevant meetings found for the specified domain criteria.");
            return;
        }

        let fullReportHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                                <h1 style="color: #0052CC;">🎯 Weekly Battle Plan</h1>
                                <p style="color: #666;">Mode: ${myDomain === 'gmail.com' ? 'Full Scan' : 'External Only'}</p>`;

        for (const meeting of targetMeetings) {
            // Determine search context: Use the first non-self attendee email or the title.
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

            // Pull context from Gmail (limit to 3 for speed)
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

            // Generate AI Dossier
            const dossier = await generateDossier(meeting, emailSnippets);
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #eee; margin: 30px 0;'>";
        }

        fullReportHtml += "</div>";

        // Dispatch final report
        await sendEmail(fullReportHtml);
        console.log(`✅ Success: Battle Plan sent for ${targetMeetings.length} items.`);

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

/**
 * AI Synthesis via Gemini: Uses 'gemini-1.5-flash-latest' to resolve 404 errors.
 */
async function generateDossier(meeting, snippets) {
    // UPDATED MODEL NAME BELOW
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    
    const prompt = `
        ACT AS: A Technical Solution Strategy Assistant.
        CONTEXT: Meeting: ${meeting.summary}. Emails: ${snippets.join(' | ')}.
        
        INSTRUCTIONS:
        - Output ONLY raw HTML (H2, UL, LI).
        - NO CORPORATE FLUFF.
        - If it's a solo block (no attendees), provide a 1-sentence "Focus Tip".
        - If it's a meeting, provide:
          <h2>Objective</h2>: The literal goal based on context.
          <h2>Discovery Questions</h2>: 2 specific questions to uncover pain or bottlenecks.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Handles the OAuth2 flow: loads existing token or starts new browser handshake.
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
 * Interactive CLI prompt to capture the Google Auth code.
 */
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    console.log('🚀 Step 1: Open this URL to authorize:', authUrl);
    
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
        readline.question('Step 2: Paste the "code=" parameter from the URL here: ', async (code) => {
            readline.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
                console.log('✅ Token stored successfully.');
                resolve(oAuth2Client);
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * Transports the final report via Nodemailer/Gmail SMTP.
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