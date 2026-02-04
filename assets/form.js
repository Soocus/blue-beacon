// Form handler for newsletter subscription
(function() {
    'use strict';

    const form = document.getElementById('subscribeForm');
    const messageDiv = document.getElementById('formMessage');
    const desktopInput = document.getElementById('email-desktop');
    const mobileInput = document.getElementById('email-mobile');
    const allButtons = form.querySelectorAll('.subscribe-btn');
    
    // CSRF token generation and management (double-submit cookie pattern)
    function generateCSRFToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function getCSRFToken() {
        // Check if token exists in cookie
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        if (match) return match[1];
        
        // Generate new token and set cookie
        const token = generateCSRFToken();
        // Set cookie with SameSite=Strict for additional security
        document.cookie = `csrf_token=${token}; path=/; SameSite=Strict; Secure`;
        return token;
    }

    // Initialize CSRF token on page load
    const csrfToken = getCSRFToken();

    // Sync inputs between mobile and desktop
    mobileInput.addEventListener('input', () => desktopInput.value = mobileInput.value);
    desktopInput.addEventListener('input', () => mobileInput.value = desktopInput.value);

    // Helper to safely display messages (prevents XSS)
    function showMessage(type, text) {
        messageDiv.classList.remove('hidden', 'text-green-400', 'text-red-400');
        messageDiv.classList.add(type === 'success' ? 'text-green-400' : 'text-red-400');
        
        // Clear previous content
        messageDiv.textContent = '';
        
        // Create icon element
        const icon = document.createElement('i');
        icon.className = type === 'success' 
            ? 'fa-solid fa-check mr-2' 
            : 'fa-solid fa-exclamation-circle mr-2';
        
        // Append icon and text safely (textContent prevents XSS)
        messageDiv.appendChild(icon);
        messageDiv.appendChild(document.createTextNode(text));
    }

    function hideMessage() {
        messageDiv.classList.add('hidden');
    }

    function setButtonsLoading(buttons, originalTexts) {
        buttons.forEach((btn, i) => {
            originalTexts[i] = btn.innerText;
            btn.innerText = "PROCESSING...";
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });
    }

    function resetButtons(buttons, originalTexts) {
        buttons.forEach((btn, i) => {
            btn.innerText = originalTexts[i];
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
    }

    function setButtonsSuccess(buttons) {
        buttons.forEach(btn => btn.innerText = "SUBSCRIBED");
    }

    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        
        // Get email from whichever input has a value
        const email = (desktopInput.value || mobileInput.value).trim();
        const honeypot = document.getElementById('website').value;
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            showMessage('error', 'Please enter a valid email address.');
            return;
        }
        
        // Show loading state
        const originalTexts = [];
        setButtonsLoading(allButtons, originalTexts);
        
        try {
            const response = await fetch('/api/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'same-origin', // Include cookies for CSRF
                body: JSON.stringify({ email, website: honeypot }),
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showMessage('success', 'Success! Thank you for subscribing to the Blue Beacon newsletter.');
                
                // Clear inputs
                desktopInput.value = '';
                mobileInput.value = '';
                setButtonsSuccess(allButtons);
                
                // Reset after delay
                setTimeout(() => {
                    resetButtons(allButtons, originalTexts);
                    setTimeout(hideMessage, 5000);
                }, 3000);
            } else {
                // Use a generic message instead of server response to prevent XSS
                const safeMessage = data.error && typeof data.error === 'string' && data.error.length < 200
                    ? data.error.replace(/[<>&"']/g, '') // Strip potential HTML chars
                    : 'Subscription failed. Please try again.';
                throw new Error(safeMessage);
            }
        } catch (error) {
            console.error('Error:', error);
            showMessage('error', error.message || 'Something went wrong. Please try again.');
            resetButtons(allButtons, originalTexts);
        }
    });
})();
