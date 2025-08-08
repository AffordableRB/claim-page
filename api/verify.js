export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { username, email } = req.body;

    // If email is provided, we're doing email validation
    if (email) {
      return await handleEmailValidation(req, res, username, email);
    }
    
    // Otherwise, we're doing username verification
    return await handleUsernameVerification(req, res, username);

  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}

async function handleEmailValidation(req, res, username, email) {
  if (!username) {
    return res.status(400).json({ error: 'Username is required for email validation' });
  }

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ 
      error: 'Invalid email format',
      emailValid: false,
      reason: 'Email format is invalid'
    });
  }

  console.log(`Validating email: ${cleanEmail} for user: ${username}`);

  try {
    // Method 1: Use a reliable email validation service (Abstract API as example)
    // You'll need to sign up for a free API key at https://www.abstractapi.com/email-verification-validation-api
    
    // For now, we'll do basic validation and some common checks
    const emailValidation = await validateEmailBasic(cleanEmail);
    
    return res.status(200).json({
      emailValid: emailValidation.isValid,
      emailProvider: emailValidation.provider,
      reason: emailValidation.reason,
      username: username
    });

  } catch (error) {
    console.error('Email validation error:', error);
    return res.status(500).json({ 
      error: 'Email validation failed',
      emailValid: false,
      reason: 'Validation service error'
    });
  }
}

async function validateEmailBasic(email) {
  // Extract domain
  const domain = email.split('@')[1];
  
  // Common invalid domains
  const invalidDomains = [
    '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
    'tempmail.org', 'temp-mail.org', 'throwaway.email'
  ];
  
  // Common valid providers
  const commonProviders = {
    'gmail.com': 'Gmail',
    'yahoo.com': 'Yahoo',
    'outlook.com': 'Outlook',
    'hotmail.com': 'Hotmail',
    'icloud.com': 'iCloud',
    'protonmail.com': 'ProtonMail',
    'aol.com': 'AOL'
  };

  // Check for obviously invalid domains
  if (invalidDomains.includes(domain)) {
    return {
      isValid: false,
      reason: 'Temporary email addresses are not allowed',
      provider: domain
    };
  }

  // Check for common typos in popular domains
  const typoChecks = {
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'yahooo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com',
    'outlok.com': 'outlook.com'
  };

  if (typoChecks[domain]) {
    return {
      isValid: false,
      reason: `Did you mean ${typoChecks[domain]}?`,
      provider: domain
    };
  }

  // Try to verify domain has MX record (basic DNS check)
  try {
    const dnsCheck = await checkDomainMX(domain);
    if (!dnsCheck.hasValidMX) {
      return {
        isValid: false,
        reason: 'Domain does not accept email',
        provider: domain
      };
    }
  } catch (dnsError) {
    console.log('DNS check failed, continuing with basic validation:', dnsError.message);
  }

  // If we get here, email looks valid
  return {
    isValid: true,
    reason: 'Email appears to be valid',
    provider: commonProviders[domain] || domain
  };
}

async function checkDomainMX(domain) {
  // Simple DNS MX check - you could use a service like DNS-over-HTTPS
  try {
    const response = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`, {
      headers: {
        'Accept': 'application/dns-json'
      }
    });
    
    if (!response.ok) {
      throw new Error('DNS query failed');
    }
    
    const data = await response.json();
    
    return {
      hasValidMX: data.Answer && data.Answer.length > 0
    };
  } catch (error) {
    console.log('MX check error:', error.message);
    // If we can't check, assume it's valid to avoid false negatives
    return { hasValidMX: true };
  }
}

async function handleUsernameVerification(req, res, username) {
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanUsername = username.trim();
  
  // Validate username format
  if (cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3-20 characters' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }

  console.log(`Searching for username: ${cleanUsername}`);

  // Method 1: Try Roblox API first (most reliable)
  try {
    console.log('Trying Roblox Users API...');
    
    const userSearchResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`);
    
    if (userSearchResponse.ok) {
      const userSearchData = await userSearchResponse.json();
      console.log('User search response:', userSearchData);
      
      if (userSearchData.data && userSearchData.data.length > 0) {
        const exactMatch = userSearchData.data.find(user => 
          user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
        );
        
        if (exactMatch) {
          console.log('Found exact match:', exactMatch);
          
          let avatarUrl = null;
          
          try {
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${exactMatch.id}&size=150x150&format=Png&isCircular=false`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cache-Control': 'no-cache'
              }
            });
            
            if (avatarResponse.ok) {
              const avatarData = await avatarResponse.json();
              console.log('Avatar API response:', avatarData);
              if (avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl) {
                avatarUrl = avatarData.data[0].imageUrl;
              }
            }
          } catch (avatarError) {
            console.log('Avatar API failed:', avatarError.message);
          }
          
          if (!avatarUrl) {
            const timestamp = Date.now();
            avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${exactMatch.id}&width=150&height=150&format=png&v=${timestamp}`;
          }
          
          console.log('Final avatar URL:', avatarUrl);

          return res.status(200).json({
            userId: exactMatch.id.toString(),
            username: exactMatch.name,
            avatarUrl: avatarUrl,
            method: 'roblox-api'
          });
        }
      }
    }
    
    console.log('User search API did not return results, trying alternative methods...');
  } catch (apiError) {
    console.log('Roblox API failed:', apiError.message);
  }

  // Method 2: Try the profile URL method
  try {
    console.log('Trying profile URL method...');
    
    const profileUrl = `https://www.roblox.com/users/profile?username=${encodeURIComponent(cleanUsername)}`;
    const profileResponse = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      redirect: 'manual'
    });

    console.log('Profile response status:', profileResponse.status);
    
    if (profileResponse.status === 302 || profileResponse.status === 301) {
      const location = profileResponse.headers.get('location');
      console.log('Redirect location:', location);
      
      if (location) {
        const userIdMatch = location.match(/\/users\/(\d+)\/profile/);
        if (userIdMatch) {
          const userId = userIdMatch[1];
          console.log('Found user ID from redirect:', userId);
          
          const avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
          
          return res.status(200).json({
            userId: userId,
            username: cleanUsername,
            avatarUrl: avatarUrl,
            method: 'profile-redirect'
          });
        }
      }
    }
  } catch (profileError) {
    console.log('Profile URL method failed:', profileError.message);
  }

  // Method 3: Try legacy search scraping as last resort
  try {
    console.log('Trying legacy search scraping...');
    
    const searchUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(cleanUsername)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (searchResponse.ok) {
      const html = await searchResponse.text();
      console.log('HTML length:', html.length);
      
      if (html.toLowerCase().includes('captcha') || html.length < 1000) {
        console.log('Search page appears to be blocked');
      } else {
        const userIdMatch = html.match(/\/users\/(\d+)\/profile/);
        if (userIdMatch) {
          const userId = userIdMatch[1];
          console.log('Found user ID from search scraping:', userId);
          
          const avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
          
          return res.status(200).json({
            userId: userId,
            username: cleanUsername,
            avatarUrl: avatarUrl,
            method: 'search-scraping'
          });
        }
      }
    }
  } catch (scrapingError) {
    console.log('Search scraping failed:', scrapingError.message);
  }

  // If all methods failed
  console.log('All methods failed to find user');
  return res.status(404).json({ 
    error: `User "${cleanUsername}" not found. Please check the spelling and try again.`,
    suggestions: [
      'Make sure the username is spelled correctly',
      'Check that the account exists on Roblox',
      'Try again in a few minutes'
    ]
  });
}
