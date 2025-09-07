require('./routes')
const express = require('express')
const { routes } = require('./routes')
const { maxAttachmentSize, basePath, trustProxy, enableSwagger, swaggerPath } = require('./config')

const app = express()

// Initialize Express app
app.disable('x-powered-by')

// Configure trust proxy for reverse proxy compatibility
if (trustProxy) {
  app.set('trust proxy', true)
}

app.use(express.json({ limit: maxAttachmentSize + 1000000 }))
app.use(express.urlencoded({ limit: maxAttachmentSize + 1000000, extended: true }))

// Swagger documentation
if (enableSwagger) {
  try {
    const swaggerUi = require('swagger-ui-express')
    const swaggerDocument = require('../swagger.json')
    
    const swaggerOptions = {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'WWebJS API Documentation'
    }
    
    app.use(swaggerPath, swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions))
    console.log(`Swagger documentation available at ${swaggerPath}`)
  } catch (error) {
    console.warn('Swagger documentation not available:', error.message)
  }
}

// Mount routes with configurable base path
const mountPath = basePath || '/'
app.use(mountPath, routes)

module.exports = app
