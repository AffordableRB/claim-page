import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { username } = req.body;

  if (!username) {
    res.status(400).json({ error: 'Username required' });
    return;
  }

  try {
    const searchUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(username)}`;
    console.log('Fetching Roblox search page:', searchUrl);

    const response = await fetch(searchUrl, {
      headers: {
        // Mimic a real browser user-agent to reduce blocking
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      },
    });

    const html = await response.text();
    console.log('Roblox search page snippet:', html.slice(0, 500));

    // Check if Roblox returned a captcha or blocking page
    const lowerHtml = html.toLowerCase();
    if (lowerHtml.includes('captcha') || lowerHtml.includes('access denied') || lowerHtml.includes('blocked')) {
      console.warn('Request blocked by Roblox or captcha detected');
      return res.status(403).json({ error: 'Roblox blocked request or captcha required' });
    }

    // Regex extraction for first user
    const userIdMatch = html.match(/\/users\/(\d+)\/profile/);
    const avatarMatch = html.match(/search-user-item-thumb[^>]*>\s*<img src="([^"]+)"/);
    const usernameMatch = html.match(/search-user-item-name[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);

    if (!userIdMatch || !avatarMatch || !usernameMatch) {
      console.error('Failed to parse user info from Roblox search page');
      return res.status(404).json({ error: 'User not found or page structure changed' });
    }

    const userId = userIdMatch[1];
    const avatarUrl = avatarMatch[1];
    const foundUsername = usernameMatch[1];

    return res.status(200).json({ userId, avatarUrl, username: foundUsername });

  } catch (error) {
    console.error('Internal server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
