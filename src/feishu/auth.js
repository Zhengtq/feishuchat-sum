/**
 * Feishu Authentication Module
 * Manages tenant_access_token with in-memory caching
 */

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';

/**
 * Get a valid tenant_access_token, using in-memory cache with fallback to API
 */
export async function getTenantToken(env) {
    // Try in-memory cache first
    const cache = env._tokenCache;
    if (cache.token && Date.now() < cache.expiry) {
        return cache.token;
    }

    // Request new token
    const resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            app_id: env.FEISHU_APP_ID,
            app_secret: env.FEISHU_APP_SECRET,
        }),
    });

    const data = await resp.json();
    if (data.code !== 0) {
        throw new Error(`Failed to get tenant_access_token: ${data.msg}`);
    }

    const token = data.tenant_access_token;

    // Cache with ~1h56min TTL (token valid for 2h)
    cache.token = token;
    cache.expiry = Date.now() + 7000 * 1000;

    return token;
}

/**
 * Build authorization headers for Feishu API calls
 */
export async function getAuthHeaders(env) {
    const token = await getTenantToken(env);
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}
