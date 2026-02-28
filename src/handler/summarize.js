/**
 * Summarize Command Handler
 * Orchestrates: read config → parse intent → query data → generate summary → send card
 */

import { queryRecords, readConfig } from '../feishu/bitable.js';
import { sendLoadingCard, sendSummaryCard, sendErrorCard, getChatMembers } from '../feishu/message.js';
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
            // ── Name → open_id resolution ──────────────────────────────
            // Bitable stores open_id (e.g. ou_xxxx) in Sender_Name,
            // so we need to map the display name to open_id first.
            const members = await getChatMembers(env, chatId);
            const keyword = intent.sender_filter.toLowerCase();
            let matched = members.filter(m => m.name.toLowerCase().includes(keyword));

            if (matched.length === 0) {
                // Fallback to fuzzy matching (e.g. typing "王林" instead of "黄林")
                console.log(`👤 Exact match failed for "${intent.sender_filter}", trying fuzzy search...`);
                matched = members.filter(m => {
                    const name = m.name.toLowerCase();
                    const dist = levenshteinDistance(name, keyword);
                    // Match if distance is 1 (typo of 1 char)
                    // Or for longer names, distance 2 might be acceptable
                    return dist <= 1 || (name.length >= 3 && keyword.length >= 3 && dist <= 2);
                });
            }

            if (matched.length > 0) {
                // Matched! Use the open_id(s) for filtering.
                const matchedIds = matched.map(m => m.open_id);
                const matchedNames = matched.map(m => m.name).join('、');
                console.log(`👤 Resolved "${intent.sender_filter}" → ${matchedNames} (${matchedIds.join(', ')})`);
                // Use the first matched open_id (user likely means the most specific match)
                queryOptions.senderFilter = matchedIds[0];
            } else {
                // No match found in group members — try searching by name directly anyway
                console.warn(`👤 Could not resolve "${intent.sender_filter}" to open_id, filtering by name directly`);
                queryOptions.senderFilter = intent.sender_filter;
            }
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

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching sender names (e.g. identifying typos like "王林" instead of "黄林")
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1) // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}
