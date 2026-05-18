/**
 * BattlePlanAgent - v1.9 (String Sanitization & High-Yield Edition)
 * Author: Jaja (Fallen Crown BV)
 * Fix: Handles '@' in .env and ensures all solo blocks are analyzed.
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
            console.log(`📡 Checking: [${cal.summary}]`);
            const events = await calendar.events.list({
                calendarId: cal.id,
                timeMin: now.toISOString(),
                timeMax: nextWeek.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
            });
            
            if (events.data.items && events.data.items.length > 0) {
                console.log(`   └─ Found ${events.data.items.length} events.`);
                allItems = allItems.concat(events.data.items);
            }
        }

        // v1.9 FIX: Strip the '@' if the user included it in .env
        const myDomain = process.env.MY_DOMAIN.toLowerCase().replace('@', '');
        console.log(`\n--- 🛡️ FILTER DECISIONS (Domain: ${myDomain}) ---`);

        const targetMeetings = allItems.filter(e => {
            const title = e.summary || "Untitled Event";

            // If personal Gmail, we want 100% visibility (Solo blocks, CrossFit, Dutch, etc.)
            if (myDomain === 'gmail.com') {
                console.log(`✅ KEEP: "${title}" (Personal Mode)`);
                return true;
            }

            // Corporate Logic: Ignore solo blocks or internal-only syncs
            if (!e.attendees) {
                console.log(`❌ DROP: "${title}" (Solo block - hidden in Corporate mode)`);
                return false;
            }

            const hasExternal = e.attendees.some(a => !a.email.endsWith(myDomain));
            if (hasExternal) {
                console.log(`✅ KEEP: "${title}" (External Guest)`);
                return true;
            } else {
                console.log(`❌ DROP: "${title}" (Internal Sync)`);
                return false;
            }
        });

        if (targetMeetings.length === 0) {
            console.log("\n⚠️ Outcome: No meetings passed the criteria.");
            return;
        }

        console.log(`\n🚀 Processing ${targetMeetings.length} dossiers...`);

        let fullReportHtml = `<div style="font-family: 'Helvetica', sans-serif; max-width: 600px; margin: auto; color: #333;">
                                <h1 style="color: #0052CC; border-bottom: 2px solid #0052CC;">🎯 Weekly Battle Plan</h1>`;

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
            fullReportHtml += dossier + "<hr style='border: 0; border-top: 1px solid #ddd; margin: 30px 0;'>";
        }

        fullReportHtml += "</div>";
        await sendEmail(fullReportHtml);
        console.log(`\n✅ Mission Accomplished: Battle Plan sent.`);

    } catch (error) {
        console.error("\n❌ Critical Failure:", error);
    }
}

async function generateDossier(meeting, snippets) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const context = snippets.length > 0 ? snippets.join(' | ') : "NO PRIOR EMAIL HISTORY.";
    
    const prompt = `
        ACT AS: A Senior Strategic Advisor for Jaja.
        USER PROFILE: Solutions Engineer, Atlassian, CrossFit Athlete, Father, Dutch Learner.
        EVENT: ${meeting.summary}
        CONTEXT: ${context}

        BRUTAL OBJECTIVITY MODE: ON
        - Output HTML (H2, UL, LI).
        - No AI fluff. No "I hope this helps."
        - If Dutch/italki: Provide 3 advanced vocabulary words (C1 level) related to the topic.
        - If CrossFit: Provide one mental cue for heavy lifting (e.g., "Leg drive" or "Brace core").
        - If Family: Suggest one way to be 100% present.
        - SECTIONS:
          <h2>The Objective</h2>
          <h2>Tactical Wedge</h2>
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/** * AUTH & DISPATCH HELPERS */
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
    console.log('🚀 Auth Required:', authUrl);
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
        readline.question('Paste code here: ', async (code) => {
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