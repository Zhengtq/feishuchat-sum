/**
 * Gemini API Client Module
 * Uses configurable models for intent parsing and summary generation
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Default prompts (used when config table fields are empty) ──

const DEFAULT_PARSE_PROMPT = `You are a smart intent parser for a Feishu group chat summary bot.
The user will send a Chinese command asking for a chat summary. Extract structured parameters from their message.

Rules:
- "最近X小时" → hours: X
- "今天" → calculate hours since midnight Beijing time (current time: {{CURRENT_TIME}})
- "最近半小时" → hours: 0.5
- "昨天" → hours: 24 + hours since midnight
- "最近N条" / "最近N条消息" → count: N
- "小明的消息" / "总结小明" → sender_filter: "小明" (extract the person's name)
- "从上午10点到现在" → from_time: ISO timestamp, to_time: null (means now)
- Combinations are possible: "总结小明最近3小时的消息" → hours: 3, sender_filter: "小明"
- Default (if unclear): hours: 24

User message: "{{USER_TEXT}}"

Respond with ONLY valid JSON (no markdown, no code fences):
{"hours": <number|null>, "count": <number|null>, "sender_filter": <string|null>, "from_time": <ISO string|null>, "to_time": <ISO string|null>}`;

const DEFAULT_SUMMARY_PROMPT = `你是一个专业的群聊总结助手。请基于以下聊天记录生成一份结构化总结。

要求：
1. 使用飞书 Markdown 格式（支持 **加粗**）
2. 分为以下板块：
   - **📌 核心要点**：3-5 个关键信息点
   - **💬 讨论主题**：按主题分类归纳讨论内容
   - **✅ 待办事项**：如果有提到任何行动项或待办
   - **📊 活跃统计**：消息总数、活跃成员列表
3. 语言简洁有力，不要逐条翻译聊天记录
4. 如果聊天内容较少或无实质内容，简短说明即可

聊天记录（共 {{RECORD_COUNT}} 条）：
{{CHAT_HISTORY}}

请直接输出总结，不要包含前缀说明。`;

/**
 * Parse user's natural language command into structured intent
 * Supports: time range, count, sender filter, absolute time
 * @param {object} env - Environment
 * @param {string} userText - User's raw command text
 * @param {object} config - Hot config from Bot_Config table
 * @returns {object} Parsed intent { hours, count, sender_filter, from_time, to_time }
 */
export async function parseIntent(env, userText, config = {}) {
    const model = config.parse_model || 'gemini-2.0-flash';
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    // Use custom parse_prompt if provided, otherwise use default
    let promptTemplate = config.parse_prompt || DEFAULT_PARSE_PROMPT;
    const prompt = promptTemplate
        .replace('{{CURRENT_TIME}}', new Date().toISOString())
        .replace('{{USER_TEXT}}', userText);

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0,
                    maxOutputTokens: 200,
                },
            }),
        });

        const data = await resp.json();
        let text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!text) {
            console.warn('⚠️ Parse intent: empty response, using defaults');
            return { hours: 24 };
        }

        // Clean up: remove markdown code fences if present
        text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const intent = JSON.parse(text);
        console.log('🧠 Parsed intent:', JSON.stringify(intent));

        // Validate and sanitize
        return {
            hours: intent.hours ? Math.min(Math.max(intent.hours, 0), 168) : null,
            count: intent.count ? Math.min(Math.max(Math.round(intent.count), 1), 1000) : null,
            sender_filter: intent.sender_filter || null,
            from_time: intent.from_time || null,
            to_time: intent.to_time || null,
        };
    } catch (err) {
        console.error('❌ Parse intent error:', err);
        return { hours: 24 }; // Safe fallback
    }
}

/**
 * Generate a structured summary from chat records
 * Uses dynamic model and prompt from Bot_Config table
 * @param {object} env - Environment
 * @param {Array} records - Chat records with fields {Sender_Name, Content, Timestamp}
 * @param {object} config - Hot config from Bot_Config table
 * @returns {string} Markdown-formatted summary
 */
export async function generateSummary(env, records, config = {}) {
    const model = config.summary_model || 'gemini-2.0-flash';
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    // Format chat history for the prompt
    const chatHistory = records
        .map((r) => {
            const fields = r.fields;
            const time = new Date(fields.Timestamp).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour: '2-digit',
                minute: '2-digit',
            });
            return `[${time}] ${fields.Sender_Name}: ${fields.Content}`;
        })
        .join('\n');

    // Use custom summary_prompt if provided, otherwise use default
    let promptTemplate = config.summary_prompt || DEFAULT_SUMMARY_PROMPT;

    // If user's custom prompt doesn't contain placeholders, append data automatically
    if (!promptTemplate.includes('{{CHAT_HISTORY}}')) {
        promptTemplate += `\n\n聊天记录（共 {{RECORD_COUNT}} 条）：\n{{CHAT_HISTORY}}\n\n请直接输出总结。`;
    }

    const prompt = promptTemplate
        .replace('{{RECORD_COUNT}}', String(records.length))
        .replace('{{CHAT_HISTORY}}', chatHistory);

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
            },
        }),
    });

    const data = await resp.json();

    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.error('Gemini response error:', JSON.stringify(data));
        throw new Error('Gemini API 返回异常，请稍后重试');
    }

    return data.candidates[0].content.parts[0].text.trim();
}
