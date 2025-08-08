import fetch from 'node-fetch';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { username } = req.body;
  
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Username required' });
  }

  const cleanUsername = username.trim();
  
  // Validate username format
  if (cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3-20 characters' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }

  try {
    // Method 1: Try the new Roblox API endpoint first
    try {
      const apiResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.roblox.com/',
        },
      });

      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        
        if (apiData.data && apiData.data.length > 0) {
          // Find exact username match (case insensitive)
          const exactMatch = apiData.data.find(user => 
            user.name.toLowerCase() === cleanUsername.toLowerCase()
          );
          
          if (exactMatch) {
            // Get avatar URL
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${exactMatch.id}&size=150x150&format=Png&isCircular=false`);
            let avatarUrl = 'https://www.roblox.com/headshot-thumbnail/image?userId=' + exactMatch.id + '&width=150&height=150&format=png';
            
            if (avatarResponse.ok) {
              const avatarData = await avatarResponse.json();
              if (avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl) {
                avatarUrl = avatarData.data[0].imageUrl;
              }
            }

            return res.status(200).json({
              userId: exactMatch.id.toString(),
              username: exactMatch.name,
              avatarUrl: avatarUrl,
              method: 'api'
            });
          }
        }
      }
    } catch (apiError) {
      console.log('API method failed, trying web scraping...', apiError.message);
    }

    // Method 2: Fallback to web scraping
    const searchUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(cleanUsername)}`;
    console.log('Fetching:', searchUrl);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
    });

    if (!response.ok) {
      console.error(`HTTP Error: ${response.status} ${response.statusText}`);
      return res.status(500).json({ 
        error: `Failed to fetch search page: HTTP ${response.status}`,
        details: response.statusText 
      });
    }

    const html = await response.text();
    console.log('HTML length:', html.length);
    
    // Check for common blocking patterns
    const lowerHtml = html.toLowerCase();
    if (lowerHtml.includes('captcha') || 
        lowerHtml.includes('access denied') || 
        lowerHtml.includes('blocked') ||
        lowerHtml.includes('ray id') ||
        html.length < 1000) {
      console.log('Blocked or captcha detected');
      return res.status(403).json({ error: 'Request blocked by Roblox. Try again later.' });
    }

    // Multiple regex patterns to try (Roblox changes their HTML structure frequently)
    const patterns = [
      // Modern pattern
      {
        userId: /href="\/users\/(\d+)\/profile"/g,
        avatar: /<img[^>]+src="([^"]*headshot[^"]*)"[^>]*>/g,
        username: /class="[^"]*username[^"]*"[^>]*>([^<]+)</g
      },
      // Alternative patterns
      {
        userId: /\/users\/(\d+)\/profile/g,
        avatar: /data-src="([^"]+)"/g,
        username: /"DisplayName":"([^"]+)"/g
      },
      // Fallback patterns
      {
        userId: /users\/(\d+)/g,
        avatar: /<img[^>]+src="([^"]+)"[^>]*class="[^"]*avatar[^"]*"/g,
        username: />([^<]{3,20})</g
      }
    ];

    let userData = null;

    for (const pattern of patterns) {
      const userIdMatches = [...html.matchAll(pattern.userId)];
      const avatarMatches = [...html.matchAll(pattern.avatar)];
      const usernameMatches = [...html.matchAll(pattern.username)];

      console.log(`Pattern attempt - UserIds: ${userIdMatches.length}, Avatars: ${avatarMatches.length}, Usernames: ${usernameMatches.length}`);

      if (userIdMatches.length > 0 && avatarMatches.length > 0 && usernameMatches.length > 0) {
        // Try to find exact username match
        for (let i = 0; i < Math.min(userIdMatches.length, usernameMatches.length, avatarMatches.length); i++) {
          const foundUsername = usernameMatches[i][1].trim();
          
          if (foundUsername.toLowerCase() === cleanUsername.toLowerCase()) {
            userData = {
              userId: userIdMatches[i][1],
              username: foundUsername,
              avatarUrl: avatarMatches[i][1]
            };
            break;
          }
        }

        // If no exact match, take the first result
        if (!userData && userIdMatches.length > 0) {
          userData = {
            userId: userIdMatches[0][1],
            username: usernameMatches[0][1].trim(),
            avatarUrl: avatarMatches[0][1]
          };
        }

        if (userData) break;
      }
    }

    if (!userData) {
      // Log part of HTML for debugging (first 500 chars)
      console.log('HTML sample:', html.substring(0, 500));
      return res.status(404).json({ 
        error: 'User not found or unable to parse page structure',
        debug: 'Check server logs for HTML sample'
      });
    }

    // Clean up avatar URL
    let { avatarUrl } = userData;
    if (avatarUrl && !avatarUrl.startsWith('http')) {
      avatarUrl = 'https://www.roblox.com' + avatarUrl;
    }

    // Fallback avatar if needed
    if (!avatarUrl || avatarUrl.includes('undefined')) {
      avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userData.userId}&width=150&height=150&format=png`;
    }

    return res.status(200).json({
      userId: userData.userId,
      username: userData.username,
      avatarUrl: avatarUrl,
      method: 'scraping'
    });

  } catch (error) {
    console.error('Internal server error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
