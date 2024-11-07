// Actualización en el archivo de servidor Node.js

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');


const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

let { paquetes, clientes, plantillas, reservas = [] } = require('./DATA');

const wait = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const startPuppetteer = async () => {
    return await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process' // Agregar esto puede ayudar en entornos limitados
        ]
    });
};

let browser;
const boot = async () => {
    browser = await startPuppetteer();
};

boot();

// Ruta para obtener todos los paquetes
app.get('/paquetes', (req, res) => {
    res.json(paquetes);
});

// Ruta para obtener un paquete por ID
app.get('/paquetes/:id', (req, res) => {
    const { id } = req.params;
    const paquete = paquetes.find((p) => p.id === id);
    res.json(paquete);
});

// Ruta para agregar un nuevo paquete
app.post('/paquetes', (req, res) => {
    const nuevoPaquete = req.body;
    nuevoPaquete.id = `paquete_${Date.now()}`; // Genera un ID único

    paquetes.push(nuevoPaquete);

    fs.writeFile(
        path.join(__dirname, 'DATA.js'),
        `module.exports = { paquetes: ${JSON.stringify(paquetes, null, 2)} };`,
        (err) => {
            if (err) {
                console.error('Error al guardar el paquete:', err);
                res.status(500).json({ message: 'Error al guardar el paquete' });
            } else {
                res.status(201).json(nuevoPaquete);
            }
        }
    );
});

// Ruta para actualizar un paquete existente
app.put('/paquetes/:id', (req, res) => {
    const { id } = req.params;
    const paqueteActualizado = req.body;

    const index = paquetes.findIndex(paquete => paquete.id === id);

    if (index === -1) {
        return res.status(404).json({ message: 'Paquete no encontrado' });
    }

    paquetes[index] = { ...paquetes[index], ...paqueteActualizado };

    fs.writeFile(
        path.join(__dirname, 'DATA.js'),
        `module.exports = { paquetes: ${JSON.stringify(paquetes, null, 2)} };`,
        (err) => {
            if (err) {
                console.error('Error al actualizar el paquete:', err);
                res.status(500).json({ message: 'Error al actualizar el paquete' });
            } else {
                res.json(paquetes[index]);
            }
        }
    );
});


/// PLANTILLAS
app.get('/plantillas', (req, res) => {
    res.json(plantillas);
});


//// CLIENTES

// Obtener todos los clientes
app.get('/clientes', (req, res) => {
    res.json(clientes);
});

// Obtener un cliente por ID
app.get('/clientes/:id', (req, res) => {
    const cliente = clientes.find(c => c.id === req.params.id);
    res.json(cliente || {});
});

// Crear un nuevo cliente
app.post('/clientes', (req, res) => {
    const nuevoCliente = { id: `cliente_${Date.now()}`, ...req.body };
    clientes.push(nuevoCliente);
    fs.writeFile(path.join(__dirname, 'DATA.js'), `module.exports = { clientes: ${JSON.stringify(clientes, null, 2)} };`, (err) => {
        if (err) {
            console.error('Error al guardar el cliente:', err);
            res.status(500).json({ message: 'Error al guardar el cliente' });
        } else {
            res.status(201).json(nuevoCliente);
        }
    });
});

// Actualizar un cliente existente
app.put('/clientes/:id', (req, res) => {
    const index = clientes.findIndex(c => c.id === req.params.id);
    if (index !== -1) {
        clientes[index] = { ...clientes[index], ...req.body };
        fs.writeFile(path.join(__dirname, 'DATA.js'), `module.exports = { clientes: ${JSON.stringify(clientes, null, 2)} };`, (err) => {
            if (err) {
                console.error('Error al actualizar el cliente:', err);
                res.status(500).json({ message: 'Error al actualizar el cliente' });
            } else {
                res.json(clientes[index]);
            }
        });
    } else {
        res.status(404).json({ message: 'Cliente no encontrado' });
    }
});

/// RESERVAS
app.post('/reservas', async (req, res) => {
    const reserva = req.body;
    reserva.id = md5(Date.now().toString()); // Genera un ID único en MD5
    reservas.push(reserva);

    // Genera el PDF de la reserva
    // const pdfPath = path.join(__dirname, `./reservas/${reserva.id}.pdf`);
    const response = await createPDF(reserva.id);
    if (response.status !== '200') {
        console.error('Error al generar el PDF:', response.error);
        return res.status(500).json({ message: 'Error al generar el PDF' });
    }

    const path = response.file;
    // Guarda la reserva en DATA.js
    saveReserva(reserva);

    // Envía el correo electrónico
    sendEmail(reserva, path, (err) => {
        if (err) {
            console.error('Error al enviar el correo:', err);
            return res.status(500).json({ message: 'Error al enviar el correo' });
        }

        res.status(201).json({ message: 'Reserva creada y correo enviado', reserva });
    });
});


