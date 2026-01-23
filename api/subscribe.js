export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // ConvertKit API settings
    const CONVERTKIT_API_KEY = process.env.CONVERTKIT_API_KEY;
    const CONVERTKIT_FORM_ID = '9005443';

    if (!CONVERTKIT_API_KEY) {
        console.error('CONVERTKIT_API_KEY environment variable not set');
        return res.status(500).json({ error: 'Server configuration error' });
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
            console.error('ConvertKit API error:', data);
            return res.status(400).json({ error: data.message || 'Subscription failed' });
        }
    } catch (error) {
        console.error('Error subscribing:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
