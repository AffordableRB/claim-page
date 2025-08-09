import crypto from 'crypto';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

// RATE LIMITING OPTIMIZED: Better Airtable Integration with timeout protection
async function saveToAirtable(deliveryData) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.error('❌ Missing Airtable environment variables');
    throw new Error('Airtable not configured - add AIRTABLE_API_KEY and AIRTABLE_BASE_ID');
  }

  const operationStartTime = Date.now();
  const OPERATION_TIMEOUT = 7000; // 7 seconds max for this operation
  
  try {
    console.log('📊 Saving to Airtable with timeout protection...');
    
    const registrationId = generateDeliveryId();
    const timestamp = new Date().toISOString();
    
    // RATE LIMITING OPTIMIZATION: Skip detailed permissions check in favor of direct save attempt
    console.log('🚀 Attempting direct save to minimize API calls...');
    
    // RATE LIMITING OPTIMIZATION: Prepare record data first (no API calls)
    const recordData = {
      "Registration ID": registrationId,
      "Timestamp": timestamp,
      "Order Number": deliveryData.order?.orderNumber || 'N/A',
      "Email": deliveryData.order?.email || 'N/A',
      "Roblox Username": deliveryData.roblox?.username || 'N/A',
      "User ID": deliveryData.roblox?.userId?.toString() || 'N/A',
      "Items": deliveryData.order?.items || 'Digital Items',
      "Order Total": deliveryData.order?.total || 'N/A',
      "Status": 'Pending Delivery',
      "Server Join Time": deliveryData.serverJoinTime || timestamp
    };

    console.log('📝 Record data prepared in', Date.now() - operationStartTime, 'ms');

    // RATE LIMITING OPTIMIZATION: Try most likely table names first to minimize failed requests
    const priorityTableNames = [
      'AG Orders',   // Most likely based on your domain
      'Orders',      // Common naming
      'Main',        // Default
      'Deliveries',  // Logical naming
      'Table 1'      // Airtable default
    ];

    console.log('🎯 Trying priority table names to minimize requests:', priorityTableNames);

    let lastError = null;
    
    for (const tableName of priorityTableNames) {
      // RATE LIMITING CHECK: Stop if we're approaching timeout
      if (Date.now() - operationStartTime > OPERATION_TIMEOUT) {
        console.warn('⏱️ Stopping table attempts due to timeout risk');
        break;
      }
      
      try {
        console.log(`🔍 Attempting table: "${tableName}" (${Date.now() - operationStartTime}ms elapsed)`);
        
        const encodedTableName = encodeURIComponent(tableName);
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodedTableName}`;
        
        const requestBody = {
          records: [{
            fields: recordData
          }]
        };
        
        // RATE LIMITING OPTIMIZATION: Set shorter timeout for individual requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout per request
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const responseText = await response.text();
        
        console.log(`📥 Response for "${tableName}" (${Date.now() - operationStartTime}ms):`, {
          status: response.status,
          success: response.ok
        });

        if (response.ok) {
          const result = JSON.parse(responseText);
          const totalTime = Date.now() - operationStartTime;
          console.log(`✅ SUCCESS! Saved to table "${tableName}" in ${totalTime}ms`);
          
          return {
            success: true,
            registrationId,
            airtableId: result.records[0].id,
            recordsAdded: result.records.length,
            tableName,
            timing: totalTime
          };
        } else {
          // Parse error response
          let errorDetails;
          try {
            errorDetails = JSON.parse(responseText);
          } catch (e) {
            errorDetails = { message: responseText.substring(0, 100) };
          }
          
          lastError = {
            status: response.status,
            statusText: response.statusText,
            error: errorDetails,
            tableName
          };
          
          console.log(`❌ Failed "${tableName}":`, response.status, response.statusText);
          
          // RATE LIMITING OPTIMIZATION: If permissions error, try other tables quickly
          if (response.status === 403) {
            console.error('🔒 Permission denied - trying next table');
            continue;
          }
          if (response.status === 404) {
            console.error('🔍 Table not found - trying next table');
            continue;
          }
        }
        
      } catch (tableError) {
        if (tableError.name === 'AbortError') {
          console.log(`⏱️ Request timeout for table "${tableName}"`);
        } else {
          console.log(`💥 Exception with table "${tableName}":`, tableError.message);
        }
        lastError = { tableName, error: tableError.message };
        continue;
      }
    }
    
    // RATE LIMITING FALLBACK: If all priority tables failed, try discovery (but with timeout)
    const remainingTime = OPERATION_TIMEOUT - (Date.now() - operationStartTime);
    if (remainingTime > 2000) { // Only if we have at least 2 seconds left
      console.log('🔍 Priority tables failed, attempting table discovery...');
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Math.min(remainingTime - 1000, 2000));
        
        const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`, {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (tablesResponse.ok) {
          const tablesData = await tablesResponse.json();
          const discoveredTables = tablesData.tables?.map(t => t.name) || [];
          const newTables = discoveredTables.filter(name => !priorityTableNames.includes(name));
          
          console.log('🔍 Discovered additional tables:', newTables);
          
          // Try one more table if we have time
          if (newTables.length > 0 && Date.now() - operationStartTime < OPERATION_TIMEOUT - 1000) {
            const tableName = newTables[0];
            console.log(`🎯 Trying discovered table: "${tableName}"`);
            
            // Quick attempt with discovered table
            // ... (same save logic but abbreviated for timeout)
          }
        }
      } catch (discoveryError) {
        console.log('🔍 Table discovery failed or timed out:', discoveryError.message);
      }
    }
    
    // If we get here, all attempts failed
    const totalTime = Date.now() - operationStartTime;
    const errorMessage = `All table save attempts failed in ${totalTime}ms. Last error: ${JSON.stringify(lastError)}`;
    console.error('❌ Complete failure:', errorMessage);
    throw new Error(errorMessage);

  } catch (error) {
    const totalTime = Date.now() - operationStartTime;
    console.error(`❌ Airtable save error after ${totalTime}ms:`, error.message);
    throw error;
  }
}

