export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body - handle both string and object
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
    }

    const email = body?.email;

    if (!email) {
        return res.status(400).json({ error: 'Email is required', received: body });
    }

    // ConvertKit API settings
    const CONVERTKIT_API_KEY = process.env.CONVERTKIT_API_KEY;
    const CONVERTKIT_FORM_ID = '9005443';

    if (!CONVERTKIT_API_KEY) {
        return res.status(500).json({ error: 'CONVERTKIT_API_KEY not configured in Vercel environment variables' });
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

        if (response.ok) {
            return res.status(200).json({ success: true, message: 'Subscribed successfully' });
        } else {
            return res.status(400).json({ 
                error: data.message || 'Subscription failed',
                details: data 
            });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
