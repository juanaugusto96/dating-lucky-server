const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    matchId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Match',
        required: true 
    },
    senderId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    mensaje: { 
        type: String, 
        required: true 
    },
    leido: {
        type: Boolean,
        default: false
    },
    timestamp: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Message', MessageSchema);