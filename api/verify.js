import crypto from 'crypto';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

// Manual JWT creation without external dependencies
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function createManualJWT(serviceEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  
  const payload = {
    iss: serviceEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, // 1 hour
    iat: now
  };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  // Clean the private key
  let cleanPrivateKey = privateKey;
  if (cleanPrivateKey.includes('\\n')) {
    cleanPrivateKey = cleanPrivateKey.replace(/\\n/g, '\n');
  }
  cleanPrivateKey = cleanPrivateKey.replace(/^["']|["']$/g, '');
  
  // Create signature
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signatureInput), cleanPrivateKey);
  const encodedSignature = signature.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function getGoogleAccessToken(serviceEmail, privateKey) {
  try {
    const jwt = createManualJWT(serviceEmail, privateKey);
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OAuth token error:', response.status, errorText);
      throw new Error(`Failed to get access token: ${response.status}`);
    }
    
    const tokenData = await response.json();
    return tokenData.access_token;
    
  } catch (error) {
    console.error('JWT creation error:', error);
    throw new Error(`Failed to create access token: ${error.message}`);
  }
}

// Google Sheets Integration Functions
async function saveToGoogleSheets(deliveryData) {
  // Check for required environment variables
  if (!process.env.GOOGLE_SHEETS_SPREADSHEET_ID || 
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 
      !process.env.GOOGLE_PRIVATE_KEY) {
    
    console.error('❌ Missing Google Sheets environment variables:', {
      hasSpreadsheetId: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      hasServiceEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY
    });
    
    throw new Error('Google Sheets not configured - missing environment variables');
  }

  try {
    console.log('📊 Saving to Google Sheets...');
    console.log('Delivery data received:', JSON.stringify(deliveryData, null, 2));
    
    // Get access token using manual JWT
    const accessToken = await getGoogleAccessToken(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      process.env.GOOGLE_PRIVATE_KEY
    );
    
    // Prepare the row data
    const registrationId = generateDeliveryId();
    const timestamp = new Date().toISOString();
    
    const rowData = [
      registrationId,                                    // A: Registration ID
      timestamp,                                         // B: Timestamp
      deliveryData.order?.orderNumber || 'N/A',         // C: Order Number
      deliveryData.order?.email || 'N/A',               // D: Customer Email
      deliveryData.roblox?.username || 'N/A',           // E: Roblox Username
      deliveryData.roblox?.userId || 'N/A',             // F: Roblox User ID
      deliveryData.order?.items || 'Digital Items',      // G: Order Items
      deliveryData.order?.total || 'N/A',               // H: Order Total
      'Pending Delivery',                                // I: Status
      '',                                                // J: Delivery Notes (empty for now)
      deliveryData.serverJoinTime || timestamp          // K: Server Join Time
    ];

    console.log('Row data to be inserted:', rowData);

    // Append to Google Sheets
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}/values/Sheet1:append?valueInputOption=RAW`;
    console.log('Making request to:', sheetsUrl);
    
    const response = await fetch(sheetsUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowData]
      })
    });

    const responseText = await response.text();
    console.log('Google Sheets API response status:', response.status);
    console.log('Google Sheets API response:', responseText);

    if (!response.ok) {
      console.error('❌ Google Sheets API Error:', response.status, responseText);
      throw new Error(`Google Sheets API error: ${response.status} - ${responseText}`);
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Google Sheets response:', parseError);
      throw new Error('Invalid response from Google Sheets API');
    }

    console.log('✅ Successfully saved to Google Sheets:', result.updates);
    
    return {
      success: true,
      registrationId,
      rowsAdded: result.updates?.updatedRows || 1,
      range: result.updates?.updatedRange
    };

  } catch (error) {
    console.error('❌ Google Sheets save error:', error);
    throw error;
  }
}

function generateDeliveryId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `DEL_${timestamp}_${random}`;
}

async function handleDeliveryRegistration(req, res, deliveryData) {
  console.log('📦 Processing Delivery Registration...');
  console.log('Received delivery data:', JSON.stringify(deliveryData, null, 2));
  
  try {
    // Validate required data
    if (!deliveryData) {
      console.error('No delivery data provided');
      return res.status(400).json({ 
        error: 'No delivery data provided',
        canContinue: true
      });
    }

    if (!deliveryData.order || !deliveryData.roblox) {
      console.error('Missing required delivery data:', {
        hasOrder: !!deliveryData.order,
        hasRoblox: !!deliveryData.roblox
      });
      
      return res.status(400).json({ 
        error: 'Missing required delivery data',
        required: ['order', 'roblox'],
        received: {
          hasOrder: !!deliveryData.order,
          hasRoblox: !!deliveryData.roblox
        },
        canContinue: true
      });
    }

    // Save to Google Sheets
    console.log('Attempting to save to Google Sheets...');
    const sheetResult = await saveToGoogleSheets(deliveryData);
    console.log('Google Sheets save result:', sheetResult);
    
    // Prepare response
    const registrationRecord = {
      registrationId: sheetResult.registrationId,
      timestamp: deliveryData.timestamp || new Date().toISOString(),
      order: {
        orderNumber: deliveryData.order.orderNumber,
        email: deliveryData.order.email,
        items: deliveryData.order.items,
        total: deliveryData.order.total
      },
      roblox: {
        username: deliveryData.roblox.username,
        userId: deliveryData.roblox.userId
      },
      status: 'pending_delivery',
      savedToSheets: true,
      sheetRange: sheetResult.range
    };
    
    console.log('✅ Delivery registration successful:', registrationRecord.registrationId);
    
    return res.status(200).json({
      success: true,
      message: 'Delivery request registered successfully',
      registrationId: registrationRecord.registrationId,
      data: registrationRecord
    });
    
  } catch (error) {
    console.error('❌ Delivery registration failed:', error);
    
    // Return error but don't completely fail - user can still join server
    return res.status(500).json({ 
      error: 'Failed to save delivery request',
      message: error.message,
      canContinue: true,
      details: DEBUG_MODE ? error.stack : undefined
    });
  }
}

// FIXED ORDER VERIFICATION FUNCTION
async function handleOrderVerification(req, res, orderNumber, email) {
  console.log(`🔍 Shopify Order Verification: ${orderNumber} for ${email}`);
  
  if (!orderNumber || !email) {
    return res.status(400).json({ error: 'Order number and email are required' });
  }

  const cleanOrderNumber = orderNumber.trim();
  const cleanEmail = email.toLowerCase().trim();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
      console.error('Missing Shopify credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    console.log('Searching for order:', cleanOrderNumber, 'with email:', cleanEmail);
    const searchResult = await findShopifyOrder(cleanOrderNumber, cleanEmail);
    
    if (!searchResult) {
      console.log('❌ No matching order found');
      return res.status(404).json({ 
        error: 'Order not found',
        details: 'Please check your order number and try again'
      });
    }

    if (!searchResult.emailMatch) {
      console.log('❌ Order found but email mismatch');
      console.log('Expected email:', cleanEmail);
      console.log('Order email:', searchResult.order.email);
      
      return res.status(400).json({ 
        error: 'Email does not match the order number',
        details: `The order number exists but is associated with a different email address. Please check your email and try again.`,
        debug: DEBUG_MODE ? {
          inputEmail: cleanEmail,
          orderEmail: searchResult.order.email,
          orderNumber: searchResult.order.name
        } : undefined
      });
    }

    const order = searchResult.order;
    const validationResult = validateOrderForDelivery(order);
    if (!validationResult.valid) {
      return res.status(400).json({ 
        error: validationResult.reason,
        details: validationResult.details 
      });
    }

    console.log('✅ Order verification successful:', order.name);

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

// USERNAME VERIFICATION FUNCTION
async function handleUsernameVerification(req, res, username) {
  console.log(`🎮 Roblox Username Verification: ${username}`);
  
  if (!username || typeof username !== 'string' || username.trim() === '') {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanUsername = username.trim();
  
  if (cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3-20 characters' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }

  try {
    const usernameToIdResponse = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usernames: [cleanUsername],
        excludeBannedUsers: true
      })
    });
    
    if (usernameToIdResponse.ok) {
      const usernameData = await usernameToIdResponse.json();
      
      if (usernameData.data && usernameData.data.length > 0) {
        const userData = usernameData.data[0];
        
        if (userData.name && userData.name.toLowerCase() === cleanUsername.toLowerCase()) {
          let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userData.id}&width=150&height=150&format=png&v=${Date.now()}`;
          
          try {
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userData.id}&size=150x150&format=Png&isCircular=false`);
            if (avatarResponse.ok) {
              const avatarData = await avatarResponse.json();
              if (avatarData.data && avatarData.data[0] && avatarData.data[0].imageUrl) {
                avatarUrl = avatarData.data[0].imageUrl;
              }
            }
          } catch (avatarError) {
            console.log('Avatar API failed, using fallback URL');
          }

          return res.status(200).json({
            userId: userData.id.toString(),
            username: userData.name,
            avatarUrl: avatarUrl,
            method: 'username-to-id-api'
          });
        }
      }
    }
  } catch (apiError) {
    console.error('❌ Username-to-ID API error:', apiError.message);
  }

  return res.status(404).json({ 
    error: `User "${cleanUsername}" not found. Please check the spelling and try again.`
  });
}

// MAIN HANDLER
export default async function handler(req, res) {
  console.log('=== API REQUEST START ===');
  console.log('Method:', req.method);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  // Add debug endpoint for testing Shopify connection
  if (req.body?.action === 'debug_shopify') {
    try {
      const testUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/orders.json?limit=1`;
      const testResponse = await fetch(testUrl, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      const testData = await testResponse.json();
      return res.json({
        shopifyConnection: testResponse.ok,
        status: testResponse.status,
        hasOrders: testData.orders?.length > 0,
        sampleOrder: testData.orders?.[0] ? {
          name: testData.orders[0].name,
          email: testData.orders[0].email,
          id: testData.orders[0].id
        } : null,
        envVars: {
          hasShopDomain: !!process.env.SHOPIFY_SHOP_DOMAIN,
          hasAccessToken: !!process.env.SHOPIFY_ACCESS_TOKEN,
          shopDomain: process.env.SHOPIFY_SHOP_DOMAIN
        }
      });
    } catch (error) {
      return res.json({ error: error.message, shopifyConnection: false });
    }
  }
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Ensure req.body exists and handle parsing issues
    if (!req.body) {
      console.error('No request body received');
      return res.status(400).json({ error: 'No request body provided' });
    }

    const { orderNumber, email, username, action, deliveryData } = req.body;
    
    console.log('Raw request body:', req.body);
    console.log('API Request parsed:', { 
      orderNumber: !!orderNumber, 
      email: !!email, 
      username: !!username, 
      action: action || 'none',
      hasDeliveryData: !!deliveryData
    });

    // Handle different actions
    if (action === 'verify_order' && orderNumber && email) {
      console.log('Routing to order verification');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (action === 'verify_username' && username) {
      console.log('Routing to username verification');
      return await handleUsernameVerification(req, res, username);
    }

    // Handle delivery registration
    if (action === 'register_delivery') {
      console.log('Routing to delivery registration');
      return await handleDeliveryRegistration(req, res, deliveryData);
    }

    // Fallback routing based on parameters
    if (orderNumber && email && !username && !deliveryData) {
      console.log('Fallback: Detected order verification request');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (username && !orderNumber && !email && !deliveryData) {
      console.log('Fallback: Detected username verification request');
      return await handleUsernameVerification(req, res, username);
    }

    // If we get here, the request format is wrong
    console.log('Invalid request format - no matching handler');
    return res.status(400).json({ 
      error: 'Invalid request parameters',
      received: { 
        orderNumber: !!orderNumber, 
        email: !!email, 
        username: !!username, 
        action, 
        hasDeliveryData: !!deliveryData 
      },
      expected: 'Either (orderNumber + email) for order verification, (username) for Roblox verification, or (action: "register_delivery" + deliveryData) for delivery registration'
    });

  } catch (error) {
    console.error('Unexpected API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: DEBUG_MODE ? error.stack : undefined
    });
  } finally {
    console.log('=== API REQUEST END ===');
  }
}

