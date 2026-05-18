/**
 * BattlePlanAgent - v2.1 (Anti-429 Consolidation Edition)
 * Author: Jaja (Fallen Crown BV)
 * Update: Consolidates all meetings into ONE Gemini call to stay under Free Tier limits.
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

        const calendarList = await calendar.calendarList.list();
        const calendars = calendarList.data.items || [];
        
        let allItems = [];
        console.log(`\n--- 🔎 SCANNING ${calendars.length} CALENDARS ---`);

        for (const cal of calendars) {
            const events = await calendar.events.list({
                calendarId: cal.id,
                timeMin: now.toISOString(),
                timeMax: nextWeek.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });
            if (events.data.items) allItems = allItems.concat(events.data.items);
        }

        const myDomain = process.env.MY_DOMAIN.toLowerCase().replace('@', '');
        const targetMeetings = allItems.filter(e => {
            if (myDomain === 'gmail.com') return true;
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) return console.log("⚠️ No meetings passed the filter.");

        console.log(`🚀 Gathering context for ${targetMeetings.length} items...`);

        // Step 1: Collect ALL context locally (No AI calls yet)
        const meetingsWithContext = [];
        for (const meeting of targetMeetings) {
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

            const gmailRes = await gmail.users.messages.list({ userId: 'me', q: searchQuery, maxResults: 2 });
            let snippets = [];
            if (gmailRes.data.messages) {
                for (const msg of gmailRes.data.messages) {
                    const content = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                    snippets.push(content.data.snippet);
                }
            }
            
            meetingsWithContext.push({
                title: meeting.summary,
                description: meeting.description || "N/A",
                emails: snippets.join(" | ")
            });
            console.log(`   📂 Context Ready: ${meeting.summary}`);
        }

        // Step 2: Make ONE single call to Gemini with the full batch
        console.log(`🤖 Synthesizing Full Battle Plan via Gemini 2.5 Flash (1 Request)...`);
        const fullReportHtml = await generateMasterReport(meetingsWithContext);

        // Step 3: Dispatch
        await sendEmail(fullReportHtml);
        console.log(`\n✅ Success: Consolidated Battle Plan sent to ${process.env.MY_EMAIL}.`);
        console.log(`📊 Quota Saved: 1 call used instead of ${targetMeetings.length}.`);

    } catch (error) {
        console.error("❌ Critical Failure:", error);
    }
}

/**
 * Single-Call Synthesis: Processes all meetings in one prompt.
 */
async function generateMasterReport(meetings) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Prepare the payload
    const meetingsList = meetings.map((m, i) => 
        `MEETING ${i+1}: ${m.title}\nCONTEXT: ${m.emails}\nDESC: ${m.description}`
    ).join("\n\n---\n\n");

    const prompt = `
        ACT AS: A Senior Strategic Advisor for Jaja (Solution Engineer, CrossFit Athlete, Father, Dutch Learner).
        TASK: Analyze the following list of ${meetings.length} meetings and generate a high-yield HTML report.

        INSTRUCTIONS:
        - Output ONLY raw HTML. Wrap each meeting analysis in a <section> tag.
        - BE BRUTALLY HONEST. If a meeting looks like waste, say so.
        - Use Metric units where applicable.
        - If Dutch/italki: Provide 3 C1-level vocabulary words for the topic.
        - If CrossFit: Provide a specific mental cue (Brace, Drive, etc.).
        - For each meeting, provide:
          <h2>[Meeting Title]</h2>
          <p><strong>Objective:</strong> [Brutal assessment of the goal]</p>
          <p><strong>Tactical Wedge:</strong> [One sharp question or action item]</p>

        MEETINGS TO ANALYZE:
        ${meetingsList}
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/** AUTH & EMAIL HELPERS (Unstripped) **/
async function authenticate() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const oAuth2Client = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris[0]);
    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (e) { return getNewToken(oAuth2Client); }
}

async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    console.log('🚀 Auth:', authUrl);
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        readline.question('Code: ', async (code) => {
            readline.close();
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
            resolve(oAuth2Client);
        });
    });
}

async function sendEmail(html) {
    const transporter = nodemailer.createTransport({ 
        service: 'gmail', 
        auth: { user: process.env.MY_EMAIL, pass: process.env.GMAIL_APP_PASSWORD } 
    });
    await transporter.sendMail({ 
        from: `BattlePlanAgent <${process.env.MY_EMAIL}>`, 
        to: process.env.MY_EMAIL, 
        subject: `🎯 Master Battle Plan: ${new Date().toLocaleDateString()}`, 
        html: `<html><body style="font-family: sans-serif; max-width: 700px; margin: auto; color: #333;">${html}</body></html>` 
    });
}

runAgent();