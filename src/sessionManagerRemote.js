// sessionManagerRemote.js - Using official RemoteAuth strategy
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js')
const { MongoStore } = require('wwebjs-mongo')
const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')
const { logger } = require('./logger')
const { patchWWebLibrary, triggerWebhook, waitForNestedObject, isEventEnabled, sendMessageSeenStatus, sleep } = require('./utils')
const { initWebSocketServer, terminateWebSocketServer, triggerWebSocket } = require('./websocket')
const {
  sessionFolderPath,
  maxAttachmentSize,
  setMessagesAsSeen,
  webVersion,
  webVersionCacheType,
  recoverSessions,
  chromeBin,
  headless,
  releaseBrowserLock,
  baseWebhookURL,
  enableMongoDB,
  mongoUri
} = require('./config')

// MongoDB Schema for per-session webhook configs
const sessionWebhookSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  webhookURL: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const SessionWebhookModel = mongoose.model('SessionWebhook', sessionWebhookSchema)

// In-memory map for active clients
const sessions = new Map()

// Initialize MongoDB connection
const initializeMongoDB = async () => {
  if (!enableMongoDB) {
    logger.info('MongoDB is disabled, using LocalAuth only')
    return
  }

  try {
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })
    logger.info('Connected to MongoDB successfully')
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to MongoDB')
    throw error
  }
}

// ------------------------
// Validate if session is ready
// ------------------------
const validateSession = async (sessionId) => {
  try {
    if (!sessions.has(sessionId)) return { success: false, state: null, message: 'session_not_found' }
    const client = sessions.get(sessionId)
    await waitForNestedObject(client, 'pupPage')

    let maxRetry = 0
    while (true) {
      try {
        if (client.pupPage.isClosed()) return { success: false, state: null, message: 'browser tab closed' }
        await Promise.race([client.pupPage.evaluate('1'), new Promise(resolve => setTimeout(resolve, 1000))])
        break
      } catch (error) {
        if (maxRetry++ === 2) return { success: false, state: null, message: 'session closed' }
      }
    }

    const state = await client.getState()
    if (state !== 'CONNECTED') return { success: false, state, message: 'session_not_connected' }

    return { success: true, state, message: 'session_connected' }
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to validate session')
    return { success: false, state: null, message: error.message }
  }
}

// ------------------------
// Restore sessions from folder
// ------------------------
const restoreSessions = async () => {
  try {
    if (!fs.existsSync(sessionFolderPath)) fs.mkdirSync(sessionFolderPath)
    const files = await fs.promises.readdir(sessionFolderPath)

    for (const file of files) {
      const match = file.match(/^session-(.+)$/)
      if (match) {
        const sessionId = match[1]
        logger.warn({ sessionId }, 'Existing session detected')
        await setupSession(sessionId)
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to restore sessions')
  }
}

// ------------------------
// Setup a session with RemoteAuth or LocalAuth
// ------------------------
const setupSession = async (sessionId, webhookURL) => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) }
    }

    logger.info({ sessionId }, 'Session is being initiated')

    // Save per-session webhook config in MongoDB
    if (webhookURL) {
      try {
        await SessionWebhookModel.findOneAndUpdate(
          { sessionId },
          { webhookURL, updatedAt: new Date() },
          { upsert: true, new: true }
        )
        logger.info({ sessionId }, 'Session webhook config saved to MongoDB')
      } catch (error) {
        logger.error({ sessionId, err: error }, 'Failed to save session webhook config to MongoDB')
      }
    }

    // Choose auth strategy based on MongoDB availability
    let authStrategy
    if (enableMongoDB) {
      // Use RemoteAuth with MongoDB
      const store = new MongoStore({ mongoose: mongoose })
      authStrategy = new RemoteAuth({
        clientId: sessionId,
        store: store,
        backupSyncIntervalMs: 300000 // 5 minutes
      })
      logger.info({ sessionId }, 'Using RemoteAuth with MongoDB')
    } else {
      // Use LocalAuth
      authStrategy = new LocalAuth({ 
        clientId: sessionId, 
        dataPath: sessionFolderPath 
      })
      logger.info({ sessionId }, 'Using LocalAuth')
    }

    const clientOptions = { 
      puppeteer: { 
        executablePath: chromeBin, 
        headless, 
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--mute-audio',
          '--no-default-browser-check',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-hang-monitor',
          '--disable-prompt-on-repost',
          '--disable-domain-reliability',
          '--disable-component-extensions-with-background-pages',
          '--disable-background-networking',
          '--disable-client-side-phishing-detection',
          '--disable-sync-preferences',
          '--disable-extensions-http-throttling',
          '--disable-plugins-discovery',
          '--disable-preconnect',
          '--disable-print-preview',
          '--disable-speech-api',
          '--disable-file-system',
          '--disable-presentation-api',
          '--disable-permissions-api',
          '--disable-new-tab-first-run',
          '--disable-background-mode',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--force-color-profile=srgb',
          '--memory-pressure-off',
          '--max_old_space_size=4096',
          '--disable-blink-features=AutomationControlled'
        ]
      }, 
      authStrategy: authStrategy 
    }

    if (webVersion) clientOptions.webVersion = webVersion
    clientOptions.webVersionCache = getWebVersionCache(webVersionCacheType, webVersion)

    const client = new Client(clientOptions)

    if (releaseBrowserLock) await removeSingletonLock(sessionId)

    client.once('ready', () => patchWWebLibrary(client).catch(err => logger.error({ sessionId, err }, 'Failed to patch WWebJS library')))
    
    // Listen for remote session saved event
    if (enableMongoDB) {
      client.on('remote_session_saved', () => {
        logger.info({ sessionId }, 'Remote session saved successfully')
      })
    }
    
    initWebSocketServer(sessionId)
    await initializeEvents(client, sessionId)
    
    // Initialize client
    try {
      await client.initialize()
      logger.info({ sessionId }, 'Client initialized successfully')
    } catch (initError) {
      logger.error({ sessionId, err: initError }, 'Failed to initialize client')
      throw initError
    }

    sessions.set(sessionId, client)
    return { success: true, message: 'Session initiated successfully', client }
  } catch (error) {
    return { success: false, message: error.message, client: null }
  }
}

