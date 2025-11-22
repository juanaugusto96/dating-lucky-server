// Esquema de Reportes
const ReportSchema = new mongoose.Schema({
    denuncianteId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    denunciadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    motivo: String,
    fecha: { type: Date, default: Date.now }
});
const Report = mongoose.model('Report', ReportSchema);

// ...

// RUTA 13: REPORTAR USUARIO
app.post('/report', async (req, res) => {
    try {
        const { denuncianteId, denunciadoId, motivo } = req.body;

        // 1. Guardamos el reporte
        const nuevoReporte = new Report({ denuncianteId, denunciadoId, motivo });
        await nuevoReporte.save();

        // 2. (Opcional) Bloqueamos al usuario automáticamente para que no se vean más
        // Esto es similar al UNMATCH: sacamos los IDs de los arrays
        await User.findByIdAndUpdate(denuncianteId, {
            $pull: { matches: denunciadoId, likesEnviados: denunciadoId, likesRecibidos: denunciadoId }
        });
        
        await User.findByIdAndUpdate(denunciadoId, {
            $pull: { matches: denuncianteId, likesEnviados: denuncianteId, likesRecibidos: denuncianteId }
        });
        
        // También borramos el Match si existía
        // Buscamos el match que contenga a ambos
        await Match.findOneAndDelete({
            usuarios: { $all: [denuncianteId, denunciadoId] }
        });

        console.log(`🚨 Usuario ${denunciadoId} reportado por ${denuncianteId}. Motivo: ${motivo}`);
        res.json({ mensaje: "Usuario reportado y bloqueado correctamente" });

    } catch (error) {
        console.error("Error al reportar:", error);
        res.status(500).json({ error: "Error al procesar el reporte" });
    }
});