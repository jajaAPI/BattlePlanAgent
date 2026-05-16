/**
 * Monday Battle Plan Agent
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Automated Monday briefing for upcoming sales meetings.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ApifyClient } = require('apify-client');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// Constants
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const apifyClient = new ApifyClient({ token: process.env.APIFY_TOKEN });

async function runAgent() {
    try {
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        // 1. Get meetings for the next 7 days
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
        // Filter: Keep only external meetings (excluding your company domain)
        const targetMeetings = items.filter(e => {
            const attendees = e.attendees || [];
            return attendees.some(a => !a.email.endsWith(process.env.MY_DOMAIN));
        });

        let fullReportHtml = "<h1>Your Monday Battle Plan</h1>";

        for (const meeting of targetMeetings) {
            const externalAttendee = meeting.attendees.find(a => !a.email.endsWith(process.env.MY_DOMAIN)).email;
            
            // 2. Fetch Gmail Context (last 3 threads)
            const gmailThreads = await gmail.users.threads.list({
                userId: 'me',
                q: `from:${externalAttendee} OR to:${externalAttendee}`,
                maxResults: 3
            });

            // 3. Trigger Scrapers (Optional: Logic to find LinkedIn URL from Email)
            // For MVP, we use the company website derived from email domain
            const domain = externalAttendee.split('@')[1];
            
            // 4. Generate Dossier with Gemini
            const dossier = await generateDossier(meeting, gmailThreads.data.threads, domain);
            fullReportHtml += dossier;
        }

        // 5. Send the Digest
        await sendEmail(fullReportHtml);
        console.log("Battle Plan sent successfully.");

    } catch (error) {
        console.error("Critical Failure:", error);
    }
}

async function generateDossier(meeting, threads, domain) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // System instructions built in previous turns
    const prompt = `
        You are a B2B Sales Engineer. Create a tactical dossier for: ${meeting.summary}.
        Context from Email Threads: ${JSON.stringify(threads || [])}
        Target Domain: ${domain}

        RULES:
        - NO FLUFF (Banned: seamless, optimize, friction, landscape).
        - Structure: <h2>Target</h2>, <h2>The Attack Plan</h2> (Literal Bottleneck, Hard Cost), <h2>The Wedge</h2> (Feature Mapping, Hook Question).
        - Output ONLY raw HTML.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Standard Google OAuth2 Handshake
 */
async function authenticate() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const auth = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris[0]);

    try {
        const token = await fs.readFile(TOKEN_PATH);
        auth.setCredentials(JSON.parse(token));
    } catch (e) {
        // Handle token generation logic here if file doesn't exist
        console.log("No token.json found. Run the OAuth flow first.");
    }
    return auth;
}

async function sendEmail(html) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.MY_EMAIL,
            pass: process.env.GMAIL_APP_PASSWORD,
        },
    });

    await transporter.sendMail({
        from: process.env.MY_EMAIL,
        to: process.env.MY_EMAIL,
        subject: `🎯 Battle Plan: Week of ${new Date().toLocaleDateString()}`,
        html: html
    });
}

runAgent();
