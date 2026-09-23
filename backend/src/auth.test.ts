import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { initSchema } from './db.js';

interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

interface SessionBody {
  token: string;
  user: SessionUser;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

beforeAll(() => {
  initSchema();
});

describe('customer authentication', () => {
  it('signs up a new customer and returns a token', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      email: uniqueEmail('signup'),
      password: 'Password123',
      fullName: 'Test Customer',
    });
    expect(res.status).toBe(201);
    const body = res.body as SessionBody;
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toContain('@example.com');
    expect(body.user.role).toBe('CUSTOMER');
  });

  it('rejects duplicate signup with 409', async () => {
    const email = uniqueEmail('duplicate');
    const first = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', fullName: 'First Try' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', fullName: 'Second Try' });
    expect(second.status).toBe(409);
    expect((second.body as { code: string }).code).toBe('EMAIL_EXISTS');
  });

  it('logs in with valid credentials and serves the profile', async () => {
    const email = uniqueEmail('login');
    const signup = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', fullName: 'Login User' });
    expect(signup.status).toBe(201);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' });
    expect(login.status).toBe(200);
    const session = login.body as SessionBody;
    expect(typeof session.token).toBe('string');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${session.token}`);
    expect(me.status).toBe(200);
    expect((me.body as { user: SessionUser }).user.email).toBe(email.toLowerCase());
  });

  it('rejects login with a wrong password', async () => {
    const email = uniqueEmail('wrongpass');
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', fullName: 'Wrong Pass' });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'NotThePassword' });
    expect(login.status).toBe(401);
  });

  it('rejects unauthenticated profile access with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('supports the forgot and reset password flow', async () => {
    const email = uniqueEmail('reset');
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', fullName: 'Reset User' });

    const forgot = await request(app).post('/api/v1/auth/forgot').send({ email });
    expect(forgot.status).toBe(200);
    const resetToken = (forgot.body as { resetToken?: string }).resetToken;
    expect(typeof resetToken).toBe('string');

    const reset = await request(app)
      .post('/api/v1/auth/reset')
      .send({ token: resetToken ?? '', newPassword: 'NewPassword456' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'NewPassword456' });
    expect(login.status).toBe(200);
  });
});
