# Docker Setup for WhatsApp Web.js API with MongoDB

This guide provides Docker Compose configurations for running the WhatsApp Web.js API with MongoDB support for dynamic per-session webhooks.

## 🚀 Quick Start

### Production Setup

```bash
# Clone and navigate to the project
git clone <your-repo>
cd wwebjs-api

# Start the services
docker-compose -f docker-compose-with-mongo.yml up -d

# Check logs
docker-compose -f docker-compose-with-mongo.yml logs -f
```

### Development Setup

```bash
# Start development environment
docker-compose -f docker-compose-dev.yml up -d

# Check logs
docker-compose -f docker-compose-dev.yml logs -f
```

## 📋 Available Configurations

### 1. Production Setup (`docker-compose-with-mongo.yml`)

**Services:**
- **API**: WhatsApp Web.js API with MongoDB support
- **MongoDB**: Production MongoDB with authentication
- **Mongo Express**: Web-based MongoDB admin interface

**Features:**
- ✅ MongoDB with authentication
- ✅ Persistent data volumes
- ✅ Health checks
- ✅ Network isolation
- ✅ Web admin interface
- ✅ Production-ready configuration

### 2. Development Setup (`docker-compose-dev.yml`)

**Services:**
- **API**: Development build with hot reload
- **MongoDB**: Simple MongoDB without authentication

**Features:**
- ✅ Development-friendly configuration
- ✅ Volume mounting for live code changes
- ✅ No authentication (easier development)
- ✅ Debug logging enabled

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ENABLE_MONGODB` | Enable MongoDB for session webhooks | `true` | No |
| `MONGO_URI` | MongoDB connection string | `mongodb://mongodb:27017/wwebjs-api` | Yes (if MongoDB enabled) |
| `API_KEY` | API authentication key | - | Yes (production) |
| `BASE_WEBHOOK_URL` | Default webhook URL | - | Yes |
| `AUTO_START_SESSIONS` | Auto-start existing sessions | `true` | No |
| `HEADLESS` | Run browser in headless mode | `true` | No |

### MongoDB Configuration

**Production:**
```yaml
environment:
  - MONGO_INITDB_ROOT_USERNAME=admin
  - MONGO_INITDB_ROOT_PASSWORD=password123
  - MONGO_URI=mongodb://admin:password123@mongodb:27017/wwebjs-api?authSource=admin
```

**Development:**
```yaml
environment:
  - MONGO_URI=mongodb://mongodb:27017/wwebjs-api
```

## 🌐 Access Points

### Production Setup
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api-docs
- **Mongo Express**: http://localhost:8081 (admin/admin123)

### Development Setup
- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api-docs

## 📊 Data Persistence

### Volumes
- `mongodb_data`: MongoDB database files
- `sessions_data`: WhatsApp session data
- `./sessions`: Local session directory (dev only)

### Backup MongoDB
```bash
# Create backup
docker exec wwebjs-mongodb mongodump --db wwebjs-api --out /backup

# Copy backup to host
docker cp wwebjs-mongodb:/backup ./mongodb-backup
```

### Restore MongoDB
```bash
# Copy backup to container
docker cp ./mongodb-backup wwebjs-mongodb:/restore

# Restore database
docker exec wwebjs-mongodb mongorestore --db wwebjs-api /restore/wwebjs-api
```

## 🔐 Security Considerations

### Production Security
1. **Change default passwords**:
   ```yaml
   - MONGO_INITDB_ROOT_PASSWORD=your_secure_password
   - API_KEY=your_secure_api_key
   ```

2. **Use environment files**:
   ```bash
   # Create .env file
   MONGO_ROOT_PASSWORD=your_secure_password
   API_KEY=your_secure_api_key
   
   # Use in docker-compose
   docker-compose -f docker-compose-with-mongo.yml --env-file .env up -d
   ```

3. **Network security**:
   - Remove port mappings for MongoDB in production
   - Use reverse proxy for API access
   - Enable SSL/TLS

### Development Security
- MongoDB runs without authentication
- API key is optional
- All ports are exposed for easy access

## 🚀 Usage Examples

### Start a Session with Custom Webhook
```bash
curl -X POST http://localhost:3000/session/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "sessionId": "customer-support",
    "webhookURL": "https://your-app.com/webhook/customer-support"
  }'
```

### Update Session Webhook
```bash
curl -X POST http://localhost:3000/session/webhook/customer-support \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhookURL": "https://new-webhook.com/customer-support"
  }'
```

### Check Session Status
```bash
curl -X GET http://localhost:3000/session/status/customer-support \
  -H "X-API-Key: your-api-key"
```

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   ```bash
   # Check MongoDB logs
   docker-compose logs mongodb
   
   # Check network connectivity
   docker exec wwebjs-api ping mongodb
   ```

2. **API Not Starting**
   ```bash
   # Check API logs
   docker-compose logs api
   
   # Check if MongoDB is ready
   docker-compose ps
   ```

3. **Sessions Not Persisting**
   ```bash
   # Check volume mounts
   docker-compose exec api ls -la /usr/src/app/sessions
   
   # Check MongoDB collections
   docker exec wwebjs-mongodb mongosh --eval "db.sessions.find()"
   ```

### Health Checks

```bash
# Check all services
docker-compose ps

# Check specific service health
docker inspect wwebjs-api --format='{{.State.Health.Status}}'
docker inspect wwebjs-mongodb --format='{{.State.Health.Status}}'
```

### Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f mongodb

# Last 100 lines
docker-compose logs --tail=100 api
```

## 🔄 Updates and Maintenance

### Update Services
```bash
# Pull latest images
docker-compose pull

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build
```

### Clean Up
```bash
# Stop and remove containers
docker-compose down

# Remove volumes (WARNING: This deletes all data)
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

## 📈 Monitoring

### Resource Usage
```bash
# Container stats
docker stats

# Specific container
docker stats wwebjs-api wwebjs-mongodb
```

### Database Monitoring
- Access Mongo Express at http://localhost:8081
- Use MongoDB Compass for advanced monitoring
- Set up MongoDB monitoring with Prometheus/Grafana

## 🎯 Best Practices

1. **Use environment files** for sensitive data
2. **Enable health checks** for production
3. **Set up log rotation** for long-running containers
4. **Use specific image tags** instead of `latest`
5. **Regular backups** of MongoDB data
6. **Monitor resource usage** and scale as needed
7. **Use reverse proxy** for production deployments
8. **Enable SSL/TLS** for secure communication
