# Dynamic Per-Session Webhooks

This implementation adds support for dynamic per-session webhooks with MongoDB persistence, allowing you to set different webhook URLs for each WhatsApp session at runtime.

## Features

✅ **Dynamic Webhook URLs**: Set different webhook URLs for each session  
✅ **MongoDB Persistence**: Session configurations survive server restarts  
✅ **Backward Compatibility**: Works with existing LocalAuth and environment variable approaches  
✅ **API Endpoints**: RESTful API for managing session webhooks  
✅ **Optional MongoDB**: Can be disabled to use in-memory storage  

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Enable MongoDB for session webhook storage
ENABLE_MONGODB=true
MONGO_URI=mongodb://localhost:27017/wwebjs-api

# Base webhook URL (fallback)
BASE_WEBHOOK_URL=https://your-default-webhook.com/webhook
```

### MongoDB Setup

1. Install MongoDB locally or use a cloud service like MongoDB Atlas
2. Set `ENABLE_MONGODB=true` in your `.env` file
3. Configure `MONGO_URI` with your MongoDB connection string

If MongoDB is disabled (`ENABLE_MONGODB=false`), the system falls back to:
- Environment variables: `{SESSION_ID}_WEBHOOK_URL`
- Base webhook URL from `BASE_WEBHOOK_URL`

## API Endpoints

### 1. Start Session with Custom Webhook

**POST** `/session/start`

```json
{
  "sessionId": "my-session-1",
  "webhookURL": "https://my-app.com/webhook/session-1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Session initiated successfully",
  "webhookURL": "https://my-app.com/webhook/session-1"
}
```

### 2. Update Session Webhook

**POST** `/session/webhook/{sessionId}`

```json
{
  "webhookURL": "https://my-app.com/webhook/session-1-updated"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook updated successfully",
  "webhookURL": "https://my-app.com/webhook/session-1-updated"
}
```

### 3. Get Session Webhook

**GET** `/session/webhook/{sessionId}`

**Response:**
```json
{
  "success": true,
  "webhookURL": "https://my-app.com/webhook/session-1"
}
```

## Usage Examples

### Example 1: Start Multiple Sessions with Different Webhooks

```bash
# Start session 1 with webhook A
curl -X POST http://localhost:3000/session/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "sessionId": "customer-support",
    "webhookURL": "https://my-app.com/webhook/customer-support"
  }'

# Start session 2 with webhook B
curl -X POST http://localhost:3000/session/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "sessionId": "sales-team",
    "webhookURL": "https://my-app.com/webhook/sales-team"
  }'
```

### Example 2: Update Webhook for Existing Session

```bash
curl -X POST http://localhost:3000/session/webhook/customer-support \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhookURL": "https://new-webhook.com/customer-support"
  }'
```

### Example 3: Check Current Webhook

```bash
curl -X GET http://localhost:3000/session/webhook/customer-support \
  -H "X-API-Key: your-api-key"
```

## Webhook Payload Format

All webhooks receive the same payload format:

```json
{
  "sessionId": "customer-support",
  "event": "message",
  "data": {
    "message": {
      "id": "message-id",
      "body": "Hello World",
      "from": "1234567890@c.us",
      "to": "0987654321@c.us",
      "timestamp": 1640995200,
      "type": "chat"
    }
  }
}
```

## Migration from Environment Variables

If you're currently using environment variables like `SESSION1_WEBHOOK_URL`, you can migrate to MongoDB:

1. Enable MongoDB: `ENABLE_MONGODB=true`
2. Start your sessions using the new API endpoint
3. The system will automatically save webhook URLs to MongoDB
4. Environment variables will still work as fallback

## Database Schema

The MongoDB collection `sessions` stores:

```javascript
{
  sessionId: "customer-support",           // Unique session identifier
  webhookURL: "https://...",              // Webhook URL for this session
  createdAt: "2024-01-01T00:00:00.000Z",  // Creation timestamp
  updatedAt: "2024-01-01T00:00:00.000Z"   // Last update timestamp
}
```

## Error Handling

- If MongoDB is disabled, webhook update operations will return an error
- If a session doesn't exist, webhook operations will return appropriate error messages
- All operations include proper error logging

## Performance Considerations

- MongoDB operations are asynchronous and don't block session initialization
- Session webhooks are cached in memory for fast access during event processing
- Database queries are optimized with proper indexing on `sessionId`

## Security Notes

- All API endpoints require authentication via `X-API-Key` header
- Webhook URLs should use HTTPS in production
- Consider implementing webhook signature verification for additional security

## Troubleshooting

### MongoDB Connection Issues
- Check MongoDB is running and accessible
- Verify `MONGO_URI` is correct
- Check network connectivity and firewall settings

### Webhook Not Receiving Events
- Verify webhook URL is accessible from your server
- Check webhook endpoint is responding with 200 status
- Review server logs for webhook delivery errors

### Session Not Using Custom Webhook
- Ensure MongoDB is enabled and connected
- Check session was started with the new API endpoint
- Verify webhook URL was saved to database
