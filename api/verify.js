// api/verify.js - Fixed REST API + Firebase Integration
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, connectFirestoreEmulator } from 'firebase/firestore';
import crypto from 'crypto';

const DEBUG_MODE = process.env.NODE_ENV === 'development';

// Initialize Firebase (only once per cold start)
let app;
let db;
let isInitialized = false;

function initFirebase() {
  if (!isInitialized) {
    console.log('🔥 Initializing Firebase...');
    
    const requiredEnvVars = [
      'FIREBASE_API_KEY',
      'FIREBASE_AUTH_DOMAIN', 
      'FIREBASE_PROJECT_ID',
      'FIREBASE_STORAGE_BUCKET',
      'FIREBASE_MESSAGING_SENDER_ID',
      'FIREBASE_APP_ID'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing Firebase environment variables: ${missingVars.join(', ')}`);
    }

    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };
    
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    
    db = getFirestore(app);
    
    if (DEBUG_MODE && process.env.FIRESTORE_EMULATOR_HOST) {
      connectFirestoreEmulator(db, 'localhost', 8080);
    }
    
    isInitialized = true;
    console.log('✅ Firebase initialized successfully');
  }
  
  return db;
}

// FIRESTORE SAVE FUNCTION
async function saveToFirestore(deliveryData) {
  const startTime = Date.now();
  
  try {
    console.log('🔥 Saving delivery data to Firestore...');
    
    const db = initFirebase();
    const registrationId = generateDeliveryId();
    
    const docData = {
      registrationId,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
      orderNumber: deliveryData.order?.orderNumber || 'N/A',
      email: deliveryData.order?.email || 'N/A',
      orderItems: deliveryData.order?.items || 'Digital Items',
      orderTotal: deliveryData.order?.total || 'N/A',
      orderCurrency: deliveryData.order?.currency || 'USD',
      orderId: deliveryData.order?.orderId || null,
      customerName: deliveryData.order?.customerName || null,
      robloxUsername: deliveryData.roblox?.username || 'N/A',
      robloxUserId: deliveryData.roblox?.userId?.toString() || 'N/A',
      robloxAvatarUrl: deliveryData.roblox?.avatar || null,
      status: 'pending_delivery',
      deliveryStaffAssigned: null,
      serverJoinTime: deliveryData.serverJoinTime || new Date().toISOString(),
      completedAt: null,
      processedBy: 'delivery_system_v2',
      source: 'affordable_garden_delivery',
      apiVersion: '2.1',
      userAgent: deliveryData.userAgent || null,
      stepCompletionTimes: deliveryData.stepCompletionTimes || null,
      totalProcessingTime: Date.now() - startTime
    };

    const docRef = await addDoc(collection(db, 'delivery_requests'), docData);
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ Successfully saved to Firestore in ${elapsed}ms:`, {
      registrationId: registrationId,
      firestoreId: docRef.id,
      collection: 'delivery_requests'
    });
    
    return {
      success: true,
      registrationId,
      firestoreId: docRef.id,
      collection: 'delivery_requests',
      timing: elapsed,
      docPath: `delivery_requests/${docRef.id}`
    };

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Firestore save failed after ${elapsed}ms:`, error);
    throw error;
  }
}

async function handleDeliveryRegistration(req, res, deliveryData) {
  console.log('📦 Processing Delivery Registration with Firestore...');
  
  const startTime = Date.now();
  const REQUEST_TIMEOUT = 8000;
  
  try {
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

    if (!deliveryData.order.orderNumber || !deliveryData.order.email) {
      return res.status(400).json({
        error: 'Invalid order data - missing orderNumber or email'
      });
    }

    if (!deliveryData.roblox.username || !deliveryData.roblox.userId) {
      return res.status(400).json({
        error: 'Invalid Roblox data - missing username or userId'
      });
    }

    deliveryData.userAgent = req.headers['user-agent'];
    
    const firestorePromise = saveToFirestore(deliveryData);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Firestore operation timed out'));
      }, REQUEST_TIMEOUT);
    });
    
    let firestoreResult;
    try {
      firestoreResult = await Promise.race([firestorePromise, timeoutPromise]);
    } catch (timeoutError) {
      const elapsed = Date.now() - startTime;
      const fallbackId = generateDeliveryId();
      
      return res.status(202).json({
        success: false,
        message: 'Delivery request received (saving in background)',
        registrationId: fallbackId,
        warning: 'Save operation timed out but request was processed',
        canContinue: true,
        timing: elapsed,
        status: 'timeout'
      });
    }
    
    const elapsed = Date.now() - startTime;
    
    const registrationRecord = {
      registrationId: firestoreResult.registrationId,
      timestamp: new Date().toISOString(),
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
      savedToFirestore: true,
      firestoreId: firestoreResult.firestoreId,
      docPath: firestoreResult.docPath,
      timing: elapsed
    };
    
    return res.status(200).json({
      success: true,
      message: 'Delivery request registered successfully in Firestore',
      registrationId: registrationRecord.registrationId,
      data: registrationRecord
    });
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('❌ Delivery registration failed:', error);
    
    return res.status(500).json({ 
      error: 'Failed to save delivery request to Firestore',
      message: error.message,
      timing: elapsed,
      canContinue: true // Let user continue to server anyway
    });
  }
}

// FIXED SHOPIFY ORDER VERIFICATION - Added .myshopify.com
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

    // Search for the order in Shopify using the FIXED method
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
      source: 'shopify_rest_api'
    });

  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ 
      error: 'Failed to verify order',
      message: 'Please try again in a moment',
      details: DEBUG_MODE ? error.message : undefined
    });
  }
}

// FIXED SHOPIFY SEARCH FUNCTION - Added .myshopify.com
async function findShopifyOrder(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  
  // Shopify order numbers can have different formats
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

  if (DEBUG_MODE) {
    console.log('🐛 DEBUG: Order search details:', {
      originalOrderNumber: orderNumber,
      searchQueries: uniqueSearchQueries,
      shopDomain,
      hasAccessToken: !!accessToken,
      email,
      fullShopUrl: `${shopDomain}.myshopify.com` // Added for debugging
    });
  }

  let foundOrderWithWrongEmail = null;

  for (const query of uniqueSearchQueries) {
    try {
      console.log(`Searching Shopify for order: ${query}`);
      
      // FIXED: Added .myshopify.com to the URL
      const nameSearchUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(query)}&limit=1`;
      
      console.log(`🔗 Making request to: ${nameSearchUrl}`); // Debug log
      
      const response = await fetch(nameSearchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`Shopify API error for query ${query}: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`Error response: ${errorText}`);
        continue;
      }

      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        
        if (order.email && order.email.toLowerCase() === email) {
          console.log(`✅ Found matching order: ${order.name} via query: ${query}`);
          return { order, emailMatch: true };
        } else {
          console.log(`❌ Order found but email doesn't match: ${order.email} vs ${email} (query: ${query})`);
          foundOrderWithWrongEmail = order;
        }
      }
      
    } catch (error) {
      console.error(`Error searching for order ${query}:`, error);
      continue;
    }
  }

  // Method 2: Search by email and filter
  try {
    console.log(`Searching orders by email: ${email}`);
    
    // FIXED: Added .myshopify.com to the URL
    const emailSearchUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/orders.json?email=${encodeURIComponent(email)}&limit=50`;
    
    console.log(`🔗 Making email search request to: ${emailSearchUrl}`); // Debug log
    
    const response = await fetch(emailSearchUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        const matchingOrder = data.orders.find(order => {
          return uniqueSearchQueries.some(query => {
            return order.name === query || 
                   order.order_number?.toString() === query.replace(/^(#|AG-|AF)/, '') ||
                   (order.name && order.name.includes('AG-') && order.name === `AG-${query.replace(/^(#|AG-|AF)/, '')}`);
          });
        });
        
        if (matchingOrder) {
          console.log(`✅ Found matching order via email search: ${matchingOrder.name}`);
          return { order: matchingOrder, emailMatch: true };
        }
      }
    } else {
      const errorText = await response.text();
      console.error(`Email search failed: ${response.status} ${response.statusText}`, errorText);
    }
  } catch (error) {
    console.error('Error searching by email:', error);
  }

  if (foundOrderWithWrongEmail) {
    return { order: foundOrderWithWrongEmail, emailMatch: false };
  }

  return null;
}

