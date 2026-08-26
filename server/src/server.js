import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const app = express()
const port = process.env.PORT || 4000
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  mobile: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  location: { lat: Number, lng: Number },
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  profileImage: { type: String, default: null }
}, { timestamps: true }))
const Product = mongoose.model('Product', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'Uncategorized', trim: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0 },
  stock: { type: Number, required: true, min: 0 },
  description: { type: String, trim: true },
  images: [{ type: String }],
  mainImage: { type: String },
  attributes: [{ name: String, values: [String] }],
  rating: { average: { type: Number, default: 0 }, count: { type: Number, default: 0 } }
}, { timestamps: true }))
const Review = mongoose.model('Review', new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  title: { type: String, trim: true, maxlength: 120 },
  comment: { type: String, trim: true, maxlength: 2000 },
  isVerifiedPurchase: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' }
}, { timestamps: true }))
Review.schema.index({ productId: 1, userId: 1 }, { unique: true })

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

const publicUser = user => ({ id: user._id, name: user.name, email: user.email, mobile: user.mobile, address: user.address, username: user.username, location: user.location, profileImage: user.profileImage })
const tokenFor = user => jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })
const adminTokenFor = () => jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '1d' })
const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(payload.userId)
    if (!req.user) return res.status(401).json({ message: 'Account not found.' })
    next()
  } catch { res.status(401).json({ message: 'Please sign in again.' }) }
}
const adminAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (!payload.admin) return res.status(403).json({ message: 'Admin access required.' })
    next()
  } catch { res.status(401).json({ message: 'Please sign in again.' }) }
}
async function refreshProductRating(productId) {
  const [summary] = await Review.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ])
  await Product.findByIdAndUpdate(productId, { rating: { average: summary ? Math.round(summary.average * 10) / 10 : 0, count: summary?.count || 0 } })
}
const reviewView = review => ({ _id: review._id, productId: review.productId, userId: review.userId, customer: review.userId?.name || 'Customer', product: review.productId?.name, rating: review.rating, title: review.title, comment: review.comment, isVerifiedPurchase: review.isVerifiedPurchase, status: review.status, createdAt: review.createdAt, updatedAt: review.updatedAt })

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.post('/api/admin/login', (req, res) => {
  const bypassEnabled = process.env.ADMIN_BYPASS === 'true'
  const credentialsValid = req.body.username === process.env.ADMIN_USERNAME && req.body.password === process.env.ADMIN_PASSWORD && req.body.securityPassword === process.env.ADMIN_SECURITY_PASSWORD
  if (!bypassEnabled && !credentialsValid) return res.status(401).json({ message: 'Admin credentials or security pass is incorrect.' })
  res.json({ token: adminTokenFor(), admin: { username: process.env.ADMIN_USERNAME } })
})
app.get('/api/admin/products', adminAuth, async (req, res) => res.json({ products: await Product.find().sort({ createdAt: -1 }) }))
app.post('/api/admin/products', adminAuth, async (req, res) => {
  try {
    const { name, category, price, quantity, stock, description, images = [], mainImage, attributes = [] } = req.body
    if (!name || price === undefined || quantity === undefined) return res.status(400).json({ message: 'Name, quantity, and price are required.' })
    const product = await Product.create({ name, category: category?.trim() || 'Uncategorized', price: Number(price), quantity: Number(quantity), stock: Number(quantity), description, images, mainImage: mainImage || images[0], attributes })
    res.status(201).json({ product })
  } catch (err) { res.status(400).json({ message: err.name === 'ValidationError' ? Object.values(err.errors).map(error => error.message).join(' ') : 'Could not add this product.' }) }
})
app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const { name, category, price, quantity, description, images = [], mainImage, attributes = [] } = req.body
    if (!name || price === undefined || quantity === undefined) return res.status(400).json({ message: 'Name, quantity, and price are required.' })
    const product = await Product.findByIdAndUpdate(req.params.id, { name, category: category?.trim() || 'Uncategorized', price: Number(price), quantity: Number(quantity), stock: Number(quantity), description, images, mainImage: mainImage || images[0], attributes }, { new: true, runValidators: true })
    if (!product) return res.status(404).json({ message: 'Product not found.' })
    res.json({ product })
  } catch (err) { res.status(400).json({ message: err.name === 'ValidationError' ? Object.values(err.errors).map(error => error.message).join(' ') : 'Could not update this product.' }) }
})
app.get('/api/products', async (req, res) => res.json({ products: await Product.find().sort({ createdAt: -1 }) }))
app.get('/api/products/:id', async (req, res) => {
  try { const product = await Product.findById(req.params.id); if (!product) return res.status(404).json({ message: 'Product not found.' }); res.json({ product }) } catch { res.status(404).json({ message: 'Product not found.' }) }
})
app.get('/api/reviews/product/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId, status: 'approved' }).populate('userId', 'name').sort({ createdAt: -1 })
    const distribution = [5, 4, 3, 2, 1].map(rating => ({ rating, count: reviews.filter(review => review.rating === rating).length }))
    const product = await Product.findById(req.params.productId).select('rating')
    res.json({ reviews: reviews.map(reviewView), rating: product?.rating || { average: 0, count: 0 }, distribution })
  } catch { res.status(400).json({ message: 'Could not load reviews.' }) }
})
app.post('/api/reviews', auth, async (req, res) => {
  try {
    const { productId, rating, title = '', comment = '' } = req.body
    if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Invalid product.' })
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' })
    if (!await Product.exists({ _id: productId })) return res.status(404).json({ message: 'Product not found.' })
    const review = await Review.create({ productId, userId: req.user._id, rating, title, comment, status: 'approved' })
    await refreshProductRating(productId)
    res.status(201).json({ review: reviewView(await review.populate('userId', 'name')) })
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already reviewed this product.' })
    res.status(400).json({ message: 'Could not submit your review.' })
  }
})
app.put('/api/reviews/:reviewId', auth, async (req, res) => {
  try {
    const { rating, title = '', comment = '' } = req.body
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' })
    const review = await Review.findOne({ _id: req.params.reviewId, userId: req.user._id })
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    review.rating = rating; review.title = title; review.comment = comment; await review.save(); await refreshProductRating(review.productId)
    res.json({ review: reviewView(await review.populate('userId', 'name')) })
  } catch { res.status(400).json({ message: 'Could not update your review.' }) }
})
app.delete('/api/reviews/:reviewId', auth, async (req, res) => {
  try {
    const review = await Review.findOneAndDelete({ _id: req.params.reviewId, userId: req.user._id })
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    await refreshProductRating(review.productId); res.json({ message: 'Review deleted.' })
  } catch { res.status(400).json({ message: 'Could not delete your review.' }) }
})
app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  const reviews = await Review.find().populate('userId', 'name').populate('productId', 'name').sort({ createdAt: -1 })
  const approved = reviews.filter(review => review.status === 'approved')
  res.json({ reviews: reviews.map(reviewView), summary: { total: approved.length, average: approved.length ? Math.round(approved.reduce((sum, review) => sum + review.rating, 0) / approved.length * 10) / 10 : 0, distribution: [5, 4, 3, 2, 1].map(rating => ({ rating, count: approved.filter(review => review.rating === rating).length })) } })
})
app.get('/api/admin/products/:productId/reviews', adminAuth, async (req, res) => {
  const reviews = await Review.find({ productId: req.params.productId }).populate('userId', 'name').populate('productId', 'name').sort({ createdAt: -1 })
  res.json({ reviews: reviews.map(reviewView) })
})
app.put('/api/admin/reviews/:reviewId/status', adminAuth, async (req, res) => {
  if (!['approved', 'rejected', 'pending'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid review status.' })
  const review = await Review.findByIdAndUpdate(req.params.reviewId, { status: req.body.status }, { new: true }).populate('userId', 'name').populate('productId', 'name')
  if (!review) return res.status(404).json({ message: 'Review not found.' })
  await refreshProductRating(review.productId._id); res.json({ review: reviewView(review) })
})
app.delete('/api/admin/reviews/:reviewId', adminAuth, async (req, res) => {
  const review = await Review.findByIdAndDelete(req.params.reviewId)
  if (!review) return res.status(404).json({ message: 'Review not found.' })
  await refreshProductRating(review.productId); res.json({ message: 'Review deleted.' })
})
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, mobile, address, location, username, password, confirmPassword } = req.body
    if (![name, email, mobile, address, username, password].every(Boolean)) return res.status(400).json({ message: 'Please complete every required field.' })
    if (!/^\+91\d{10}$/.test(mobile)) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number with +91.' })
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' })
    if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' })
    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] })
    if (exists) return res.status(409).json({ message: 'That email or username is already registered.' })
    const user = await User.create({ name, email, mobile, address, location, username, passwordHash: await bcrypt.hash(password, 12) })
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) })
  } catch { res.status(500).json({ message: 'Could not create your account.' }) }
})
app.post('/api/auth/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username })
  if (!user || !(await bcrypt.compare(req.body.password || '', user.passwordHash))) return res.status(401).json({ message: 'Username or password is incorrect.' })
  res.json({ token: tokenFor(user), user: publicUser(user) })
})
app.post('/api/auth/forgot', async (req, res) => {
  const { name, email, username, newPassword } = req.body
  const user = await User.findOne({ name, email: email?.toLowerCase(), username })
  if (!user) return res.status(404).json({ message: 'We could not match those account details.' })
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters.' })
  user.passwordHash = await bcrypt.hash(newPassword, 12)
  await user.save()
  res.json({ message: 'Password updated. You can sign in now.' })
})
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }))
app.put('/api/auth/me', auth, async (req, res) => {
  try {
    const { name, email, mobile, address, location, profileImage } = req.body
    const updateData = {}
    if (name) updateData.name = name
    if (email) updateData.email = email.toLowerCase()
    if (mobile) updateData.mobile = mobile
    if (address) updateData.address = address
    if (location) updateData.location = location
    if (profileImage !== undefined) updateData.profileImage = profileImage
    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true, runValidators: true })
    res.json({ user: publicUser(user) })
  } catch (err) { res.status(400).json({ message: 'Could not update your profile.' }) }
})

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) console.warn('Set MONGODB_URI and JWT_SECRET in server/.env before starting the API.')
else mongoose.connect(process.env.MONGODB_URI).then(() => app.listen(port, () => console.log(`API listening on http://localhost:${port}`))).catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1) })
