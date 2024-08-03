const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const puppeteer = require('puppeteer');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const path = require('path');  // Import the path module

const app = express();
const port = 3002;

// Init upload in memory
const storage = multer.memoryStorage();
const upload = multer({ storage }).single('file');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Function to extract product details using Puppeteer with concurrency and optimized settings
async function getProductDetails(url, retries = 1) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const productDetails = await page.evaluate((url) => {
            const priceElement = document.querySelector('#priceblock_ourprice') ||
                document.querySelector('#priceblock_dealprice') ||
                document.querySelector('.a-price .a-offscreen') ||
                document.querySelector('.priceToPay .a-offscreen');
            const titleElement = document.querySelector('#productTitle') ||
                document.querySelector('.product-title-word-break') ||
                document.querySelector('h1#title');
            const imageElement = document.querySelector('#landingImage') ||
                document.querySelector('#imgTagWrapperId img') ||
                document.querySelector('.imgTagWrapper img') ||
                document.querySelector('#img-canvas img') ||
                document.querySelector('#main-image-container img');

            const price = priceElement ? priceElement.innerText : null;
            const title = titleElement ? titleElement.innerText.trim() : null;
            const image = imageElement ? imageElement.src : null;

            return { price, title, image, url };
        }, url);

        await browser.close();
        return productDetails;
    } catch (error) {
        await browser.close();
        if (retries > 0) {
            console.log(`Retrying... (${retries} attempts left)`);
            return getProductDetails(url, retries - 1);
        } else {
            console.error('Error fetching product details:', error);
            return { error: 'Failed to fetch details' };
        }
    }
}

// Normalize keys to lowercase to handle case-insensitivity
function normalizeKeys(obj) {
    const normalized = {};
    Object.keys(obj).forEach(key => {
        normalized[key.toLowerCase()] = obj[key];
    });
    return normalized;
}

// Route for uploading Excel file and processing data
app.post('/upload', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('File upload failed:', err);
            res.status(500).send('File upload failed');
            return;
        }

        try {
            const buffer = req.file.buffer;
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const sheet_name_list = workbook.SheetNames;
            const sheet = workbook.Sheets[sheet_name_list[0]];
            const data = xlsx.utils.sheet_to_json(sheet);

            console.log('Data from Excel:', data);

            const results = await Promise.all(data.map(async product => {
                const normalizedProduct = normalizeKeys(product);
                const url = normalizedProduct['link'];
                if (!url) {
                    console.error('Invalid URL:', url);
                    return { error: 'Invalid URL', url };
                }
                console.log('Fetching details for URL:', url);
                return getProductDetails(url);
            }));

            console.log('Results:', results);

            global.productResults = results;

            res.redirect('/results');
        } catch (error) {
            console.error('Scraping failed:', error);
            res.status(500).send('Scraping failed');
        }
    });
});

// Nodemailer configuration
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'your-email@gmail.com', // Replace with your email
        pass: 'your-email-password' // Replace with your email password
    }
});

// Route to serve results page
app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

// API to get product results
app.get('/api/results', (req, res) => {
    res.json(global.productResults || []);
});

// API to get past sales data
app.get('/api/past-sales', (req, res) => {
    // Sample past sales data
    const pastSalesData = [
        { date: '2024-01-01', sales: 150, profit: 50 },
        { date: '2024-02-01', sales: 200, profit: 70 },
        // Add more data as needed
    ];
    res.json(pastSalesData);
});

// API to subscribe to notifications
app.post('/api/subscribe', (req, res) => {
    const { email, url } = req.body;
    
    const mailOptions = {
        from: 'your-email@gmail.com', // Replace with your email
        to: email,
        subject: 'Subscription Confirmation',
        text: 'You will receive notifications regarding any price drops or price gains.'
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error sending email:', error);
            res.status(500).send('Subscription failed');
        } else {
            console.log('Email sent:', info.response);
            res.status(200).send('Subscription successful');
        }
    });
});

// Catch all other routes and return the static HTML file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
