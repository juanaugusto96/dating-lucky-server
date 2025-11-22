const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');

const http = require('http'); // <--- NUEVO
const { Server } = require("socket.io"); // <--- NUEVO


const User = require('./models/User');
const Match = require('./models/Match'); // NUEVO modelo
const Message = require('./models/Message'); // NUEVO modelo
const app = express();

const server = http.createServer(app); // <--- ENVOLVEMOS EXPRESS
const io = new Server(server); // <--- INICIAMOS SOCKET.IO

app.use(express.json());

app.use('/uploads', express.static('uploads'));



io.on('connection', (socket) => {
    console.log('⚡ Un usuario se conectó al socket:', socket.id);

    // 1. Evento: Unirse a una sala de chat específica (Match ID)
    socket.on('join_chat', (matchId) => {
        socket.join(matchId);
        console.log(`Usuario unido a la sala: ${matchId}`);
    });

    // 2. Evento: Enviar mensaje
    socket.on('send_message_socket', async (data) => {
        const { matchId, senderId, mensaje } = data;

        // Guardamos en Base de Datos (Igual que antes)
        try {
            const nuevoMensaje = new Message({
                matchId,
                senderId,
                mensaje,
                timestamp: new Date()
            });
            await nuevoMensaje.save();
            
            // Recuperamos datos del remitente para enviarlos completos
            const mensajeCompleto = await Message.findById(nuevoMensaje._id)
                .populate('senderId', 'nombre fotos');

            // 🔥 EMITIMOS A TODOS EN LA SALA (Incluido el que lo envió)
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
        cb(null, 'uploads/'); // Carpeta donde se guardarán las fotos
    },
    filename: (req, file, cb) => {
        // Generamos un nombre único: timestamp + nombre original
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
    fileFilter: (req, file, cb) => {
        // Solo aceptar imágenes
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

// --- CONEXIÓN A BASE DE DATOS Y CREACIÓN DE ÍNDICE ---
const connectionString = "mongodb+srv://juanaugustoroldan7_db_user:12345@cluster0.hxfqesc.mongodb.net/?appName=Cluster0";

mongoose.connect(connectionString)
    .then(async () => {
        console.log("✅ CONECTADO A LA BASE DE DATOS");
        
        // --- EL MARTILLAZO: Crear el índice manualmente aquí ---
        try {
            await User.collection.createIndex({ ubicacion: "2dsphere" });
            console.log("🌍 ¡Índice Geoespacial (2dsphere) creado con éxito!");
        } catch (error) {
            console.error("Error creando índice:", error);
        }
        // -------------------------------------------------------
    })
    .catch((err) => console.error("❌ ERROR DE CONEXIÓN:", err));
// --- RUTAS ---

// 1) REGISTRO (igual que antes)
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

// 2) SUBIR FOTOS (NUEVO)
app.post('/upload-photos', upload.array('fotos', 6), async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No se subieron fotos" });
        }

    const fotosURLs = req.files.map(file => {
    return `http://127.0.0.1:3000/uploads/${file.filename}`;
});

        // Actualizamos el usuario con las nuevas fotos
        const usuario = await User.findById(userId);
        usuario.fotos.push(...fotosURLs); // Agregamos las nuevas fotos
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
const fs = require('fs'); // Necesario para borrar archivos del sistema

app.post('/delete-photo', async (req, res) => {
    try {
        const { userId, photoUrl } = req.body;

        // 1. Buscamos al usuario
        const usuario = await User.findById(userId);
        if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

        // 2. Filtramos el array para quitar esa URL
        usuario.fotos = usuario.fotos.filter(foto => foto !== photoUrl);
        await usuario.save();

        // 3. (Opcional pero recomendado) Borrar el archivo físico de la carpeta 'uploads'
        // La URL viene como "http://localhost:3000/uploads/foto.jpg", hay que extraer el path
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


// 3) ACTUALIZAR PERFIL (NUEVO)
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

// 4) FEED (actualizado para incluir fotos)
// 4) FEED INTELIGENTE (Con Geo, Edad y Género)
app.get('/feed', async (req, res) => {
    try {
        // Recibimos los filtros desde el iPhone
        // Si no envían nada, usamos valores por defecto
        const { 
            myId, 
            latitud, 
            longitud, 
            distanciaMax = 50000, // 50km por defecto
            edadMin = 18, 
            edadMax = 99,
            generoInteres // "Hombre", "Mujer" o "Todos"
        } = req.query;

        // Validamos que lleguen coordenadas
        if (!latitud || !longitud) {
            return res.status(400).json({ error: "Faltan coordenadas GPS" });
        }

        // 1. FILTRO GEOGRÁFICO ($near es nativo de MongoDB)
        let filtro = {
            ubicacion: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [parseFloat(longitud), parseFloat(latitud)]
                    },
                    $maxDistance: parseInt(distanciaMax) // Metros
                }
            },
            _id: { $ne: myId }, // No mostrarme a mí mismo
            edad: { $gte: parseInt(edadMin), $lte: parseInt(edadMax) } // Rango de edad
        };

        // 2. FILTRO DE GÉNERO (Opcional)
        if (generoInteres && generoInteres !== "Todos") {
            filtro.genero = generoInteres;
        }

        // 3. FILTRO DE "YA VISTOS" (Importante para Swipe)
        // Buscamos al usuario para saber a quién ya le dio like/pass
        // (Por ahora solo filtramos likes, luego añadiremos "dislikes")
        const yo = await User.findById(myId);
        if (yo) {
            // Excluimos ($nin = Not In) a los que ya están en mis likes o matches
            filtro._id.$nin = [...yo.likesEnviados, ...yo.matches, myId];
        }

        // Ejecutamos la búsqueda
        const usuarios = await User.find(filtro).select('-password').limit(20);
        
        res.json(usuarios);

    } catch (error) {
        console.error("Error en feed:", error);
        res.status(500).json({ error: "Error al obtener feed inteligente" });
    }
});

// 5) DAR LIKE / VERIFICAR MATCH (mejorado)
app.post('/like', async (req, res) => {
    try {
        const { myId, targetId } = req.body;

        const yo = await User.findById(myId);
        const elOtro = await User.findById(targetId);

        if (!yo || !elOtro) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        // Guardar mi Like
        yo.likesEnviados.addToSet(targetId);
        elOtro.likesRecibidos.addToSet(myId);
        
        await yo.save();
        await elOtro.save();

        // Verificar Match
        const esMatch = elOtro.likesEnviados.some(id => id.toString() === myId);

        if (esMatch) {
            console.log(`💘 ¡MATCH CONFIRMADO entre ${yo.nombre} y ${elOtro.nombre}!`);
            
            // Agregamos a ambos a la lista de matches
            yo.matches.addToSet(targetId);
            elOtro.matches.addToSet(myId);
            
            await yo.save();
            await elOtro.save();

            // Crear registro de Match en BD
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

// 6) OBTENER MIS MATCHES (CORREGIDO PARA CHAT)
app.get('/my-matches/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // 1. Buscamos en la colección MATCHES todas las conversaciones donde estoy YO
        const matchesEncontrados = await Match.find({ usuarios: userId })
            .populate('usuarios', 'nombre edad fotos bio'); // Traemos datos de los participantes
            
        // 2. Transformamos los datos para que Swift los entienda
        const matchesFormateados = matchesEncontrados.map(match => {
            // Buscamos quién es la "otra persona" en la conversación
            const elOtro = match.usuarios.find(u => u._id.toString() !== userId);
            
            if (!elOtro) return null; // Por seguridad
            
            return {
                _id: match._id, // <--- ¡ESTA ES LA CLAVE! Ahora enviamos el ID del Match, no del Usuario
                nombre: elOtro.nombre,
                edad: elOtro.edad,
                fotos: elOtro.fotos,
                bio: elOtro.bio,
                // Opcional: enviamos el ID del usuario por si sirve luego
                usuarioId: elOtro._id 
            };
        }).filter(m => m !== null); // Quitamos nulos si hubo error

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
        
        // Buscamos al usuario y excluimos el password por seguridad
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

// 7) ENVIAR MENSAJE (NUEVO)
app.post('/send-message', async (req, res) => {
    try {
        const { matchId, senderId, mensaje } = req.body;

        // Verificar que el match existe
        const match = await Match.findById(matchId);
        if (!match) {
            return res.status(404).json({ error: "Match no encontrado" });
        }

        // Verificar que el sender es parte del match
        if (!match.usuarios.includes(senderId)) {
            return res.status(403).json({ error: "No autorizado" });
        }

        // Crear el mensaje
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

// 8) OBTENER CONVERSACIÓN (NUEVO)
app.get('/conversation/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;

        const mensajes = await Message.find({ matchId })
            .populate('senderId', 'nombre fotos')
            .sort({ timestamp: 1 }); // Ordenar por fecha

        res.json({ mensajes });

    } catch (error) {
        console.error("Error obteniendo conversación:", error);
        res.status(500).json({ error: "Error al obtener conversación" });
    }
});

// 9) UNMATCH (BORRAR CONVERSACIÓN Y BLOQUEAR)
app.post('/unmatch', async (req, res) => {
    try {
        const { userId, matchId } = req.body;

        // 1. Buscamos el match para saber quién es la otra persona
        const match = await Match.findById(matchId);
        if (!match) return res.status(404).json({ error: "Match no encontrado" });

        const elOtroId = match.usuarios.find(id => id.toString() !== userId);

        // 2. Eliminamos el Match de la colección principal
        await Match.findByIdAndDelete(matchId);

        // 3. Eliminamos los mensajes de ese chat (Opcional, por privacidad)
        await Message.deleteMany({ matchId: matchId });

        // 4. Sacamos los IDs de los arrays de usuarios
        // Usamos $pull para sacar un elemento de un array
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

// --- ENCENDER SERVIDOR ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/datingluck';
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.error("❌ Error MongoDB:", err));