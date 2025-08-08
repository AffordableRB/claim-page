import crypto from 'crypto';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

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

async function handleOrderVerification(req, res, orderNumber, email) {
  console.log(`🔍 Shopify Order Verification: ${orderNumber} for ${email}`);
  
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

  try {
    // Check if we have required environment variables
    if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
      console.error('Missing Shopify credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Search for the order in Shopify
    const order = await findShopifyOrder(cleanOrderNumber, cleanEmail);
    
    if (!order) {
      console.log('❌ No matching order found');
      return res.status(404).json({ 
        error: 'Order not found or email does not match',
        details: 'Please check your order number and email address'
      });
    }

    // Verify order is valid for delivery
    const validationResult = validateOrderForDelivery(order);
    if (!validationResult.valid) {
      return res.status(400).json({ 
        error: validationResult.reason,
        details: validationResult.details 
      });
    }

    console.log('✅ Order verification successful:', order.name);

    // Return successful verification
    return res.status(200).json({
      orderNumber: order.name,
      email: cleanEmail,
      orderId: order.id.toString(),
      customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
      items: formatOrderItems(order.line_items),
      total: order.total_price,
      currency: order.currency,
      orderDate: order.created_at,
      fulfilled: order.fulfillment_status === 'fulfilled',
      verified: true,
      source: 'shopify_api'
    });

  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ 
      error: 'Failed to verify order',
      message: 'Please try again in a moment'
    });
  }
}

async function findShopifyOrder(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  
  // Shopify order numbers can have different formats
  // They might be #1001, AF1001, or just 1001
  const searchQueries = [
    orderNumber,
    orderNumber.replace(/^#/, ''), // Remove # if present
    `#${orderNumber.replace(/^#/, '')}` // Add # if not present
  ];

  if (DEBUG_MODE) {
    console.log('🐛 DEBUG: Order search details:', {
      searchQueries,
      shopDomain,
      hasAccessToken: !!accessToken,
      email
    });
  }

  for (const query of searchQueries) {
    try {
      console.log(`Searching Shopify for order: ${query}`);
      
      // Method 1: Search by order name
      const nameSearchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(query)}&limit=1`;
      
      const response = await fetch(nameSearchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Shopify API error: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        
        // Verify email matches
        if (order.email && order.email.toLowerCase() === email) {
          console.log(`✅ Found matching order: ${order.name}`);
          return order;
        } else {
          console.log(`❌ Order found but email doesn't match: ${order.email} vs ${email}`);
        }
      }
      
    } catch (error) {
      console.error(`Error searching for order ${query}:`, error);
      continue;
    }
  }

  // Method 2: If not found by name, search by email and then filter
  try {
    console.log(`Searching orders by email: ${email}`);
    
    const emailSearchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?email=${encodeURIComponent(email)}&limit=50`;
    
    const response = await fetch(emailSearchUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        // Look for matching order number in this customer's orders
        const matchingOrder = data.orders.find(order => {
          return searchQueries.some(query => 
            order.name === query || 
            order.order_number?.toString() === query.replace(/^#/, '')
          );
        });
        
        if (matchingOrder) {
          console.log(`✅ Found matching order via email search: ${matchingOrder.name}`);
          return matchingOrder;
        }
      }
    }
  } catch (error) {
    console.error('Error searching by email:', error);
  }

  return null;
}

function validateOrderForDelivery(order) {
  // Check if order is paid
  if (order.financial_status !== 'paid' && order.financial_status !== 'partially_paid') {
    return {
      valid: false,
      reason: 'Order payment not confirmed',
      details: 'Please ensure your payment has been processed before requesting delivery'
    };
  }

  // Check if order is not cancelled
  if (order.cancelled_at) {
    return {
      valid: false,
      reason: 'Order has been cancelled',
      details: 'Cancelled orders are not eligible for delivery'
    };
  }

  // Check if order contains digital/deliverable items
  // You might want to add specific product tags or types here
  const hasDigitalItems = order.line_items.some(item => {
    return item.title.toLowerCase().includes('roblox') ||
           item.title.toLowerCase().includes('digital') ||
           item.variant_title?.toLowerCase().includes('digital') ||
           (item.properties && item.properties.some(prop => 
             prop.name.toLowerCase().includes('digital') ||
             prop.name.toLowerCase().includes('roblox')
           ));
  });

  if (!hasDigitalItems) {
    return {
      valid: false,
      reason: 'No digital items found in this order',
      details: 'This delivery system is only for digital Roblox items'
    };
  }

  return { valid: true };
}

function formatOrderItems(lineItems) {
  if (!lineItems || lineItems.length === 0) {
    return 'Digital Items';
  }
  
  return lineItems.map(item => {
    let itemName = item.title;
    if (item.variant_title && item.variant_title !== 'Default Title') {
      itemName += ` (${item.variant_title})`;
    }
    if (item.quantity > 1) {
      itemName += ` x${item.quantity}`;
    }
    return itemName;
  }).join(', ');
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
