/**
 * BattlePlanAgent - Monday Morning Intelligence
 * Author: Jaja (Fallen Crown BV)
 * Logic: Google Calendar -> Gmail Context -> Gemini Synthesis -> Email Digest
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ApifyClient } = require('apify-client');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// File paths for credentials and stored tokens
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Required Google Scopes for the agent
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
];

// Initialize external APIs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });

/**
 * Main execution loop
 */
async function runAgent() {
    try {
        // Step 1: Handle Google Auth (Handshake or Token Load)
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        // Step 2: Define time window (Next 7 days from now)
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        // Step 3: Fetch Calendar Events
        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const items = events.data.items || [];
        
        // Filter: Keep only meetings with external participants (skip internal syncs)
        const targetMeetings = items.filter(e => {
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(process.env.MY_DOMAIN));
        });

        if (targetMeetings.length === 0) {
            console.log("No external meetings found for the coming week.");
            return;
        }

        let fullReportHtml = `<div style="font-family: Arial, sans-serif;">
                                <h1 style="color: #1d1d1d;">🎯 Your Monday Battle Plan</h1>
                                <p>Weekly Intelligence Report for ${now.toLocaleDateString()}</p>`;

        for (const meeting of targetMeetings) {
            // Identify the primary external lead
            const externalLead = meeting.attendees.find(a => !a.email.endsWith(process.env.MY_DOMAIN)).email;
            const domain = externalLead.split('@')[1];

            // Step 4: Search Gmail for recent context (last 5 messages)
            const gmailRes = await gmail.users.messages.list({
                userId: 'me',
                q: `from:${externalLead} OR to:${externalLead}`,
                maxResults: 5
            });

            // Extract snippets for Gemini to analyze
            let emailSnippets = [];
            if (gmailRes.data.messages) {
                for (const msg of gmailRes.data.messages) {
                    const content = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                    emailSnippets.push(content.data.snippet);
                }
            }

            // Step 5: Synthesize Dossier with Gemini
            const dossier = await generateDossier(meeting, emailSnippets, domain);
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #eee; margin: 20px 0;'>";
        }

        fullReportHtml += "</div>";

        // Step 6: Dispatch the Weekly Battle Plan
        await sendEmail(fullReportHtml);
        console.log("✅ Success: Battle Plan sent to your inbox.");

    } catch (error) {
        console.error("❌ Critical Failure:", error);
    }
}

/**
 * AI Synthesis Logic - Zero Fluff / Tactical Focus
 */
async function generateDossier(meeting, snippets, domain) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
        ACT AS: A Senior Solution Engineer.
        GOAL: Brief the rep on a specific meeting for: ${meeting.summary} (${domain}).
        DATA SOURCES:
        - Meeting Name: ${meeting.summary}
        - Description: ${meeting.description || 'No description provided'}
        - Recent Email Context: ${snippets.join(' | ')}

        REQUIREMENTS:
        1. Use raw HTML for output (H2, UL, LI).
        2. NO CORPORATE FLUFF. (Banned: seamless, optimize, landscape, synergy, friction).
        3. MANDATORY SECTIONS:
           - <h2>Target Insight</h2>: Based on emails, what is the literal bottleneck?
           - <h2>Tactical Wedge</h2>: Map one feature to their pain. Provide one specific discovery question.
        4. If data is thin, explicitly state: "Limited context found. Focus on Discovery."
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Authentication Handler - Checks for existing token or initiates login
 */
async function authenticate() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const { client_id, client_secret, redirect_uris } = key;
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (e) {
        return getNewToken(oAuth2Client);
    }
}

/**
 * Interactive Token Generation for first-time setup
 */
async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('🚀 Authorize this app by visiting this url:', authUrl);
    
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve, reject) => {
        readline.question('Enter the code from the redirected page here: ', async (code) => {
            readline.close();
            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
                console.log('✅ Success: Token stored to', TOKEN_PATH);
                resolve(oAuth2Client);
            } catch (err) {
                console.error('❌ Error retrieving access token', err);
                reject(err);
            }
        });
    });
}

/**
 * Email Dispatch via Nodemailer (Gmail SMTP)
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
        subject: `🎯 Battle Plan: Week of ${new Date().toLocaleDateString()}`,
        html: html
    });
}

// Execute
runAgent();