// FIXED SHOPIFY ORDER SEARCH FUNCTION
async function findShopifyOrder(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  
  console.log('🏪 Shopify Config:', {
    shopDomain: shopDomain || 'MISSING',
    hasAccessToken: !!accessToken,
    apiVersion
  });
  
  const searchQueries = [
    orderNumber,
    orderNumber.replace(/^#/, ''),
    `#${orderNumber.replace(/^#/, '')}`,
    orderNumber.replace(/^AG-/, ''),
    `AG-${orderNumber.replace(/^(AG-|#)/, '')}`,
    orderNumber.replace(/^AF/, ''),
    `AF${orderNumber.replace(/^(AF|AG-|#)/, '')}`
  ];

  const uniqueSearchQueries = [...new Set(searchQueries)];
  console.log('📝 All search queries:', uniqueSearchQueries);
  
  let foundOrderWithWrongEmail = null;
  let totalOrdersChecked = 0;

  // Clean and normalize the input email for comparison
  const normalizedInputEmail = email.toLowerCase().trim();
  console.log('🔍 Searching for order with email:', normalizedInputEmail);

  for (const query of uniqueSearchQueries) {
    try {
      console.log('🔎 Searching with query:', query);
      const nameSearchUrl = `https://${shopDomain}/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(query)}&limit=1`;
      console.log('🌐 Request URL:', nameSearchUrl);
      
      const response = await fetch(nameSearchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API response not OK:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        continue;
      }

      const data = await response.json();
      console.log('📦 Orders found for query:', data.orders?.length || 0);
      
      if (data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        totalOrdersChecked++;
        
        console.log('🎯 Found order details:', {
          name: order.name,
          id: order.id,
          email: order.email,
          financialStatus: order.financial_status,
          fulfillmentStatus: order.fulfillment_status
        });
        
        // More robust email comparison
        if (order.email) {
          const normalizedOrderEmail = order.email.toLowerCase().trim();
          console.log('📧 Comparing emails:');
          console.log('  Input email (normalized):', normalizedInputEmail);
          console.log('  Order email (normalized):', normalizedOrderEmail);
          console.log('  Match:', normalizedOrderEmail === normalizedInputEmail);
          
          if (normalizedOrderEmail === normalizedInputEmail) {
            console.log('✅ Email match found!');
            return { order, emailMatch: true };
          } else {
            console.log('❌ Email mismatch - storing for potential error message');
            foundOrderWithWrongEmail = order;
          }
        } else {
          console.log('⚠️ Order has no email field');
        }
      } else {
        console.log('🔍 No orders found for query:', query);
      }
    } catch (error) {
      console.error('💥 Error searching with query', query, ':', error.message);
      continue;
    }
  }

  console.log('📊 Search Summary:', {
    totalQueriesTried: uniqueSearchQueries.length,
    totalOrdersFound: totalOrdersChecked,
    foundOrderWithWrongEmail: !!foundOrderWithWrongEmail
  });
  
  if (foundOrderWithWrongEmail) {
    return { order: foundOrderWithWrongEmail, emailMatch: false };
  }

  return null;
}

function validateOrderForDelivery(order) {
  if (order.financial_status !== 'paid' && order.financial_status !== 'partially_paid') {
    return {
      valid: false,
      reason: 'Order payment not confirmed'
    };
  }

  if (order.cancelled_at) {
    return {
      valid: false,
      reason: 'Order has been cancelled'
    };
  }

  if (order.fulfillment_status === 'fulfilled') {
    return {
      valid: false,
      reason: 'Order has already been fulfilled'
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
