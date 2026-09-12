import express from 'express';
const app = express();
const PORT = 8080;

app.get('/', (req, res) => res.send('<h1>DealPulse Server is Running!</h1>'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
