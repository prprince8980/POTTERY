import { app, mongoConnection } from '../src/server.js'

export default async function handler(req, res) {
  try {
    await mongoConnection
    return app(req, res)
  } catch (error) {
    console.error('MongoDB connection failed:', error.message)
    return res.status(503).json({ success: false, message: 'Database connection unavailable.' })
  }
}