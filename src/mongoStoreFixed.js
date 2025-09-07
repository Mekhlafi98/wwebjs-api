// Fixed MongoStore implementation to resolve GitHub issue #2631
const fs = require('fs')
const { GridFSBucket } = require('mongodb')

class MongoStoreFixed {
  constructor({ mongoose }) {
    if (!mongoose) throw new Error('A valid Mongoose instance is required for MongoStore.')
    this.mongoose = mongoose
  }

  async sessionExists(options) {
    const multiDeviceCollection = this.mongoose.connection.db.collection(`whatsapp-${options.session}.files`)
    const hasExistingSession = await multiDeviceCollection.countDocuments()
    return !!hasExistingSession
  }

  async save(options) {
    const bucket = new GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`,
    })
    
    const uploadStream = bucket.openUploadStream(`${options.session}.zip`)
    const readStream = fs.createReadStream(`${options.session}.zip`)
    
    await new Promise((resolve, reject) => {
      readStream.pipe(uploadStream).on('error', reject).on('finish', resolve)
    })
    
    await this.deletePrevious(bucket, `${options.session}`)
  }

  async extract(options) {
    const bucket = new GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`,
    })
    
    return new Promise((resolve, reject) => {
      bucket
        .openDownloadStreamByName(`${options.session}.zip`)
        .pipe(fs.createWriteStream(`${options.path}`))
        .on('error', reject)
        .on('finish', resolve)
    })
  }

  async delete(options) {
    const bucket = new GridFSBucket(this.mongoose.connection.db, {
      bucketName: `whatsapp-${options.session}`,
    })
    
    const documents = await bucket
      .find({
        filename: `${options.session}.zip`,
      })
      .toArray()

    await Promise.all(documents.map((doc) => bucket.delete(doc._id)))
  }

  async deletePrevious(bucket, session) {
    const documents = await bucket
      .find({
        filename: `${session}.zip`,
      })
      .toArray()
      
    if (documents.length > 1) {
      const oldSession = documents.reduce((a, b) => (a.uploadDate < b.uploadDate ? a : b))
      await bucket.delete(oldSession._id)
    }
  }
}

module.exports = { MongoStoreFixed }
