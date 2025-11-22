const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Añadido aquí para borrar foto
const http = require('http'); 
const { Server } = require("socket.io"); 

const User = require('./models/User');
const Match = require('./models/Match'); 
const Message = require('./models/Message'); 
const app = express();

const server = http.createServer(app); 
const io = new Server(server); 

// --- CONFIGURACIÓN DE PUERTO Y DB (CLAVE PARA RENDER) ---
const PORT = process.env.PORT || 3000; 
// Usamos la variable de entorno que configuramos en Render, si no existe, usamos la local
const MONGO_URI_FINAL = process.env.MONGO_URI || "mongodb+srv://juanaugustoroldan7_db_user:12345@cluster0.hxfqesc.mongodb.net/?appName=Cluster0"


app.use(express.json());
app.use('/uploads', express.static('uploads'));


io.on('connection', (socket) => {
    console.log('⚡ Un usuario se conectó al socket:', socket.id);

    socket.on('join_chat', (matchId) => {
        socket.join(matchId);
        console.log(`Usuario unido a la sala: ${matchId}`);
    });

    socket.on('send_message_socket', async (data) => {
        const { matchId, senderId, mensaje } = data;

        try {
            const nuevoMensaje = new Message({
                matchId,
                senderId,
                mensaje,
                timestamp: new Date()
            });
            await nuevoMensaje.save();
            
            const mensajeCompleto = await Message.findById(nuevoMensaje._id)
                .populate('senderId', 'nombre fotos');

            io.to(matchId).emit('receive_message', mensajeCompleto);
            console.log(`Mensaje enviado a sala ${matchId}`);

        } catch (error) {
            console.error("Error guardando mensaje socket:", error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
    });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); 
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'));
        }
    }
});

// --- CONEXIÓN A BASE DE DATOS, CREACIÓN DE ÍNDICE Y START DEL SERVIDOR ---

mongoose.connect(MONGO_URI_FINAL)
    .then(async () => {
        console.log("✅ CONECTADO A LA BASE DE DATOS");
        
        // Crear índice Geoespacial
        try {
            await User.collection.createIndex({ ubicacion: "2dsphere" });
            console.log("🌍 ¡Índice Geoespacial (2dsphere) creado con éxito!");
        } catch (error) {
            console.error("Error creando índice:", error);
        }
        
        // 🔥 INICIO DEL SERVIDOR (AQUÍ ESTABA EL ERROR)
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
        });

    })
    .catch((err) => console.error("❌ ERROR DE CONEXIÓN:", err));


// --- RUTAS ---

// 1) REGISTRO 
app.post('/register', async (req, res) => {
    try {
        const { email, password, nombre, edad, latitud, longitud } = req.body;
        const emailLimpio = email.trim().toLowerCase();

        const nuevoUsuario = new User({
            email: emailLimpio, 
            password, 
            nombre, 
            edad,
            ubicacion: { type: "Point", coordinates: [longitud, latitud] }
        });

        await nuevoUsuario.save();
        console.log("✅ Usuario creado:", nombre); 
        res.status(201).json({ mensaje: "Usuario creado", usuarioId: nuevoUsuario._id });

    } catch (error) {
        if (error.code === 11000) {
            const emailLimpio = req.body.email.trim().toLowerCase();
            const usuarioExistente = await User.findOne({ email: emailLimpio });
            return res.status(200).json({ 
                mensaje: "¡Bienvenido de nuevo!", 
                usuarioId: usuarioExistente._id 
            });
        }
        console.error("Error grave:", error);
        res.status(500).json({ error: "Error al procesar usuario" });
    }
});

