import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v2 as cloudinary } from 'cloudinary';

const SERVICE_NAME = process.env.SERVICE_NAME || 'Projenius 3D Website API';
const DEFAULT_PORT = SERVICE_NAME === 'Projenius 3D Admin API' ? 5001 : 5000;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const developmentOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const allowedOrigins = [
  ...new Set([
    ...(process.env.NODE_ENV === "production" ? [] : developmentOrigins),
    ...configuredOrigins,
  ]),
];
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const publicWriteLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many submissions. Please wait a little before trying again.' },
});

const { Schema } = mongoose;
const schema = (fields) => new Schema(fields, { timestamps: true, strict: false });
const Product = mongoose.models.Product || mongoose.model('Product', schema({
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, index: true, trim: true }, sku: { type: String, trim: true },
  description: { type: String, default: '', maxlength: 10000 },
  price: { type: Number, required: true, min: 0 }, salePrice: { type: Number, min: 0 },
  stock: { type: Number, default: 0, min: 0 }, categoryName: String, category: String,
  imageUrl: String, images: [{ url: String, publicId: String }],
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  featured: { type: Boolean, default: false }, personalize: { type: Boolean, default: false }, madeToOrder: { type: Boolean, default: false },
}));
const Order = mongoose.models.Order || mongoose.model('Order', schema({
  orderNumber: { type: String, unique: true, sparse: true, index: true },
  customer: { type: Schema.Types.Mixed, required: true }, items: { type: [Schema.Types.Mixed], required: true },
  subtotal: { type: Number, required: true }, shipping: { type: Number, required: true }, total: { type: Number, required: true },
  deliveryMethod: { type: String, default: 'standard' }, paymentMethod: { type: String, default: 'cod' },
  paymentStatus: { type: String, default: 'pending' }, status: { type: String, default: 'pending', index: true }, couponCode: String, discount: { type: Number, default: 0 },
}));
const Enquiry = mongoose.models.Enquiry || mongoose.model('Enquiry', schema({
  name: String, email: String, phone: String, subject: String, message: String, details: String,
  status: { type: String, default: 'new', index: true }, type: { type: String, default: 'contact', index: true },
  kind: String, attachments: [Schema.Types.Mixed],
}));
const Notification = mongoose.models.Notification || mongoose.model('Notification', schema({
  title: String, message: String, type: { type: String, default: 'info' }, read: { type: Boolean, default: false }, resourceId: String,
}));
const Setting = mongoose.models.Setting || mongoose.model('Setting', schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }));
const Category = mongoose.models.Category || mongoose.model('Category', schema({
  name: { type: String, required: true, trim: true }, slug: { type: String, index: true }, description: String,
  image: String, sortOrder: { type: Number, default: 0 }, visible: { type: Boolean, default: true }, status: { type: String, default: 'active' },
}));
const Customer = mongoose.models.Customer || mongoose.model('Customer', schema({
  name: { type: String, required: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: String, notes: String, orderCount: { type: Number, default: 0 }, totalSpent: { type: Number, default: 0 },
}));
const ManagedResource = mongoose.models.ManagedResource || mongoose.model('ManagedResource', new Schema(
  { resourceType: { type: String, required: true, index: true } },
  { timestamps: true, strict: false, collection: 'managedresources' },
));

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const cleanObject = (value = {}) => {
  const clean = { ...value };
  for (const key of ['_id', '__v', 'id', 'resourceType', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype']) delete clean[key];
  return clean;
};
function publicProduct(product) {
  const category = product.category && typeof product.category === 'object'
    ? (product.category.name || product.categoryName || '')
    : product.category;
  const publicFields = [
    '_id', 'name', 'slug', 'description', 'price', 'salePrice', 'stock',
    'categoryName', 'imageUrl', 'status', 'featured', 'personalize', 'madeToOrder',
    'age', 'ageGuidance', 'material', 'color', 'colour', 'size', 'dimensions',
    'weight', 'tags', 'createdAt', 'updatedAt',
  ];
  const result = Object.fromEntries(publicFields
    .filter((key) => product[key] !== undefined)
    .map((key) => [key, product[key]]));
  if (result.imageUrl && !/^https:\/\//i.test(String(result.imageUrl))) delete result.imageUrl;
  result.category = category || product.categoryName || '';
  result.images = Array.isArray(product.images)
    ? product.images.filter((image) => image && typeof image.url === 'string' && /^https:\/\//i.test(image.url))
      .map((image) => ({ url: image.url, ...(image.alt ? { alt: String(image.alt).slice(0, 180) } : {}) }))
    : [];
  return result;
}
function publicCategory(category) {
  const result = Object.fromEntries(['_id', 'name', 'slug', 'description', 'image', 'sortOrder']
    .filter((key) => category[key] !== undefined)
    .map((key) => [key, category[key]]));
  if (result.image && !/^https:\/\//i.test(String(result.image))) delete result.image;
  return result;
}
const transporter = process.env.SMTP_USER && process.env.SMTP_PASS ? nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || 'true') === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;
async function sendEmail(to, subject, text) {
  if (!transporter || !to) return { sent: false, reason: 'SMTP is not configured' };
  await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return { sent: true };
}
async function notify(title, message, type = 'info', resourceId = '') {
  let record = null;
  try { record = await Notification.create({ title, message, type, resourceId }); }
  catch (error) { console.error('Admin notification record failed:', error.message); }
  try { await sendEmail(process.env.ADMIN_NOTIFICATION_EMAIL, `[Projenius 3D] ${title}`, message); }
  catch (error) { console.error('Admin notification email failed:', error.message); }
  return record;
}
function getToken(req) {
  const header = req.headers.authorization || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}
function optionalAdmin(req, _res, next) {
  if (process.env.NODE_ENV === 'development' && process.env.ADMIN_DEV_BYPASS === 'true') {
    req.admin = { email: process.env.ADMIN_EMAIL || 'local-admin', role: 'admin' };
    return next();
  }
  const token = getToken(req);
  if (!token || !process.env.JWT_SECRET) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role === 'admin') req.admin = payload;
  } catch { /* Invalid tokens are treated as unauthenticated for public read routes. */ }
  return next();
}
function adminAuth(req, res, next) {
  if (process.env.NODE_ENV === 'development' && process.env.ADMIN_DEV_BYPASS === 'true') {
    req.admin = { email: process.env.ADMIN_EMAIL || 'local-admin', role: 'admin' };
    return next();
  }
  const token = getToken(req);
  if (!token) return res.status(401).json({ message: 'Admin sign-in required.' });
  if (!process.env.JWT_SECRET) return res.status(503).json({ message: 'Admin authentication is not configured on the server.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ message: 'Admin access required.' });
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired admin session. Please sign in again.' });
  }
}

const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (cloudinaryConfigured) cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
const uploadTempDirectory = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'projenius-3d-uploads');
fs.mkdirSync(uploadTempDirectory, { recursive: true });
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadTempDirectory),
  filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname || '').toLowerCase()}`),
});
const imageUpload = multer({
  storage: uploadStorage, limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)),
});
const allowedFileExtensions = new Set(['.stl', '.3mf', '.obj', '.png', '.jpg', '.jpeg', '.webp', '.pdf', '.svg', '.gif', '.avif']);
const inquiryUpload = multer({
  storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024, files: 10, fieldSize: 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    allowedFileExtensions.has(extension) ? cb(null, true) : cb(httpError(400, 'Unsupported attachment type. Use STL, 3MF, OBJ, JPG, PNG, WEBP or PDF files.'));
  },
});
async function cleanTempUploads(files = []) {
  await Promise.all((files || []).map((file) => file?.path ? fs.promises.unlink(file.path).catch(() => {}) : Promise.resolve()));
}
function uploadBuffer(file, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder, resource_type: 'auto', use_filename: true, unique_filename: true,
      filename_override: path.basename(file.originalname || 'upload'),
    }, (error, result) => error ? reject(error) : resolve(result));
    const input = fs.createReadStream(file.path);
    input.on('error', reject);
    stream.on('error', reject);
    input.pipe(stream);
  });
}
app.get('/', (_req, res) => res.json({ ok: true, service: SERVICE_NAME, docs: '/api', health: '/api/health' }));
app.get('/api', (_req, res) => res.json({
  service: SERVICE_NAME, health: '/api/health', public: ['/api/products', '/api/categories', '/api/reviews', '/api/faqs/public', '/api/settings/public', '/api/orders', '/api/enquiries'],
  admin: 'Bearer token from POST /api/auth/login is required for management routes.',
}));
app.get('/api/health', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ ok: connected, service: SERVICE_NAME, database: connected ? 'connected' : 'disconnected' });
});
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw httpError(400, 'Email and password are required.');
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH || !process.env.JWT_SECRET) {
    throw httpError(503, 'Admin login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH and JWT_SECRET in the backend environment.');
  }
  const validEmail = String(email).trim().toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase();
  const validPassword = await bcrypt.compare(String(password), process.env.ADMIN_PASSWORD_HASH);
  if (!validEmail || !validPassword) throw httpError(401, 'Invalid email or password.');
  const token = jwt.sign({ role: 'admin', email: process.env.ADMIN_EMAIL }, process.env.JWT_SECRET, { expiresIn: '8h', issuer: 'projenius-3d' });
  res.json({ token, user: { email: process.env.ADMIN_EMAIL, name: 'Administrator', role: 'admin' }, expiresIn: 28800 });
}));
app.get('/api/auth/me', adminAuth, (req, res) => res.json({ user: req.admin }));

app.post('/api/uploads', adminAuth, imageUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a JPG, PNG, WEBP, GIF or AVIF image under 8 MB.');
  if (!cloudinaryConfigured) {
    await cleanTempUploads([req.file]);
    throw httpError(503, 'Persistent image uploads are not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the backend environment.');
  }
  try {
    const result = await uploadBuffer(req.file, 'projenius-3d/products');
    return res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    console.error('Cloudinary image upload failed:', error.message);
    throw httpError(502, 'Image upload provider failed. Check the Cloudinary environment settings.');
  } finally {
    await cleanTempUploads([req.file]);
  }
}));

app.get('/api/products', optionalAdmin, asyncHandler(async (req, res) => {
  const filter = {};
  if (req.admin) {
    if (req.query.status) filter.status = String(req.query.status);
  } else {
    filter.status = 'published';
  }
  if (req.query.category) filter.categoryName = String(req.query.category);
  if (req.query.search) filter.name = { $regex: String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (req.query.featured === 'true') filter.featured = true;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
  const rows = await Product.find(filter).sort({ featured: -1, createdAt: -1 }).limit(limit).lean();
  const data = req.admin ? rows : rows.map(publicProduct);
  res.json({ data, items: data, total: data.length });
}));
app.get('/api/products/:id', optionalAdmin, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const product = mongoose.isValidObjectId(id) ? await Product.findById(id).lean() : await Product.findOne({ slug: id }).lean();
  if (!product || (product.status !== 'published' && !req.admin)) throw httpError(404, 'Product not found.');
  res.json({ data: req.admin ? product : publicProduct(product) });
}));
app.post('/api/products', adminAuth, asyncHandler(async (req, res) => {
  const body = cleanObject(req.body);
  if (!String(body.name || '').trim()) throw httpError(400, 'Product name is required.');
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) throw httpError(400, 'A valid product price is required.');
  body.price = price;
  if (body.salePrice !== undefined) {
    body.salePrice = Number(body.salePrice);
    if (!Number.isFinite(body.salePrice) || body.salePrice < 0 || body.salePrice > price) throw httpError(400, 'Sale price must be a valid amount no greater than the regular price.');
  }
  body.stock = Math.max(0, Number(body.stock) || 0);
  body.name = String(body.name).trim();
  body.slug = String(body.slug || body.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  body.status = body.status === 'published' ? 'published' : 'draft';
  const product = await Product.create(body);
  await notify('Product added', `${product.name} was added to the catalogue.`, 'product', String(product._id));
  res.status(201).json({ data: product });
}));
app.patch('/api/products/:id', adminAuth, asyncHandler(async (req, res) => {
  const body = cleanObject(req.body);
  if (body.price !== undefined) {
    body.price = Number(body.price);
    if (!Number.isFinite(body.price) || body.price < 0) throw httpError(400, 'Regular price must be a valid non-negative amount.');
  }
  if (body.salePrice !== undefined && body.salePrice !== '') {
    body.salePrice = Number(body.salePrice);
    const existingProduct = await Product.findById(req.params.id).lean();
    if (!Number.isFinite(body.salePrice) || body.salePrice < 0 || body.salePrice > Number(body.price ?? existingProduct?.price ?? 0)) throw httpError(400, 'Sale price must be a valid amount no greater than the regular price.');
  }
  if (body.stock !== undefined) body.stock = Math.max(0, Number(body.stock) || 0);
  if (body.name && !body.slug) body.slug = String(body.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const product = await Product.findByIdAndUpdate(req.params.id, { $set: body }, { new: true, runValidators: true });
  if (!product) throw httpError(404, 'Product not found.');
  res.json({ data: product });
}));
app.delete('/api/products/:id', adminAuth, asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw httpError(404, 'Product not found.');
  res.json({ message: 'Product deleted.' });
}));

app.get('/api/categories', optionalAdmin, asyncHandler(async (req, res) => {
  const filter = req.admin ? {} : { status: 'active', visible: { $ne: false } };
  const rows = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
  const data = req.admin ? rows : rows.map(publicCategory);
  res.json({ data, items: data, total: data.length });
}));
app.post('/api/categories', adminAuth, asyncHandler(async (req, res) => {
  const body = cleanObject(req.body);
  if (!String(body.name || '').trim()) throw httpError(400, 'Category name is required.');
  body.slug = String(body.slug || body.name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  res.status(201).json({ data: await Category.create(body) });
}));
app.patch('/api/categories/:id', adminAuth, asyncHandler(async (req, res) => {
  const item = await Category.findByIdAndUpdate(req.params.id, { $set: cleanObject(req.body) }, { new: true, runValidators: true });
  if (!item) throw httpError(404, 'Category not found.');
  res.json({ data: item });
}));
app.delete('/api/categories/:id', adminAuth, asyncHandler(async (req, res) => {
  const item = await Category.findByIdAndDelete(req.params.id);
  if (!item) throw httpError(404, 'Category not found.');
  res.json({ message: 'Category deleted.' });
}));

const enquiryFields = new Set(['name', 'email', 'phone', 'subject', 'message', 'details', 'kind', 'type', 'requestType', 'projectTitle', 'description', 'expectedOutput', 'deadline', 'budget', 'quotationConsent', 'colour', 'quantity', 'size', 'material', 'finish', 'instructions', 'agreement', 'topic', 'city', 'company', 'orderSize', 'timeline', 'people', 'neededBy', 'notes', 'photoPermission', 'colourCode', 'height', 'customHeight', 'quantity', 'materialPreference', 'finishPreference', 'referenceUrl', 'style']);
async function createEnquiry(req, res) {
  const raw = req.body || {};
  const values = {};
  for (const [key, value] of Object.entries(raw)) if (enquiryFields.has(key)) values[key] = value;
  const type = String(values.type || values.kind || values.requestType || req.path.split('/').pop() || 'contact').slice(0, 80);
  values.type = type;
  values.kind = values.kind || type;
  if (!String(values.name || '').trim() || !String(values.email || '').trim()) throw httpError(400, 'Name and email are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email))) throw httpError(400, 'Enter a valid email address.');
  let attachments = [];
  if (Array.isArray(req.files) && req.files.length) {
    if (!cloudinaryConfigured) {
      await cleanTempUploads(req.files);
      throw httpError(503, 'File submissions are not enabled yet. Configure Cloudinary on the backend to store uploaded files securely.');
    }
    try {
      attachments = await Promise.all(req.files.map(async (file) => {
        const uploaded = await uploadBuffer(file, 'projenius-3d/requests');
        return { url: uploaded.secure_url, publicId: uploaded.public_id, name: path.basename(file.originalname || 'attachment'), size: file.size, contentType: file.mimetype };
      }));
    } catch (error) {
      console.error('Inquiry attachment upload failed:', error.message);
      throw httpError(502, 'We could not store the attached file. Please try again or submit without attachments.');
    } finally {
      await cleanTempUploads(req.files);
    }
  }
  const enquiry = await Enquiry.create({ ...values, attachments, status: 'new' });
  await notify('New customer request', `${values.name} submitted a ${type} request.`, 'enquiry', String(enquiry._id));
  const detailText = String(values.details || values.description || values.message || 'A new customer request was submitted.');
  try {
    await sendEmail(process.env.ADMIN_NOTIFICATION_EMAIL, `New ProJenius 3D request: ${type}`, `${values.name}\n${values.email}\n${values.phone || ''}\n\n${detailText}\n\nFiles: ${attachments.map((file) => file.url).join('\n')}`);
    await sendEmail(values.email, 'We received your ProJenius 3D request', 'Thank you for contacting ProJenius 3D. Your request has been received and will be reviewed by our team.');
  } catch (error) { console.error('Request email failed:', error.message); }
  res.status(201).json({ data: enquiry, message: 'Your request was saved successfully.', fileStorage: attachments.length ? 'cloudinary' : 'none' });
}
for (const route of ['/api/enquiries', '/api/inquiries', '/api/custom-printing', '/api/design-services', '/api/figurine-requests']) {
  app.post(route, publicWriteLimit, inquiryUpload.any(), asyncHandler(createEnquiry));
}
app.get(['/api/enquiries', '/api/inquiries'], adminAuth, asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.type) filter.type = String(req.query.type);
  const data = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 300, 300)).lean();
  res.json({ data, items: data, total: data.length });
}));
app.patch(['/api/enquiries/:id', '/api/inquiries/:id'], adminAuth, asyncHandler(async (req, res) => {
  const item = await Enquiry.findByIdAndUpdate(req.params.id, { $set: cleanObject(req.body) }, { new: true, runValidators: true });
  if (!item) throw httpError(404, 'Request not found.');
  res.json({ data: item });
}));
app.delete(['/api/enquiries/:id', '/api/inquiries/:id'], adminAuth, asyncHandler(async (req, res) => {
  const item = await Enquiry.findByIdAndDelete(req.params.id);
  if (!item) throw httpError(404, 'Request not found.');
  res.json({ message: 'Request deleted.' });
}));

async function findValidCoupon(code, subtotal) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return { coupon: null, discount: 0 };
  if (!normalizedCode || normalizedCode.length > 64) throw httpError(400, 'Enter a valid coupon code.');
  const escaped = normalizedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const coupon = await ManagedResource.findOne({ resourceType: 'coupon', code: { $regex: `^${escaped}$`, $options: 'i' }, active: true }).lean();
  if (!coupon) throw httpError(400, 'This coupon is invalid or inactive.');
  const now = Date.now();
  if (coupon.validFrom && new Date(coupon.validFrom).getTime() > now) throw httpError(400, 'This coupon is not active yet.');
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now) throw httpError(400, 'This coupon has expired.');
  if (Number(coupon.usageLimit) > 0 && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)) throw httpError(400, 'This coupon has reached its usage limit.');
  const value = Number(coupon.discountValue);
  if (!Number.isFinite(value) || value <= 0) throw httpError(400, 'This coupon has an invalid discount configuration.');
  const discountType = String(coupon.discountType || '').toLowerCase();
  if (!['percent', 'fixed'].includes(discountType)) throw httpError(400, 'This coupon has an invalid discount type.');
  let discount = discountType === 'percent' ? Math.round(Number(subtotal || 0) * Math.min(value, 100) / 100) : Math.round(value);
  discount = Math.min(Math.max(0, Number(subtotal || 0)), Math.max(0, discount));
  return { coupon, discount };
}
app.post('/api/coupons/validate', publicWriteLimit, asyncHandler(async (req, res) => {
  const subtotal = Number(req.body?.subtotal);
  if (!String(req.body?.code || '').trim()) throw httpError(400, 'Enter a coupon code.');
  if (!Number.isFinite(subtotal) || subtotal <= 0) throw httpError(400, 'Add products to your cart before applying a coupon.');
  const result = await findValidCoupon(req.body?.code, subtotal);
  res.json({ data: { code: result.coupon.code, discountType: result.coupon.discountType, discountValue: Number(result.coupon.discountValue), discountAmount: result.discount }, message: 'Coupon applied.' });
}));

app.post('/api/orders', publicWriteLimit, asyncHandler(async (req, res) => {
  const { customer, items, paymentMethod = 'cod', deliveryMethod = 'standard', couponCode = '' } = req.body || {};
  if (!customer?.name || !customer?.email || !Array.isArray(items) || !items.length) {
    throw httpError(400, 'Customer name, email and at least one cart item are required.');
  }
  const customerName = String(customer.name).trim().slice(0, 160);
  const customerEmail = String(customer.email).trim().toLowerCase();
  if (!customerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw httpError(400, 'Enter a valid customer name and email address.');
  }
  if (items.length > 50) throw httpError(400, 'An order cannot contain more than 50 line items.');

  const requested = items.map((item) => ({
    id: String(item.productId || item._id || ''),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1))),
    personalization: String(item.personalization || '').trim().slice(0, 500),
  }));
  if (requested.some((item) => !mongoose.isValidObjectId(item.id))) {
    throw httpError(400, 'One or more cart items are invalid. Please refresh the shop and try again.');
  }

  const ids = [...new Set(requested.map((item) => item.id))];
  const dbProducts = await Product.find({ _id: { $in: ids }, status: 'published' }).lean();
  const productsById = new Map(dbProducts.map((product) => [String(product._id), product]));
  const quantityByProduct = new Map();
  for (const item of requested) {
    const product = productsById.get(item.id);
    if (!product) throw httpError(409, 'A product in your cart is no longer available. Please refresh your cart.');
    quantityByProduct.set(item.id, (quantityByProduct.get(item.id) || 0) + item.quantity);
  }
  for (const [id, quantity] of quantityByProduct) {
    const product = productsById.get(id);
    if (!product.madeToOrder && Number(product.stock || 0) < quantity) {
      throw httpError(409, `${product.name} does not have enough available stock. Please reduce the quantity or contact the studio.`);
    }
  }

  const normalized = requested.map((item) => {
    const product = productsById.get(item.id);
    const price = Number(product.salePrice ?? product.price);
    return {
      productId: product._id,
      name: product.name,
      price,
      quantity: item.quantity,
      personalization: item.personalization,
      madeToOrder: Boolean(product.madeToOrder),
      imageUrl: product.imageUrl || product.images?.[0]?.url || '',
      lineTotal: price * item.quantity,
    };
  });
  const subtotal = normalized.reduce((sum, item) => sum + item.lineTotal, 0);
  const couponResult = couponCode ? await findValidCoupon(couponCode, subtotal) : { coupon: null, discount: 0 };
  const couponDiscount = couponResult.discount;
  const settings = await Setting.findOne({ key: 'store' }).lean();
  const freeThreshold = Number(settings?.value?.shippingThreshold ?? 999);
  const safeDelivery = ['standard', 'express', 'pickup'].includes(String(deliveryMethod)) ? String(deliveryMethod) : 'standard';
  const shipping = safeDelivery === 'pickup' ? 0 : safeDelivery === 'express' ? 179 : (subtotal >= freeThreshold ? 0 : 79);
  const safePayment = ['cod', 'upi', 'card', 'bank'].includes(String(paymentMethod)) ? String(paymentMethod) : 'cod';

  // Reserve physical stock atomically to avoid two simultaneous checkouts overselling the same item.
  // If any later operation fails, release the stock reservations and coupon counter.
  const reserved = [];
  let couponConsumed = false;
  let order;
  try {
    for (const [id, quantity] of quantityByProduct) {
      const product = productsById.get(id);
      if (product.madeToOrder) continue;
      const updated = await Product.findOneAndUpdate(
        { _id: id, status: 'published', stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true },
      );
      if (!updated) throw httpError(409, `${product.name} is no longer available in the requested quantity.`);
      reserved.push({ id, quantity });
    }

    if (couponResult.coupon) {
      const now = new Date();
      const couponFilter = {
        _id: couponResult.coupon._id,
        resourceType: 'coupon',
        active: true,
        $and: [
          { $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: now } }] },
          { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: now } }] },
          { $or: [
            { usageLimit: { $exists: false } }, { usageLimit: null }, { usageLimit: { $lte: 0 } },
            { $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$usageLimit'] } },
          ] },
        ],
      };
      const consumed = await ManagedResource.findOneAndUpdate(couponFilter, { $inc: { usedCount: 1 } }, { new: true });
      if (!consumed) throw httpError(409, 'This coupon is no longer available. Remove it and try again.');
      couponConsumed = true;
    }

    order = await Order.create({
      orderNumber: `PJ-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: String(customer.phone || '').trim().slice(0, 50),
        address: String(customer.address || '').trim().slice(0, 700),
        city: String(customer.city || '').trim().slice(0, 100),
        state: String(customer.state || '').trim().slice(0, 100),
        pin: String(customer.pin || '').trim().slice(0, 20),
      },
      items: normalized,
      subtotal,
      shipping,
      total: Math.max(0, subtotal - couponDiscount + shipping),
      couponCode: couponResult.coupon?.code || '',
      discount: couponDiscount,
      paymentMethod: safePayment,
      deliveryMethod: safeDelivery,
      status: 'pending',
      paymentStatus: safePayment === 'cod' ? 'pay_on_delivery' : 'pending',
    });
  } catch (error) {
    for (const item of reserved.reverse()) {
      try { await Product.updateOne({ _id: item.id }, { $inc: { stock: item.quantity } }); }
      catch (rollbackError) { console.error('Stock rollback failed:', rollbackError.message); }
    }
    if (couponConsumed && couponResult.coupon) {
      try { await ManagedResource.updateOne({ _id: couponResult.coupon._id, resourceType: 'coupon', usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }); }
      catch (rollbackError) { console.error('Coupon rollback failed:', rollbackError.message); }
    }
    throw error;
  }

  try {
    await Customer.findOneAndUpdate(
      { email: customerEmail },
      { $set: { name: customerName, phone: String(customer.phone || '').trim().slice(0, 50) }, $setOnInsert: { email: customerEmail }, $inc: { orderCount: 1, totalSpent: order.total } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
  } catch (error) { console.error('Customer summary update failed:', error.message); }
  await notify('New order received', `Order ${order.orderNumber} from ${customerName} totals ₹${order.total}.`, 'order', String(order._id));
  const text = `Order ${order.orderNumber}\nCustomer: ${customerName}\nEmail: ${customerEmail}\nTotal: ₹${order.total}\nPayment status: ${order.paymentStatus}\n\n${normalized.map((item) => `${item.name} x ${item.quantity}: ₹${item.lineTotal}`).join('\n')}`;
  const mails = await Promise.allSettled([
    sendEmail(customerEmail, 'Your ProJenius 3D order confirmation', text),
    sendEmail(process.env.ADMIN_NOTIFICATION_EMAIL, 'New ProJenius 3D order', text),
  ]);
  res.status(201).json({ data: order, message: 'Order saved. Online payment is not processed unless a payment provider is configured.', mailSent: mails.map((result) => result.status === 'fulfilled' && result.value.sent) });
}));
app.get('/api/orders', adminAuth, asyncHandler(async (req, res) => {
  const filter = {}; if (req.query.status) filter.status = String(req.query.status);
  const data = await Order.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 300, 300)).lean();
  res.json({ data, items: data, total: data.length });
}));
app.get('/api/orders/:id', adminAuth, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, 'Invalid order ID.');
  const data = await Order.findById(req.params.id).lean(); if (!data) throw httpError(404, 'Order not found.'); res.json({ data });
}));
async function updateOrder(req, res) {
  const body = cleanObject(req.body);
  const allowedStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
  if (body.status && !allowedStatuses.includes(body.status)) throw httpError(400, 'Invalid order status.');
  const existing = await Order.findById(req.params.id);
  if (!existing) throw httpError(404, 'Order not found.');
  const nextStatus = body.status || existing.status;
  if (body.status && body.status !== existing.status && !(transitions[existing.status] || []).includes(body.status)) {
    throw httpError(409, `Order status cannot move from ${existing.status} to ${body.status}.`);
  }
  // Compare-and-set the status we just read so concurrent admin updates cannot
  // double-run cancellation side effects (stock/coupon restoration).
  const orderFilter = existing.status === undefined
    ? { _id: req.params.id, $or: [{ status: { $exists: false } }, { status: null }] }
    : { _id: req.params.id, status: existing.status };
  const item = await Order.findOneAndUpdate(orderFilter, { $set: body }, { new: true, runValidators: true });
  if (!item) throw httpError(409, 'This order was updated by another request. Refresh the order and try again.');
  if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
    for (const line of existing.items || []) {
      if (line.madeToOrder || !line.productId) continue;
      try { await Product.updateOne({ _id: line.productId }, { $inc: { stock: Math.max(0, Number(line.quantity) || 0) } }); }
      catch (error) { console.error('Cancelled-order stock restore failed:', error.message); }
    }
    if (existing.couponCode) {
      try { await ManagedResource.updateOne({ resourceType: 'coupon', code: existing.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }); }
      catch (error) { console.error('Cancelled-order coupon release failed:', error.message); }
    }
    try {
      const email = String(existing.customer?.email || '').toLowerCase();
      if (email) {
        const [orderCount, totalRows] = await Promise.all([
          Order.countDocuments({ 'customer.email': email, status: { $ne: 'cancelled' } }),
          Order.aggregate([
            { $match: { 'customer.email': email, status: { $ne: 'cancelled' } } },
            { $group: { _id: null, total: { $sum: '$total' } } },
          ]),
        ]);
        await Customer.updateOne({ email }, { $set: { orderCount, totalSpent: Number(totalRows[0]?.total || 0) } });
      }
    } catch (error) { console.error('Cancelled-order customer summary update failed:', error.message); }
  }
  res.json({ data: item });
}
app.patch('/api/orders/:id', adminAuth, asyncHandler(updateOrder));
app.patch('/api/orders/:id/status', adminAuth, asyncHandler(updateOrder));

