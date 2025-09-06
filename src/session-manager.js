// sessionManager.js
const { Client, LocalAuth } = require('whatsapp-web.js')
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
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
  releaseBrowserLock
} = require('./config')

// MongoDB Schema for per-session config
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  webhookURL: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
})
const SessionModel = mongoose.model('Session', sessionSchema)

// In-memory map for active clients
const sessions = new Map()

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
// Setup a session
// ------------------------
const setupSession = async (sessionId, webhookURL) => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) }
    }

    logger.info({ sessionId }, 'Session is being initiated')

    // Save per-session config in MongoDB
    if (webhookURL) {
      await SessionModel.findOneAndUpdate(
        { sessionId },
        { webhookURL },
        { upsert: true, new: true }
      )
    }

    const localAuth = new LocalAuth({ clientId: sessionId, dataPath: sessionFolderPath })
    delete localAuth.logout
    localAuth.logout = () => { }

    const clientOptions = { puppeteer: { executablePath: chromeBin, headless, args: getPuppeteerArgs() }, authStrategy: localAuth }
    if (webVersion) clientOptions.webVersion = webVersion
    clientOptions.webVersionCache = getWebVersionCache(webVersionCacheType, webVersion)

    const client = new Client(clientOptions)

    if (releaseBrowserLock) await removeSingletonLock(sessionId)

    client.once('ready', () => patchWWebLibrary(client).catch(err => logger.error({ sessionId, err }, 'Failed to patch WWebJS library')))
    initWebSocketServer(sessionId)
    await initializeEvents(client, sessionId)
    await client.initialize()

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
  const sessionData = await SessionModel.findOne({ sessionId })
  const sessionWebhook = sessionData?.webhookURL

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
    const sessionWebhook = sessionData?.webhookURL
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
// Helpers
// ------------------------
const removeSingletonLock = async (sessionId) => {
  const lockPath = path.resolve(path.join(sessionFolderPath, `session-${sessionId}`, 'SingletonLock'))
  if (await fs.promises.lstat(lockPath).then(() => true).catch(() => false)) {
    logger.warn({ sessionId }, 'Removing browser lock file')
    await fs.promises.unlink(lockPath)
  }
}

const getPuppeteerArgs = () => [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-extensions', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-client-side-phishing-detection',
  '--disable-sync', '--disable-gpu', '--disable-popup-blocking', '--hide-scrollbars'
]

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
  deleteSessionFolder
}
