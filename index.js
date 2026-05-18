/**
 * BattlePlanAgent - v1.6 (High-Quality Strategy Edition)
 * Author: Jaja (Fallen Crown BV)
 * Updates: Multi-calendar support, objective-first prompting, and solo-block visibility.
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

        // Fetch all sub-calendars (Work, italki, Personal, etc.)
        const calendarList = await calendar.calendarList.list();
        const calendars = calendarList.data.items || [];
        
        let allItems = [];
        console.log(`🔎 Found ${calendars.length} calendars. Scanning for events...`);

        for (const cal of calendars) {
            // Log calendar names to verify italki is being reached
            console.log(`   - Scanning: ${cal.summary}`);
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

        // Filter: If MY_DOMAIN is gmail.com, we want the full picture (Lessons + Meetings)
        const targetMeetings = allItems.filter(e => {
            if (myDomain === 'gmail.com') return true; 
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) {
            console.log("❌ No meetings passed the filter.");
            return;
        }

        let fullReportHtml = `<div style="font-family: 'Helvetica', sans-serif; max-width: 600px; margin: auto; color: #333;">
                                <h1 style="color: #0052CC; border-bottom: 3px solid #0052CC;">🎯 Battle Plan: ${now.toLocaleDateString()}</h1>`;

        for (const meeting of targetMeetings) {
            // Context logic: Get email history for any guest that isn't you
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

            const gmailRes = await gmail.users.messages.list({
                userId: 'me',
                q: searchQuery,
                maxResults: 5 // Increased depth for better context
            });

            let emailSnippets = [];
            if (gmailRes.data.messages) {
                for (const msg of gmailRes.data.messages) {
                    const content = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                    emailSnippets.push(content.data.snippet);
                }
            }

            const dossier = await generateDossier(meeting, emailSnippets);
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #ddd; margin: 30px 0;'>";
        }

        fullReportHtml += "</div>";
        await sendEmail(fullReportHtml);
        console.log(`✅ Success: High-quality report dispatched.`);

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

async function generateDossier(meeting, snippets) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const contextStr = snippets.length > 0 ? snippets.join(' | ') : "NO EMAIL CONTEXT FOUND.";
    
    // High-stakes prompt: Demands objective strategy over AI fluff
    const prompt = `
        ACT AS: A Lead Solution Engineer and Strategic Advisor.
        USER: Jaja (Solutions Engineer, Atlassian, CrossFit athlete, Father, Dutch learner).
        MEETING: ${meeting.summary}
        DESCRIPTION: ${meeting.description || 'N/A'}
        CONTEXT: ${contextStr}

        CRITICAL INSTRUCTIONS:
        - Output HTML (H2, UL, LI).
        - BE BRUTALLY HONEST AND OBJECTIVE. Avoid "typical AI assistant" tone.
        - If the meeting is a "Test meeting" or "Sync" between family/self, identify if it's high-value or just noise.
        - For Dutch lessons (italki): Provide a 30-minute "Immersion Sprint" plan.
        - If context is missing, call out the ambiguity rather than guessing.
        - SECTIONS:
          <h2>The Objective</h2> (What is the real goal here? Cut through the fluff.)
          <h2>Tactical Wedge</h2> (A sharp discovery question or a "Solution Engineer" perspective.)
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * AUTH & EMAIL HELPERS
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
        readline.question('Paste code: ', async (code) => {
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