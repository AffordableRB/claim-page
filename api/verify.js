// api/verify.js - Updated with GraphQL Shopify API
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
    
    // Check for required environment variables
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
    
    console.log('🔥 Firebase config loaded:', {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      hasApiKey: !!firebaseConfig.apiKey
    });
    
    // Initialize app if not already done
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
      console.log('🔥 Firebase app initialized');
    } else {
      app = getApps()[0];
      console.log('🔥 Using existing Firebase app');
    }
    
    db = getFirestore(app);
    
    // Connect to emulator in development
    if (DEBUG_MODE && process.env.FIRESTORE_EMULATOR_HOST) {
      console.log('🧪 Connecting to Firestore emulator...');
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
    
    // Prepare document data with proper types
    const docData = {
      // Core registration info
      registrationId,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
      
      // Order information
      orderNumber: deliveryData.order?.orderNumber || 'N/A',
      email: deliveryData.order?.email || 'N/A',
      orderItems: deliveryData.order?.items || 'Digital Items',
      orderTotal: deliveryData.order?.total || 'N/A',
      orderCurrency: deliveryData.order?.currency || 'USD',
      orderId: deliveryData.order?.orderId || null,
      customerName: deliveryData.order?.customerName || null,
      
      // Roblox information  
      robloxUsername: deliveryData.roblox?.username || 'N/A',
      robloxUserId: deliveryData.roblox?.userId?.toString() || 'N/A',
      robloxAvatarUrl: deliveryData.roblox?.avatar || null,
      
      // Delivery tracking
      status: 'pending_delivery',
      deliveryStaffAssigned: null,
      serverJoinTime: deliveryData.serverJoinTime || new Date().toISOString(),
      completedAt: null,
      
      // Metadata
      processedBy: 'delivery_system_v2',
      source: 'affordable_garden_delivery',
      apiVersion: '2.1',
      userAgent: deliveryData.userAgent || null,
      
      // Analytics fields
      stepCompletionTimes: deliveryData.stepCompletionTimes || null,
      totalProcessingTime: Date.now() - startTime
    };

    console.log('📝 Document data prepared:', {
      registrationId: docData.registrationId,
      orderNumber: docData.orderNumber,
      robloxUsername: docData.robloxUsername,
      status: docData.status
    });

    // Save to Firestore collection
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
    console.error(`❌ Firestore save failed after ${elapsed}ms:`, {
      error: error.message,
      code: error.code,
      stack: DEBUG_MODE ? error.stack : undefined
    });
    
    // Provide helpful error context
    if (error.code === 'permission-denied') {
      throw new Error('Firestore permissions error - check security rules');
    } else if (error.code === 'unavailable') {
      throw new Error('Firestore temporarily unavailable - please try again');
    } else if (error.message.includes('Firebase')) {
      throw new Error(`Firebase configuration error: ${error.message}`);
    } else {
      throw error;
    }
  }
}

