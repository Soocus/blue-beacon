import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Persistent rate limiting with Upstash Redis (survives cold starts)
let ratelimit = null;

function getRatelimiter() {
    if (ratelimit) return ratelimit;
    
    // Only initialize if env vars are present (graceful fallback)
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        
        ratelimit = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 requests per minute
            analytics: true,
            prefix: 'bluebeacon:ratelimit',
        });
    }
    
    return ratelimit;
}

function getClientIP(req) {
    // Prefer x-real-ip (Vercel's trusted header) over x-forwarded-for (can be spoofed)
    return req.headers['x-real-ip'] || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           'unknown';
}

// Helper to add random delay (prevents timing attacks on honeypot)
function randomDelay(minMs = 100, maxMs = 500) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// CSRF token validation using double-submit cookie pattern
function validateCSRF(req) {
    const cookieToken = req.cookies?.csrf_token;
    const headerToken = req.headers['x-csrf-token'];
    
    // Both must be present and match
    if (!cookieToken || !headerToken) return false;
    if (cookieToken !== headerToken) return false;
    if (cookieToken.length < 32) return false; // Minimum token length
    
    return true;
}

// Request body size limit (1KB max for this endpoint)
const MAX_BODY_SIZE = 1024;

function isBodyTooLarge(body) {
    try {
        return JSON.stringify(body).length > MAX_BODY_SIZE;
    } catch {
        return true;
    }
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
    'https://bluebeaconshow.com',
    'https://www.bluebeaconshow.com',
    'https://bluebeaconshow.vercel.app',
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
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // CSRF validation (skip in development for easier testing)
    if (process.env.NODE_ENV === 'production') {
        if (!validateCSRF(req)) {
            return res.status(403).json({ error: 'Invalid request. Please refresh the page and try again.' });
        }
    }

    // Rate limiting with Upstash Redis (persistent across cold starts)
    const clientIP = getClientIP(req);
    const limiter = getRatelimiter();
    
    if (limiter) {
        try {
            const { success, remaining } = await limiter.limit(clientIP);
            res.setHeader('X-RateLimit-Remaining', remaining.toString());
            
            if (!success) {
                return res.status(429).json({ error: 'Too many requests. Please try again later.' });
            }
        } catch (error) {
            // Log but don't block if rate limiter fails
            console.error('Rate limiter error:', error);
        }
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

    // Check body size limit
    if (isBodyTooLarge(body)) {
        return res.status(413).json({ error: 'Request too large' });
    }

    const email = body?.email?.trim()?.toLowerCase();

    // Server-side email validation
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // Honeypot check - reject if the hidden field has a value (bot detected)
    if (body?.website) {
        // Add random delay to prevent timing attacks that could detect honeypot rejection
        await randomDelay(200, 600);
        // Silently reject but return success to not tip off bots
        return res.status(200).json({ 
            success: true, 
            message: 'Subscribed successfully'
        });
    }

    // ConvertKit API settings
    const CONVERTKIT_API_KEY = process.env.CONVERTKIT_API_KEY;
    const CONVERTKIT_FORM_ID = process.env.CONVERTKIT_FORM_ID;

    if (!CONVERTKIT_API_KEY || !CONVERTKIT_FORM_ID) {
        console.error('ConvertKit configuration missing');
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
                error: 'Subscription failed. Please try again.'
            });
        }
    } catch (error) {
        console.error('Subscribe endpoint error:', error);
        return res.status(500).json({ error: 'Service temporarily unavailable' });
    }
}