app.get('/api/notifications', adminAuth, asyncHandler(async (_req, res) => {
  const data = await Notification.find().sort({ createdAt: -1 }).limit(100).lean(); res.json({ data, items: data, unread: data.filter((item) => !item.read).length });
}));
app.patch('/api/notifications/:id/read', adminAuth, asyncHandler(async (req, res) => {
  const item = await Notification.findByIdAndUpdate(req.params.id, { $set: { read: true } }, { new: true }); if (!item) throw httpError(404, 'Notification not found.'); res.json({ data: item });
}));
app.patch('/api/notifications/read-all', adminAuth, asyncHandler(async (_req, res) => { await Notification.updateMany({ read: false }, { $set: { read: true } }); res.json({ message: 'Notifications marked read.' }); }));

// Store settings use one durable MongoDB document but are exposed to the admin UI as a single editable record.
app.get('/api/settings', adminAuth, asyncHandler(async (_req, res) => {
  const stored = await Setting.findOne({ key: 'store' }).lean();
  const row = { _id: 'store', ...(stored?.value || {}) };
  res.json({ data: [row], items: [row], total: 1 });
}));
async function updateSettings(req, res) {
  const value = cleanObject(req.body);
  const stored = await Setting.findOneAndUpdate({ key: 'store' }, { $set: { value } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const row = { _id: 'store', ...(stored.value || {}) };
  res.json({ data: row });
}
app.post('/api/settings', adminAuth, asyncHandler(updateSettings));
app.put('/api/settings', adminAuth, asyncHandler(updateSettings));
app.patch('/api/settings/:id', adminAuth, asyncHandler(updateSettings));
app.delete('/api/settings/:id', adminAuth, asyncHandler(async (_req, res) => { await Setting.deleteOne({ key: 'store' }); res.json({ message: 'Store settings cleared.' }); }));
app.get('/api/settings/public', asyncHandler(async (_req, res) => { const item = await Setting.findOne({ key: 'store' }).lean(); const source = item?.value || {}; const publicKeys = ['businessName', 'contactEmail', 'phone', 'whatsapp', 'address', 'announcement', 'shippingThreshold', 'currency']; const data = Object.fromEntries(publicKeys.filter((key) => source[key] !== undefined && source[key] !== null).map((key) => [key, source[key]])); res.json({ data }); }));

app.get('/api/customers', adminAuth, asyncHandler(async (_req, res) => { const data = await Customer.find().sort({ totalSpent: -1, createdAt: -1 }).limit(300).lean(); res.json({ data, items: data, total: data.length }); }));
app.get('/api/admin/customers', adminAuth, asyncHandler(async (_req, res) => { const data = await Customer.find().sort({ totalSpent: -1, createdAt: -1 }).limit(300).lean(); res.json({ data, items: data, total: data.length }); }));
app.post('/api/admin/customers', adminAuth, asyncHandler(async (req, res) => { const body = cleanObject(req.body); if (!body.name || !body.email) throw httpError(400, 'Customer name and email are required.'); const row = await Customer.findOneAndUpdate({ email: String(body.email).toLowerCase() }, { $set: body }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }); res.status(201).json({ data: row }); }));
app.patch('/api/admin/customers/:id', adminAuth, asyncHandler(async (req, res) => { const row = await Customer.findByIdAndUpdate(req.params.id, { $set: cleanObject(req.body) }, { new: true, runValidators: true }); if (!row) throw httpError(404, 'Customer not found.'); res.json({ data: row }); }));
app.delete('/api/admin/customers/:id', adminAuth, asyncHandler(async (req, res) => { const row = await Customer.findByIdAndDelete(req.params.id); if (!row) throw httpError(404, 'Customer not found.'); res.json({ message: 'Customer deleted.' }); }));

// Generic, persisted admin-managed records (FAQ, material, inventory, production, homepage content, reviews and coupons).
function registerManagedResource(routePath, resourceType, options = {}) {
  app.get(routePath, options.auth === false ? optionalAdmin : adminAuth, asyncHandler(async (req, res) => {
    const filter = { resourceType };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.search) filter.$or = ['name', 'title', 'question', 'email', 'code', 'sku'].map((key) => ({ [key]: { $regex: String(req.query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
    const data = await ManagedResource.find(filter).sort({ sortOrder: 1, createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 300, 300)).lean();
    res.json({ data, items: data, total: data.length });
  }));
  app.post(routePath, adminAuth, asyncHandler(async (req, res) => {
    const body = cleanObject(req.body);
    const row = await ManagedResource.create({ resourceType, ...body });
    res.status(201).json({ data: row });
  }));
  app.patch(`${routePath}/:id`, adminAuth, asyncHandler(async (req, res) => {
    const row = await ManagedResource.findOneAndUpdate({ _id: req.params.id, resourceType }, { $set: cleanObject(req.body) }, { new: true, runValidators: true });
    if (!row) throw httpError(404, 'Record not found.'); res.json({ data: row });
  }));
  app.put(`${routePath}/:id`, adminAuth, asyncHandler(async (req, res) => {
    const row = await ManagedResource.findOneAndUpdate({ _id: req.params.id, resourceType }, { $set: cleanObject(req.body) }, { new: true, runValidators: true });
    if (!row) throw httpError(404, 'Record not found.'); res.json({ data: row });
  }));
  app.delete(`${routePath}/:id`, adminAuth, asyncHandler(async (req, res) => {
    const row = await ManagedResource.findOneAndDelete({ _id: req.params.id, resourceType });
    if (!row) throw httpError(404, 'Record not found.'); res.json({ message: 'Record deleted.' });
  }));
}
registerManagedResource('/api/homepage', 'homepage');
app.get('/api/homepage/public', asyncHandler(async (_req, res) => {
  const row = await ManagedResource.findOne({
    resourceType: 'homepage',
    $or: [{ published: true }, { status: 'published' }],
  }).sort({ updatedAt: -1, createdAt: -1 }).lean();
  if (!row) return res.json({ data: null });
  const keys = ['heroTitle', 'heroSubtitle', 'heroImage', 'primaryButtonLabel', 'primaryButtonUrl'];
  const data = Object.fromEntries(keys.filter((key) => row[key] !== undefined && row[key] !== null).map((key) => [key, row[key]]));
  return res.json({ data });
}));
registerManagedResource('/api/faqs', 'faq');
registerManagedResource('/api/production', 'production');
registerManagedResource('/api/inventory', 'inventory');
registerManagedResource('/api/materials', 'material');
registerManagedResource('/api/admin/reviews', 'review');
registerManagedResource('/api/admin/coupons', 'coupon');
app.get('/api/faqs/public', asyncHandler(async (_req, res) => {
  const rows = await ManagedResource.find({ resourceType: 'faq', $or: [{ published: true }, { status: 'published' }] }).sort({ sortOrder: 1, createdAt: 1 }).limit(50).lean();
  const data = rows.map((row) => ({ _id: row._id, question: row.question, answer: row.answer, sortOrder: row.sortOrder, createdAt: row.createdAt }));
  res.json({ data, items: data, total: data.length });
}));
app.get('/api/reviews', asyncHandler(async (_req, res) => {
  const rows = await ManagedResource.find({ resourceType: 'review', $or: [{ status: 'published' }, { status: 'approved' }, { published: true }] }).sort({ createdAt: -1 }).limit(12).lean();
  const keys = ['_id', 'customerName', 'rating', 'body', 'text', 'review', 'productName', 'product', 'service', 'createdAt'];
  const data = rows.map((row) => Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])));
  res.json({ data, items: data, total: data.length });
}));
app.get('/api/quotes', adminAuth, asyncHandler(async (req, res) => {
  const filter = { type: { $in: ['quote', 'custom-printing', 'design-services', 'design', 'bulk-order', 'photo-to-3d', '3D design and prototyping', 'print-my-file'] } };
  if (req.query.status) filter.status = String(req.query.status);
  const data = await Enquiry.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 300, 300)).lean();
  res.json({ data, items: data, total: data.length });
}));
app.post('/api/quotes', adminAuth, asyncHandler(async (req, res) => {
  const body = cleanObject(req.body); const row = await Enquiry.create({ ...body, type: 'quote', kind: 'quote', status: body.status || 'pending' }); res.status(201).json({ data: row });
}));
app.patch('/api/quotes/:id', adminAuth, asyncHandler(async (req, res) => { const row = await Enquiry.findByIdAndUpdate(req.params.id, { $set: cleanObject(req.body) }, { new: true }); if (!row) throw httpError(404, 'Quote not found.'); res.json({ data: row }); }));
app.delete('/api/quotes/:id', adminAuth, asyncHandler(async (req, res) => { const row = await Enquiry.findByIdAndDelete(req.params.id); if (!row) throw httpError(404, 'Quote not found.'); res.json({ message: 'Quote deleted.' }); }));

