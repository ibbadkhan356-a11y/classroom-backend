import express from 'express';

const app = express();
const PORT = 8000;

app.use(express.json());

app.get('/', (req,res) => {
    res.send('Its the Class Room AP!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);   
});
