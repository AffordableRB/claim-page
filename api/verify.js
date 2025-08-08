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
    const { username } = req.body;

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
      
      // Step 1: Get user ID from username
      const userSearchResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`);
      
      if (userSearchResponse.ok) {
        const userSearchData = await userSearchResponse.json();
        console.log('User search response:', userSearchData);
        
        if (userSearchData.data && userSearchData.data.length > 0) {
          // Find exact match (case insensitive)
          const exactMatch = userSearchData.data.find(user => 
            user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
          );
          
          if (exactMatch) {
            console.log('Found exact match:', exactMatch);
            
            // Step 2: Get avatar
            let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${exactMatch.id}&width=150&height=150&format=png`;
            
            try {
              const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${exactMatch.id}&size=150x150&format=Png&isCircular=false`);
              if (avatarResponse.ok) {
                const avatarData = await avatarResponse.json();
                if (avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl) {
                  avatarUrl = avatarData.data[0].imageUrl;
                }
              }
            } catch (avatarError) {
              console.log('Avatar API failed, using fallback:', avatarError.message);
            }

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
        redirect: 'manual' // Don't follow redirects automatically
      });

      console.log('Profile response status:', profileResponse.status);
      
      // If it's a redirect, the Location header should contain the user ID
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
              username: cleanUsername, // Use the input username as we found a match
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
        
        // Check for blocking
        if (html.toLowerCase().includes('captcha') || html.length < 1000) {
          console.log('Search page appears to be blocked');
        } else {
          // Try to parse user data from HTML
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

  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}
