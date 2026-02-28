/**
 * Summarize Command Handler
 * Orchestrates: read config → parse intent → query data → generate summary → send card
 */

import { queryRecords, readConfig } from '../feishu/bitable.js';
import { sendLoadingCard, sendSummaryCard, sendErrorCard } from '../feishu/message.js';
import { parseIntent, generateSummary } from '../gemini/client.js';

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

        // Step 2: Read hot config from Bot_Config table
        const config = await readConfig(env);
        console.log('📋 Config loaded:', {
            parse_model: config.parse_model,
            summary_model: config.summary_model,
            has_parse_prompt: !!config.parse_prompt,
            has_summary_prompt: !!config.summary_prompt,
        });

        // Step 3: Parse intent (time range, count, sender filter)
        const intent = await parseIntent(env, userText, config);
        console.log('🧠 Intent:', JSON.stringify(intent));

        // Step 4: Build query options from parsed intent
        const now = Date.now();
        const queryOptions = { toTimestamp: now };

        if (intent.from_time) {
            // Absolute time range specified
            queryOptions.fromTimestamp = new Date(intent.from_time).getTime();
            if (intent.to_time && intent.to_time !== 'now') {
                queryOptions.toTimestamp = new Date(intent.to_time).getTime();
            }
        } else if (intent.hours) {
            // Relative hours
            queryOptions.fromTimestamp = now - intent.hours * 60 * 60 * 1000;
        } else if (!intent.count) {
            // No time or count specified, default to 24 hours
            queryOptions.fromTimestamp = now - 24 * 60 * 60 * 1000;
        }

        if (intent.sender_filter) {
            queryOptions.senderFilter = intent.sender_filter;
        }

        if (intent.count) {
            queryOptions.count = intent.count;
        }

        // Step 5: Query chat history from Bitable
        const records = await queryRecords(env, queryOptions);

        if (!records || records.length === 0) {
            // Build a helpful description of what was searched
            const searchDesc = buildSearchDescription(intent);
            await sendSummaryCard(
                env,
                chatId,
                `📭 ${searchDesc}没有找到聊天记录。\n\n可能原因：\n- 该条件下确实没有消息\n- Bot 还未开始记录消息`
            );
            return;
        }

        console.log(`✅ Found ${records.length} records`);

        // Step 6: Generate AI summary with dynamic model and prompt
        const summary = await generateSummary(env, records, config);

        // Step 7: Send summary card
        await sendSummaryCard(env, chatId, summary);

        console.log('🎉 Summary sent successfully');
    } catch (error) {
        console.error('❌ Summarize error:', error);
        await sendErrorCard(env, chatId, error.message || '未知错误');
    }
}

/**
 * Build a human-readable description of the search criteria
 */
function buildSearchDescription(intent) {
    const parts = [];
    if (intent.sender_filter) {
        parts.push(`「${intent.sender_filter}」`);
    }
    if (intent.hours) {
        parts.push(`最近 ${intent.hours} 小时内`);
    } else if (intent.count) {
        parts.push(`最近 ${intent.count} 条消息中`);
    } else if (intent.from_time) {
        parts.push(`指定时间范围内`);
    }
    return parts.length > 0 ? parts.join('') : '最近 24 小时内';
}