// 2) SUBIR FOTOS 
app.post('/upload-photos', upload.array('fotos', 6), async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No se subieron fotos" });
        }

    const fotosURLs = req.files.map(file => {
    return `http://127.0.0.1:3000/uploads/${file.filename}`; // ESTO AÚN DEBE CAMBIARSE
});

        const usuario = await User.findById(userId);
        usuario.fotos.push(...fotosURLs); 
        await usuario.save();

        res.json({ 
            mensaje: "Fotos subidas correctamente", 
            fotos: fotosURLs 
        });

    } catch (error) {
        console.error("Error subiendo fotos:", error);
        res.status(500).json({ error: "Error al subir fotos" });
    }
});



// 10) BORRAR FOTO INDIVIDUAL
// const fs = require('fs'); // Ya está definido arriba

app.post('/delete-photo', async (req, res) => {
    try {
        const { userId, photoUrl } = req.body;

        const usuario = await User.findById(userId);
        if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

        usuario.fotos = usuario.fotos.filter(foto => foto !== photoUrl);
        await usuario.save();

        const nombreArchivo = photoUrl.split('/uploads/')[1];
        if (nombreArchivo) {
            const rutaArchivo = path.join(__dirname, 'uploads', nombreArchivo);
            fs.unlink(rutaArchivo, (err) => {
                if (err) console.log("No se pudo borrar el archivo físico (quizás ya no existe):", err);
                else console.log("Archivo físico borrado:", nombreArchivo);
            });
        }

        res.json({ mensaje: "Foto eliminada", fotos: usuario.fotos });

    } catch (error) {
        console.error("Error borrando foto:", error);
        res.status(500).json({ error: "Error al borrar foto" });
    }
});


// 3) ACTUALIZAR PERFIL 
app.put('/update-profile', async (req, res) => {
    try {
        const { userId, bio, genero } = req.body;

        const usuario = await User.findById(userId);
        if (!usuario) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (bio) usuario.bio = bio;
        if (genero) usuario.genero = genero;

        await usuario.save();
        res.json({ mensaje: "Perfil actualizado", usuario });

    } catch (error) {
        console.error("Error actualizando perfil:", error);
        res.status(500).json({ error: "Error al actualizar perfil" });
    }
});

// 4) FEED INTELIGENTE
app.get('/feed', async (req, res) => {
    try {
        const { 
            myId, 
            latitud, 
            longitud, 
            distanciaMax = 50000, 
            edadMin = 18, 
            edadMax = 99,
            generoInteres 
        } = req.query;

        if (!latitud || !longitud) {
            return res.status(400).json({ error: "Faltan coordenadas GPS" });
        }

        let filtro = {
            ubicacion: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(longitud), parseFloat(latitud)]
                    },
                    $maxDistance: parseInt(distanciaMax) 
                }
            },
            _id: { $ne: myId }, 
            edad: { $gte: parseInt(edadMin), $lte: parseInt(edadMax) } 
        };

        if (generoInteres && generoInteres !== "Todos") {
            filtro.genero = generoInteres;
        }

        const yo = await User.findById(myId);
        if (yo) {
            filtro._id.$nin = [...yo.likesEnviados, ...yo.matches, myId];
        }

        const usuarios = await User.find(filtro).select('-password').limit(20);
        
        res.json(usuarios);

    } catch (error) {
        console.error("Error en feed:", error);
        res.status(500).json({ error: "Error al obtener feed inteligente" });
    }
});

// 5) DAR LIKE / VERIFICAR MATCH 
app.post('/like', async (req, res) => {
    try {
        const { myId, targetId } = req.body;

        const yo = await User.findById(myId);
        const elOtro = await User.findById(targetId);

        if (!yo || !elOtro) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        yo.likesEnviados.addToSet(targetId);
        elOtro.likesRecibidos.addToSet(myId);
        
        await yo.save();
        await elOtro.save();

        const esMatch = elOtro.likesEnviados.some(id => id.toString() === myId);

        if (esMatch) {
            console.log(`💘 ¡MATCH CONFIRMADO entre ${yo.nombre} y ${elOtro.nombre}!`);
            
            yo.matches.addToSet(targetId);
            elOtro.matches.addToSet(myId);
            
            await yo.save();
            await elOtro.save();

            const nuevoMatch = new Match({
                usuarios: [myId, targetId],
                fechaMatch: new Date()
            });
            await nuevoMatch.save();
            
            return res.json({ 
                match: true, 
                mensaje: "¡Es un Match!",
                matchId: nuevoMatch._id 
            });
        }

        res.json({ match: false, mensaje: "Like enviado" });

    } catch (error) {
        console.error("Error dando like:", error);
        res.status(500).json({ error: "Error en el servidor" });
    }
});

