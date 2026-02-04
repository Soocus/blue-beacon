// Simple in-memory rate limiting (resets on cold start, but effective for bursts)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // 5 requests per minute per IP

function getRateLimitKey(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           'unknown';
}

function isRateLimited(key) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    
    // Clean up old entries
    const requests = rateLimit.get(key) || [];
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    
    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return true;
    }
    
    recentRequests.push(now);
    rateLimit.set(key, recentRequests);
    return false;
}

// Email validation regex (RFC 5322 simplified)
function isValidEmail(email) {
    if (typeof email !== 'string') return false;
    if (email.length > 254) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
    'https://bluebeacon.show',
    'https://www.bluebeacon.show',
    'https://blue-beacon.vercel.app',
];

// In development, also allow localhost
if (process.env.NODE_ENV !== 'production') {
    ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000');
}

export default async function handler(req, res) {
    // CORS headers - restrict to allowed origins
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Rate limiting
    const clientKey = getRateLimitKey(req);
    if (isRateLimited(clientKey)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Parse body - handle both string and object
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid request format' });
        }
    }

    const email = body?.email?.trim()?.toLowerCase();

    // Server-side email validation
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // ConvertKit API settings
    const CONVERTKIT_API_KEY = process.env.CONVERTKIT_API_KEY;
    const CONVERTKIT_FORM_ID = process.env.CONVERTKIT_FORM_ID || '9005443';

    if (!CONVERTKIT_API_KEY) {
        console.error('CONVERTKIT_API_KEY not configured');
        return res.status(500).json({ error: 'Service temporarily unavailable' });
    }

    try {
        const response = await fetch(
            `https://api.convertkit.com/v3/forms/${CONVERTKIT_FORM_ID}/subscribe`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: CONVERTKIT_API_KEY,
                    email: email,
                }),
            }
        );

        const data = await response.json();

        if (response.ok && data.subscription) {
            return res.status(200).json({ 
                success: true, 
                message: 'Subscribed successfully'
            });
        } else {
            // Log the actual error for debugging, but don't expose it
            console.error('ConvertKit error:', data);
            return res.status(400).json({ 
                error: 'Subscription failed. Please try again or use a different email address.'
            });
        }
    } catch (error) {
        console.error('Subscribe endpoint error:', error);
        return res.status(500).json({ error: 'Service temporarily unavailable' });
    }
}
