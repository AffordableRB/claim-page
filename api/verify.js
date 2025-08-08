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
    const { orderNumber, email, username, action } = req.body;
    
    console.log('API Request received:', { 
      orderNumber: !!orderNumber, 
      email: !!email, 
      username: !!username, 
      action: action || 'none'
    });

    // Method 1: Check by action parameter
    if (action === 'verify_order' && orderNumber && email) {
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (action === 'verify_username' && username) {
      return await handleUsernameVerification(req, res, username);
    }

    // Method 2: Fallback - determine by parameters present
    if (orderNumber && email && !username) {
      console.log('Detected order verification request');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (username && !orderNumber && !email) {
      console.log('Detected username verification request');
      return await handleUsernameVerification(req, res, username);
    }

    // If we get here, the request format is wrong
    console.log('Invalid request format');
    return res.status(400).json({ 
      error: 'Invalid request parameters',
      received: { orderNumber: !!orderNumber, email: !!email, username: !!username, action },
      expected: 'Either (orderNumber + email) for order verification or (username) for Roblox verification'
    });

  } catch (error) {
    console.error('Unexpected API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}

// MOCK order verification - replace with real Shopify integration later
async function handleOrderVerification(req, res, orderNumber, email) {
  console.log(`🔍 Mock Order Verification: ${orderNumber} for ${email}`);
  
  // Input validation
  if (!orderNumber || !email) {
    return res.status(400).json({ error: 'Order number and email are required' });
  }

  const cleanOrderNumber = orderNumber.trim();
  const cleanEmail = email.toLowerCase().trim();

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Mock test orders - customize these for your testing
  const mockOrders = [
    { 
      orderNumber: '#1222', 
      email: 'test@woo.com', 
      items: 'Roblox Digital Items Pack',
      customerName: 'John Doe',
      total: '29.99',
      currency: 'USD'
    },
    { 
      orderNumber: '1222', 
      email: 'test@woo.com', 
      items: 'Roblox Digital Items Pack',
      customerName: 'John Doe',
      total: '29.99',
      currency: 'USD'
    },
    { 
      orderNumber: '#1001', 
      email: 'customer@example.com', 
      items: 'Virtual Accessories Bundle',
      customerName: 'Jane Smith',
      total: '19.99',
      currency: 'USD'
    },
    { 
      orderNumber: 'AF1234', 
      email: 'user@gmail.com', 
      items: 'Premium Game Items',
      customerName: 'Mike Johnson',
      total: '39.99',
      currency: 'USD'
    }
  ];

  // Normalize order number for comparison (remove # if present)
  const normalizedOrderNumber = cleanOrderNumber.replace(/^#/, '');

  // Find matching order
  const matchingOrder = mockOrders.find(order => {
    const orderNum = order.orderNumber.replace(/^#/, '');
    const emailMatch = order.email.toLowerCase() === cleanEmail;
    const orderMatch = orderNum === normalizedOrderNumber;
    
    console.log(`Checking order ${order.orderNumber}:`, {
      orderMatch,
      emailMatch,
      orderNum,
      normalizedOrderNumber,
      orderEmail: order.email.toLowerCase(),
      cleanEmail
    });
    
    return orderMatch && emailMatch;
  });

  if (!matchingOrder) {
    console.log('❌ No matching order found');
    return res.status(404).json({ 
      error: 'Order not found or email does not match',
      details: 'Please check your order number and email address',
      hint: 'Try: Order #1222 with email test@woo.com'
    });
  }

  console.log('✅ Order verification successful:', matchingOrder.orderNumber);

  // Return successful verification
  return res.status(200).json({
    orderNumber: matchingOrder.orderNumber,
    email: cleanEmail,
    orderId: Math.floor(Math.random() * 100000).toString(),
    customerName: matchingOrder.customerName,
    items: matchingOrder.items,
    total: matchingOrder.total,
    currency: matchingOrder.currency,
    orderDate: new Date().toISOString(),
    fulfilled: true,
    verified: true,
    source: 'mock_system'
  });
}

// Roblox username verification
async function handleUsernameVerification(req, res, username) {
  console.log(`🎮 Roblox Username Verification: ${username}`);
  
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

  console.log(`Searching for Roblox user: ${cleanUsername}`);

  // Try Roblox API
  try {
    const userSearchResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`);
    
    if (userSearchResponse.ok) {
      const userSearchData = await userSearchResponse.json();
      console.log(`Roblox API returned ${userSearchData.data?.length || 0} users`);
      
      if (userSearchData.data && userSearchData.data.length > 0) {
        const exactMatch = userSearchData.data.find(user => 
          user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
        );
        
        if (exactMatch) {
          console.log('✅ Found exact Roblox user match:', exactMatch.name);
          
          // Try to get avatar
          let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${exactMatch.id}&width=150&height=150&format=png&v=${Date.now()}`;
          
          try {
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${exactMatch.id}&size=150x150&format=Png&isCircular=false`);
            if (avatarResponse.ok) {
              const avatarData = await avatarResponse.json();
              if (avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl) {
                avatarUrl = avatarData.data[0].imageUrl;
                console.log('Got avatar from thumbnails API');
              }
            }
          } catch (avatarError) {
            console.log('Avatar API failed, using fallback URL');
          }

          return res.status(200).json({
            userId: exactMatch.id.toString(),
            username: exactMatch.name,
            avatarUrl: avatarUrl,
            method: 'roblox-api'
          });
        } else {
          console.log('❌ No exact username match found in API results');
        }
      } else {
        console.log('❌ Roblox API returned no users');
      }
    } else {
      console.log('❌ Roblox API request failed:', userSearchResponse.status);
    }
  } catch (apiError) {
    console.error('❌ Roblox API error:', apiError.message);
  }

  // If API fails, return error
  console.log('❌ Username verification failed');
  return res.status(404).json({ 
    error: `User "${cleanUsername}" not found. Please check the spelling and try again.`,
    suggestions: [
      'Make sure the username is spelled correctly (case-sensitive)',
      'Check that the account exists on Roblox',
      'Try again in a few minutes'
    ]
  });
}
