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
          
          // Step 2: Get avatar using multiple methods with rate limit handling
          let avatarUrl = null;
          
          // Method 1: Try the thumbnails API with delay
          try {
            // Add small delay to avoid rate limiting
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
          
          // Method 2: Fallback avatar URLs with cache busting
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0
