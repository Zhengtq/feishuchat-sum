import { readFeedsConfig } from '../feishu/bitable.js';
import { generateNewsReport } from '../gemini/client.js';
import { sendNewsCard } from '../feishu/message.js';

/**
 * Run the news feed cron job
 * Checks all active feeds against the current hour:minute in Beijing Time
 * @param {object} env - Environment
 */
export async function handleCronFeed(env) {
    // 1. Get current hour and minute in Beijing time
    const now = new Date();
    // Convert local/UTC to Beijing time (+8) mathematically
    const beijingTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const currentHour = beijingTime.getHours().toString().padStart(2, '0');
    const currentMinute = beijingTime.getMinutes().toString().padStart(2, '0');
    const currentTimeStr = `${currentHour}:${currentMinute}`;

    // 2. Read feeds from Bitable
    const feeds = await readFeedsConfig(env);
    if (!feeds || feeds.length === 0) return;

    // 3. Filter feeds that match the current time
    const dueFeeds = feeds.filter(f => f.scheduleTime === currentTimeStr);

    if (dueFeeds.length > 0) {
        console.log(`📡 [Feed] Found ${dueFeeds.length} feeds due for ${currentTimeStr}`);
    }

    // 4. Process each due feed
    for (const feed of dueFeeds) {
        try {
            console.log(`📰 Generating report for topic: ${feed.topic}`);
            const report = await generateNewsReport(env, feed.topic);
            console.log(`📤 Sending report to chat: ${feed.targetChatId}`);
            await sendNewsCard(env, feed.targetChatId, feed.topic, report);
            console.log(`✅ Successfully pushed feed: ${feed.topic}`);
        } catch (err) {
            console.error(`❌ Failed to push feed [${feed.topic}]:`, err);
        }
    }
}
