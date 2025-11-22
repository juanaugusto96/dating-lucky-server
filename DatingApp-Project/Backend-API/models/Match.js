
const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
    usuarios: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    }],
    fechaMatch: { 
        type: Date, 
        default: Date.now 
    },
    activo: { 
        type: Boolean, 
        default: true 
    }
}, {
    timestamps: true
});

// Índice compuesto para buscar matches rápidamente
MatchSchema.index({ usuarios: 1 });

module.exports = mongoose.model('Match', MatchSchema);