// YOUR WORKING VALIDATION FUNCTION (unchanged)
function validateOrderForDelivery(order) {
  if (order.financial_status !== 'paid' && order.financial_status !== 'partially_paid') {
    return {
      valid: false,
      reason: 'Order payment not confirmed',
      details: 'Please ensure your payment has been processed before requesting delivery'
    };
  }

  if (order.cancelled_at) {
    return {
      valid: false,
      reason: 'Order has been cancelled',
      details: 'Cancelled orders are not eligible for delivery'
    };
  }

  if (order.fulfillment_status === 'fulfilled') {
    return {
      valid: false,
      reason: 'Order has already been fulfilled',
      details: 'This order has already been delivered and cannot be claimed again'
    };
  }

  if (order.financial_status === 'refunded' || order.financial_status === 'partially_refunded') {
    return {
      valid: false,
      reason: 'Order has been refunded',
      details: 'Refunded orders are not eligible for delivery'
    };
  }

  if (order.refunds && order.refunds.length > 0) {
    const totalRefunded = order.refunds.reduce((sum, refund) => {
      return sum + parseFloat(refund.amount || 0);
    }, 0);
    
    const totalPrice = parseFloat(order.total_price || 0);
    
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

// YOUR WORKING ROBLOX USERNAME VERIFICATION (unchanged)
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

  console.log(`Searching for Roblox user: ${cleanUsername}`);

  // Method 1: Username-to-ID conversion
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
      
      if (usernameData.data && usernameData.data.length > 0) {
        const userData = usernameData.data[0];
        
        if (userData.name && userData.name.toLowerCase() === cleanUsername.toLowerCase()) {
          console.log('✅ Found exact match via username-to-ID API:', userData.name);
          
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
            success: true,
            userId: userData.id.toString(),
            username: userData.name,
            avatarUrl: avatarUrl,
            verified: true,
            source: 'roblox_api'
          });
        }
      }
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
      
      if (userSearchData.data && userSearchData.data.length > 0) {
        const exactMatch = userSearchData.data.find(user => 
          user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
        );
        
        if (exactMatch) {
          console.log('✅ Found exact match via search API:', exactMatch.name);
          
          let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${exactMatch.id}&width=150&height=150&format=png&v=${Date.now()}`;
          
          try {
            const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${exactMatch.id}&size=150x150&format=Png&isCircular=false`);
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
            success: true,
            userId: exactMatch.id.toString(),
            username: exactMatch.name,
            avatarUrl: avatarUrl,
            verified: true,
            source: 'roblox_api'
          });
        }
      }
    }
  } catch (apiError) {
    console.error('❌ Search API error:', apiError.message);
  }

  console.log('❌ Username verification failed with both methods');
  return res.status(404).json({ 
    error: `User "${cleanUsername}" not found`,
    details: 'Please check the spelling and try again (case-sensitive)'
  });
}