// ------------------------
// Initialize client events
// ------------------------
const initializeEvents = async (client, sessionId) => {
  let sessionWebhook = baseWebhookURL

  // Get session webhook from MongoDB if enabled
  if (enableMongoDB) {
    try {
      const sessionData = await SessionWebhookModel.findOne({ sessionId })
      if (sessionData?.webhookURL) {
        sessionWebhook = sessionData.webhookURL
        logger.info({ sessionId, webhookURL: sessionWebhook }, 'Using session-specific webhook')
      }
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Failed to get session webhook from MongoDB')
    }
  } else {
    // Fallback to environment variable approach
    const envWebhook = process.env[sessionId.toUpperCase() + '_WEBHOOK_URL']
    if (envWebhook) {
      sessionWebhook = envWebhook
      logger.info({ sessionId, webhookURL: sessionWebhook }, 'Using environment variable webhook')
    }
  }

  if (recoverSessions) {
    await waitForNestedObject(client, 'pupPage')
    const restartSession = async () => {
      sessions.delete(sessionId)
      await client.destroy().catch(() => {})
      await setupSession(sessionId)
    }
    client.pupPage.once('close', restartSession)
    client.pupPage.once('error', restartSession)
  }

  const bindEvent = (eventName) => {
    if (!isEventEnabled(eventName)) return
    client.on(eventName, (...args) => {
      triggerWebhook(sessionWebhook, sessionId, eventName, ...args)
      triggerWebSocket(sessionId, eventName, ...args)
    })
  }

  const events = [
    'auth_failure', 'authenticated', 'call', 'change_state', 'disconnected', 'group_join', 'group_leave',
    'group_admin_changed', 'group_membership_request', 'group_update', 'loading_screen', 'media_uploaded',
    'message', 'message_ack', 'message_create', 'message_reaction', 'message_edit', 'message_ciphertext',
    'message_revoke_everyone', 'message_revoke_me', 'qr', 'ready', 'contact_changed', 'chat_removed',
    'chat_archived', 'unread_count', 'vote_update', 'code'
  ]

  events.forEach(bindEvent)

  // Special handling for message + media
  client.on('message', async (message) => {
    triggerWebhook(sessionWebhook, sessionId, 'message', { message })
    triggerWebSocket(sessionId, 'message', { message })

    if (message.hasMedia && message._data?.size < maxAttachmentSize && isEventEnabled('media')) {
      message.downloadMedia()
        .then(media => triggerWebhook(sessionWebhook, sessionId, 'media', { message, media }))
        .catch(err => logger.error({ sessionId, err }, 'Failed to download media'))
    }

    if (setMessagesAsSeen) await sleep(1000).then(() => sendMessageSeenStatus(message))
  })
}

// ------------------------
// Update session webhook
// ------------------------
const updateSessionWebhook = async (sessionId, webhookURL) => {
  try {
    const sessionData = await SessionWebhookModel.findOneAndUpdate(
      { sessionId },
      { webhookURL, updatedAt: new Date() },
      { upsert: true, new: true }
    )
    logger.info({ sessionId, webhookURL }, 'Session webhook updated in MongoDB')
    return sessionData
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to update session webhook')
    throw error
  }
}

