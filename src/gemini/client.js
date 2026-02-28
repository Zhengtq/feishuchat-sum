/**
 * Gemini API Client Module
 * Uses Gemini 2.0 Flash for intent parsing and summary generation
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Parse user's natural language time intent into hours
 * e.g., "总结最近3小时" → 3, "总结今天的" → hours since midnight
 * @returns {number} hours to look back
 */
export async function parseTimeIntent(env, userText) {
    const model = 'gemini-2.0-flash';
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    const prompt = `You are a time parser. Extract the number of hours to look back from the user's Chinese message.
Rules:
- "最近X小时" → return X
- "今天" → return hours since midnight Beijing time (current time: ${new Date().toISOString()})
- "最近半小时" → return 0.5
- "昨天" → return 24 + hours since midnight
- Default (if unclear) → return 24

User message: "${userText}"

Respond with ONLY a single number (integer or decimal). Nothing else.`;

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: 10,
            },
        }),
    });

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const hours = parseFloat(text);

    if (isNaN(hours) || hours <= 0) {
        return 24; // default to 24 hours
    }

    return Math.min(hours, 168); // cap at 7 days
}

/**
 * Generate a structured summary from chat records
 * @param {Array} records - Chat records with fields {Sender_Name, Content, Timestamp}
 * @returns {string} Markdown-formatted summary
 */
export async function generateSummary(env, records) {
    const model = 'gemini-2.0-flash';
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

    const prompt = `你是一个专业的群聊总结助手。请基于以下聊天记录生成一份结构化总结。

要求：
1. 使用飞书 Markdown 格式（支持 **加粗**）
2. 分为以下板块：
   - **📌 核心要点**：3-5 个关键信息点
   - **💬 讨论主题**：按主题分类归纳讨论内容
   - **✅ 待办事项**：如果有提到任何行动项或待办
   - **📊 活跃统计**：消息总数、活跃成员列表
3. 语言简洁有力，不要逐条翻译聊天记录
4. 如果聊天内容较少或无实质内容，简短说明即可

聊天记录（共 ${records.length} 条）：
${chatHistory}

请直接输出总结，不要包含前缀说明。`;

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