// DELIVERY REGISTRATION HANDLER
async function handleDeliveryRegistration(req, res, deliveryData) {
  console.log('📦 Processing Delivery Registration with Firestore...');
  
  const startTime = Date.now();
  const REQUEST_TIMEOUT = 8000; // 8 seconds to stay under Vercel limit
  
  try {
    // Quick validation
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

    // Additional validation
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

    console.log('📊 Starting Firestore save operation...', {
      orderNumber: deliveryData.order.orderNumber,
      email: deliveryData.order.email,
      username: deliveryData.roblox.username,
      userId: deliveryData.roblox.userId
    });
    
    // Add request metadata
    deliveryData.userAgent = req.headers['user-agent'];
    
    // Save to Firestore with timeout protection
    const firestorePromise = saveToFirestore(deliveryData);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Firestore operation timed out to prevent Vercel timeout'));
      }, REQUEST_TIMEOUT);
    });
    
    let firestoreResult;
    try {
      firestoreResult = await Promise.race([firestorePromise, timeoutPromise]);
    } catch (timeoutError) {
      const elapsed = Date.now() - startTime;
      console.warn(`⏱️ Firestore operation timed out after ${elapsed}ms`);
      
      // Return partial success response
      const fallbackId = generateDeliveryId();
      console.log('🔄 Returning fallback response due to timeout');
      
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
    console.log(`✅ Firestore save completed successfully in ${elapsed}ms`);
    
    // Prepare success response
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
    
    console.log('🎉 Delivery registration successful:', {
      registrationId: registrationRecord.registrationId,
      firestoreId: firestoreResult.firestoreId,
      timing: elapsed
    });
    
    return res.status(200).json({
      success: true,
      message: 'Delivery request registered successfully in Firestore',
      registrationId: registrationRecord.registrationId,
      data: registrationRecord
    });
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Delivery registration failed after ${elapsed}ms:`, error);
    
    return res.status(500).json({ 
      error: 'Failed to save delivery request to Firestore',
      message: error.message,
      timing: elapsed,
      details: {
        hasFirebaseConfig: isFirebaseConfigured(),
        errorType: error.name || 'Unknown',
        errorCode: error.code || null,
        timestamp: new Date().toISOString(),
        suggestion: getSuggestionForError(error)
      }
    });
  }
}

// UPDATED: GraphQL Shopify Order Verification
async function handleOrderVerification(req, res, orderNumber, email) {
  console.log(`🔍 GraphQL Shopify Order Verification: ${orderNumber} for ${email}`);
  
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

    // Search for the order using GraphQL
    const searchResult = await findShopifyOrderGraphQL(cleanOrderNumber, cleanEmail);
    
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
      orderId: order.id,
      customerName: order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() : 'N/A',
      items: formatOrderItems(order.lineItems?.nodes || []),
      total: order.totalPrice?.amount || '0.00',
      currency: order.totalPrice?.currencyCode || 'USD',
      orderDate: order.createdAt,
      fulfilled: order.fulfillmentStatus === 'FULFILLED',
      verified: true,
      source: 'shopify_graphql_api'
    });

  } catch (error) {
    console.error('Shopify GraphQL API error:', error);
    return res.status(500).json({ 
      error: 'Failed to verify order',
      message: 'Please try again in a moment',
      details: DEBUG_MODE ? error.message : undefined
    });
  }
}

// NEW: GraphQL Shopify Helper Functions
async function findShopifyOrderGraphQL(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
  try {
    console.log(`🔍 Searching Shopify GraphQL for order: ${orderNumber}`);
    
    // GraphQL query to search for orders by name
    const query = `
      query getOrderByName($query: String!) {
        orders(first: 10, query: $query) {
          nodes {
            id
            name
            email
            createdAt
            totalPrice {
              amount
              currencyCode
            }
            customer {
              id
              email
              firstName
              lastName
            }
            fulfillmentStatus
            financialStatus
            cancelledAt
            lineItems(first: 50) {
              nodes {
                id
                name
                quantity
                variant {
                  title
                }
                product {
                  title
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      query: `name:${orderNumber}`
    };

    console.log('📡 Sending GraphQL request to Shopify...');
    const response = await fetch(`https://${shopDomain}.myshopify.com/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`Shopify GraphQL API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
    }

    const orders = data.data?.orders?.nodes || [];
    console.log(`📊 Found ${orders.length} orders with name ${orderNumber}`);

    if (orders.length === 0) {
      return null;
    }

    // Check if any of the found orders match the email
    const matchingOrder = orders.find(order => 
      order.customer && order.customer.email && 
      order.customer.email.toLowerCase() === email.toLowerCase()
    );

    if (matchingOrder) {
      console.log('✅ Found matching order with email');
      return { order: matchingOrder, emailMatch: true };
    }

    // Check if the order itself has the email (for guest orders)
    const guestOrder = orders.find(order => 
      order.email && order.email.toLowerCase() === email.toLowerCase()
    );

    if (guestOrder) {
      console.log('✅ Found matching guest order with email');
      return { order: guestOrder, emailMatch: true };
    }

    // Order exists but email doesn't match
    console.log('⚠️ Order found but no email match');
    return { order: orders[0], emailMatch: false };

  } catch (error) {
    console.error('Shopify GraphQL API error:', error);
    throw error;
  }
}

// UPDATED: Validation and formatting functions for GraphQL data
function validateOrderForDelivery(order) {
  // Check if order is cancelled
  if (order.cancelledAt) {
    return {
      valid: false,
      reason: 'Order has been cancelled',
      details: 'This order was cancelled and cannot be processed for delivery.'
    };
  }

  // Check payment status (GraphQL uses different enum values)
  if (order.financialStatus !== 'PAID' && order.financialStatus !== 'PARTIALLY_PAID') {
    return {
      valid: false,
      reason: 'Payment not completed',
      details: 'This order has not been paid for yet. Please complete payment first.'
    };
  }

  return { valid: true };
}

function formatOrderItems(lineItems) {
  if (!lineItems || lineItems.length === 0) {
    return 'No items found';
  }

  return lineItems.map(item => {
    const productTitle = item.product?.title || item.name || 'Unknown Product';
    const variantTitle = item.variant?.title || '';
    const variantInfo = variantTitle && variantTitle !== 'Default Title' ? ` (${variantTitle})` : '';
    return `${item.quantity}x ${productTitle}${variantInfo}`;
  }).join(', ');
}

// ROBLOX USERNAME VERIFICATION (unchanged)
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
    console.log('Attempting Roblox API username lookup...');
    
    const userIdResponse = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usernames: [cleanUsername]
      })
    });

    if (!userIdResponse.ok) {
      throw new Error(`Roblox API responded with ${userIdResponse.status}`);
    }

    const userIdData = await userIdResponse.json();
    console.log('Username lookup response:', userIdData);

    if (!userIdData.data || userIdData.data.length === 0) {
      console.log('❌ Username not found in Roblox API');
      return res.status(404).json({ 
        error: 'Username not found',
        details: 'Please check the spelling and try again (case-sensitive)'
      });
    }

    const userData = userIdData.data[0];
    const userId = userData.id;
    const actualUsername = userData.name;

    console.log(`✅ Found user: ${actualUsername} (ID: ${userId})`);

    // Method 2: Get avatar using the user ID
    let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;
    
    try {
      // Try to get a more up-to-date avatar from the thumbnail API
      const avatarResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (avatarResponse.ok) {
        const avatarData = await avatarResponse.json();
        if (avatarData.data && avatarData.data.length > 0 && avatarData.data[0].imageUrl) {
          avatarUrl = avatarData.data[0].imageUrl;
          console.log('✅ Got updated avatar URL from thumbnails API');
        }
      }
    } catch (avatarError) {
      console.log('⚠️ Avatar API failed, using fallback URL:', avatarError.message);
      // Keep the fallback URL
    }

    // Verify the username case matches (Roblox is case-sensitive for display)
    if (actualUsername.toLowerCase() !== cleanUsername.toLowerCase()) {
      console.log(`⚠️ Username case mismatch: provided "${cleanUsername}", actual "${actualUsername}"`);
      return res.status(400).json({
        error: 'Username case mismatch',
        details: `The username exists but with different capitalization. Did you mean "${actualUsername}"?`,
        suggestion: actualUsername
      });
    }

    console.log(`✅ Username verification successful for ${actualUsername}`);

    return res.status(200).json({
      success: true,
      username: actualUsername,
      userId: userId,
      avatarUrl: avatarUrl,
      verified: true,
      source: 'roblox_api'
    });

  } catch (error) {
    console.error('Roblox verification error:', error);
    
    // Handle specific API errors
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      return res.status(429).json({ 
        error: 'Rate limited by Roblox API',
        details: 'Please try again in a moment'
      });
    }
    
    if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      return res.status(502).json({ 
        error: 'Roblox API temporarily unavailable',
        details: 'Please try again in a moment'
      });
    }

    return res.status(500).json({ 
      error: 'Failed to verify Roblox username',
      message: error.message.includes('fetch') ? 'Network error - please try again' : error.message
    });
  }
}

