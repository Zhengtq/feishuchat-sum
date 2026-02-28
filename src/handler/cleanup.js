/**
 * Cron Cleanup Handler
 * Deletes old records from Bitable on a scheduled basis
 */

import { deleteOldRecords } from '../feishu/bitable.js';

/**
 * Handle Cron trigger - clean up records older than 7 days
 */
export async function handleCronCleanup(env) {
    try {
        console.log('Cron cleanup started');
        const deletedCount = await deleteOldRecords(env, 7);
        console.log(`Cron cleanup completed: ${deletedCount} records deleted`);
    } catch (error) {
        console.error('Cron cleanup error:', error);
    }
}
