/**
 * BattlePlanAgent - v2.1 (The "One-Call" Consolidation Edition)
 * Author: Jaja (Fallen Crown BV)
 * Purpose: Aggregates all calendar and email data into a single AI prompt
 * to respect Free Tier quota limits while maintaining brutal objectivity.
 */

require('dotenv').config();
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

// File paths for persistent OAuth tokens
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// Google API Scopes for read-only access and sending reports
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly', 
    'https://www.googleapis.com/auth/gmail.readonly', 
    'https://www.googleapis.com/auth/gmail.send'
];

// Initialize the Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function runAgent() {
    try {
        // Authenticate with Google services
        const auth = await authenticate();
        const calendar = google.calendar({ version: 'v3', auth });
        const gmail = google.gmail({ version: 'v1', auth });

        // Set the scan window: 7 days starting now
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        // Fetch the list of all sub-calendars (Work, italki, Family, etc.)
        const calendarList = await calendar.calendarList.list();
        const calendars = calendarList.data.items || [];
        
        let allItems = [];
        console.log(`\n--- 🔎 SCANNING ${calendars.length} CALENDARS ---`);

        // Loop through all calendars to find events
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

        // Sanitize the domain from .env (strips '@' to prevent logic errors)
        const myDomain = process.env.MY_DOMAIN.toLowerCase().replace('@', '');
        console.log(`\n--- 🛡️ FILTER DECISIONS (Domain: ${myDomain}) ---`);

        // Filter events based on the domain logic
        const targetMeetings = allItems.filter(e => {
            const title = e.summary || "Untitled Event";

            // Personal Mode: If domain is gmail.com, keep everything (CrossFit, Dutch, etc.)
            if (myDomain === 'gmail.com') {
                console.log(`✅ KEEP: "${title}" (Personal Mode)`);
                return true;
            }

            // Corporate Mode: Ignore solo blocks or internal syncs
            if (!e.attendees) {
                console.log(`❌ DROP: "${title}" (Solo block in Corporate mode)`);
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

        console.log(`\n🚀 Gathering context for ${targetMeetings.length} items...`);

        // Step 1: Collect ALL context locally before calling Gemini
        const meetingsWithContext = [];
        for (const meeting of targetMeetings) {
            // Find a lead email that isn't the user
            const leadEmail = meeting.attendees?.find(a => !a.self)?.email;
            const searchQuery = leadEmail ? `from:${leadEmail} OR to:${leadEmail}` : meeting.summary;

            // Fetch last 2 email snippets for context
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
                description: meeting.description || "No description provided.",
                emails: snippets.length > 0 ? snippets.join(" | ") : "NO PRIOR EMAIL HISTORY."
            });
            console.log(`   📂 Context Ready: ${meeting.summary}`);
        }

        // Step 2: Make ONE single call to Gemini with the full batch (Quota-friendly)
        console.log(`🤖 Synthesizing Full Battle Plan via Gemini 2.5 Flash (1 Request)...`);
        const fullReportHtml = await generateMasterReport(meetingsWithContext);

        // Step 3: Dispatch final HTML email
        await sendEmail(fullReportHtml);
        console.log(`\n✅ Mission Accomplished: Battle Plan sent to ${process.env.MY_EMAIL}.`);
        console.log(`📊 Quota Saved: 1 call used instead of ${targetMeetings.length}.`);

    } catch (error) {
        console.error("\n❌ Critical Failure:", error);
    }
}

/**
 * Master Synthesis: Processes the entire week in one prompt.
 */
async function generateMasterReport(meetings) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Package all meeting data into a readable list for the AI
    const meetingsList = meetings.map((m, i) => 
        `MEETING ${i+1}: ${m.title}\nCONTEXT: ${m.emails}\nDESC: ${m.description}`
    ).join("\n\n---\n\n");

    const prompt = `
        ACT AS: A Senior Strategic Advisor for Jaja (Solution Engineer, CrossFit Athlete, Father, Dutch Learner).
        TASK: Analyze ${meetings.length} scheduled items and generate a high-yield HTML report.

        INSTRUCTIONS:
        - Output ONLY raw HTML. Wrap each meeting analysis in a <section style="margin-bottom: 40px; padding: 20px; background: #f9f9f9; border-radius: 8px;"> tag.
        - BE BRUTALLY HONEST. If a meeting looks like a waste of time, explicitly label it "LOW VALUE".
        - Use the Metric system only (kg, meters, etc.).
        - If Dutch/italki: Provide 3 specific C1-level vocabulary words or a grammar rule relevant to the description.
        - If CrossFit: Provide one mental cue for heavy lifting (e.g., bracing, leg drive).
        - For each meeting, provide:
          <h2 style="color: #0052CC;">[Meeting Title]</h2>
          <p><strong>Strategic Objective:</strong> [The real goal, cutting through corporate fluff]</p>
          <p><strong>Tactical Wedge:</strong> [One sharp question or action item for Jaja to take]</p>

        MEETINGS TO ANALYZE:
        ${meetingsList}
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
    console.log('🚀 Auth Required. Open this URL:', authUrl);
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    
    return new Promise((resolve) => {
        readline.question('Paste the code from the browser here: ', async (code) => {
            readline.close();
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
            resolve(oAuth2Client);
        });
    });
}

/**
 * EMAIL DISPATCH MODULE
 */
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

// Start execution
runAgent();