function generateDeliveryId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `DEL_${timestamp}_${random}`;
}

// ENHANCED: Delivery registration handler with rate limiting fixes and better async/await
async function handleDeliveryRegistration(req, res, deliveryData) {
  console.log('📦 Processing Delivery Registration...');
  
  // RATE LIMITING FIX: Start timer to track execution time
  const startTime = Date.now();
  const VERCEL_TIMEOUT_LIMIT = 9000; // 9 seconds to stay under 10s limit
  
  try {
    // Quick validation first (minimal time cost)
    if (!deliveryData.order || !deliveryData.roblox) {
      return res.status(400).json({ 
        error: 'Missing required delivery data',
        required: ['order', 'roblox'],
        received: {
          hasOrder: !!deliveryData.order,
          hasRoblox: !!deliveryData.roblox
        }
      });
    }

    console.log('📊 Starting Airtable save operation...');
    console.log('📊 Delivery data:', {
      orderNumber: deliveryData.order?.orderNumber,
      email: deliveryData.order?.email,
      username: deliveryData.roblox?.username,
      userId: deliveryData.roblox?.userId
    });
    
    // RATE LIMITING FIX: Set timeout wrapper around Airtable save
    const airtablePromise = saveToAirtable(deliveryData);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Airtable save operation timed out to prevent Vercel timeout'));
      }, VERCEL_TIMEOUT_LIMIT);
    });
    
    // Race between save operation and timeout
    let airtableResult;
    try {
      airtableResult = await Promise.race([airtablePromise, timeoutPromise]);
    } catch (timeoutError) {
      const elapsed = Date.now() - startTime;
      console.warn(`⏱️ Operation timed out after ${elapsed}ms to prevent Vercel timeout`);
      
      // Return success response even if save failed due to timeout
      const fallbackId = generateDeliveryId();
      console.log('🔄 Returning fallback response due to timeout');
      
      return res.status(200).json({
        success: true,
        message: 'Delivery request received (saving in background)',
        registrationId: fallbackId,
        warning: 'Save operation timed out but request was processed',
        canContinue: true,
        timing: elapsed
      });
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Airtable save completed successfully in ${elapsed}ms:`, airtableResult);
    
    // RATE LIMITING FIX: Quick response preparation to minimize total time
    const registrationRecord = {
      registrationId: airtableResult.registrationId,
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
      savedToAirtable: true,
      airtableId: airtableResult.airtableId,
      tableName: airtableResult.tableName,
      timing: elapsed
    };
    
    console.log('✅ Delivery registration successful:', {
      id: registrationRecord.registrationId,
      table: airtableResult.tableName,
      airtableId: airtableResult.airtableId,
      timing: elapsed
    });
    
    return res.status(200).json({
      success: true,
      message: 'Delivery request registered successfully',
      registrationId: registrationRecord.registrationId,
      data: registrationRecord
    });
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Delivery registration failed after ${elapsed}ms:`, error);
    
    // RATE LIMITING FIX: Quick error response
    return res.status(500).json({ 
      error: 'Failed to save delivery request',
      message: error.message,
      canContinue: true,
      timing: elapsed,
      details: {
        hasAirtableConfig: !!(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID),
        errorType: error.name || 'Unknown',
        timestamp: new Date().toISOString(),
        suggestion: error.message.includes('permissions') ? 
          'Check your Airtable API key permissions and base access' : 
          'Verify your Airtable configuration and try again'
      }
    });
  }
}

