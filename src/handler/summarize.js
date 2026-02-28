/**
 * Summarize Command Handler
 * Orchestrates the full summary flow: parse intent → query data → generate summary → send card
 */

import { queryRecords } from '../feishu/bitable.js';
import { sendLoadingCard, sendSummaryCard, sendErrorCard } from '../feishu/message.js';
import { parseTimeIntent, generateSummary } from '../gemini/client.js';

/**
 * Handle @Bot summary command
 * @param {object} env - Worker environment
 * @param {string} chatId - Chat ID to respond to
 * @param {string} userText - User's message text (with @mention removed)
 */
export async function handleSummarizeCommand(env, chatId, userText) {
    try {
        // Step 1: Send loading card
        await sendLoadingCard(env, chatId);

        // Step 2: Parse time intent
        const hours = await parseTimeIntent(env, userText);
        console.log(`Parsed time intent: ${hours} hours`);

        // Step 3: Calculate time range
        const now = Date.now();
        const fromTimestamp = now - hours * 60 * 60 * 1000;

        // Step 4: Query chat history from Bitable
        const records = await queryRecords(env, fromTimestamp, now);

        if (!records || records.length === 0) {
            await sendSummaryCard(
                env,
                chatId,
                `📭 最近 ${hours} 小时内没有找到聊天记录。\n\n可能原因：\n- 该时间段确实没有消息\n- Bot 还未开始记录消息`
            );
            return;
        }

        console.log(`Found ${records.length} records in the last ${hours} hours`);

        // Step 5: Generate AI summary
        const summary = await generateSummary(env, records);

        // Step 6: Send summary card
        await sendSummaryCard(env, chatId, summary);

        console.log('Summary sent successfully');
    } catch (error) {
        console.error('Summarize error:', error);
        await sendErrorCard(env, chatId, error.message || '未知错误');
    }
}
