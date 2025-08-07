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
    const response = await fetch(searchUrl);

    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch Roblox search page' });
    }

    const html = await response.text();

    // Simple regex to extract first user info (adjust selectors if Roblox changes site)
    const userIdMatch = html.match(/\/users\/(\d+)\/profile/);
    const avatarMatch = html.match(/search-user-item-thumb[^>]*>\s*<img src="([^"]+)"/);
    const usernameMatch = html.match(/search-user-item-name[^>]*>\s*<a[^>]*>([^<]+)<\/a>/);

    if (!userIdMatch || !avatarMatch || !usernameMatch) {
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