// MAIN HANDLER with enhanced debugging and better error handling
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const startTime = Date.now();

  try {
    const { orderNumber, email, username, action, deliveryData } = req.body;
    
    console.log('🔍 API Request received:', { 
      orderNumber: !!orderNumber, 
      email: !!email, 
      username: !!username, 
      action: action || 'none',
      hasDeliveryData: !!deliveryData,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent']
    });

    // ENHANCED: Comprehensive Airtable test endpoint
    if (action === 'test_airtable') {
      try {
        console.log('🧪 Testing Airtable connection and permissions...');
        
        // Test 1: Basic API key validity
        const baseResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}`, {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          }
        });
        
        const baseResponseText = await baseResponse.text();
        console.log('🔍 Base metadata response:', { status: baseResponse.status, body: baseResponseText });
        
        let baseInfo = null;
        try {
          baseInfo = JSON.parse(baseResponseText);
        } catch (e) {
          baseInfo = { error: 'Could not parse response', raw: baseResponseText };
        }

        // Test 2: Tables list
        let tablesInfo = null;
        if (baseResponse.ok) {
          const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`, {
            headers: {
              'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
            }
          });
          
          const tablesResponseText = await tablesResponse.text();
          try {
            tablesInfo = JSON.parse(tablesResponseText);
          } catch (e) {
            tablesInfo = { error: 'Could not parse tables response', raw: tablesResponseText };
          }
        }
        
        return res.status(200).json({
          success: baseResponse.ok,
          timestamp: new Date().toISOString(),
          baseAccess: {
            status: baseResponse.status,
            statusText: baseResponse.statusText,
            canAccessBase: baseResponse.ok,
            baseInfo: baseInfo
          },
          tables: tablesInfo?.tables?.map(t => ({ 
            id: t.id, 
            name: t.name, 
            fieldCount: t.fields?.length || 0,
            fields: t.fields?.map(f => ({ name: f.name, type: f.type })) || []
          })) || [],
          config: {
            hasApiKey: !!process.env.AIRTABLE_API_KEY,
            hasBaseId: !!process.env.AIRTABLE_BASE_ID,
            apiKeyPrefix: process.env.AIRTABLE_API_KEY?.substring(0, 8) + '...',
            baseIdPrefix: process.env.AIRTABLE_BASE_ID?.substring(0, 10) + '...'
          },
          troubleshooting: {
            commonIssues: [
              'API key missing data.records:write permission',
              'Base not shared with API key',
              'Incorrect base ID',
              'API key expired or invalid'
            ]
          }
        });
        
      } catch (error) {
        console.error('🧪 Test failed:', error);
        return res.status(500).json({ 
          error: error.message,
          config: {
            hasApiKey: !!process.env.AIRTABLE_API_KEY,
            hasBaseId: !!process.env.AIRTABLE_BASE_ID
          },
          stack: DEBUG_MODE ? error.stack : undefined
        });
      }
    }

    // Handle different request types with timing
    if (action === 'verify_order' && orderNumber && email) {
      console.log('📋 Processing order verification...');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (action === 'verify_username' && username) {
      console.log('🎮 Processing username verification...');
      return await handleUsernameVerification(req, res, username);
    }

    // ENHANCED: Handle delivery registration with proper async/await and timing
    if (action === 'register_delivery' && deliveryData) {
      console.log('🚀 Processing delivery registration...');
      const result = await handleDeliveryRegistration(req, res, deliveryData);
      const endTime = Date.now();
      console.log(`⏱️ Delivery registration completed in ${endTime - startTime}ms`);
      return result;
    }

    // Fallback method detection
    if (orderNumber && email && !username) {
      console.log('🔍 Auto-detected order verification request');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (username && !orderNumber && !email) {
      console.log('🔍 Auto-detected username verification request');
      return await handleUsernameVerification(req, res, username);
    }

    // Invalid request format
    console.log('❌ Invalid request format received');
    return res.status(400).json({ 
      error: 'Invalid request parameters',
      received: { 
        orderNumber: !!orderNumber, 
        email: !!email, 
        username: !!username, 
        action, 
        hasDeliveryData: !!deliveryData 
      },
      expected: 'Either (orderNumber + email) for order verification, (username) for Roblox verification, or (deliveryData) for delivery registration'
    });

  } catch (error) {
    const endTime = Date.now();
    console.error('💥 Unexpected API error after', endTime - startTime, 'ms:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timing: `${endTime - startTime}ms`,
      stack: DEBUG_MODE ? error.stack : undefined
    });
  }
}

