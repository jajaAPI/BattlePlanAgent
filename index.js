/**
 * BattlePlanAgent - v2.2 (Source-of-Truth Edition)
 * Author: Jaja (Fallen Crown BV)
 * Fix: Prevents AI from assuming cancellations based on old email snippets.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

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
                singleEvents: true, // Expands recurring events into individual instances
                orderBy: 'startTime',
            });
            if (events.data.items) allItems = allItems.concat(events.data.items);
        }

        const myDomain = process.env.MY_DOMAIN.toLowerCase().replace('@', '');
        console.log(`\n--- 🛡️ FILTER DECISIONS (Domain: ${myDomain}) ---`);

        const targetMeetings = allItems.filter(e => {
            const title = e.summary || "Untitled Event";
            
            // v2.2 Fix: Ensure we only process events that are actually 'confirmed'
            if (e.status === 'cancelled') {
                console.log(`❌ DROP: "${title}" (Already marked cancelled in API)`);
                return false;
            }

            if (myDomain === 'gmail.com') return true;
            if (!e.attendees) return false;
            return e.attendees.some(a => !a.email.endsWith(myDomain));
        });

        if (targetMeetings.length === 0) return console.log("⚠️ No relevant meetings found.");

        console.log(`🚀 Gathering context for ${targetMeetings.length} items...`);

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
                emails: snippets.length > 0 ? snippets.join(" | ") : "NO PRIOR EMAIL HISTORY."
            });
            console.log(`   📂 Context Ready: ${meeting.summary}`);
        }

        console.log(`🤖 Requesting Strategic Analysis (1 Call)...`);
        const fullReportHtml = await generateMasterReport(meetingsWithContext);

        await sendEmail(fullReportHtml);
        console.log(`\n✅ Success: Battle Plan sent to ${process.env.MY_EMAIL}.`);

    } catch (error) {
        console.error("\n❌ Critical Failure:", error);
    }
}

async function generateMasterReport(meetings) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const meetingsList = meetings.map((m, i) => 
        `MEETING ${i+1}: ${m.title}\nCONTEXT: ${m.emails}\nDESC: ${m.description}`
    ).join("\n\n---\n\n");

    const prompt = `
        ACT AS: A Lead Strategic Advisor for Jaja.
        
        CRITICAL OPERATING RULE:
        Every meeting in the list below is ACTIVE and CONFIRMED on the calendar. 
        If you see "cancelled" or "declined" in the EMAIL CONTEXT, assume those are OLD messages or related to previous weeks. 
        DO NOT assume the current meeting is cancelled unless the DESCRIPTION explicitly says "This event is cancelled."

        TASK: Analyze ${meetings.length} meetings. Output HTML.
        - Tone: Brutally honest Solutions Engineer.
        - Metric system ONLY.
        - For Dutch/italki: 3 C1 vocabulary words.
        - For CrossFit: One heavy-lifting cue.
        - For each: Strategic Objective and Tactical Wedge.
        
        MEETINGS:
        ${meetingsList}
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/** AUTH & EMAIL HELPERS (Verified logic) **/
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
        html: `<html><body style="font-family: sans-serif; padding: 20px;">${html}</body></html>` 
    });
}

runAgent();