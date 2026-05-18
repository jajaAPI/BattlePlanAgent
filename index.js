/**
 * BattlePlanAgent - v1.5 (Multi-Calendar Support)
 * Fixes: Scans all user calendars to find italki/work/personal events.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
];

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function runAgent() {
    try {
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        // v1.5 Update: Fetch the list of all calendars you use
        const calendarList = await calendar.calendarList.list();
        const calendars = calendarList.data.items || [];
        
        let allItems = [];

        console.log(`🔎 Scanning ${calendars.length} calendars...`);

        for (const cal of calendars) {
            const events = await calendar.events.list({
                calendarId: cal.id,
                timeMin: now.toISOString(),
                timeMax: nextWeek.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });
            if (events.data.items) {
                allItems = allItems.concat(events.data.items);
            }
        }

        const myDomain = process.env.MY_DOMAIN.toLowerCase();

        // Filter logic remains the same
        const targetMeetings = allItems.filter(e => {
            if (myDomain === 'gmail.com') return true;
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) {
            console.log("❌ No relevant meetings found across any calendars.");
            return;
        }

        let fullReportHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                                <h1 style="color: #0052CC; border-bottom: 2px solid #0052CC; padding-bottom: 10px;">🎯 Weekly Battle Plan</h1>`;

        for (const meeting of targetMeetings) {
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
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

async function generateDossier(meeting, snippets) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
        - If the meeting is a solo block like a lesson (e.g. Dutch), focus on preparation.
        - If the title is "Test meeting", treat it as a technical validation step.
        - SECTIONS:
          <h2>Strategic Focus</h2>: The primary objective.
          <h2>Tactical Wedge</h2>: One specific discovery question or action item.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * AUTH & EMAIL HELPERS (Unchanged)
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
            } catch (err) { reject(err); }
        });
    });
}

async function sendEmail(html) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.MY_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
        from: `BattlePlanAgent <${process.env.MY_EMAIL}>`,
        to: process.env.MY_EMAIL,
        subject: `🎯 Battle Plan: ${new Date().toLocaleDateString()}`,
        html: html
    });
}

runAgent();