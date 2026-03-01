import { readFeedsConfig } from '../feishu/bitable.js';
import { generateNewsReport } from '../gemini/client.js';
import { sendNewsCard } from '../feishu/message.js';

/**
 * Run the news feed cron job
 * Checks all active feeds against the current hour:minute in Beijing Time
 * @param {object} env - Environment
 */
export async function handleCronFeed(env) {
    // Convert local/UTC to Beijing timezone robustly and extract 24-hr parts
    const cNow = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    // Format is "HH:mm" directly when hour12 is false
    const beijingTimeString = formatter.format(cNow);

    // We expect "HH:mm" from format, but to be sure, let's process it carefully
    let currentHour, currentMinute;
    if (beijingTimeString.includes(':')) {
        [currentHour, currentMinute] = beijingTimeString.split(':');
    } else {
        // Fallback or handle odd formatting
        currentHour = cNow.getHours().toString().padStart(2, '0');
        currentMinute = cNow.getMinutes().toString().padStart(2, '0');
    }
    const currentTimeStr = `${currentHour.padStart(2, '0')}:${currentMinute.padStart(2, '0')}`;
    console.log(`⏰ Checking Bitable Feeds... Current Beijing Time: ${currentTimeStr}`);

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
