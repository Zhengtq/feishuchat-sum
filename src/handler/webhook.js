/**
 * Message Event Handler
 * Processes Feishu SDK im.message.receive_v1 events
 * Adapted for Feishu SDK long connection mode
 */

import { writeRecord } from '../feishu/bitable.js';
import { getUserName } from '../feishu/message.js';
import { handleSummarizeCommand } from './summarize.js';
import { getBotInfo } from '../feishu/auth.js';

// Deduplication: track processed message IDs
const processedMessages = new Set();

/**
 * Handle im.message.receive_v1 event from Feishu SDK
 * @param {object} env - Environment config object
 * @param {object} data - Event data from SDK
 */
export async function handleMessageEvent(env, data) {
    const message = data.message;
    const sender = data.sender;

    if (!message || !sender) {
        console.warn('Missing message or sender in event data');
        return;
    }

    // Deduplicate by message_id
    const messageId = message.message_id;
    if (processedMessages.has(messageId)) {
        return;
    }
    processedMessages.add(messageId);

    // Limit set size to prevent memory leak
    if (processedMessages.size > 2000) {
        const entries = [...processedMessages];
        entries.slice(0, 1000).forEach((id) => processedMessages.delete(id));
    }

    // Skip bot messages to prevent infinite loops
    if (sender.sender_type === 'app') {
        return;
    }

    const chatId = message.chat_id;
    const msgType = message.message_type;

    // Parse message content
    let content = '';
    try {
        const contentObj = JSON.parse(message.content);
        if (msgType === 'text') {
            content = contentObj.text || '';
        } else {
            content = `[${msgType}]`;
        }
    } catch {
        content = message.content || '';
    }

    // Check if this is a @Bot summary command
    const mentions = message.mentions || [];
    let isMentioningBot = false;

    if (mentions.length > 0) {
        const botInfo = await getBotInfo(env);
        if (botInfo && botInfo.open_id) {
            isMentioningBot = mentions.some((m) => m.key && content.includes(m.key) && m.id?.open_id === botInfo.open_id);
        } else {
            console.warn('Could not determine bot open_id for mention check, falling back to permissive check');
            isMentioningBot = mentions.some((m) => m.key && content.includes(m.key));
        }
    }

    if (isMentioningBot && content.includes('总结')) {
        // Remove @mention tags for cleaner parsing
        let cleanContent = content;
        mentions.forEach((m) => {
            cleanContent = cleanContent.replace(m.key, '').trim();
        });

        console.log(`📋 Summary command detected: "${cleanContent}"`);
        // We MUST await here. In Cloudflare Workers/Serverless environments,
        // hanging promises are killed immediately when the main event handler returns 200 via response,
        // which causes API calls like getChatMembers or Gemini fetch to silently abort without logs.
        try {
            await handleSummarizeCommand(env, chatId, cleanContent);
        } catch (err) {
            console.error('Summary error:', err);
        }
        return;
    }

    // Regular message → write to Bitable silently
    const senderName = await getUserName(env, sender.sender_id?.open_id || 'unknown');
    const timestamp = parseInt(message.create_time) || Date.now();

    console.log(`💬 Recording message from ${senderName}`);

    await writeRecord(env, {
        messageId,
        senderName,
        content,
        timestamp,
    });
}