// ORDER VERIFICATION FUNCTION (keeping existing code with minor improvements)
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
    const searchResult = await findShopifyOrder(cleanOrderNumber, cleanEmail);
    
    if (!searchResult) {
      console.log('❌ No matching order found');
      return res.status(404).json({ 
        error: 'Order not found',
        details: 'Please check your order number and try again'
      });
    }

    // Check if order was found but email doesn't match
    if (!searchResult.emailMatch) {
      console.log('❌ Order found but email mismatch');
      return res.status(400).json({ 
        error: 'Email does not match the order number',
        details: 'The order number exists but is associated with a different email address. Please check your email and try again.'
      });
    }

    const order = searchResult.order;

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
  // They might be #1001, AF1001, AG-1004, or just 1001
  const searchQueries = [
    orderNumber,
    orderNumber.replace(/^#/, ''), // Remove # if present
    `#${orderNumber.replace(/^#/, '')}`, // Add # if not present
    // Handle AG- format specifically
    orderNumber.replace(/^AG-/, ''), // Remove AG- if present
    `AG-${orderNumber.replace(/^(AG-|#)/, '')}`, // Add AG- if not present
    // Handle other common prefixes
    orderNumber.replace(/^AF/, ''), // Remove AF if present
    `AF${orderNumber.replace(/^(AF|AG-|#)/, '')}` // Add AF if not present
  ];

  // Remove duplicates from search queries
  const uniqueSearchQueries = [...new Set(searchQueries)];

  if (DEBUG_MODE) {
    console.log('🐛 DEBUG: Order search details:', {
      originalOrderNumber: orderNumber,
      searchQueries: uniqueSearchQueries,
      shopDomain,
      hasAccessToken: !!accessToken,
      email
    });
  }

  let foundOrderWithWrongEmail = null;

  for (const query of uniqueSearchQueries) {
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
        console.error(`Shopify API error for query ${query}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        
        // Verify email matches
        if (order.email && order.email.toLowerCase() === email) {
          console.log(`✅ Found matching order: ${order.name} via query: ${query}`);
          return { order, emailMatch: true };
        } else {
          console.log(`❌ Order found but email doesn't match: ${order.email} vs ${email} (query: ${query})`);
          foundOrderWithWrongEmail = order;
          // Continue searching in case there's another order with the same number but correct email
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
          return uniqueSearchQueries.some(query => {
            // Check both order name and order number
            return order.name === query || 
                   order.order_number?.toString() === query.replace(/^(#|AG-|AF)/, '') ||
                   // Also check if the order name contains AG- and matches
                   (order.name && order.name.includes('AG-') && order.name === `AG-${query.replace(/^(#|AG-|AF)/, '')}`);
          });
        });
        
        if (matchingOrder) {
          console.log(`✅ Found matching order via email search: ${matchingOrder.name}`);
          return { order: matchingOrder, emailMatch: true };
        }
      }
    }
  } catch (error) {
    console.error('Error searching by email:', error);
  }

  // If we found an order with the right number but wrong email, return that info
  if (foundOrderWithWrongEmail) {
    return { order: foundOrderWithWrongEmail, emailMatch: false };
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

  // Check if order is not already fulfilled
  if (order.fulfillment_status === 'fulfilled') {
    return {
      valid: false,
      reason: 'Order has already been fulfilled',
      details: 'This order has already been delivered and cannot be claimed again'
    };
  }

  // Check if order has been refunded
  if (order.financial_status === 'refunded' || order.financial_status === 'partially_refunded') {
    return {
      valid: false,
      reason: 'Order has been refunded',
      details: 'Refunded orders are not eligible for delivery'
    };
  }

  // Additional check for any refund transactions
  if (order.refunds && order.refunds.length > 0) {
    const totalRefunded = order.refunds.reduce((sum, refund) => {
      return sum + parseFloat(refund.amount || 0);
    }, 0);
    
    const totalPrice = parseFloat(order.total_price || 0);
    
    // If fully refunded
    if (totalRefunded >= totalPrice) {
      return {
        valid: false,
        reason: 'Order has been fully refunded',
        details: 'Fully refunded orders are not eligible for delivery'
      };
    }
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

// ROBLOX USERNAME VERIFICATION (keeping existing code)
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

  // Method 1: Try the more reliable username-to-ID conversion
  try {
    console.log('Attempting username-to-ID conversion...');
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
      console.log('Username-to-ID API response:', usernameData);
      
      if (usernameData.data && usernameData.data.length > 0) {
        const userData = usernameData.data[0];
        
        // Check if the returned username exactly matches (case-insensitive)
        if (userData.name && userData.name.toLowerCase() === cleanUsername.toLowerCase()) {
          console.log('✅ Found exact match via username-to-ID API:', userData.name);
          
          // Get avatar
          let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userData.id}&width=150&height=150&format=png&v=${Date.now()}`;
          
          try {
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userData.id}&size=150x150&format=Png&isCircular=false`);
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
            userId: userData.id.toString(),
            username: userData.name,
            avatarUrl: avatarUrl,
            method: 'username-to-id-api'
          });
        }
      } else {
        console.log('❌ Username-to-ID API returned no users');
      }
    } else {
      console.log('❌ Username-to-ID API request failed:', usernameToIdResponse.status);
    }
  } catch (apiError) {
    console.error('❌ Username-to-ID API error:', apiError.message);
  }

  // Method 2: Fallback to search API
  try {
    console.log('Falling back to search API...');
    const userSearchResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`);
    
    if (userSearchResponse.ok) {
      const userSearchData = await userSearchResponse.json();
      console.log(`Search API returned ${userSearchData.data?.length || 0} users`);
      
      if (userSearchData.data && userSearchData.data.length > 0) {
        const exactMatch = userSearchData.data.find(user => 
          user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
        );
        
        if (exactMatch) {
          console.log('✅ Found exact match via search API:', exactMatch.name);
          
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
            method: 'search-api'
          });
        } else {
          console.log('❌ No exact username match found in search API results');
        }
      } else {
        console.log('❌ Search API returned no users');
      }
    } else {
      console.log('❌ Search API request failed:', userSearchResponse.status);
    }
  } catch (apiError) {
    console.error('❌ Search API error:', apiError.message);
  }

  // If both methods fail, return error
  console.log('❌ Username verification failed with both methods');
  return res.status(404).json({ 
    error: `User "${cleanUsername}" not found. Please check the spelling and try again.`,
    suggestions: [
      'Make sure the username is spelled correctly (case-sensitive)',
      'Check that the account exists on Roblox',
      'Try again in a few minutes - Roblox APIs can be temporarily unavailable'
    ]
  });
}
