/**
 * Feishu Message Module
 * Send text and interactive card messages
 */

import { getAuthHeaders } from './auth.js';

const SEND_MSG_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

/**
 * Send a text reply to a chat
 */
export async function sendTextMessage(env, chatId, text) {
    const headers = await getAuthHeaders(env);
    const url = `${SEND_MSG_URL}?receive_id_type=chat_id`;

    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
        }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
        console.error('Send text error:', data.msg);
    }
    return data;
}

/**
 * Send a "Summarizing..." placeholder card
 */
export async function sendLoadingCard(env, chatId) {
    return sendCard(env, chatId, {
        header: {
            title: { tag: 'plain_text', content: '⏳ 正在为你总结...' },
            template: 'blue',
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: '正在调用 AI 分析聊天记录，请稍候...',
                },
            },
        ],
    });
}

/**
 * Send a summary result card
 */
export async function sendSummaryCard(env, chatId, summary) {
    return sendCard(env, chatId, {
        header: {
            title: { tag: 'plain_text', content: '📋 群聊总结' },
            template: 'green',
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: summary,
                },
            },
            {
                tag: 'hr',
            },
            {
                tag: 'note',
                elements: [
                    {
                        tag: 'plain_text',
                        content: '🤖 Powered by Gemini AI | 数据保留7天',
                    },
                ],
            },
        ],
    });
}

/**
 * Send an error card
 */
export async function sendErrorCard(env, chatId, errorMsg) {
    return sendCard(env, chatId, {
        header: {
            title: { tag: 'plain_text', content: '❌ 总结失败' },
            template: 'red',
        },
        elements: [
            {
                tag: 'div',
                text: {
                    tag: 'lark_md',
                    content: `错误信息：${errorMsg}\n\n请稍后重试，或联系管理员。`,
                },
            },
        ],
    });
}

/**
 * Internal: Send an interactive card message
 */
async function sendCard(env, chatId, card) {
    const headers = await getAuthHeaders(env);
    const url = `${SEND_MSG_URL}?receive_id_type=chat_id`;

    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'interactive',
            content: JSON.stringify(card),
        }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
        console.error('Send card error:', data.msg);
    }
    return data;
}

/**
 * Get sender's name by user_id (open_id)
 */
export async function getUserName(env, userId) {
    const headers = await getAuthHeaders(env);
    const url = `https://open.feishu.cn/open-apis/contact/v3/users/${userId}?user_id_type=open_id`;

    try {
        const resp = await fetch(url, { method: 'GET', headers });
        const data = await resp.json();
        if (data.code === 0 && data.data?.user?.name) {
            return data.data.user.name;
        }
        // Log failure reason to help diagnose permission issues
        console.warn(`getUserName failed for ${userId}: code=${data.code} msg=${data.msg}`);
    } catch (e) {
        console.error('Get user name error:', e);
    }

    return userId; // fallback to user ID if name lookup fails
}

/**
 * Get all members of a chat group (returns list of {open_id, name})
 * Used to resolve a display name (e.g. "黄林") to an open_id for Bitable filtering
 * @param {object} env - Environment
 * @param {string} chatId - Chat group ID
 * @returns {Array} list of {open_id, name}
 */
export async function getChatMembers(env, chatId) {
    const headers = await getAuthHeaders(env);
    const members = [];
    let pageToken = '';
    let hasMore = true;

    try {
        while (hasMore) {
            const params = new URLSearchParams({ member_id_type: 'open_id', page_size: '100' });
            if (pageToken) params.set('page_token', pageToken);

            const url = `https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members?${params}`;
            const resp = await fetch(url, { method: 'GET', headers });
            const data = await resp.json();

            if (data.code !== 0) {
                console.warn(`getChatMembers failed: code=${data.code} msg=${data.msg}`);
                break;
            }

            for (const item of data.data?.items || []) {
                // item has: member_id (open_id), name, member_id_type
                if (item.member_id && item.name) {
                    members.push({ open_id: item.member_id, name: item.name });
                }
            }

            hasMore = data.data?.has_more || false;
            pageToken = data.data?.page_token || '';
        }
    } catch (e) {
        console.error('getChatMembers error:', e);
    }

    console.log(`👥 Chat members loaded: ${members.map(m => m.name).join(', ')}`);
    return members;
}
