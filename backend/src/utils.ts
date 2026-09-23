import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
}

/** Generate a random unique identifier for database primary keys. */
export function id(): string {
  return crypto.randomUUID();
}

/** Current timestamp as an ISO-8601 UTC string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Sign a short-lived JWT access token for an authenticated user. */
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Verify a JWT access token and return its payload. Throws on invalid tokens. */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string' || decoded.sub === undefined) {
    throw new Error('Invalid token payload');
  }
  return {
    sub: String(decoded.sub),
    email: String(decoded.email ?? ''),
    role: String(decoded.role ?? 'CUSTOMER'),
  };
}

/** Hash a plain-text password with bcrypt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/** Compare a plain-text password against a bcrypt hash. */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash an opaque token (password-reset token) with SHA-256 for storage. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generate a cryptographically random opaque token for password resets. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
