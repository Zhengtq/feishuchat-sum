/**
 * Feishu Group Chat Summary Bot - Main Entry
 * Node.js + Feishu SDK Long Connection (WebSocket) Mode
 *
 * Connects TO Feishu via WebSocket (outbound), no webhook URL
 * or challenge verification needed.
 */

// ── Load .env file (no external dependency) ─────────────────
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import url from 'url'; // Added missing top-level import for the debug server

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
    const envPath = resolve(__dirname, '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...vals] = trimmed.split('=');
        if (key && vals.length > 0) {
            const value = vals.join('=').trim();
            if (!process.env[key.trim()]) {
                process.env[key.trim()] = value;
            }
        }
    });
    console.log('✅ .env file loaded');
} catch {
    console.log('ℹ️  No .env file found, using environment variables');
}

import * as lark from '@larksuiteoapi/node-sdk';
import cron from 'node-cron';
import http from 'http';
import https from 'https';
import { handleMessageEvent } from './handler/webhook.js';
import { handleCronCleanup } from './handler/cleanup.js';

// ── Environment Variables ───────────────────────────────────
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;

if (!APP_ID || !APP_SECRET) {
    console.error('❌ Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
    process.exit(1);
}

// ── Build env object (compatible with existing modules) ─────
const env = {
    FEISHU_APP_ID: APP_ID,
    FEISHU_APP_SECRET: APP_SECRET,
    FEISHU_BITABLE_APP_TOKEN: process.env.FEISHU_BITABLE_APP_TOKEN,
    FEISHU_BITABLE_TABLE_ID: process.env.FEISHU_BITABLE_TABLE_ID,
    FEISHU_BITABLE_CONFIG_TABLE_ID: process.env.FEISHU_BITABLE_CONFIG_TABLE_ID,
    FEISHU_VERIFICATION_TOKEN: process.env.FEISHU_VERIFICATION_TOKEN,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    _tokenCache: { token: null, expiry: 0 },
};

// ── Event Dispatcher ────────────────────────────────────────
const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
        try {
            console.log('📨 Received message event');
            await handleMessageEvent(env, data);
        } catch (err) {
            console.error('❌ Event handler error:', err);
        }
    },
});

// ── Long Connection (WebSocket) Client ──────────────────────
const wsClient = new lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    loggerLevel: lark.LoggerLevel.INFO,
});

// Start WebSocket connection - pass eventDispatcher to start()
wsClient.start({ eventDispatcher }).then(() => {
    console.log('🚀 Feishu Bot WebSocket connected successfully');
}).catch((err) => {
    console.error('❌ WebSocket connection failed:', err);
});

console.log('🚀 Feishu Bot starting with WebSocket long connection...');

// ── Cron: Daily cleanup at midnight Beijing time ────────────
cron.schedule('0 16 * * *', async () => {
    console.log('🧹 Cron: Running daily cleanup...');
    await handleCronCleanup(env);
});
console.log('⏰ Cron scheduled: daily cleanup at 00:00 Beijing time');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else if (parsedUrl.pathname === '/debug-members') {
        const chatId = parsedUrl.query.chatId;
        if (!chatId) {
            res.writeHead(400);
            return res.end('Missing chatId query param');
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        try {
            const { getChatMembers } = await import('./feishu/message.js');
            const members = await getChatMembers(env, chatId);
            res.end(JSON.stringify({ success: true, count: members.length, members }, null, 2));
        } catch (err) {
            res.end(JSON.stringify({ error: err.message, stack: err.stack }));
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Feishu Chat Summary Bot is running via WebSocket');
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Health check server listening on port ${PORT}`);
});

// ── Self Keep-Alive (prevent Render free-tier spin-down) ────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    const KEEP_ALIVE_INTERVAL = 4 * 60 * 1000; // 4 minutes
    setInterval(() => {
        https.get(`${RENDER_URL}/health`, (res) => {
            console.log(`💓 Keep-alive ping: ${res.statusCode}`);
        }).on('error', (err) => {
            console.warn('💔 Keep-alive ping failed:', err.message);
        });
    }, KEEP_ALIVE_INTERVAL);
    console.log(`💓 Keep-alive self-ping enabled (every 4 min → ${RENDER_URL}/health)`);
} else {
    console.log('ℹ️  Not on Render, skipping keep-alive self-ping');
}

// ── Graceful Shutdown ───────────────────────────────────────
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.close();
    process.exit(0);
});
