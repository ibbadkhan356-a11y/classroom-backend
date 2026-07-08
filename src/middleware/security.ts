import { ArcjetNodeRequest, slidingWindow } from '@arcjet/node';
import { isMissingUserAgent } from '@arcjet/inspect';
import aj from '../config/arcjet.js'
import type { Request, Response, NextFunction } from "express"

type RateLimitRole = 'admin' | 'teacher' | 'student' | 'guest';

const securityMiddleware =
  async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') return next();

    try {
      const role: RateLimitRole = (req.user?.role as RateLimitRole) ?? 'guest';

      let limit: number;
      let message: string;

      switch (role) {
        case 'admin':
          limit = 100;
          message = 'Admin request limit exceeded (100 per minute). Slow down'
          break;

        case 'teacher':
          limit = 50;
          message = 'Teacher request limit exceeded (50 per minute). Please wait'
          break;

        case 'student':
          limit = 25;
          message = 'Student request limit exceeded (25 per minute). Please wait'
          break;

        default:
          limit = 5;
          message = 'Guest request limit exceeded (5 per minute). please sign up for higher limit'
          break;
      }

      const client = aj.withRule(
        slidingWindow({
          mode: 'LIVE',
          interval: '1m',
          max: limit,
        })
      )

      const arcjetRequest: ArcjetNodeRequest = {
        headers: req.headers,
        method: req.method,
        url: req.originalUrl ?? req.url,
        socket: { remoteAddress: req.ip ?? req.socket.remoteAddress ?? '0.0.0.0' },
      }

      const decision = await client.protect(arcjetRequest);

      if (
        decision.results.some(isMissingUserAgent) ||
        (decision.isDenied() && decision.reason.isBot())
      ) {
        return res.status(403).json({ error: 'Forbidden', message: 'Automated requests are not allowed. ' });

      }

      if (decision.isDenied() && decision.reason.isShield()) {
        return res.status(403).json({ error: 'Forbidden', message: 'Request blocked by security policy. ' });

      }

      if (decision.isDenied() && decision.reason.isRateLimit()) {
        return res.status(429).json({ error: 'Too many requests', message });

      }

      next();
    } catch (e) {
      console.error('Arcjet middleware error: ', e);
      res.status(500).json({

        error: 'internal error',
        message: 'something went wrong with security middleware'

      });
    }

  }

export default securityMiddleware;