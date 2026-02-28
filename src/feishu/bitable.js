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
 * Query chat history records within a time range
 * @param {number} fromTimestamp - Start timestamp (ms)
 * @param {number} toTimestamp - End timestamp (ms)
 * @returns {Array} list of records
 */
export async function queryRecords(env, fromTimestamp, toTimestamp) {
    const { FEISHU_BITABLE_APP_TOKEN, FEISHU_BITABLE_TABLE_ID } = env;
    const headers = await getAuthHeaders(env);

    let allRecords = [];
    let pageToken = '';
    let hasMore = true;

    while (hasMore) {
        const filterExpr = `AND(CurrentValue.[Timestamp]>=${fromTimestamp}, CurrentValue.[Timestamp]<=${toTimestamp})`;
        const params = new URLSearchParams({
            page_size: '500',
            filter: filterExpr,
            // Bitable API sort format: ["FieldName DESC", "FieldName ASC"]
            sort: JSON.stringify(['Timestamp ASC']),
        });

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
