
/**
 * Modelo de Configuración del Sistema
 * Almacena configuraciones como CBU, mensajes, etc.
 */
const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    trim: true,
    lowercase: true
  },
  value: { 
    type: mongoose.Schema.Types.Mixed, 
    required: true 
  },
  description: {
    type: String,
    default: ''
  },
  updatedBy: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Método estático para obtener configuración
configSchema.statics.get = async function(key, defaultValue = null) {
  const config = await this.findOne({ key: key.toLowerCase() });
  return config ? config.value : defaultValue;
};

// Método estático para establecer configuración
// #957 (velocidad): cache de lectura de 5 s por proceso (getConfig se llama ~170 veces en server.js, varias por cada carga del home).
// Cualquier escritura (set / setConfig) la vacía entera; entre instancias el desfase máximo es de 5 s, lo mismo que los Commands (15 s).
configSchema.statics._cache = new Map();
configSchema.statics.set = async function(key, value, updatedBy = null) {
  try { this._cache.clear(); } catch (_) {}
  const config = await this.findOneAndUpdate(
    { key: key.toLowerCase() },
    { 
      key: key.toLowerCase(), 
      value, 
      updatedBy,
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  return config;
};

// Método estático para obtener múltiples configuraciones
configSchema.statics.getMultiple = async function(keys) {
  const configs = await this.find({ 
    key: { $in: keys.map(k => k.toLowerCase()) } 
  }).lean();
  
  const result = {};
  configs.forEach(config => {
    result[config.key] = config.value;
  });
  
  return result;
};

module.exports = mongoose.models['Config'] || mongoose.model('Config', configSchema);