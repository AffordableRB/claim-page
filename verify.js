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
    console.log('Fetching Roblox user for username:', username);

    // Call Roblox API server-side
    const userResponse = await fetch(`https://users.roblox.com/v1/users/get-by-username?username=${encodeURIComponent(username)}`);

    if (!userResponse.ok) {
      console.error('Failed fetching user:', userResponse.status, userResponse.statusText);
      return res.status(500).json({ error: 'Failed fetching user data from Roblox' });
    }

    const userData = await userResponse.json();

    console.log('Roblox user data:', userData);

    if (userData.errors) {
      console.error('User not found:', userData.errors);
      return res.status(404).json({ error: 'User not found' });
    }

    // Get avatar headshot URL
    const userId = userData.id;
    console.log('Fetching avatar for userId:', userId);

    const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`);

    if (!avatarResponse.ok) {
      console.error('Failed fetching avatar:', avatarResponse.status, avatarResponse.statusText);
      return res.status(500).json({ error: 'Failed fetching avatar data from Roblox' });
    }

    const avatarData = await avatarResponse.json();

    console.log('Roblox avatar data:', avatarData);

    const avatarUrl = avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl;

    if (!avatarUrl) {
      console.error('Avatar URL missing in response');
      return res.status(500).json({ error: 'Avatar not found' });
    }

    // Respond with username and avatar URL
    res.status(200).json({
      username: userData.name,
      avatarUrl,
      userId,
    });

  } catch (error) {
    console.error('Internal Server Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