// UTILITY FUNCTIONS
function generateDeliveryId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `AG_${timestamp}_${random}`;
}

function isFirebaseConfigured() {
  return !!(
    process.env.FIREBASE_PROJECT_ID && 
    process.env.FIREBASE_API_KEY &&
    process.env.FIREBASE_AUTH_DOMAIN &&
    process.env.FIREBASE_STORAGE_BUCKET &&
    process.env.FIREBASE_MESSAGING_SENDER_ID &&
    process.env.FIREBASE_APP_ID
  );
}

function getSuggestionForError(error) {
  if (error.message.includes('permission')) {
    return 'Check your Firestore security rules and ensure they allow writes to the delivery_requests collection';
  } else if (error.message.includes('Firebase')) {
    return 'Verify your Firebase configuration environment variables are correct';
  } else if (error.message.includes('timeout')) {
    return 'Firebase operation timed out - this may be a temporary issue, please try again';
  } else {
    return 'Check your Firebase project settings and ensure Firestore is enabled';
  }
}

// MAIN API HANDLER
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
      userAgent: req.headers['user-agent']?.substring(0, 50) + '...'
    });

    // FIRESTORE CONNECTION TEST
    if (action === 'test_firestore') {
      try {
        console.log('🧪 Testing Firestore connection...');
        
        if (!isFirebaseConfigured()) {
          return res.status(500).json({
            success: false,
            error: 'Firebase environment variables not configured',
            config: {
              hasApiKey: !!process.env.FIREBASE_API_KEY,
              hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
              hasAuthDomain: !!process.env.FIREBASE_AUTH_DOMAIN,
              hasStorageBucket: !!process.env.FIREBASE_STORAGE_BUCKET,
              hasMessagingSenderId: !!process.env.FIREBASE_MESSAGING_SENDER_ID,
              hasAppId: !!process.env.FIREBASE_APP_ID
            }
          });
        }
        
        const db = initFirebase();
        
        // Simple test write
        const testDoc = {
          test: true,
          timestamp: serverTimestamp(),
          message: 'Firestore connection test',
          testId: generateDeliveryId(),
          createdAt: new Date().toISOString()
        };
        
        console.log('🧪 Attempting test write to Firestore...');
        const testRef = await addDoc(collection(db, 'connection_tests'), testDoc);
        const elapsed = Date.now() - startTime;
        
        console.log(`✅ Firestore test successful in ${elapsed}ms`);
        
        return res.status(200).json({
          success: true,
          message: 'Firestore connection and write test successful',
          testDocId: testRef.id,
          testDocPath: `connection_tests/${testRef.id}`,
          timing: elapsed,
          timestamp: new Date().toISOString(),
          config: {
            projectId: process.env.FIREBASE_PROJECT_ID,
            hasApiKey: !!process.env.FIREBASE_API_KEY,
            environment: DEBUG_MODE ? 'development' : 'production'
          }
        });
        
      } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error('🧪 Firestore test failed:', error);
        
        return res.status(500).json({ 
          success: false,
          error: error.message,
          timing: elapsed,
          config: {
            hasFirebaseConfig: isFirebaseConfigured(),
            errorCode: error.code,
            errorType: error.name
          },
          suggestion: getSuggestionForError(error)
        });
      }
    }

    // Handle different request types
    if (action === 'verify_order' && orderNumber && email) {
      console.log('📋 Processing order verification with GraphQL...');
      return await handleOrderVerification(req, res, orderNumber, email);
    }
    
    if (action === 'verify_username' && username) {
      console.log('🎮 Processing username verification...');
      return await handleUsernameVerification(req, res, username);
    }

    // Handle delivery registration
    if (action === 'register_delivery' && deliveryData) {
      console.log('🚀 Processing delivery registration with Firestore...');
      return await handleDeliveryRegistration(req, res, deliveryData);
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
