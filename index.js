/**
 * BattlePlanAgent - v1.8 (Full Trace Edition)
 * Author: Jaja (Fallen Crown BV)
 * Updates: Comprehensive terminal logging and fixed solo-event visibility.
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

        // Fetch all sub-calendars
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

        const myDomain = process.env.MY_DOMAIN.toLowerCase();
        console.log(`\n--- 🛡️ FILTER DECISIONS (Domain: ${myDomain}) ---`);

        const targetMeetings = allItems.filter(e => {
            const title = e.summary || "Untitled Event";

            // LOGIC 1: Personal Mode (gmail.com)
            if (myDomain === 'gmail.com') {
                console.log(`✅ KEEP: "${title}" (Personal domain - bypass filters)`);
                return true;
            }

            // LOGIC 2: Corporate Mode
            if (!e.attendees) {
                console.log(`❌ DROP: "${title}" (Solo block - hidden in Corporate mode)`);
                return false;
            }

            const hasExternal = e.attendees.some(a => !a.email.endsWith(myDomain));
            if (hasExternal) {
                console.log(`✅ KEEP: "${title}" (External guest found)`);
                return true;
            } else {
                console.log(`❌ DROP: "${title}" (Internal sync only)`);
                return false;
            }
        });

        if (targetMeetings.length === 0) {
            console.log("\n⚠️ Outcome: Zero meetings survived the filter.");
            return;
        }

        console.log(`\n🚀 Processing ${targetMeetings.length} dossiers via Gemini...`);

        let fullReportHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                                <h1 style="color: #0052CC; border-bottom: 3px solid #0052CC; padding-bottom: 10px;">🎯 Weekly Battle Plan</h1>`;

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
        console.log(`\n✅ Mission Accomplished: Battle Plan dispatched to ${process.env.MY_EMAIL}.`);

    } catch (error) {
        console.error("\n❌ Critical Failure:", error);
    }
}

async function generateDossier(meeting, snippets) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const context = snippets.length > 0 ? snippets.join(' | ') : "NO PRIOR EMAIL HISTORY.";
    
    const prompt = `
        ACT AS: A Senior Strategic Advisor for Jaja (Solution Engineer & Athlete).
        MEETING: ${meeting.summary}
        CONTEXT: ${context}

        BRUTAL OBJECTIVITY MODE: ON
        - Output raw HTML only (H2, UL, LI).
        - If the title is "italki" or "Dutch", provide a specific 30-min preparation sprint.
        - If context is missing, don't guess—tell Jaja why this meeting might be a waste of time.
        - SECTIONS:
          <h2>The Objective</h2>
          <h2>Tactical Wedge</h2>
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * AUTHENTICATION & DISPATCH
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