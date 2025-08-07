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
    // Call Roblox API server-side
    const userResponse = await fetch(`https://users.roblox.com/v1/users/get-by-username?username=${encodeURIComponent(username)}`);
    const userData = await userResponse.json();

    if (userData.errors) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get avatar headshot url
    const userId = userData.id;
    const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);
    const avatarData = await avatarResponse.json();

    const avatarUrl = avatarData.data[0].imageUrl;

    res.status(200).json({
      username: userData.name,
      avatarUrl,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
