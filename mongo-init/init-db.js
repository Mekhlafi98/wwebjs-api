// MongoDB initialization script for WhatsApp Web.js API
// This script sets up the database and collections

// Switch to the wwebjs-api database
db = db.getSiblingDB('wwebjs-api');

// Create a user for the application
db.createUser({
  user: 'wwebjs-user',
  pwd: 'wwebjs-password',
  roles: [
    {
      role: 'readWrite',
      db: 'wwebjs-api'
    }
  ]
});

// Create the sessions collection with proper indexes
db.createCollection('sessions');

// Create indexes for better performance
db.sessions.createIndex({ "sessionId": 1 }, { unique: true });
db.sessions.createIndex({ "createdAt": 1 });
db.sessions.createIndex({ "updatedAt": 1 });

// Insert a sample session configuration (optional)
db.sessions.insertOne({
  sessionId: "example-session",
  webhookURL: "https://example.com/webhook",
  createdAt: new Date(),
  updatedAt: new Date()
});

print('Database initialization completed successfully!');
print('Created user: wwebjs-user');
print('Created collection: sessions');
print('Created indexes for optimal performance');