// UTILITY FUNCTIONS
function generateDeliveryId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `AG_${timestamp}_${random}`;
}

// MAIN HANDLER
export default async function handler(req, res) {
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
    
    console.log('🔍 API Request:', { 
      orderNumber: !!orderNumber, 
      email: !!email, 
      username: !!username, 
      action: action || 'none',
      hasDeliveryData: !!deliveryData,
      shopDomain: process.env.SHOPIFY_SHOP_DOMAIN // Added for debugging
    });

    // Firestore test
    if (action === 'test_firestore') {
      try {
        const db = initFirebase();
        const testDoc = {
          test: true,
          timestamp: serverTimestamp(),
          message: 'Firestore connection test',
          testId: generateDeliveryId(),
          createdAt: new Date().toISOString()
        };
        
        const testRef = await addDoc(collection(db, 'connection_tests'), testDoc);
        const elapsed = Date.now() - startTime;
        
        return res.status(200).json({
          success: true,
          message: 'Firestore connection successful',
          testDocId: testRef.id,
          timing: elapsed
        });
        
      } catch (error) {
        return res.status(500).json({ 
          success: false,
          error: error.message
        });
      }
    }

    // Route requests
    if (action === 'verify_order' && orderNumber && email) {
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (action === 'verify_username' && username) {
      return await handleUsernameVerification(req, res, username);
    }

    if (action === 'register_delivery' && deliveryData) {
      return await handleDeliveryRegistration(req, res, deliveryData);
    }

    // Fallback detection
    if (orderNumber && email && !username) {
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (username && !orderNumber && !email) {
      return await handleUsernameVerification(req, res, username);
    }

    return res.status(400).json({ 
      error: 'Invalid request parameters',
      received: { orderNumber: !!orderNumber, email: !!email, username: !!username, action, hasDeliveryData: !!deliveryData },
      expected: 'Either (orderNumber + email) for order verification, (username) for Roblox verification, or (deliveryData) for delivery registration'
    });

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('💥 API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timing: elapsed
    });
  }
}
