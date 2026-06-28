import express from 'express';
import cors from 'cors';

import  subjectsRouter  from './routes/subjects.js';
import securityMiddleware from './middleware/security.js';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './lib/auth.js';

const app = express();
const PORT = Number(process.env.PORT ?? 8000);
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!FRONTEND_URL) {
 throw new Error("FRONTEND_URL is required");
}

app.use(cors({
  origin: FRONTEND_URL,
  methods:['GET','POST','PUT','DELETE'],
  credentials: true
}))

app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json());

app.use(securityMiddleware)

app.use('/api/subjects', subjectsRouter)

// Base root endpoint
app.get('/', (req, res) => {
  res.send('Hello, welcome to the Classroom API!');
});


app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