async function createPDF(packageId) {
    if (!browser) return { status: '500', error: 'No se ha iniciado el navegador' };

    try {
        const url = `http://localhost:8080/reserva/${packageId}`;

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 0
        });

        const hasImg = await page.$('img');
        if (hasImg) {
            await wait(3000); // Tiempo de espera si hay imágenes
        }

        // Ruta donde se guardará el PDF
        const pdfPath = path.resolve('reservas', `tour_${packageId}.pdf`);
        await page.pdf({ path: pdfPath, format: 'A3', printBackground: true });

        await page.close();

        // Enviar la ruta del PDF generado
        return { status: '200', file: pdfPath };
    } catch (error) {
        return { status: '500', error: error };
    }
};


// Función para guardar la reserva en DATA.js
function saveReserva(reserva) {
    fs.writeFileSync(
        path.join(__dirname, 'DATA.js'),
        `module.exports = { paquetes: ${JSON.stringify(paquetes, null, 2)}, clientes: ${JSON.stringify(clientes, null, 2)}, plantillas: ${JSON.stringify(plantillas, null, 2)}, reservas: ${JSON.stringify(reservas, null, 2)} };`
    );
}

// Función para enviar el correo electrónico con el PDF adjunto
function sendEmail(reserva, pdfPath, callback) {
    // Configuración del transporte de correo
    const transporter = nodemailer.createTransport({
        host: 'mail.thefuzzytest.com.ar',
        port: 587,
        secure: false,
        auth: {
            user: 'test@thefuzzytest.com.ar', // Usuario de Gmail
            pass: 'Testing2015!'
            // user: 'ottilie.greenfelder66@ethereal.email', // Usuario generado por Ethereal
            // pass: 'G8wSNawF8yzPatzTTQ'  // Contraseña generada por Ethereal
        }
    });

    // Opciones del correo
    const mailOptions = {
        from: 'test@thefuzzytest.com.ar',
        to: reserva.cliente.email,
        subject: 'Propuesta de Reserva a ' + reserva.name,
        html: `
        <p>Hola ${reserva.cliente.name},</p>
        <p>Puedes ver la propuesta de tu reserva aquí: <a href="http://localhost:8080/reserva/${reserva.id}">${reserva.name}</a></p>
        <p>Adjunto encontrarás el PDF con los detalles.</p>
        <p>Saludos!</p>`,
        attachments: [{ filename: 'propuesta.pdf', path: pdfPath }]
    };

    // Envía el correo
    transporter.sendMail(mailOptions, callback);
}

// Ruta para ver el detalle de la reserva (como un ejemplo de cómo se accedería al enlace)
app.get('/reservas/:id', (req, res) => {
    const reserva = reservas.find(r => r.id === req.params.id);
    if (!reserva) {
        return res.status(404).json({ message: 'Reserva no encontrada' });
    }
    res.json(reserva);
});

app.get('/reservas', (req, res) => {
    res.json(reservas);
});

app.get('/buscar', (req, res) => {
    const { q } = req.query; // Recibe el parámetro de búsqueda desde la query string

    if (!q) {
        return res.status(400).json({ message: 'Parámetro de búsqueda (q) es requerido' });
    }

    const result = searchAndHighlight(q);
    res.json(result);
});

// Función de búsqueda y resaltado
function searchAndHighlight(searchString) {
    const lowerSearchString = searchString.toLowerCase();
    const highlightSpan = `<span class="highlight">${searchString}</span>`;

    // Función auxiliar para reemplazar coincidencias en un campo
    function highlightField(field) {
        if (field && typeof field === 'string') {
            const regex = new RegExp(lowerSearchString, 'gi'); // 'gi' para insensible a mayúsculas y global
            return field.replace(regex, highlightSpan);
        }
        return field;
    }

    // Crear copias de los objetos para no modificar el original
    const paquetesResult = paquetes
        .map(paquete => ({
            ...paquete,
            name: highlightField(paquete.name),
            description: highlightField(paquete.description),
            short_description: highlightField(paquete.short_description)
        }))
        .filter(paquete =>
            (paquete.name && paquete.name.toLowerCase().includes(lowerSearchString)) ||
            (paquete.description && paquete.description.toLowerCase().includes(lowerSearchString)) ||
            (paquete.short_description && paquete.short_description.toLowerCase().includes(lowerSearchString))
        );

    const reservasResult = reservas
        .map(reserva => ({
            ...reserva,
            name: highlightField(reserva.name),
            description: highlightField(reserva.description),
            short_description: highlightField(reserva.short_description)
        }))
        .filter(reserva =>
            (reserva.name && reserva.name.toLowerCase().includes(lowerSearchString)) ||
            (reserva.description && reserva.description.toLowerCase().includes(lowerSearchString)) ||
            (reserva.short_description && reserva.short_description.toLowerCase().includes(lowerSearchString))
        );

    return {
        paquetes: paquetesResult,
        reservas: reservasResult
    };
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});