// 6) OBTENER MIS MATCHES 
app.get('/my-matches/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const matchesEncontrados = await Match.find({ usuarios: userId })
            .populate('usuarios', 'nombre edad fotos bio'); 
            
        const matchesFormateados = matchesEncontrados.map(match => {
            const elOtro = match.usuarios.find(u => u._id.toString() !== userId);
            
            if (!elOtro) return null; 
            
            return {
                _id: match._id, 
                nombre: elOtro.nombre,
                edad: elOtro.edad,
                fotos: elOtro.fotos,
                bio: elOtro.bio,
                usuarioId: elOtro._id 
            };
        }).filter(m => m !== null);

        res.json({ matches: matchesFormateados });

    } catch (error) {
        console.error("Error obteniendo matches:", error);
        res.status(500).json({ error: "Error al obtener matches" });
    }
});


// 11) OBTENER PERFIL DE USUARIO (POR ID)
app.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const usuario = await User.findById(id).select('-password');
        
        if (!usuario) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        res.json(usuario);

    } catch (error) {
        console.error("Error obteniendo usuario:", error);
        res.status(500).json({ error: "Error al buscar usuario" });
    }
});

// 7) ENVIAR MENSAJE 
app.post('/send-message', async (req, res) => {
    try {
        const { matchId, senderId, mensaje } = req.body;

        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({ error: "Match no encontrado" });
        }

        if (!match.usuarios.includes(senderId)) {
            return res.status(403).json({ error: "No autorizado" });
        }

        const nuevoMensaje = new Message({
            matchId,
            senderId,
            mensaje,
            timestamp: new Date()
        });

        await nuevoMensaje.save();

        res.json({ mensaje: "Mensaje enviado", data: nuevoMensaje });

    } catch (error) {
        console.error("Error enviando mensaje:", error);
        res.status(500).json({ error: "Error al enviar mensaje" });
    }
});

// 8) OBTENER CONVERSACIÓN 
app.get('/conversation/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;

        const mensajes = await Message.find({ matchId })
            .populate('senderId', 'nombre fotos')
            .sort({ timestamp: 1 }); 

        res.json({ mensajes });

    } catch (error) {
        console.error("Error obteniendo conversación:", error);
        res.status(500).json({ error: "Error al obtener conversación" });
    }
});

// 9) UNMATCH 
app.post('/unmatch', async (req, res) => {
    try {
        const { userId, matchId } = req.body;

        const match = await Match.findById(matchId);
        if (!match) return res.status(404).json({ error: "Match no encontrado" });

        const elOtroId = match.usuarios.find(id => id.toString() !== userId);

        await Match.findByIdAndDelete(matchId);

        await Message.deleteMany({ matchId: matchId });

        await User.findByIdAndUpdate(userId, {
            $pull: { matches: elOtroId, likesEnviados: elOtroId, likesRecibidos: elOtroId }
        });

        if (elOtroId) {
            await User.findByIdAndUpdate(elOtroId, {
                $pull: { matches: userId, likesEnviados: userId, likesRecibidos: userId }
            });
        }

        console.log(`💔 Unmatch realizado: ${userId} borró el match ${matchId}`);
        res.json({ mensaje: "Unmatch realizado con éxito" });

    } catch (error) {
        console.error("Error en unmatch:", error);
        res.status(500).json({ error: "Error al realizar unmatch" });
    }
});