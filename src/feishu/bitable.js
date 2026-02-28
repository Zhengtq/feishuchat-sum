/**
 * Feishu Bitable Read/Write Module
 * Handles CRUD operations on the Chat_History table
 */

import { getAuthHeaders } from './auth.js';

const BASE_URL = 'https://open.feishu.cn/open-apis/bitable/v1/apps';

/**
 * Write a chat message record to Bitable
 */
export async function writeRecord(env, record) {
    const { FEISHU_BITABLE_APP_TOKEN, FEISHU_BITABLE_TABLE_ID } = env;
    const url = `${BASE_URL}/${FEISHU_BITABLE_APP_TOKEN}/tables/${FEISHU_BITABLE_TABLE_ID}/records`;
    const headers = await getAuthHeaders(env);

    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            fields: {
                Message_ID: record.messageId,
                Sender_Name: record.senderName,
                Content: record.content,
                Timestamp: record.timestamp,
            },
        }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
        console.error('Bitable write error:', data.msg);
        throw new Error(`Bitable write failed: ${data.msg}`);
    }

    return data.data.record;
}

/**
 * Query chat history records with flexible filtering
 * @param {object} env - Environment
 * @param {object} options - Query options
 * @param {number} [options.fromTimestamp] - Start timestamp (ms)
 * @param {number} [options.toTimestamp] - End timestamp (ms)
 * @param {string} [options.senderFilter] - Filter by sender name (partial match)
 * @param {number} [options.count] - Limit number of records returned
 * @returns {Array} list of records
 */
export async function queryRecords(env, options = {}) {
    const { FEISHU_BITABLE_APP_TOKEN, FEISHU_BITABLE_TABLE_ID } = env;
    const headers = await getAuthHeaders(env);

    const { fromTimestamp, toTimestamp, senderFilter, count } = options;

    let allRecords = [];
    let pageToken = '';
    let hasMore = true;

    while (hasMore) {
        // Build filter expression dynamically
        const conditions = [];
        if (fromTimestamp) {
            conditions.push(`CurrentValue.[Timestamp]>=${fromTimestamp}`);
        }
        if (toTimestamp) {
            conditions.push(`CurrentValue.[Timestamp]<=${toTimestamp}`);
        }
        if (senderFilter) {
            conditions.push(`CurrentValue.[Sender_Name].contains("${senderFilter}")`);
        }

        let filterExpr = '';
        if (conditions.length === 1) {
            filterExpr = conditions[0];
        } else if (conditions.length > 1) {
            filterExpr = `AND(${conditions.join(', ')})`;
        }

        const params = new URLSearchParams({
            page_size: '500',
            sort: JSON.stringify(['Timestamp ASC']),
        });

        if (filterExpr) {
            params.set('filter', filterExpr);
        }

        if (pageToken) {
            params.set('page_token', pageToken);
        }

        const url = `${BASE_URL}/${FEISHU_BITABLE_APP_TOKEN}/tables/${FEISHU_BITABLE_TABLE_ID}/records?${params}`;
        const resp = await fetch(url, { method: 'GET', headers });
        const data = await resp.json();

        if (data.code !== 0) {
            console.error('Bitable query error:', data.msg);
            throw new Error(`Bitable query failed: ${data.msg}`);
        }

        if (data.data && data.data.items) {
            allRecords = allRecords.concat(data.data.items);
        }

        if (data.data) {
            hasMore = data.data.has_more;
            pageToken = data.data.page_token || '';
        } else {
            hasMore = false;
        }

        // If count is specified and we have enough, stop early
        if (count && allRecords.length >= count) {
            hasMore = false;
        }
    }

    // If count is specified, return only the last N records (most recent)
    if (count && allRecords.length > count) {
        allRecords = allRecords.slice(-count);
    }

    return allRecords;
}

/**
 * Delete records older than the specified number of days
 * @param {number} days - Delete records older than this many days
 * @returns {number} Number of deleted records
 */
export async function deleteOldRecords(env, days = 7) {
    const { FEISHU_BITABLE_APP_TOKEN, FEISHU_BITABLE_TABLE_ID } = env;
    const headers = await getAuthHeaders(env);
    const cutoffTs = Date.now() - days * 24 * 60 * 60 * 1000;

    // First query old records
    const filterExpr = `CurrentValue.[Timestamp]<${cutoffTs}`;
    const params = new URLSearchParams({
        page_size: '500',
        filter: filterExpr,
    });

    const url = `${BASE_URL}/${FEISHU_BITABLE_APP_TOKEN}/tables/${FEISHU_BITABLE_TABLE_ID}/records?${params}`;
    const resp = await fetch(url, { method: 'GET', headers });
    const data = await resp.json();

    if (data.code !== 0 || !data.data.items || data.data.items.length === 0) {
        console.log('No old records to delete');
        return 0;
    }

    const recordIds = data.data.items.map((item) => item.record_id);

    // Batch delete (max 500 per request)
    const deleteUrl = `${BASE_URL}/${FEISHU_BITABLE_APP_TOKEN}/tables/${FEISHU_BITABLE_TABLE_ID}/records/batch_delete`;
    const deleteResp = await fetch(deleteUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: recordIds }),
    });

    const deleteData = await deleteResp.json();
    if (deleteData.code !== 0) {
        console.error('Bitable batch delete error:', deleteData.msg);
        throw new Error(`Bitable delete failed: ${deleteData.msg}`);
    }

    console.log(`Deleted ${recordIds.length} old records`);
    return recordIds.length;
}

/**
 * Read bot configuration from the Bot_Config table (4-column, 1-row layout)
 * Columns: parse_model, parse_prompt, summary_model, summary_prompt
 * @returns {object} Config object with defaults for missing values
 */
export async function readConfig(env) {
    const { FEISHU_BITABLE_APP_TOKEN, FEISHU_BITABLE_CONFIG_TABLE_ID } = env;

    // Default config values (used when table read fails or fields are empty)
    const defaults = {
        parse_model: 'gemini-2.0-flash',
        parse_prompt: '',
        summary_model: 'gemini-2.0-flash',
        summary_prompt: '',
    };

    if (!FEISHU_BITABLE_CONFIG_TABLE_ID) {
        console.warn('⚠️ No config table ID, using defaults');
        return defaults;
    }

    try {
        const headers = await getAuthHeaders(env);
        const params = new URLSearchParams({ page_size: '1' });
        const url = `${BASE_URL}/${FEISHU_BITABLE_APP_TOKEN}/tables/${FEISHU_BITABLE_CONFIG_TABLE_ID}/records?${params}`;
        const resp = await fetch(url, { method: 'GET', headers });
        const data = await resp.json();

        if (data.code !== 0 || !data.data?.items?.length) {
            console.warn('⚠️ Config table read failed or empty, using defaults');
            return defaults;
        }

        const fields = data.data.items[0].fields;
        return {
            parse_model: fields.parse_model?.toString().trim() || defaults.parse_model,
            parse_prompt: fields.parse_prompt?.toString().trim() || defaults.parse_prompt,
            summary_model: fields.summary_model?.toString().trim() || defaults.summary_model,
            summary_prompt: fields.summary_prompt?.toString().trim() || defaults.summary_prompt,
        };
    } catch (err) {
        console.error('❌ readConfig error:', err);
        return defaults;
    }
}

