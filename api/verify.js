// Enhanced order verification function with better debugging and multiple search methods
async function findShopifyOrder(orderNumber, email) {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  
  console.log('🔍 Shopify Configuration Check:', {
    shopDomain: shopDomain ? `${shopDomain.substring(0, 5)}...` : 'MISSING',
    hasAccessToken: !!accessToken,
    tokenLength: accessToken?.length || 0,
    apiVersion,
    originalOrderNumber: orderNumber,
    email
  });

  // Enhanced search queries with more variations
  const searchQueries = [
    orderNumber,
    orderNumber.replace(/^#/, ''),
    `#${orderNumber.replace(/^#/, '')}`,
    orderNumber.replace(/^AG-/, ''),
    `AG-${orderNumber.replace(/^(AG-|#)/, '')}`,
    orderNumber.replace(/^AF/, ''),
    `AF${orderNumber.replace(/^(AF|AG-|#)/, '')}`,
    // Add order number without prefixes
    orderNumber.replace(/^(AG-|AF|#)/, ''),
    // Try with leading zeros
    orderNumber.replace(/^(AG-|AF|#)/, '').padStart(4, '0'),
    `AG-${orderNumber.replace(/^(AG-|AF|#)/, '').padStart(4, '0')}`
  ];

  const uniqueSearchQueries = [...new Set(searchQueries)];
  console.log('📋 Search queries to try:', uniqueSearchQueries);

  let foundOrderWithWrongEmail = null;
  let lastResponse = null;

  // Method 1: Search by name (most common)
  for (const query of uniqueSearchQueries) {
    try {
      console.log(`🔎 Searching by name: "${query}"`);
      
      const nameSearchUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/orders.json?name=${encodeURIComponent(query)}&limit=10&status=any`;
      
      console.log('📡 Request URL:', nameSearchUrl.replace(accessToken, 'TOKEN_HIDDEN'));
      
      const response = await fetch(nameSearchUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      lastResponse = {
        status: response.status,
        statusText: response.statusText,
        query: query
      };

      console.log(`📊 Response for "${query}":`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API Error for query "${query}":`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText.substring(0, 200)
        });
        continue;
      }

      const data = await response.json();
      console.log(`📦 Orders found for "${query}":`, data.orders?.length || 0);
      
      if (data.orders && data.orders.length > 0) {
        data.orders.forEach((order, index) => {
          console.log(`  Order ${index + 1}: ${order.name} | ${order.email} | Status: ${order.financial_status}`);
        });

        const order = data.orders[0];
        
        if (order.email && order.email.toLowerCase() === email.toLowerCase()) {
          console.log(`✅ PERFECT MATCH: ${order.name} with email ${order.email}`);
          return { order, emailMatch: true };
        } else {
          console.log(`⚠️ Order found but email mismatch: ${order.email} vs ${email}`);
          foundOrderWithWrongEmail = order;
        }
      }
      
    } catch (error) {
      console.error(`💥 Error searching for order "${query}":`, error.message);
      continue;
    }
  }

  // Method 2: Search by order_number field
  console.log('🔍 Trying order_number search...');
  const cleanOrderNum = orderNumber.replace(/^(AG-|AF|#)/, '');
  
  try {
    const orderNumUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/orders.json?limit=50&status=any&fields=id,name,email,order_number,financial_status`;
    
    const response = await fetch(orderNumUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`📦 Found ${data.orders?.length || 0} recent orders to check`);
      
      if (data.orders && data.orders.length > 0) {
        const matchingOrder = data.orders.find(order => {
          const orderMatches = uniqueSearchQueries.some(query => {
            return order.name === query || 
                   order.order_number?.toString() === cleanOrderNum ||
                   order.order_number?.toString() === query;
          });
          return orderMatches && order.email?.toLowerCase() === email.toLowerCase();
        });
        
        if (matchingOrder) {
          console.log(`✅ FOUND via order_number search: ${matchingOrder.name}`);
          return { order: matchingOrder, emailMatch: true };
        }
      }
    }
  } catch (error) {
    console.error('❌ Order number search failed:', error.message);
  }

  // Method 3: Search by email first, then filter
  console.log('📧 Trying email-first search...');
  try {
    const emailSearchUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/orders.json?email=${encodeURIComponent(email)}&limit=50&status=any`;
    
    const response = await fetch(emailSearchUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`📬 Found ${data.orders?.length || 0} orders for email ${email}`);
      
      if (data.orders && data.orders.length > 0) {
        data.orders.forEach((order, index) => {
          console.log(`  Email Order ${index + 1}: ${order.name} | Created: ${order.created_at}`);
        });

        const matchingOrder = data.orders.find(order => {
          return uniqueSearchQueries.some(query => {
            return order.name === query || 
                   order.order_number?.toString() === cleanOrderNum ||
                   (order.name && order.name.includes(cleanOrderNum));
          });
        });
        
        if (matchingOrder) {
          console.log(`✅ FOUND via email search: ${matchingOrder.name}`);
          return { order: matchingOrder, emailMatch: true };
        }
      }
    }
  } catch (error) {
    console.error('❌ Email search failed:', error.message);
  }

  // Method 4: Try GraphQL API as fallback
  console.log('🔄 Trying GraphQL API as last resort...');
  try {
    const graphqlQuery = `
      query getOrders($query: String!) {
        orders(first: 10, query: $query) {
          nodes {
            id
            name
            email
            legacyResourceId
            financialStatus
            customer {
              firstName
              lastName
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            createdAt
          }
        }
      }
    `;

    const graphqlUrl = `https://${shopDomain}.myshopify.com/admin/api/${apiVersion}/graphql.json`;
    
    for (const query of uniqueSearchQueries.slice(0, 3)) { // Try only first 3 to avoid rate limits
      const searchQuery = `name:${query} OR email:${email}`;
      
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { query: searchQuery }
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('📈 GraphQL response:', JSON.stringify(data, null, 2));
        
        if (data.data?.orders?.nodes?.length > 0) {
          const matchingOrder = data.data.orders.nodes.find(order => 
            order.name === query && order.email?.toLowerCase() === email.toLowerCase()
          );
          
          if (matchingOrder) {
            console.log(`✅ FOUND via GraphQL: ${matchingOrder.name}`);
            // Convert GraphQL format to REST format
            const restOrder = {
              id: matchingOrder.legacyResourceId,
              name: matchingOrder.name,
              email: matchingOrder.email,
              financial_status: matchingOrder.financialStatus?.toLowerCase(),
              total_price: matchingOrder.totalPriceSet?.shopMoney?.amount,
              currency: matchingOrder.totalPriceSet?.shopMoney?.currencyCode,
              created_at: matchingOrder.createdAt,
              customer: {
                first_name: matchingOrder.customer?.firstName,
                last_name: matchingOrder.customer?.lastName
              }
            };
            return { order: restOrder, emailMatch: true };
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ GraphQL search failed:', error.message);
  }

  // Final diagnostic info
  console.log('🔍 FINAL DIAGNOSIS:', {
    lastResponseStatus: lastResponse?.status,
    lastResponseQuery: lastResponse?.query,
    foundOrderWithWrongEmail: !!foundOrderWithWrongEmail,
    wrongEmailOrderName: foundOrderWithWrongEmail?.name,
    wrongEmailOrderEmail: foundOrderWithWrongEmail?.email,
    searchedQueries: uniqueSearchQueries.length,
    shopDomain: `${shopDomain?.substring(0, 10)}...`,
    accessTokenPresent: !!accessToken
  });

  if (foundOrderWithWrongEmail) {
    return { order: foundOrderWithWrongEmail, emailMatch: false };
  }

  return null;
}

// Enhanced order verification with better error handling
async function handleOrderVerification(req, res, orderNumber, email) {
  console.log(`\n🔍 === ENHANCED ORDER VERIFICATION START ===`);
  console.log(`Order: ${orderNumber} | Email: ${email}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  // Input validation
  if (!orderNumber || !email) {
    console.log('❌ Missing required parameters');
    return res.status(400).json({ error: 'Order number and email are required' });
  }

  const cleanOrderNumber = orderNumber.trim();
  const cleanEmail = email.toLowerCase().trim();

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    console.log('❌ Invalid email format');
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Check environment variables more thoroughly
    const envCheck = {
      SHOPIFY_SHOP_DOMAIN: !!process.env.SHOPIFY_SHOP_DOMAIN,
      SHOPIFY_ACCESS_TOKEN: !!process.env.SHOPIFY_ACCESS_TOKEN,
      shopDomainValue: process.env.SHOPIFY_SHOP_DOMAIN?.substring(0, 10) + '...',
      tokenLength: process.env.SHOPIFY_ACCESS_TOKEN?.length
    };
    
    console.log('🔧 Environment check:', envCheck);

    if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
      console.error('❌ Missing Shopify credentials');
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'Missing Shopify API credentials'
      });
    }

    // Test API connectivity first
    console.log('🧪 Testing Shopify API connectivity...');
    const testUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}.myshopify.com/admin/api/2024-01/shop.json`;
    
    const testResponse = await fetch(testUrl, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    console.log('🔌 API connectivity test:', {
      status: testResponse.status,
      statusText: testResponse.statusText,
      ok: testResponse.ok
    });

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.error('❌ Shopify API connectivity failed:', {
        status: testResponse.status,
        error: errorText.substring(0, 300)
      });
      
      if (testResponse.status === 401) {
        return res.status(500).json({ 
          error: 'Invalid Shopify API credentials',
          details: 'Please check your access token'
        });
      } else if (testResponse.status === 404) {
        return res.status(500).json({ 
          error: 'Invalid shop domain',
          details: 'Please check your shop domain configuration'
        });
      }
    } else {
      const shopData = await testResponse.json();
      console.log('✅ Connected to shop:', shopData.shop?.name || 'Unknown Shop');
    }

    // Now search for the order
    const searchResult = await findShopifyOrder(cleanOrderNumber, cleanEmail);
    
    console.log('🔍 Search result:', {
      found: !!searchResult,
      emailMatch: searchResult?.emailMatch,
      orderName: searchResult?.order?.name
    });
    
    if (!searchResult) {
      console.log('❌ No matching order found after all search methods');
      return res.status(404).json({ 
        error: 'Order not found',
        details: `No order found matching "${cleanOrderNumber}" for email "${cleanEmail}". Please check both values and try again.`,
        searchedVariations: [
          cleanOrderNumber,
          `#${cleanOrderNumber}`,
          `AG-${cleanOrderNumber.replace(/^(AG-|#)/, '')}`,
          cleanOrderNumber.replace(/^(AG-|#)/, '')
        ]
      });
    }

    // Check if order was found but email doesn't match
    if (!searchResult.emailMatch) {
      console.log('❌ Order found but email mismatch');
      return res.status(400).json({ 
        error: 'Email does not match the order number',
        details: `Order "${searchResult.order.name}" exists but is associated with email "${searchResult.order.email}", not "${cleanEmail}". Please check your email and try again.`
      });
    }

    const order = searchResult.order;

    // Validate order for delivery
    const validationResult = validateOrderForDelivery(order);
    if (!validationResult.valid) {
      console.log('❌ Order validation failed:', validationResult.reason);
      return res.status(400).json({ 
        error: validationResult.reason,
        details: validationResult.details 
      });
    }

    console.log('✅ Order verification successful:', order.name);
    console.log(`=== VERIFICATION COMPLETE ===\n`);

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
      source: 'shopify_rest_api',
      searchMethod: 'enhanced_search'
    });

  } catch (error) {
    console.error('💥 Order verification error:', {
      message: error.message,
      stack: error.stack?.substring(0, 500)
    });
    
    return res.status(500).json({ 
      error: 'Failed to verify order',
      message: 'Please try again in a moment',
      details: DEBUG_MODE ? error.message : 'Internal server error'
    });
  }
}