// ------------------------
// Get session webhook
// ------------------------
const getSessionWebhook = async (sessionId) => {
  try {
    const sessionData = await SessionWebhookModel.findOne({ sessionId })
    return sessionData?.webhookURL || baseWebhookURL
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to get session webhook')
    return baseWebhookURL
  }
}

// ------------------------
// Delete session folder safely
// ------------------------
const deleteSessionFolder = async (sessionId) => {
  const targetDirPath = path.join(sessionFolderPath, `session-${sessionId}`)
  const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath)
  const resolvedSessionPath = await fs.promises.realpath(sessionFolderPath)
  if (!resolvedTargetDirPath.startsWith(`${resolvedSessionPath}${path.sep}`)) throw new Error('Directory traversal detected')
  await fs.promises.rm(resolvedTargetDirPath, { recursive: true, force: true })
}

// ------------------------
// Reload session
// ------------------------
const reloadSession = async (sessionId) => {
  const client = sessions.get(sessionId)
  if (!client) return
  client.pupPage?.removeAllListeners('close')
  client.pupPage?.removeAllListeners('error')
  try {
    const pages = await client.pupBrowser.pages()
    await Promise.all(pages.map(p => p.close()))
    await Promise.race([client.pupBrowser.close(), new Promise(resolve => setTimeout(resolve, 5000))])
  } catch (e) {
    client.pupBrowser.process()?.kill(9)
  }
  sessions.delete(sessionId)
  await setupSession(sessionId)
}

// ------------------------
// Destroy session
// ------------------------
const destroySession = async (sessionId) => {
  const client = sessions.get(sessionId)
  if (!client) return
  client.pupPage?.removeAllListeners('close')
  client.pupPage?.removeAllListeners('error')
  await terminateWebSocketServer(sessionId).catch(() => {})
  await client.destroy()
  sessions.delete(sessionId)
}

// ------------------------
// Delete session (with folder cleanup)
// ------------------------
const deleteSession = async (sessionId, validation) => {
  try {
    const client = sessions.get(sessionId)
    if (!client) {
      return
    }
    client.pupPage?.removeAllListeners('close')
    client.pupPage?.removeAllListeners('error')
    try {
      await terminateWebSocketServer(sessionId)
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Failed to terminate WebSocket server')
    }
    if (validation.success) {
      // Client Connected, request logout
      logger.info({ sessionId }, 'Logging out session')
      await client.logout()
    } else if (validation.message === 'session_not_connected') {
      // Client not Connected, request destroy
      logger.info({ sessionId }, 'Destroying session')
      await client.destroy()
    }
    // Wait 10 secs for client.pupBrowser to be disconnected before deleting the folder
    let maxDelay = 0
    while (client.pupBrowser.isConnected() && (maxDelay < 10)) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      maxDelay++
    }
    sessions.delete(sessionId)
    
    // Only delete folder if using LocalAuth
    if (!enableMongoDB) {
      await deleteSessionFolder(sessionId)
    }

    // Remove session webhook config from MongoDB
    if (enableMongoDB) {
      try {
        await SessionWebhookModel.deleteOne({ sessionId })
        logger.info({ sessionId }, 'Session webhook config removed from MongoDB')
      } catch (error) {
        logger.error({ sessionId, err: error }, 'Failed to remove session webhook config from MongoDB')
      }
    }
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to delete session')
    throw error
  }
}

// ------------------------
// Flush sessions
// ------------------------
const flushSessions = async (deleteOnlyInactive) => {
  try {
    // Read the contents of the sessions folder
    const files = await fs.promises.readdir(sessionFolderPath)
    // Iterate through the files in the parent folder
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/)
      if (match) {
        const sessionId = match[1]
        const validation = await validateSession(sessionId)
        if (!deleteOnlyInactive || !validation.success) {
          await deleteSession(sessionId, validation)
        }
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to flush sessions')
    throw error
  }
}

// ------------------------
// Helpers
// ------------------------
const removeSingletonLock = async (sessionId) => {
  const lockPath = path.resolve(path.join(sessionFolderPath, `session-${sessionId}`, 'SingletonLock'))
  if (await fs.promises.lstat(lockPath).then(() => true).catch(() => false)) {
    logger.warn({ sessionId }, 'Removing browser lock file')
    await fs.promises.unlink(lockPath)
  }
}

const getWebVersionCache = (type, version) => {
  switch ((type || 'none').toLowerCase()) {
    case 'local': return { type: 'local' }
    case 'remote': return { type: 'remote', remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${version}.html` }
    default: return { type: 'none' }
  }
}

// ------------------------
// Export
// ------------------------
module.exports = {
  sessions,
  setupSession,
  restoreSessions,
  validateSession,
  reloadSession,
  destroySession,
  deleteSession,
  deleteSessionFolder,
  flushSessions,
  updateSessionWebhook,
  getSessionWebhook,
  initializeMongoDB,
  SessionWebhookModel
}