app.get('/api/reports', adminAuth, asyncHandler(async (_req, res) => {
  const [orders, products, enquiries, revenueAgg, paidOrders] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).limit(1000).lean(), Product.countDocuments(), Enquiry.countDocuments(),
    Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]), Order.countDocuments({ paymentStatus: 'paid' }),
  ]);
  const revenue = Number(revenueAgg[0]?.total || 0);
  res.json({ data: { orders, ordersCount: orders.length, products, enquiries, revenue, paidOrders, averageOrderValue: orders.length ? revenue / orders.length : 0 } });
}));
app.get('/api/dashboard', adminAuth, asyncHandler(async (_req, res) => {
  const [recentOrders, products, published, lowStock, orders, pending, newInquiries, inquiries, unreadNotifications, completed, revenueAgg] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).limit(5).lean(),
    Product.countDocuments(),
    Product.countDocuments({ status: 'published' }),
    Product.countDocuments({ status: 'published', stock: { $lte: 5 } }),
    Order.countDocuments(),
    Order.countDocuments({ status: 'pending' }),
    Enquiry.countDocuments({ status: { $in: ['new', 'pending'] } }),
    Enquiry.countDocuments(),
    Notification.countDocuments({ read: false }),
    Order.countDocuments({ status: 'delivered' }),
    Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
  ]);
  const revenue = Number(revenueAgg[0]?.total || 0);
  res.json({ data: { recentOrders, products, published, lowStock, orders, pending, newInquiries, inquiries, enquiries: newInquiries, notifications: unreadNotifications, completed, revenue } });
}));

app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.path} was not found.` }));
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'A file exceeds the upload size limit.' : 'The upload exceeded the allowed file count or size.' });
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('API request failed:', err.message);
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error. Check the backend logs.' : err.message || 'Internal server error.';
  res.status(status).json({ message });
});

const port = Number(process.env.PORT || DEFAULT_PORT);
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri || !/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
  console.error('MONGODB_URI is missing or invalid. Copy the full MongoDB Atlas driver URI into the backend environment.');
  process.exit(1);
}
mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 })
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`${SERVICE_NAME} listening on port ${port}; MongoDB connected.`)))
  .catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
