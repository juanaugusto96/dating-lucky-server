const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Datos Básicos
    email: { 
        type: String, 
        required: true, 
        unique: true // No puede haber dos usuarios con el mismo email
    },
    password: { 
        type: String, 
        required: true 
    },
    nombre: { type: String, required: true },
    edad: { type: Number },
    genero: { type: String, enum: ['Hombre', 'Mujer', 'Otro'] }, // Limitamos las opciones
    bio: { type: String, default: "" },
    fotos: [{ type: String }], // Guardaremos URLs de las fotos aquí

    // Geolocalización (CRUCIAL para apps de citas)
    ubicacion: {
        type: { type: String, default: "Point" },
        coordinates: { type: [Number], index: "2dsphere" } // [Longitud, Latitud]
    },

    // Sistema de Matches
    likesEnviados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // A quién le di like
    likesRecibidos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Quién me dio like
    matches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] // Match confirmado
}, {
    timestamps: true // Crea automáticamente fecha de creación y actualización
});

// Exportamos el modelo para usarlo en otros archivos
module.exports = mongoose.model('User', UserSchema);