// api/verify.js - Clean Production API
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import crypto from 'crypto';

// Initialize Firebase (only once per cold start)
let app;
let db;
let isInitialized = false;

function initFirebase() {
  if (!isInitialized) {
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
    isInitialized = true;
  }
  
  return db;
}

// FIRESTORE SAVE FUNCTION
async function saveToFirestore(deliveryData) {
  const startTime = Date.now();
  
  try {
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
    console.error(`Firestore save failed after ${elapsed}ms:`, error);
    throw error;
  }
}

async function handleDeliveryRegistration(req, res, deliveryData) {
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
        reject(new Error('Registration operation timed out'));
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
      message: 'Delivery request registered successfully',
      registrationId: registrationRecord.registrationId,
      data: registrationRecord
    });
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('Delivery registration failed:', error);
    
    return res.status(500).json({ 
      error: 'Failed to save delivery request',
      message: error.message,
      timing: elapsed,
      canContinue: true // Let user continue to server anyway
    });
  }
}

// SHOPIFY ORDER VERIFICATION
async function handleOrderVerification(req, res, orderNumber, email) {
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
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Search for the order in Shopify
    const searchResult = await findShopifyOrder(cleanOrderNumber, cleanEmail);
    
    if (!searchResult) {
      return res.status(404).json({ 
        error: 'Order not found',
        details: 'Please check your order number and try again'
      });
    }

    // Check if order was found but email doesn't match
    if (!searchResult.emailMatch) {
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
      message: 'Please try again in a moment'
    });
  }
}

// SHOPIFY SEARCH FUNCTION
async function findShopifyOrder(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  
  // Smart domain handling - check if .myshopify.com is already included
  const baseUrl = shopDomain.includes('.myshopify.com') 
    ? `https://${shopDomain}` 
    : `https://${shopDomain}.myshopify.com`;
  
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
  let foundOrderWithWrongEmail = null;

  for (const query of uniqueSearchQueries) {
    try {
      const nameSearchUrl = `${baseUrl}/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(query)}&limit=1`;
      
      const response = await fetch(nameSearchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      
      if (data.orders && data.orders.length > 0) {
        const order = data.orders[0];
        
        if (order.email && order.email.toLowerCase() === email) {
          return { order, emailMatch: true };
        } else {
          foundOrderWithWrongEmail = order;
        }
      }
      
    } catch (error) {
      continue;
    }
  }

  // Method 2: Search by email and filter
  try {
    const emailSearchUrl = `${baseUrl}/admin/api/${apiVersion}/orders.json?email=${encodeURIComponent(email)}&limit=50`;
    
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
          return { order: matchingOrder, emailMatch: true };
        }
      }
    }
  } catch (error) {
    console.error('Error searching by email:', error);
  }

  if (foundOrderWithWrongEmail) {
    return { order: foundOrderWithWrongEmail, emailMatch: false };
  }

  return null;
}

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

// ROBLOX USERNAME VERIFICATION
async function handleUsernameVerification(req, res, username) {
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

  // Method 1: Username-to-ID conversion
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
            // Use fallback URL
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
    console.error('Username-to-ID API error:', apiError.message);
  }

  // Method 2: Fallback to search API
  try {
    const userSearchResponse = await fetch(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(cleanUsername)}&limit=10`);
    
    if (userSearchResponse.ok) {
      const userSearchData = await userSearchResponse.json();
      
      if (userSearchData.data && userSearchData.data.length > 0) {
        const exactMatch = userSearchData.data.find(user => 
          user.name && user.name.toLowerCase() === cleanUsername.toLowerCase()
        );
        
        if (exactMatch) {
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
            // Use fallback URL
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
    console.error('Search API error:', apiError.message);
  }

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
    console.error('API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timing: elapsed
    });
  }
}
